"""Step 1 - crawl cartanzania.com and store UNIQUE listings in the database.

Discovery iterates the paginated index (/buy-cars?page=1,2,3...) across all
pages, collecting every listing link. Links already in the DB are dropped
(source_url is UNIQUE); only NEW links get their detail page scraped and their
raw "About ... Price" block saved to raw_listings. The AI step then processes
only these new/unique rows.

Usage (from ai_sales_manager/):
  python -m scraper.scrape_cartanzania                 # all pages, all new links
  python -m scraper.scrape_cartanzania --max-listings 100 --max-pages 20
"""
from __future__ import annotations

import argparse
import re
import time

from bs4 import BeautifulSoup

from app import db
from .common import BASE, get, session, today_str

LISTING_RE = re.compile(r"/en/vehicle_listings/ad-[a-z0-9-]+", re.I)
PAGE_CAP = 1000   # safety cap when crawling "all" pages
_STOP_MARKERS = ("Show more", "Show all ads", "Need to sell your car",
                 "Write message", "Share ad with")


def collect_all_links(sess, max_pages: int, delay: float, log=print,
                      known: set[str] | None = None, need_new: int = 0,
                      should_stop=lambda: False) -> list[str]:
    """Walk index pages collecting every unique listing link (order preserved).
    max_pages <= 0 means crawl until an empty page (bounded by PAGE_CAP). When
    need_new > 0, stop early once that many links not in `known` are found."""
    known = known or set()
    cap = max_pages if max_pages and max_pages > 0 else PAGE_CAP
    seen, links, new_count = set(), [], 0
    for page in range(1, cap + 1):
        if should_stop():
            log("  stop requested - halting crawl")
            break
        html = get(sess, f"{BASE}/buy-cars?page={page}")
        if not html:
            log(f"  [page {page}] no content - stopping")
            break
        found = LISTING_RE.findall(html)
        if not found:
            log(f"  [page {page}] no listings - end of catalogue")
            break
        added = 0
        for path in found:
            full = BASE + path
            if full not in seen:
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


def _title(soup: BeautifulSoup) -> str:
    og = soup.find("meta", {"property": "og:title"})
    if og and og.get("content"):
        return og["content"].strip()
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    return ""


def extract_raw(html: str) -> str:
    """Return the raw 'About ... Price' block + phone as one text blob."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()

    phone = ""
    tel = re.search(r"tel:\+?([\d\s]{7,})", html)
    if tel:
        phone = "+" + re.sub(r"\s+", "", tel.group(1))

    body = soup.find("main") or soup.body or soup
    text = body.get_text("\n", strip=True)
    lines = [l for l in text.split("\n") if l.strip()]
    joined = "\n".join(lines)

    start = joined.find("About")
    block = joined[start:] if start >= 0 else joined
    cut = len(block)
    for m in _STOP_MARKERS:
        idx = block.find(m)
        if 0 <= idx < cut:
            cut = idx
    block = block[:cut].strip()

    header = _title(soup)
    parts = []
    if header:
        parts.append(f"Title: {header}")
    if phone:
        parts.append(f"Phone: {phone}")
    parts.append(block)
    return "\n".join(parts).strip()


def scrape(max_listings: int = 0, max_pages: int = 0, delay: float = 0.6, log=print,
          should_stop=lambda: False) -> dict:
    """Crawl the index and SAVE every new link to the DB immediately, then fill
    in the detail text for links still missing it. max_listings <= 0 = all."""
    sess = session()
    known = db.known_urls()
    log(f"DB has {len(known)} known links; crawling index for new links...")

    # 1) collect links and PERSIST the unique-new ones straight away
    all_links = collect_all_links(sess, max_pages, delay, log,
                                  known=known, need_new=max_listings,
                                  should_stop=should_stop)
    new_links = [u for u in all_links if u not in known]
    saved_links = db.insert_links(new_links, today_str())
    log(f"found {len(all_links)} links, saved {saved_links} new links to DB")

    # 2) scrape detail for links that still have no raw_data (resumable)
    pending = db.pending_detail(limit=max_listings if max_listings and max_listings > 0 else 0)
    log(f"scraping detail for {len(pending)} listings...")

    buffer: list[tuple[str, str]] = []
    done = 0
    for i, url in enumerate(pending, 1):
        if should_stop():
            log("  stop requested - flushing progress and halting")
            break
        html = get(sess, url)
        if html:
            raw = extract_raw(html)
            if raw and "About" in raw:
                buffer.append((url, raw))
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

    log(f"links: {db.count_raw()} total, {db.count_detailed()} detailed (+{done} this run)")
    return {"new_raw": done, "new_links": saved_links,
            "total_raw": db.count_raw(), "links_found": len(all_links)}


def main() -> None:
    ap = argparse.ArgumentParser(description="Crawl cartanzania.com -> DB (unique links)")
    ap.add_argument("--max-listings", type=int, default=0, help="cap NEW listings (0 = all)")
    ap.add_argument("--max-pages", type=int, default=0, help="cap index pages (0 = all)")
    ap.add_argument("--delay", type=float, default=0.6, help="seconds between requests")
    args = ap.parse_args()
    db.migrate()
    scrape(args.max_listings, args.max_pages, args.delay)


if __name__ == "__main__":
    main()
