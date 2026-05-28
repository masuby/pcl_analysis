"""Survey ALL date column candidates in LBF MAY SHEET — find the right one
and dump every distinct date string so I can build a parser that handles
all the wild formats the data-entry team used.
"""
import sys, os, re
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bootstrap_may2026 import make_service, LBF_SME_ID, LBF_SME_SRC

svc = make_service()
# Wider grab — cols A:AZ
r = svc.spreadsheets().values().get(
    spreadsheetId=LBF_SME_ID, range=f'{LBF_SME_SRC}!A1:AZ3300').execute()
rows = r.get('values', [])
header = [str(h).strip() for h in (rows[0] if rows else [])]
print(f'Header columns ({len(header)}):')
for i, h in enumerate(header):
    print(f'  [{i}] {repr(h)}')

# Find any column matching date / calling
date_cols = []
for i, h in enumerate(header):
    if any(kw in h.lower() for kw in ['date', 'calling']):
        date_cols.append(i)
print(f'\nDate-like columns: {date_cols}')

for ci in date_cols:
    print(f'\n========== col {ci} = {repr(header[ci])} ==========')
    vals = [row[ci] if ci < len(row) else '' for row in rows[1:]]
    vals = [v.strip() for v in vals if v and str(v).strip()]
    c = Counter(vals)
    print(f'Non-empty: {len(vals)}  Distinct: {len(c)}')
    print('Top 40 distinct values:')
    for v, n in c.most_common(40):
        print(f'  {n:4d}  {repr(v)}')
