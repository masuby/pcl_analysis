"""Step 3 - upload clean_leads from the DB to the Google Sheet.

  "Scraped LBF"  -> every cleaned lead (with NEW/EXISTING flag + date)
  "Unique Leads" -> one row per unique phone number (people to call)

The sheet is identified by AISM_LEADS_SHEET_ID (created + shared with the
service account). Tabs are cleared and rewritten, so runs are idempotent.

Usage (from ai_sales_manager/):
  python -m scraper.upload_to_sheet
  python -m scraper.upload_to_sheet --unique
"""
from __future__ import annotations

import argparse

from app import db
from app.config import settings
from app.db import LEAD_FIELDS as FIELDS
from app.tools.sheets import _services, service_account_email

TAB = "Scraped LBF"
UNIQUE_TAB = "Unique Leads"


def _ensure_tab(sheets, sid: str, tab: str) -> None:
    meta = sheets.spreadsheets().get(spreadsheetId=sid).execute()
    titles = {s["properties"]["title"] for s in meta.get("sheets", [])}
    if tab not in titles:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=sid,
            body={"requests": [{"addSheet": {"properties": {"title": tab}}}]},
        ).execute()


def _write_tab(sheets, sid: str, tab: str, leads: list[dict]) -> int:
    _ensure_tab(sheets, sid, tab)
    rows = [[l.get(f, "") for f in FIELDS] for l in leads]
    sheets.spreadsheets().values().clear(spreadsheetId=sid, range=f"'{tab}'!A:Z").execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range=f"'{tab}'!A1",
        valueInputOption="USER_ENTERED", body={"values": [FIELDS] + rows},
    ).execute()
    return len(rows)


def _sid() -> str:
    sid = settings.leads_sheet_id
    if not sid:
        raise RuntimeError(
            "AISM_LEADS_SHEET_ID is not set. Create a Google Sheet, share it with "
            f"{service_account_email()} as Editor, and put its ID in DataDashboard/.env."
        )
    return sid


def upload(tab: str = TAB, append: bool = False, log=print) -> str:
    sid = _sid()
    sheets, _ = _services()
    n = _write_tab(sheets, sid, tab, db.all_clean(newest_first=False))
    url = f"https://docs.google.com/spreadsheets/d/{sid}/edit"
    log(f"Uploaded {n} leads to '{tab}' -> {url}")
    return url


def upload_unique(log=print) -> int:
    sid = _sid()
    sheets, _ = _services()
    n = _write_tab(sheets, sid, UNIQUE_TAB, db.unique_clean(newest_first=False))
    log(f"Uploaded {n} unique people to '{UNIQUE_TAB}'")
    return n


def main() -> None:
    ap = argparse.ArgumentParser(description="Upload clean_leads (DB) to the Google Sheet")
    ap.add_argument("--tab", default=TAB, help="target sheet tab for all leads")
    ap.add_argument("--unique", action="store_true", help="also (re)write the Unique Leads tab")
    args = ap.parse_args()
    db.migrate()
    upload(args.tab)
    if args.unique:
        upload_unique()


if __name__ == "__main__":
    main()
