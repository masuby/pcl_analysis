import sys, os
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bootstrap_may2026 import make_service, LBF_SME_ID, CS_ID, NEW_SHEET_TITLE

svc = make_service()
for label, fid, end, status_idx, last_row in [
    ('LBF/SME', LBF_SME_ID, 'J', 7, 633),
    ('CS',      CS_ID,      'K', 8, 601),
]:
    print('=' * 70)
    print(f'{label} — first 4 then last 4 rows')
    print('=' * 70)
    r = svc.spreadsheets().values().get(
        spreadsheetId=fid, range=f'{NEW_SHEET_TITLE}!A1:{end}5',
        valueRenderOption='FORMATTED_VALUE').execute()
    for i, row in enumerate(r.get('values', []), 1):
        d = row[4] if len(row) > 4 else ''
        st = row[status_idx] if len(row) > status_idx else ''
        print(f'  R{i:>3}  date={d:12s}  {row[0]:8s}  {row[1]:14s}  {st}')
    print('  ...')
    r = svc.spreadsheets().values().get(
        spreadsheetId=fid,
        range=f'{NEW_SHEET_TITLE}!A{last_row - 3}:{end}{last_row}',
        valueRenderOption='FORMATTED_VALUE').execute()
    for i, row in enumerate(r.get('values', []), last_row - 3):
        d = row[4] if len(row) > 4 else ''
        st = row[status_idx] if len(row) > status_idx else ''
        print(f'  R{i:>3}  date={d:12s}  {row[0]:8s}  {row[1]:14s}  {st}')
    print()
