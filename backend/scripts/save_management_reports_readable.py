#!/usr/bin/env python3
"""
Save Management Reports with human-readable names

Copies corrected files from ManagementCorrection/ to a readable subfolder
with names like: Management_Report_2026-02-11.xlsx

Run after correct_management_reports.py. Use the readable copies for easy
inspection (no UUIDs or timestamps in filenames).

Run from project root:
  python backend/scripts/save_management_reports_readable.py

Output: backend/ManagementCorrection/readable/
"""

import json
import shutil
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent

MANAGEMENT_CORRECTION_DIR = BACKEND_DIR / "ManagementCorrection"
READABLE_OUTPUT_DIR = MANAGEMENT_CORRECTION_DIR / "readable"


def main():
    metadata_path = MANAGEMENT_CORRECTION_DIR / "management_reports_metadata.json"
    if not metadata_path.exists():
        print(f"Metadata not found: {metadata_path}")
        print("Ensure ManagementCorrection/ has the metadata and corrected files.")
        sys.exit(1)

    with open(metadata_path) as f:
        reports = json.load(f)

    READABLE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    used_names = {}  # track duplicates: base_name -> count

    print("=" * 60)
    print("  Save Management Reports (readable names)")
    print("=" * 60)
    print(f"\nSource: {MANAGEMENT_CORRECTION_DIR}")
    print(f"Output: {READABLE_OUTPUT_DIR}\n")

    copied = 0
    for r in reports:
        report_id = r["id"]
        file_path = r["file_path"]
        report_date = r.get("date", "unknown")
        basename = Path(file_path).name

        src_file = MANAGEMENT_CORRECTION_DIR / f"{report_id}_{basename}"
        if not src_file.exists():
            print(f"  Skip (not found): {basename}")
            continue

        # Human-readable name: Management_Report_2026-02-11.xlsx
        safe_date = str(report_date).replace("/", "-").replace(" ", "_")[:10]
        base_out = f"Management_Report_{safe_date}.xlsx"

        # Handle duplicates (same date)
        if base_out in used_names:
            used_names[base_out] += 1
            stem = base_out.replace(".xlsx", "")
            out_name = f"{stem}_{used_names[base_out]}.xlsx"
        else:
            used_names[base_out] = 1
            out_name = base_out

        dst_file = READABLE_OUTPUT_DIR / out_name
        shutil.copy2(src_file, dst_file)
        copied += 1
        print(f"  OK {out_name}")

    print("\n" + "=" * 60)
    print(f"Done: {copied} files saved to {READABLE_OUTPUT_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    main()
