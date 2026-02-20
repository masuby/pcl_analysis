# Management Report Correction – Understanding & Implementation Plan

## Summary of Understanding

### 1. **Current Data Storage (Backend)**
- **Reports table**: Stores metadata for each report (id, title, file_name, file_path, type, date, etc.)
- **report_data table**: Stores parsed Excel data (report_id, sheet_name, branch, metric_name, metric_value, report_date)
- Management reports have `type = 'MANAGEMENT'`
- Files are stored in `UPLOAD_PATH` (e.g. `backend/uploads/`), with `file_path` like `ALL/MANAGEMENT/1765960142788_Management_Report2025-12.xlsx`
- The **Country sheet** is the main sheet used for branch-level metrics
- Each report has a `date` field – the report generation date used for filtering clients

### 2. **Source of Truth: Clients File**
- **File**: `Clients-platinumtanzania-dmasubi-2026-02-14T08_37_08.734_03_00.xlsx`
- **Columns used**: Full Name, Client State, Branch, Created, Sales Reps
- **Client State**: Indicates Active vs Inactive
- **Branch**: Branch name – used to match Management Report rows (e.g. "Bariadi", "Chato")
- **Created**: Client creation date – we filter: **all clients with Created ≤ report date**

### 3. **Management Report Structure (Country Sheet)**
From the hierarchy image:
- **Branches** (leaf level): Bariadi, Chato, Geita, Kahama, Shinyanga, Bukoba, etc.
- **Zones** (sum of branches): Western Zone = Bariadi + Chato + Geita + Kahama + Shinyanga
- **Clusters** (sum of zones): Cluster 1 = Northern Zone + Pwani Zone + Central Zone; clusters separated by empty row
- **CS row** = sum of Cluster 1 + Cluster 2 + Cluster 3
- **LBF row** = Lbf Cluster (separate section)
- **Other sections**: ZANZIBAR, Lbf Cluster, CS Call center, Lbf Call Center, SME, Maziwa

### 4. **Metrics to Correct**
- **Number of clients** = Total count (Active + Inactive) per branch
- **Active Clients** = Count where Client State = "Active"
- **Inactive Clients** = Count where Client State = "Inactive"

### 5. **Correction Logic (Per Management Report)**

**Step 1: Get report date** from report metadata (e.g. 13/02/2026)

**Step 2: Filter Clients file**  
- Keep only rows where `Created` ≤ report date (clients that existed at report time)

**Step 3: For each Branch row in Management Report Country sheet**
- Match Branch name (e.g. "Bariadi") to Clients file `Branch` column
- Count: Total, Active (Client State = Active), Inactive (Client State = Inactive)
- Update the Management Report: Number of clients, Active Clients, Inactive Clients

**Step 4: Recalculate aggregates**
- **Zones** = sum of their branch rows
- **Clusters** = sum of their zone rows (clusters separated by empty row)
- **CS row** = Cluster 1 + Cluster 2 + Cluster 3
- **LBF row** = Lbf Cluster (from Lbf Cluster section)

---

## Implementation Phases

### Phase 1: Backup & Discovery
1. Query DB for all MANAGEMENT reports
2. Count and list them with metadata (id, file_path, date)
3. Copy all Management Report files to `backend/backup/management_reports/`
4. Export metadata to `backend/backup/management_reports_metadata.json`

### Phase 2: Read & Validate
1. Read Clients file – columns, sample data, unique Branches, Client State values
2. Read one Management Report Country sheet – columns, Branch column structure, row hierarchy
3. Build branch-name mapping (Management Report names ↔ Clients file Branch names) if needed

### Phase 3: Correction Script
1. For each Management Report:
   - Get report date
   - Filter Clients by Created ≤ report date
   - For each branch row: get counts from Clients, update Excel cells
   - Recalculate Zone, Cluster, CS, LBF rows
   - Save modified Excel file
2. Re-parse updated reports into `report_data` (optional, or use reparse script)

---

## How to Run (Python – Preserves Formatting)

**Important**: The Node.js script (`correct-management-reports.mjs`) destroys Excel formatting (colors, freeze panes, links). Use the **Python script** instead.

### Prerequisites
```bash
pip install -r requirements.txt
```

### Step 1: Backup (creates backend/backup/management_reports/)
```bash
node scripts/management-reports-backup.mjs
```
Or: `npm run backup-management-reports`

### Step 2: Restore from backup (if uploads were corrupted)
```bash
python scripts/restore_from_backup.py
```
Copies original formatted files from backup back to uploads.

### Step 3: Correct reports (preserves formatting)
```bash
python scripts/correct_management_reports.py
```
- Reads from ManagementCorrection or uploads
- Uses Clients file + Zone and cluster.xlsx (true source of truth)
- Saves to **ManagementCorrection/readable/** with readable names
- Writes readable_metadata.json

### Step 4: Sync to database (RECOMMENDED – fast, no Go parsing)

**Python script** – copies files, updates DB metadata, writes report_data directly from Clients (no slow Excel parsing):
```bash
cd backend && python scripts/correct_and_sync_to_db.py
```
- **--source readable** (default): Use corrected files from readable/
- **--source uploads**: Correct files in uploads/ALL/MANAGEMENT/ in-place, then sync
- **--dry-run**: Preview without writing

### Alternative: Go sync (slower)
```bash
go run scripts/sync_readable_to_db.go -quick   # Copy + DB only
go run scripts/reparse_all.go                  # Parse Excel (slow)
```

### Legacy (Node.js – destroys formatting)
```bash
node scripts/correct-management-reports.mjs  # Do NOT use – destroys formatting
```

---

## File Paths
- **Clients file**: `backend/Clients-platinumtanzania-dmasubi-2026-02-14T08_37_08.734_03_00.xlsx`
- **Management Report sample**: `backend/Management Report2026-02.xlsx`
- **Upload path**: `backend/uploads/` (or from env `UPLOAD_PATH`)
- **Backup output**: `backend/backup/management_reports/`
