"""One-shot Digital Agent pipeline: crawl -> AI clean -> upload to sheet.

Works for both products. `product` selects which sources run:
  LBF — car listings (people who own a car)
  SME — commercial classifieds (people who run a business)
  ''  — every enabled source

Callable from the API (app.main) via run(), or from the CLI.

Usage (from ai_sales_manager/):
  python -m scraper.run_pipeline --product SME --max-listings 50
  python -m scraper.run_pipeline --source jiji_cars --no-upload
"""
from __future__ import annotations

import argparse

from app import db

from .clean_with_ai import clean
from .crawl import crawl
from .upload_to_sheet import upload, upload_unique


def run(max_listings: int = 0, max_pages: int = 0, delay: float = 0.6,
        model: str | None = None, do_upload: bool = True, log=print,
        should_stop=lambda: False, product: str = "",
        sources: list[str] | None = None) -> dict:
    """Run the full pipeline and return a summary the UI can render."""
    db.migrate()

    label = product or "all products"
    log(f"=== Step 1/3: crawl + store unique links ({label}) ===")
    s1 = crawl(product=product, source_keys=sources, max_listings=max_listings,
               max_pages=max_pages, delay=delay, log=log, should_stop=should_stop)

    if should_stop():
        log("cancelled after crawl")
        return {**s1, "cleaned_new": 0, "new_data": 0, "existing_data": 0,
                "total_cleaned": db.count_clean(), "leads": [], "sheet_url": None,
                "unique_total": db.count_unique(), "cancelled": True,
                "product": product}

    log("=== Step 2/3: AI clean (unique/new only) ===")
    s2 = clean(model=model, product=product, log=log, should_stop=should_stop)

    summary = {
        "product": product or "ALL",
        "sources": s1.get("sources", []),
        "new_raw": s1["new_raw"], "total_raw": s1.get("total_raw", 0),
        "new_links": s1["new_links"],
        "cleaned_new": s2["cleaned_new"], "new_data": s2["new_data"],
        "existing_data": s2["existing_data"], "no_phone": s2.get("no_phone", 0),
        "total_cleaned": s2["total_cleaned"],
        "leads": s2["new_leads"], "sheet_url": None,
        "unique_total": db.count_unique(),
        "by_product": db.stats_by_product(),
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
    ap = argparse.ArgumentParser(description="Crawl -> clean -> upload (Digital Agent)")
    ap.add_argument("--product", default="", help="LBF | SME (default: all)")
    ap.add_argument("--source", action="append", default=[], help="source key (repeatable)")
    ap.add_argument("--max-listings", type=int, default=0, help="cap NEW listings per source")
    ap.add_argument("--max-pages", type=int, default=0, help="cap index pages per source")
    ap.add_argument("--delay", type=float, default=0.6)
    ap.add_argument("--model", default=None)
    ap.add_argument("--no-upload", action="store_true", help="skip the Google Sheet upload")
    args = ap.parse_args()
    run(max_listings=args.max_listings, max_pages=args.max_pages, delay=args.delay,
        model=args.model, do_upload=not args.no_upload,
        product=args.product, sources=args.source)
    print("\nPipeline complete.")


if __name__ == "__main__":
    main()
