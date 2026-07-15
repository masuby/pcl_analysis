import os
import json
import pandas as pd
import re

# Base directories (dynamic — orchestrator sets PCL_MTD_DIR / PCL_AUTOMATION_ROOT;
# fallback = this file's grandparent, i.e. .../Automation/MTD).
from pathlib import Path as _Path
base_dir = os.environ.get("PCL_MTD_DIR") or (
    os.path.join(os.environ["PCL_AUTOMATION_ROOT"], "MTD")
    if os.environ.get("PCL_AUTOMATION_ROOT") else str(_Path(__file__).resolve().parents[1]))
cs_output_dir = os.path.join(base_dir, "CS_MTD", "split_supervisions_cs_mtd")
lbf_output_dir = os.path.join(base_dir, "LBF_MTD", "split_supervisions_lbf")

# Test emails for development (will be added to all emails)
TEST_EMAILS = ["www.danielclement468@gmail.com", "raphael@platinumcredit.co.tz", "fragrance@platinumcredit.co.tz"]

# Email mapping for CS files
CS_EMAIL_MAPPING = {
    # Format: filename_pattern: {"to": [emails], "cc": [emails]}
    "LAKE-VICTORIA": {
        "to": [
            "felix.njeve.platinum@gmail.com",
            "godfrey.simon.platinum@gmail.com",
            "amidiana.edward.platinum@gmail.com",
            "biah.pamba@platinumcredit.co.tz",
            "godfrey.shumbu.platinum@gmail.com",
            "amiryrubibi@gmail.com",
            "thabiti.daud.platinum@gmail.com",
            "kluverth.masanula.platinum@gmail.com",
            "valence.vicent.platinum@gmail.com", 
            "frebronia.loth.platinum@gmail.com",
            "mary.joseph.platinum@gmail.com",
            "fred.mchopa.platinum@gmail.com",
            "hosea.kaaya.platinum@gmail.com",
            "magarani.patrick.platinum@gmail.com",

        ],
        "cc": [
            "vivian.karatta.platinum@gmail.com",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    },
    "HIGHLAND": {
        "to": [
            "james.watilya@platinumcredit.co.tz",
            "juma.manyenye.platinum@gmail.com",
            "agustinoshabani99@gmail.com",
            "felix.njeve.platinum@gmail.com",
            "munde.samson.platinum@gmail.com",
            "michael.masele.platinum@gmail.com",
            "msanjalaemmanuel2@gmail.com",
            "felister.francis.platinum@gmail.com "
            "aziza.hassan.platinum@gmail.com",


        ],
        "cc": [
            "vivian.karatta.platinum@gmail.com",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    },
    "NORTHERN": {
        "to": [
            "zainabu.magambo@platinumcredit.co.tz",
            "david.riwa.platinum@gmail.com",
            "gerson@platinumcredit.co.tz",
            "omary.mapembe.platinum@gmail.com",
            "peter.machina.platinum@gmail.com",
            "washa.nestory.platinum@gmail.com",
            "claud.john.platinum@gmail.com",
            "hosea.hoseni.platinum@gmail.com",
            "washa.nestory.platinum@gmail.com",
            "claud.john.platinum@gmail.com",
            "raphael.mbanga.platinum@gmail.com",
            "erick.ngawe.platinum@gmail.com",
            "william.samwel.platinum@gmail.com",


        ],
        "cc": [
            "vivian.karatta.platinum@gmail.com",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz"
        ]
    },
    "CENTRAL": {
        "to": [
            "hamida.mghenyi@platinumcredit.co.tz",
            "clement.hibi.platinum@gmail.com",
            "gerson@platinumcredit.co.tz",
            "hadija.majid.platinum@gmail.com",
            "jackline.mgaya.platinum@gmail.com",

        ],
        "cc": [
            "vivian.karatta.platinum@gmail.com",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz"
        ]
    },
    "NYASA": {
        "to": [
            "allex.kayoyo@platinumcredit.co.tz",
            "salum.kimbanga.platinum@gmail.com",
            "boniveture.ndimbo.platinum@gmail.com",
            "cosmasmbiro76@gmail.com",
            "jamardiniomari@gmail.com",
            "dickson.nyoni@platinumcredit.co.tz",
            "abdallahmbwana.platinum@gmail.com",
            "damson@platinumcredit.co.tz",
            "siraji.nalumanga.platinum@gmail.com",
            "sharifu.nambinga.platinum@gmail.com",
            "patrick.mwalongo.platinum@gmail.com",
            "mwakyomaatufigwege@gmail.com",


        ],
        "cc": [
            "vivian.karatta.platinum@gmail.com",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz"
        ]
    },
    "PWANI": {
        "to": [
            "anita.lwasha.platinum@gmail.com",
            "upendo.shayo.platinum@gmail.com",
            "gerson@platinumcredit.co.tz",
            "lusekelo.ayubu.platinum@gmail.com",
            "david.alfred.platinum@gmail.com",
            "sharifu.chimela.platinum@gmail.com",
            "rose.arcado.platinum@gmail.com",
            "rose.arcado.platinum@gmail.com",


        ],
        "cc": [
            "vivian.karatta.platinum@gmail.com",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    },
    "WESTERN": {
        "to": [
            "agostopher.mangati.platinum@gmail.com",
            "zamaradi.suleiman.platinum@gmail.com",
            "mbota.venance@platinumcredit.co.tz",
            "emmanuel.miyaga.platinum@gmail.com",
            "ikombe.kijah.platinum@gmail.com",
            "felix.njeve.platinum@gmail.com",
            "anna.yoramu.platinum@gmail.com",
            "godfrey.gweba.platinum@gmail.com",
            "matha.philimon.platinum@gmail.com",
            "jenipha.makumba.platinum@gmail.com",
        ],
        "cc": [
            "vivian.karatta.platinum@gmail.com",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz"
            "fragrance@platinumcredit.co.tz",
        ]
    },
    "SOUTHERN-HIGHLAND": {
        "to": [
            "bastan.fwankiye.platinum@gmail.com",
            "evarist.amos.platinum@gmail.com",
            "mabula.paschal.platinum@gmail.com",
            "benjamin.mfumya.platinum@gmail.com",
            "damson@platinumcredit.co.tz",
            "neema.ngoso.platinum@gmail.com",
            "sharifu.mussa.platinum@gmail.com",
            "festus.mikas.platinum@gmail.com",
            "amos.samwel.platinum@gmail.com",

        ],
        "cc": [
            "vivian.karatta.platinum@gmail.com",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    },
    "ZANZIBAR": {
        "to": [
            "mohamed.mtoro.platinum@gmail.com",
            "ali.mohamed@platinumcredit.co.tz",
            "tatu.said.platinum@gmail.com",
            "nadhrat.ali.platinum@gmail.com",
            "abdul.juma.platinum@gmail.com",
            "shaban.juma.platinum@gmail.com",
            "lorencolman067@gmail.com",
            "kahanyabundu@gmail.com",
            "mohamedi.omar.platinum@gmail.com",

        ],
        "cc": [
            "vivian.karatta.platinum@gmail.com",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    },
    "CALL-CENTER": {
        "to": TEST_EMAILS,
        "cc": [
            "kelvin.mwasala@platinumcredit.co.tz",
            "kelvin.peter.platinum@gmail.com",
        ]
    }
}

# Email mapping for LBF files
LBF_EMAIL_MAPPING = {
    "MIKOCHENI": {
        "to": [
            "fadhili.omary@platinumcredit.co.tz",
            "david.patrick.platinum@gmail.com",
            "digna.swai.platinum@gmail.com",
            "ester.nemes.platinum@gmail.com",
            "raphael.temu.platinum@gmail.com"
        ],
        "cc": [
            "irene.mmari@platinumcredit.co.tz",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    },
    "NORTH-EAST": {
        "to": [
            "hadija.haji.platinum@gmail.com",
            "mrisho.katimle@platinumcredit.co.tz",
            "zulfa.jumanne@platinumcredit.co.tz",
            "chrizostom.thadeo@platinumcredit.co.tz"
        ],
        "cc": [
            "irene.mmari@platinumcredit.co.tz",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",

        ]
    },
    "CITY-CENTRE": {
        "to": [
            "michael.manamba@platinumcredit.co.tz",
            "ruhindaedgar@gmail.com",
            "abdallah.iddy.platinum@gmail.com",
            "vianery.komba.platinum@gmail.com",
        ],
        "cc": [
            "irene.kisamo.platinum@gmail.com",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "francis.kyando.platinum@gmail.com",
            "fragrance@platinumcredit.co.tz",
        ]
    },
    "KIGAMBONI": {
        "to": [
            "veronica.mbasha.platinum@gmail.com",
            "david.kileo.platinum@gmail.com",
            "salim.ruwa@platinumcredit.co.tz"
        ],
        "cc": [
            "irene.mmari@platinumcredit.co.tz",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    
    },
        "TEGETA": {
        "to": [
                "elvis.stephen.platinum@gmail.com"
        ],
        "cc": [
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    
    },
        "TABATA": {
        "to": [
            "allen.allan.platinum@gmail.com"
        ],
        "cc": [
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    
    },
    "CENTRAL": {
        "to": [
            "adam.tengeneza.platinum@gmail.com",
            "adam.tengeneza@platinumcredit.co.tz",
            "john.mdisa.platinum@gmail.com",
            "zulfa.jumanne@platinumcredit.co.tz"
        ],
        "cc": [
            "irene.mmari@platinumcredit.co.tz",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    },
    "CITY-MALL": {
        "to": [
            "ashur.lusogo.platinum@gmail.com",
            "joseph.mambo.platinum@gmail.com",
            "sarah.galiatano.platinum@gmail.com",
            "nansi.luoga.platinum@gmail.com",
            "thobias.uchungu.platinum@gmail.com"
        ],
        "cc": [
            "irene.mmari@platinumcredit.co.tz",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    },
    "MLIMANI": {
        "to": [
            "jamadin.mwahele.platinum@gmail.com",
            "john.kasanzu.platinum@gmail.com",
            "sarah.moshi@platinumcredit.co.tz",
            "dundas@platinumcredit.co.tz",
        ],
        "cc": [
            "irene.mmari@platinumcredit.co.tz",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    },
    "NYANZA": {
        "to": [
            "maganga.ally.platinum@gmail.com",
            "dickens.mathew.platinum@gmail.com",
            "ramadhani.luzila.platinum@gmail.com",
            "peter.amos.platinum@gmail.com",
            "mtatilo.joseph.platinum@gmail.com",
            "mashaka.simon.platinum@gmail.com",
            "billgate.mwacha.platinum@gmail.com",
        ],
        "cc": [
            "irene.mmari@platinumcredit.co.tz",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz"
        ]
    },
    "TANZARA": {
        "to": [
            "kenwood.madege.platinum@gmail.com",
            "kenwood.madege@platinumcredit.co.tz",
            "salehe.mgonja.platinum@gmail.com",
            "salehe.mgonja@platinumcredit.co.tz",
            "eutropia.pasian.platinum@gmail.com"
        ],
        "cc": [
            "irene.mmari@platinumcredit.co.tz",
            "daniel@platinumcredit.co.tz",
            "raphael@platinumcredit.co.tz",
            "fragrance@platinumcredit.co.tz",
        ]
    },
    "CALL-CENTER": {
        "to": TEST_EMAILS,
        "cc": []
    }
}

def get_email_list_for_file(filename):
    """
    Get email recipients for a given file
    """
    to_emails = []
    cc_emails = []
    
    # Check if it's a CS or LBF file
    if "CS_" in filename.upper():
        mapping = CS_EMAIL_MAPPING
        # Extract region name more carefully
        # Remove CS_ and everything after the first underscore after region name
        clean_name = filename.upper().replace("CS_", "")
        # Remove the date part (everything after the last underscore before -MTD)
        region_part = clean_name.split("_")[0]  # Gets "SOUTHERN-HIGHLAND-REGION"
    elif "LBF_" in filename.upper():
        mapping = LBF_EMAIL_MAPPING
        clean_name = filename.upper().replace("LBF_", "")
        region_part = clean_name.split("_")[0]
        
        # Fix: Remove "LBF-" prefix if present (e.g., "LBF-CENTRAL" -> "CENTRAL")
        if region_part.startswith("LBF-"):
            region_part = region_part.replace("LBF-", "", 1)
    else:
        # Unknown file type, send to test emails only
        return {
            "to": TEST_EMAILS,
            "cc": [],
            "subject": get_email_subject(filename)
        }
    
    # Clean up the region name
    # Remove common suffixes (including -BRANCH)
    region_name = region_part
    for suffix in ["-REGION", "-AREA", "-ZONE", "-DISTRICT", "-BRANCH"]:
        region_name = region_name.replace(suffix, "")
    
    # Strip any leading/trailing dashes or spaces
    region_name = region_name.strip().strip("-")
    
    # Now try to find exact or closest match
    matched_key = None
    
    # Normalize for comparison (remove dashes, convert to uppercase)
    region_normalized = region_name.replace("-", "").upper().strip()
    
    # Handle special spelling variations first (before other matching)
    # Handle TAZARA vs TANZARA
    if "TAZARA" in region_normalized and "TANZARA" in [k.upper() for k in mapping.keys()]:
        matched_key = "TANZARA"
    
    # First try exact match (case-insensitive, ignoring dashes)
    if not matched_key:
        for key in mapping.keys():
            key_normalized = key.replace("-", "").upper().strip()
            if key_normalized == region_normalized:
                matched_key = key
                break
    
    # If no exact match, try partial match but be careful
    if not matched_key:
        # Sort keys by length (longest first) to match "SOUTHERN-HIGHLAND" before "HIGHLAND"
        sorted_keys = sorted(mapping.keys(), key=len, reverse=True)
        
        for key in sorted_keys:
            key_normalized = key.replace("-", "").upper().strip()
            
            # Check if the key matches at the start of the region name
            # This handles cases like "KIGAMBONI-BRANCH" matching "KIGAMBONI"
            if region_normalized.startswith(key_normalized):
                matched_key = key
                break
            
            # Also check if key is contained in region (for partial matches)
            # Only if key is substantial length to avoid false matches
            if key_normalized in region_normalized and len(key_normalized) >= 5:
                matched_key = key
                break
    
    if matched_key:
        # Add actual recipients
        to_emails.extend(mapping[matched_key]["to"])
        cc_emails.extend(mapping[matched_key]["cc"])
        print(f"✓ Email mapping found for: {filename}")
        print(f"   Region extracted: {region_name} -> Matched key: {matched_key}")
    else:
        # If no match found, send to test emails
        to_emails.extend(TEST_EMAILS)
        print(f"⚠️  No email mapping found for: {filename}")
        print(f"   Region extracted: {region_name}")
        print(f"   Available keys in mapping: {list(mapping.keys())}")
    
    # Remove duplicates
    to_emails = list(set(to_emails))
    cc_emails = list(set(cc_emails))
    
    # Extract date from filename for email body (CS: from row file; LBF: already in filename)
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
    Used for email body date (CS and LBF files from row files).
    """
    name = filename.replace(".xlsx", "").replace(".XLSX", "")
    date_patterns = [
        r'(\d+)(?:st|nd|rd|th)-([A-Z]+)-(\d{4})',   # 7TH-FEBRUARY-2026
        r'(\d+)-([A-Z]+)-(\d{4})',                   # 7-FEBRUARY-2026
        r'(\d+)_([A-Z]+)_(\d{4})',                   # Alternative
    ]
    for pattern in date_patterns:
        match = re.search(pattern, name, re.IGNORECASE)
        if match:
            return (match.group(1), match.group(2).upper(), match.group(3))
    return (None, None, None)

def get_email_subject(filename):
    """
    Generate email subject from filename with better pattern matching
    """
    # Remove extension
    name = filename.replace(".xlsx", "").replace(".XLSX", "")
    
    # Common patterns in your filenames:
    # Pattern 1: CS_REGION_DDth-MONTH-YYYY-MTD
    # Pattern 2: LBF_REGION_DDth-MONTH-YYYY-MTD
    
    # Extract product type (first part before underscore)
    product_match = re.match(r'^([A-Z]+)_', name)
    product = product_match.group(1) if product_match else "MTD"
    
    # Extract region (second part before underscore)
    # Handle both CS_REGION and CS_REGION-REGION patterns
    region_match = re.match(r'^[A-Z]+_([A-Z\-]+)_', name)
    if region_match:
        region = region_match.group(1).replace("-", " ")
    else:
        # Try to extract region differently
        parts = name.split("_")
        if len(parts) >= 2:
            region = parts[1].replace("-", " ")
        else:
            region = "REGION"
    
    # Extract date components using regex
    date_patterns = [
        r'(\d+)(?:st|nd|rd|th)-([A-Z]+)-(\d{4})',  # 13th-DECEMBER-2025
        r'(\d+)_([A-Z]+)_(\d{4})',  # Alternative pattern
        r'(\d+)-([A-Z]+)-(\d{4})',  # 13-DECEMBER-2025
    ]
    
    day = "07"
    month_eng = "FEBRUARY"
    year = "2026"
    
    for pattern in date_patterns:
        date_match = re.search(pattern, name, re.IGNORECASE)
        if date_match:
            day = date_match.group(1)
            month_eng = date_match.group(2).upper()
            year = date_match.group(3)
            break
    
    # Convert month to Swahili
    month_sw = convert_month_to_swahili(month_eng)
    
    # Format subject
    subject = f"{product} {region} {day} {month_sw} {year}"
    return subject.upper()

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
        print(f"   Total recipients: {len(file_info['email_info']['to'])} to, {len(file_info['email_info']['cc'])} cc")
        print(f"   To (first 3): {', '.join(file_info['email_info']['to'][:3])}{'...' if len(file_info['email_info']['to']) > 3 else ''}")
        print(f"   CC (first 3): {', '.join(file_info['email_info']['cc'][:3])}{'...' if len(file_info['email_info']['cc']) > 3 else ''}")