"""Step 1 — crawl any registered source and store UNIQUE listings in the DB.

This replaces the cartanzania-only crawler. The logic is identical for every
site; what differs (index URL, listing pattern, detail extraction) lives in
scraper/sources.py.

The link is the dedup key: aism_raw_listings.source_url is UNIQUE, so links we
already hold are dropped. Links are saved on discovery and the detail text is
filled in afterwards, so an interrupted crawl resumes where it stopped.

Usage (from ai_sales_manager/):
  python -m scraper.crawl --source jiji_cars --max-listings 100
  python -m scraper.crawl --product SME --max-pages 5
"""
from __future__ import annotations

import argparse
import time

from app import db

from . import sources as src
from .common import get, session, today_str

PAGE_CAP = 1000   # safety bound when crawling "all" pages


def collect_links(sess, source: src.Source, max_pages: int, delay: float, log=print,
                  known: set[str] | None = None, need_new: int = 0,
                  should_stop=lambda: False) -> list[str]:
    """Walk index pages collecting unique listing links, order preserved."""
    known = known or set()
    cap = max_pages if max_pages and max_pages > 0 else PAGE_CAP
    seen, links, new_count = set(), [], 0

    for page in range(1, cap + 1):
        if should_stop():
            log("  stop requested - halting crawl")
            break
        html = get(sess, source.index_url(page))
        if not html:
            log(f"  [page {page}] no content - stopping")
            break
        found = source.listing_re.findall(html)
        if not found:
            log(f"  [page {page}] no listings - end of catalogue")
            break

        added = 0
        for path in found:
            full = path if path.startswith("http") else source.base + path
            if full in seen:
                continue
            seen.add(full)
            links.append(full)
            added += 1
            if full not in known:
                new_count += 1

        if page % 10 == 0 or added:
            log(f"  [page {page}] +{added} links ({len(links)} total, {new_count} new)")
        if need_new and new_count >= need_new:
            log(f"  collected {new_count} new links - enough for this run")
            break
        time.sleep(delay)
    return links


def crawl_source(source: src.Source, max_listings: int = 0, max_pages: int = 0,
                 delay: float = 0.6, log=print, should_stop=lambda: False) -> dict:
    """Discover + detail-scrape one source."""
    sess = session()
    known = db.known_urls(source.key)
    log(f"[{source.key}] {len(known)} known links; crawling index...")

    all_links = collect_links(sess, source, max_pages, delay, log,
                              known=known, need_new=max_listings,
                              should_stop=should_stop)
    new_links = [u for u in all_links if u not in known]
    saved = db.insert_links(new_links, today_str(), source.product, source.key)
    log(f"[{source.key}] found {len(all_links)} links, saved {saved} new")

    pending = db.pending_detail(
        limit=max_listings if max_listings and max_listings > 0 else 0,
        source=source.key)
    log(f"[{source.key}] scraping detail for {len(pending)} listings...")

    buffer: list[tuple[str, str]] = []
    done = 0
    no_phone = 0
    for i, url in enumerate(pending, 1):
        if should_stop():
            log("  stop requested - flushing progress and halting")
            break
        html = get(sess, url)
        if html:
            raw = source.extract(html)
            if raw and len(raw) > 40:
                buffer.append((url, raw))
                if "Phone:" not in raw:
                    no_phone += 1
                log(f"  [{i}/{len(pending)}] ok ({len(raw)} chars)")
            else:
                log(f"  [{i}/{len(pending)}] empty block")
        else:
            log(f"  [{i}/{len(pending)}] SKIP (no content)")
        if len(buffer) >= 25:
            done += db.update_details(buffer)
            buffer = []
        time.sleep(delay)
    done += db.update_details(buffer)

    if done and no_phone:
        # Worth stating plainly: on some sites most sellers hide their number
        # behind a "show contact" click, which this crawler does not defeat.
        log(f"[{source.key}] note: {no_phone}/{done} detail pages had no visible phone")

    return {"source": source.key, "product": source.product,
            "new_links": saved, "new_raw": done, "links_found": len(all_links),
            "no_phone": no_phone}


def crawl(product: str = "", source_keys: list[str] | None = None,
          max_listings: int = 0, max_pages: int = 0, delay: float = 0.6,
          log=print, should_stop=lambda: False) -> dict:
    """Crawl every selected source (all sources for a product when unspecified)."""
    if source_keys:
        chosen = [s for s in (src.get(k) for k in source_keys) if s]
    else:
        chosen = src.for_product(product)
    if not chosen:
        log("no matching sources")
        return {"sources": [], "new_raw": 0, "new_links": 0}

    log(f"crawling {len(chosen)} source(s): {', '.join(s.key for s in chosen)}")
    results = []
    for source in chosen:
        if should_stop():
            break
        try:
            results.append(crawl_source(source, max_listings, max_pages, delay,
                                        log, should_stop))
        except Exception as exc:  # noqa: BLE001
            log(f"[{source.key}] ERROR: {exc}")
            results.append({"source": source.key, "error": str(exc)})

    return {
        "sources": results,
        "new_links": sum(r.get("new_links", 0) for r in results),
        "new_raw": sum(r.get("new_raw", 0) for r in results),
        "total_raw": db.count_raw(),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Crawl registered sources -> DB")
    ap.add_argument("--product", default="", help="LBF | SME (default: all)")
    ap.add_argument("--source", action="append", default=[], help="source key (repeatable)")
    ap.add_argument("--max-listings", type=int, default=0, help="cap NEW listings per source")
    ap.add_argument("--max-pages", type=int, default=0, help="cap index pages per source")
    ap.add_argument("--delay", type=float, default=0.6, help="seconds between requests")
    ap.add_argument("--list", action="store_true", help="list sources and exit")
    args = ap.parse_args()

    if args.list:
        for s in src.summary():
            print(f"{s['key']:34} {s['product']:4} {s['label']}")
        return

    db.migrate()
    crawl(args.product, args.source, args.max_listings, args.max_pages, args.delay)


if __name__ == "__main__":
    main()
