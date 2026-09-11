"""Deterministic cleaner for Kupatana listings — no LLM, no rate limit.

Every Kupatana advert is rendered from one template, and the extractor in
sources.py keeps that structure intact:

    Title: <title>| Kupatana.com
    Price: TZS <first group of the price>
    Phone: 255XXXXXXXXX
    About
    <description>
    en … Login / Register … Categories
    <top category>
    <sub category>
    <DD.MM.YYYY>                 <- posting date
    <location>
    <title again>
    TZS <full price>
    [Details … key/value pairs …]
    <seller name>
    Member since
    <year>
    …
    Verified | Not verified

So what the LLM step was doing on these rows is not judgement, it is reading
labelled fields — and a parser reads them exactly, for free, the same way every
time. Measured against the LLM's own output on the same adverts, this recovers
the price on rows the model left blank (the model saw only the truncated
`Price: TZS 40` line and gave up) and never invents a phone number.

What the parser cannot do is the part that IS judgement: whether the seller is
a business or somebody clearing out a shelf, a dealer or a car's owner. That
lives in qualify.py, whose rules were derived by having 300 real adverts read
and scored, not guessed at.

Usage (from ai_sales_manager/):
    python -m scraper.parse_kupatana --dry-run --limit 20
    python -m scraper.parse_kupatana --product SME
"""
from __future__ import annotations

import argparse
import re
from datetime import date

from app import db
from app.db import normalize_phone

from .qualify import SellerIndex, classify, is_vehicle, name_is_business

SOURCE_PREFIX = "kupatana"

# ── page furniture: lines that are chrome, never content ──────────────────────
_CHROME = {
    "en", "sw", "Login / Register", "Sell", "Location", "Search", "Categories",
    "Call", "Send", "Chat with", "User", "Safety guidelines", "Privacy Policy",
    "Terms of use", "How to buy on Kupatana", "Member since", "Verified",
    "Not verified", "Details", "Description", "Buy", "on", "kupatana.com",
    "xxx xxx xxx xxx", ".", "Show more", "Show less",
}

_DATE_RE = re.compile(r"^\d{2}\.\d{2}\.\d{4}$")
# Space, never a newline: `\s` let the match run past the end of the price line
# and swallow the numbers below it, so a butchery advertising goat liver at
# "TZS 4 500" came out at TZS 4,500,000,000.
_TZS_RE = re.compile(r"TZS[ \t]*([\d][\d ]*)")
_YEAR_RE = re.compile(r"\b(19[89]\d|20[0-4]\d)\b")

# Kupatana writes prices with spaces as the thousands separator ("TZS 1 650 000"),
# and the header line carries only the first group ("Price: TZS 1"). Taking the
# largest TZS figure on the page recovers the real one.
def _prices(raw: str) -> list[int]:
    out = []
    for m in _TZS_RE.finditer(raw):
        digits = re.sub(r"\s+", "", m.group(1))
        if digits.isdigit() and len(digits) <= 12:
            out.append(int(digits))
    return out


def _lines(raw: str) -> list[str]:
    return [l.strip() for l in (raw or "").split("\n") if l.strip()]


def parse_fields(raw: str) -> dict:
    """Pull every labelled fact out of one advert. Pure reading, no inference."""
    lines = _lines(raw)
    joined = "\n".join(lines)
    f: dict = {"attributes": {}}

    for line in lines:
        if line.startswith("Title:"):
            f["title"] = line[6:].split("| Kupatana.com")[0].strip()
        elif line.startswith("Phone:"):
            f["phone"] = line[6:].strip()

    prices = _prices(joined)
    f["price_tzs"] = max(prices) if prices else 0

    # Category pair: the two lines after the first "Categories".
    if "Categories" in lines:
        i = lines.index("Categories")
        rest = [l for l in lines[i + 1:i + 4] if l not in _CHROME]
        f["top_category"] = rest[0] if rest else ""
        f["sub_category"] = rest[1] if len(rest) > 1 else ""

    # Posting date, then the location line that follows it.
    for i, line in enumerate(lines):
        if _DATE_RE.match(line):
            f["posted"] = line
            if i + 1 < len(lines):
                loc = lines[i + 1]
                # "Tanzania, Dar Es Salaam" -> "Dar Es Salaam"; bare "Tanzania" is useless.
                if "," in loc:
                    loc = loc.split(",")[-1].strip()
                f["location"] = "" if loc.lower() == "tanzania" else loc
            break

    # Seller: the line immediately before the first "Member since", and the year after it.
    if "Member since" in lines:
        i = lines.index("Member since")
        if i > 0:
            f["seller_name"] = lines[i - 1]
        if i + 1 < len(lines) and lines[i + 1].isdigit():
            f["member_since"] = int(lines[i + 1])
    f["verified"] = "Not verified" not in joined and "Verified" in joined

    # Description: the block between "About" and the chrome that follows it.
    if "About" in lines:
        i = lines.index("About")
        desc = []
        for line in lines[i + 1:]:
            if line in _CHROME or _DATE_RE.match(line):
                break
            desc.append(line)
        text = " ".join(desc).strip()
        # "Buy <title> on kupatana.com" is the template's own filler, not a description.
        if text.lower().startswith("buy ") and text.lower().endswith("on kupatana.com"):
            text = ""
        f["description"] = text

    # Details block: alternating key / value lines between "Details" and the next section.
    if "Details" in lines:
        i = lines.index("Details")
        block = []
        for line in lines[i + 1:]:
            if line in ("Description", "Member since") or _DATE_RE.match(line):
                break
            block.append(line)
        block = [b for b in block if b not in (":",)]
        for k, v in zip(block[::2], block[1::2]):
            if k and v and k not in _CHROME:
                f["attributes"][k.rstrip(":").strip()] = v.strip()

    return f


# Judgement — who is a dealer, who is a business, what a lendable asset is —
# lives in qualify.py, derived from 300 adverts read by six reviewers. This
# file only reads the page; it does not decide what the reading is worth.

# ── assembling a clean lead ──────────────────────────────────────────────────

def to_lead(row: dict, index: SellerIndex | None = None) -> dict | None:
    """Turn one raw row into the clean_leads shape, or None if unusable.

    `index` counts how many adverts each phone has posted across everything
    held; without it a dealer with forty cars looks like a private owner, so a
    caller cleaning in bulk should always pass one (build_seller_index()).
    """
    raw = row.get("raw_data") or ""
    if not raw.strip():
        return None
    f = parse_fields(raw)
    phone = f.get("phone", "")
    norm = normalize_phone(phone)
    crawl_product = (row.get("product") or "LBF").upper()

    verdict, score, reason = classify(f, index or SellerIndex(), crawl_product)
    # The advert decides the product, not the crawl that found it: about one
    # advert in eight was filed under the wrong one. A row that is neither
    # product is still stored, so it is not cleaned again, but it keeps the
    # crawl's label and a Cold score and never reaches a sheet.
    product = verdict if verdict in ("LBF", "SME") else crawl_product

    price = f.get("price_tzs", 0)
    price_text = f"TZS {price:,}" if price else ""
    attrs = f["attributes"]
    lead = {
        "source_url": row["source_url"],
        "product": product,
        "source": row.get("source") or "",
        "seller_name": f.get("seller_name", ""),
        "phone": phone,
        "phone_norm": norm,
        "location": f.get("location", ""),
        "price_text": price_text,
        "est_value_tzs": str(price) if price else "",
        # The loan is ~60% of the asset, the rule the LLM prompt also used.
        "est_loan_tzs": str(int(price * 0.6)) if price else "",
        "score": score,
        "reason": reason,
        "verdict": verdict,   # LBF | SME | NEITHER — not a clean_leads column
        "date_obtained": row.get("date_obtained") or "",
        "flag": "",          # set by the caller against the phones already held
        # LBF fields
        "car_make": attrs.get("Brand", "") or attrs.get("Make", ""),
        "car_model": attrs.get("Model", ""),
        "car_year": attrs.get("Year", "") or attrs.get("Year of Manufacture", ""),
        "mileage": attrs.get("Mileage", ""),
        "body_type": attrs.get("Body", "") or attrs.get("Body Type", ""),
        "fuel_type": attrs.get("Fuel", "") or attrs.get("Fuel Type", ""),
        "condition": attrs.get("Condition", ""),
        # SME fields
        "business_name": f.get("seller_name", "") if name_is_business(f.get("seller_name", "")) else "",
        "business_type": f.get("sub_category", ""),
        "sector": f.get("top_category", ""),
        "offering": f.get("title", ""),
        "est_monthly_revenue_tzs": "",
        "has_shopfront": "",
    }
    # A model name like "other-model" is the template's placeholder, not a fact.
    if lead["car_model"].lower() in ("other-model", "other", "-"):
        lead["car_model"] = ""
    return lead


_TITLE_LINE = re.compile(r"^Title:\s*(.+?)(?:\|\s*Kupatana\.com)?\s*$", re.M)
_PHONE_LINE = re.compile(r"^Phone:\s*(\S+)\s*$", re.M)


_SELLER_LINE = re.compile(r"^Seller:\s*(.+?)\s*$", re.M)


def _index_facts(raw: str) -> tuple[str, str, str]:
    """(phone, title, seller) from any source's raw text.

    Deliberately not the full Kupatana parser: the index has to span every site,
    because a dealer is a dealer whichever site they post on. Jiji's car section
    alone carries 1,400 adverts from 29 phone numbers. Kupatana puts the seller
    before "Member since"; jiji labels it outright.
    """
    t = _TITLE_LINE.search(raw or "")
    p = _PHONE_LINE.search(raw or "")
    sel = _SELLER_LINE.search(raw or "")
    name = sel.group(1).strip() if sel else ""
    if not name:
        lines = _lines(raw)
        if "Member since" in lines:
            i = lines.index("Member since")
            if i > 0:
                name = lines[i - 1]
    return ((p.group(1).strip() if p else ""),
            (t.group(1).strip() if t else ""), name)


def build_seller_index(log=print) -> SellerIndex:
    """Count adverts per phone across EVERY raw listing held, all sources.

    This has to span the whole corpus, not the batch being cleaned: a dealer
    whose other forty adverts were crawled last month, or on the other site,
    would otherwise look like a private seller today.
    """
    conn = db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT raw_data FROM aism_raw_listings WHERE raw_data <> ''")
            index = SellerIndex()
            n = 0
            for (raw,) in cur:
                phone, title, seller = _index_facts(raw)
                index.add(phone, title, is_vehicle(title, "", None), seller)
                n += 1
    finally:
        conn.close()
    traders = sum(1 for p in index.adverts if index.is_trader(p))
    log(f"seller index: {n} adverts, {len(index.adverts)} phones, "
        f"{traders} of them posting {SellerIndex.TRADER_ADVERTS}+ times")
    return index


def clean(product: str = "", source: str = "", limit: int = 0,
          dry_run: bool = False, log=print) -> dict:
    """Parse every un-cleaned Kupatana row into aism_clean_leads."""
    todo = [r for r in db.raw_uncleaned(product=product, source=source)
            if (r.get("source") or "").startswith(SOURCE_PREFIX)]
    if limit and limit > 0:
        todo = todo[:limit]
    index = build_seller_index(log)
    seen = db.seen_phone_norms()
    log(f"{len(todo)} un-cleaned Kupatana listings")

    out: list[dict] = []
    counts = {"new": 0, "exist": 0, "nophone": 0, "skipped": 0,
              "Hot": 0, "Warm": 0, "Cold": 0, "LBF": 0, "SME": 0, "NEITHER": 0}
    for row in todo:
        lead = to_lead(row, index)
        if not lead:
            counts["skipped"] += 1
            continue
        counts[lead["verdict"]] = counts.get(lead["verdict"], 0) + 1
        norm = lead["phone_norm"]
        if not norm:
            counts["nophone"] += 1
            lead["flag"] = "NEW DATA"
        elif norm in seen:
            counts["exist"] += 1
            lead["flag"] = "EXISTING DATA"
        else:
            counts["new"] += 1
            seen.add(norm)
            lead["flag"] = "NEW DATA"
        counts[lead["score"]] = counts.get(lead["score"], 0) + 1
        out.append(lead)

    if dry_run:
        log("dry run — nothing written")
        return {"parsed": len(out), "counts": counts, "sample": out[:5]}

    written = 0
    for i in range(0, len(out), 500):
        batch = [{k: v for k, v in d.items() if k != "verdict"} for d in out[i:i + 500]]
        written += db.insert_clean_many(batch)
        log(f"  written {written}/{len(out)}")
    return {"parsed": len(out), "written": written, "counts": counts,
            "clean_total": db.count_clean(), "unique_total": db.count_unique()}


def rescore(dry_run: bool = False, log=print) -> dict:
    """Re-judge Kupatana rows that were scored by the old LLM pass.

    Worth doing once: on a 600-advert hold-out the model agreed with these
    rules on only 24% of scores, and the disagreements were not close calls.
    It had no way to see that one phone number carries 530 adverts, so it
    scored a dealer's whole stock as "individual seller, phone present" and
    those rows would otherwise be handed to the call centre as prospects.

    Only the judgement columns are rewritten. The facts the model read —
    phone, name, make, year — are left exactly as they are.
    """
    index = build_seller_index(log)
    conn = db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT c.id, c.source_url, c.product, c.score, c.reason, "
                "       r.raw_data, r.product, r.source, r.date_obtained "
                "  FROM aism_clean_leads c JOIN aism_raw_listings r "
                "    ON r.source_url = c.source_url "
                " WHERE r.source LIKE %s AND r.raw_data <> ''", (SOURCE_PREFIX + "%",))
            rows = cur.fetchall()
    finally:
        conn.close()
    log(f"{len(rows)} Kupatana leads to re-judge")

    updates, changed = [], {"score": 0, "product": 0}
    for (lead_id, url, old_product, old_score, _old_reason,
         raw, raw_product, source, dt) in rows:
        lead = to_lead({"source_url": url, "raw_data": raw, "product": raw_product,
                        "source": source, "date_obtained": dt}, index)
        if not lead:
            continue
        if lead["score"] != old_score:
            changed["score"] += 1
        if lead["product"] != old_product:
            changed["product"] += 1
        updates.append((lead["product"], lead["score"], lead["reason"], lead_id))

    log(f"  score changes: {changed['score']}, product changes: {changed['product']}")
    if dry_run:
        return {"examined": len(rows), "changed": changed, "written": 0}

    conn = db.connect()
    try:
        with conn.cursor() as cur:
            for i in range(0, len(updates), 1000):
                cur.executemany(
                    "UPDATE aism_clean_leads SET product=%s, score=%s, reason=%s WHERE id=%s",
                    updates[i:i + 1000])
                log(f"  updated {min(i + 1000, len(updates))}/{len(updates)}")
    finally:
        conn.close()
    return {"examined": len(rows), "changed": changed, "written": len(updates)}


def main() -> None:
    ap = argparse.ArgumentParser(description="Deterministic Kupatana cleaner (no LLM)")
    ap.add_argument("--product", default="", help="LBF | SME (default: both)")
    ap.add_argument("--source", default="", help="one source key")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--rescore", action="store_true",
                    help="re-judge leads already cleaned by the old LLM pass")
    a = ap.parse_args()
    db.migrate()
    if a.rescore:
        for k, v in rescore(a.dry_run).items():
            print(f"{k}: {v}")
        return
    res = clean(a.product, a.source, a.limit, a.dry_run)
    for k, v in res.items():
        if k != "sample":
            print(f"{k}: {v}")
    for s in res.get("sample", []):
        print({k: v for k, v in s.items() if v})


if __name__ == "__main__":
    main()
