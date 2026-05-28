"""Check whether LBF MAY 2026 SHEET dates are strictly non-decreasing."""
import sys, os
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bootstrap_may2026 import make_service, LBF_SME_ID, NEW_SHEET_TITLE

svc = make_service()
r = svc.spreadsheets().values().get(
    spreadsheetId=LBF_SME_ID,
    range=f'{NEW_SHEET_TITLE}!E2:E2000',
    valueRenderOption='UNFORMATTED_VALUE').execute()
vals = [row[0] if row else '' for row in r.get('values', [])]
vals = [v for v in vals if v != '']
print(f'Non-empty date cells: {len(vals)}')
print(f'First 5 (serial): {vals[:5]}')
print(f'Last 5  (serial): {vals[-5:]}')

violations = 0
prev = None
for i, v in enumerate(vals):
    if prev is not None and v < prev:
        violations += 1
        if violations <= 8:
            print(f'  OUT OF ORDER at row {i+2}: prev={prev} now={v}')
    prev = v
print(f'\nTotal out-of-order entries: {violations}')
print(f'Sorted ascending: {violations == 0}')
