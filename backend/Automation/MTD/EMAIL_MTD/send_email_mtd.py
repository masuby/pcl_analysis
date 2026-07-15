import os
import smtplib
import json
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from datetime import datetime
import re
from email_list import get_all_files_with_emails, convert_month_to_swahili
from dotenv import load_dotenv

# Email configuration (HARDCODED - replace with your actual credentials)
load_dotenv()

EMAIL_SENDER = os.getenv("EMAIL_USERNAME")
EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587

def create_beautiful_email_html(subject, current_day=24, current_month=None, current_year=None):
    """
    Create beautiful HTML email with blue theme.
    When current_month and current_year are provided (from row file date), use them;
    otherwise fall back to datetime.now().
    """
    now = datetime.now()
    current_month = current_month or now.strftime("%B").upper()
    current_year = current_year or now.strftime("%Y")
    
    # Convert month to Swahili
    month_sw = convert_month_to_swahili(current_month)
    
    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>{subject}</title>
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                line-height: 1.6;
                color: #333;
                margin: 0;
                padding: 0;
                background-color: #f5f7fa;
            }}
            .email-container {{
                width: 100%;
                margin: 0 auto;
                background-color: white;
                overflow: hidden;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
            }}
            .header {{
                background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
                color: white;
                padding: 30px;
                text-align: center;
                border-bottom: 5px solid #4a90e2;
            }}
            .header h1 {{
                margin: 0;
                font-size: 28px;
                font-weight: 600;
                letter-spacing: 1px;
            }}
            .header .subtitle {{
                font-size: 16px;
                opacity: 0.9;
                margin-top: 10px;
            }}
            .content {{
                padding: 40px;
            }}
            .greeting {{
                font-size: 18px;
                color: #1e3c72;
                margin-bottom: 25px;
                font-weight: 600;
            }}
            .message {{
                font-size: 16px;
                margin-bottom: 30px;
                color: #444;
            }}
            .highlight-box {{
                background-color: #f0f7ff;
                border-left: 4px solid #4a90e2;
                padding: 20px;
                margin: 25px 0;
                border-radius: 0 5px 5px 0;
            }}
            .highlight-box p {{
                margin: 0;
                color: #1e3c72;
                font-weight: 500;
            }}
            .period {{
                font-weight: bold;
                color: #2a5298;
            }}
            .signature {{
                margin-top: 40px;
                padding-top: 20px;
                border-top: 2px solid #eaeaea;
            }}
            .signature p {{
                margin: 5px 0;
            }}
            .name {{
                font-weight: bold;
                color: #1e3c72;
                font-size: 17px;
            }}
            .footer {{
                background-color: #f8f9fa;
                padding: 20px;
                text-align: center;
                color: #666;
                font-size: 12px;
                border-top: 1px solid #eaeaea;
            }}
            .company-name {{
                color: #1e3c72;
                font-weight: bold;
                font-size: 14px;
            }}

        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="header">
                <h1>{subject}</h1>
                <div class="subtitle">Ripoti ya Malengo na Mauzo</div>
            </div>
            
            <div class="content">
                <div class="greeting">Habari,</div>
                
                <div class="message">
                    Naomba mpitie malengo na mauzo yenu kama yako sawa 
                    <span class="period">KUANZIA TAREHE 1 HADI TAREHE {current_day} {month_sw} {current_year}</span> 
                    kama kuna marekebisho usisite kuwasilisha kwa <span class="period">CREDIT/COORDINATOR</span> kabla ya <span class="period">SAA 8:00 Mchana. Ahsante</span>
                </div>
                
                <div class="highlight-box">
                    <p>📊 <strong>MUHTASARI WA UTAFITI:</strong> Tafadhali pakua faili iliyoambatanishwa kwa ajili ya maelezo kamili ya utendaji kazi wako.</p>
                </div>
                               
                <div class="signature">
                    <p class="name">Raphael Mwalutambi</p>
                    <p>Data Analyst</p>
                    <p>Platinum Credit Limited</p>
                </div>
            </div>
            
            <div class="footer">
                <p class="company-name">PLATINUM CREDIT LIMITED</p>
                <p>© {current_year} Platinum Credit. Haki zote zimehifadhiwa.</p>
            </div>
        </div>
    </body>
    </html>
    """
    return html_content

def send_email_with_attachment(to_emails, cc_emails, subject, file_path, html_content):
    """
    Send email with attachment
    """
    try:
        # Create message
        msg = MIMEMultipart()
        msg['From'] = EMAIL_SENDER
        msg['To'] = ', '.join(to_emails)
        msg['Cc'] = ', '.join(cc_emails)
        msg['Subject'] = subject
        
        # Attach HTML content
        msg.attach(MIMEText(html_content, 'html'))
        
        # Attach file
        filename = os.path.basename(file_path)
        with open(file_path, "rb") as attachment:
            part = MIMEBase("application", "octet-stream")
            part.set_payload(attachment.read())
        
        encoders.encode_base64(part)
        part.add_header(
            "Content-Disposition",
            f"attachment; filename= {filename}",
        )
        
        msg.attach(part)
        
        # Connect to SMTP server and send email
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(EMAIL_SENDER, EMAIL_PASSWORD)
            
            # Send to all recipients (to + cc)
            all_recipients = to_emails + cc_emails
            server.sendmail(EMAIL_SENDER, all_recipients, msg.as_string())
        
        print(f"✓ Email sent successfully to {len(to_emails)} recipients")
        print(f"  Subject: {subject}")
        print(f"  Attachment: {filename}")
        print(f"  To: {', '.join(to_emails)}")
        if cc_emails:
            print(f"  CC: {', '.join(cc_emails)}")
        print("-" * 60)
        
        return True
        
    except Exception as e:
        print(f"✗ Error sending email: {str(e)}")
        return False

def main():
    """
    Main function to send emails for all files
    """
    print("=" * 70)
    print("MTD EMAIL SENDING SYSTEM")
    print("=" * 70)
    
    # Load email credentials
    load_dotenv()
    EMAIL_SENDER = os.getenv("EMAIL_USERNAME")
    EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
    
    # Validate credentials
    if not EMAIL_SENDER or not EMAIL_PASSWORD:
        print("✗ Error: Email credentials not found in .env file")
        print("  Please ensure EMAIL_USERNAME and EMAIL_PASSWORD are set")
        return
    
    print(f"✓ Sender: {EMAIL_SENDER}")
    
    # Get all files with email lists
    files = get_all_files_with_emails()
    
    if not files:
        print("No files found to send. Please check the output directories.")
        return
    
    print(f"\n✓ Found {len(files)} files to send emails for")
    
    # Show summary of recipients
    print("\n📧 RECIPIENT SUMMARY:")
    print("-" * 50)
    
    total_to = 0
    total_cc = 0
    
    for i, file_info in enumerate(files, 1):
        to_count = len(file_info['email_info']['to'])
        cc_count = len(file_info['email_info']['cc'])
        total_to += to_count
        total_cc += cc_count
        
        print(f"{i:2d}. {file_info['filename']:45} → {to_count:2d} TO, {cc_count:2d} CC")
    
    print("-" * 50)
    print(f"TOTAL: {total_to} TO recipients, {total_cc} CC recipients")
    print("-" * 50)
    
    # Show sample recipients (first file as example)
    if files:
        print("\n📋 SAMPLE RECIPIENTS (first file):")
        print(f"File: {files[0]['filename']}")
        print(f"Subject: {files[0]['email_info']['subject']}")
        print("To (first 5):")
        for email in files[0]['email_info']['to'][:5]:
            print(f"  • {email}")
        if len(files[0]['email_info']['to']) > 5:
            print(f"  ... and {len(files[0]['email_info']['to']) - 5} more")
        
        if files[0]['email_info']['cc']:
            print("CC (first 3):")
            for email in files[0]['email_info']['cc'][:3]:
                print(f"  • {email}")
            if len(files[0]['email_info']['cc']) > 3:
                print(f"  ... and {len(files[0]['email_info']['cc']) - 3} more")
    
    # Confirmation: --send yes|no from the web orchestrator, else prompt.
    import argparse as _ap
    _p = _ap.ArgumentParser(add_help=False)
    _p.add_argument("--send", choices=["yes", "no"], default=None)
    _known, _ = _p.parse_known_args()
    if _known.send is not None:
        confirm = _known.send
    else:
        try:
            confirm = input("\n⚠️  Do you want to proceed with sending ALL emails? (yes/no): ").strip().lower()
        except EOFError:
            confirm = "no"

    if confirm != 'yes':
        print("Email sending cancelled.")
        return
    
    print("\n" + "=" * 70)
    print("SENDING EMAILS...")
    print("=" * 70)
    
    # Test email connection first
    print("\n🔐 Testing email connection...")
    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls()
            server.login(EMAIL_SENDER, EMAIL_PASSWORD)
        print("✓ Email connection successful!")
    except Exception as e:
        print(f"✗ Email connection failed: {str(e)}")
        print("\nCommon solutions:")
        print("1. Use App Password instead of regular password")
        print("2. Enable 2-factor authentication")
        print("3. Check .env file credentials")
        return
    
    successful_sends = 0
    failed_sends = 0
    
    for i, file_info in enumerate(files, 1):
        print(f"\n[{i}/{len(files)}] 📤 Sending: {file_info['filename']}")
        print(f"   To: {len(file_info['email_info']['to'])} recipients")
        print(f"   CC: {len(file_info['email_info']['cc'])} recipients")
        
        # Use date extracted from filename (row file date) when available
        date_info = file_info['email_info'].get('date_from_file', {})
        day = date_info.get('day')
        month_eng = date_info.get('month_eng')
        year = date_info.get('year')
        if day:
            current_day = int(day)
        else:
            day_match = re.search(r'(\d+)', file_info['filename'])
            current_day = int(day_match.group(1)) if day_match else 7
        current_month = month_eng if month_eng else None
        current_year = year if year else None
        
        # Create HTML email content
        html_content = create_beautiful_email_html(
            subject=file_info['email_info']['subject'],
            current_day=current_day,
            current_month=current_month,
            current_year=current_year
        )
        
        # Send email
        success = send_email_with_attachment(
            to_emails=file_info['email_info']['to'],
            cc_emails=file_info['email_info']['cc'],
            subject=file_info['email_info']['subject'],
            file_path=file_info['file_path'],
            html_content=html_content
        )
        
        if success:
            successful_sends += 1
        else:
            failed_sends += 1
        
        # Add delay to avoid rate limits
        import time
        if i < len(files):
            time.sleep(2)  # 2-second delay between emails
    
    print("\n" + "=" * 70)
    print("SENDING COMPLETE")
    print("=" * 70)
    print(f"✓ Successfully sent: {successful_sends} emails")
    print(f"✗ Failed to send: {failed_sends} emails")
    
    if failed_sends == 0:
        print("\n🎉 All emails sent successfully!")
    else:
        print(f"\n⚠️  {failed_sends} email(s) failed to send. Please check the errors above.")
if __name__ == "__main__":
    main()