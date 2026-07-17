"""Clean Management row files — clear the per-run files, KEEP the masters.

ROW_FILES holds:
  * the four MASTER workbooks — Loan.xlsx / Clientstz.xlsx / Settlements.xlsx /
    Users.xlsx — which are KEPT, and
  * the raw Mambu exports you upload each run (Loan_Accounts*, Clients-*, …)
    plus everything derived from them (Active_In_Arrears_*, Closed_Loan_Accounts_*,
    Closed_Active_In_Arrears_*) — these are per-run and get removed.
"""
from __future__ import annotations

import os
from pathlib import Path

_MGMT_DIR = Path(os.environ.get("PCL_MANAGEMENT_DIR") or (
    os.path.join(os.environ["PCL_AUTOMATION_ROOT"], "Management")
    if os.environ.get("PCL_AUTOMATION_ROOT") else Path(__file__).resolve().parent))
FOLDER = _MGMT_DIR / "ROW_FILES"

# The four masters are never deleted.
KEEP_NAMES = {"loan.xlsx", "clientstz.xlsx", "settlements.xlsx", "users.xlsx"}
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
        if f.name.lower() in KEEP_NAMES or any(f.name.lower().startswith(p) for p in KEEP_PREFIXES):
            print(f"Kept (master): {f.name}")
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
