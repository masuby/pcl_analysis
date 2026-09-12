"""Turn pasted Facebook Marketplace / buy-and-sell group posts into leads.

Meta does not offer an API for Marketplace or for public group posts, and
scraping either breaches their terms, so this is deliberately SEMI-MANUAL: an
agent reads the group, copies a post, and pastes it here. What the tool then
does is the part a person does badly — reading the number out cleanly, pricing
it, placing it, deciding whether it is an LBF or an SME prospect, and checking
it against everything already held so the same seller is not called twice.

The judgement is not re-invented here. Each parsed post is handed to
qualify.classify, the same rules the Kupatana cleaner uses, derived from 300
adverts read and scored. So a dealer posting ten cars into a group is caught by
exactly the rule that catches one on a classifieds site.

Usage (from ai_sales_manager/):
    python -m scraper.paste_capture --file posts.txt --product LBF
    python -m scraper.paste_capture --file posts.txt --confirm     # write them
    cat posts.txt | python -m scraper.paste_capture
"""
from __future__ import annotations

import argparse
import re
import sys
import threading
import time
from datetime import date

from app import db
from app.db import normalize_phone

from .places import TOWNS
from .qualify import SellerIndex, classify

# ── posts ────────────────────────────────────────────────────────────────────

# Agents paste several posts at a time. A blank line, a rule of dashes, or an
# explicit marker all end one post; any of them is accepted because nobody
# should have to remember a format while working through a group feed.
_SPLIT = re.compile(r"\n\s*(?:-{3,}|={3,}|\*{3,}|#{3,}|\n)\s*\n?|\n{2,}")


def split_posts(text: str) -> list[str]:
    return [p.strip() for p in _SPLIT.split(text or "") if p and p.strip()]


# ── phone ────────────────────────────────────────────────────────────────────

# A Tanzanian mobile, with the guard that cost us on market.co.tz: the number
# must not sit inside a longer run of digits. That site's page carried
# `"latitude":-6.7837340673039135`, out of the middle of which a naive pattern
# happily read "0673039135" and called it a seller. (?<!\d) and (?!\d) stop it.
_PHONE = re.compile(r"(?<!\d)(?:\+?255[\s.-]?|0)([67]\d{2})[\s.-]?(\d{3})[\s.-]?(\d{3})(?!\d)")

# Numbers that belong to the platform or to us, never to a seller. Extend this
# rather than letting a switchboard reach the call centre as a prospect.
BLOCKED_PREFIXES = ("255748711238",)   # market.co.tz support line


def extract_phones(text: str) -> list[str]:
    """Every distinct TZ mobile in a post, normalised to 255XXXXXXXXX."""
    out: list[str] = []
    for m in _PHONE.finditer(text or ""):
        num = "255" + m.group(1) + m.group(2) + m.group(3)
        if num in BLOCKED_PREFIXES or num in out:
            continue
        out.append(num)
    return out


# ── price ────────────────────────────────────────────────────────────────────

# "15M", "15 mil", "bei 3.5m", "TZS 15,000,000", "15,000,000/=", "Tsh 850000".
_PRICE_M = re.compile(r"(?<![\d.])(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:m\b|mil\b|million\b)", re.I)
_PRICE_K = re.compile(r"(?<![\d.])(\d{1,4}(?:[.,]\d{1,2})?)\s*k\b", re.I)
_PRICE_PLAIN = re.compile(r"(?<!\d)(\d{1,3}(?:[,\s]\d{3}){1,3}|\d{6,10})(?!\d)")


def extract_price(text: str) -> int:
    """Best TZS figure in a post, or 0. Takes the largest credible candidate.

    A post often carries a price and a phone; the phone is excluded first by
    blanking it, so "0754123456" is never read as 754 million shillings.
    """
    t = _PHONE.sub(" ", text or "")
    cands: list[int] = []
    for m in _PRICE_M.finditer(t):
        cands.append(int(float(m.group(1).replace(",", ".")) * 1_000_000))
    for m in _PRICE_K.finditer(t):
        cands.append(int(float(m.group(1).replace(",", ".")) * 1_000))
    for m in _PRICE_PLAIN.finditer(t):
        n = int(re.sub(r"[,\s]", "", m.group(1)))
        if 10_000 <= n <= 5_000_000_000:
            cands.append(n)
    return max(cands) if cands else 0


# ── location ─────────────────────────────────────────────────────────────────

# The branch towns, longest first so "Dar es Salaam" wins over "Dar".
_PLACES = sorted({t.split(",")[-1].strip() for t in TOWNS} |
                 {t.split(",")[0].strip() for t in TOWNS} |
                 {"Dar", "Mbagala", "Kariakoo", "Tegeta", "Mwenge", "Ubungo",
                  "Kinondoni", "Temeke", "Ilala", "Kigamboni", "Mbezi", "Tabata",
                  "Segerea", "Buguruni", "Sinza", "Magomeni", "Manzese"},
                 key=len, reverse=True)
_PLACE_RE = re.compile(r"\b(" + "|".join(re.escape(p) for p in _PLACES) + r")\b", re.I)


def extract_location(text: str) -> str:
    m = _PLACE_RE.search(text or "")
    if not m:
        return ""
    found = m.group(1)
    return "Dar es Salaam" if found.lower() == "dar" else found


# ── a post becomes a lead ────────────────────────────────────────────────────

_URL = re.compile(r"https?://\S+")
# A group post rarely names the seller, but agents often type one in.
_NAME_HINT = re.compile(r"^(?:seller|muuzaji|jina|name)\s*[:\-]\s*(.+)$", re.I | re.M)


def parse_post(post: str, captured_by: str = "", group: str = "") -> dict:
    """Read one pasted post. Pure extraction; the verdict comes after."""
    phones = extract_phones(post)
    url = (_URL.search(post) or [None]) and (_URL.search(post).group(0) if _URL.search(post) else "")
    name = ""
    nm = _NAME_HINT.search(post)
    if nm:
        name = nm.group(1).strip()[:60]

    # The title is the first line that is not a bare phone, price or link.
    title = ""
    for line in [l.strip() for l in post.split("\n") if l.strip()]:
        stripped = _PHONE.sub("", _URL.sub("", line)).strip(" .,-:")
        if len(stripped) >= 4 and not stripped.replace(",", "").replace(" ", "").isdigit():
            title = stripped[:120]
            break

    return {
        "title": title,
        "description": post.strip()[:600],
        "seller_name": name,
        "phone": phones[0] if phones else "",
        "extra_phones": phones[1:],
        "price_tzs": extract_price(post),
        "location": extract_location(post),
        "posted": date.today().strftime("%d.%m.%Y"),   # a group post carries no date
        "attributes": {},
        "source_url": url or "",
        "group": group,
        "captured_by": captured_by,
    }


def capture(text: str, product: str = "", captured_by: str = "", group: str = "",
            log=print) -> dict:
    """Parse a paste, judge it, and say what is new.

    Nothing is written. The caller decides what to do with `new`.
    """
    posts = split_posts(text)
    log(f"{len(posts)} post(s) pasted")
    index = build_index(log)
    held = db.seen_phone_norms()

    new, dupes, rejected, no_phone = [], [], [], []
    seen_here: set[str] = set()

    for post in posts:
        f = parse_post(post, captured_by, group)
        if not f["phone"]:
            no_phone.append(f)
            continue
        norm = normalize_phone(f["phone"])
        if norm in seen_here:
            f["why"] = "the same number appears twice in this paste"
            dupes.append(f)
            continue
        seen_here.add(norm)
        if norm in held:
            f["why"] = "already held — this seller has been captured before"
            dupes.append(f)
            continue

        verdict, score, reason = classify(f, index)
        f.update(verdict=verdict, score=score, reason=reason, phone_norm=norm)
        if verdict == "NEITHER" or score == "Cold":
            rejected.append(f)
            continue
        if product and verdict != product.upper():
            f["why"] = f"reads as {verdict}, not {product.upper()}"
            rejected.append(f)
            continue
        new.append(f)

    log(f"  {len(new)} new prospect(s), {len(dupes)} already held, "
        f"{len(rejected)} not a prospect, {len(no_phone)} with no number")
    return {"new": new, "duplicates": dupes, "rejected": rejected,
            "no_phone": no_phone, "posts": len(posts)}


# The dealer index is built by re-parsing every raw advert held, which takes
# about 20 seconds on 22,779 of them. That is fine for a nightly clean and
# hopeless for an agent pasting one post after another, so it is built once and
# kept. Ten minutes is short enough that a dealer captured earlier in the shift
# is recognised, and long enough that the wait is paid once.
_INDEX_TTL_SECONDS = 600
_index: SellerIndex | None = None
_index_built_at = 0.0
_index_lock = threading.Lock()


def build_index(log=print, force: bool = False) -> SellerIndex:
    """The dealer index, so a group's regular trader is recognised on the first
    paste rather than after somebody notices."""
    global _index, _index_built_at
    with _index_lock:
        fresh = _index is not None and (time.time() - _index_built_at) < _INDEX_TTL_SECONDS
        if fresh and not force:
            return _index
        from .parse_kupatana import build_seller_index
        _index = build_seller_index(log)
        _index_built_at = time.time()
        return _index


def invalidate_index() -> None:
    """Drop the cached index — call after storing leads, so the next paste sees
    the seller who was just captured."""
    global _index_built_at
    with _index_lock:
        _index_built_at = 0.0


def to_lead(f: dict) -> dict:
    """The clean_leads shape, so a captured post stores exactly like a crawled one."""
    price = f.get("price_tzs") or 0
    return {
        "source_url": f.get("source_url") or f"paste:{f['phone_norm']}",
        "product": f["verdict"],
        "source": "facebook_paste" + (f":{f['group']}" if f.get("group") else ""),
        "seller_name": f.get("seller_name", ""),
        "phone": f["phone"], "phone_norm": f["phone_norm"],
        "location": f.get("location", ""),
        "price_text": f"TZS {price:,}" if price else "",
        "est_value_tzs": str(price) if price else "",
        "est_loan_tzs": str(int(price * 0.6)) if price else "",
        "score": f["score"], "reason": f["reason"],
        "date_obtained": date.today().isoformat(), "flag": "NEW DATA",
        "offering": f.get("title", ""),
        "business_type": "", "sector": "", "business_name": "",
        "car_make": "", "car_model": "", "car_year": "", "mileage": "",
        "body_type": "", "fuel_type": "", "condition": "",
        "est_monthly_revenue_tzs": "", "has_shopfront": "",
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Capture pasted Marketplace / group posts")
    ap.add_argument("--file", help="file of pasted posts; omit to read stdin")
    ap.add_argument("--product", default="", help="keep only LBF or only SME")
    ap.add_argument("--group", default="", help="which group the posts came from")
    ap.add_argument("--by", default="", help="who captured them")
    ap.add_argument("--confirm", action="store_true", help="store the new leads")
    a = ap.parse_args()

    text = open(a.file, encoding="utf-8").read() if a.file else sys.stdin.read()
    res = capture(text, a.product, a.by, a.group)

    for f in res["new"]:
        print(f"  NEW  {f['score']:4} {f['verdict']:4} {f['phone']} "
              f"{(f.get('location') or '-'):14} "
              f"{('TZS %s' % format(f['price_tzs'], ',')) if f['price_tzs'] else '-':>18}  "
              f"{f['title'][:40]}")
    for f in res["duplicates"]:
        print(f"  DUP  {f['phone']}  {f.get('why','')}")
    for f in res["rejected"]:
        print(f"  NO   {f['phone']}  {f.get('why') or f.get('reason','')}")
    for f in res["no_phone"]:
        print(f"  ????  no number in: {f['title'][:60]}")

    if a.confirm and res["new"]:
        db.migrate()
        n = db.insert_clean_many([to_lead(f) for f in res["new"]])
        print(f"\nstored {n} lead(s). Send them with: python -m scraper.to_sheets --confirm")
    elif res["new"]:
        print(f"\n{len(res['new'])} ready — pass --confirm to store them")


if __name__ == "__main__":
    main()
