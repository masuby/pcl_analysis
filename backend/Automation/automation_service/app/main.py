"""Automation orchestrator API.

Runs the existing report scripts (CRM / Call Center / Management / MTD) as
subprocesses, streams their logs, and drives their interactive steps from the
web (date, file uploads, email choice, recipients). Logic in the scripts is
untouched — only paths/flow are parameterised.

Run:  uvicorn app.main:app --port 8091   (from backend/Automation/automation_service)
"""
from __future__ import annotations

import io
import os
import shutil
import zipfile
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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


class DeleteFile(BaseModel):
    name: str


@app.post("/pipelines/{pid}/files/delete")
def delete_file(pid: str, body: DeleteFile):
    """Remove one file from the pipeline's row folder (from the popup's file list)."""
    if pid not in P.PIPELINES:
        return {"error": "unknown pipeline"}
    d = _upload_dir(pid)
    name = Path(body.name).name          # strip any path — no traversal
    target = d / name
    if target.suffix.lower() == ".py":
        return {"error": "refusing to delete a script"}
    if not target.is_file():
        return {"error": f"'{name}' not found"}
    try:
        target.unlink()
    except Exception as exc:  # noqa: BLE001
        return {"error": f"could not delete '{name}': {exc}"}
    _UPLOADED.get(pid, set()).discard(name)
    files = _data_files(d)
    ok, missing = P.validate_uploads(pid, files)
    return {"deleted": name, "files": files, "valid": ok, "missing": missing}


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
    deadline: str = ""         # MTD: editable submission time shown in the email


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
    # Pipelines that need real Windows/Excel are queued for windows_worker.py
    # running on the operator's PC; everything else runs here.
    if P.PIPELINES[pid].get("runner") == "windows":
        rid = manager.start_remote(pid, req.model_dump())
        if not rid:
            return {"state": "running", "detail": "already running"}
        return {"state": "queued", "remote": True,
                "detail": "Queued for the Windows worker on your PC."}
    steps = P.build_steps(pid, req.model_dump())
    # append the auto-clear as a final bookkeeping action handled by the runner:
    manager.start(pid, steps)
    return {"state": "running", "steps": [s["label"] for s in steps]}


@app.post("/pipelines/{pid}/update-files")
def update_files(pid: str):
    """Run the pipeline's post-run housekeeping (CRM: update masters; Call
    Center / Management: clean old row files). Streams to the same logs."""
    if pid not in P.PIPELINES:
        return {"error": "unknown pipeline"}
    if not P.PIPELINES[pid].get("update_files"):
        return {"error": "no update action for this pipeline"}
    if manager.is_running(pid):
        return {"state": "running", "detail": "already running"}
    steps = P.build_update_steps(pid)
    manager.start(pid, steps)
    return {"state": "running", "steps": [s["label"] for s in steps]}


# ── Windows worker API (outbound-polled by windows_worker.py on the PC) ──────
# The PC only ever makes outbound HTTPS calls here — no inbound access needed.
WORKER_TOKEN = os.getenv("PCL_WORKER_TOKEN", "")


def _worker_auth(token: str):
    if not WORKER_TOKEN or token != WORKER_TOKEN:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="bad worker token")


class WorkerLog(BaseModel):
    lines: list[str] = []


class WorkerDone(BaseModel):
    state: str = "done"


@app.get("/worker/next")
def worker_next(token: str = ""):
    """Worker polls for the next queued job. Empty object = nothing to do."""
    _worker_auth(token)
    return manager.claim_next() or {}


@app.get("/worker/{rid}/status")
def worker_status(rid: str, token: str = ""):
    """Heartbeat the worker polls while a step runs, so Stop is honoured even
    when the script is quiet. `exists:false` means the server lost the job
    (e.g. a restart) — the worker must abort rather than run on blind."""
    _worker_auth(token)
    job = manager.remote_job(rid)
    return {"exists": bool(job), "cancel": manager.remote_cancelled(rid),
            "state": job.state if job else "gone"}


@app.post("/worker/{rid}/log")
def worker_log(rid: str, body: WorkerLog, token: str = ""):
    """Worker streams stdout back; response tells it whether Stop was pressed."""
    _worker_auth(token)
    known = manager.remote_log(rid, body.lines)
    return {"cancel": manager.remote_cancelled(rid), "exists": known}


@app.post("/worker/{rid}/done")
def worker_done(rid: str, body: WorkerDone, token: str = ""):
    _worker_auth(token)
    return {"ok": manager.remote_done(rid, body.state)}


@app.get("/worker/{rid}/rows")
def worker_rows(rid: str, token: str = ""):
    """Zip of the row files the user uploaded on the site, for the PC to pull."""
    _worker_auth(token)
    job = manager.remote_job(rid)
    if not job:
        return {"error": "unknown job"}
    return _zip_response(P.download_manifest(job.pid), f"{job.pid}_rows.zip")


@app.post("/worker/{rid}/result")
async def worker_result(rid: str, files: list[UploadFile] = File(...), token: str = ""):
    """PC uploads the generated report back so the DB step + download button work."""
    _worker_auth(token)
    job = manager.remote_job(rid)
    if not job:
        return {"error": "unknown job"}
    out_dir = C.MANAGEMENT_DIR / "OUTPUT"
    out_dir.mkdir(parents=True, exist_ok=True)
    saved = []
    for f in files:
        name = Path(f.filename).name
        with open(out_dir / name, "wb") as fh:
            shutil.copyfileobj(f.file, fh)
        saved.append(name)
    job.log(f"⬆ Report uploaded back to the server: {', '.join(saved)}")
    return {"saved": saved}


def _zip_response(paths: list[str], filename: str) -> StreamingResponse:
    """Stream the given files back as a zip archive."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        seen = set()
        for p in paths:
            if os.path.isfile(p):
                arc = os.path.basename(p)
                if arc in seen:
                    arc = f"{len(seen)}_{arc}"
                seen.add(arc)
                zf.write(p, arc)
    buf.seek(0)
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.get("/pipelines/{pid}/download-rows")
def download_rows(pid: str):
    """Zip the pipeline's current backend row files and return the archive."""
    if pid not in P.PIPELINES:
        return {"error": "unknown pipeline"}
    return _zip_response(P.download_manifest(pid), f"{pid}_row_files.zip")


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
    try:
        count = R.set_(pid, body.department, body.emails, body.mode)
        return {"saved": count, "recipients": R.all_(pid, body.mode)}
    except Exception as exc:  # noqa: BLE001
        return {"error": f"could not save {body.department}: {exc}"}
