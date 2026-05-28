"""Count how many CS rows landed in each status bucket."""
import sys, os
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bootstrap_may2026 import make_service, CS_ID, NEW_SHEET_TITLE

svc = make_service()
# status column for CS is I (idx 8)
r = svc.spreadsheets().values().get(
    spreadsheetId=CS_ID, range=f'{NEW_SHEET_TITLE}!I2:I2000',
    valueRenderOption='FORMATTED_VALUE').execute()
vals = [row[0] if row else '' for row in r.get('values', [])]
c = Counter(v for v in vals if v)
print(f'Total non-empty status cells: {sum(c.values())}\n')
for status, n in sorted(c.items(), key=lambda x: -x[1]):
    marker = '  ✨ NEW' if status in ('Busy', 'Redirected') else ''
    print(f'  {n:4d}  {status}{marker}')
