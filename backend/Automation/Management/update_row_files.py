"""Clean Management row files — clear ROW_FILES for the next run.

ROW_FILES holds BOTH:
  * the raw Mambu exports you upload (Loan_Accounts*, Clients*, Settlement*, …)
    — these are the real inputs read by combined_management_processor.py, and
  * everything derived from them (Closed_Active_In_Arrears_*, and the
    Loan/Clientstz/Settlements/Users masters it builds).

Both are per-run artefacts, so this removes all data files and leaves only
master_* / reference workbooks behind.
"""
from __future__ import annotations

import os
from pathlib import Path

_MGMT_DIR = Path(os.environ.get("PCL_MANAGEMENT_DIR") or (
    os.path.join(os.environ["PCL_AUTOMATION_ROOT"], "Management")
    if os.environ.get("PCL_AUTOMATION_ROOT") else Path(__file__).resolve().parent))
FOLDER = _MGMT_DIR / "ROW_FILES"

KEEP_PREFIXES = ("master_", "zone and cluster")
_DATA_EXT = {".xlsx", ".xls", ".xlsm", ".csv", ".zip"}


def main() -> None:
    if not FOLDER.exists():
        print(f"No ROW_FILES folder: {FOLDER}")
        return
    removed = kept = 0
    for f in sorted(FOLDER.iterdir()):
        if not f.is_file() or f.suffix.lower() not in _DATA_EXT:
            continue
        if any(f.name.lower().startswith(p) for p in KEEP_PREFIXES):
            print(f"Kept (master/ref): {f.name}")
            kept += 1
            continue
        try:
            f.unlink()
            print(f"Removed: {f.name}")
            removed += 1
        except Exception as exc:  # noqa: BLE001
            print(f"Could not remove {f.name}: {exc}")
    print(f"Done. Removed {removed} row file(s); kept {kept} master/reference file(s).")


if __name__ == "__main__":
    main()
