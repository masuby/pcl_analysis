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
    },
    "reps": {
        "label": "Reps Monthly Status", "icon": "🧑‍💼", "color": "#ea580c",
        "upload_dir": str(C.REPS_UPLOAD_DIR),
        "clear_uploads_after": True,
        "uploads": [
            {"key": "loan", "label": "Loan.xlsx (Loan Accounts)", "match": r"^loan", "required": True},
            {"key": "users", "label": "Users.xlsx (product_mapping)", "match": r"^users", "required": True},
        ],
        "inputs": [{"key": "date", "type": "month", "label": "Month / year (mm/yyyy)", "required": True}],
        "email": {"modes": EMAIL_MODES_YESNO},
        "recipients": {"editable": True, "departments": ["Managers"]},
        "db_upload": False,
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
        })
    return out


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
        return [
            {"label": "Clean up inactive CRM reps", "cwd": cwd,
             "argv": [C.PYTHON, cleanup, str(C.CRM_CS_NEW_EXCEL_DIR)]},
            {"label": "Build Reps Monthly Status report + email", "cwd": cwd,
             "argv": [C.PYTHON, monthly, "--month", month,
                      "--send", "yes" if send in ("yes", "actual") else "no"]},
        ]

    if pid == "mtd":
        cs = str(C.MTD_DIR / "CS_MTD" / "cs_mtd_processor.py")
        lbf = str(C.MTD_DIR / "LBF_MTD" / "lbf_mtd_processor.py")
        email = str(C.MTD_DIR / "EMAIL_MTD" / "send_email_mtd.py")
        return [
            {"label": "CS MTD processor", "argv": [C.PYTHON, cs], "cwd": str(C.MTD_DIR / "CS_MTD")},
            {"label": "LBF MTD processor", "argv": [C.PYTHON, lbf], "cwd": str(C.MTD_DIR / "LBF_MTD")},
            {"label": "Send MTD emails", "argv": [C.PYTHON, email, "--send", send], "cwd": str(C.MTD_DIR / "EMAIL_MTD")},
        ]

    raise ValueError(f"unknown pipeline: {pid}")
