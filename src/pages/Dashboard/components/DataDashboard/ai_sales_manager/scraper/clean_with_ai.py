"""Step 2 — AI turns new raw listings into structured leads.

Two products, two shapes:

  LBF — the loan is secured on the borrower's CAR, so we want the car and its
        value. The important judgement is PRIVATE SELLER vs DEALER: a dealer
        advertising stock is not an LBF prospect, an individual selling their
        own car is (they want cash and they own an asset).

  SME — the loan is against a BUSINESS, so we want what the business does and
        how established it looks. The judgement is BUSINESS vs one-off private
        seller: somebody clearing out a single old desk is not an SME prospect.

Only raw rows with no clean_leads row are processed. A phone-based flag marks
whether we have seen that number before ("EXISTING DATA" / "NEW DATA").

Usage (from ai_sales_manager/):
  python -m scraper.clean_with_ai
  python -m scraper.clean_with_ai --product SME --model "groq: llama-3.3-70b"
"""
from __future__ import annotations

import argparse
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from pydantic import BaseModel, Field

from app import db
from app.db import normalize_phone
from app.llm import default_model, invoke_structured


# ── LBF: car owners ──────────────────────────────────────────────────────────

class CarLead(BaseModel):
    seller_name: str = Field(default="", description="Seller or dealer name if present")
    phone: str = Field(default="", description="Seller phone exactly as shown; blank if none")
    car_make: str = Field(default="", description="Vehicle make, e.g. Toyota")
    car_model: str = Field(default="", description="Vehicle model, e.g. Harrier")
    car_year: str = Field(default="", description="Manufacture year")
    mileage: str = Field(default="", description="Mileage as shown, e.g. 70,000 km")
    body_type: str = Field(default="", description="Body type, e.g. SUV")
    fuel_type: str = Field(default="", description="Fuel type, e.g. Petrol")
    condition: str = Field(default="", description="Condition, e.g. Foreign Used / Registered")
    location: str = Field(default="", description="City / region in Tanzania")
    price_text: str = Field(default="", description="Advertised price as written")
    est_value_tzs: str = Field(default="", description="Numeric TZS estimate of the car value, digits only")
    est_loan_tzs: str = Field(default="", description="~60% of est_value_tzs, digits only")
    score: str = Field(default="Cold", description="Hot | Warm | Cold — fit as an LBF prospect")
    reason: str = Field(default="", description="One short line: why this score")


_SYS_LBF = (
    "You clean scraped car-listing text for Platinum Credit Tanzania's LBF product "
    "(a loan SECURED BY THE BORROWER'S CAR). Extract ONLY facts present in the text; "
    "leave a field blank when unknown and NEVER invent a phone number. Convert the "
    "price to a plain TZS integer in est_value_tzs (e.g. '54.8 Million' -> 54800000; "
    "'TSh 35,300,000' -> 35300000; NEGOTIABLE/blank -> leave empty). Set est_loan_tzs "
    "to about 60% of est_value_tzs.\n"
    "SCORING — the prospect is a person who OWNS a car and may want cash against it. "
    "A DEALERSHIP advertising stock is NOT a prospect: if the seller name looks like a "
    "business (Motors, Auto, Cars, Ltd, Garage, Trading, Investment) or the text reads "
    "as a trader, score Cold and say 'dealer' in reason. "
    "Hot = an individual seller, car year >= 2012, a phone is present. "
    "Warm = an individual but older/low-value car, or no phone shown. "
    "Cold = a dealer, or the text is too thin to judge."
)


# ── SME: business owners ─────────────────────────────────────────────────────

class BusinessLead(BaseModel):
    seller_name: str = Field(default="", description="Contact person name if shown")
    phone: str = Field(default="", description="Phone exactly as shown; blank if none")
    business_name: str = Field(default="", description="Trading name of the business, if shown")
    business_type: str = Field(default="", description="What kind of business, e.g. hardware shop, salon, transporter")
    sector: str = Field(default="", description="Broad sector: Retail, Services, Construction, Agriculture, Transport, Manufacturing, Other")
    offering: str = Field(default="", description="What they sell or the service they provide, one short line")
    location: str = Field(default="", description="Where the business trades, as specifically as the text allows: 'Area/street, City' e.g. 'Kariakoo, Dar es Salaam'. Never guess a city that is not in the text.")
    price_text: str = Field(default="", description="Advertised price/rate as written, if any")
    est_monthly_revenue_tzs: str = Field(default="", description="Rough TZS monthly turnover if the text supports a guess, digits only; else blank")
    has_shopfront: str = Field(default="", description="Yes / No / Unknown — does the text suggest a physical premises")
    est_value_tzs: str = Field(default="", description="Rough TZS scale of the business if inferable, digits only")
    est_loan_tzs: str = Field(default="", description="Rough loan potential in TZS, digits only")
    score: str = Field(default="Cold", description="Hot | Warm | Cold — fit as an SME prospect")
    reason: str = Field(default="", description="One short line: why this score")


_SYS_SME = (
    "You clean scraped classified-ad text for Platinum Credit Tanzania's SME product "
    "(a working-capital loan to a BUSINESS OWNER). Extract ONLY facts present in the "
    "text; leave a field blank when unknown and NEVER invent a phone number.\n"
    "SCORING — the prospect is somebody who RUNS A BUSINESS and could use working "
    "capital. A private individual selling one second-hand household item is NOT a "
    "prospect. Signals of a real business: a trading name, multiple items or stock, "
    "wholesale/bulk language, a service offered professionally, a shopfront or "
    "workshop, delivery or installation offered, 'we' rather than 'I'.\n"
    "Hot = a clear ongoing business, evidence of stock or regular trade, phone present. "
    "Warm = probably a business but thin evidence, or no phone shown. "
    "Cold = a one-off private sale, or the text is too thin to judge. "
    "Put the deciding signal in reason.\n"
    "LOCATION matters: a branch officer has to visit. Give the most specific place "
    "the advert supports - neighbourhood/street plus the town or city (e.g. "
    "'Kariakoo, Dar es Salaam'). If only a region is stated, give that. If the text "
    "names nowhere, leave it blank rather than guessing."
)


# Throughput, not cost, is the binding constraint: the LLM account is capped on
# TOKENS PER MINUTE, so every token of page furniture we send is a listing we
# cannot clean this minute. The extractors put the useful part first (Title,
# Price, Phone, Attributes, About) and pad the tail with page text, so trimming
# the tail roughly triples the number of listings cleaned per minute.
RAW_CHAR_BUDGET = 1200


def _trim(raw: str, budget: int = RAW_CHAR_BUDGET) -> str:
    raw = (raw or "").strip()
    if len(raw) <= budget:
        return raw
    cut = raw.rfind("\n", 0, budget)      # prefer a line boundary
    return raw[: cut if cut > budget // 2 else budget]


def clean_one(model: str, raw: str, source_url: str, product: str,
              tries: int = 4) -> dict:
    """Structure one listing according to its product.

    Retries on the provider's rate-limit (429) with a back-off, so a bulk run
    rides through the per-minute ceiling instead of dropping listings.
    """
    if product == "SME":
        system, schema = _SYS_SME, BusinessLead
    else:
        system, schema = _SYS_LBF, CarLead
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Listing:\n{_trim(raw)}\n\nSource URL: {source_url}"},
    ]
    for attempt in range(1, tries + 1):
        try:
            lead = invoke_structured(model, schema, messages)
            return lead.model_dump() if lead else {}
        except Exception as exc:  # noqa: BLE001
            text = str(exc)
            rate_limited = "429" in text or "rate_limit" in text.lower()
            if not rate_limited or attempt == tries:
                raise
            wait = _retry_after(text, attempt)
            time.sleep(wait)
    return {}


class CarLeadBatch(BaseModel):
    """A batch of car listings, in the same order they were given."""
    leads: list[CarLead] = Field(default_factory=list)


class BusinessLeadBatch(BaseModel):
    """A batch of business listings, in the same order they were given."""
    leads: list[BusinessLead] = Field(default_factory=list)


_BATCH_NOTE = (
    "\nYou are given SEVERAL listings, each introduced by a line '### LISTING <n>'. "
    "Return one entry in `leads` for EVERY listing, in the SAME ORDER, even when a "
    "listing is too thin to score (return blanks and score Cold). Never merge two "
    "listings and never reorder them."
)


def clean_batch(model: str, rows: list[dict], product: str, tries: int = 4) -> list[dict]:
    """Structure several listings in ONE call.

    The account is capped on tokens-per-minute, and the fixed cost of a call (the
    instructions plus the output schema) is far larger than one listing, so
    sending listings one at a time spends most of the budget re-sending the same
    preamble. Batching amortises it and roughly triples the listings cleaned per
    minute. If the model returns the wrong number of entries the batch is
    discarded and the caller falls back to one-at-a-time, so a bad batch can
    never shift fields onto the wrong lead.
    """
    if product == "SME":
        system, schema = _SYS_SME + _BATCH_NOTE, BusinessLeadBatch
    else:
        system, schema = _SYS_LBF + _BATCH_NOTE, CarLeadBatch

    parts = []
    for i, row in enumerate(rows, 1):
        parts.append(f"### LISTING {i}\n{_trim(row['raw_data'])}\nSource URL: {row['source_url']}")
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n\n".join(parts)},
    ]

    for attempt in range(1, tries + 1):
        try:
            out = invoke_structured(model, schema, messages)
            leads = list(getattr(out, "leads", []) or []) if out else []
            if len(leads) != len(rows):
                return []          # misaligned - caller retries individually
            return [l.model_dump() for l in leads]
        except Exception as exc:  # noqa: BLE001
            text = str(exc)
            if ("429" not in text and "rate_limit" not in text.lower()) or attempt == tries:
                raise
            time.sleep(_retry_after(text, attempt))
    return []


def _retry_after(message: str, attempt: int) -> float:
    """Honour the 'try again in 8.24s' hint when the provider gives one."""
    m = re.search(r"try again in ([\d.]+)s", message)
    if m:
        try:
            return min(30.0, float(m.group(1)) + 0.5)
        except ValueError:
            pass
    return min(30.0, 2.0 * attempt)


def clean(model: str | None = None, product: str = "", source: str = "",
          log=print, should_stop=lambda: False, workers: int = 1,
          limit: int = 0, batch: int = 1, offset: int = 0) -> dict:
    """Structure every un-cleaned raw listing.

    `workers` > 1 runs the LLM calls concurrently. `batch` > 1 sends several
    listings per call, which is what actually raises throughput when the account
    is capped on tokens-per-minute rather than on requests. A batch that comes
    back the wrong length is retried listing-by-listing, so batching never
    risks attributing one advert's details to another.
    """
    todo = db.raw_uncleaned(product=product, source=source)
    if offset and offset > 0:
        todo = todo[offset:]
    if limit and limit > 0:
        todo = todo[:limit]
    seen = db.seen_phone_norms()
    model = model or default_model()
    workers = max(1, int(workers or 1))
    batch = max(1, int(batch or 1))
    log(f"{len(todo)} new listings to clean (model: {model}, workers: {workers}, batch: {batch})")

    lock = threading.Lock()
    buffer: list[dict] = []
    counts = {"new": 0, "exist": 0, "processed": 0, "nophone": 0, "failed": 0}
    done = 0

    def flush(force: bool = False) -> None:
        nonlocal buffer
        if buffer and (force or len(buffer) >= 20):
            db.insert_clean_many(buffer)
            buffer = []

    def work(row: dict) -> dict | None:
        raw = row["raw_data"] or ""
        if not raw.strip():
            return None
        row_product = row.get("product") or "LBF"
        try:
            data = clean_one(model, raw, row["source_url"], row_product)
        except Exception as exc:  # noqa: BLE001
            with lock:
                counts["failed"] += 1
            log(f"  FAILED {row['source_url']}: {exc}")
            return None
        if not data:
            return None
        norm = normalize_phone(data.get("phone", ""))
        with lock:
            if not norm:
                counts["nophone"] += 1
                flag = "NEW DATA"
                counts["new"] += 1
            elif norm in seen:
                flag = "EXISTING DATA"
                counts["exist"] += 1
            else:
                flag = "NEW DATA"
                counts["new"] += 1
                seen.add(norm)
        data.update(source_url=row["source_url"], phone_norm=norm, flag=flag,
                    product=row_product, source=row.get("source") or "",
                    date_obtained=row.get("date_obtained") or "")
        return data

    def record(row: dict, data: dict) -> dict | None:
        """Apply the phone-dedup flag and stamp provenance onto one cleaned row."""
        if not data:
            return None
        norm = normalize_phone(data.get("phone", ""))
        with lock:
            if not norm:
                counts["nophone"] += 1
                flag = "NEW DATA"
                counts["new"] += 1
            elif norm in seen:
                flag = "EXISTING DATA"
                counts["exist"] += 1
            else:
                flag = "NEW DATA"
                counts["new"] += 1
                seen.add(norm)
        data.update(source_url=row["source_url"], phone_norm=norm, flag=flag,
                    product=row.get("product") or "LBF",
                    source=row.get("source") or "",
                    date_obtained=row.get("date_obtained") or "")
        return data

    def work_batch(rows: list[dict]) -> list[dict]:
        """Clean a group in one call, falling back to one-at-a-time if it misaligns."""
        usable = [r for r in rows if (r.get("raw_data") or "").strip()]
        if not usable:
            return []
        group_product = usable[0].get("product") or "LBF"
        try:
            results = clean_batch(model, usable, group_product)
        except Exception as exc:  # noqa: BLE001
            log(f"  batch FAILED ({len(usable)} listings): {exc}")
            results = []
        if not results:
            # misaligned or errored - do them individually so nothing is lost
            out = []
            for r in usable:
                d = work(r)
                if d:
                    out.append(d)
            return out
        out = []
        for r, data in zip(usable, results):
            d = record(r, data)
            if d:
                out.append(d)
        return out

    if batch > 1:
        groups = [todo[i:i + batch] for i in range(0, len(todo), batch)]
        if workers > 1:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = [pool.submit(work_batch, g) for g in groups]
                try:
                    for fut in as_completed(futures):
                        done += batch
                        if should_stop():
                            log("  stop requested - cancelling remaining work")
                            for f in futures:
                                f.cancel()
                            break
                        for data in fut.result():
                            buffer.append(data)
                            counts["processed"] += 1
                        if counts["processed"] % 40 < batch:
                            log(f"  [{min(done, len(todo))}/{len(todo)}] cleaned "
                                f"{counts['processed']} ({counts['new']} NEW, "
                                f"{counts['exist']} EXISTING)")
                        flush()
                finally:
                    flush(force=True)
        else:
            for gi, group in enumerate(groups, 1):
                if should_stop():
                    log("  stop requested - flushing progress and halting")
                    break
                for data in work_batch(group):
                    buffer.append(data)
                    counts["processed"] += 1
                done = min(gi * batch, len(todo))
                log(f"  [{done}/{len(todo)}] cleaned {counts['processed']} "
                    f"({counts['new']} NEW, {counts['exist']} EXISTING)")
                flush()
    elif workers == 1:
        for i, row in enumerate(todo, 1):
            if should_stop():
                log("  stop requested - flushing progress and halting")
                break
            data = work(row)
            if not data:
                continue
            buffer.append(data)
            counts["processed"] += 1
            done = i
            log(f"  [{i}/{len(todo)}] {data.get('product')} {data.get('score','')} {data.get('flag')}")
            flush()
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(work, row): row for row in todo}
            try:
                for fut in as_completed(futures):
                    done += 1
                    if should_stop():
                        log("  stop requested - cancelling remaining work")
                        for f in futures:
                            f.cancel()
                        break
                    data = fut.result()
                    if not data:
                        continue
                    buffer.append(data)
                    counts["processed"] += 1
                    if counts["processed"] % 25 == 0:
                        log(f"  [{done}/{len(todo)}] cleaned {counts['processed']} "
                            f"({counts['new']} NEW, {counts['exist']} EXISTING)")
                    flush()
            finally:
                flush(force=True)
    flush(force=True)

    total = db.count_clean()
    log(f"cleaned store now {total} leads (+{counts['processed']}: {counts['new']} NEW, "
        f"{counts['exist']} EXISTING, {counts['nophone']} without a phone, "
        f"{counts['failed']} failed)")
    return {"cleaned_new": counts["processed"], "new_data": counts["new"],
            "existing_data": counts["exist"], "no_phone": counts["nophone"],
            "failed": counts["failed"], "total_cleaned": total,
            "new_leads": db.all_clean(limit=counts["processed"]) if counts["processed"] else []}


def main() -> None:
    ap = argparse.ArgumentParser(description="AI-clean new raw listings -> clean_leads")
    ap.add_argument("--model", default=None, help="LLM id from /models")
    ap.add_argument("--product", default="", help="LBF | SME (default: all pending)")
    ap.add_argument("--source", default="", help="restrict to one source key")
    ap.add_argument("--workers", type=int, default=1, help="concurrent LLM calls")
    ap.add_argument("--batch", type=int, default=1,
                    help="listings per LLM call (amortises the prompt+schema cost)")
    ap.add_argument("--limit", type=int, default=0, help="stop after N listings")
    ap.add_argument("--offset", type=int, default=0,
                    help="skip the first N pending listings (to split a backfill)")
    ap.add_argument("--loop", action="store_true",
                    help="keep cleaning until nothing is pending (use while a crawl runs)")
    args = ap.parse_args()
    db.migrate()
    while True:
        result = clean(args.model, args.product, args.source, workers=args.workers,
                       limit=args.limit, batch=args.batch, offset=args.offset)
        if not args.loop or result["cleaned_new"] == 0:
            break
        time.sleep(5)


if __name__ == "__main__":
    main()
