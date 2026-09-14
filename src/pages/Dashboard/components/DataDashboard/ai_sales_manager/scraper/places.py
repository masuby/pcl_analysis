"""Google Places → SME leads.

Every listed business in Tanzania with a phone number, by trade and by town, via
the Places API (New) Text Search. The result is structured — name, phone,
address, category — so it goes straight into clean_leads with no AI pass, which
matters now that every LLM provider is rate-capped.

Why this is a legitimate source where scraping social media is not: a Maps
listing's phone number is the business line the owner published to be called
on. It is the same footing as a Kupatana seller's number, not a person's
private profile.

Two constraints from Google's terms, and the code observes both:
  • Places content other than the place ID may be kept for at most 30 days.
    `date_obtained` is stamped on every lead so the sheet batch can be
    distributed and worked inside that window; do not treat this table as a
    permanent Google-derived directory.
  • Attribution: `source_url` is the place's own Google Maps link.

Cost, and the field that sets it: a Text Search is billed at the highest tier
any field in the mask belongs to, and `nationalPhoneNumber` is an ENTERPRISE
field. The phone number is the whole point of this source, so every request
here is Enterprise at US$35 per 1,000 — there is no version of this that bills
at Pro. `rating` and `userRatingCount` are Enterprise too, which is why they are
kept: dropping them would lose the only activity signal Places gives us and
save nothing.

Google withdrew the pooled US$200 monthly credit on 1 March 2025. Each SKU now
has its own allowance and Enterprise gets 1,000 free calls a month, no
roll-over. A request returns up to 20 places, so the free tier is worth roughly
20,000 listings a month if every page filled, and ~3,000–6,000 in practice.

The default grid is 25 trades × 46 towns = 1,150 queries. At up to three pages
each the ceiling is 3,450 requests: 1,000 free, 2,450 billable, about US$86 for
a full national sweep. Most small towns return a single page, so the real
figure is well under that. `--max-requests` is the hard stop, and `--dry-run`
prints the bill before anything is spent.

Setup (once, in Google Cloud — ANY project will do; 509704387275 is simply the
project the existing GOOGLE_API_KEY already belongs to):
  1. enable "Places API (New)" on the project
  2. turn billing on — the free tier is not granted without a billing account
  3. if the key has API restrictions, add Places API (New) to its allowed list
The key is read from GOOGLE_PLACES_API_KEY, falling back to GOOGLE_API_KEY.
`--check` performs all three checks in one request and says which one failed.

Usage (from ai_sales_manager/):
  python -m scraper.places --check                     # is the key allowed through?
  python -m scraper.places --dry-run                  # the query grid and the bill
  python -m scraper.places --towns "Ilala, Dar es Salaam; Arusha" --categories "hardware shop; pharmacy"
  python -m scraper.places --max-requests 300          # a bounded sweep
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import date

from app import db

ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
FIELDS = ",".join([
    "places.id", "places.displayName", "places.nationalPhoneNumber",
    "places.internationalPhoneNumber", "places.formattedAddress",
    "places.primaryType", "places.types", "places.googleMapsUri",
    "places.rating", "places.userRatingCount", "places.businessStatus",
    "nextPageToken",
])
SOURCE = "google_places"
PRODUCT = "SME"

# Trades whose owners run a business PCL lends to — small retail, services,
# light industry — rather than institutions or chains.
CATEGORIES = [
    "hardware shop", "pharmacy", "restaurant", "hair salon", "boutique",
    "electronics shop", "mini supermarket", "butchery", "bakery",
    "auto spare parts shop", "stationery shop", "tailoring shop",
    "furniture shop", "mobile money agent", "wholesale shop", "agrovet",
    "welding workshop", "printing shop", "guest house", "bar",
    "phone accessories shop", "cosmetics shop", "poultry farm supplies",
    "building materials", "motorcycle spare parts",
]

# Where PCL has branches — the cluster lists in KpiAnalysisReport/ClusterKpis —
# plus the Dar es Salaam municipalities, which are too large to search as one.
TOWNS = [
    "Ilala, Dar es Salaam", "Kinondoni, Dar es Salaam", "Temeke, Dar es Salaam",
    "Ubungo, Dar es Salaam", "Kigamboni, Dar es Salaam",
    "Arusha", "Mwanza", "Dodoma", "Mbeya", "Morogoro", "Tanga", "Zanzibar",
    "Moshi", "Iringa", "Tabora", "Kigoma", "Mtwara", "Songea", "Shinyanga",
    "Singida", "Sumbawanga", "Lindi", "Njombe", "Geita", "Bukoba", "Musoma",
    "Kahama", "Kasulu", "Ifakara", "Mpanda", "Tunduru", "Masasi", "Nachingwea",
    "Korogwe", "Lushoto", "Babati", "Ukerewe", "Bariadi", "Chato", "Nzega",
    "Urambo", "Vwawa", "Mkuranga", "Kilosa", "Kibaha", "Pemba",
]

PAGE_SIZE = 20
MAX_PAGES = 3          # Text Search returns at most 60 results per query

# Every request here carries nationalPhoneNumber, so every request is billed at
# the Enterprise tier. Stated so the estimate in --dry-run is auditable rather
# than a number somebody has to take on trust.
USD_PER_1000 = 35.0
FREE_CALLS_PER_MONTH = 1000


def api_key() -> str:
    key = os.getenv("GOOGLE_PLACES_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""
    if not key:
        # the AI agent's own .env, and the DataDashboard one it already reads
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        for p in (os.path.join(here, ".env"), os.path.join(os.path.dirname(here), ".env")):
            if os.path.exists(p):
                for line in open(p, encoding="utf-8"):
                    line = line.strip()
                    if line.startswith(("GOOGLE_PLACES_API_KEY=", "GOOGLE_API_KEY=")):
                        key = line.split("=", 1)[1].strip().strip('"')
                        if line.startswith("GOOGLE_PLACES_API_KEY="):
                            break
    return key


def search(key: str, query: str, page_token: str | None = None) -> dict:
    body = {"textQuery": query, "regionCode": "TZ", "pageSize": PAGE_SIZE,
            "languageCode": "en"}
    if page_token:
        body["pageToken"] = page_token
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Goog-Api-Key": key,
                 "X-Goog-FieldMask": FIELDS})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            msg = json.loads(raw)["error"]["message"]
        except Exception:
            msg = raw[:300]
        raise RuntimeError(f"Places API {e.code}: {msg}") from None


# ── is the key actually allowed through? ─────────────────────────────────────
#
# Three separate things must be true before a single lead can be fetched, and
# Google reports each as a 403 with a different `reason`. Guessing between them
# wasted a session, so the reason is decoded here and the fix named exactly.

_KEY_FAULTS = {
    "API_KEY_SERVICE_BLOCKED": (
        "the key is restricted and Places API (New) is not on its allowed list",
        "APIs & Services > Credentials > (the key) > API restrictions: add "
        "\"Places API (New)\", or set Don't restrict key. Also confirm the API "
        "itself is enabled."),
    "SERVICE_DISABLED": (
        "Places API (New) is not enabled on the project",
        "APIs & Services > Library > Places API (New) > Enable. Then check "
        "Credentials > (the key) > API restrictions includes it - this key trips "
        "that gate too, so enabling alone is not enough."),
    "API_KEY_HTTP_REFERRER_BLOCKED": (
        "the key only accepts calls from a browser referrer; this runs server-side",
        "Credentials > (the key) > Application restrictions: choose None, or "
        "IP addresses and add this machine's public IP."),
    "API_KEY_IP_ADDRESS_BLOCKED": (
        "the key only accepts calls from listed IP addresses, and this one is not on it",
        "Credentials > (the key) > Application restrictions > IP addresses: add "
        "this machine's public IP."),
    "API_KEY_INVALID": (
        "the key is not a valid API key",
        "Credentials > Create credentials > API key, then put it in .env as "
        "GOOGLE_PLACES_API_KEY."),
    "BILLING_DISABLED": (
        "the project has no billing account, so even the free tier is refused",
        "Billing > Link a billing account. The first 1,000 Enterprise calls a "
        "month are still free once billing exists."),
}


def preflight(key: str = "") -> dict:
    """One cheap request that answers: can this key fetch business phones?

    Returns {ok, project, reason, problem, fix}. A successful check costs one
    Enterprise call out of the month's thousand free ones.
    """
    key = key or api_key()
    if not key:
        return {"ok": False, "reason": "NO_KEY",
                "problem": "no GOOGLE_PLACES_API_KEY or GOOGLE_API_KEY is set",
                "fix": "put GOOGLE_PLACES_API_KEY=... in ai_sales_manager/.env"}

    body = {"textQuery": "hardware shop in Arusha, Tanzania", "regionCode": "TZ",
            "pageSize": 1, "languageCode": "en"}
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Goog-Api-Key": key,
                 # the field that decides the SKU, so the check tests the real thing
                 "X-Goog-FieldMask": "places.id,places.displayName,places.nationalPhoneNumber"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.load(r)
        places = res.get("places") or []
        with_phone = sum(1 for p in places if p.get("nationalPhoneNumber"))
        return {"ok": True, "reason": "OK", "problem": "", "fix": "",
                "sample_places": len(places), "sample_with_phone": with_phone,
                "key_tail": "..." + key[-4:]}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        reason = project = ""
        message = raw[:300]
        try:
            err = json.loads(raw)["error"]
            message = err.get("message", message)
            for d in err.get("details", []):
                if d.get("@type", "").endswith("ErrorInfo"):
                    reason = d.get("reason", "")
                    project = (d.get("metadata") or {}).get("consumer", "")
        except Exception:  # noqa: BLE001
            pass
        if not reason and "billing" in message.lower():
            reason = "BILLING_DISABLED"
        problem, fix = _KEY_FAULTS.get(
            reason, (message, "check the key and the project in Google Cloud"))
        link = re.search(r"https://console\.[^\s]+", message)
        if link:
            fix += f"  Direct link: {link.group(0).rstrip('.')}"
        return {"ok": False, "code": e.code, "reason": reason or f"HTTP_{e.code}",
                "project": project.replace("projects/", ""),
                "problem": problem, "fix": fix, "message": message,
                "key_tail": "..." + key[-4:]}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": "NETWORK", "problem": str(exc),
                "fix": "check this machine can reach places.googleapis.com"}


def estimate(queries: int, max_requests: int = 0) -> dict:
    """What a sweep of this size costs, before anything is spent."""
    ceiling = queries * MAX_PAGES
    if max_requests:
        ceiling = min(ceiling, max_requests)
    billable = max(0, ceiling - FREE_CALLS_PER_MONTH)
    return {"queries": queries, "max_requests": ceiling,
            "free_calls_remaining_assumed": FREE_CALLS_PER_MONTH,
            "billable_requests": billable,
            "max_usd": round(billable * USD_PER_1000 / 1000, 2),
            "max_places": ceiling * PAGE_SIZE}


# A listed business that PCL cannot lend working capital to. This is the TYPE
# Google assigns, never a word in the name, and the distinction was paid for:
# a rule that also refused anything called "head office" or "headquarters" read
# as sensible and deleted four good SMEs out of the six it caught - "Sai Office
# Supplies - Head Office" and "Spanish Tiles & Sanitary Ware Head Office" are
# exactly the businesses this source exists to find. A Tanzanian trader calls
# their own shop a head office; only a bank is a bank.
#
# The grid already does nearly all of this work: 3,781 Dar and Arusha listings
# contained one bank and nothing else that did not belong.
_NOT_A_TRADE = {"bank", "atm", "hospital", "school", "university", "primary_school",
                "secondary_school", "local_government_office", "embassy",
                "police", "airport", "church", "mosque", "courthouse",
                "fire_station", "post_office"}


def to_lead(place: dict, category: str, town: str) -> dict | None:
    phone = place.get("nationalPhoneNumber") or place.get("internationalPhoneNumber") or ""
    norm = db.normalize_phone(phone)
    if len(norm) != 9 or norm[0] not in "67":
        return None                         # landline, malformed, or none at all
    if place.get("businessStatus") not in (None, "OPERATIONAL"):
        return None
    name = (place.get("displayName") or {}).get("text", "").strip()
    if (place.get("primaryType") or "") in _NOT_A_TRADE:
        return None
    rating = place.get("rating")
    n_rev = place.get("userRatingCount") or 0
    ptype = (place.get("primaryType") or "").replace("_", " ")
    # A business that people review is one that trades; reviews are the only
    # activity signal Places gives us, so they set the temperature.
    flag = "Hot" if n_rev >= 20 else ("Warm" if n_rev >= 3 else "Cold")
    reason = f"Google Maps listing — {ptype or category}"
    if rating:
        reason += f", {rating}★ from {n_rev} reviews"
    return {
        "source_url": place.get("googleMapsUri") or f"https://www.google.com/maps/place/?q=place_id:{place.get('id')}",
        "product": PRODUCT, "source": SOURCE,
        "seller_name": "", "phone": "255" + norm, "phone_norm": norm,
        "business_name": name, "business_type": ptype or category,
        "sector": category, "offering": ", ".join(t.replace("_", " ") for t in (place.get("types") or [])[:4]),
        "has_shopfront": "yes", "location": town.split(",")[0].strip(),
        "price_text": (place.get("formattedAddress") or "")[:200],
        # `score` carries the temperature word and `flag` says whether the lead
        # is new - the same way round as every other source, and the way the
        # upload gate reads them. Having these two swapped meant no Places lead
        # could ever pass `score IN ('Hot','Warm')`.
        "score": flag, "reason": reason,
        "date_obtained": date.today().isoformat(), "flag": "NEW DATA",
        # the rest of _CLEAN_COLS are vehicle fields — blank for a business
        "car_make": "", "car_model": "", "car_year": "", "mileage": "",
        "body_type": "", "fuel_type": "", "condition": "",
        "est_monthly_revenue_tzs": "", "est_value_tzs": "", "est_loan_tzs": "",
    }


def run(towns: list[str], categories: list[str], max_requests: int = 0,
        delay: float = 0.3, dry_run: bool = False, log=print,
        should_stop=None) -> dict:
    grid = [(c, t) for t in towns for c in categories]
    cost = estimate(len(grid), max_requests)
    # ASCII only: this prints to a Windows cp1252 console, which cannot encode
    # the multiplication sign or <=, and a progress line must never be the thing
    # that kills the run.
    log(f"query grid: {len(categories)} trades x {len(towns)} towns = {len(grid)} queries, "
        f"up to {cost['max_requests']} requests "
        f"(max US${cost['max_usd']} after the {FREE_CALLS_PER_MONTH} free monthly calls)")
    if dry_run:
        for c, t in grid[:12]:
            log(f"   {c} in {t}, Tanzania")
        if len(grid) > 12:
            log(f"   ... {len(grid) - 12} more")
        return {"dry_run": True, **cost}

    key = api_key()
    if not key:
        raise SystemExit("no GOOGLE_PLACES_API_KEY / GOOGLE_API_KEY found")
    check = preflight(key)
    if not check["ok"]:
        raise SystemExit(f"stopped before spending anything - {check['problem']}. "
                         f"Fix: {check['fix']}")
    db.migrate()
    # A business whose number we already hold is not a new lead, whoever found
    # it first. Places is the third source into the same table, and a Kariakoo
    # hardware shop is on Kupatana as well as on Maps.
    held = db.seen_phone_norms()
    log(f"{len(held):,} phone number(s) already held - those will be skipped")
    requests_made = found = with_phone = inserted = already = 0
    seen_ids: set[str] = set()
    stopped = False
    for qi, (category, town) in enumerate(grid, 1):
        if should_stop and should_stop():
            log("stopping: cancelled")
            stopped = True
            break
        if max_requests and requests_made >= max_requests:
            log(f"stopping: reached --max-requests {max_requests}")
            break
        token = None
        batch: list[dict] = []
        for _page in range(MAX_PAGES):
            if max_requests and requests_made >= max_requests:
                break
            try:
                res = search(key, f"{category} in {town}, Tanzania", token)
            except RuntimeError as e:
                if "403" in str(e) or "API key" in str(e) or "PERMISSION_DENIED" in str(e):
                    raise SystemExit(f"stopped — {e}")
                log(f"  [{qi}/{len(grid)}] {category} / {town}: {e}")
                break
            requests_made += 1
            places = res.get("places") or []
            found += len(places)
            for p in places:
                pid = p.get("id")
                if pid in seen_ids:
                    continue
                seen_ids.add(pid)
                lead = to_lead(p, category, town)
                if not lead:
                    continue
                with_phone += 1
                if lead["phone_norm"] in held:
                    already += 1
                    continue
                held.add(lead["phone_norm"])   # and not twice within this run
                batch.append(lead)
            token = res.get("nextPageToken")
            if not token:
                break
            time.sleep(delay)
        if batch:
            inserted += db.insert_clean_many(batch)
        if qi % 10 == 0 or batch:
            log(f"  [{qi}/{len(grid)}] {category} / {town}: +{len(batch)} with phone "
                f"(requests {requests_made}, found {found}, inserted {inserted})")
        time.sleep(delay)
    summary = {"queries": len(grid), "requests": requests_made, "places_found": found,
               "with_phone": with_phone, "already_held": already,
               "inserted_new": inserted, "cancelled": stopped,
               "spent_usd": round(max(0, requests_made - FREE_CALLS_PER_MONTH)
                                  * USD_PER_1000 / 1000, 2),
               "unique_total": db.count_unique()}
    log(f"done: {summary}")
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description="Google Places → SME leads")
    ap.add_argument("--towns", default="", help="semicolon-separated (towns contain commas); default: PCL branch towns")
    ap.add_argument("--categories", default="", help="semicolon-separated; default: small-business trades")
    ap.add_argument("--max-requests", type=int, default=0, help="hard stop on API requests (billing guard)")
    ap.add_argument("--delay", type=float, default=0.3)
    ap.add_argument("--dry-run", action="store_true", help="print the query grid and the bill, fetch nothing")
    ap.add_argument("--check", action="store_true", help="one request: is the key allowed through?")
    a = ap.parse_args()
    if a.check:
        r = preflight()
        if r["ok"]:
            print(f"OK - key {r['key_tail']} can read business phone numbers "
                  f"({r['sample_with_phone']}/{r['sample_places']} of a sample listing had one)")
        else:
            print(f"BLOCKED - {r['reason']}"
                  + (f" on project {r['project']}" if r.get("project") else ""))
            print(f"  problem: {r['problem']}")
            print(f"  fix:     {r['fix']}")
        raise SystemExit(0 if r["ok"] else 1)
    towns = [t.strip() for t in a.towns.split(";") if t.strip()] or TOWNS
    cats = [c.strip() for c in a.categories.split(";") if c.strip()] or CATEGORIES
    run(towns, cats, a.max_requests, a.delay, a.dry_run)




if __name__ == "__main__":
    main()
