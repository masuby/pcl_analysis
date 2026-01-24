#!/usr/bin/env python3
"""
Script to inspect MTD Excel files and understand their structure
"""

import os
import sys
import pandas as pd
from pathlib import Path

def find_mtd_files(directory):
    """Find all MTD Excel files in the uploads directory"""
    uploads_dir = Path(directory) / "uploads"
    if not uploads_dir.exists():
        print(f"Uploads directory not found: {uploads_dir}")
        return []
    
    mtd_files = []
    for f in uploads_dir.rglob("*.xlsx"):
        if "MTD" in f.name.upper():
            mtd_files.append(f)
    
    return mtd_files

def inspect_excel(filepath):
    """Inspect an Excel file and print its structure"""
    print(f"\n{'='*80}")
    print(f"FILE: {filepath.name}")
    print(f"{'='*80}")
    
    # Read all sheets
    xl = pd.ExcelFile(filepath)
    print(f"\nSheets: {xl.sheet_names}")
    
    for sheet_name in xl.sheet_names:
        print(f"\n{'-'*60}")
        print(f"SHEET: {sheet_name}")
        print(f"{'-'*60}")
        
        # Read sheet with no header to see raw data
        df = pd.read_excel(xl, sheet_name=sheet_name, header=None)
        
        print(f"Shape: {df.shape} (rows x cols)")
        
        # Show first 10 rows to understand structure
        print(f"\nFirst 10 rows:")
        for i in range(min(10, len(df))):
            row = df.iloc[i].tolist()
            # Filter out NaN values for cleaner display
            row_clean = [str(v) if pd.notna(v) else '' for v in row[:15]]
            print(f"  Row {i}: {row_clean}")
        
        # If this looks like the listing sheet, show more detail
        if "LISTING" in sheet_name.upper() or sheet_name == xl.sheet_names[-1]:
            print(f"\n*** This appears to be a LISTING sheet ***")
            
            # Find header row
            header_row = None
            for i in range(min(5, len(df))):
                row_values = [str(v).upper() if pd.notna(v) else '' for v in df.iloc[i]]
                if any('SALES REP' in v or 'SUPERVISION' in v or 'TERM' in v for v in row_values):
                    header_row = i
                    break
            
            if header_row is not None:
                print(f"\nHeader row found at index: {header_row}")
                headers = df.iloc[header_row].tolist()
                print(f"Headers: {[str(h) if pd.notna(h) else '' for h in headers]}")
                
                # Show first few data rows
                print(f"\nFirst 5 data rows after header:")
                for i in range(header_row + 1, min(header_row + 6, len(df))):
                    row = df.iloc[i].tolist()
                    row_clean = {str(headers[j]) if pd.notna(headers[j]) else f'Col{j}': str(v) if pd.notna(v) else '' 
                                 for j, v in enumerate(row) if pd.notna(v) and str(v).strip()}
                    print(f"  Row {i}: {row_clean}")
            else:
                print("\nCould not find header row automatically")
                print("Showing all column values from first row that has data:")
                for i in range(min(5, len(df))):
                    row = df.iloc[i].tolist()
                    non_empty = [(j, str(v)) for j, v in enumerate(row) if pd.notna(v) and str(v).strip()]
                    if non_empty:
                        print(f"  Row {i}: {non_empty}")

def main():
    # Find MTD files
    base_dir = Path(__file__).parent.parent
    print(f"Looking for MTD files in: {base_dir}")
    
    mtd_files = find_mtd_files(base_dir)
    
    if not mtd_files:
        print("No MTD files found. Checking backend uploads...")
        backend_uploads = base_dir / "backend" / "uploads"
        if backend_uploads.exists():
            for f in backend_uploads.rglob("*.xlsx"):
                if "MTD" in f.name.upper():
                    mtd_files.append(f)
    
    if not mtd_files:
        print("No MTD Excel files found!")
        print("\nSearching all xlsx files...")
        for f in base_dir.rglob("*.xlsx"):
            print(f"  Found: {f}")
        return
    
    print(f"\nFound {len(mtd_files)} MTD files:")
    for f in mtd_files:
        print(f"  - {f.name}")
    
    # Inspect each file
    for filepath in mtd_files:
        try:
            inspect_excel(filepath)
        except Exception as e:
            print(f"Error reading {filepath}: {e}")

if __name__ == "__main__":
    main()
