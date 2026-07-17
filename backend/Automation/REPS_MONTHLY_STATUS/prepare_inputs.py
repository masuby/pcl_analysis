"""Auto-source the Reps Monthly Status inputs from the backend.

Instead of re-uploading, this copies the most recently updated Loan and Users
workbooks already on the server into REPS_MONTHLY_STATUS/ROW_FILES so the report
can run. The CS CRM file is read by the report itself from CRM/CS/NEW_EXCEL.

Search order (newest matching file wins):
  Loan  : REPS ROW_FILES -> Management ROW_FILES -> Call Center ROW_FILES
  Users : REPS ROW_FILES -> Management ROW_FILES

If a file was uploaded straight to REPS/ROW_FILES it is preferred when newest,
so manual override still works.
"""
from __future__ import annotations

import os
import re
import shutil
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_ROOT = Path(os.environ.get("PCL_AUTOMATION_ROOT") or _SCRIPT_DIR.parent)
REPS_ROW = _SCRIPT_DIR / "ROW_FILES"
REPS_ROW.mkdir(parents=True, exist_ok=True)

_DATA_EXT = {".xlsx", ".xls", ".xlsm"}


def _match_in(d: Path, pattern: str, exclude: set[str]) -> Path | None:
    if not d.exists():
        return None
    ms = [f for f in d.iterdir()
          if f.is_file() and f.suffix.lower() in _DATA_EXT
          and re.search(pattern, f.name.lower()) and f.name.lower() not in exclude]
    return max(ms, key=lambda f: f.stat().st_mtime) if ms else None


def _resolve(dirs_with_exclude: list[tuple[Path, set[str]]], pattern: str) -> Path | None:
    """First dir (by priority) with a match wins; newest within it. The auto-copy
    target names are excluded from the REPS dir so a stale copy never shadows the
    canonical Management source, while a differently-named manual upload overrides."""
    for d, exc in dirs_with_exclude:
        r = _match_in(d, pattern, exc)
        if r:
            return r
    return None


def main() -> None:
    mgmt = _ROOT / "Management" / "ROW_FILES"
    call = _ROOT / "CALL_CENTER" / "ROW_FILES"
    crm_cs = _ROOT / "CRM" / "CS" / "NEW_EXCEL"

    loan = _resolve([(REPS_ROW, {"loan.xlsx"}), (mgmt, set()), (call, set())], r"loan")
    users = _resolve([(REPS_ROW, {"users.xlsx"}), (mgmt, set())], r"users")
    cs_crm = _resolve([(crm_cs, set())], r"cs_crm")

    missing = []
    if loan:
        dst = REPS_ROW / "Loan.xlsx"
        if loan.resolve() != dst.resolve():
            shutil.copy2(loan, dst)
        print(f"Loan   <- {loan}")
    else:
        missing.append("Loan (loan*.xlsx in REPS / Management / Call Center)")

    if users:
        dst = REPS_ROW / "Users.xlsx"
        if users.resolve() != dst.resolve():
            shutil.copy2(users, dst)
        print(f"Users  <- {users}")
    else:
        missing.append("Users (users*.xlsx in REPS / Management)")

    print(f"CS CRM (auto-read by report) <- {cs_crm if cs_crm else 'NONE found in CRM/CS/NEW_EXCEL'}")

    if missing:
        print("ERROR: could not auto-source the following — upload them once via any "
              "pipeline (or straight to REPS) and re-run:")
        for m in missing:
            print(f"  - {m}")
        sys.exit(1)

    print("Inputs ready in ROW_FILES (Loan.xlsx, Users.xlsx).")


if __name__ == "__main__":
    main()
