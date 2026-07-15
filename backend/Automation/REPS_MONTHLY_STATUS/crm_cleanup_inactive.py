"""crm_cleanup_inactive.py — prune inactive frontline reps from CRM user_data sheets.

For every CRM workbook in a folder, this opens the ``user_data`` sheet (only) and
removes rows that are BOTH:

  * a frontline role  — Loan Officer / Call Center Agent / Branch Loan Officer /
    Branch Manager (matched as a case-insensitive substring, so plural and
    comma-combined variants like "Branch Loan Officers" are caught), AND
  * UNAMBIGUOUSLY inactive — see the date rule below.

Date rule
---------
The Last_Login column is inconsistent: some cells are clean day-first text
("29/05/2026 11:48") and some are Excel-native datetimes whose day/month have
been locale-swapped (e.g. a June login showing as 2026-08-06 or 2026-01-06).

The CRM export writes day-first text; a month-first locale then converts every
value whose day is <= 12 into a swapped native datetime, and leaves the rest as
text. (Verified on the June AND July workbooks: no native value ever has
day > 12, and swap-decoding every native lands in the plausible login window
ending on each file's export date.) So the decoding is deterministic, which is
what lets the July (and any later) reports be cleaned, not just the June ones:

  * text dates ("DD/MM/YYYY ...") are trusted as day-first;
  * Excel-native datetimes are decoded by swapping day/month back
    (2026-05-03 -> 03/05 read as 3 May); if the swap is impossible
    (day > 12) the date is used as-is;
  * ISO-ish TEXT dates (rare, origin unknown) stay AMBIGUOUS — both readings
    are considered and the rep is removed only if BOTH are before the cutoff;
  * a future date, an ambiguous date that could still be recent, an unparseable
    value, or "NEVER" -> the rep is KEPT.

NEVER / never-logged-in reps are REMOVED by default (treated as inactive).
Use --keep-never to keep them instead (e.g. to preserve brand-new joiners).

Cutoff defaults to the first day of the month three months before today
(run in June 2026 -> 01/03/2026). Override with --months or --cutoff.

Every removed rep is also written (unique across all files) to a separate review
workbook so nothing is lost silently.

Usage:
    python crm_cleanup_inactive.py                 # default folder, apply changes
    python crm_cleanup_inactive.py --dry-run       # report only, change nothing
    python crm_cleanup_inactive.py "D:\\some\\OtherFolder"   # any folder
    python crm_cleanup_inactive.py --months 3 --keep-never
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import zipfile
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET

import openpyxl  # only used to write the (pivot-free) review workbook

# OOXML spreadsheet namespaces
_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
ET.register_namespace("", _NS)
ET.register_namespace("r", _NS_R)
_EXCEL_EPOCH = datetime(1899, 12, 30)  # accounts for the Excel 1900 leap-year bug

# Dynamic: orchestrator sets PCL_AUTOMATION_ROOT; fallback = this script's
# grandparent (…/Automation) / CRM / CS / NEW_EXCEL.
DEFAULT_DIR = os.environ.get("PCL_CRM_CS_NEW_EXCEL") or os.path.join(
    os.environ.get("PCL_AUTOMATION_ROOT")
    or os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "CRM", "CS", "NEW_EXCEL")
DEFAULT_SHEET = "user_data"
# Frontline roles to prune when inactive (lower-case substrings).
TARGET_ROLES = ["loan officer", "call center agent", "branch loan officer", "branch manager"]
# Only treat files with "CRM" in the name as CRM workbooks.
CRM_KEYWORD = "crm"
# Name marker for the review output so it is never re-processed.
REVIEW_MARKER = "removed_inactive_review"


def first_of_month_n_ago(d: date, n: int) -> date:
    """First day of the month that is `n` calendar months before `d`."""
    m, y = d.month - n, d.year
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def login_candidates(value) -> Tuple[str, List[date]]:
    """Interpret a Last_Login cell.

    Returns (kind, candidate_dates):
      kind == "never"        -> NEVER / blank
      kind == "unparseable"  -> non-empty but not a recognisable date
      kind == "dates"        -> 1 or 2 candidate dates (2 if day/month ambiguous)
    """
    if value is None:
        return "never", []

    def ambiguous(d: date) -> List[date]:
        cands = [d]
        if d.day <= 12 and d.month <= 12 and d.day != d.month:
            try:
                cands.append(date(d.year, d.day, d.month))  # day/month swapped
            except ValueError:
                pass
        return cands

    def decode_native(d: date) -> List[date]:
        # Native datetimes only exist where the locale mis-parsed day-first
        # text (day <= 12), so the true date is the day/month swap.
        if d.day <= 12 and d.day != d.month:
            try:
                return [date(d.year, d.day, d.month)]
            except ValueError:
                pass
        return [d]

    # Excel-native datetime/date -> locale-swapped day-first text; swap back
    if isinstance(value, datetime):
        return "dates", decode_native(value.date())
    if isinstance(value, date):
        return "dates", decode_native(value)

    s = str(value).strip()
    if not s or s.upper() == "NEVER":
        return "never", []
    # Trusted day-first text formats (CRM export style)
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return "dates", [datetime.strptime(s, fmt).date()]
        except ValueError:
            continue
    # ISO-ish text -> treat as ambiguous (could have been swapped on export)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return "dates", ambiguous(datetime.strptime(s, fmt).date())
        except ValueError:
            continue
    return "unparseable", []


def is_unambiguously_inactive(value, cutoff: date, today: date,
                              remove_never: bool) -> bool:
    """True only when the rep should be removed under the safe rule."""
    kind, cands = login_candidates(value)
    if kind == "never":
        return remove_never
    if kind == "unparseable":
        return False  # ambiguous -> keep
    # Remove only if EVERY plausible reading is old (and none in the future).
    if any(c > today for c in cands):
        return False
    return all(c < cutoff for c in cands)


# ---------------------------------------------------------------------------
# Surgical XML editing: we edit ONLY the user_data sheet part inside the .xlsx
# zip and copy every other part byte-for-byte. This avoids openpyxl rewriting
# the whole workbook (which silently breaks pivot tables / caches) and works
# even on files whose pivots openpyxl can no longer load.
# ---------------------------------------------------------------------------

def _q(tag: str) -> str:
    return f"{{{_NS}}}{tag}"


def _col_letter(cell_ref: str) -> str:
    return re.match(r"[A-Za-z]+", cell_ref or "").group(0) if cell_ref else ""


def _cell_text(c: ET.Element, shared: List[str]):
    """Extract a cell's value as a python str/float/date-able value."""
    t = c.get("t")
    if t == "inlineStr":
        return "".join(node.text or "" for node in c.iter(_q("t")))
    v = c.find(_q("v"))
    text = v.text if v is not None else None
    if text is None:
        return None
    if t == "s":  # shared string
        try:
            return shared[int(text)]
        except (ValueError, IndexError):
            return None
    if t in (None, "n"):  # numeric (possibly a date serial)
        return text  # caller decides whether to treat as serial
    return text  # str / b / etc.


def _read_shared_strings(zf: zipfile.ZipFile) -> List[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    out = []
    for si in root.findall(_q("si")):
        out.append("".join(node.text or "" for node in si.iter(_q("t"))))
    return out


def _sheet_part_for(zf: zipfile.ZipFile, sheet_name: str) -> Optional[str]:
    """Resolve the worksheet XML part path for a sheet by (case-insensitive) name."""
    wb = ET.fromstring(zf.read("xl/workbook.xml"))
    rid = None
    for s in wb.find(_q("sheets")):
        if (s.get("name") or "").lower() == sheet_name.lower():
            rid = s.get(f"{{{_NS_R}}}id")
            break
    if rid is None:
        return None
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    for rel in rels:
        if rel.get("Id") == rid:
            tgt = rel.get("Target")
            if tgt.startswith("/"):
                return tgt.lstrip("/")
            return "xl/" + tgt if not tgt.startswith("xl/") else tgt
    return None


def _login_value(raw, is_numeric: bool):
    """Turn a Last_Login cell value into something login_candidates understands:
    numeric serials -> date object (ambiguous), everything else -> str."""
    if raw is None:
        return None
    if is_numeric:
        try:
            return (_EXCEL_EPOCH + timedelta(days=int(float(raw)))).date()
        except (ValueError, TypeError):
            return str(raw)
    return raw


def clean_workbook(path: str, sheet_name: str, cutoff: date, today: date,
                   remove_never: bool, dry_run: bool):
    """Prune inactive frontline reps from one workbook's user_data sheet by
    editing only that sheet's XML in the zip. Returns (stats, removed_records)."""
    stats = {"file": os.path.basename(path), "removed": 0, "kept": 0,
             "scanned": 0, "status": "ok"}
    removed_records: List[dict] = []

    with zipfile.ZipFile(path) as zf:
        sheet_part = _sheet_part_for(zf, sheet_name)
        if sheet_part is None or sheet_part not in zf.namelist():
            stats["status"] = f"no '{sheet_name}' sheet"
            return stats, removed_records
        shared = _read_shared_strings(zf)
        sheet_xml = zf.read(sheet_part)
        all_parts = {name: zf.read(name) for name in zf.namelist()}

    root = ET.fromstring(sheet_xml)
    sheet_data = root.find(_q("sheetData"))
    if sheet_data is None:
        stats["status"] = "no sheetData"
        return stats, removed_records

    rows = sheet_data.findall(_q("row"))
    if not rows:
        return stats, removed_records

    # header: map column-letter -> header name (first row)
    header_map: Dict[str, str] = {}
    for c in rows[0].findall(_q("c")):
        header_map[_col_letter(c.get("r"))] = str(_cell_text(c, shared) or "").strip()
    name_by_letter = {L: h for L, h in header_map.items()}
    role_letter = next((L for L, h in header_map.items() if h.lower() == "role"), None)
    login_letter = next((L for L, h in header_map.items() if h.lower() == "last_login"), None)
    if role_letter is None or login_letter is None:
        stats["status"] = "missing Role/Last_Login column"
        return stats, removed_records

    rows_to_remove = []
    for row in rows[1:]:
        cells = {_col_letter(c.get("r")): c for c in row.findall(_q("c"))}
        role_cell = cells.get(role_letter)
        role = _cell_text(role_cell, shared) if role_cell is not None else None
        if role is None or str(role).strip() == "":
            continue
        stats["scanned"] += 1
        if not any(k in str(role).lower() for k in TARGET_ROLES):
            continue
        login_cell = cells.get(login_letter)
        login_val = None
        if login_cell is not None:
            is_num = login_cell.get("t") in (None, "n")
            login_val = _login_value(_cell_text(login_cell, shared), is_num)
        if is_unambiguously_inactive(login_val, cutoff, today, remove_never):
            rows_to_remove.append(row)
            rec = {}
            for L, cell in cells.items():
                rec[name_by_letter.get(L, L)] = _cell_text(cell, shared)
            rec["_source_file"] = stats["file"]
            removed_records.append(rec)

    stats["removed"] = len(rows_to_remove)
    stats["kept"] = stats["scanned"] - stats["removed"]

    if rows_to_remove and not dry_run:
        remove_set = set(id(r) for r in rows_to_remove)
        kept_rows = [r for r in rows if id(r) not in remove_set]
        for r in list(sheet_data):
            if r.tag == _q("row"):
                sheet_data.remove(r)
        # renumber kept rows contiguously and fix each cell's row ref
        for new_idx, r in enumerate(kept_rows, start=1):
            old = r.get("r")
            r.set("r", str(new_idx))
            for c in r.findall(_q("c")):
                ref = c.get("r")
                if ref:
                    c.set("r", _col_letter(ref) + str(new_idx))
            sheet_data.append(r)
        # update dimension if present
        dim = root.find(_q("dimension"))
        if dim is not None and dim.get("ref"):
            m = re.match(r"([A-Za-z]+)\d+:([A-Za-z]+)\d+", dim.get("ref"))
            if m:
                dim.set("ref", f"{m.group(1)}1:{m.group(2)}{len(kept_rows)}")
        body = ET.tostring(root, encoding="unicode")
        new_sheet_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + body
        ).encode("utf-8")
        all_parts[sheet_part] = new_sheet_xml
        _rewrite_zip(path, all_parts)

    return stats, removed_records


def _rewrite_zip(path: str, parts: Dict[str, bytes]) -> None:
    """Atomically rewrite an .xlsx with the given {part_name: bytes}, preserving
    order. Writes to a temp file then replaces the original."""
    tmp = path + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in parts.items():
            zf.writestr(name, data)
    shutil.move(tmp, path)


def list_crm_files(folder: str) -> List[str]:
    out = []
    for f in os.listdir(folder):
        if f.startswith("~$") or not f.lower().endswith((".xlsx", ".xlsm")):
            continue
        if CRM_KEYWORD not in f.lower() or REVIEW_MARKER in f.lower():
            continue
        out.append(os.path.join(folder, f))
    return sorted(out)


def write_review_workbook(records: List[dict], out_path: str) -> int:
    """Write the UNIQUE removed reps (across all files) to a review workbook.
    Dedupe by User_Name, else Email_Address, else Name. Returns unique count."""
    if not records:
        return 0

    def key(r):
        for k in ("User_Name", "Email_Address", "Name"):
            v = r.get(k)
            if v is not None and str(v).strip():
                return str(v).strip().lower()
        return str(sorted(r.items()))

    # column order: union of user_data headers (minus internal), then provenance
    base_cols: List[str] = []
    for r in records:
        for k in r:
            if k != "_source_file" and k not in base_cols:
                base_cols.append(k)
    out_cols = base_cols + ["Removed_From_Files", "Times_Removed"]

    unique: dict = {}
    for r in records:
        k = key(r)
        if k not in unique:
            unique[k] = {"row": r, "files": set()}
        unique[k]["files"].add(r.get("_source_file", ""))

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "removed_unique"
    ws.append(out_cols)
    for entry in unique.values():
        r, files = entry["row"], sorted(f for f in entry["files"] if f)
        line = [r.get(c) for c in base_cols] + ["; ".join(files), len(files)]
        ws.append(line)
    # freeze header + a light bold header
    ws.freeze_panes = "A2"
    from openpyxl.styles import Font
    for c in range(1, len(out_cols) + 1):
        ws.cell(row=1, column=c).font = Font(bold=True)
    wb.save(out_path)
    return len(unique)


def main():
    ap = argparse.ArgumentParser(description="Prune inactive frontline reps from CRM user_data sheets.")
    ap.add_argument("folder", nargs="?", default=DEFAULT_DIR, help="Folder of CRM workbooks.")
    ap.add_argument("--sheet", default=DEFAULT_SHEET, help="Sheet to clean (default: user_data).")
    ap.add_argument("--months", type=int, default=3, help="Inactivity threshold in months (default: 3).")
    ap.add_argument("--cutoff", help="Explicit cutoff date YYYY-MM-DD (overrides --months).")
    ap.add_argument("--keep-never", action="store_true",
                    help="Keep reps who never logged in (default: remove them).")
    ap.add_argument("--dry-run", action="store_true", help="Report only; do not modify files.")
    args = ap.parse_args()

    today = date.today()
    if args.cutoff:
        cutoff = datetime.strptime(args.cutoff, "%Y-%m-%d").date()
    else:
        cutoff = first_of_month_n_ago(today, args.months)

    if not os.path.isdir(args.folder):
        print(f"ERROR: folder not found: {args.folder}")
        return
    files = list_crm_files(args.folder)
    if not files:
        print(f"No CRM workbooks found in {args.folder}")
        return

    mode = "DRY-RUN (no changes)" if args.dry_run else "APPLYING changes"
    print(f"Folder : {args.folder}")
    print(f"Sheet  : {args.sheet}")
    print(f"Cutoff : remove frontline reps unambiguously inactive before {cutoff}")
    print(f"Never  : {'kept (may be new joiners)' if args.keep_never else 'removed'}")
    print(f"Mode   : {mode}")
    print("-" * 72)

    tot_removed = tot_kept = 0
    all_removed: List[dict] = []
    for path in files:
        stats, removed = clean_workbook(path, args.sheet, cutoff, today,
                                        remove_never=not args.keep_never, dry_run=args.dry_run)
        if stats["status"] != "ok":
            print(f"  [SKIP] {stats['file']}: {stats['status']}")
            continue
        tot_removed += stats["removed"]
        tot_kept += stats["kept"]
        all_removed.extend(removed)
        print(f"  {stats['file']}: removed {stats['removed']:>4}, kept {stats['kept']:>4} frontline reps")

    # Write the consolidated review workbook (unique removed reps across all files).
    # Fall back to a timestamped name if the target is locked (e.g. open in Excel),
    # so a locked file never aborts the run after files were already cleaned.
    review_dir = os.path.dirname(args.folder.rstrip("\\/")) or "."
    review_path = os.path.join(review_dir, f"CRM_{REVIEW_MARKER}_{today:%d_%m_%Y}.xlsx")
    try:
        unique_n = write_review_workbook(all_removed, review_path)
    except PermissionError:
        review_path = os.path.join(
            review_dir, f"CRM_{REVIEW_MARKER}_{today:%d_%m_%Y}_{datetime.now():%H%M%S}.xlsx")
        print(f"  (review target was locked — writing to {os.path.basename(review_path)} instead)")
        unique_n = write_review_workbook(all_removed, review_path)

    print("-" * 72)
    print(f"TOTAL across {len(files)} file(s): removed {tot_removed}, kept {tot_kept} frontline reps")
    if unique_n:
        print(f"Review file: {review_path}  ({unique_n} unique removed reps)")
    else:
        print("No reps matched for removal.")
    if args.dry_run:
        print("Dry-run only — no files were modified. Re-run without --dry-run to apply.")


if __name__ == "__main__":
    main()
