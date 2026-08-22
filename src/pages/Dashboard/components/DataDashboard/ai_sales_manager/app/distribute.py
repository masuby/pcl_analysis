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
LINE = {"red": 0.851, "green": 0.871, "blue": 0.906}
BAND = {"red": 0.965, "green": 0.973, "blue": 0.984}

# Column widths, in the COLUMNS order, so every header reads in full without
# the reader having to drag anything.
COL_WIDTHS = [80, 170, 230, 105, 330, 140, 140, 165, 115, 130]

# Feedback colours — the same palette the Social Media call-centre sheets use,
# so an agent moving between the two reads the same colour the same way.
# value -> (background, text)
FEEDBACK_COLOURS = {
    "Not picking":       ((0.953, 0.957, 0.965), (0.294, 0.333, 0.388)),
    "Not reachable":     ((0.898, 0.906, 0.922), (0.216, 0.255, 0.318)),
    "Failed to connect": ((0.996, 0.894, 0.886), (0.498, 0.114, 0.114)),
    "Not interested":    ((0.996, 0.886, 0.886), (0.600, 0.106, 0.106)),
    "Not qualified":     ((0.996, 0.792, 0.792), (0.498, 0.114, 0.114)),
    "Request callback":  ((0.996, 0.953, 0.780), (0.573, 0.251, 0.055)),
    "Request more time": ((1.000, 0.929, 0.835), (0.604, 0.204, 0.071)),
    "Duplicated number": ((0.914, 0.835, 1.000), (0.420, 0.129, 0.659)),
    "Qualified for SME": ((0.820, 0.980, 0.898), (0.024, 0.373, 0.275)),
    "Qualified for CS":  ((0.812, 0.980, 0.996), (0.082, 0.369, 0.459)),
    "Referred":          ((0.988, 0.906, 0.953), (0.616, 0.090, 0.302)),
    "Converted":         ((0.863, 0.988, 0.906), (0.078, 0.325, 0.176)),
}
CONVERTED_COLOURS = {
    "Yes": ((0.863, 0.988, 0.906), (0.078, 0.325, 0.176)),
    "No":  ((0.953, 0.957, 0.965), (0.294, 0.333, 0.388)),
}


def _rgb(t):
    return {"red": t[0], "green": t[1], "blue": t[2]}


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


def _clear_conditional_formats(sheets, sid: str, gid: int) -> None:
    meta = sheets.spreadsheets().get(
        spreadsheetId=sid, fields="sheets(properties(sheetId),conditionalFormats)").execute()
    n = next((len(s.get("conditionalFormats", [])) for s in meta.get("sheets", [])
              if s["properties"]["sheetId"] == gid), 0)
    if n:
        sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": [
            {"deleteConditionalFormatRule": {"sheetId": gid, "index": 0}} for _ in range(n)]}).execute()


def _colour_rule(gid: int, col: int, end_row: int, value: str, bg, fg) -> dict:
    return {"addConditionalFormatRule": {"index": 0, "rule": {
        "ranges": [{"sheetId": gid, "startRowIndex": 1, "endRowIndex": end_row,
                    "startColumnIndex": col, "endColumnIndex": col + 1}],
        "booleanRule": {
            "condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": value}]},
            "format": {"backgroundColor": _rgb(bg),
                       "textFormat": {"foregroundColor": _rgb(fg), "bold": True}}}}}}


def _format(sheets, sid: str, gid: int, nrows: int) -> None:
    """Make the tab readable at a glance and workable for a whole month.

    A caller scans this sheet all day, so the status they are about to change is
    colour-coded (same palette as the Social Media call-centre sheets), the
    header stays put, columns are wide enough to read without dragging, and rows
    alternate faintly so the eye keeps its place across ten columns.
    """
    headers = [h for h, _ in COLUMNS]
    ncols = len(headers)
    fb_col = headers.index("Feedback")
    conv_col = headers.index("is_converted?")
    link_col = headers.index("Source Link")
    amt_col = headers.index("Loan Amount")
    last = max(nrows + 1, 1000)          # leave formatting in place for future rows

    _clear_conditional_formats(sheets, sid, gid)

    border = {"style": "SOLID", "color": LINE}
    reqs = [
        # plain ground first, so a shorter run never leaves old colour behind
        {"repeatCell": {
            "range": {"sheetId": gid, "startRowIndex": 0, "endRowIndex": last,
                      "startColumnIndex": 0, "endColumnIndex": max(ncols, 26)},
            "cell": {"userEnteredFormat": {
                "backgroundColor": WHITE,
                "textFormat": {"bold": False, "foregroundColor": BLACK, "fontSize": 10},
                "verticalAlignment": "MIDDLE"}},
            "fields": ("userEnteredFormat(backgroundColor,textFormat,verticalAlignment)")}},
        # header band
        {"repeatCell": {
            "range": {"sheetId": gid, "startRowIndex": 0, "endRowIndex": 1,
                      "startColumnIndex": 0, "endColumnIndex": ncols},
            "cell": {"userEnteredFormat": {
                "backgroundColor": NAVY,
                "textFormat": {"bold": True, "foregroundColor": WHITE, "fontSize": 10},
                "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE",
                "wrapStrategy": "WRAP"}},
            "fields": ("userEnteredFormat(backgroundColor,textFormat,"
                       "horizontalAlignment,verticalAlignment,wrapStrategy)")}},
        {"updateDimensionProperties": {
            "range": {"sheetId": gid, "dimension": "ROWS", "startIndex": 0, "endIndex": 1},
            "properties": {"pixelSize": 38}, "fields": "pixelSize"}},
        # freeze the header AND the product column so context survives scrolling
        {"updateSheetProperties": {
            "properties": {"sheetId": gid,
                           "gridProperties": {"frozenRowCount": 1, "frozenColumnCount": 1}},
            "fields": "gridProperties(frozenRowCount,frozenColumnCount)"}},
        _dropdown(gid, fb_col, 1, last, FEEDBACK_OPTIONS),
        _dropdown(gid, conv_col, 1, last, YES_NO),
    ]

    # explicit widths — every header reads in full
    for i, w in enumerate(COL_WIDTHS[:ncols]):
        reqs.append({"updateDimensionProperties": {
            "range": {"sheetId": gid, "dimension": "COLUMNS",
                      "startIndex": i, "endIndex": i + 1},
            "properties": {"pixelSize": w}, "fields": "pixelSize"}})

    # the long link column should clip rather than blow the row height open
    reqs.append({"repeatCell": {
        "range": {"sheetId": gid, "startRowIndex": 1, "endRowIndex": last,
                  "startColumnIndex": link_col, "endColumnIndex": link_col + 1},
        "cell": {"userEnteredFormat": {"wrapStrategy": "CLIP"}},
        "fields": "userEnteredFormat.wrapStrategy"}})

    # money reads as money
    reqs.append({"repeatCell": {
        "range": {"sheetId": gid, "startRowIndex": 1, "endRowIndex": last,
                  "startColumnIndex": amt_col, "endColumnIndex": amt_col + 1},
        "cell": {"userEnteredFormat": {
            "numberFormat": {"type": "NUMBER", "pattern": "#,##0"},
            "horizontalAlignment": "RIGHT"}},
        "fields": "userEnteredFormat(numberFormat,horizontalAlignment)"}})

    if nrows:
        reqs.append({"updateBorders": {
            "range": {"sheetId": gid, "startRowIndex": 0, "endRowIndex": nrows + 1,
                      "startColumnIndex": 0, "endColumnIndex": ncols},
            "innerHorizontal": border, "innerVertical": border,
            "top": border, "bottom": border, "left": border, "right": border}})
        reqs.append({"setBasicFilter": {"filter": {"range": {
            "sheetId": gid, "startRowIndex": 0, "endRowIndex": nrows + 1,
            "startColumnIndex": 0, "endColumnIndex": ncols}}}})
        # faint banding, applied under the status colours
        reqs.append({"addConditionalFormatRule": {"index": 0, "rule": {
            "ranges": [{"sheetId": gid, "startRowIndex": 1, "endRowIndex": nrows + 1,
                        "startColumnIndex": 0, "endColumnIndex": ncols}],
            "booleanRule": {
                "condition": {"type": "CUSTOM_FORMULA",
                              "values": [{"userEnteredValue": "=ISEVEN(ROW())"}]},
                "format": {"backgroundColor": BAND},
            },
        }}})

    # status colours go on last so they sit above the banding rule
    for value, (bg, fg) in CONVERTED_COLOURS.items():
        reqs.append(_colour_rule(gid, conv_col, last, value, bg, fg))
    for value, (bg, fg) in FEEDBACK_COLOURS.items():
        reqs.append(_colour_rule(gid, fb_col, last, value, bg, fg))

    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": reqs}).execute()


def _drop_default_sheet(sheets, sid: str, keep_tab: str) -> None:
    """Remove Google's empty default 'Sheet1' once a real tab exists."""
    meta = sheets.spreadsheets().get(spreadsheetId=sid, fields="sheets.properties").execute()
    props = [s["properties"] for s in meta.get("sheets", [])]
    if len(props) < 2:
        return
    for p in props:
        if p["title"].strip().lower() not in ("sheet1", "sheet 1") or p["title"] == keep_tab:
            continue
        used = sheets.spreadsheets().values().get(
            spreadsheetId=sid, range=f"'{p['title']}'!A1:Z20").execute().get("values", [])
        if used:                      # somebody put something in it — leave it alone
            continue
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=sid,
            body={"requests": [{"deleteSheet": {"sheetId": p["sheetId"]}}]}).execute()


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
    _drop_default_sheet(sheets, sid, tab)
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
