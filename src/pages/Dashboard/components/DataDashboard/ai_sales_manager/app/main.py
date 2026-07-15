"""FastAPI entrypoint for the AI Sales Manager agent service.

Run:  uvicorn app.main:app --reload --port 8090   (from ai_sales_manager/)

Storage lives in a SQLite DB on this backend (app/data/leads.db). The scrape
pipeline runs as a background job so a full multi-page crawl doesn't block the
request; the UI starts it via POST /scrape and polls GET /scrape/status.
"""
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import db
from .config import settings
from .llm import budget, available_models, default_model
from .tools.sheets import service_account_email

app = FastAPI(title="AI Sales Manager", version="0.2.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    try:
        db.migrate()
    except Exception as exc:  # noqa: BLE001
        print(f"[startup] DB migrate failed (is Postgres up?): {exc}")


class ScrapeRequest(BaseModel):
    max_listings: int = 0    # cap NEW listings this run (0 = all)
    max_pages: int = 0       # cap index pages to crawl (0 = all)
    model: str = ""          # LLM id used for the cleaning step


@app.get("/")
def root():
    return {"service": "AI Sales Manager", "phase": 1, "focus": "LBF (car owners)"}


@app.get("/health")
def health():
    try:
        db_info = {"engine": "postgresql", **settings.db_summary(),
                   **db.stats(), **db.migrations_status()}
    except Exception as exc:  # noqa: BLE001
        db_info = {"engine": "postgresql", **settings.db_summary(), "error": str(exc)}
    return {
        "ok": True,
        "providers": settings.provider_summary(),
        "budget": budget.status(),
        "env": settings.env_path,
        "service_account_email": service_account_email(),
        "leads_sheet_id": settings.leads_sheet_id,
        "db": db_info,
    }


@app.get("/models")
def models():
    return {"models": available_models(), "default": default_model()}


@app.post("/migrate")
def migrate():
    """Apply any pending SQL migrations and return the DB status."""
    applied = db.migrate()
    return {"applied_now": applied, **db.migrations_status(), "stats": db.stats()}


@app.get("/leads")
def leads(limit: int = 0):
    """Every AI-cleaned lead (newest first) for the dashboard."""
    rows = db.all_clean(limit=limit)
    return {"leads": rows, "total": db.count_clean()}


@app.get("/unique")
def unique(limit: int = 0):
    """One lead per unique phone number (people to call)."""
    rows = db.unique_clean(limit=limit)
    return {"leads": rows, "total": db.count_unique()}


# ── background scrape job (cancellable) ──────────────────────────────────────
_JOB = {"state": "idle", "log": [], "summary": None}
_JOB_LOCK = threading.Lock()
_CANCEL = threading.Event()
_LOG_CAP = 400   # keep the tail bounded for long crawls


def _job_log(msg: str):
    with _JOB_LOCK:
        _JOB["log"].append(str(msg))
        if len(_JOB["log"]) > _LOG_CAP:
            del _JOB["log"][: len(_JOB["log"]) - _LOG_CAP]


def _run_job(max_listings: int, max_pages: int, model: str):
    from scraper.run_pipeline import run
    try:
        summary = run(max_listings=max_listings, max_pages=max_pages, delay=0.6,
                      model=model, do_upload=True, log=_job_log,
                      should_stop=_CANCEL.is_set)
        summary["budget"] = budget.status()
        summary["model"] = model
        with _JOB_LOCK:
            _JOB["summary"] = summary
            _JOB["state"] = "cancelled" if summary.get("cancelled") else "done"
    except Exception as exc:  # noqa: BLE001
        _job_log(f"ERROR: {exc}")
        with _JOB_LOCK:
            _JOB["state"] = "error"


@app.post("/scrape")
def scrape(req: ScrapeRequest):
    """Start the crawl->clean->upload pipeline in the background. Poll /scrape/status."""
    with _JOB_LOCK:
        if _JOB["state"] == "running":
            return {"state": "running", "detail": "a job is already running"}
        _JOB.update(state="running", log=[], summary=None)
    _CANCEL.clear()
    model = req.model or (default_model() or "")
    threading.Thread(
        target=_run_job,
        args=(max(0, min(5000, req.max_listings)), max(0, min(1000, req.max_pages)), model),
        daemon=True,
    ).start()
    return {"state": "running"}


@app.post("/scrape/stop")
def scrape_stop():
    """Signal the running job to stop at the next safe point (progress is kept)."""
    with _JOB_LOCK:
        running = _JOB["state"] == "running"
    if running:
        _CANCEL.set()
        _job_log("STOP requested by user - finishing current item...")
        return {"state": "stopping"}
    return {"state": _JOB["state"], "detail": "no job running"}


@app.get("/scrape/status")
def scrape_status():
    try:
        stats = db.stats()
    except Exception:  # noqa: BLE001
        stats = {}
    with _JOB_LOCK:
        return {"state": _JOB["state"], "log": list(_JOB["log"]),
                "summary": _JOB["summary"], "stats": stats}
