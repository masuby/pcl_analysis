import os
import subprocess
import sys


def run_script(script_path, report_date=None):
    """Run a CRM script and optionally pass report_date via stdin."""
    print(f"\nRunning: {script_path}")
    try:
        subprocess.run(
            [sys.executable, script_path],
            input=f"{report_date}\n" if report_date else None,
            text=True,
            check=True,
        )
        print(f"Completed: {script_path}")
    except subprocess.CalledProcessError as exc:
        print(f"Failed: {script_path} (exit code {exc.returncode})")
        raise


def main():
    report_date = input("Enter the MOST RECENT login date (dd/mm/yyyy): ").strip()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    scripts = [
        os.path.join(base_dir, "ROW_EXCEL", "correct_lead_report.py"),
        os.path.join(base_dir, "CS", "cs_crm_report_copy.py"),
        os.path.join(base_dir, "CS", "crm_cs_email.py"),
        os.path.join(base_dir, "LBF", "lbf_crm_report_copy.py"),
        os.path.join(base_dir, "LBF", "crm_lbf_email.py"),
        os.path.join(base_dir, "SME", "sme_crm_report_copy.py"),
        os.path.join(base_dir, "SME", "crm_sme_email.py"),
        # os.path.join(base_dir, "AGRI", "agri_crm_report_copy.py"),
        # os.path.join(base_dir, "AGRI", "crm_agri_email.py"),
        os.path.join(base_dir, "ROW_EXCEL", "update_master_crm_files.py"),
    ]

    for script in scripts:
        if not os.path.exists(script):
            raise FileNotFoundError(f"Script not found: {script}")

    # Run lead correction first (no date input), then CRM reports/emails, then
    # refresh the master files from each department NEW_EXCEL folder.
    run_script(scripts[0], report_date=None)
    for script in scripts[1:-1]:
        run_script(script, report_date)
    run_script(scripts[-1], report_date=None)

    print("\nAll CRM scripts completed successfully.")

    # === END PROCESS: upload freshly generated reports to the live PCL system ===
    # Runs direct_upload_files_to_db.py --commit, which logs in over SSH, dedups by
    # (department, type, date) and uploads only files not already in the DB.
    upload_script = r"C:\Users\Daniel\Desktop\code\pcl\CRM\direct_upload_files_to_db.py"
    print("\n" + "=" * 78)
    print("END PROCESS: uploading new report(s) to the live PCL system …")
    print("=" * 78)
    try:
        subprocess.run([sys.executable, upload_script, "--commit"], check=False)
    except Exception as exc:
        print(f"⚠️  Upload step could not run: {exc}")
        print(f'   You can upload manually:  python "{upload_script}" --commit')


if __name__ == "__main__":
    main()

