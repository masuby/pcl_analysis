"""PCL Automation — Windows worker.

Runs on the operator's Windows PC and executes the pipelines that need real
Excel (xlwings) and the Windows .exe helpers — today that's the Management
report. Everything else keeps running in the Linux container on the server.

How it works (pull model — no inbound access to this PC is ever needed):
  1. Polls the server:   GET  /worker/next
  2. Downloads the row files you uploaded on the site (zip) into ROW_FILES
  3. Runs the pipeline's normal steps locally (same build_steps as the server)
  4. Streams stdout back:  POST /worker/<id>/log     (response says if Stop was hit)
  5. Uploads the report back: POST /worker/<id>/result
  6. Reports the outcome:  POST /worker/<id>/done

Setup (once, from backend/Automation/automation_service):
    set PCL_SERVER_URL=https://154.72.68.246:8443/automation-api
    set PCL_WORKER_TOKEN=<the same token set on the server>
    python windows_worker.py

Leave it running (or install it as a startup task / service). While it's up,
pressing Start on the live site runs Management here.
"""
from __future__ import annotations

import io
import os
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import requests
import urllib3

# The server uses a self-signed cert on :8443
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import config as C          # noqa: E402
from app import pipelines as P       # noqa: E402
from app.jobs import _terminate_tree  # noqa: E402


# ── logging ─────────────────────────────────────────────────────────────────
# When started by Task Scheduler via pythonw.exe there is no console, so mirror
# everything into worker.log (rotated at ~5 MB).
LOG_PATH = Path(__file__).resolve().parent / "worker.log"


class _Tee:
    def __init__(self, path: Path):
        self.f = open(path, "a", encoding="utf-8", buffering=1)
        self.console = sys.__stdout__

    def write(self, s):
        if self.console:
            try:
                self.console.write(s)
            except Exception:
                pass
        try:
            self.f.write(s)
        except Exception:
            pass

    def flush(self):
        for t in (self.console, self.f):
            try:
                if t:
                    t.flush()
            except Exception:
                pass


try:
    if LOG_PATH.exists() and LOG_PATH.stat().st_size > 5_000_000:
        LOG_PATH.replace(LOG_PATH.with_name("worker.log.old"))
    sys.stdout = sys.stderr = _Tee(LOG_PATH)
except Exception:
    pass

def _from_backend_env(key: str) -> str:
    """Fall back to the repo's backend/.env so nothing has to be typed/exported."""
    # .../backend/Automation/automation_service/windows_worker.py -> .../backend/.env
    env_file = Path(__file__).resolve().parents[2] / ".env"
    try:
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


SERVER = (os.getenv("PCL_SERVER_URL") or _from_backend_env("PCL_SERVER_URL")
          or "https://154.72.68.246:8443/automation-api").rstrip("/")
TOKEN = os.getenv("PCL_WORKER_TOKEN") or _from_backend_env("PCL_WORKER_TOKEN")
POLL_SECONDS = float(os.getenv("PCL_WORKER_POLL", "3"))
VERIFY = os.getenv("PCL_WORKER_VERIFY_SSL", "0") == "1"

_S = requests.Session()


def _url(path: str) -> str:
    return f"{SERVER}{path}"


def _post_logs(rid: str, lines: list[str]) -> bool:
    """Send log lines; returns True when the server says Stop was pressed."""
    if not lines:
        return False
    try:
        r = _S.post(_url(f"/worker/{rid}/log"), params={"token": TOKEN},
                    json={"lines": lines}, timeout=30, verify=VERIFY)
        return bool(r.json().get("cancel"))
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] could not post logs: {exc}")
        return False


def _download_rows(rid: str, pid: str) -> None:
    """Pull the row files uploaded on the website into this PC's upload dir."""
    dest = Path(P.PIPELINES[pid]["upload_dir"])
    dest.mkdir(parents=True, exist_ok=True)
    r = _S.get(_url(f"/worker/{rid}/rows"), params={"token": TOKEN},
               timeout=300, verify=VERIFY)
    r.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        names = zf.namelist()
        zf.extractall(dest)
    _post_logs(rid, [f"⬇ Pulled {len(names)} row file(s) from the server -> {dest}"]
                    + [f"   • {n}" for n in names])


def _upload_result(rid: str) -> None:
    """Send the generated report back so the DB step + download button work."""
    out_dir = C.MANAGEMENT_DIR / "OUTPUT"
    if not out_dir.exists():
        return
    reports = sorted(out_dir.glob("Management Report*.xlsx"),
                     key=lambda f: f.stat().st_mtime, reverse=True)
    if not reports:
        _post_logs(rid, ["⚠ No 'Management Report*.xlsx' found to upload back."])
        return
    newest = reports[0]
    try:
        with open(newest, "rb") as fh:
            r = _S.post(_url(f"/worker/{rid}/result"), params={"token": TOKEN},
                        files={"files": (newest.name, fh)}, timeout=600, verify=VERIFY)
        r.raise_for_status()
        _post_logs(rid, [f"⬆ Uploaded '{newest.name}' back to the server."])
    except Exception as exc:  # noqa: BLE001
        _post_logs(rid, [f"⚠ Could not upload the report back: {exc}"])


def _run_step(rid: str, step: dict, env: dict) -> tuple[int, bool]:
    """Run one step, streaming stdout to the server. Returns (exit_code, cancelled)."""
    _post_logs(rid, [f"\n=== {step['label']} ===",
                     "$ " + " ".join(str(a) for a in step["argv"])])
    try:
        proc = subprocess.Popen(
            step["argv"], cwd=step.get("cwd"), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    except Exception as exc:  # noqa: BLE001
        _post_logs(rid, [f"✗ Could not launch: {exc}"])
        return 1, False

    buf: list[str] = []
    last = time.time()
    cancelled = False
    for line in proc.stdout:
        buf.append(line.rstrip("\n"))
        print(line, end="")
        # flush at most ~1x/sec (or every 40 lines) to keep the UI live
        if len(buf) >= 40 or (time.time() - last) > 1.0:
            if _post_logs(rid, buf):
                cancelled = True
            buf, last = [], time.time()
            if cancelled:
                _terminate_tree(proc)
                break
    if buf:
        if _post_logs(rid, buf):
            cancelled = True
    proc.wait()
    return (proc.returncode if proc.returncode is not None else 1), cancelled


def run_job(job: dict) -> None:
    rid, pid, params = job["id"], job["pipeline"], job.get("params", {})
    print(f"\n=== Job {rid} :: {pid} :: {params} ===")
    _post_logs(rid, [f"🖥  Running on Windows worker: {os.environ.get('COMPUTERNAME', 'this PC')}"])

    try:
        _download_rows(rid, pid)
    except Exception as exc:  # noqa: BLE001
        _post_logs(rid, [f"✗ Could not pull row files: {exc}"])
        _done(rid, "error")
        return

    try:
        steps = P.build_steps(pid, params)
    except Exception as exc:  # noqa: BLE001
        _post_logs(rid, [f"✗ Could not build steps: {exc}"])
        _done(rid, "error")
        return

    env = C.env_for_subprocess()
    state = "done"
    for i, step in enumerate(steps, 1):
        code, cancelled = _run_step(rid, step, env)
        if cancelled:
            _post_logs(rid, ["■ Stopped by user."])
            state = "stopped"
            break
        if code != 0:
            _post_logs(rid, [f"✗ Step {i}/{len(steps)} failed (exit {code}). Halting."])
            state = "error"
            break

    if state == "done":
        _upload_result(rid)
    _done(rid, state)
    print(f"=== Job {rid} finished: {state} ===")


def _done(rid: str, state: str) -> None:
    try:
        _S.post(_url(f"/worker/{rid}/done"), params={"token": TOKEN},
                json={"state": state}, timeout=30, verify=VERIFY)
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] could not report done: {exc}")


def main() -> None:
    if not TOKEN:
        sys.exit("PCL_WORKER_TOKEN is not set — refusing to start.")
    from datetime import datetime
    print("\n" + "=" * 60)
    print(f"PCL Windows worker started {datetime.now():%Y-%m-%d %H:%M:%S}")
    print(f"  server : {SERVER}")
    print(f"  log    : {LOG_PATH}")
    print(f"  polling every {POLL_SECONDS}s — Ctrl+C to stop")
    print("=" * 60)
    idle_note = True
    while True:
        try:
            r = _S.get(_url("/worker/next"), params={"token": TOKEN},
                       timeout=30, verify=VERIFY)
            if r.status_code == 401:
                sys.exit("✗ Server rejected the worker token (401). Check PCL_WORKER_TOKEN.")
            job = r.json() if r.content else {}
            if job.get("id"):
                idle_note = True
                run_job(job)
            else:
                if idle_note:
                    print("waiting for jobs…")
                    idle_note = False
        except KeyboardInterrupt:
            print("\nbye")
            return
        except Exception as exc:  # noqa: BLE001
            print(f"  [warn] poll failed: {exc}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
