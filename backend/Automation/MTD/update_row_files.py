"""Clean MTD row files — remove the uploaded CS / LBF MTD source files after a run.

Removes the data files in MTD/ROW_FILES so the next run starts fresh. Any master
or reference workbook (master_* prefix) is kept.
"""
from __future__ import annotations

from pathlib import Path

FOLDER = Path(__file__).resolve().parent / "ROW_FILES"
KEEP_PREFIXES = ("master_",)
_DATA_EXT = {".xlsx", ".xls", ".xlsm", ".csv"}


def main() -> None:
    if not FOLDER.exists():
        print(f"No ROW_FILES folder: {FOLDER}")
        return
    removed = kept = 0
    for f in sorted(FOLDER.iterdir()):
        if not f.is_file() or f.suffix.lower() not in _DATA_EXT:
            continue
        if any(f.name.lower().startswith(p) for p in KEEP_PREFIXES):
            print(f"Kept (master): {f.name}")
            kept += 1
            continue
        try:
            f.unlink()
            print(f"Removed: {f.name}")
            removed += 1
        except Exception as exc:  # noqa: BLE001
            print(f"Could not remove {f.name}: {exc}")
    print(f"Done. Removed {removed} MTD source file(s); kept {kept} master(s).")


if __name__ == "__main__":
    main()
