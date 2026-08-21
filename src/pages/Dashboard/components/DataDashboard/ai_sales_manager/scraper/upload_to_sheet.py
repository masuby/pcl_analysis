"""Step 3 - publish clean_leads from the DB to the Google Sheet.

The sheet is the analyst-facing deliverable, so it is laid out per product
rather than as one wide table where half the columns are always blank:

  "LBF Leads"    car owners  - the car the loan would be secured on
  "SME Leads"    businesses  - what the business does and WHERE it trades
  "Unique Leads" one row per phone number across both products (the call list)
  "Summary"      where the data came from, and how much of it is callable

Every row carries the LINK it was taken from, so any figure can be traced back
to the advert it came from.

The sheet is identified by AISM_LEADS_SHEET_ID (shared with the service
account). Tabs are cleared and rewritten, so runs are idempotent.

Usage (from ai_sales_manager/):
  python -m scraper.upload_to_sheet            # publish every tab
  python -m scraper.upload_to_sheet --unique   # only refresh Unique Leads
"""
from __future__ import annotations

import argparse
from datetime import datetime

from app import db
from app.config import settings
from app.tools.sheets import _services, service_account_email

TAB = "Scraped LBF"          # kept for backwards compatibility with old callers
LBF_TAB = "LBF Leads"
SME_TAB = "SME Leads"
UNIQUE_TAB = "Unique Leads"
SUMMARY_TAB = "Summary"

# (header, lead-field) - order defines the sheet layout.
LBF_COLUMNS = [
    ("Date Obtained", "date_obtained"), ("Source", "source"),
    ("Seller Name", "seller_name"), ("Phone", "phone"),
    ("Car Make", "car_make"), ("Car Model", "car_model"), ("Year", "car_year"),
    ("Mileage", "mileage"), ("Body Type", "body_type"), ("Fuel", "fuel_type"),
    ("Condition", "condition"), ("Location", "location"),
    ("Price (advertised)", "price_text"), ("Est. Car Value (TZS)", "est_value_tzs"),
    ("Est. Loan (TZS)", "est_loan_tzs"), ("Score", "score"), ("Why", "reason"),
    ("New/Existing", "flag"), ("Source Link", "source_url"),
]

SME_COLUMNS = [
    ("Date Obtained", "date_obtained"), ("Source", "source"),
    ("Contact Name", "seller_name"), ("Phone", "phone"),
    ("Business Name", "business_name"), ("Business Type", "business_type"),
    ("Sector", "sector"), ("What They Offer", "offering"),
    ("Business Location", "location"), ("Has Shopfront", "has_shopfront"),
    ("Est. Monthly Revenue (TZS)", "est_monthly_revenue_tzs"),
    ("Price (advertised)", "price_text"), ("Est. Business Scale (TZS)", "est_value_tzs"),
    ("Est. Loan (TZS)", "est_loan_tzs"), ("Score", "score"), ("Why", "reason"),
    ("New/Existing", "flag"), ("Source Link", "source_url"),
]

UNIQUE_COLUMNS = [
    ("Product", "product"), ("Date Obtained", "date_obtained"), ("Source", "source"),
    ("Name", "seller_name"), ("Phone", "phone"),
    ("Business / Car", "_what"), ("Location", "location"),
    ("Est. Loan (TZS)", "est_loan_tzs"), ("Score", "score"), ("Why", "reason"),
    ("Source Link", "source_url"),
]

NAVY = {"red": 0.122, "green": 0.22, "blue": 0.392}
WHITE = {"red": 1, "green": 1, "blue": 1}
BLACK = {"red": 0, "green": 0, "blue": 0}
SCORE_COLOURS = {
    "Hot":  ({"red": 0.85, "green": 0.96, "blue": 0.88}, {"red": 0.05, "green": 0.35, "blue": 0.16}),
    "Warm": ({"red": 1.0, "green": 0.95, "blue": 0.78}, {"red": 0.57, "green": 0.25, "blue": 0.05}),
    "Cold": ({"red": 0.95, "green": 0.96, "blue": 0.97}, {"red": 0.29, "green": 0.33, "blue": 0.39}),
}


def _what(lead: dict) -> str:
    """One-line description of the asset/business behind the lead."""
    if (lead.get("product") or "") == "SME":
        return " ".join(x for x in [lead.get("business_name") or "",
                                    lead.get("business_type") or ""] if x).strip()
    return " ".join(x for x in [lead.get("car_make") or "", lead.get("car_model") or "",
                                str(lead.get("car_year") or "")] if x).strip()


def _value(lead: dict, field: str) -> str:
    if field == "_what":
        return _what(lead)
    v = lead.get(field)
    return "" if v is None else str(v)


def _gid_of(sheets, sid: str, tab: str):
    meta = sheets.spreadsheets().get(spreadsheetId=sid).execute()
    for s in meta.get("sheets", []):
        if s["properties"]["title"] == tab:
            return s["properties"]["sheetId"]
    return None


def _ensure_tab(sheets, sid: str, tab: str) -> int:
    gid = _gid_of(sheets, sid, tab)
    if gid is not None:
        return gid
    sheets.spreadsheets().batchUpdate(
        spreadsheetId=sid,
        body={"requests": [{"addSheet": {"properties": {"title": tab}}}]},
    ).execute()
    return _gid_of(sheets, sid, tab)


def _clear_conditional_formats(sheets, sid: str, gid: int) -> None:
    meta = sheets.spreadsheets().get(
        spreadsheetId=sid, fields="sheets(properties(sheetId),conditionalFormats)").execute()
    n = 0
    for s in meta.get("sheets", []):
        if s["properties"]["sheetId"] == gid:
            n = len(s.get("conditionalFormats", []))
    if n:
        sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": [
            {"deleteConditionalFormatRule": {"sheetId": gid, "index": 0}}
            for _ in range(n)]}).execute()


def _format_tab(sheets, sid: str, gid: int, ncols: int, nrows: int, score_col) -> None:
    """Header band, frozen header row, filter, and Hot/Warm/Cold colour chips."""
    reqs = [
        # reset colouring left behind by a previous, longer run
        {"repeatCell": {
            "range": {"sheetId": gid, "startRowIndex": 0, "endRowIndex": max(nrows + 2, 2000),
                      "startColumnIndex": 0, "endColumnIndex": max(ncols, 26)},
            "cell": {"userEnteredFormat": {
                "backgroundColor": WHITE,
                "textFormat": {"bold": False, "foregroundColor": BLACK}}},
            "fields": "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat"}},
        {"repeatCell": {
            "range": {"sheetId": gid, "startRowIndex": 0, "endRowIndex": 1,
                      "startColumnIndex": 0, "endColumnIndex": ncols},
            "cell": {"userEnteredFormat": {
                "backgroundColor": NAVY,
                "textFormat": {"bold": True, "foregroundColor": WHITE},
                "horizontalAlignment": "CENTER", "wrapStrategy": "WRAP"}},
            "fields": ("userEnteredFormat(backgroundColor,textFormat,"
                       "horizontalAlignment,wrapStrategy)")}},
        {"updateSheetProperties": {
            "properties": {"sheetId": gid, "gridProperties": {"frozenRowCount": 1}},
            "fields": "gridProperties.frozenRowCount"}},
    ]
    if nrows:
        reqs.append({"setBasicFilter": {"filter": {"range": {
            "sheetId": gid, "startRowIndex": 0, "endRowIndex": nrows + 1,
            "startColumnIndex": 0, "endColumnIndex": ncols}}}})
        if score_col is not None:
            for label, (bg, fg) in SCORE_COLOURS.items():
                reqs.append({"addConditionalFormatRule": {"index": 0, "rule": {
                    "ranges": [{"sheetId": gid, "startRowIndex": 1, "endRowIndex": nrows + 1,
                                "startColumnIndex": score_col, "endColumnIndex": score_col + 1}],
                    "booleanRule": {
                        "condition": {"type": "TEXT_EQ",
                                      "values": [{"userEnteredValue": label}]},
                        "format": {"backgroundColor": bg,
                                   "textFormat": {"foregroundColor": fg, "bold": True}}}}}})
    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": reqs}).execute()
    # widths last, so it measures the data that is now in place
    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": [
        {"autoResizeDimensions": {"dimensions": {
            "sheetId": gid, "dimension": "COLUMNS", "startIndex": 0, "endIndex": ncols}}}]}).execute()


def _write_table(sheets, sid: str, tab: str, columns, leads: list) -> int:
    """Clear + rewrite one tab from `columns`, then format it."""
    gid = _ensure_tab(sheets, sid, tab)
    headers = [h for h, _ in columns]
    rows = [[_value(l, f) for _, f in columns] for l in leads]

    _clear_conditional_formats(sheets, sid, gid)
    sheets.spreadsheets().values().clear(spreadsheetId=sid, range="'" + tab + "'!A:AZ").execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range="'" + tab + "'!A1",
        valueInputOption="USER_ENTERED", body={"values": [headers] + rows},
    ).execute()

    score_col = headers.index("Score") if "Score" in headers else None
    _format_tab(sheets, sid, gid, len(headers), len(rows), score_col)
    return len(rows)


def _write_summary(sheets, sid: str) -> None:
    gid = _ensure_tab(sheets, sid, SUMMARY_TAB)
    stats = db.stats()
    rows = [
        ["AI DIGITAL AGENT - ACQUIRED LEADS", "", "", "", ""],
        ["Generated", datetime.now().strftime("%d/%m/%Y %H:%M"), "", "", ""],
        ["", "", "", "", ""],
        ["Listing links discovered", stats.get("links", 0), "", "", ""],
        ["Listings detail-scraped", stats.get("detailed", 0), "", "", ""],
        ["Leads structured by AI", stats.get("clean", 0), "", "", ""],
        ["Unique phone numbers (callable)", stats.get("unique", 0), "", "", ""],
        ["", "", "", "", ""],
        ["PRODUCT", "SOURCE", "LEADS", "WITH PHONE", "UNIQUE PHONES"],
    ]
    for r in stats.get("by_product", []):
        rows.append([r["product"], r["source"], r["leads"], r["with_phone"], r["unique_phones"]])

    _clear_conditional_formats(sheets, sid, gid)
    sheets.spreadsheets().values().clear(spreadsheetId=sid, range="'" + SUMMARY_TAB + "'!A:Z").execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range="'" + SUMMARY_TAB + "'!A1",
        valueInputOption="USER_ENTERED", body={"values": rows}).execute()
    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": [
        {"repeatCell": {
            "range": {"sheetId": gid, "startRowIndex": 0, "endRowIndex": 1,
                      "startColumnIndex": 0, "endColumnIndex": 5},
            "cell": {"userEnteredFormat": {"backgroundColor": NAVY,
                     "textFormat": {"bold": True, "foregroundColor": WHITE}}},
            "fields": "userEnteredFormat(backgroundColor,textFormat)"}},
        {"repeatCell": {
            "range": {"sheetId": gid, "startRowIndex": 8, "endRowIndex": 9,
                      "startColumnIndex": 0, "endColumnIndex": 5},
            "cell": {"userEnteredFormat": {"backgroundColor": NAVY,
                     "textFormat": {"bold": True, "foregroundColor": WHITE}}},
            "fields": "userEnteredFormat(backgroundColor,textFormat)"}},
        {"autoResizeDimensions": {"dimensions": {
            "sheetId": gid, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 5}}},
    ]}).execute()


def _sid() -> str:
    sid = settings.leads_sheet_id
    if not sid:
        raise RuntimeError(
            "AISM_LEADS_SHEET_ID is not set. Create a Google Sheet, share it with "
            + str(service_account_email()) + " as Editor, and put its ID in DataDashboard/.env."
        )
    return sid


def publish(log=print) -> dict:
    """Rewrite every tab from the DB. Returns counts + the sheet URL."""
    sid = _sid()
    sheets, _ = _services()

    n_lbf = _write_table(sheets, sid, LBF_TAB, LBF_COLUMNS, db.all_clean_filtered(product="LBF"))
    log("'" + LBF_TAB + "': " + str(n_lbf) + " rows")
    n_sme = _write_table(sheets, sid, SME_TAB, SME_COLUMNS, db.all_clean_filtered(product="SME"))
    log("'" + SME_TAB + "': " + str(n_sme) + " rows")
    n_uniq = _write_table(sheets, sid, UNIQUE_TAB, UNIQUE_COLUMNS,
                          db.unique_clean(newest_first=False))
    log("'" + UNIQUE_TAB + "': " + str(n_uniq) + " rows")
    _write_summary(sheets, sid)

    url = "https://docs.google.com/spreadsheets/d/" + sid + "/edit"
    log("Published -> " + url)
    return {"lbf": n_lbf, "sme": n_sme, "unique": n_uniq, "url": url}


def upload(tab: str = TAB, append: bool = False, log=print) -> str:
    """Backwards-compatible entry point used by run_pipeline: publish everything."""
    return publish(log=log)["url"]


def upload_unique(log=print) -> int:
    sid = _sid()
    sheets, _ = _services()
    n = _write_table(sheets, sid, UNIQUE_TAB, UNIQUE_COLUMNS, db.unique_clean(newest_first=False))
    log("'" + UNIQUE_TAB + "': " + str(n) + " unique people")
    return n


def main() -> None:
    ap = argparse.ArgumentParser(description="Publish clean_leads (DB) to the Google Sheet")
    ap.add_argument("--unique", action="store_true", help="only refresh the Unique Leads tab")
    args = ap.parse_args()
    db.migrate()
    if args.unique:
        upload_unique()
    else:
        publish()


if __name__ == "__main__":
    main()
