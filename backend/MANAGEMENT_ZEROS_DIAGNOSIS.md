# Management Report Zeros – Root Cause and Fix

## What the diagnostic showed (2024-11-30)

- **Country branch**: 56,664 total, 35,932 active, 20,732 inactive
- **CS branch**: 0, 0, 0
- **Cs Asset Finance branch**: 0, 0, 0

So the DB has correct Country data but zeros for CS and Cs Asset Finance.

## Why this happens

1. **Data source**:  
   - **Sync (correct_and_sync_to_db)**: Uses the Clients file and writes metrics for Country, CS, Cs Asset Finance, LBF, SME, etc.  
   - **Go Excel parser**: Reads the Management Report Excel and extracts values from cells.

2. **Formatted vs plain files**:  
   - For **plain Excel** files, the Go parser reads values correctly → sync has never mattered.  
   - For **formatted Excel** files (colors, freeze panes, links, formulas), the Go parser often reads empty or formula strings → 0s for CS and Cs Asset Finance. Country can still be correct if it’s stored differently.

3. **Why Country works but CS doesn’t**:  
   - Country may be stored as a plain value in the file.  
   - CS and Cs Asset Finance may be formula cells or styled cells that the parser doesn’t resolve correctly.

## Root cause

Those reports with zeros for CS/Cs Asset Finance were never (or not fully) synced. Their `report_data` comes from the Go Excel parser only, which returns 0s for those cells on formatted files.

## Fix: run the sync

Sync must be run with `--source db` so all MANAGEMENT reports are updated from the Clients file:

```bash
cd backend
python scripts/correct_and_sync_to_db.py --source db
```

This will:

1. Load all MANAGEMENT reports from the database.
2. For each report date, load client counts from the Clients file.
3. Replace `report_data` with values from the Clients file (Country, CS, Cs Asset Finance, LBF, SME, etc.).
4. Do this even when Excel correction fails (formatted files).

## Verify after sync

```bash
python scripts/diagnose_report_data.py 2024-11-30
```

You should see non-zero values for CS.

Then:

1. Clear Redis cache (or use Admin > Refresh Views).
2. In the Management Dashboard, click **Refresh Data**.
