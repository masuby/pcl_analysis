#!/usr/bin/env python3
"""
Restore Management Reports from Backup

Copies files from backend/backup/management_reports/ back to backend/uploads/
Use this to UNDO the formatting damage from the Node.js correction script.

Run before correct_management_reports.py if uploads currently have corrupted files.
"""

import json
import shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
BACKUP_DIR = PROJECT_ROOT / "backend" / "backup" / "management_reports"
UPLOADS_BASE = PROJECT_ROOT / "backend" / "uploads"


def main():
    metadata_path = BACKUP_DIR / "management_reports_metadata.json"
    if not metadata_path.exists():
        print("Backup metadata not found. Run: node scripts/management-reports-backup.mjs")
        return 1

    with open(metadata_path) as f:
        reports = json.load(f)

    restored = 0
    for r in reports:
        report_id = r["id"]
        file_path = r["file_path"]
        basename = Path(file_path).name

        backup_file = BACKUP_DIR / f"{report_id}_{basename}"
        output_path = UPLOADS_BASE / file_path

        if not backup_file.exists():
            print(f"  Skip (not in backup): {basename}")
            continue

        output_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(backup_file, output_path)
        restored += 1
        print(f"  Restored [{restored}] {basename}")

    print(f"\nRestored {restored} files. Formatting preserved.")
    return 0


if __name__ == "__main__":
    exit(main())
