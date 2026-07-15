"""Step 2 - AI cleans NEW raw_listings rows into clean_leads.

Only raw rows without a clean_leads row are processed (the unique/new data).
Each is turned into a structured LBF lead (Groq by default). A phone-based flag
marks whether we've seen that number before:
  * phone already in clean_leads -> "EXISTING DATA"
  * new phone                    -> "NEW DATA"

Usage (from ai_sales_manager/):
  python -m scraper.clean_with_ai
  python -m scraper.clean_with_ai --model "groq: llama-3.3-70b"
"""
from __future__ import annotations

import argparse

from pydantic import BaseModel, Field

from app import db
from app.db import LEAD_FIELDS as FIELDS, normalize_phone
from app.llm import default_model, invoke_structured


class CleanLead(BaseModel):
    seller_name: str = Field(default="", description="Seller or dealer name if present")
    phone: str = Field(default="", description="Seller phone exactly as shown; blank if none")
    car_make: str = Field(default="", description="Vehicle make, e.g. Toyota")
    car_model: str = Field(default="", description="Vehicle model, e.g. Harrier")
    car_year: str = Field(default="", description="Manufacture year")
    mileage: str = Field(default="", description="Mileage as shown, e.g. 70,000 km")
    body_type: str = Field(default="", description="Body type, e.g. SUV")
    fuel_type: str = Field(default="", description="Fuel type, e.g. Petrol")
    condition: str = Field(default="", description="Condition, e.g. Import / Used")
    location: str = Field(default="", description="City / region in Tanzania")
    price_text: str = Field(default="", description="Advertised price as written")
    est_value_tzs: str = Field(default="", description="Numeric TZS estimate of the car value, digits only")
    est_loan_tzs: str = Field(default="", description="~60% of est_value_tzs, digits only")
    score: str = Field(default="Cold", description="Hot | Warm | Cold - fit as an LBF prospect")
    reason: str = Field(default="", description="One short line: why this score")


_SYS = (
    "You clean scraped car-listing text for Platinum Credit Tanzania's LBF product "
    "(a loan SECURED BY THE BORROWER'S CAR). Extract ONLY facts present in the text; "
    "leave a field blank when unknown and NEVER invent phone numbers. Convert the price "
    "to a plain TZS integer in est_value_tzs (e.g. '54.8 Million' -> 54800000; 'TSh "
    "35,300,000' -> 35300000; NEGOTIABLE / blank -> leave empty). Set est_loan_tzs to "
    "about 60% of est_value_tzs. Score: Hot = recent valuable car (year >= 2012) AND a "
    "phone present; Warm = a car but weak value or no phone; Cold = thin/unclear."
)


def clean_one(model: str, raw: str, source_url: str) -> dict:
    messages = [
        {"role": "system", "content": _SYS},
        {"role": "user", "content": f"Listing:\n{raw}\n\nSource URL: {source_url}"},
    ]
    lead = invoke_structured(model, CleanLead, messages)
    return lead.model_dump() if lead else {}


def clean(model: str | None = None, log=print, should_stop=lambda: False) -> dict:
    todo = db.raw_uncleaned()
    seen = db.seen_phone_norms()
    model = model or default_model()
    log(f"{len(todo)} new listings to clean (model: {model})")

    buffer: list[dict] = []
    n_new, n_exist, processed = 0, 0, 0
    for i, row in enumerate(todo, 1):
        if should_stop():
            log("  stop requested - flushing progress and halting")
            break
        raw = row["raw_data"] or ""
        url = row["source_url"]
        date_obtained = row["date_obtained"] or ""
        if not raw.strip():
            continue
        try:
            data = clean_one(model, raw, url)
        except Exception as exc:  # noqa: BLE001
            log(f"  [{i}/{len(todo)}] FAILED: {exc}")
            continue

        norm = normalize_phone(data.get("phone", ""))
        if norm and norm in seen:
            flag, n_exist = "EXISTING DATA", n_exist + 1
        else:
            flag, n_new = "NEW DATA", n_new + 1
            if norm:
                seen.add(norm)

        data.update(source_url=url, phone_norm=norm, date_obtained=date_obtained, flag=flag)
        buffer.append(data)
        processed += 1
        log(f"  [{i}/{len(todo)}] {flag}")
        if len(buffer) >= 20:
            db.insert_clean_many(buffer)
            buffer = []
    db.insert_clean_many(buffer)

    total = db.count_clean()
    log(f"cleaned store now {total} leads (+{processed}: {n_new} NEW, {n_exist} EXISTING)")
    new_leads = db.all_clean(limit=processed) if processed else []
    return {"cleaned_new": processed, "new_data": n_new, "existing_data": n_exist,
            "total_cleaned": total, "new_leads": new_leads}


def main() -> None:
    ap = argparse.ArgumentParser(description="AI-clean new raw listings -> clean_leads")
    ap.add_argument("--model", default=None, help="LLM id from /models (default: server default)")
    args = ap.parse_args()
    db.migrate()
    clean(args.model)


if __name__ == "__main__":
    main()
