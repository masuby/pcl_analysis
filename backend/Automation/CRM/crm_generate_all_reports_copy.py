"""crm_generate_all_reports copy.py — TEST COPY of crm_generate_all_reports.py.

Same one-pass report generation, with two differences:
  * emails go to the FEW intended people only (uses the " copy" email
    scripts: CS/crm_cs_email copy.py, LBF/crm_lbf_email copy.py,
    SME/crm_sme_email copy.py - edit receiver_emails there);
  * runs EVERYTHING automatically with no flags needed: reports ->
    emails (few people) -> refresh ROW_EXCEL master row files.
    (--upload is still opt-in.)

Replaces the per-department report scripts (CS/cs_crm_report_copy.py,
LBF/lbf_crm_report_copy.py, SME/sme_crm_report_copy.py) which each re-read the
same ROW_EXCEL source exports and re-did the same processing three times over.

What it does, once:
  1. Lead correction   - runs ROW_EXCEL/correct_lead_report.py (same as before).
  2. Shared processing - reads user_list / activities / agent_activities /
     lead_report ONE time, enhances + filters users and sets Login_Result once.
  3. Per department    - only the cheap part is repeated: mapping Zone/Product
     from that department's master user_data (kept per-department so results
     match the old scripts exactly), then the 5 data sheets are written into
     the department master via ONE shared Excel instance with BULK range
     writes (the old scripts wrote row by row), refreshed and saved as
     <DEPT>_CRM_dd_mm_yyyy.xlsx in the department NEW_EXCEL folder.

Optional end steps (off by default so the script is safe to test):
  --emails         also run the department email scripts
  --update-master  refresh ROW_EXCEL masters from each NEW_EXCEL (like before)
  --upload         upload to the live PCL system (direct_upload_files_to_db.py)
  --full           all of the above, i.e. the whole old crm_combined.py flow

Usage:
    python crm_generate_all_reports.py                 # prompts for the date
    python crm_generate_all_reports.py 04/07/2026
    python crm_generate_all_reports.py 04/07/2026 --only CS,SME
    python crm_generate_all_reports.py 04/07/2026 --full
"""
from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
import xlwings as xw

BASE_DIR = Path(__file__).resolve().parent
ROW_DIR = BASE_DIR / "ROW_EXCEL"

DEPARTMENTS = [
    # code, master filename prefix (lower-case), output folder, output prefix
    {"code": "CS",  "prefix": "cs_crm",  "out_dir": BASE_DIR / "CS" / "NEW_EXCEL",  "out_prefix": "CS_CRM"},
    {"code": "LBF", "prefix": "lbf_crm", "out_dir": BASE_DIR / "LBF" / "NEW_EXCEL", "out_prefix": "LBF_CRM"},
    {"code": "SME", "prefix": "sme_crm", "out_dir": BASE_DIR / "SME" / "NEW_EXCEL", "out_prefix": "SME_CRM"},
    # {"code": "AGRI", "prefix": "agri_crm", "out_dir": BASE_DIR / "AGRI" / "NEW_EXCEL", "out_prefix": "AGRI_CRM"},
]

EMAIL_SCRIPTS = {
    "CS":  BASE_DIR / "CS" / "crm_cs_email copy.py",
    "LBF": BASE_DIR / "LBF" / "crm_lbf_email copy.py",
    "SME": BASE_DIR / "SME" / "crm_sme_email copy.py",
}

SHEETS_TO_COPY = ["user_data", "activity_data", "agent_activity",
                  "Today's activity_data", "Lead_Report"]

BLOCKED_TENANTS = [
    "Head Office", "Head Office,Head_Office",
    "Head Office,Platinum Credit Tanzania",
    "Head Office,Platinum Credit Tanzania,SME Arusha,SME MBEYA,SME MOROGORO,SME MOSHI,SME Tazara,SME TEGETA",
    "Platinum Credit Tanzania",
]

CHUNK_ROWS = 2000  # bulk-write block size for xlwings


# ------------------------------------------------------------- source files --
def detect_source_files():
    """Classify the ROW_EXCEL exports exactly like the old scripts did."""
    files = [p for p in ROW_DIR.iterdir()
             if p.suffix.lower() == ".xlsx" and not p.name.startswith("~$")]
    if not files:
        raise ValueError(f"No Excel files found in {ROW_DIR}")

    src = {"activities": [], "agent": None, "lead": None, "user_list": None, "masters": {}}
    for p in sorted(files):
        name = p.name.lower()
        if name.startswith("activities_report"):
            src["activities"].append(p)
        elif name.startswith("agent_activities_report"):
            src["agent"] = p
        elif name.startswith("lead_report"):
            src["lead"] = p
        elif name.startswith("user_list_report"):
            src["user_list"] = p
        else:
            for dept in DEPARTMENTS:
                if name.startswith(dept["prefix"]):
                    src["masters"][dept["code"]] = p
    if src["user_list"] is None:
        raise ValueError("No User_List_Report file found in ROW_EXCEL")
    return src


def latest_start_date(df):
    if "Expected_Start_Date" not in df.columns:
        return None
    parsed = pd.to_datetime(df["Expected_Start_Date"], errors="coerce", dayfirst=True)
    if parsed.isna().all():
        parsed = pd.to_datetime(df["Expected_Start_Date"], errors="coerce")
    parsed = parsed.dt.date.dropna()
    return parsed.max() if not parsed.empty else None


# -------------------------------------------------------- shared processing --
def extract_month(value):
    try:
        if "/" in str(value):
            month = str(value).split(" ")[0].split("/")[1]
            return month if len(month) == 2 else "ERR"
        return "ERR"
    except Exception:
        return "ERR"


def build_base_users(users: pd.DataFrame, manual_date: pd.Timestamp) -> pd.DataFrame:
    """Everything the old STEP 3-5 did that does NOT depend on the department:
    insert Zone/Product/Month columns, month/tenant filtering, login status."""
    users = users.copy()
    if "Teams" in users.columns and "Tenant" in users.columns:
        users.insert(users.columns.get_loc("Tenant"), "Zone", "")
    if "Last_Login" in users.columns and "Products" in users.columns:
        users.insert(users.columns.get_loc("Products"), "Product", "")
    if "Login_Location" in users.columns and "Last_Login" in users.columns:
        users.insert(users.columns.get_loc("Last_Login"), "Month", "")
    users["Month"] = users["Last_Login"].apply(extract_month)

    current_month = datetime.now().month
    prev_month = 12 if current_month == 1 else current_month - 1
    allowed = ["ERR", f"{current_month:02d}", f"{prev_month:02d}"]

    bad_months = users[~users["Month"].isin(allowed)].copy()
    bad_tenants = bad_months[bad_months["Tenant"].isin(BLOCKED_TENANTS)].copy()
    removed = bad_months.merge(bad_tenants, how="left", indicator=True)
    removed = removed[removed["_merge"] == "left_only"].drop(columns=["_merge"])

    users["User_Name"] = users["User_Name"].astype(str).str.strip()
    removed["User_Name"] = removed["User_Name"].astype(str).str.strip()
    df = users[~users["User_Name"].isin(removed["User_Name"])].copy()

    login_dt = pd.to_datetime(df["Last_Login"].astype(str).str.split().str[0],
                              format="%d/%m/%Y", errors="coerce")
    df["Login_Result"] = [
        "Logged In" if (pd.notna(d) and d == manual_date and r == "Success") else "Not Logged In"
        for d, r in zip(login_dt, df["Login_Result"])
    ]
    return df


def map_series(series, mapping):
    return series.map(lambda x: mapping.get(x, "ERR"))


def build_department_frames(base_users, crm_user_data, shared):
    """The only per-department work: Zone/Product lookups from that
    department master's user_data sheet. Returns {sheet_name: DataFrame}."""
    tz = {}
    tp = {}
    for _, r in crm_user_data.drop_duplicates(subset=["Tenant"], keep="first").iterrows():
        tz[r["Tenant"]] = r["Zone"]
        tp[r["Tenant"]] = r["Product"]

    users = base_users.copy()
    users["Zone"] = map_series(users["Tenant"], tz)
    users["Product"] = map_series(users["Tenant"], tp)
    frames = {"user_data": users}

    # Branch -> Zone/Product lookup from the department-processed users
    lk = users[["Tenant", "Zone", "Product"]].drop_duplicates(subset=["Tenant"], keep="first")
    bz = dict(zip(lk["Tenant"], lk["Zone"]))
    bp = dict(zip(lk["Tenant"], lk["Product"]))

    for sheet, df in [("Today's activity_data", shared.get("today")),
                      ("agent_activity", shared.get("agent")),
                      ("activity_data", shared.get("activities"))]:
        if df is None:
            continue
        df = df.copy()
        for col in ["Zone", "Product"]:
            if col not in df.columns:
                df[col] = ""
        if "Branch" in df.columns:
            df["Zone"] = map_series(df["Branch"], bz)
            df["Product"] = map_series(df["Branch"], bp)
        frames[sheet] = df

    if shared.get("lead") is not None:
        df = shared["lead"].copy()
        for col in ["Zone", "PRODUCT"]:
            if col not in df.columns:
                df[col] = ""
        if not crm_user_data.empty and {"Name", "Zone", "Product"} <= set(crm_user_data.columns):
            lu = crm_user_data[["Name", "Zone", "Product"]].drop_duplicates(subset=["Name"], keep="first")
            lu = lu.assign(_key=lu["Name"].astype(str).str.strip())
            nz = dict(zip(lu["_key"], lu["Zone"]))
            np_ = dict(zip(lu["_key"], lu["Product"]))
            created = df["Created_By"].astype(str).str.strip() if "Created_By" in df.columns else None
            if created is not None:
                df["Zone"] = map_series(created, nz)
                df["PRODUCT"] = map_series(created, np_)
        frames["Lead_Report"] = df

    return frames


# ------------------------------------------------------------- excel output --
def df_to_matrix(df, headers):
    """DataFrame -> 2D list aligned to the master's header order (None where
    the master column has no counterpart in the processed data)."""
    cols = {}
    for h in headers:
        if h in df.columns:
            col = df[h]
            cols[h] = col.where(pd.notna(col), None).tolist()
    n = len(df)
    return [[cols[h][i] if h in cols else None for h in headers] for i in range(n)]


def write_sheet(ws, df, sheet_name):
    headers = []
    for cell in ws.range("1:1"):
        if cell.value is None:
            break
        headers.append(cell.value)
    if not headers:
        print(f"    {sheet_name}: master sheet has no header row - skipped")
        return

    matching = [h for h in headers if h in df.columns]
    if not matching:
        print(f"    {sheet_name}: no matching columns - skipped")
        return

    used = ws.used_range
    last_row = used.last_cell.row if used is not None else 1
    if last_row > 1:
        ws.range((2, 1), (last_row, len(headers))).clear_contents()

    matrix = df_to_matrix(df, headers)
    for start in range(0, len(matrix), CHUNK_ROWS):
        ws.range((2 + start, 1)).value = matrix[start:start + CHUNK_ROWS]
    print(f"    {sheet_name}: {len(matrix)} rows, {len(matching)}/{len(headers)} matching columns")


def update_master(app, master_path, frames, out_path):
    print(f"  Opening master: {master_path.name}")
    try:
        wb = app.books.open(str(master_path), update_links=False, corrupt_load=1)
    except Exception:
        wb = app.books.open(str(master_path), update_links=False, corrupt_load=2)
    try:
        for sheet_name in SHEETS_TO_COPY:
            if sheet_name not in [s.name for s in wb.sheets]:
                print(f"    {sheet_name}: not in master - skipped")
                continue
            if sheet_name not in frames:
                print(f"    {sheet_name}: no processed data - skipped")
                continue
            write_sheet(wb.sheets[sheet_name], frames[sheet_name], sheet_name)

        print("  Refreshing pivots and recalculating...")
        wb.api.RefreshAll()
        wb.app.calculate()
        time.sleep(3)

        out_path.parent.mkdir(parents=True, exist_ok=True)
        wb.save(str(out_path))
        print(f"  Saved: {out_path}")
    finally:
        try:
            wb.close()
        except Exception:
            pass


# -------------------------------------------------------------- other steps --
def run_lead_correction():
    script = ROW_DIR / "correct_lead_report.py"
    spec = importlib.util.spec_from_file_location("correct_lead_report", script)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.main()


def run_subprocess(script, stdin_text=None, check=True, extra_args=()):
    print(f"\nRunning: {script}")
    subprocess.run([sys.executable, str(script), *extra_args],
                   input=stdin_text, text=True, check=check)


# --------------------------------------------------------------------- main --
def main():
    ap = argparse.ArgumentParser(description="Generate all department CRM reports in one pass.")
    ap.add_argument("date", nargs="?", help="MOST RECENT login date dd/mm/yyyy (prompted if omitted)")
    ap.add_argument("--only", help="Comma-separated department codes to run (e.g. CS,SME)")
    ap.add_argument("--skip-lead-fix", action="store_true", help="Skip the lead correction step")
    ap.add_argument("--emails", action="store_true", help="Also send the department emails")
    ap.add_argument("--update-master", action="store_true",
                    help="Refresh ROW_EXCEL masters from NEW_EXCEL folders at the end")
    ap.add_argument("--upload", action="store_true", help="Upload reports to the live PCL system")
    ap.add_argument("--full", action="store_true", help="Emails + update-master + upload (old crm_combined flow)")
    args = ap.parse_args()

    manual_date_str = args.date or input("Enter the MOST RECENT login date (dd/mm/yyyy): ").strip()
    manual_date = pd.to_datetime(manual_date_str, format="%d/%m/%Y")
    # TEST COPY: always email (few people) and always refresh the row files
    do_emails = True
    do_update = True
    do_upload = args.upload or args.full

    departments = DEPARTMENTS
    if args.only:
        wanted = {c.strip().upper() for c in args.only.split(",")}
        departments = [d for d in DEPARTMENTS if d["code"] in wanted]
        if not departments:
            raise SystemExit(f"--only matched no departments: {args.only}")

    t0 = time.time()

    # STEP 1: lead correction (was a separate subprocess in crm_combined.py)
    if not args.skip_lead_fix:
        print("=" * 70)
        print("STEP 1: correcting the lead report")
        print("=" * 70)
        run_lead_correction()

    # STEP 2: read + process shared data ONCE
    print("\n" + "=" * 70)
    print("STEP 2: shared processing (read each source file once)")
    print("=" * 70)
    src = detect_source_files()

    activities_dfs = [(p, pd.read_excel(p)) for p in src["activities"]]
    shared = {
        "agent": pd.read_excel(src["agent"]) if src["agent"] else None,
        "lead": pd.read_excel(src["lead"]) if src["lead"] else None,
        "activities": activities_dfs[0][1] if activities_dfs else None,
        "today": None,
    }

    today_df, today_date = None, None
    for p, df in activities_dfs:
        d = latest_start_date(df)
        if d:
            print(f"  {p.name}: max Expected_Start_Date = {d}")
            if today_date is None or d > today_date:
                today_date, today_df = d, df
    if today_df is None and activities_dfs:
        today_df = activities_dfs[0][1]
    shared["today"] = today_df

    users_raw = pd.read_excel(src["user_list"])
    base_users = build_base_users(users_raw, manual_date)
    print(f"  user_list: {len(users_raw)} rows -> {len(base_users)} after filtering")

    # STEP 3: update every department master in ONE Excel session
    print("\n" + "=" * 70)
    print("STEP 3: updating department masters (single Excel instance)")
    print("=" * 70)
    date_tag = manual_date_str.replace("/", "_")

    app = xw.App(visible=False)
    app.display_alerts = False
    try:
        app.api.AskToUpdateLinks = False
        app.api.AutomationSecurity = 3  # block macros silently
    except Exception:
        pass

    made, failed = [], []
    try:
        for dept in departments:
            code = dept["code"]
            master = src["masters"].get(code)
            print(f"\n[{code}]")
            if master is None:
                print(f"  No {dept['prefix']}* master found in ROW_EXCEL - skipped")
                failed.append(code)
                continue
            try:
                crm_user_data = pd.read_excel(master, sheet_name="user_data")
                frames = build_department_frames(base_users, crm_user_data, shared)
                out_path = dept["out_dir"] / f"{dept['out_prefix']}_{date_tag}.xlsx"
                update_master(app, master, frames, out_path)
                made.append(code)
            except Exception as exc:
                print(f"  FAILED: {exc}")
                failed.append(code)
    finally:
        app.quit()
        print("\nExcel application closed")

    print("\n" + "=" * 70)
    print(f"Reports done in {time.time() - t0:.0f}s - OK: {', '.join(made) or 'none'}"
          + (f" | FAILED: {', '.join(failed)}" if failed else ""))
    print("=" * 70)

    # Optional end steps (same order as the old crm_combined.py)
    if do_emails:
        for dept in departments:
            script = EMAIL_SCRIPTS.get(dept["code"])
            if script and script.exists() and dept["code"] in made:
                run_subprocess(script, stdin_text=f"{manual_date_str}\n")
    if do_update:
        run_subprocess(ROW_DIR / "update_master_crm_files.py")
    if do_upload:
        run_subprocess(BASE_DIR / "direct_upload_files_to_db.py", check=False,
                       extra_args=("--commit",))


if __name__ == "__main__":
    main()
