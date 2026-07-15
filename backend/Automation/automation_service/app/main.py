"""Automation orchestrator API.

Runs the existing report scripts (CRM / Call Center / Management / MTD) as
subprocesses, streams their logs, and drives their interactive steps from the
web (date, file uploads, email choice, recipients). Logic in the scripts is
untouched — only paths/flow are parameterised.

Run:  uvicorn app.main:app --port 8091   (from backend/Automation/automation_service)
"""
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config as C
from . import pipelines as P
from . import recipients as R
from .jobs import manager

app = FastAPI(title="PCL Automation Orchestrator", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Names uploaded via the UI this session, per pipeline — so auto-clear only
# removes what the user just dropped, never the persisted masters / helper scripts.
_UPLOADED: dict[str, set] = {}


def _upload_dir(pid: str) -> Path:
    d = Path(P.PIPELINES[pid]["upload_dir"])
    d.mkdir(parents=True, exist_ok=True)
    return d


def _data_files(d: Path) -> list[str]:
    return sorted(f.name for f in d.iterdir()
                  if f.is_file() and f.suffix.lower() in (".xlsx", ".xls", ".csv")
                  and not f.name.startswith("~$"))


@app.get("/health")
def health():
    return {"ok": True, "automation_dir": str(C.AUTOMATION_DIR), "python": C.PYTHON,
            "pipelines": list(P.PIPELINES.keys())}


@app.get("/pipelines")
def list_pipelines():
    return {"pipelines": P.public_registry()}


@app.get("/pipelines/{pid}/files")
def list_files(pid: str):
    if pid not in P.PIPELINES:
        return {"error": "unknown pipeline"}
    d = _upload_dir(pid)
    files = _data_files(d)
    ok, missing = P.validate_uploads(pid, files)
    return {"files": files, "uploaded": sorted(_UPLOADED.get(pid, set())),
            "valid": ok, "missing": missing}


@app.post("/pipelines/{pid}/upload")
async def upload(pid: str, files: list[UploadFile] = File(...)):
    if pid not in P.PIPELINES:
        return {"error": "unknown pipeline"}
    d = _upload_dir(pid)
    saved = []
    tracked = _UPLOADED.setdefault(pid, set())
    for f in files:
        name = Path(f.filename).name
        if not name:
            continue
        with open(d / name, "wb") as out:
            shutil.copyfileobj(f.file, out)
        saved.append(name)
        tracked.add(name)
    files_now = _data_files(d)
    ok, missing = P.validate_uploads(pid, files_now)
    return {"saved": saved, "files": files_now, "valid": ok, "missing": missing}


@app.post("/pipelines/{pid}/clear")
def clear_uploads(pid: str):
    """Remove only the files uploaded via the UI this session (never masters/scripts)."""
    if pid not in P.PIPELINES:
        return {"error": "unknown pipeline"}
    d = _upload_dir(pid)
    removed = 0
    for name in list(_UPLOADED.get(pid, set())):
        f = d / name
        if f.is_file():
            try:
                f.unlink()
                removed += 1
            except Exception:
                pass
    _UPLOADED[pid] = set()
    return {"removed": removed}


class StartRequest(BaseModel):
    date: str = ""
    send: str = "no"
    db_update: bool = True     # CRM: also upload processed files to the live server


@app.post("/pipelines/{pid}/start")
def start(pid: str, req: StartRequest):
    if pid not in P.PIPELINES:
        return {"error": "unknown pipeline"}
    if manager.is_running(pid):
        return {"state": "running", "detail": "already running"}
    # validate uploads first
    d = _upload_dir(pid)
    ok, missing = P.validate_uploads(pid, _data_files(d))
    if not ok:
        return {"error": "missing_files", "missing": missing}
    steps = P.build_steps(pid, req.model_dump())
    # append the auto-clear as a final bookkeeping action handled by the runner:
    manager.start(pid, steps)
    return {"state": "running", "steps": [s["label"] for s in steps]}


@app.post("/pipelines/{pid}/stop")
def stop(pid: str):
    return {"stopped": manager.stop(pid)}


@app.get("/pipelines/{pid}/logs")
def logs(pid: str, after: int = 0):
    job = manager.get(pid)
    lines, cursor = job.tail(after)
    return {"state": job.state, "lines": lines, "cursor": cursor}


# ── recipients (Excel-master backed; editable for CRM / Call Center / MTD) ────
@app.get("/pipelines/{pid}/recipients")
def get_recipients(pid: str, mode: str = "actual"):
    if not R.is_editable(pid):
        return {"editable": False, "recipients": {}}
    return {"editable": True, "mode": mode,
            "departments": R.departments(pid), "recipients": R.all_(pid, mode)}


class RecipientsUpdate(BaseModel):
    mode: str = "actual"
    department: str
    emails: list[str]


@app.put("/pipelines/{pid}/recipients")
def put_recipients(pid: str, body: RecipientsUpdate):
    if not R.is_editable(pid):
        return {"error": "recipients not editable for this pipeline"}
    count = R.set_(pid, body.department, body.emails, body.mode)
    return {"saved": count, "recipients": R.all_(pid, body.mode)}
