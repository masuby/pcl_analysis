"""FastAPI entrypoint for the AI Sales Manager agent service.

Run:  uvicorn app.main:app --reload --port 8090   (from ai_sales_manager/)

Storage lives in a SQLite DB on this backend (app/data/leads.db). The scrape
pipeline runs as a background job so a full multi-page crawl doesn't block the
request; the UI starts it via POST /scrape and polls GET /scrape/status.
"""
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from . import db, distribute as distribution, export
from .config import settings
from .llm import budget, available_models, default_model
from .tools.sheets import service_account_email
from scraper import sources as source_registry

app = FastAPI(title="Digital Agent", version="0.3.0")
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
    max_listings: int = 0    # cap NEW listings per source this run (0 = all)
    max_pages: int = 0       # cap index pages to crawl (0 = all)
    model: str = ""          # LLM id used for the cleaning step
    product: str = ""        # 'LBF' | 'SME' | '' for every source
    sources: list[str] = []  # explicit source keys; overrides product


@app.get("/")
def root():
    return {
        "service": "Digital Agent",
        "products": {
            "LBF": "people who own a car (loan secured on the car)",
            "SME": "people who run a business (working capital)",
        },
        "sources": len(source_registry.SOURCES),
    }


@app.get("/sources")
def sources(product: str = ""):
    """Catalogue of places the agent looks, with the robots.txt basis for each."""
    all_sources = source_registry.summary()
    if product:
        all_sources = [s for s in all_sources if s["product"] == product.upper()]
    return {"sources": all_sources}


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
def leads(limit: int = 0, product: str = "", source: str = ""):
    """AI-cleaned leads (newest first), optionally narrowed to a product/source."""
    if product or source:
        rows = db.all_clean_filtered(product=product.upper(), source=source, limit=limit)
    else:
        rows = db.all_clean(limit=limit)
    return {"leads": rows, "total": db.count_clean(), "by_product": db.stats_by_product()}


@app.get("/export.xlsx")
def export_xlsx(product: str = ""):
    """Download the acquired leads as an Excel workbook.

    Same tabs and columns as the Google Sheet, so the file an analyst downloads
    from the dashboard matches what they see in the sheet.
    """
    data = export.build_workbook(product)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{export.filename(product)}"'},
    )


@app.post("/distribute")
def distribute(month: str = ""):
    """Push unique leads into the per-product call-centre workbooks.

    Incremental: a phone already in the month's tab is skipped, so re-running
    never duplicates a lead or overwrites feedback already typed in.
    """
    try:
        return distribution.distribute(month=month, log=lambda m: None)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc),
                "service_account_email": service_account_email()}


@app.post("/publish")
def publish():
    """(Re)write the Google Sheet tabs from whatever is currently in the DB."""
    from scraper.upload_to_sheet import publish as publish_sheet
    try:
        return {"ok": True, **publish_sheet(log=lambda m: None)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@app.post("/distribution-status/mark")
def distribution_status_mark(month: str = "", dry_run: bool = False):
    """Mark leads DISTRIBUTED or NEVER DISTRIBUTED from what is in the sheets.

    The sheets are the source of truth: a lead counts as distributed because its
    phone is currently in a month's tab, not because a past run said it added
    it. Idempotent — a lead deleted from a sheet reverts to never distributed.
    """
    from . import distribution_status
    try:
        return distribution_status.mark(month=month, dry_run=dry_run)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@app.get("/distribution-status")
def distribution_status_counts():
    """How many leads have been distributed and how many never have.

    Reported as PEOPLE as well as rows — there are several listings per seller,
    so the row count overstates how many humans are involved.
    """
    with db.connect() as conn, conn.cursor() as cur:
        cur.execute("""SELECT distribution_status, COUNT(*), COUNT(DISTINCT phone_norm)
                         FROM aism_clean_leads GROUP BY 1 ORDER BY 1""")
        rows = [{"status": a, "leads": b, "people": c} for a, b, c in cur.fetchall()]
        cur.execute("""SELECT product, distribution_status,
                              COUNT(*), COUNT(DISTINCT phone_norm)
                         FROM aism_clean_leads GROUP BY 1,2 ORDER BY 1,2""")
        by_product = [{"product": a, "status": b, "leads": c, "people": d}
                      for a, b, c, d in cur.fetchall()]
    return {"ok": True, "breakdown": rows, "byProduct": by_product}


@app.get("/callback-report")
def callback_report(month: str = "", products: str = ""):
    """What the call centre did with the leads we distributed.

    Reads the LBF and SME working sheets back and reports how far each month's
    list got — worked, reached, interested, converted — per agent and per
    location. Read-only: it never writes to the sheets.
    """
    from . import callback_report as report
    want = [p.strip().upper() for p in products.split(",") if p.strip()] or None
    try:
        return report.build_report(month=month, products=want)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc),
                "service_account_email": service_account_email()}


@app.get("/callback-report.xlsx")
def callback_report_xlsx(month: str = "", products: str = "", scope: str = "full"):
    """The report as a workbook.

    scope=full      the figures plus every lead row, the call-back list, what is
                    still unworked, and the conversion checks
    scope=summary   the figures only
    scope=callback  only the rows somebody still has to act on
    """
    from . import callback_report as report
    want = [p.strip().upper() for p in products.split(",") if p.strip()] or None
    data = report.build_workbook(month=month, products=want, scope=scope)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition":
                 f'attachment; filename="{report.filename(month, scope)}"'},
    )


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


def _run_job(max_listings: int, max_pages: int, model: str,
             product: str, sources_sel: list[str]):
    from scraper.run_pipeline import run
    try:
        summary = run(max_listings=max_listings, max_pages=max_pages, delay=1.5,
                      model=model, do_upload=True, log=_job_log,
                      should_stop=_CANCEL.is_set,
                      product=product, sources=sources_sel)
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
    product = (req.product or "").upper()
    threading.Thread(
        target=_run_job,
        args=(max(0, min(5000, req.max_listings)), max(0, min(1000, req.max_pages)),
              model, product, list(req.sources or [])),
        daemon=True,
    ).start()
    return {"state": "running", "product": product or "ALL",
            "sources": req.sources or [s.key for s in source_registry.for_product(product)]}


# ── pasted Marketplace / group posts ─────────────────────────────────────────
#
# Meta publishes no API for Marketplace or for public group posts, and scraping
# either breaches their terms, so capture is deliberately manual at the reading
# end: an agent who is already in the group copies a post and pastes it here.
# Everything after that is automatic — the number, the price, the place, and the
# same dealer-and-prospect judgement the crawled sources go through.

class PasteRequest(BaseModel):
    text: str = ""
    product: str = ""        # 'LBF' | 'SME' | '' to accept either
    group: str = ""          # which group or page the posts came from
    captured_by: str = ""    # who pasted them


def _paste_view(f: dict) -> dict:
    """Only the fields the screen shows — the raw post is not sent back."""
    return {
        "phone": f.get("phone", ""),
        "title": f.get("title", ""),
        "location": f.get("location", ""),
        "price_tzs": f.get("price_tzs", 0),
        "product": f.get("verdict", ""),
        "score": f.get("score", ""),
        # `why` is the reason a lead was TURNED AWAY and must win over `reason`,
        # which is only the verdict's own wording. Showing the verdict on a
        # rejected row read as though a good SME lead had been refused for
        # "trade wording".
        "reason": f.get("why") or f.get("reason", ""),
        "source_url": f.get("source_url", ""),
        "seller_name": f.get("seller_name", ""),
    }


@app.post("/paste/preview")
def paste_preview(req: PasteRequest):
    """Read a paste and say what it holds. Writes nothing."""
    from scraper.paste_capture import capture
    res = capture(req.text or "", req.product, req.captured_by, req.group,
                  log=lambda *a: None)
    return {
        "posts": res["posts"],
        "new": [_paste_view(f) for f in res["new"]],
        "duplicates": [_paste_view(f) for f in res["duplicates"]],
        "rejected": [_paste_view(f) for f in res["rejected"]],
        "no_phone": [{"title": f.get("title", "")} for f in res["no_phone"]],
    }


@app.post("/paste/save")
def paste_save(req: PasteRequest):
    """Re-read the paste and store what qualifies.

    The paste is parsed again rather than trusting anything the browser sends
    back, so nothing can be edited into the store on its way through.
    """
    from scraper.paste_capture import capture, invalidate_index, to_lead
    res = capture(req.text or "", req.product, req.captured_by, req.group,
                  log=lambda *a: None)
    saved = 0
    if res["new"]:
        saved = db.insert_clean_many([to_lead(f) for f in res["new"]])
        # So the next paste already knows about the seller just captured.
        invalidate_index()
    return {"saved": saved, "skipped": len(res["duplicates"]),
            "rejected": len(res["rejected"]),
            "new": [_paste_view(f) for f in res["new"]]}


# -- Google business listings (Places API) ------------------------------------
#
# A Maps listing's phone number is the line the owner published to be called on,
# which is why this sits alongside the classifieds and not with the social
# sources we will not touch. It runs as its own background job rather than
# inside /scrape: it costs real money per request, so it is started
# deliberately, bounded by --max-requests, and never as a side effect of a crawl.

class PlacesRequest(BaseModel):
    towns: list[str] = []        # default: every PCL branch town
    categories: list[str] = []   # default: the small-business trades
    max_requests: int = 300      # billing guard; the UI always sends one
    dry_run: bool = False


_PLACES_JOB = {"state": "idle", "log": [], "summary": None}
_PLACES_LOCK = threading.Lock()
_PLACES_CANCEL = threading.Event()


def _places_log(msg: str):
    with _PLACES_LOCK:
        _PLACES_JOB["log"].append(str(msg))
        if len(_PLACES_JOB["log"]) > _LOG_CAP:
            del _PLACES_JOB["log"][: len(_PLACES_JOB["log"]) - _LOG_CAP]


def _run_places_job(towns, categories, max_requests, dry_run):
    from scraper import places
    try:
        summary = places.run(towns, categories, max_requests=max_requests,
                             dry_run=dry_run, log=_places_log,
                             should_stop=_PLACES_CANCEL.is_set)
        with _PLACES_LOCK:
            _PLACES_JOB["summary"] = summary
            _PLACES_JOB["state"] = "cancelled" if summary.get("cancelled") else "done"
    except SystemExit as exc:        # preflight refused, before any spend
        _places_log(f"ERROR: {exc}")
        with _PLACES_LOCK:
            _PLACES_JOB["state"] = "error"
    except Exception as exc:  # noqa: BLE001
        _places_log(f"ERROR: {exc}")
        with _PLACES_LOCK:
            _PLACES_JOB["state"] = "error"


@app.get("/places/check")
def places_check():
    """Can the key read business phone numbers? Names the exact thing to fix."""
    from scraper import places
    return places.preflight()


@app.get("/places/plan")
def places_plan(towns: str = "", categories: str = "", max_requests: int = 300):
    """The grid and the bill for a sweep of this shape, before it is started."""
    from scraper import places
    t = [x.strip() for x in towns.split(";") if x.strip()] or places.TOWNS
    c = [x.strip() for x in categories.split(";") if x.strip()] or places.CATEGORIES
    return {"towns": len(t), "categories": len(c),
            "usd_per_1000": places.USD_PER_1000,
            **places.estimate(len(t) * len(c), max_requests)}


@app.post("/places/run")
def places_run(req: PlacesRequest):
    """Start a Places sweep in the background. Poll /places/status."""
    from scraper import places
    with _PLACES_LOCK:
        if _PLACES_JOB["state"] == "running":
            return {"state": "running", "detail": "a sweep is already running"}
        _PLACES_JOB.update(state="running", log=[], summary=None)
    _PLACES_CANCEL.clear()
    towns = [t.strip() for t in (req.towns or []) if t.strip()] or places.TOWNS
    cats = [c.strip() for c in (req.categories or []) if c.strip()] or places.CATEGORIES
    # Clamped, not trusted: a typo in the box must not become a five-figure bill.
    max_requests = max(1, min(5000, req.max_requests or 300))
    threading.Thread(target=_run_places_job,
                     args=(towns, cats, max_requests, bool(req.dry_run)),
                     daemon=True).start()
    return {"state": "running", "towns": len(towns), "categories": len(cats),
            **places.estimate(len(towns) * len(cats), max_requests)}


@app.post("/places/stop")
def places_stop():
    with _PLACES_LOCK:
        running = _PLACES_JOB["state"] == "running"
    if running:
        _PLACES_CANCEL.set()
        _places_log("STOP requested - finishing the current query...")
        return {"state": "stopping"}
    return {"state": _PLACES_JOB["state"], "detail": "no sweep running"}


@app.get("/places/status")
def places_status():
    with _PLACES_LOCK:
        return {"state": _PLACES_JOB["state"], "log": list(_PLACES_JOB["log"]),
                "summary": _PLACES_JOB["summary"]}


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
