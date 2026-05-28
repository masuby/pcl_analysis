"""One-off helper: inspect both Google Sheets (LBF/SME + CS) to discover
structure (sheet names, headers, sample rows, distinct status values).
Run: python _inspect_sheets.py
"""
import json, sys, os
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

sys.stdout.reconfigure(encoding='utf-8')

HERE = os.path.dirname(os.path.abspath(__file__))
KEY  = os.path.join(HERE, 'sales-reps-status-7475ee1cd190.json')

LBF_SME_ID = '1n2U_Tt-7fC3hRRIfFHrcyTT9HkN408C_YN4jUbPFeZE'
CS_ID      = '14bZuq-NLlIp7HToHCrhn7HA3eQQtjRsKt0z1Nbzy1bI'

creds = Credentials.from_service_account_file(KEY, scopes=['https://www.googleapis.com/auth/spreadsheets'])
svc   = build('sheets', 'v4', credentials=creds, cache_discovery=False)


def inspect(sheet_id, label):
    print('='*80); print(label); print('='*80)
    meta = svc.spreadsheets().get(spreadsheetId=sheet_id).execute()
    sheets = meta['sheets']
    print(f'Sheets ({len(sheets)}):')
    for s in sheets:
        p = s['properties']
        print(f"  - {p['title']:40s}  ({p.get('gridProperties',{}).get('rowCount','?')}r x {p.get('gridProperties',{}).get('columnCount','?')}c)")

    # Show first 8 rows of MAY sheet if exists, else of SOCIAL MEDIA 04 if exists, else of first sheet
    target = None
    candidates = ['MAY', 'May', 'SOCIAL MEDIA 04', 'Social Media 04', 'SOCIAL_MEDIA_04']
    for c in candidates:
        for s in sheets:
            if c.lower() in s['properties']['title'].lower():
                target = s['properties']['title']; break
        if target: break
    if not target: target = sheets[0]['properties']['title']

    print(f'\n--- Inspecting: "{target}" ---')
    r = svc.spreadsheets().values().get(spreadsheetId=sheet_id, range=f'{target}!A1:Z10').execute()
    rows = r.get('values', [])
    for ri, row in enumerate(rows, 1):
        clean = [str(c)[:32] if c else '' for c in row]
        print(f'  R{ri}: {clean}')

    # Also if there's a Status column, dump distinct values from up to 2000 rows
    if rows:
        header = [str(h).strip() for h in rows[0]]
        status_col = None
        for kw in ['status', 'Status', 'STATUS', 'disposition', 'Disposition']:
            if kw in header:
                status_col = header.index(kw); break
        if status_col is not None:
            print(f'\n  Status column "{header[status_col]}" at col idx {status_col}')
            r = svc.spreadsheets().values().get(spreadsheetId=sheet_id, range=f'{target}!A1:Z2000').execute()
            allrows = r.get('values', [])
            distinct = {}
            for row in allrows[1:]:
                v = row[status_col] if status_col < len(row) else ''
                v = (v or '').strip()
                if v: distinct[v] = distinct.get(v, 0) + 1
            print(f'  Distinct status values ({len(distinct)}):')
            for v, n in sorted(distinct.items(), key=lambda x: -x[1])[:50]:
                print(f'    {n:5d}  {v}')


inspect(LBF_SME_ID, 'LBF / SME sheet')
print('\n')
inspect(CS_ID, 'CS sheet')
