"""Re-fetch listings that were stored without a phone number.

jiji answers a detail page 200 with the full advert but no contact block when
pages are requested too quickly. Nothing about the request looks wrong, so the
crawler happily stored thousands of adverts with no number — and a lead with no
number cannot be called, so those rows were worthless.

Re-fetching the same URL at a polite pace gets the number: measured on a random
15 of them, all 15 gave one up. This walks the stored no-phone rows and repairs
them.

The matching clean_leads row is deleted for anything repaired, because the
cleaner skips URLs it has already processed — without that the recovered phone
would sit in the raw table and never reach a callable lead.

  python -m scraper.recover_phones --source jiji_cars --limit 500
"""
from __future__ import annotations

import argparse
import time

from app import db

from . import sources as src
from .common import get, session


def recoverable(source: str = "", limit: int = 0,
                newest_first: bool = True) -> list[tuple[str, str]]:
    """(url, source) for stored listings whose text has no phone.

    Newest first by default. Older adverts are frequently gone — jiji answers a
    deleted listing with a 404 shell — so working backwards from the most
    recent crawl spends the requests where a number can still be recovered.
    """
    # The %% is not a typo: psycopg2 treats a bare % as a parameter marker, so
    # a LIKE pattern has to double it or the query blows up when params exist.
    sql = ("SELECT source_url, source FROM aism_raw_listings "
           "WHERE raw_data IS NOT NULL AND raw_data <> '' "
           "AND raw_data NOT LIKE '%%Phone:%%'")
    params: list = []
    if source:
        sql += " AND source = %s"
        params.append(source)
    sql += " ORDER BY id DESC" if newest_first else " ORDER BY id"
    if limit:
        sql += f" LIMIT {int(limit)}"
    conn = db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return [(a, b) for a, b in cur.fetchall()]
    finally:
        conn.close()


def run(source: str = "", limit: int = 0, delay: float = 2.5,
        log=print, should_stop=lambda: False, newest_first: bool = True) -> dict:
    todo = recoverable(source, limit, newest_first)
    if not todo:
        log("nothing to recover")
        return {"checked": 0, "recovered": 0, "still_missing": 0, "requeued": 0}

    log(f"re-fetching {len(todo)} listing(s) stored without a phone "
        f"(delay {delay}s)")
    sess = session()
    recovered, missing, checked, gone = 0, 0, 0, 0
    buffer: list[tuple[str, str]] = []
    fixed_urls: list[str] = []

    for i, (url, skey) in enumerate(todo, 1):
        if should_stop():
            log("  stop requested")
            break
        source_obj = src.get(skey)
        if not source_obj:
            continue
        checked += 1
        html = get(sess, url)
        if html is None:
            gone += 1          # 404 — the advert has been taken down
            missing += 1
            time.sleep(delay)
            continue
        raw = source_obj.extract(html)
        if raw and "Phone:" in raw:
            buffer.append((url, raw))
            fixed_urls.append(url)
            recovered += 1
        else:
            missing += 1
        if i % 50 == 0:
            log(f"  [{i}/{len(todo)}] recovered {recovered}, still missing {missing}")
        if len(buffer) >= 25:
            db.update_details(buffer)
            buffer = []
        time.sleep(delay)

    if buffer:
        db.update_details(buffer)

    # Drop the stale clean rows so the repaired listings get cleaned again.
    requeued = 0
    if fixed_urls:
        conn = db.connect()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM aism_clean_leads WHERE source_url = ANY(%s) "
                    "AND (phone_norm = '' OR phone_norm IS NULL)",
                    (fixed_urls,))
                requeued = cur.rowcount
        finally:
            conn.close()

    log(f"done: checked {checked}, recovered {recovered}, "
        f"still without a phone {missing} (of which {gone} adverts are gone), "
        f"requeued for cleaning {requeued}")
    return {"checked": checked, "recovered": recovered, "gone": gone,
            "still_missing": missing, "requeued": requeued}


def main() -> None:
    ap = argparse.ArgumentParser(description="Repair listings stored without a phone")
    ap.add_argument("--source", default="", help="source key (default: all)")
    ap.add_argument("--limit", type=int, default=0, help="cap listings this run")
    ap.add_argument("--delay", type=float, default=2.5, help="seconds between requests")
    a = ap.parse_args()
    run(source=a.source, limit=a.limit, delay=a.delay)


if __name__ == "__main__":
    main()
