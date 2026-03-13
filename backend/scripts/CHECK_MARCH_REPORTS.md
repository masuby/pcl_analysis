# March 3 & March 7 Management Reports – DB Check

## What was checked

- **Reports table**: MANAGEMENT, is_active=true, date = March 3 or March 7 (any year).
- **report_data table**: Rows with `sheet_name = 'Country' OR sheet_name IS NULL` per report (same condition as `GetAllManagementReportData`).

## Result (from `check_management_reports.sql`)

| Report date | File                         | In `reports`? | Rows in `report_data` (Country) | Used in Management Summary / useManagementData? |
|-------------|-----------------------------|----------------|----------------------------------|-------------------------------------------------|
| 2026-03-03  | Management Report2026-03 (1).xlsx | Yes            | **0**                            | **No** – no parsed data                         |
| 2026-03-07  | Management Report2026-03.xlsx     | Yes            | **0**                            | **No** – no parsed data                         |

So both reports **are** in the database and **are** returned by the reports API (and thus by `getAllReports` in `useManagementData`). They **do not** appear in Management Summary or in `parsedReports` because:

1. `useManagementData` calls `getBatchReportData()` which hits the backend `GetAllManagementReportData()`.
2. That query only returns data for reports that have rows in `report_data` with `sheet_name = 'Country' OR sheet_name IS NULL`.
3. For March 3 and March 7, **country_rows = 0**, so they are not in the batch map. In `loadParsedData`, `batchData[report.id]` is empty, so those reports are filtered out and never added to `parsedReports`.

## What to do

The Excel files for these two reports were either not parsed successfully or the parser did not write to `report_data` (e.g. wrong sheet name or format). To have them show in Management Summary:

1. **Re-parse** the two reports so that `report_data` gets rows (Country sheet). From backend dir (with Go in PATH):
   ```bash
   go run ./scripts/reparse_all.go
   ```
   Or re-parse only these report IDs if you add a small script.

2. **Check upload path**: Ensure the files exist under `backend/uploads/...` at the paths stored in `reports.file_path` for those two IDs.

3. **Check parser**: If reparse fails, check backend logs when the file was uploaded (or run the parser manually) to see why no Country sheet data was stored.

## How to re-run the check

```bash
# From backend, with Postgres running (e.g. docker compose up -d postgres):
Get-Content .\scripts\check_management_reports.sql | docker exec -i pcl-postgres psql -U pcl_user -d pcl_analysis
```

Or run the Go script (from backend, with Go in PATH):

```bash
go run ./scripts/check_management_reports.go
```
