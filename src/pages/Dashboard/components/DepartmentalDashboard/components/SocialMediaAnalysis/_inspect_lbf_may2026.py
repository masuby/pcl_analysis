"""Dump the CALLING DATE column from the TRUE May 2026 tab."""
import sys, os
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bootstrap_may2026 import make_service, LBF_SME_ID

svc = make_service()
TITLE = 'MAY SHEET '   # with trailing space — this is the May 2026 tab

r = svc.spreadsheets().values().get(
    spreadsheetId=LBF_SME_ID, range=f"'{TITLE}'!A1:AZ3300").execute()
rows = r.get('values', [])
header = [str(h).strip() for h in (rows[0] if rows else [])]
print(f'Header ({len(header)}): {header}')
print(f'Total rows: {len(rows)}')

# Find CALLING DATE col
date_idx = None
for i, h in enumerate(header):
    if 'calling' in h.lower() and 'date' in h.lower():
        date_idx = i; break
if date_idx is None:
    # fallback
    for i, h in enumerate(header):
        if 'date' in h.lower(): date_idx = i; break
print(f'\nDate column idx: {date_idx} = {repr(header[date_idx])}')

vals = []
for row in rows[1:]:
    v = row[date_idx] if date_idx < len(row) else ''
    vals.append(str(v or '').strip())

non_empty = [v for v in vals if v]
c = Counter(non_empty)
print(f'Non-empty: {len(non_empty)}  Empty: {len(vals) - len(non_empty)}  Distinct: {len(c)}')

print('\nALL distinct values (sorted by frequency):')
for v, n in c.most_common():
    print(f'   {n:4d}  {repr(v)}')
