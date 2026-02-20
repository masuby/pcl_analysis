#!/usr/bin/env python3
"""
Add 1 day to all dates in readable_metadata.json and rename files in readable/.
Run from backend/ or project root.
"""
import json
from datetime import datetime, timedelta
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
READABLE_DIR = BACKEND_DIR / "ManagementCorrection" / "readable"
META_PATH = READABLE_DIR / "readable_metadata.json"

def add_one_day(date_str):
    """Add 1 day to YYYY-MM-DD, return YYYY-MM-DD."""
    dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
    return (dt + timedelta(days=1)).strftime("%Y-%m-%d")

def main():
    with open(META_PATH) as f:
        data = json.load(f)
    
    # Build old->new filename map (sort by date desc so we don't overwrite)
    updates = []
    for r in data["reports"]:
        old_date = r["date"][:10]
        new_date = add_one_day(old_date)
        old_fn = r["readable_filename"]
        new_fn = old_fn.replace(old_date, new_date)
        updates.append((r, old_date, new_date, old_fn, new_fn))
    
    updates.sort(key=lambda x: x[1], reverse=True)  # latest first for rename
    
    # 1. Rename files (latest first to avoid overwrite)
    for r, old_date, new_date, old_fn, new_fn in updates:
        old_path = READABLE_DIR / old_fn
        new_path = READABLE_DIR / new_fn
        if old_path.exists():
            if new_path.exists() and old_path != new_path:
                print(f"  SKIP rename {old_fn}: {new_fn} already exists")
            else:
                old_path.rename(new_path)
                print(f"  Renamed: {old_fn} -> {new_fn}")
        else:
            print(f"  WARN: {old_fn} not found")
    
    # 2. Update metadata
    for r in data["reports"]:
        old_date = r["date"][:10]
        new_date = add_one_day(old_date)
        r["date"] = new_date
        r["readable_filename"] = r["readable_filename"].replace(old_date, new_date)
    
    with open(META_PATH, "w") as f:
        json.dump(data, f, indent=2)
    
    print(f"\nUpdated {META_PATH}")

if __name__ == "__main__":
    main()
