"""Check LBF sheet for ANY column with the wildly-formatted date data
the user pasted (11/05/2026, 11-May-2026, 13May2026, 22/05, etc.)."""
import sys, os, re
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bootstrap_may2026 import make_service, LBF_SME_ID, LBF_SME_SRC

svc = make_service()

# Check column count
meta = svc.spreadsheets().get(spreadsheetId=LBF_SME_ID).execute()
for s in meta['sheets']:
    if s['properties']['title'] == LBF_SME_SRC:
        print(f"Grid: {s['properties']['gridProperties']}")

# Dump all distinct values from EVERY column to find the one with messy dates
r = svc.spreadsheets().values().get(
    spreadsheetId=LBF_SME_ID, range=f'{LBF_SME_SRC}!A1:AZ3300').execute()
rows = r.get('values', [])
max_cols = max((len(row) for row in rows), default=0)
print(f'Max cols seen across all rows: {max_cols}')
print(f'Total rows: {len(rows)}')

DATE_PAT = re.compile(r'(\d{1,2}[-/\s]\d{1,2}([-/\s]\d{2,4})?|\d{1,2}[-\s]?[A-Za-z]{3}[-\s]?\d{2,4}|\d{1,2}[A-Za-z]{3}\d{2,4})')

for ci in range(max_cols):
    vals = []
    for row in rows[1:]:
        v = row[ci] if ci < len(row) else ''
        if v and str(v).strip():
            vals.append(str(v).strip())
    if not vals: continue
    # Count how many of these look date-like
    date_hits = sum(1 for v in vals if DATE_PAT.search(v))
    if date_hits >= 50:   # likely a date column
        c = Counter(vals)
        # How many DISTINCT date-like patterns?
        distinct_date_forms = len(c)
        header_name = rows[0][ci] if ci < len(rows[0]) else '???'
        print(f'\n--- col {ci} ({repr(header_name)}): {len(vals)} non-empty, {distinct_date_forms} distinct, {date_hits} date-like')
        # Print first 30 distinct
        for v, n in c.most_common(30):
            print(f'   {n:4d}  {repr(v)}')
