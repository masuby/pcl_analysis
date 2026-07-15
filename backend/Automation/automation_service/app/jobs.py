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
    state: str = "idle"            # idle | running | done | error | stopped
    logs: list[str] = field(default_factory=list)
    started_at: float = 0.0
    ended_at: float = 0.0
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
        self._lock = threading.Lock()

    def get(self, pid: str) -> Job:
        with self._lock:
            if pid not in self._jobs:
                self._jobs[pid] = Job(pid=pid)
            return self._jobs[pid]

    def is_running(self, pid: str) -> bool:
        return self.get(pid).state == "running"

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
        if job.state != "running":
            return False
        job._stop.set()
        job.log("■ STOP requested — terminating current step…")
        proc = job._proc
        if proc and proc.poll() is None:
            _terminate_tree(proc)
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
