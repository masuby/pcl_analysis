"""One-shot LBF pipeline (DB-backed): crawl -> AI clean -> upload to sheet.

Callable from the API (app.main) via run(), or from the CLI.

Usage (from ai_sales_manager/):
  python -m scraper.run_pipeline                       # all pages, all new links
  python -m scraper.run_pipeline --max-listings 100
  python -m scraper.run_pipeline --no-upload
"""
from __future__ import annotations

import argparse

from app import db
from .scrape_cartanzania import scrape
from .clean_with_ai import clean
from .upload_to_sheet import upload, upload_unique


def run(max_listings: int = 0, max_pages: int = 0, delay: float = 0.6,
        model: str | None = None, do_upload: bool = True, log=print,
        should_stop=lambda: False) -> dict:
    """Run the full pipeline and return a summary the UI can render."""
    db.migrate()

    log("=== Step 1/3: crawl + store unique links ===")
    s1 = scrape(max_listings=max_listings, max_pages=max_pages, delay=delay, log=log,
                should_stop=should_stop)

    if should_stop():
        log("cancelled after crawl")
        return {**s1, "cleaned_new": 0, "new_data": 0, "existing_data": 0,
                "total_cleaned": db.count_clean(), "leads": [], "sheet_url": None,
                "unique_total": db.count_unique(), "cancelled": True}

    log("=== Step 2/3: AI clean (unique/new only) ===")
    s2 = clean(model=model, log=log, should_stop=should_stop)

    summary = {
        "new_raw": s1["new_raw"], "total_raw": s1["total_raw"],
        "links_found": s1["links_found"], "new_links": s1["new_links"],
        "cleaned_new": s2["cleaned_new"], "new_data": s2["new_data"],
        "existing_data": s2["existing_data"], "total_cleaned": s2["total_cleaned"],
        "leads": s2["new_leads"], "sheet_url": None,
        "unique_total": db.count_unique(),
    }

    summary["cancelled"] = bool(should_stop())
    if summary["cancelled"]:
        log("cancelled after clean - skipping upload")
        return summary

    if do_upload and s2["total_cleaned"] > 0:
        log("=== Step 3/3: upload to Google Sheet ===")
        try:
            summary["sheet_url"] = upload(log=log)
            summary["unique_total"] = upload_unique(log=log)
        except Exception as exc:  # noqa: BLE001
            log(f"upload failed: {exc}")
    else:
        log("upload skipped")

    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description="Crawl -> clean -> upload (cartanzania LBF, DB)")
    ap.add_argument("--max-listings", type=int, default=0, help="cap NEW listings (0 = all)")
    ap.add_argument("--max-pages", type=int, default=0, help="cap index pages (0 = all)")
    ap.add_argument("--delay", type=float, default=0.6)
    ap.add_argument("--model", default=None)
    ap.add_argument("--no-upload", action="store_true", help="skip the Google Sheet upload")
    args = ap.parse_args()
    run(max_listings=args.max_listings, max_pages=args.max_pages, delay=args.delay,
        model=args.model, do_upload=not args.no_upload)
    print("\nPipeline complete.")


if __name__ == "__main__":
    main()
