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

Cost: Text Search with contact fields bills at the Pro SKU (~US$35 per 1,000
requests); a request returns up to 20 places, so ~US$1.75 per 1,000 places
found. The default grid is 25 trades × 46 towns = 1,150 queries; at up to three
pages each that is a ceiling of 3,450 requests (~US$120), and in practice most
small towns return one page. The monthly US$200 credit covers a full sweep;
`--max-requests` is a hard stop for anything tighter.

Setup (once, in Google Cloud for project 509704387275):
  enable "Places API (New)", make sure billing is on, and give the key access.
  The key is read from GOOGLE_PLACES_API_KEY, falling back to GOOGLE_API_KEY.

Usage (from ai_sales_manager/):
  python -m scraper.places --dry-run                  # show the query grid
  python -m scraper.places --towns "Ilala, Dar es Salaam; Arusha" --categories "hardware shop; pharmacy"
  python -m scraper.places --max-requests 300          # a bounded sweep
"""
from __future__ import annotations

import argparse
import json
import os
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


def to_lead(place: dict, category: str, town: str) -> dict | None:
    phone = place.get("nationalPhoneNumber") or place.get("internationalPhoneNumber") or ""
    norm = db.normalize_phone(phone)
    if len(norm) != 9 or norm[0] not in "67":
        return None                         # landline, malformed, or none at all
    if place.get("businessStatus") not in (None, "OPERATIONAL"):
        return None
    name = (place.get("displayName") or {}).get("text", "").strip()
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
        "score": min(100, 40 + int(n_rev)), "reason": reason,
        "date_obtained": date.today().isoformat(), "flag": flag,
        # the rest of _CLEAN_COLS are vehicle fields — blank for a business
        "car_make": "", "car_model": "", "car_year": "", "mileage": "",
        "body_type": "", "fuel_type": "", "condition": "",
        "est_monthly_revenue_tzs": "", "est_value_tzs": "", "est_loan_tzs": "",
    }


def run(towns: list[str], categories: list[str], max_requests: int = 0,
        delay: float = 0.3, dry_run: bool = False, log=print) -> dict:
    grid = [(c, t) for t in towns for c in categories]
    log(f"query grid: {len(categories)} trades × {len(towns)} towns = {len(grid)} queries, "
        f"up to {len(grid) * MAX_PAGES} requests")
    if dry_run:
        for c, t in grid[:12]:
            log(f"   {c} in {t}, Tanzania")
        if len(grid) > 12:
            log(f"   … {len(grid) - 12} more")
        return {"queries": len(grid), "dry_run": True}

    key = api_key()
    if not key:
        raise SystemExit("no GOOGLE_PLACES_API_KEY / GOOGLE_API_KEY found")
    db.migrate()
    requests_made = found = with_phone = inserted = 0
    seen_ids: set[str] = set()
    for qi, (category, town) in enumerate(grid, 1):
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
                if lead:
                    with_phone += 1
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
               "with_phone": with_phone, "inserted_new": inserted,
               "unique_total": db.count_unique()}
    log(f"done: {summary}")
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description="Google Places → SME leads")
    ap.add_argument("--towns", default="", help="semicolon-separated (towns contain commas); default: PCL branch towns")
    ap.add_argument("--categories", default="", help="semicolon-separated; default: small-business trades")
    ap.add_argument("--max-requests", type=int, default=0, help="hard stop on API requests (billing guard)")
    ap.add_argument("--delay", type=float, default=0.3)
    ap.add_argument("--dry-run", action="store_true", help="print the query grid, call nothing")
    a = ap.parse_args()
    towns = [t.strip() for t in a.towns.split(";") if t.strip()] or TOWNS
    cats = [c.strip() for c in a.categories.split(";") if c.strip()] or CATEGORIES
    run(towns, cats, a.max_requests, a.delay, a.dry_run)


if __name__ == "__main__":
    main()
