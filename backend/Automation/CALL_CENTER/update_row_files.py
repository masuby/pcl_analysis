"""Update Call Center row files — remove the old uploaded raw files (Loan / CDR)
after a run, keeping the master and reference workbooks.

Kept (case-insensitive name prefix):
  master_cdr_call*   — agent→product lookup master
  zone and cluster*  — branch/zone reference
  master_email*      — recipient master

Everything else in ROW_FILES (loan_accounts*, pse-cdr*, …) is removed so the next
run starts from freshly uploaded files.
"""
from __future__ import annotations

from pathlib import Path

FOLDER = Path(__file__).resolve().parent / "ROW_FILES"
KEEP_PREFIXES = ("master_cdr_call", "zone and cluster", "master_email")


def main() -> None:
    if not FOLDER.exists():
        print(f"No ROW_FILES folder: {FOLDER}")
        return
    removed = kept = 0
    for f in sorted(FOLDER.iterdir()):
        if not f.is_file():
            continue
        low = f.name.lower()
        if any(low.startswith(p) for p in KEEP_PREFIXES):
            print(f"Kept (master/ref): {f.name}")
            kept += 1
            continue
        try:
            f.unlink()
            print(f"Removed: {f.name}")
            removed += 1
        except Exception as exc:  # noqa: BLE001
            print(f"Could not remove {f.name}: {exc}")
    print(f"Done. Removed {removed} old row file(s); kept {kept} master/reference file(s).")


if __name__ == "__main__":
    main()
