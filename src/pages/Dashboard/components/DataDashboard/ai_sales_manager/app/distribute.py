"""Hand the acquired leads to the call centre.

The agent's own sheet is a research artefact; this is the working copy. Unique
leads (one row per phone number) are pushed into a per-product workbook that the
call centre actually calls from:

    LBF AI Digital Agent Data  ->  "{Month} AI Data 2026"
    SME AI Digital Agent Data  ->  "{Month} AI Data 2026"

Columns match the call-centre sheets already in use, so an agent does not have
to learn a new layout:

    Product | Location | Name | Date | Source Link | Assigned_to |
    Phone Number | Feedback | is_converted? | Loan Amount

`Feedback` and `is_converted?` are dropdowns; the remaining blanks are the
call centre's to fill in.

Distribution is INCREMENTAL: a phone number already present in the month's tab
is skipped, so re-running never duplicates a lead and never overwrites feedback
that has already been typed in.

A service account has no Drive quota and cannot create the workbooks itself, so
each one must be created by a person and shared with the service-account address
as Editor; its id goes in AISM_LBF_SHEET_ID / AISM_SME_SHEET_ID.
"""
from __future__ import annotations

import re
from datetime import date

from . import db
from .config import settings
from .tools.sheets import _services, service_account_email

# (header, lead field) — "" means the call centre fills it in.
COLUMNS = [
    ("Product", "product"),
    ("Location", "location"),
    ("Name", "_name"),
    ("Date", "date_obtained"),
    ("Source Link", "source_url"),
    ("Assigned_to", ""),
    ("Phone Number", "phone"),
    ("Feedback", ""),
    ("is_converted?", ""),
    ("Loan Amount", ""),
]

# The call centre's existing feedback vocabulary (12 options).
FEEDBACK_OPTIONS = [
    "Not picking", "Not interested", "Request callback", "Not reachable",
    "Not qualified", "Request more time", "Failed to connect",
    "Duplicated number", "Qualified for SME", "Qualified for CS",
    "Converted", "Referred",
]
YES_NO = ["Yes", "No"]

MONTHS = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"]

NAVY = {"red": 0.122, "green": 0.22, "blue": 0.392}
WHITE = {"red": 1, "green": 1, "blue": 1}
BLACK = {"red": 0, "green": 0, "blue": 0}


def tab_name(month: str = "", year: int = 0) -> str:
    today = date.today()
    m = (month or MONTHS[today.month - 1]).strip().title()
    return f"{m} AI Data {year or today.year}"


def _display_name(lead: dict) -> str:
    """Who to ask for on the phone: the business if there is one, else the seller."""
    return (lead.get("business_name") or lead.get("seller_name") or "").strip()


def _digits(phone: str) -> str:
    d = re.sub(r"\D", "", str(phone or ""))
    return d[-9:] if len(d) >= 9 else d


def _value(lead: dict, field: str) -> str:
    if not field:
        return ""
    if field == "_name":
        return _display_name(lead)
    v = lead.get(field)
    return "" if v is None else str(v)


def _gid(sheets, sid: str, tab: str):
    meta = sheets.spreadsheets().get(spreadsheetId=sid).execute()
    for s in meta.get("sheets", []):
        if s["properties"]["title"] == tab:
            return s["properties"]["sheetId"]
    return None


def _ensure_tab(sheets, sid: str, tab: str) -> tuple[int, bool]:
    """Return (sheetId, created_now)."""
    gid = _gid(sheets, sid, tab)
    if gid is not None:
        return gid, False
    sheets.spreadsheets().batchUpdate(
        spreadsheetId=sid,
        body={"requests": [{"addSheet": {"properties": {"title": tab}}}]},
    ).execute()
    return _gid(sheets, sid, tab), True


def _existing_phones(sheets, sid: str, tab: str) -> set[str]:
    """Phone numbers already distributed into this tab."""
    headers = [h for h, _ in COLUMNS]
    col = chr(ord("A") + headers.index("Phone Number"))
    try:
        got = sheets.spreadsheets().values().get(
            spreadsheetId=sid, range=f"'{tab}'!{col}2:{col}").execute().get("values", [])
    except Exception:  # noqa: BLE001
        return set()
    return {_digits(r[0]) for r in got if r and _digits(r[0])}


def _dropdown(gid: int, col: int, start_row: int, end_row: int, values: list[str]) -> dict:
    return {"setDataValidation": {
        "range": {"sheetId": gid, "startRowIndex": start_row, "endRowIndex": end_row,
                  "startColumnIndex": col, "endColumnIndex": col + 1},
        "rule": {"condition": {"type": "ONE_OF_LIST",
                               "values": [{"userEnteredValue": v} for v in values]},
                 "showCustomUi": True, "strict": False}}}


def _format(sheets, sid: str, gid: int, nrows: int) -> None:
    """Header band, frozen header, dropdowns over the data plus room to grow."""
    headers = [h for h, _ in COLUMNS]
    ncols = len(headers)
    fb_col = headers.index("Feedback")
    conv_col = headers.index("is_converted?")
    last = max(nrows + 1, 1000)          # leave validation in place for future rows
    reqs = [
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
        _dropdown(gid, fb_col, 1, last, FEEDBACK_OPTIONS),
        _dropdown(gid, conv_col, 1, last, YES_NO),
        {"autoResizeDimensions": {"dimensions": {
            "sheetId": gid, "dimension": "COLUMNS", "startIndex": 0, "endIndex": ncols}}},
    ]
    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": reqs}).execute()


def _share(drive, sid: str, email: str | None) -> None:
    if not email:
        return
    try:
        drive.permissions().create(
            fileId=sid, sendNotificationEmail=False,
            body={"type": "user", "role": "writer", "emailAddress": email},
        ).execute()
    except Exception:  # noqa: BLE001
        pass          # already shared, or not permitted — not worth failing the run


def _sheet_id_for(product: str) -> str | None:
    return settings.lbf_sheet_id if product == "LBF" else settings.sme_sheet_id


def distribute_product(product: str, month: str = "", log=print) -> dict:
    """Append this product's not-yet-distributed unique leads to its workbook."""
    sid = _sheet_id_for(product)
    if not sid:
        env = "AISM_LBF_SHEET_ID" if product == "LBF" else "AISM_SME_SHEET_ID"
        return {"product": product, "ok": False,
                "error": (f"{env} is not set. Create the \"{product} AI Digital Agent Data\" "
                          f"workbook, share it with {service_account_email()} as Editor, "
                          f"then put its id in DataDashboard/.env as {env}.")}

    sheets, drive = _services()
    tab = tab_name(month)
    gid, created = _ensure_tab(sheets, sid, tab)

    headers = [h for h, _ in COLUMNS]
    if created:
        sheets.spreadsheets().values().update(
            spreadsheetId=sid, range=f"'{tab}'!A1",
            valueInputOption="RAW", body={"values": [headers]}).execute()

    already = _existing_phones(sheets, sid, tab)
    leads = [l for l in db.unique_clean(newest_first=False)
             if (l.get("product") or "") == product and _digits(l.get("phone", ""))]
    fresh = [l for l in leads if _digits(l["phone"]) not in already]

    if fresh:
        rows = [[_value(l, f) for _, f in COLUMNS] for l in fresh]
        sheets.spreadsheets().values().append(
            spreadsheetId=sid, range=f"'{tab}'!A1",
            valueInputOption="USER_ENTERED", insertDataOption="INSERT_ROWS",
            body={"values": rows}).execute()

    total = len(already) + len(fresh)
    _format(sheets, sid, gid, total)
    _share(drive, sid, settings.leads_owner_email)

    url = f"https://docs.google.com/spreadsheets/d/{sid}/edit#gid={gid}"
    log(f"{product}: +{len(fresh)} new (of {len(leads)} unique) -> '{tab}'")
    return {"product": product, "ok": True, "tab": tab, "url": url,
            "added": len(fresh), "already_there": len(already),
            "total_in_tab": total, "unique_available": len(leads)}


def distribute(month: str = "", log=print) -> dict:
    """Distribute both products; each reports independently."""
    results = [distribute_product(p, month, log) for p in ("LBF", "SME")]
    return {
        "ok": any(r.get("ok") for r in results),
        "month": tab_name(month),
        "service_account_email": service_account_email(),
        "results": results,
    }
