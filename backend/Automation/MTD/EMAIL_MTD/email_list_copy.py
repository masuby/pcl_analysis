import os
import json
import pandas as pd
import re

# Base directories
base_dir = r"C:\Users\Daniel\Desktop\code\pcl\MTD"
cs_output_dir = os.path.join(base_dir, "CS_MTD", "split_supervisions_cs_mtd")
lbf_output_dir = os.path.join(base_dir, "LBF_MTD", "split_supervisions_lbf")

# Test emails for development
TEST_EMAILS = ["www.danielclement468@gmail.com"]

# Email mapping for CS files
CS_EMAIL_MAPPING = {
    # Format: filename_pattern: {"to": [emails], "cc": [emails]}
    "LAKE-VICTORIA": {
        "to": [
            # "felix.njeve.platinum@gmail.com",
            # "godfrey.simon.platinum@gmail.com",
            # "amidiana.edward.platinum@gmail.com",
            # "biah.pamba@platinumcredit.co.tz",
            # "godfrey.shumbu.platinum@gmail.com",
            # "amiryrubibi@gmail.com",
            # "victor.joseph.platinum@gmail.com",
            # "omary.mapembe.platinum@gmail.com",
            # "kluverth.masanula.platinum@gmail.com"
        ],
        "cc": [
            # "mohamedi.omar.platinum@gmail.com",
            # "vivian.karatta.platinum@gmail.com",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "HIGHLAND": {
        "to": [
            # "james.watilya@platinumcredit.co.tz",
            # "juma.manyenye.platinum@gmail.com",
            # "juma.nyerere.platinum@gmail.com",
            # "agustinoshabani99@gmail.com",
            # "felix.njeve.platinum@gmail.com",
            # "felix.njeve@platinumcredit.co.tz"
        ],
        "cc": [
            # "mohamedi.omar.platinum@gmail.com",
            # "vivian.karatta.platinum@gmail.com",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "NORTHERN": {
        "to": [
            # "karim.kisandu.platinum@gmail.com",
            # "clara.kweka.platinum@gmail.com",
            # "zainabu.magambo@platinumcredit.co.tz",
            # "david.riwa.platinum@gmail.com",
            # "gerson@platinumcredit.co.tz",
            # "abraham.mlogho.platinum@gmail.com"
        ],
        "cc": [
            # "mohamedi.omar.platinum@gmail.com",
            # "vivian.karatta.platinum@gmail.com",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "CENTRAL": {
        "to": [
            # "hamida.mghenyi@platinumcredit.co.tz",
            # "clement.hibi.platinum@gmail.com",
            # "deograsias.mwenda.platinum@gmail.com",
            # "dorcas.dozil.platinum@gmail.com",
            # "magarani.patrick.platinum@gmail.com",
            # "isack.msilu@platinumcredit.co.tz",
            # "gerson@platinumcredit.co.tz"
        ],
        "cc": [
            # "mohamedi.omar.platinum@gmail.com",
            # "vivian.karatta.platinum@gmail.com",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "NYASA": {
        "to": [
            # "allex.kayoyo@platinumcredit.co.tz",
            # "salum.kimbanga.platinum@gmail.com",
            # "boniveture.ndimbo.platinum@gmail.com",
            # "cosmasmbiro76@gmail.com",
            # "jamardiniomari@gmail.com",
            # "dickson.nyoni@platinumcredit.co.tz",
            # "abdallahmbwana.platinum@gmail.com",
            # "damson@platinumcredit.co.tz"
        ],
        "cc": [
            # "mohamedi.omar.platinum@gmail.com",
            # "vivian.karatta.platinum@gmail.com",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "PWANI": {
        "to": [
            # "mussa.chahe.platinum@gmail.com",
            # "anita.lwasha.platinum@gmail.com",
            # "upendo.shayo.platinum@gmail.com",
            # "issa.mkemi.platinum@gmail.com",
            # "gerson@platinumcredit.co.tz"
        ],
        "cc": [
            # "mohamedi.omar.platinum@gmail.com",
            # "vivian.karatta.platinum@gmail.com",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "WESTERN": {
        "to": [
            # "agostopher.mangati.platinum@gmail.com",
            # "robert.amon.platinum@gmail.com",
            # "zamaradi.suleiman.platinum@gmail.com",
            # "mbota.venance@platinumcredit.co.tz",
            # "mundekagembe55@gmail.com",
            # "gabriel.murya.platinum@gmail.com",
            # "emmanuel.miyaga.platinum@gmail.com",
            # "ikombe.kijah.platinum@gmail.com",
            # "felix.njeve.platinum@gmail.com"
        ],
        "cc": [
            # "mohamedi.omar.platinum@gmail.com",
            # "vivian.karatta.platinum@gmail.com",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "SOUTHERN-HIGHLAND": {
        "to": [
            # "bastan.fwankiye.platinum@gmail.com",
            # "evarist.amos.platinum@gmail.com",
            # "dastan.jotham.platinum@gmail.com",
            # "mabula.paschal.platinum@gmail.com",
            # "benjamin.mfumya.platinum@gmail.com",
            # "moses.kairo.platinum@gmail.com",
            # "damson@platinumcredit.co.tz"
        ],
        "cc": [
            # "mohamedi.omar.platinum@gmail.com",
            # "vivian.karatta.platinum@gmail.com",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "ZANZIBAR": {
        "to": [
            # "boniphacemwata.platinum@gmail.com",
            # "mohamed.mtoro.platinum@gmail.com",
            # "ali.mohamed@platinumcredit.co.tz",
            # "tarthuusaid@gmail.com"
        ],
        "cc": [
            # "mohamedi.omar.platinum@gmail.com",
            # "vivian.karatta.platinum@gmail.com",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "CALL-CENTER": {
        "to": TEST_EMAILS,
        "cc": []
    }
}

# Email mapping for LBF files
LBF_EMAIL_MAPPING = {
    "MIKOCHENI": {
        "to": [
            # "fadhili.omary@platinumcredit.co.tz",
            # "david.patrick.platinum@gmail.com",
            # "digna.swai.platinum@gmail.com",
            # "ester.nemes.platinum@gmail.com",
            # "raphael.temu.platinum@gmail.com"
        ],
        "cc": [
            # "irene.mmari@platinumcredit.co.tz",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "NORTH-EAST": {
        "to": [
            # "hadija.haji.platinum@gmail.com",
            # "mrisho.katimle@platinumcredit.co.tz",
            # "zulfa.jumanne@platinumcredit.co.tz",
            # "chrizostom.thadeo@platinumcredit.co.tz"
        ],
        "cc": [
            # "irene.mmari@platinumcredit.co.tz",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "CITY-CENTRE": {
        "to": [
            # "michael.manamba@platinumcredit.co.tz",
            # "ruhindaedgar@gmail.com",
            # "cletusgideon077@gmail.com"
        ],
        "cc": [
            # "irene.mmari@platinumcredit.co.tz",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "KIGAMBONI": {
        "to": [
            # "veronica.mbasha.platinum@gmail.com",
            # "elvis.stephen.platinum@gmail.com",
            # "david.kileo.platinum@gmail.com",
            # "salim.ruwa@platinumcredit.co.tz"
        ],
        "cc": [
            # "irene.mmari@platinumcredit.co.tz",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "CENTRAL": {
        "to": [
            # "adam.tengeneza.platinum@gmail.com",
            # "adam.tengeneza@platinumcredit.co.tz",
            # "john.mdisa.platinum@gmail.com",
            # "zulfa.jumanne@platinumcredit.co.tz"
        ],
        "cc": [
            # "irene.mmari@platinumcredit.co.tz",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "CITY-MALL": {
        "to": [
            # "ashur.lusogo.platinum@gmail.com",
            # "joseph.mambo.platinum@gmail.com",
            # "sarah.galiatano.platinum@gmail.com",
            # "nansi.luoga.platinum@gmail.com",
            # "thobias.uchungu.platinum@gmail.com"
        ],
        "cc": [
            # "irene.mmari@platinumcredit.co.tz",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "MLIMANI": {
        "to": [
            # "jamadin.mwahele.platinum@gmail.com",
            # "john.kasanzu.platinum@gmail.com",
            # "sarah.moshi@platinumcredit.co.tz",
            # "abdallah.iddy@platinumcredit.co.tz",
            # "abdallah.iddy.platinum@gmail.com"
        ],
        "cc": [
            # "irene.mmari@platinumcredit.co.tz",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "NYANZA": {
        "to": [
            # "maganga.ally.platinum@gmail.com",
            # "dickens.mathew.platinum@gmail.com",
            # "ramadhani.luzila.platinum@gmail.com",
            # "peter.amos.platinum@gmail.com",
            # "mtatilo.joseph.platinum@gmail.com",
            # "mashaka.simon.platinum@gmail.com"
        ],
        "cc": [
            # "irene.mmari@platinumcredit.co.tz",
            # "daniel@platinumcredit.co.tz"
        ]
    },
    "TANZARA": {
        "to": [
            # "kenwood.madege.platinum@gmail.com",
            # "kenwood.madege@platinumcredit.co.tz",
            # "salehe.mgonja.platinum@gmail.com",
            # "salehe.mgonja@platinumcredit.co.tz",
            # "eutropia.pasian.platinum@gmail.com"
        ],
        "cc": [
            # "irene.mmari@platinumcredit.co.tz",
            # "daniel@platinumcredit.co.tz"
        ]
    }
}

def get_email_list_for_file(filename):
    """
    Get email recipients for a given file
    """
    # For development: always include test emails
    to_emails = []
    cc_emails = []
    
    # Add test emails for development
    to_emails.extend(TEST_EMAILS)
    
    # Check if it's a CS or LBF file
    if "CS_" in filename.upper():
        mapping = CS_EMAIL_MAPPING
        file_key = filename.upper().replace("CS_", "").split("_")[0]
    elif "LBF_" in filename.upper():
        mapping = LBF_EMAIL_MAPPING
        file_key = filename.upper().replace("LBF_", "").split("_")[0]
    else:
        # Unknown file type, just send to test emails
        day, month_eng, year = extract_date_from_filename(filename)
        return {
            "to": to_emails,
            "cc": cc_emails,
            "subject": get_email_subject(filename),
            "date_from_file": {"day": day, "month_eng": month_eng, "year": year}
        }
    
    # Find matching region/branch
    for key, emails in mapping.items():
        if key in file_key or key.replace("-", "") in file_key.replace("-", ""):
            # Add actual recipients (commented out for now)
            # to_emails.extend(emails["to"])
            # cc_emails.extend(emails["cc"])
            break
    
    # Remove duplicates
    to_emails = list(set(to_emails))
    cc_emails = list(set(cc_emails))
    
    # Extract date from filename for email body (from row file)
    day, month_eng, year = extract_date_from_filename(filename)
    
    return {
        "to": to_emails,
        "cc": cc_emails,
        "subject": get_email_subject(filename),
        "date_from_file": {"day": day, "month_eng": month_eng, "year": year}
    }

def extract_date_from_filename(filename):
    """
    Extract day, month, year from filename (e.g. CS_REGION_7TH-FEBRUARY-2026-MTD.xlsx).
    Returns (day, month_eng, year) or (None, None, None) if not found.
    """
    name = filename.replace(".xlsx", "").replace(".XLSX", "")
    date_patterns = [
        r'(\d+)(?:st|nd|rd|th)-([A-Z]+)-(\d{4})',
        r'(\d+)-([A-Z]+)-(\d{4})',
        r'(\d+)_([A-Z]+)_(\d{4})',
    ]
    for pattern in date_patterns:
        match = re.search(pattern, name, re.IGNORECASE)
        if match:
            return (match.group(1), match.group(2).upper(), match.group(3))
    return (None, None, None)

def get_email_subject(filename):
    """
    Generate email subject from filename
    Example: CS_ZANZIBAR_06th-DECEMBER-2025-MTD.xlsx -> CS ZANZIBAR 06 DISEMBA 2025
    """
    # Remove .xlsx extension
    name_without_ext = filename.replace(".xlsx", "")
    
    # Split by underscores
    parts = name_without_ext.split("_")
    
    if len(parts) >= 3:
        # Get product type (CS/LBF)
        product = parts[0]
        
        # Get region name
        region = parts[1].replace("-", " ")
        
        # Get date part and convert to Swahili format
        date_part = parts[2]
        
        # Extract day and month
        day_match = re.search(r'(\d+)', date_part)
        month_match = re.search(r'([A-Z]+)', date_part)
        
        if day_match and month_match:
            day = day_match.group(1)
            month_eng = month_match.group(1).title()
            
            # Convert month to Swahili
            month_sw = convert_month_to_swahili(month_eng)
            
            # Extract year (usually at the end)
            year_match = re.search(r'(\d{4})', date_part)
            year = year_match.group(1) if year_match else "2025"
            
            subject = f"{product} {region} {day} {month_sw} {year}"
            return subject.upper()
    
    # Fallback: return simplified filename
    return filename.replace(".xlsx", "").replace("_", " ").upper()

def convert_month_to_swahili(month_eng):
    """
    Convert English month to Swahili
    """
    month_map = {
        "JANUARY": "JANUARI",
        "FEBRUARY": "FEBRUARI",
        "MARCH": "MACHI",
        "APRIL": "APRILI",
        "MAY": "MEI",
        "JUNE": "JUNI",
        "JULY": "JULAI",
        "AUGUST": "AGOSTI",
        "SEPTEMBER": "SEPTEMBA",
        "OCTOBER": "OKTOBA",
        "NOVEMBER": "NOVEMBA",
        "DECEMBER": "DISEMBA"
    }
    
    return month_map.get(month_eng.upper(), month_eng.upper())

def get_all_files_with_emails():
    """
    Get all files from CS and LBF directories with their email lists
    """
    all_files = []
    
    # Get CS files
    if os.path.exists(cs_output_dir):
        for file in os.listdir(cs_output_dir):
            if file.endswith(".xlsx"):
                file_path = os.path.join(cs_output_dir, file)
                email_info = get_email_list_for_file(file)
                all_files.append({
                    "file_path": file_path,
                    "filename": file,
                    "type": "CS",
                    "email_info": email_info
                })
    
    # Get LBF files
    if os.path.exists(lbf_output_dir):
        for file in os.listdir(lbf_output_dir):
            if file.endswith(".xlsx"):
                file_path = os.path.join(lbf_output_dir, file)
                email_info = get_email_list_for_file(file)
                all_files.append({
                    "file_path": file_path,
                    "filename": file,
                    "type": "LBF",
                    "email_info": email_info
                })
    
    return all_files

if __name__ == "__main__":
    # Test the function
    files = get_all_files_with_emails()
    print(f"Found {len(files)} files to send:")
    
    for i, file_info in enumerate(files, 1):
        print(f"\n{i}. {file_info['filename']}")
        print(f"   Type: {file_info['type']}")
        print(f"   Subject: {file_info['email_info']['subject']}")
        print(f"   To: {', '.join(file_info['email_info']['to'])}")
        print(f"   CC: {', '.join(file_info['email_info']['cc'])}")