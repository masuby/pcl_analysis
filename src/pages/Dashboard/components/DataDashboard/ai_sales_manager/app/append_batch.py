"""Repair a working sheet, record feedback against it, and append a new batch.

Three jobs, all on the live LBF / SME call-centre sheets:

REPAIR. The sheets are edited by hand and columns get deleted. The SME tab lost
both Product and Assigned_to — header and data — so the layout no longer matched
LBF and the report could not attribute work to an agent. `repair_columns` puts
missing columns back in their proper position rather than appending them at the
end, so existing rows stay aligned with their headers.

FEEDBACK. Calls get logged in a separate workbook and have to be brought back in.
Matching is on the phone number, and the caller's own wording is kept in Comments
while Feedback gets the nearest dropdown value — so nothing the agent wrote is
lost, but the dropdown stays valid and the callback report still buckets it.

APPEND. A new batch goes UNDER a dark blue divider naming the batch and the date,
so it is obvious where last week's list ends and today's begins. Existing rows
are never touched; the divider and the new rows are added below them.
"""
from __future__ import annotations

import re
from datetime import date

from . import db
from .config import settings
from .distribute import (COLUMNS, FEEDBACK_OPTIONS, _ensure_tab, _format,
                         _gid, _display_name, _value, tab_name)
from .tools.sheets import _services

HEADERS = [h for h, _ in COLUMNS]

# Dark blue divider, white bold text — the same navy the header band uses.
DIVIDER_BG = {"red": 0.12, "green": 0.22, "blue": 0.39}


def _norm(phone: str) -> str:
    return db.normalize_phone(str(phone or ""))


# ---------------------------------------------------------------------------
# Free-text feedback -> the dropdown
# ---------------------------------------------------------------------------
#
# Callers type what happened, not what the dropdown says: "next time", "NOT
# RECHABLE", "inprogress", "HAVE NO VEHCLE". Mapping is by substring so spelling
# and case do not matter, and the ORIGINAL wording is written to Comments so the
# nuance ("loan amount is so small") is not thrown away.
_FEEDBACK_MAP = [
    ("not interest", "Not interested"),
    ("not intersted", "Not interested"),
    ("not picking", "Not picking"),
    ("not reach", "Not reachable"),
    ("not rech", "Not reachable"),
    ("not qualif", "Not qualified"),
    ("duplicat", "Duplicated number"),
    ("invalid phone", "Failed to connect"),
    ("failed to connect", "Failed to connect"),
    ("call back", "Request callback"),
    ("callback", "Request callback"),
    ("in progress", "Request callback"),
    ("inprogress", "Request callback"),
    ("next time", "Request more time"),
    ("next week", "Request more time"),
    ("next month", "Request more time"),
    ("may be", "Request more time"),
    ("more time", "Request more time"),
    ("no vehcle", "Not qualified"),
    ("no vehicle", "Not qualified"),
    ("amount is so small", "Not qualified"),
    ("converted", "Converted"),
    ("referred", "Referred"),
]


def map_feedback(raw: str) -> tuple[str, bool]:
    """(dropdown value, whether it mapped cleanly)."""
    s = " ".join(str(raw or "").split())
    if not s:
        return "", True
    low = s.lower()
    for opt in FEEDBACK_OPTIONS:
        if low == opt.lower():
            return opt, True
    for needle, opt in _FEEDBACK_MAP:
        if needle in low:
            return opt, True
    return "", False


# ---------------------------------------------------------------------------
# Repair
# ---------------------------------------------------------------------------

def _unhide_columns(sheets, sid: str, gid: int, tab: str, log=print) -> list[str]:
    """Make every standard column visible again, and report which were hidden.

    A hidden column looks exactly like a deleted one to whoever is working the
    sheet — SME had Date and Source Link hidden, and the reasonable conclusion
    was that the data had been lost. It had not. Unhiding is safe: these eleven
    columns are the agreed layout and none of them should be out of sight.
    """
    meta = sheets.spreadsheets().get(
        spreadsheetId=sid, ranges=[f"'{tab}'!A1:K1"],
        includeGridData=True).execute()

    hidden = []
    for sh in meta.get("sheets", []):
        if sh["properties"]["sheetId"] != gid:
            continue
        data = sh.get("data") or [{}]
        for i, m in enumerate(data[0].get("columnMetadata", [])[:len(HEADERS)]):
            if m.get("hiddenByUser"):
                hidden.append(HEADERS[i])

    if hidden:
        sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": [
            {"updateDimensionProperties": {
                "range": {"sheetId": gid, "dimension": "COLUMNS",
                          "startIndex": 0, "endIndex": len(HEADERS)},
                "properties": {"hiddenByUser": False},
                "fields": "hiddenByUser"}}]}).execute()
        log(f"unhid column(s): {', '.join(hidden)}")
    return hidden


def repair_columns(product: str, month: str = "", log=print) -> dict:
    """Put back any of the standard columns the sheet has lost."""
    sid = settings.lbf_sheet_id if product == "LBF" else settings.sme_sheet_id
    if not sid:
        return {"ok": False, "error": f"AISM_{product}_SHEET_ID is not set"}

    sheets, _ = _services()
    tab = tab_name(month)
    gid = _gid(sheets, sid, tab)
    if gid is None:
        return {"ok": False, "error": f"no tab {tab!r} in the {product} sheet"}

    got = sheets.spreadsheets().values().get(
        spreadsheetId=sid, range=f"'{tab}'!A1:Z1").execute().get("values", [[]])
    current = [str(h).strip() for h in (got[0] if got else [])]

    # A header can be blanked rather than deleted — LBF's Product column was a
    # single space. That column still HOLDS its data, so inserting a fresh one
    # would shift every row right and silently misalign the sheet. If the count
    # of columns already matches, the sheet is only mislabelled: rename in place
    # and touch nothing else.
    unhidden = _unhide_columns(sheets, sid, gid, tab, log)

    missing = [h for h in HEADERS if h and h not in current]
    if not missing:
        log(f"[{product}] all {len(HEADERS)} columns present")
        return {"ok": True, "product": product, "inserted": [],
                "unhidden": unhidden, "headers": current}

    # Inserting a column is only ever safe on an EMPTY tab. On a populated one
    # it shifts every existing value one cell right — which is exactly what
    # happened, twice, to the LBF sheet while the call centre was working it:
    # a blanked A1 (2026-08) and later a stray 12th header cell (2026-09-08)
    # both sent the header past the relabel branch and into an insert. So on a
    # populated tab the standard headers are written over A1:K1 in place — the
    # data underneath is already in those positions, it is only the labels
    # that drifted — and nothing is moved. The only case that still inserts is
    # a tab with no data rows at all, where there is nothing to misalign.
    nrows = len(sheets.spreadsheets().values().get(
        spreadsheetId=sid, range=f"'{tab}'!A1:K100000").execute().get("values", []))
    if nrows > 1:
        sheets.spreadsheets().values().update(
            spreadsheetId=sid, range=f"'{tab}'!A1",
            valueInputOption="RAW", body={"values": [HEADERS]}).execute()
        log(f"[{product}] populated tab: relabelled the header in place "
            f"({', '.join(missing)} were missing); no columns moved")
        return {"ok": True, "product": product, "inserted": [],
                "relabelled": missing, "unhidden": unhidden, "headers": HEADERS}

    # Insert each missing column at the position it should occupy, working left
    # to right so earlier inserts do not shift the ones that follow.
    reqs = []
    working = list(current)
    for h in HEADERS:
        if h in working:
            continue
        idx = HEADERS.index(h)
        idx = min(idx, len(working))
        reqs.append({"insertDimension": {
            "range": {"sheetId": gid, "dimension": "COLUMNS",
                      "startIndex": idx, "endIndex": idx + 1},
            "inheritFromBefore": False}})
        working.insert(idx, h)

    sheets.spreadsheets().batchUpdate(
        spreadsheetId=sid, body={"requests": reqs}).execute()

    # Write the full header row back, then backfill Product for existing rows —
    # a blank Product column would break the per-product reporting.
    #
    # The row count is taken from a column that already HAS data. Counting the
    # newly inserted column returns zero, which silently skips the backfill.
    probe = chr(ord("A") + (1 if "Product" in missing else 0))
    nrows = len(sheets.spreadsheets().values().get(
        spreadsheetId=sid,
        range=f"'{tab}'!{probe}1:{probe}100000").execute().get("values", []))

    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range=f"'{tab}'!A1",
        valueInputOption="RAW", body={"values": [HEADERS]}).execute()

    if "Product" in missing and nrows > 1:
        col = chr(ord("A") + HEADERS.index("Product"))
        sheets.spreadsheets().values().update(
            spreadsheetId=sid, range=f"'{tab}'!{col}2:{col}{nrows}",
            valueInputOption="RAW",
            body={"values": [[product] for _ in range(nrows - 1)]}).execute()

    log(f"[{product}] restored {len(missing)} column(s): {', '.join(missing)}")
    return {"ok": True, "product": product, "inserted": missing,
            "unhidden": unhidden, "headers": working, "rows": nrows - 1}


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------

def apply_feedback(product: str, records: list[dict], month: str = "",
                   log=print) -> dict:
    """Write feedback against rows already in the sheet, matched on phone.

    `records` need a phone and a feedback; anything else is ignored. Rows the
    sheet does not have are reported rather than appended, because a number that
    is not on the list was not distributed from here and silently adding it
    would misstate what the call centre was given.
    """
    sid = settings.lbf_sheet_id if product == "LBF" else settings.sme_sheet_id
    sheets, _ = _services()
    tab = tab_name(month)
    gid = _gid(sheets, sid, tab)
    if gid is None:
        return {"ok": False, "error": f"no tab {tab!r}"}

    grid = sheets.spreadsheets().values().get(
        spreadsheetId=sid, range=f"'{tab}'!A1:Z100000").execute().get("values", [])
    if not grid:
        return {"ok": False, "error": "sheet is empty"}
    header = [str(h).strip() for h in grid[0]]
    idx = {h: i for i, h in enumerate(header)}
    for need in ("Phone Number", "Feedback", "Comments"):
        if need not in idx:
            return {"ok": False,
                    "error": f"the sheet has no {need!r} column — run repair first"}

    # phone -> sheet row number
    where: dict[str, int] = {}
    for r, row in enumerate(grid[1:], start=2):
        i = idx["Phone Number"]
        if i < len(row):
            n = _norm(row[i])
            if n:
                where.setdefault(n, r)

    fb_col = chr(ord("A") + idx["Feedback"])
    cm_col = chr(ord("A") + idx["Comments"])
    data, unmatched, unmapped = [], [], []
    matched = 0

    for rec in records:
        n = _norm(rec.get("phone"))
        raw = str(rec.get("feedback") or "").strip()
        if not n or not raw:
            continue
        row = where.get(n)
        if not row:
            unmatched.append({"phone": n, "feedback": raw})
            continue
        mapped, ok = map_feedback(raw)
        if not ok:
            unmapped.append(raw)
        matched += 1
        # The dropdown value goes in Feedback; what the caller actually wrote is
        # kept in Comments so no detail is lost in the mapping.
        data.append({"range": f"'{tab}'!{fb_col}{row}", "values": [[mapped or raw]]})
        note = raw if (mapped and mapped.lower() != raw.lower()) else ""
        if note:
            data.append({"range": f"'{tab}'!{cm_col}{row}", "values": [[note]]})

    if data:
        sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=sid,
            body={"valueInputOption": "RAW", "data": data}).execute()

    log(f"[{product}] feedback: {matched} matched, {len(unmatched)} not on the sheet")
    return {"ok": True, "product": product, "matched": matched,
            "unmatched": unmatched, "unmapped": sorted(set(unmapped))}


# ---------------------------------------------------------------------------
# Divider + append
# ---------------------------------------------------------------------------

def append_batch(product: str, leads: list[dict], label: str = "",
                 month: str = "", log=print) -> dict:
    """Add a dark blue divider and write the new leads underneath it."""
    sid = settings.lbf_sheet_id if product == "LBF" else settings.sme_sheet_id
    sheets, _ = _services()
    tab = tab_name(month)
    gid, _ = _ensure_tab(sheets, sid, tab)

    grid = sheets.spreadsheets().values().get(
        spreadsheetId=sid, range=f"'{tab}'!A1:Z100000").execute().get("values", [])
    header = [str(h).strip() for h in grid[0]] if grid else []
    if header != HEADERS:
        return {"ok": False,
                "error": "the sheet's columns do not match the standard layout — "
                         "run repair_columns first"}

    # Never distribute the same person twice: a phone already on the tab is
    # skipped, whichever batch it came from.
    have = set()
    pi = HEADERS.index("Phone Number")
    for row in grid[1:]:
        if pi < len(row):
            n = _norm(row[pi])
            if n:
                have.add(n)

    fresh, dupes = [], 0
    for lead in leads:
        n = _norm(lead.get("phone"))
        if not n or n in have:
            dupes += 1
            continue
        have.add(n)
        fresh.append([_display_name(lead) if f == "_name" else _value(lead, f)
                      for _, f in COLUMNS])
    if not fresh:
        return {"ok": True, "product": product, "added": 0, "skipped": dupes,
                "message": "nothing new to add — every lead is already on the sheet"}

    first_row = len(grid) + 1              # 1-based; row after the last used one
    divider_row = first_row
    # The count on the band is what was actually WRITTEN, after duplicates were
    # dropped. A caller reading "18 leads" above 10 rows would reasonably think
    # eight had gone missing.
    text = label or f"{product} batch — {date.today():%d %b %Y}"
    text = f"{text} — {len(fresh)} new" if not label else f"{label} — {len(fresh)} added"

    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range=f"'{tab}'!A{divider_row}",
        valueInputOption="RAW", body={"values": [[text]]}).execute()

    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range=f"'{tab}'!A{divider_row + 1}",
        valueInputOption="RAW", body={"values": fresh}).execute()

    last_row = divider_row + len(fresh)
    ncols = len(HEADERS)
    # Re-apply dropdowns, colours and widths so the new rows behave like the old.
    # This runs BEFORE the divider is styled: _format paints every row in the
    # range, so colouring the divider first would simply be overwritten.
    _format(sheets, sid, gid, last_row)

    # The band is a coloured ROW, not a merged cell. Merging across the full
    # width breaks the frozen first column — Sheets refuses to freeze a column
    # holding only part of a merge — and the colour alone reads identically.
    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": [
        {"repeatCell": {
            "range": {"sheetId": gid,
                      "startRowIndex": divider_row - 1, "endRowIndex": divider_row,
                      "startColumnIndex": 0, "endColumnIndex": ncols},
            "cell": {"userEnteredFormat": {
                "backgroundColor": DIVIDER_BG,
                "horizontalAlignment": "LEFT",
                "verticalAlignment": "MIDDLE",
                "textFormat": {"bold": True, "fontSize": 11,
                               "foregroundColor": {"red": 1, "green": 1, "blue": 1}}}},
            "fields": "userEnteredFormat(backgroundColor,horizontalAlignment,"
                      "verticalAlignment,textFormat)"}},
        {"updateDimensionProperties": {
            "range": {"sheetId": gid, "dimension": "ROWS",
                      "startIndex": divider_row - 1, "endIndex": divider_row},
            "properties": {"pixelSize": 28}, "fields": "pixelSize"}},
    ]}).execute()

    log(f"[{product}] divider at row {divider_row}, {len(fresh)} new rows "
        f"({dupes} already there)")
    return {"ok": True, "product": product, "added": len(fresh), "skipped": dupes,
            "dividerRow": divider_row, "lastRow": last_row, "label": text,
            "url": f"https://docs.google.com/spreadsheets/d/{sid}/edit#gid={gid}"}


def undistributed_leads(product: str) -> list[dict]:
    """Leads for a product that have never been sent to the call centre."""
    conn = db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT DISTINCT ON (phone_norm)
                          source_url, product, source, seller_name, phone, phone_norm,
                          location, price_text, est_value_tzs, est_loan_tzs, score,
                          reason, date_obtained, business_name, business_type, sector,
                          offering
                     FROM aism_clean_leads
                    WHERE product = %s AND phone_norm <> ''
                      AND distribution_status = 'NEVER DISTRIBUTED'
                    ORDER BY phone_norm, id DESC""", (product,))
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        conn.close()
