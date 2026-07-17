"""Job runner: execute a pipeline's steps as subprocesses, stream their stdout
into an in-memory log buffer, and support Stop (terminate the process tree).

One job per pipeline id at a time. Logs are line-indexed so the UI can poll
`?after=<cursor>` and render in real time.
"""
from __future__ import annotations

import subprocess
import threading
import time
from dataclasses import dataclass, field

from . import config as C


@dataclass
class Job:
    pid: str
    state: str = "idle"            # idle | queued | running | done | error | stopped
    logs: list[str] = field(default_factory=list)
    started_at: float = 0.0
    ended_at: float = 0.0
    remote_id: str = ""            # set when dispatched to the Windows worker
    params: dict = field(default_factory=dict)
    _proc: subprocess.Popen | None = None
    _stop: threading.Event = field(default_factory=threading.Event)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def log(self, line: str):
        with self._lock:
            self.logs.append(line.rstrip("\n"))
            if len(self.logs) > C.LOG_CAP:
                del self.logs[: len(self.logs) - C.LOG_CAP]

    def tail(self, after: int) -> tuple[list[str], int]:
        with self._lock:
            return self.logs[after:], len(self.logs)


class JobManager:
    def __init__(self):
        self._jobs: dict[str, Job] = {}
        self._remote: dict[str, Job] = {}     # remote_id -> Job
        self._queue: list[str] = []           # remote_ids waiting for a worker
        self._lock = threading.Lock()

    def get(self, pid: str) -> Job:
        with self._lock:
            if pid not in self._jobs:
                self._jobs[pid] = Job(pid=pid)
            return self._jobs[pid]

    def is_running(self, pid: str) -> bool:
        return self.get(pid).state in ("running", "queued")

    # ── remote (Windows worker) jobs ─────────────────────────────────────────
    def start_remote(self, pid: str, params: dict) -> str:
        """Queue a job for the Windows worker instead of running it here."""
        import uuid
        job = self.get(pid)
        with job._lock:
            if job.state in ("running", "queued"):
                return ""
            job.state = "queued"
            job.logs = []
            job._stop = threading.Event()
            job.started_at = time.time()
            job.ended_at = 0.0
            job.remote_id = uuid.uuid4().hex[:12]
            job.params = dict(params or {})
        job.log("⏳ Queued for the Windows worker — waiting for your PC to pick it up…")
        with self._lock:
            self._remote[job.remote_id] = job
            self._queue.append(job.remote_id)
        return job.remote_id

    def claim_next(self) -> dict | None:
        """Worker asks for work. Returns the next queued job, or None."""
        with self._lock:
            queue = list(self._queue)
        for rid in queue:
            job = self._remote.get(rid)
            if job and job.state == "queued":
                with self._lock:
                    if rid in self._queue:
                        self._queue.remove(rid)
                job.state = "running"
                job.log("▶ Picked up by the Windows worker.")
                return {"id": rid, "pipeline": job.pid, "params": job.params}
            with self._lock:
                if rid in self._queue:
                    self._queue.remove(rid)
        return None

    def remote_job(self, rid: str) -> Job | None:
        return self._remote.get(rid)

    def remote_log(self, rid: str, lines: list[str]) -> bool:
        job = self._remote.get(rid)
        if not job:
            return False
        for ln in lines:
            job.log(ln)
        return True

    def remote_done(self, rid: str, state: str) -> bool:
        job = self._remote.get(rid)
        if not job:
            return False
        job.state = state if state in ("done", "error", "stopped") else "done"
        job.ended_at = time.time()
        job.log("\n✅ Pipeline finished." if job.state == "done"
                else ("■ Stopped." if job.state == "stopped" else "✗ Pipeline failed."))
        return True

    def remote_cancelled(self, rid: str) -> bool:
        job = self._remote.get(rid)
        return bool(job and job._stop.is_set())

    def start(self, pid: str, steps: list[dict]) -> bool:
        job = self.get(pid)
        with job._lock:
            if job.state == "running":
                return False
            job.state = "running"
            job.logs = []
            job._stop = threading.Event()
            job.started_at = time.time()
            job.ended_at = 0.0
        threading.Thread(target=self._run, args=(job, steps), daemon=True).start()
        return True

    def stop(self, pid: str) -> bool:
        job = self.get(pid)
        if job.state not in ("running", "queued"):
            return False
        job._stop.set()
        if job.state == "queued":       # remote job not picked up yet
            job.state = "stopped"
            job.log("■ Cancelled before the Windows worker picked it up.")
            job.ended_at = time.time()
            return True
        job.log("■ STOP requested — terminating current step…")
        proc = job._proc
        if proc and proc.poll() is None:
            _terminate_tree(proc)       # local job
        # remote job: the worker sees `cancel` on its next log post and stops there
        return True

    def _run(self, job: Job, steps: list[dict]):
        env = C.env_for_subprocess()
        try:
            for i, step in enumerate(steps, 1):
                if job._stop.is_set():
                    break
                job.log(f"\n=== Step {i}/{len(steps)}: {step['label']} ===")
                job.log("$ " + " ".join(_short(a) for a in step["argv"]))
                code = self._run_step(job, step, env)
                if job._stop.is_set():
                    job.state = "stopped"
                    job.log("■ Stopped by user.")
                    return
                if code != 0:
                    job.state = "error"
                    job.log(f"✗ Step failed (exit {code}). Halting pipeline.")
                    return
            job.state = "stopped" if job._stop.is_set() else "done"
            job.log("\n✅ Pipeline finished." if job.state == "done" else "■ Stopped.")
        except Exception as exc:  # noqa: BLE001
            job.state = "error"
            job.log(f"✗ Runner error: {exc}")
        finally:
            job.ended_at = time.time()
            job._proc = None

    def _run_step(self, job: Job, step: dict, env: dict) -> int:
        try:
            proc = subprocess.Popen(
                step["argv"], cwd=step.get("cwd"), env=env,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1,
                creationflags=_CREATE_GROUP,
            )
        except Exception as exc:  # noqa: BLE001
            job.log(f"✗ Could not launch: {exc}")
            return 1
        job._proc = proc
        for line in proc.stdout:  # streams line-by-line
            job.log(line)
            if job._stop.is_set():
                _terminate_tree(proc)
                break
        proc.wait()
        return proc.returncode if proc.returncode is not None else 1


# --------------------------------------------------------------------------- #
# Cross-platform process-tree termination
# --------------------------------------------------------------------------- #
import os
import signal

if os.name == "nt":
    _CREATE_GROUP = subprocess.CREATE_NEW_PROCESS_GROUP
else:
    _CREATE_GROUP = 0


def _terminate_tree(proc: subprocess.Popen):
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                           capture_output=True)
        else:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except Exception:
                proc.terminate()
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _short(arg: str) -> str:
    a = str(arg)
    return a.rsplit("\\", 1)[-1].rsplit("/", 1)[-1] if ("\\" in a or "/" in a) and a.endswith(".py") else a


manager = JobManager()
