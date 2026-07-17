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
import threading
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


_PENDING: list[str] = []          # lines that failed to post — retried next flush


def _post_logs(rid: str, lines: list[str]) -> bool:
    """Send log lines (retrying anything a previous post failed to deliver).
    Returns True when the server says Stop was pressed."""
    global _PENDING
    batch = _PENDING + list(lines)
    if not batch:
        return False
    try:
        r = _S.post(_url(f"/worker/{rid}/log"), params={"token": TOKEN},
                    json={"lines": batch}, timeout=30, verify=VERIFY)
        data = r.json()
        _PENDING = []
        return bool(data.get("cancel"))
    except Exception as exc:  # noqa: BLE001
        # keep the lines so a blip (or a server restart) doesn't lose output
        _PENDING = batch[-500:]
        print(f"  [warn] could not post logs, will retry: {exc}")
        return False


def _watch_cancel(rid: str, proc: subprocess.Popen, stop_evt: threading.Event,
                  done_evt: threading.Event):
    """Poll the server while a step runs so Stop works even when the script is
    quiet, and abort if the server no longer knows about this job.

    The watcher kills the process tree ITSELF: the reader thread is blocked on
    proc.stdout.readline() and would not notice the flag until the next line —
    which may never come (Excel/.exe steps can be silent for minutes).
    """
    misses = 0
    while not done_evt.is_set():
        try:
            r = _S.get(_url(f"/worker/{rid}/status"), params={"token": TOKEN},
                       timeout=15, verify=VERIFY)
            d = r.json()
            reason = ""
            if d.get("cancel"):
                reason = "STOP received from the server"
            elif not d.get("exists"):
                misses += 1
                if misses >= 3:     # ~6s of "job unknown" -> the server lost it
                    reason = "server no longer knows this job"
            else:
                misses = 0
            if reason:
                print(f"  [watch] {reason} — terminating the running step now")
                stop_evt.set()
                if proc.poll() is None:
                    _terminate_tree(proc)
                return
        except Exception:
            pass                    # transient network/restart: keep waiting
        done_evt.wait(2.0)


_ROW_EXT = {".xlsx", ".xls", ".xlsm", ".csv", ".zip"}
_ROW_KEEP = ("master_", "zone and cluster")
# Master workbooks that must survive a clear (Management's four).
_ROW_KEEP_NAMES = {"loan.xlsx", "clientstz.xlsx", "settlements.xlsx", "users.xlsx"}


def _download_rows(rid: str, pid: str) -> None:
    """Pull the row files uploaded on the website into this PC's upload dir.

    The folder is CLEARED first so it mirrors the server exactly. Without this,
    files left from an earlier run — and the files derived from them — stay
    behind and get picked up as inputs (e.g. combined_management_processor.py
    sees 4 Loan_Accounts instead of 2 and dies renaming the second one onto an
    existing target). Masters/references are kept.
    """
    dest = Path(P.PIPELINES[pid]["upload_dir"])
    dest.mkdir(parents=True, exist_ok=True)

    stale = 0
    for f in list(dest.iterdir()):
        if not f.is_file() or f.suffix.lower() not in _ROW_EXT:
            continue
        if (f.name.lower() in _ROW_KEEP_NAMES
                or any(f.name.lower().startswith(k) for k in _ROW_KEEP)):
            continue
        try:
            f.unlink()
            stale += 1
        except Exception as exc:  # noqa: BLE001
            print(f"  [warn] could not clear {f.name}: {exc}")

    r = _S.get(_url(f"/worker/{rid}/rows"), params={"token": TOKEN},
               timeout=300, verify=VERIFY)
    r.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        names = zf.namelist()
        zf.extractall(dest)
    _post_logs(rid, [f"🧹 Cleared {stale} stale row file(s) from {dest}",
                     f"⬇ Pulled {len(names)} row file(s) from the server"]
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

    # Watch for Stop independently of stdout — a step can be silent for minutes
    # (Excel/exe), and Stop must still kill it promptly.
    stop_evt, done_evt = threading.Event(), threading.Event()
    watcher = threading.Thread(target=_watch_cancel, args=(rid, proc, stop_evt, done_evt),
                               daemon=True)
    watcher.start()

    buf: list[str] = []
    last = time.time()
    try:
        for line in proc.stdout:
            buf.append(line.rstrip("\n"))
            print(line, end="")
            # flush at most ~1x/sec (or every 40 lines) to keep the UI live
            if len(buf) >= 40 or (time.time() - last) > 1.0:
                if _post_logs(rid, buf):
                    stop_evt.set()
                buf, last = [], time.time()
            if stop_evt.is_set():
                _terminate_tree(proc)
                break
    finally:
        done_evt.set()
    if buf:
        if _post_logs(rid, buf):
            stop_evt.set()
    if stop_evt.is_set() and proc.poll() is None:
        _terminate_tree(proc)
    proc.wait()
    return (proc.returncode if proc.returncode is not None else 1), stop_evt.is_set()


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
