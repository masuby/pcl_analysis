import os
import re
import time
import smtplib
import sys
from dotenv import load_dotenv

from email_list import get_all_files_with_emails
from send_email_mtd import create_beautiful_email_html, send_email_with_attachment


DEFAULT_LOG_PATH = r"C:\Users\Daniel\.cursor\projects\c-Users-Daniel-Desktop-code-pcl\terminals\1.txt"
SENDING_LINE_RE = re.compile(r"^\[(\d+)/(\d+)\]\s+📤\s+Sending:\s+(.+)$")


def parse_failed_filenames_from_log(log_path):
    """
    Parse terminal log and return failed filename entries in order.
    A failure is detected when a "✗ Error sending email:" line appears after a sending line.
    """
    if not os.path.exists(log_path):
        raise FileNotFoundError(f"Log file not found: {log_path}")

    failed = []
    current_filename = None

    with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
        for raw_line in f:
            line = raw_line.strip()

            sending_match = SENDING_LINE_RE.match(line)
            if sending_match:
                current_filename = sending_match.group(3).strip()
                continue

            if line.startswith("✗ Error sending email:"):
                if current_filename:
                    failed.append(
                        {
                            "filename": current_filename,
                            "error": line.replace("✗ Error sending email:", "").strip(),
                        }
                    )

    return failed


def build_failed_file_list(all_files, failed_entries):
    """
    Match failed filenames from logs to available file metadata.
    """
    by_filename = {item["filename"]: item for item in all_files}
    selected = []
    missing = []
    seen = set()

    for entry in failed_entries:
        filename = entry["filename"]
        if filename in seen:
            continue
        seen.add(filename)

        file_info = by_filename.get(filename)
        if file_info:
            selected.append({"file_info": file_info, "last_error": entry["error"]})
        else:
            missing.append(filename)

    return selected, missing


def test_smtp_connection():
    """
    Quick SMTP connectivity test.
    """
    load_dotenv()
    email_sender = os.getenv("EMAIL_USERNAME")
    email_password = os.getenv("EMAIL_PASSWORD")

    if not email_sender or not email_password:
        print("✗ EMAIL_USERNAME / EMAIL_PASSWORD missing in .env")
        return False

    from send_email_mtd import SMTP_SERVER, SMTP_PORT  # local import to reuse constants

    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=30) as server:
            server.starttls()
            server.login(email_sender, email_password)
        return True
    except Exception as e:
        print(f"✗ SMTP test failed: {e}")
        return False


def resend_failed(log_path):
    print("=" * 70)
    print("MTD FAILED EMAIL RETRY")
    print("=" * 70)
    print(f"Log source: {log_path}")

    try:
        failed_entries = parse_failed_filenames_from_log(log_path)
    except FileNotFoundError as e:
        print(f"✗ {e}")
        return

    if not failed_entries:
        print("✓ No failed email entries found in log.")
        return

    all_files = get_all_files_with_emails()
    selected, missing = build_failed_file_list(all_files, failed_entries)

    print(f"\nDetected {len(failed_entries)} failed send attempt(s) in log.")
    print(f"Ready to retry {len(selected)} unique file(s).")

    if missing:
        print("\n⚠️  Failed entries not found in current output folders:")
        for name in missing:
            print(f"  - {name}")

    if not selected:
        print("Nothing to resend.")
        return

    print("\nFiles to resend:")
    for i, item in enumerate(selected, 1):
        fi = item["file_info"]
        print(
            f"{i:2d}. {fi['filename']}  "
            f"(TO {len(fi['email_info']['to'])}, CC {len(fi['email_info']['cc'])})"
        )
        print(f"    Last error: {item['last_error']}")

    confirm = input("\nProceed with resend of failed emails only? (yes/no): ").strip().lower()
    if confirm != "yes":
        print("Retry cancelled.")
        return

    print("\n🔐 Testing email connection...")
    if not test_smtp_connection():
        print("Stopping retry because SMTP connection test failed.")
        return
    print("✓ Email connection successful!")

    success_count = 0
    fail_count = 0
    max_attempts = 3

    print("\n" + "=" * 70)
    print("RESENDING FAILED EMAILS...")
    print("=" * 70)

    for idx, item in enumerate(selected, 1):
        fi = item["file_info"]
        filename = fi["filename"]
        email_info = fi["email_info"]
        date_info = email_info.get("date_from_file", {})

        current_day = int(date_info["day"]) if date_info.get("day") else 7
        current_month = date_info.get("month_eng")
        current_year = date_info.get("year")

        html_content = create_beautiful_email_html(
            subject=email_info["subject"],
            current_day=current_day,
            current_month=current_month,
            current_year=current_year,
        )

        print(f"\n[{idx}/{len(selected)}] 📤 Retrying: {filename}")
        sent = False

        for attempt in range(1, max_attempts + 1):
            if attempt > 1:
                wait_seconds = attempt * 2
                print(f"   Attempt {attempt}/{max_attempts} after {wait_seconds}s wait...")
                time.sleep(wait_seconds)
            else:
                print(f"   Attempt {attempt}/{max_attempts}...")

            sent = send_email_with_attachment(
                to_emails=email_info["to"],
                cc_emails=email_info["cc"],
                subject=email_info["subject"],
                file_path=fi["file_path"],
                html_content=html_content,
            )

            if sent:
                break

        if sent:
            success_count += 1
        else:
            fail_count += 1

    print("\n" + "=" * 70)
    print("RETRY COMPLETE")
    print("=" * 70)
    print(f"✓ Resent successfully: {success_count}")
    print(f"✗ Still failed: {fail_count}")


def main():
    # Avoid Windows cp1252 crashes when imported modules print Unicode symbols.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    custom_log_path = input(
        f"Enter log file path or press Enter for default:\n{DEFAULT_LOG_PATH}\n> "
    ).strip()
    log_path = custom_log_path if custom_log_path else DEFAULT_LOG_PATH
    resend_failed(log_path)


if __name__ == "__main__":
    main()
