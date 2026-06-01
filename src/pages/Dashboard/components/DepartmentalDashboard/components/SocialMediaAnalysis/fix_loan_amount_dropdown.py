"""
One-off cleanup: strip the inherited Yes/No dropdown from the loan_amount
column in MAY 2026 SHEET (both LBF/SME and CS workbooks) and re-apply
the proper "#,##0" number format.

Safe to run multiple times. Does NOT touch any cell values, headers, or
any other column.

Run:  python fix_loan_amount_dropdown.py
"""

from bootstrap_may2026 import (
    make_service, get_sheet_id, _qrange, hex_to_rgb, FONT,
    LBF_SME_ID, CS_ID, NEW_SHEET_TITLE,
)


def fix_loan_amount(svc, file_id, label):
    print(f'\n── {label} ─────────────────────────────────────────────────')
    sheet_id = get_sheet_id(svc, file_id, NEW_SHEET_TITLE)
    if sheet_id is None:
        print(f'  ⚠ sheet "{NEW_SHEET_TITLE}" not found — skipping')
        return

    # Read header row to find the loan_amount column
    header = svc.spreadsheets().values().get(
        spreadsheetId=file_id, range=_qrange(NEW_SHEET_TITLE, '1:1')
    ).execute().get('values', [[]])[0]

    try:
        ci = [str(h).strip().lower() for h in header].index('loan_amount')
    except ValueError:
        print(f'  ⚠ "loan_amount" column not found in header — skipping')
        return

    # Get the sheet's row count (so we cover the whole column)
    meta = svc.spreadsheets().get(
        spreadsheetId=file_id, includeGridData=False
    ).execute()
    grid = next(s for s in meta['sheets']
                if s['properties']['sheetId'] == sheet_id)
    row_count = grid['properties']['gridProperties'].get('rowCount', 2000)

    print(f'  found loan_amount at column index {ci} ({len(header)} cols total, '
          f'{row_count} rows)')

    reqs = [
        # 1) CLEAR data validation on the entire loan_amount column
        {
            'setDataValidation': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 1,
                          'endRowIndex': row_count,
                          'startColumnIndex': ci, 'endColumnIndex': ci + 1},
                # No 'rule' key → removes whatever validation was there
            }
        },
        # 2) Re-apply the proper number format
        {
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 1,
                          'endRowIndex': row_count,
                          'startColumnIndex': ci, 'endColumnIndex': ci + 1},
                'cell': {'userEnteredFormat': {
                    'numberFormat': {'type': 'NUMBER', 'pattern': '#,##0'},
                    'horizontalAlignment': 'RIGHT',
                    'textFormat': {'fontFamily': FONT, 'fontSize': 10},
                }},
                'fields': ('userEnteredFormat(numberFormat,'
                           'horizontalAlignment,textFormat)'),
            }
        },
    ]

    svc.spreadsheets().batchUpdate(
        spreadsheetId=file_id, body={'requests': reqs}
    ).execute()
    print('  ✓ dropdown stripped, number format re-applied')


if __name__ == '__main__':
    print('═' * 70)
    print('  Fix: strip Yes/No dropdown from loan_amount + re-apply number format')
    print('═' * 70)

    confirm = input(
        '\nWhich workbook(s)?\n'
        '  [1] LBF/SME only\n'
        '  [2] CS only\n'
        '  [3] Both\n'
        '  [q] Quit\n> '
    ).strip().lower()

    svc = make_service()
    if confirm in ('1', '3'):
        fix_loan_amount(svc, LBF_SME_ID, 'LBF/SME workbook')
    if confirm in ('2', '3'):
        fix_loan_amount(svc, CS_ID, 'CS workbook')
    if confirm not in ('1', '2', '3'):
        print('  cancelled — no changes made')
    else:
        print('\n✓ done — refresh the sheet in your browser to see the change')
