"""Pipeline registry — declarative specs + subprocess step builders.

Each pipeline declares:
  uploads : the files the user must drop (label + filename match + required?)
  inputs  : extra prompts (e.g. report date)
  email   : the send-mode choices shown after processing
  recipients : whether the UI can view/edit recipients
build_steps(pid, params, upload_dir) -> ordered list of subprocess steps, each
  {label, argv, cwd}. The job runner executes them in order, streaming stdout.

Scripts are launched with args/env only (no stdin), so nothing blocks on input().
"""
from __future__ import annotations

import re
from pathlib import Path

from . import config as C

# --------------------------------------------------------------------------- #
# Registry
# --------------------------------------------------------------------------- #
EMAIL_MODES_CRM = [
    {"value": "actual", "label": "Actual (All recipients)"},
    {"value": "specific", "label": "Specific (Mid-day list)"},
    {"value": "no", "label": "No (me only / don't send)"},
]
EMAIL_MODES_YESNO = [
    {"value": "yes", "label": "Yes (all recipients)"},
    {"value": "no", "label": "No (test — me only)"},
]

PIPELINES = {
    "crm": {
        "label": "CRM Report", "icon": "🗂", "color": "#2563eb",
        "upload_dir": str(C.CRM_UPLOAD_DIR),
        "clear_uploads_after": True,
        "uploads": [
            {"key": "user_list", "label": "User List Report", "match": r"^user_list_report", "required": True},
            {"key": "activities", "label": "Activities Report", "match": r"^activities_report", "required": True},
            {"key": "agent", "label": "Agent Activities Report", "match": r"^agent_activities_report", "required": True},
            {"key": "lead", "label": "Lead Report", "match": r"^lead_report", "required": True},
            {"key": "master", "label": "CRM master(s) (cs_crm / lbf_crm / sme_crm)", "match": r"^(cs|lbf|sme)_crm", "required": True, "multi": True},
        ],
        "inputs": [{"key": "date", "type": "date", "label": "Report / last-login date (dd/mm/yyyy)", "required": True}],
        "email": {"modes": EMAIL_MODES_CRM},
        "recipients": {"editable": True, "departments": ["CS", "LBF", "SME"]},
        "db_upload": True, "db_update_toggle": True,
        "update_files": {"label": "Update master files", "desc": "Replace ROW_EXCEL masters with the latest generated CS/LBF/SME reports and drop the old uploads."},
        "download_rows": True,
    },
    "call_center": {
        "label": "Call Center Report", "icon": "📞", "color": "#0891b2",
        "upload_dir": str(C.CALL_CENTER_UPLOAD_DIR),
        "clear_uploads_after": True,
        "uploads": [
            {"key": "loan", "label": "Raw Loan file", "match": r"", "required": True},
            {"key": "cdr", "label": "CDR file", "match": r"", "required": True},
        ],
        "inputs": [],
        "email": {"modes": EMAIL_MODES_YESNO},
        "recipients": {"editable": True, "departments": ["CS", "LBF", "RO"]},
        "db_upload": True,
        "update_files": {"label": "Update row files", "desc": "Remove the old uploaded Loan / CDR row files (masters & references kept)."},
        "download_rows": True,
    },
    "management": {
        "label": "Management Report", "icon": "📊", "color": "#7c3aed",
        "upload_dir": str(C.MANAGEMENT_UPLOAD_DIR),
        "clear_uploads_after": True,
        "uploads": [
            {"key": "files", "label": "Management ROW files (Loan, Users, …)", "match": r"", "required": True, "multi": True},
        ],
        "inputs": [{"key": "date", "type": "date_ddmm", "label": "Report date (dd/mm)", "required": True}],
        "email": {"modes": EMAIL_MODES_YESNO},
        "recipients": {"editable": False},
        "db_upload": True,
        "update_files": {"label": "Clean row files", "desc": "Remove the old uploaded Loan / Users / Clientstz / Settlements row files."},
        "download_rows": True,
        # Needs real Excel (xlwings) + Windows .exe helpers, so it can't run in the
        # Linux container. Jobs are queued and executed by windows_worker.py on the PC.
        "runner": "windows",
    },
    "mtd": {
        "label": "MTD Report", "icon": "📈", "color": "#16a34a",
        "upload_dir": str(C.MTD_UPLOAD_DIR),
        "clear_uploads_after": True,
        "uploads": [
            {"key": "files", "label": "MTD source files (CS + LBF)", "match": r"", "required": True, "multi": True},
        ],
        "inputs": [],
        "email": {"modes": EMAIL_MODES_YESNO},
        "recipients": {"editable": True, "departments": ["CS", "LBF"]},
        "db_upload": True,
        "update_files": {"label": "Clean row files", "desc": "Remove the uploaded CS / LBF MTD source files (masters kept)."},
        "download_rows": True,
        "message": {
            "key": "deadline", "default": "SAA 8:00 Mchana",
            "label": "Submission deadline (message time)",
            "before": "…kama kuna marekebisho usisite kuwasilisha kwa CREDIT/COORDINATOR kabla ya ",
            "after": ". Ahsante",
        },
    },
    "reps": {
        "label": "Reps Monthly Status", "icon": "🧑‍💼", "color": "#ea580c",
        "upload_dir": str(C.REPS_UPLOAD_DIR),
        "clear_uploads_after": True,
        "uploads": [
            {"key": "loan", "label": "Loan.xlsx (Loan Accounts)", "match": r"^loan", "required": False},
            {"key": "users", "label": "Users.xlsx (product_mapping)", "match": r"^users", "required": False},
        ],
        "inputs": [{"key": "date", "type": "month", "label": "Month / year (mm/yyyy)", "required": True}],
        "email": {"modes": EMAIL_MODES_YESNO},
        "recipients": {"editable": True, "departments": ["Managers"]},
        "db_upload": False,
        "auto_source": "Loan & Users auto-sync from your PC's automation folder (Management/ROW_FILES) — no manual upload needed. The CS CRM file is read from CRM/CS/NEW_EXCEL. Upload here only to override for one run.",
        "download_rows": True,
        # The Windows worker mirrors these files from the PC to this pipeline's
        # folder (opening the popup triggers an immediate sync).
        "pc_sync": {"files": ["Loan.xlsx", "Users.xlsx"], "from": "Management/ROW_FILES"},
    },
}


def public_registry() -> list[dict]:
    """Registry stripped of server paths, for the frontend."""
    out = []
    for pid, spec in PIPELINES.items():
        out.append({
            "id": pid, "label": spec["label"], "icon": spec["icon"], "color": spec["color"],
            "uploads": spec["uploads"], "inputs": spec["inputs"],
            "email": spec["email"], "recipients": spec["recipients"],
            "db_upload": spec.get("db_upload", False),
            "db_update_toggle": spec.get("db_update_toggle", False),
            "update_files": spec.get("update_files", None),
            "download_rows": spec.get("download_rows", False),
            "auto_source": spec.get("auto_source", None),
            "message": spec.get("message", None),
            "runner": spec.get("runner", "local"),
            "pc_sync": spec.get("pc_sync", None),
        })
    return out


# --------------------------------------------------------------------------- #
# Download-rows manifest (files to zip for the "download row files" button)
# --------------------------------------------------------------------------- #
_DATA_EXT = {".xlsx", ".xls", ".xlsm", ".xlsb", ".csv"}


def _data_files_in(folder) -> list[str]:
    d = Path(folder)
    if not d.exists():
        return []
    return [str(f) for f in sorted(d.iterdir())
            if f.is_file() and f.suffix.lower() in _DATA_EXT]


def _latest_match(dirs, pattern: str):
    """First directory (by priority order) with a match wins; newest within it."""
    for d in dirs:
        d = Path(d)
        if not d.exists():
            continue
        matches = [f for f in d.iterdir()
                   if f.is_file() and f.suffix.lower() in _DATA_EXT and re.search(pattern, f.name.lower())]
        if matches:
            return max(matches, key=lambda f: f.stat().st_mtime)
    return None


def _resolve_match(dirs_with_exclude, pattern: str):
    for d, exc in dirs_with_exclude:
        d = Path(d)
        if not d.exists():
            continue
        ms = [f for f in d.iterdir()
              if f.is_file() and f.suffix.lower() in _DATA_EXT
              and re.search(pattern, f.name.lower()) and f.name.lower() not in exc]
        if ms:
            return max(ms, key=lambda f: f.stat().st_mtime)
    return None


def download_manifest(pid: str) -> list[str]:
    """Absolute paths of the row files to include in the download zip."""
    if pid == "reps":
        out = []
        loan = _resolve_match([(C.REPS_UPLOAD_DIR, {"loan.xlsx"}),
                               (C.MANAGEMENT_UPLOAD_DIR, set()),
                               (C.CALL_CENTER_UPLOAD_DIR, set())], r"loan")
        users = _resolve_match([(C.REPS_UPLOAD_DIR, {"users.xlsx"}),
                                (C.MANAGEMENT_UPLOAD_DIR, set())], r"users")
        cscrm = _latest_match([C.CRM_CS_NEW_EXCEL_DIR], r"cs_crm")
        for f in (loan, users, cscrm):
            if f:
                out.append(str(f))
        return out
    return _data_files_in(PIPELINES[pid]["upload_dir"])


# --------------------------------------------------------------------------- #
# Upload validation
# --------------------------------------------------------------------------- #
def validate_uploads(pid: str, filenames: list[str]) -> tuple[bool, list[str]]:
    """Return (ok, missing_labels) checking required upload specs against names."""
    spec = PIPELINES[pid]
    lowered = [f.lower() for f in filenames]
    missing = []
    for up in spec["uploads"]:
        if not up.get("required"):
            continue
        pat = up.get("match") or ""
        if pat:
            if not any(re.search(pat, n) for n in lowered):
                missing.append(up["label"])
        else:
            # no pattern → just needs at least one file present overall
            if not lowered:
                missing.append(up["label"])
    return (len(missing) == 0, missing)


# --------------------------------------------------------------------------- #
# Step builders (one per pipeline)
# --------------------------------------------------------------------------- #
def _db_upload_step(commit: bool) -> dict:
    argv = [C.PYTHON, str(C.DB_UPLOAD_SCRIPT)]
    if commit:
        argv.append("--commit")
    return {"label": "Upload processed files to live DB", "argv": argv, "cwd": str(C.CRM_DIR)}


def build_update_steps(pid: str) -> list[dict]:
    """Steps for the 'Update / clean row files' button (post-run housekeeping)."""
    if pid == "crm":
        # Replaces ROW_EXCEL masters with the latest CS/LBF/SME reports and drops
        # the old uploads (deletes every xlsx in ROW_EXCEL, copies latest NEW_EXCEL).
        script = str(C.CRM_UPLOAD_DIR / "update_master_crm_files.py")
        return [{"label": "Update CRM master files", "argv": [C.PYTHON, script],
                 "cwd": str(C.CRM_UPLOAD_DIR)}]
    if pid == "call_center":
        script = str(C.CALL_CENTER_DIR / "update_row_files.py")
        return [{"label": "Update Call Center row files", "argv": [C.PYTHON, script],
                 "cwd": str(C.CALL_CENTER_DIR)}]
    if pid == "management":
        script = str(C.MANAGEMENT_DIR / "update_row_files.py")
        return [{"label": "Clean Management row files", "argv": [C.PYTHON, script],
                 "cwd": str(C.MANAGEMENT_DIR)}]
    if pid == "mtd":
        script = str(C.MTD_DIR / "update_row_files.py")
        return [{"label": "Clean MTD row files", "argv": [C.PYTHON, script],
                 "cwd": str(C.MTD_DIR)}]
    raise ValueError(f"pipeline '{pid}' has no update-files action")


def build_steps(pid: str, params: dict) -> list[dict]:
    spec = PIPELINES[pid]
    send = (params.get("send") or "no").strip().lower()
    date = (params.get("date") or "").strip()

    if pid == "crm":
        argv = [C.PYTHON, str(C.CRM_DIR / "crm_reports.py"), date,
                "--send", send, "--update-rows", "no"]
        steps = [{"label": "Build CRM reports (CS/LBF/SME)", "argv": argv, "cwd": str(C.CRM_DIR)}]
        # "Update files in server?" — default Yes; when No, never upload to the DB.
        if spec.get("db_upload") and params.get("db_update", True):
            steps.append(_db_upload_step(commit=True))
        return steps

    if pid == "call_center":
        # call_center_report_copy.py reads its two files from ROW_FILES and takes
        # the send choice via --send (flow patch); it runs the RO report + DB upload itself.
        argv = [C.PYTHON, str(C.CALL_CENTER_DIR / "call_center_report_copy.py"),
                "--send", "yes" if send in ("yes", "actual") else "no"]
        return [{"label": "Build Call Center report + email", "argv": argv, "cwd": str(C.CALL_CENTER_DIR)}]

    if pid == "management":
        cwd = str(C.MANAGEMENT_DIR)
        env_date = date  # dd/mm
        steps = [
            {"label": "Combined management processor", "argv": [C.PYTHON, str(C.MANAGEMENT_DIR / "combined_management_processor.py")], "cwd": cwd},
            {"label": "Process users", "argv": [C.PYTHON, str(C.MANAGEMENT_DIR / "process_users.py")], "cwd": cwd},
            {"label": "Process management (build + email)", "argv": [C.PYTHON, str(C.MANAGEMENT_DIR / "process_management.py"), "--date", env_date, "--send", send], "cwd": cwd},
        ]
        return steps

    if pid == "reps":
        cwd = str(C.REPS_DIR)
        cleanup = str(C.REPS_DIR / "crm_cleanup_inactive.py")
        monthly = str(C.REPS_DIR / "sales_rep_monthly_status_report.py")
        month = date  # mm/yyyy
        # Freshest Loan/Users the user uploaded to the Reps pipeline win; if none
        # were uploaded, fall back to the Management master (never a raw export,
        # whose columns differ). CS CRM is picked by-date inside the report.
        loan = _resolve_match([(C.REPS_UPLOAD_DIR, set())], r"loan") \
            or (str(C.MANAGEMENT_UPLOAD_DIR / "Loan.xlsx"))
        users = _resolve_match([(C.REPS_UPLOAD_DIR, set())], r"users") \
            or (str(C.MANAGEMENT_UPLOAD_DIR / "Users.xlsx"))
        return [
            {"label": "Clean up inactive CRM reps", "cwd": cwd,
             "argv": [C.PYTHON, cleanup, str(C.CRM_CS_NEW_EXCEL_DIR)]},
            {"label": "Build Reps Monthly Status report + email", "cwd": cwd,
             "argv": [C.PYTHON, monthly, "--month", month,
                      "--send", "yes" if send in ("yes", "actual") else "no",
                      "--loan", str(loan), "--users", str(users)]},
        ]

    if pid == "mtd":
        cs = str(C.MTD_DIR / "CS_MTD" / "cs_mtd_processor.py")
        lbf = str(C.MTD_DIR / "LBF_MTD" / "lbf_mtd_processor.py")
        email = str(C.MTD_DIR / "EMAIL_MTD" / "send_email_mtd.py")
        deadline = (params.get("deadline") or "").strip() or "SAA 8:00 Mchana"
        email_argv = [C.PYTHON, email, "--send", send, "--deadline", deadline]
        return [
            {"label": "CS MTD processor", "argv": [C.PYTHON, cs], "cwd": str(C.MTD_DIR / "CS_MTD")},
            {"label": "LBF MTD processor", "argv": [C.PYTHON, lbf], "cwd": str(C.MTD_DIR / "LBF_MTD")},
            {"label": "Send MTD emails", "argv": email_argv, "cwd": str(C.MTD_DIR / "EMAIL_MTD")},
        ]

    raise ValueError(f"unknown pipeline: {pid}")
