"""
Send PCL Analysis System test invitation email.

Features:
- Professional HTML/CSS email template with a large CTA button
- "YES/NO" audience mode
  - NO  -> send to Daniel only
  - YES -> send to full team
- Reads sender credentials from .env.local (VITE_EMAIL_SENDER, VITE_EMAIL_APP_PASSWORD)

Usage:
    python send_test_system_email.py
"""

from __future__ import annotations

import os
import smtplib
from datetime import datetime
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path


TEAM_RECIPIENTS = [
    "borlando@premiergroup.co.ke",
    "yusuph@platinumcredit.co.tz",
    "cyprian.oyiengo@platinumcredit.co.ke",
    "daniel@platinumcredit.co.tz",
]

DANIEL_ONLY = ["daniel@platinumcredit.co.tz"]

TEST_URL = "https://154.72.68.246:8443/dashboard"
TEST_USERNAME = "admin@platinumcredit.com"
TEST_PASSWORD = "Test@2026"


def parse_simple_env(path: Path) -> dict[str, str]:
    """Parse KEY=VALUE lines from env-like file (lightweight parser)."""
    if not path.exists():
        return {}

    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        values[key] = value
    return values


def get_mail_credentials() -> tuple[str, str]:
    """Load sender credentials from env vars or .env.local."""
    sender = os.getenv("VITE_EMAIL_SENDER", "").strip()
    app_password = os.getenv("VITE_EMAIL_APP_PASSWORD", "").strip().strip('"').strip("'")

    if sender and app_password:
        return sender, app_password.replace(" ", "")

    env_file = Path(__file__).resolve().parent / ".env.local"
    parsed = parse_simple_env(env_file)

    sender = sender or parsed.get("VITE_EMAIL_SENDER", "").strip()
    app_password = app_password or parsed.get("VITE_EMAIL_APP_PASSWORD", "").strip().strip('"').strip("'")

    if not sender or not app_password:
        raise RuntimeError(
            "Missing email credentials. Set VITE_EMAIL_SENDER and "
            "VITE_EMAIL_APP_PASSWORD in .env.local."
        )

    # Gmail app passwords can include spaces for readability; remove for SMTP login.
    return sender, app_password.replace(" ", "")


def build_html_body() -> str:
    return f"""\
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PCL Analysis System - Test Access</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1e293b;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="700" cellspacing="0" cellpadding="0"
                 style="width:700px;max-width:92%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe7ff;">
            <tr>
              <td style="background:linear-gradient(135deg,#1e3a5f 0%, #2a5298 100%);padding:26px 28px;text-align:center;">
                <h1 style="margin:0;color:#ffffff;font-size:24px;line-height:1.25;text-align:center;">PCL Analysis System - Test Invitation</h1>
                <p style="margin:10px 0 0 0;color:#dbeafe;font-size:14px;line-height:1.6;text-align:center;">
                  Please review and test the current implementation.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 28px 8px 28px;">
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.7;">
                  Dear Team,
                </p>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.7;">
                  The <strong>PCL Analysis System (Test Environment)</strong> is now available for validation.
                  Kindly access the test platform, walk through the available modules, and validate the workflow against your expected reporting needs.
                </p>
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.7;">
                  <strong>Important:</strong> this is a <span style="color:#b91c1c;font-weight:700;">TEST system</span>.
                  Once final alignment and agreement are completed, the production-ready real system will be shared for full operational use.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:8px 28px 6px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                       style="background:#f8fbff;border:1px solid #d9e8ff;border-radius:10px;">
                  <tr>
                    <td style="padding:16px 16px;">
                      <h3 style="margin:0 0 10px 0;font-size:16px;color:#1e3a5f;">Test Access Details</h3>
                      <p style="margin:0 0 6px 0;font-size:14px;"><strong>URL:</strong> {TEST_URL}</p>
                      <p style="margin:0 0 6px 0;font-size:14px;"><strong>Username:</strong> {TEST_USERNAME}</p>
                      <p style="margin:0;font-size:14px;"><strong>Password:</strong> {TEST_PASSWORD}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:10px 28px;">
                <h3 style="margin:0 0 10px 0;font-size:16px;color:#1e3a5f;">Document Coverage Snapshot</h3>
                <ul style="margin:0 0 0 18px;padding:0;line-height:1.8;font-size:14px;">
                  <li>Dashboard views: Summary, Management, CRM, Call Center, MTD, Departmental, Challenge</li>
                  <li>Departmental suite: Score Card, Sales Review, Gap Analysis, KPI Analysis</li>
                  <li>Exports and distribution: Excel/PPT generation and HTML email delivery</li>
                  <li>Role-based access and admin controls for user/report/challenge management</li>
                  <li>Operational data flow from upload to visualization, export, and follow-up actions</li>
                </ul>
              </td>
            </tr>

            <tr>
              <td style="padding:10px 28px 0 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                       style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;color:#7c2d12;font-size:13px;line-height:1.7;">
                      Because the current link uses an IP-based SSL certificate, your browser may show a warning page.
                      Please click <strong>Advanced</strong> and then <strong>Proceed (unsafe)</strong> to continue to the test site.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:24px 28px 20px 28px;">
                <a href="{TEST_URL}"
                   style="display:inline-block;background:linear-gradient(135deg,#1e3a5f 0%, #2a5298 100%);
                          color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;
                          padding:16px 34px;border-radius:10px;box-shadow:0 8px 18px rgba(42,82,152,0.28);">
                  OPEN TEST SYSTEM
                </a>
              </td>
            </tr>

            <tr>
              <td style="padding:6px 28px 24px 28px;">
                <p style="margin:0;font-size:14px;line-height:1.7;">
                  Kindly test different features and share your feedback/observations.
                </p>
                <p style="margin:8px 0 0 0;font-size:14px;line-height:1.7;">
                  Regards,<br/>
                  <strong>Daniel Clement Masubi</strong><br/>
                  Senior Data Analyst & Sales Support, PCL
                </p>
              </td>
            </tr>

            <tr>
              <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 28px;">
                <p style="margin:0;font-size:12px;color:#64748b;">
                  Sent automatically on {datetime.now().strftime("%Y-%m-%d %H:%M")}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def build_plain_text_body() -> str:
    return f"""\
PCL Analysis System - Test Invitation

Dear Team,

The PCL Analysis System test environment is now available for validation.
Please visit:
{TEST_URL}

Login details:
- Username: {TEST_USERNAME}
- Password: {TEST_PASSWORD}

This is a TEST system.
Once solution alignment and agreement are completed, the real production system will be shared for operational use.

If the browser shows a certificate warning (IP-based SSL), click:
Advanced -> Proceed (unsafe)

Please test different features and share feedback.

Regards,
Daniel Clement Masubi
"""


def choose_recipients() -> list[str]:
    print("\nSend mode:")
    print("  NO  -> send only to Daniel")
    print("  YES -> send to full team")
    choice = input("\nSend to full team? (YES/NO): ").strip().upper()
    if choice == "YES":
        return TEAM_RECIPIENTS
    return DANIEL_ONLY


def send_email():
    sender, app_password = get_mail_credentials()
    recipients = choose_recipients()

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "PCL Analysis System - Test Access & Review Request"
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)

    plain = build_plain_text_body()
    html = build_html_body()
    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    # Attach latest PDF document if available
    pdf_path = Path(__file__).resolve().parent / "PCL_Analysis_System_Document.pdf"
    if pdf_path.exists():
        with pdf_path.open("rb") as f:
            part = MIMEApplication(f.read(), _subtype="pdf")
        part.add_header("Content-Disposition", "attachment", filename=pdf_path.name)
        msg.attach(part)

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(sender, app_password)
        server.sendmail(sender, recipients, msg.as_string())

    print("\nEmail sent successfully.")
    print(f"From: {sender}")
    print("To:")
    for r in recipients:
        print(f"  - {r}")


if __name__ == "__main__":
    send_email()
