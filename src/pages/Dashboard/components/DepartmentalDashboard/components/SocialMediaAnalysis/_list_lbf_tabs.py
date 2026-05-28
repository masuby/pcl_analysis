"""List all LBF tabs with their sheetId so I can target the LATEST 'MAY SHEET'."""
import sys, os
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bootstrap_may2026 import make_service, LBF_SME_ID, LBF_SME_SRC

svc = make_service()
meta = svc.spreadsheets().get(spreadsheetId=LBF_SME_ID).execute()
print(f'{"idx":<4} {"sheetId":<14} {"title":<30} {"rowsxcols":<12}')
print('-'*70)
for i, s in enumerate(meta['sheets']):
    p = s['properties']
    g = p.get('gridProperties', {})
    print(f'{p["index"]:<4} {p["sheetId"]:<14} {p["title"]:<30} {g.get("rowCount",0)}x{g.get("columnCount",0)}')

# For each tab named MAY SHEET, peek at row 2 to see what data it has
print('\n--- Peek at any MAY SHEET tab ---')
for i, s in enumerate(meta['sheets']):
    p = s['properties']
    if 'MAY' in p['title'].upper():
        title = p['title']
        print(f"\n[{p['index']}] {repr(title)} (sheetId={p['sheetId']})")
        r = svc.spreadsheets().values().get(
            spreadsheetId=LBF_SME_ID, range=f"'{title}'!A1:N4").execute()
        for ri, row in enumerate(r.get('values', []), 1):
            print(f'  R{ri}: {[str(c)[:24] if c else "" for c in row]}')
