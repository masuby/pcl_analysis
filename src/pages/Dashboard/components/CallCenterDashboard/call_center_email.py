import smtplib
import os
import pandas as pd
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from email.mime.base import MIMEBase
from email import encoders
from dotenv import load_dotenv

global report_date
def send_product_email(product_name, product_dir,  report_date, sender_email, sender_password):
    """Send product-specific email with inline images and attachments"""
    
    # Define receiver emails based on product
    if product_name == 'LBF':
        receiver_emails = [
                'raphael@platinumcredit.co.tz',
                'allan@platinumcredit.co.tz',
                'dorice@platinumcredit.co.tz',
                'fragrance@platinumcredit.co.tz',
                'sigfrid@platinumcredit.co.tz',
                'murigi@platinumcredit.co.ke',
                'wayne@platinumcredit.co.ke',
                'yusuph@platinumcredit.co.tz',
                'thomas@platinumcredit.co.tz',
                'wilhelm@platinumcredit.co.tz',
                'augustine@platinumcredit.co.tz',
                'irene.mmari@platinumcredit.co.tz',
                'daniel@platinumcredit.co.tz',
                'aziza.mfanga.platinum@gmail.com',
                'madina.mohamed.platinum@gmail.com',
                'barnabas.ngassa.platinum@gmail.com',
                'zaituni@platinumcredit.co.tz'
        ]
    elif product_name == 'CS':
        receiver_emails = [
                'raphael@platinumcredit.co.tz',
                'dorice@platinumcredit.co.tz',
                'sigfrid@platinumcredit.co.tz',
                'murigi@platinumcredit.co.ke',
                'wayne@platinumcredit.co.ke',
                'yusuph@platinumcredit.co.tz',
                'allan@platinumcredit.co.tz',
                'fragrance@platinumcredit.co.tz',
                'vivian@platinumcredit.co.tz',
                'thomas@platinumcredit.co.tz',
                'wilhelm@platinumcredit.co.tz',
                'mohamedi.omar.platinum@gmail.com',
                'kelvin.mwasala@platinumcredit.co.tz',
                'daniel@platinumcredit.co.tz',
                'ikrah@platinumcredit.co.tz'
        ]
    else:  # ERR or other products
        receiver_emails = [
                'daniel@platinumcredit.co.tz',
        ]
    
    # Get all files from product directory
    try:
        all_files = os.listdir(product_dir)
    except FileNotFoundError:
        print(f"⚠️ Directory not found: {product_dir}")
        return
    
    # Filter files by type
    text_files = [f for f in all_files if f.endswith('.txt') and product_name in f]
    image_files = [f for f in all_files if f.endswith('.png') and product_name in f]
    excel_files = [f for f in all_files if f.endswith('.xlsx') and product_name in f]
    
    if not text_files:
        print(f"⚠️ No text report found for {product_name}")
        return
    
    # Read the text report content
    text_file_path = os.path.join(product_dir, text_files[0])
    try:
        with open(text_file_path, 'r', encoding='utf-8') as f:
            email_content = f.read()
    except Exception as e:
        print(f"❌ Error reading text file for {product_name}: {e}")
        return
    
    # Create image mapping
    image_mapping = {}
    for image_file in image_files:
        image_path = os.path.join(product_dir, image_file)
        if 'communication_type' in image_file:
            image_mapping['communication_type'] = image_path
        elif 'success_distribution' in image_file:
            image_mapping['success_distribution'] = image_path
        elif 'call_notes_distribution' in image_file:
            image_mapping['call_notes_distribution'] = image_path
        elif 'top_agents' in image_file:
            image_mapping['top_agents'] = image_path
        elif 'status_distribution' in image_file:
            image_mapping['status_distribution'] = image_path
    
    # Create HTML email with inline images
    html_content = create_html_email_with_images(email_content, image_mapping, product_name, report_date)
    
    # Prepare all attachments (Excel files only - images are inline)
    excel_attachments = {}
    for excel_file in excel_files:
        excel_path = os.path.join(product_dir, excel_file)
        if os.path.exists(excel_path):
            excel_attachments[excel_file] = excel_path
    
    # Send email - ALL RECEIVERS IN ONE EMAIL
    subject = f"CALL CENTER {product_name} REPORT FOR {report_date}"
    
    try:
        server = smtplib.SMTP('smtp.gmail.com', 587)
        server.starttls()
        server.login(sender_email, sender_password)
        
        # Create ONE message for ALL receivers
        msg = MIMEMultipart('related')
        msg['From'] = sender_email
        # Join all receiver emails with comma
        msg['To'] = ', '.join(receiver_emails)
        msg['Subject'] = subject
        
        # Create alternative part for HTML
        msg_alternative = MIMEMultipart('alternative')
        msg.attach(msg_alternative)
        
        # Attach HTML content
        msg_alternative.attach(MIMEText(html_content, 'html'))
        
        # Attach images inline
        for image_type, image_path in image_mapping.items():
            if image_path and os.path.exists(image_path):
                try:
                    with open(image_path, 'rb') as img_file:
                        img_data = img_file.read()
                    
                    image_cid = f"{image_type}_{product_name}@callcenter"
                    img = MIMEImage(img_data, name=os.path.basename(image_path))
                    img.add_header('Content-ID', f'<{image_cid}>')
                    img.add_header('Content-Disposition', 'inline', filename=os.path.basename(image_path))
                    msg.attach(img)
                except Exception as e:
                    print(f"Error attaching image {image_path}: {e}")
                    continue
        
        # Attach Excel files
        for attachment_name, attachment_path in excel_attachments.items():
            try:
                with open(attachment_path, "rb") as attachment:
                    part = MIMEBase('application', 'octet-stream')
                    part.set_payload(attachment.read())
                    encoders.encode_base64(part)
                    part.add_header(
                        'Content-Disposition',
                        f'attachment; filename="{attachment_name}"'
                    )
                    msg.attach(part)
            except Exception as e:
                print(f"Error attaching Excel file {attachment_path}: {e}")
                continue
        
        # Send ONE email to ALL receivers
        text = msg.as_string()
        server.sendmail(sender_email, receiver_emails, text)  # Send to all at once
        print(f"✅ {product_name} email sent successfully to: {', '.join(receiver_emails)}")
        
        server.quit()
        print(f"✅ {product_name} email sent to all recipients!")
        
    except Exception as e:
        print(f"❌ Error sending {product_name} email: {e}")

def create_html_email_with_images(text_content, image_mapping, product_name, report_date):
    """Create beautiful HTML email with images inserted at the right locations"""
    
    # Convert text content to HTML paragraphs
    html_paragraphs = []
    lines = text_content.split('\n')
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        # Check if this line should have an image after it
        if "were inbound calls" in line and "were outbound calls" in line and "were internal calls" in line:
            html_paragraphs.append(f'<p style="margin: 10px 0; line-height: 1.6;">{line}</p>')
            if image_mapping.get('communication_type'):
                image_cid = f"communication_type_{product_name}@callcenter"
                html_paragraphs.append(f'''
                <div style="text-align: center; margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                    <h3 style="color: #2c3e50; margin-bottom: 15px;">📞 Communication Type Distribution</h3>
                    <img src="cid:{image_cid}" style="max-width: 90%; height: auto; border: 2px solid #3498db; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                </div>
                ''')
                
        elif "were successful and" in line and "were unsuccessful" in line:
            html_paragraphs.append(f'<p style="margin: 10px 0; line-height: 1.6;">{line}</p>')
            if image_mapping.get('success_distribution'):
                image_cid = f"success_distribution_{product_name}@callcenter"
                html_paragraphs.append(f'''
                <div style="text-align: center; margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                    <h3 style="color: #2c3e50; margin-bottom: 15px;">✅ Success Distribution</h3>
                    <img src="cid:{image_cid}" style="max-width: 90%; height: auto; border: 2px solid #27ae60; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                </div>
                ''')
                
        elif "distribution of the calls disposition is visualized in the chart" in line:
            html_paragraphs.append(f'<p style="margin: 10px 0; line-height: 1.6;">{line}</p>')
            if image_mapping.get('call_notes_distribution'):
                image_cid = f"call_notes_distribution_{product_name}@callcenter"
                html_paragraphs.append(f'''
                <div style="text-align: center; margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                    <h3 style="color: #2c3e50; margin-bottom: 15px;">📝 Call Notes Distribution</h3>
                    <img src="cid:{image_cid}" style="max-width: 90%; height: auto; border: 2px solid #e74c3c; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                </div>
                ''')
                
        elif "had 50 or more successful calls for the day" in line:
            html_paragraphs.append(f'<p style="margin: 10px 0; line-height: 1.6;">{line}</p>')
            if image_mapping.get('top_agents'):
                image_cid = f"top_agents_{product_name}@callcenter"
                html_paragraphs.append(f'''
                <div style="text-align: center; margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                    <h3 style="color: #2c3e50; margin-bottom: 15px;">👥 Top Agents Performance</h3>
                    <img src="cid:{image_cid}" style="max-width: 90%; height: auto; border: 2px solid #9b59b6; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                </div>
                ''')
                
        elif "were called back" in line:
            html_paragraphs.append(f'<p style="margin: 10px 0; line-height: 1.6;">{line}</p>')
            if image_mapping.get('status_distribution'):
                image_cid = f"status_distribution_{product_name}@callcenter"
                html_paragraphs.append(f'''
                <div style="text-align: center; margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                    <h3 style="color: #2c3e50; margin-bottom: 15px;">📊 Call Status Distribution</h3>
                    <img src="cid:{image_cid}" style="max-width: 90%; height: auto; border: 2px solid #f39c12; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                </div>
                ''')
                
        else:
            # Regular paragraph
            if line.startswith("Hi,") or line.startswith("CALLS SUMMARY REPORT") or line.startswith("AGENTS PERFORMANCE HIGHLIGHTS") or line.startswith("For Outbound calls:") or line.startswith("For Inbound Calls:"):
                html_paragraphs.append(f'<h3 style="color: #2c3e50; margin: 20px 0 10px 0; border-bottom: 2px solid #3498db; padding-bottom: 5px;">{line}</h3>')
            elif line.startswith("- "):
                html_paragraphs.append(f'<p style="margin: 8px 0; line-height: 1.6; padding-left: 15px;">• {line[2:]}</p>')
            else:
                html_paragraphs.append(f'<p style="margin: 10px 0; line-height: 1.6;">{line}</p>')
    
    # Combine all HTML content
    html_body = '\n'.join(html_paragraphs)
    
    # Create complete HTML email with same CSS colors and styling
    html_template = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 900px;
                margin: 0 auto;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                padding: 20px;
            }}
            .email-container {{
                background: white;
                border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                overflow: hidden;
            }}
            .header {{
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 30px;
                text-align: center;
            }}
            .header h1 {{
                margin: 0;
                font-size: 28px;
                font-weight: 600;
            }}
            .header .product {{
                font-size: 20px;
                opacity: 0.9;
                margin-top: 5px;
            }}
            .header .date {{
                font-size: 16px;
                opacity: 0.8;
                margin-top: 5px;
            }}
            .content {{
                padding: 30px;
            }}
            .section {{
                margin-bottom: 25px;
                padding: 20px;
                background: #f8f9fa;
                border-radius: 8px;
                border-left: 5px solid #3498db;
            }}
            .image-container {{
                text-align: center;
                margin: 25px 0;
                padding: 20px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }}
            .image-container h3 {{
                color: #2c3e50;
                margin-bottom: 15px;
                font-size: 18px;
            }}
            img {{
                max-width: 100%;
                height: auto;
                border-radius: 6px;
                transition: transform 0.3s ease;
            }}
            img:hover {{
                transform: scale(1.02);
            }}
            .footer {{
                background: #f8f9fa;
                color: #2c3e50;
                text-align: center;
                padding: 20px;
                margin-top: 30px;
                border-top: 1px solid #e0e0e0;
            }}
            .footer p {{
                margin: 5px 0;
                opacity: 0.8;
            }}
            .highlight {{
                background: linear-gradient(120deg, #a8edea 0%, #fed6e3 100%);
                padding: 15px;
                border-radius: 8px;
                margin: 15px 0;
                border-left: 4px solid #667eea;
            }}
            .callout {{
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
                text-align: center;
            }}
            .callout h3 {{
                margin-top: 0;
                color: white;
            }}
            .stat-box {{
                background: #f8f9fa;
                border-radius: 8px;
                padding: 15px;
                margin: 10px 0;
                border-left: 4px solid #3498db;
            }}
            .stat-box strong {{
                color: #2c3e50;
            }}
            @media only screen and (max-width: 600px) {{
                body {{
                    padding: 10px;
                }}
                .content {{
                    padding: 15px;
                }}
                .header h1 {{
                    font-size: 24px;
                }}
            }}
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="header">
                <h1>📊 Call Center Daily Report</h1>
                <div class="product">{product_name} Team Performance</div>
                <div class="date">Report Date: {report_date}</div>
            </div>
            
            <div class="content">
                {html_body}
                
                <div class="highlight">
                    <p><strong>📎 Attachments:</strong> This email includes detailed Excel reports with complete call data and agent performance metrics.</p>
                </div>
                
                <div class="callout">
                    <h3>📈 Key Insights</h3>
                    <p>All data visualized in charts above • Download attachments for detailed analysis • Contact team for questions</p>
                </div>
            </div>
            
            <div class="footer">
                <p>Generated by Data Analytics System</p>
                <p>For questions or feedback, please reply to this email</p>
            </div>
        </div>
    </body>
    </html>
    """
    
    return html_template

def send_all_product_emails(export_root, report_date, sender_email, sender_password):
    """Send emails for all products"""
    
    # Define product directories
    product_dirs = {
        'LBF': os.path.join(export_root, 'LBF', report_date),
        'CS': os.path.join(export_root, 'CS', report_date),
        'ERR': os.path.join(export_root, 'ERR', report_date)
    }
    
    print("📧 Starting email automation...")
    
    # Send emails for each product
    for product_name, product_dir in product_dirs.items():
        if os.path.exists(product_dir):
            print(f"📧 Preparing {product_name} email...")
            send_product_email(product_name, product_dir, report_date, sender_email, sender_password)
        else:
            print(f"⚠️ No directory found for {product_name}: {product_dir}")

def main_email_automation():
    """Main function to run email automation"""
    
    # Configuration
    export_root = r"C:\Users\Daniel\Desktop\code\pcl\CALL_CENTER\NEW_FILES"
    report_date = datetime.now().strftime("%Y-%m-%d")  # Fixed format string
    # Load environment variables from .env file

    load_dotenv()
    
    # Get email credentials from .env file
    sender_email = os.getenv('EMAIL_USERNAME')
    sender_password = os.getenv('EMAIL_PASSWORD')
    
    print("🚀 Starting Call Center Email Automation")
    print(f"📅 Report Date: {report_date}")
    print(f"📁 Export Root: {export_root}")
    
    # Send all product emails
    send_all_product_emails(export_root, report_date, sender_email, sender_password)
    
    print("✅ Email automation completed!")

# Integration with your call center report
def integrate_email_automation(export_root, report_date):
    """Function to integrate email automation with your existing report"""
    
    # Load environment variables from .env file
    load_dotenv()
    
    # Get email credentials from .env file
    sender_email = os.getenv('EMAIL_USERNAME')
    sender_password = os.getenv('EMAIL_PASSWORD')
    
    print("\n" + "="*50)
    print("STARTING EMAIL AUTOMATION")
    print("="*50)
    
    send_all_product_emails(export_root, report_date, sender_email, sender_password)

# Run if executed directly
if __name__ == "__main__":
    main_email_automation()