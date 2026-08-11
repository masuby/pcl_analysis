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
    location: str = Field(default="", description="City / region in Tanzania")
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
    "Put the deciding signal in reason."
)


def clean_one(model: str, raw: str, source_url: str, product: str) -> dict:
    """Structure one listing according to its product."""
    if product == "SME":
        system, schema = _SYS_SME, BusinessLead
    else:
        system, schema = _SYS_LBF, CarLead
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Listing:\n{raw}\n\nSource URL: {source_url}"},
    ]
    lead = invoke_structured(model, schema, messages)
    return lead.model_dump() if lead else {}


def clean(model: str | None = None, product: str = "", source: str = "",
          log=print, should_stop=lambda: False) -> dict:
    todo = db.raw_uncleaned(product=product, source=source)
    seen = db.seen_phone_norms()
    model = model or default_model()
    log(f"{len(todo)} new listings to clean (model: {model})")

    buffer: list[dict] = []
    n_new, n_exist, processed, n_nophone = 0, 0, 0, 0

    for i, row in enumerate(todo, 1):
        if should_stop():
            log("  stop requested - flushing progress and halting")
            break
        raw = row["raw_data"] or ""
        url = row["source_url"]
        row_product = row.get("product") or "LBF"
        if not raw.strip():
            continue
        try:
            data = clean_one(model, raw, url, row_product)
        except Exception as exc:  # noqa: BLE001
            log(f"  [{i}/{len(todo)}] FAILED: {exc}")
            continue
        if not data:
            log(f"  [{i}/{len(todo)}] no structured output")
            continue

        norm = normalize_phone(data.get("phone", ""))
        if not norm:
            n_nophone += 1
        if norm and norm in seen:
            flag, n_exist = "EXISTING DATA", n_exist + 1
        else:
            flag, n_new = "NEW DATA", n_new + 1
            if norm:
                seen.add(norm)

        data.update(source_url=url, phone_norm=norm, flag=flag,
                    product=row_product, source=row.get("source") or "",
                    date_obtained=row.get("date_obtained") or "")
        buffer.append(data)
        processed += 1
        log(f"  [{i}/{len(todo)}] {row_product} {data.get('score', '')} {flag}")
        if len(buffer) >= 20:
            db.insert_clean_many(buffer)
            buffer = []
    db.insert_clean_many(buffer)

    total = db.count_clean()
    log(f"cleaned store now {total} leads (+{processed}: {n_new} NEW, {n_exist} EXISTING, "
        f"{n_nophone} without a phone)")
    return {"cleaned_new": processed, "new_data": n_new, "existing_data": n_exist,
            "no_phone": n_nophone, "total_cleaned": total,
            "new_leads": db.all_clean(limit=processed) if processed else []}


def main() -> None:
    ap = argparse.ArgumentParser(description="AI-clean new raw listings -> clean_leads")
    ap.add_argument("--model", default=None, help="LLM id from /models")
    ap.add_argument("--product", default="", help="LBF | SME (default: all pending)")
    ap.add_argument("--source", default="", help="restrict to one source key")
    args = ap.parse_args()
    db.migrate()
    clean(args.model, args.product, args.source)


if __name__ == "__main__":
    main()
