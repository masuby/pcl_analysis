"""Configuration for the Automation orchestrator.

The orchestrator runs the existing report scripts (CRM / Call Center / Management
/ MTD) as SUBPROCESSES so their logic is never touched. All locations are derived
dynamically from AUTOMATION_DIR (this repo's backend/Automation folder) or from
env overrides, so the exact same service runs on the dev box and on the server.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# .../backend/Automation  (this file: .../Automation/automation_service/app/config.py)
AUTOMATION_DIR = Path(os.getenv("AUTOMATION_DIR") or Path(__file__).resolve().parents[2])

# The Python used to launch the report scripts (same interpreter by default).
PYTHON = os.getenv("AUTOMATION_PYTHON") or sys.executable

# Per-pipeline base folders (all overridable via env for the server move).
CRM_DIR = Path(os.getenv("CRM_DIR") or AUTOMATION_DIR / "CRM")
CALL_CENTER_DIR = Path(os.getenv("CALL_CENTER_DIR") or AUTOMATION_DIR / "CALL_CENTER")
MANAGEMENT_DIR = Path(os.getenv("MANAGEMENT_DIR") or AUTOMATION_DIR / "Management")
MTD_DIR = Path(os.getenv("MTD_DIR") or AUTOMATION_DIR / "MTD")
REPS_DIR = Path(os.getenv("REPS_DIR") or AUTOMATION_DIR / "REPS_MONTHLY_STATUS")

# Where the DB-upload helper lives (used as the final step of several pipelines).
DB_UPLOAD_SCRIPT = CRM_DIR / "direct_upload_files_to_db.py"

# Input (upload) folders the scripts already read from.
CRM_UPLOAD_DIR = CRM_DIR / "ROW_EXCEL"
CALL_CENTER_UPLOAD_DIR = CALL_CENTER_DIR / "ROW_FILES"
MANAGEMENT_UPLOAD_DIR = MANAGEMENT_DIR / "ROW_FILES"
MTD_UPLOAD_DIR = MTD_DIR / "ROW_FILES"
REPS_UPLOAD_DIR = REPS_DIR / "ROW_FILES"
CRM_CS_NEW_EXCEL_DIR = CRM_DIR / "CS" / "NEW_EXCEL"

# Recipients live in the CRM email master workbook.
CRM_EMAIL_MASTER = CRM_DIR / "Master_crm_emails.xlsx"

# How many log lines to keep in memory per job.
LOG_CAP = int(os.getenv("AUTOMATION_LOG_CAP") or 5000)


def env_for_subprocess() -> dict:
    """Environment passed to every report subprocess: force UTF-8 (Windows
    consoles are cp1252 and the scripts print emojis) + unbuffered output so
    logs stream line-by-line, plus the dynamic AUTOMATION_DIR overrides."""
    env = dict(os.environ)
    env.update(
        PYTHONIOENCODING="utf-8",
        PYTHONUNBUFFERED="1",
        PCL_AUTOMATION_ROOT=str(AUTOMATION_DIR),
        AUTOMATION_DIR=str(AUTOMATION_DIR),
    )
    return env
