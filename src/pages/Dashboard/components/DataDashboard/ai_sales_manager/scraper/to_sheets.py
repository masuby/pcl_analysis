"""Hand qualified leads to the call centre, and verify them on the way out.

The store holds every advert ever cleaned, at whatever judgement was current
when it was cleaned. This is the gate between that store and the two sheets the
call centre actually works, and it does not trust the store:

  1. Only Hot and Warm leads for LBF or SME are considered at all.
  2. Every candidate is RE-DERIVED, by the means its source allows. An advert
     is re-read from its own text and re-judged, and a row whose stored product
     or score no longer matches what the advert says is dropped — that is how a
     tractor marked "individual seller, phone present" by the old LLM pass was
     caught still sitting in the LBF pile. A Google Places listing has no text
     to re-read: it was built by code from Google's structured fields and no
     LLM ever touched it, so what is re-checked is that the stored facts still
     describe a business. See `_verify`.
  3. Anything from a phone that has advertised several vehicles is dropped as
     dealer stock, whoever scored it.
  4. One row per phone, best score first, so a person is offered once.
  5. The number must not already be on ANY tab of that product's sheet —
     August as well as September — so nobody is handed a number the call centre
     has already worked.
  6. A number that qualifies for both products goes to the better fit only.

Nothing is written without --confirm.

Usage (from ai_sales_manager/):
    python -m scraper.to_sheets                 # show what would be sent
    python -m scraper.to_sheets --confirm       # send it
    python -m scraper.to_sheets --product LBF --confirm
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date

from app import db
from app.append_batch import append_batch
from app.distribute import COLUMNS, sheet_id_for
from app.tools.sheets import _services

from .parse_kupatana import build_seller_index, parse_fields
from .qualify import classify

PRODUCTS = ("LBF", "SME")
RANK = {"Hot": 0, "Warm": 1, "Cold": 2}

# Where the call centre wants the most leads. Everything else follows in
# alphabetical order, so a list is still worked one town at a time rather than
# jumping around the country. The Dar municipalities are named individually
# because that is how a Places location arrives - "Ilala", not "Dar es Salaam".
PRIORITY_AREAS = ("Arusha", "Dar es Salaam", "Ilala", "Kinondoni", "Temeke",
                  "Ubungo", "Kigamboni")


def _area_key(lead: dict) -> tuple[int, str]:
    """Priority towns first, then the rest alphabetically."""
    where = (lead.get("location") or "").strip()
    first = 0 if any(where.lower() == a.lower() for a in PRIORITY_AREAS) else 1
    return (first, where.lower())


def phones_on_sheet(product: str, log=print) -> set[str]:
    """Every phone already on any tab of a product's workbook."""
    sid = sheet_id_for(product)
    if not sid:
        log(f"{product}: no sheet configured")
        return set()
    sheets, _ = _services()
    headers = [h for h, _ in COLUMNS]
    col = chr(ord("A") + headers.index("Phone Number"))
    meta = sheets.spreadsheets().get(spreadsheetId=sid).execute()
    held: set[str] = set()
    for sh in meta["sheets"]:
        tab = sh["properties"]["title"]
        vals = sheets.spreadsheets().values().get(
            spreadsheetId=sid, range=f"'{tab}'!{col}2:{col}").execute().get("values", [])
        held |= {db.normalize_phone(v[0]) for v in vals if v and db.normalize_phone(v[0])}
    log(f"{product}: {len(held)} phone(s) already on the sheet, all tabs")
    return held


# Re-deriving the verdict means something different for each source, and the
# difference is where the judgement came from in the first place.
#
#   kupatana / jiji   free text, judged by rules that have since changed (and
#                     before that, by an LLM that got it wrong 76% of the time).
#                     Never trusted: the advert is read again from scratch.
#   google_places     no free text ever existed. The lead was built by code from
#                     Google's own structured fields - name, phone, type, trading
#                     status - so there is no stale judgement to distrust. What
#                     is re-checked is that those facts still describe a business
#                     we can lend to.
#   facebook_paste    free text, and the post is kept, so it is re-read exactly
#                     as a classifieds advert is.
#
# The dealer check above this runs on every source regardless of any of that.

def _verify(r: dict, index) -> tuple[bool, str, str, str]:
    """(accepted, score, reason, why_dropped) for one candidate row."""
    source = (r["source"] or "")
    raw = r.get("raw_data") or ""

    if source.startswith("google_places"):
        if r["product"] != "SME":
            return False, "", "", f"a Places listing marked {r['product']}, not SME"
        if not (r.get("business_name") or r.get("offering") or r.get("location")):
            return False, "", "", "a Places listing with nothing left to identify it"
        # So an agent opening the sheet can see where the row came from without
        # having to follow the link.
        r["comments"] = r["reason"]
        return True, r["score"], r["reason"], ""

    if not raw:
        return False, "", "", f"no advert text kept for {source} - cannot be re-read"

    verdict, score, reason = classify(parse_fields(raw), index)
    if verdict != r["product"] or score == "Cold":
        return (False, "", "",
                f"re-read says {verdict}/{score}, row said {r['product']}/{r['score']}")
    return True, score, reason, ""


def candidates(log=print) -> dict[str, list[dict]]:
    """Verified, deduplicated leads per product, ready to send."""
    index = build_seller_index(log)

    conn = db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT c.product, c.score, c.phone, c.phone_norm, c.seller_name, "
                "       c.business_name, c.business_type, "
                "       c.location, c.price_text, c.reason, c.source_url, "
                "       c.date_obtained, c.source, c.offering, r.raw_data "
                "  FROM aism_clean_leads c "
                "  LEFT JOIN aism_raw_listings r ON r.source_url = c.source_url "
                " WHERE c.phone_norm <> '' AND c.product IN ('LBF','SME') "
                "   AND (c.score IN ('Hot','Warm') OR c.source = 'google_places')")
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        conn.close()
    log(f"{len(rows)} Hot/Warm lead rows in the store")

    dropped: Counter = Counter()
    verified = []
    for r in rows:
        phone = r["phone"] or r["phone_norm"]
        if index.is_vehicle_dealer(phone):
            dropped[f"dealer stock ({index.vehicle_count(phone)} vehicles from the number)"] += 1
            continue
        ok, score, reason, why = _verify(r, index)
        if not ok:
            dropped[why] += 1
            continue
        r["score"], r["reason"] = score, reason
        verified.append(r)

    log(f"{sum(dropped.values())} dropped at the gate:")
    for k, n in dropped.most_common(6):
        log(f"    {n:6}  {k}")
    log(f"{len(verified)} verified")

    best: dict[tuple[str, str], dict] = {}
    for r in verified:
        k = (r["product"], r["phone_norm"])
        if k not in best or RANK[r["score"]] < RANK[best[k]["score"]]:
            best[k] = r

    out: dict[str, list[dict]] = defaultdict(list)
    for (product, _norm), r in best.items():
        out[product].append(r)

    held = {p: phones_on_sheet(p, log) for p in PRODUCTS}
    final: dict[str, list[dict]] = {}
    seen_today: set[str] = set()
    for product in PRODUCTS:
        keep = []
        already = 0
        for r in sorted(out.get(product, []),
                        key=lambda x: (_area_key(x), RANK[x["score"]])):
            if r["phone_norm"] in held[product]:
                already += 1
                continue
            if r["phone_norm"] in seen_today:
                continue            # the better fit already took this person
            seen_today.add(r["phone_norm"])
            keep.append(r)
        final[product] = keep
        log(f"{product}: {len(keep)} new, {already} already on the sheet")
    return final


def main() -> None:
    ap = argparse.ArgumentParser(description="Send qualified leads to the call-centre sheets")
    ap.add_argument("--confirm", action="store_true", help="actually write")
    ap.add_argument("--product", default="", help="LBF | SME (default: both)")
    ap.add_argument("--label", default="", help="text for the divider band")
    ap.add_argument("--source", default="",
                    help="only leads whose source starts with this, e.g. google_places")
    ap.add_argument("--score", default="",
                    help="only these temperatures, e.g. Hot,Warm - so a batch of "
                         "reviewed listings can go in under a different divider "
                         "from the ones nobody has reviewed")
    a = ap.parse_args()

    ready = candidates()
    if a.source:
        ready = {p: [l for l in v if (l.get("source") or "").startswith(a.source)]
                 for p, v in ready.items()}
    if a.score:
        want = {w.strip().title() for w in a.score.split(",") if w.strip()}
        ready = {p: [l for l in v if l["score"] in want] for p, v in ready.items()}
    label = a.label or f"AI agent — {date.today():%d %b %Y}"
    for product in PRODUCTS:
        if a.product and product != a.product:
            continue
        leads = ready.get(product, [])
        if not leads:
            print(f"\n{product}: nothing new to send")
            continue
        print(f"\n{product}: {len(leads)} ready  {dict(Counter(l['score'] for l in leads))}")
        if not a.confirm:
            print("   dry run — pass --confirm to write")
            continue
        res = append_batch(product, leads, label=label)
        if not res.get("ok"):
            print(f"   FAILED: {res.get('error')}")
            continue
        print(f"   added {res['added']}, skipped {res['skipped']} already on the tab")
        print(f"   {res.get('url')}")


if __name__ == "__main__":
    main()
