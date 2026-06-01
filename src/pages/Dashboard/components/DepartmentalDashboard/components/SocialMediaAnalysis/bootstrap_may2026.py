"""
Bootstrap script v2 — (re)creates "MAY 2026 SHEET" inside BOTH Google Sheets
(LBF/SME and CS) with the unified template the dashboard will consume.

SAFETY: only the "MAY 2026 SHEET" tab is touched. All other tabs are untouched.

Column order (per spec):
    LBF  (9 cols):   Product, Platform, name, check_no, date,
                     assigned_to, phone_no, status, is_converted?
    CS  (10 cols):   Product, Platform, name, check_no, date,
                     assigned_to, phone_no, feedback, status, is_converted?

Dates are written as Google Sheets serial numbers and the column gets the
number format "dd/mm/yyyy" so the cell behaves as a real Date field.

LBF source dates are dd-MMM-yyyy ("27-May-2025") with empty cells that
forward-fill from the most recent non-empty date above.

CS source dates are m/d/yyyy ("5/5/2026") — parsed and re-formatted.

Run:  python bootstrap_may2026.py
"""

import os
import re
import sys
from collections import Counter
from datetime import date, datetime

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

sys.stdout.reconfigure(encoding='utf-8')

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────
HERE = os.path.dirname(os.path.abspath(__file__))
KEY  = os.path.join(HERE, 'sales-reps-status-7475ee1cd190.json')

LBF_SME_ID   = '1n2U_Tt-7fC3hRRIfFHrcyTT9HkN408C_YN4jUbPFeZE'
# NOTE the trailing space — the workbook has TWO tabs called "MAY SHEET";
# the one with the trailing space is the LATEST (May 2026) data the user
# is actively updating.  Without the space we'd read the May-2025 archive.
LBF_SME_SRC  = 'MAY SHEET '
CS_ID        = '14bZuq-NLlIp7HToHCrhn7HA3eQQtjRsKt0z1Nbzy1bI'
CS_SRC       = 'SOCIAL MEDIA 04'

NEW_SHEET_TITLE = 'MAY 2026 SHEET'

# Font used everywhere — Lato renders well in Sheets and on export
FONT = 'Lato'

# ─────────────────────────────────────────────────────────────────────────────
# Templates
# ─────────────────────────────────────────────────────────────────────────────
LBF_COLS = ['Product', 'Platform', 'name', 'check_no', 'date',
            'assigned_to', 'phone_no', 'status', 'comment', 'is_converted?',
            'loan_amount', 'client_type']

CS_COLS  = ['Product', 'Platform', 'name', 'check_no', 'date',
            'assigned_to', 'phone_no', 'feedback', 'status', 'comment',
            'is_converted?', 'loan_amount', 'client_type']

LBF_STATUS = [
    'Not picking', 'Not interested', 'Request callback', 'Not reachable',
    'Not qualified', 'Request more time', 'Failed to connect',
    'Duplicated number', 'Qualified for SME', 'Qualified for CS',
    'Converted', 'Referred',
]
CS_STATUS = [
    'Not picking', 'Not reachable', 'Request callback', 'Not interested',
    'No affordability', 'Not qualified', 'Existing client',
    'Qualified for LBF', 'Qualified for SME', 'Converted',
    'Duplicated number', 'Probation', 'Busy', 'Redirected', 'Other',
]
YES_NO = ['No', 'Yes']
CLIENT_TYPE = ['New', 'Repeat']

# Status colour palette (hex without #) — bg + fg
STATUS_COLORS = {
    'Converted':         ('DCFCE7', '14532D'),
    'Qualified for LBF': ('E0E7FF', '3730A3'),
    'Qualified for SME': ('D1FAE5', '065F46'),
    'Qualified for CS':  ('CFFAFE', '155E75'),
    'Existing client':   ('DBEAFE', '1E3A8A'),
    'Probation':         ('EDE9FE', '5B21B6'),
    'Referred':          ('FCE7F3', '9D174D'),
    'Request callback':  ('FEF3C7', '92400E'),
    'Request more time': ('FFEDD5', '9A3412'),
    'No affordability':  ('FED7AA', '7C2D12'),
    'Duplicated number': ('E9D5FF', '6B21A8'),
    'Not picking':       ('F3F4F6', '4B5563'),
    'Not reachable':     ('E5E7EB', '374151'),
    'Not interested':    ('FEE2E2', '991B1B'),
    'Not qualified':     ('FECACA', '7F1D1D'),
    'Failed to connect': ('FEE4E2', '7F1D1D'),
    'Busy':              ('FEF9C3', '854D0E'),  # warm yellow
    'Redirected':        ('E0F2FE', '075985'),  # sky blue
    'Other':             ('F9FAFB', '6B7280'),
}

# ─────────────────────────────────────────────────────────────────────────────
# CS freetext → dropdown mapping
# ─────────────────────────────────────────────────────────────────────────────
def _norm(s):
    return re.sub(r'\s+', ' ', str(s or '').lower().strip())

CS_STATUS_RULES = [
    ('Converted',         ['converted', 'tayar', 'amesha lipa', 'amelipa']),
    ('Qualified for LBF', ['qualify lbf', 'qualified for lbf', 'lbf qualify']),
    ('Qualified for SME', ['qualify sme', 'qualified for sme', 'sme qualify']),
    ('Existing client',   ['ameshahudumiwa', 'ashahudumiwa', 'alisha pigiwa',
                           'existing client', 'old client', 'mteja wa zamani']),
    ('Probation',         ['ajira mpya', 'probation', 'mfanyakazi mpya',
                           'new hire']),
    # Put REDIRECTED before DUPLICATED so "ameelekeza namba kwingine"
    # hits Redirected first.
    ('Redirected',        ['ameelekeza', 'elekezwa', 'redirected',
                           'ameelekeza kwingine', 'ameelekeza namba',
                           'directed to', 'redirect']),
    # BUSY — phone occupied / agent speaking on call
    ('Busy',              ['anatumika', 'busy', 'anaongea na simu',
                           'anaongea simu', 'kwenye simu', 'anaongea',
                           'busy line', 'in a call']),
    ('No affordability',  ['no affordability', 'hana 1/3', 'hana 1,3',
                           'hana vigezo', 'hakopesheki', 'hana mshahara',
                           'affordability']),
    ('Not qualified',     ['siyo mtumishi', 'sio mtumishi', 'not civil servant',
                           'not cs', 'sio cs', 'mwanajeshi', 'jkt', 'private',
                           'not qualified', 'kapuni binafsi']),
    ('Duplicated number', ['same no', 'duplicated', 'duplicate', 'same number']),
    ('Request callback',  ['atanirudia', 'ataturudia', 'ataniludia', 'nitamrudia',
                           'nitamludia', 'callback', 'call later', 'rudia',
                           'atatutafuta', 'atanitafuta', 'atanipigia']),
    ('Not picking',       ['hapokei', 'haipokei', 'hajapokea', 'haitaji kupokea',
                           'not picking', 'not pinking', 'haongei']),
    ('Not reachable',     ['hapatikani', 'haipatikani', 'hapatikan',
                           'unreachable', 'not reachable', 'mteja hapatikani']),
    ('Not interested',    ['haitaji', 'hahitaji', 'hana uhitaji', 'haitaji huduma',
                           'hahitaji huduma', 'haitaji kwa sasa', 'haitaki',
                           'anakata', 'anakata simu', 'asante', 'thank you',
                           'not interested', 'anafikiria']),
]


def map_cs_status(raw):
    n = _norm(raw)
    if not n:
        return ''
    for label, keywords in CS_STATUS_RULES:
        for kw in keywords:
            if kw in n:
                return label
    return 'Other'


# ─────────────────────────────────────────────────────────────────────────────
# Date parsing
# ─────────────────────────────────────────────────────────────────────────────
SERIAL_EPOCH = date(1899, 12, 30)
MONTH_3 = {m.lower(): i + 1 for i, m in enumerate(
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}


def to_serial(d):
    if isinstance(d, datetime):
        d = d.date()
    return (d - SERIAL_EPOCH).days


def parse_lbf_date(s, default_year=2026, default_month=5):
    """Robust parser for the LBF 'CALLING DATE' column.

    The source column has 46+ wildly inconsistent formats typed by hand:
       11-May-2026, 11 May 2026, 13May2026, 27-May-2026         (MMM-based)
       22/05/2026, 11/5/2026, 18/05/2026, 11 05 2026, 15 05 2026 (D/M[/Y])
       05/13/2026, 05/28/2026, 05/26/2026                         (M/D/Y — clear)
       5/11/2026                                                  (ambiguous)
       25/05, 22/05                                               (no year)

    Strategy:
      1. Try MMM-based formats first (unambiguous).
      2. All-numeric: extract digits.
      3. Disambiguate D/M vs M/D using:
         - First > 12  → first is day  → D/M
         - Second > 12 → second is day → M/D
         - Both ≤ 12   → if either is `default_month` (5 for May), treat it as
                         the month; else prefer D/M (dominant convention).
      4. Missing year → use `default_year` (2026 for this column).
    """
    s = (s or '').strip()
    if not s:
        return None

    # ── (1) MMM-based: with year ────────────────────────────────────────────
    m = re.match(
        r'^\s*(\d{1,2})\s*[-/\s]?\s*([A-Za-z]{3,9})\s*[-/\s]?\s*(\d{2,4})\s*$', s)
    if m:
        d  = int(m.group(1))
        mo = MONTH_3.get(m.group(2)[:3].lower())
        y  = int(m.group(3))
        if y < 100:
            y += 2000
        if mo:
            try:
                return date(y, mo, d)
            except ValueError:
                pass

    # MMM-based: no year (use default)
    m = re.match(r'^\s*(\d{1,2})\s*[-/\s]?\s*([A-Za-z]{3,9})\s*$', s)
    if m:
        d  = int(m.group(1))
        mo = MONTH_3.get(m.group(2)[:3].lower())
        if mo:
            try:
                return date(default_year, mo, d)
            except ValueError:
                pass

    # ── (2) All-numeric ─────────────────────────────────────────────────────
    nums = [int(n) for n in re.findall(r'\d+', s)]
    if not nums:
        return None

    # Pull out a 4-digit year if present
    year = None
    rest = []
    for n in nums:
        if year is None and 2020 <= n <= 2030:
            year = n
        else:
            rest.append(n)
    if year is None:
        year = default_year

    if len(rest) == 1:
        day = rest[0]
        if 1 <= day <= 31:
            try:
                return date(year, default_month, day)
            except ValueError:
                return None
        return None

    if len(rest) >= 2:
        a, b = rest[0], rest[1]
        day, month = None, None
        if a > 12 and 1 <= b <= 12:                # D/M unambiguous
            day, month = a, b
        elif b > 12 and 1 <= a <= 12:              # M/D unambiguous
            month, day = a, b
        elif 1 <= a <= 12 and 1 <= b <= 12:        # ambiguous — 5-as-May rule
            if a == default_month and b != default_month:
                month, day = a, b                  # 5/11 → May 11
            elif b == default_month:
                day, month = a, b                  # 11/5 → May 11
            else:
                day, month = a, b                  # fallback: D/M convention
        if day and month:
            try:
                return date(year, month, day)
            except ValueError:
                return None
    return None


def parse_cs_date(s):
    """CS: m/d/yyyy ('5/5/2026'). Returns date or None.
    Falls back to d/m/y if month component would be > 12."""
    s = (s or '').strip()
    if not s:
        return None
    m = re.match(r'^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$', s)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000
        # Try m/d/y first (user said CS is mm/dd/yyyy)
        if 1 <= a <= 12 and 1 <= b <= 31:
            try:
                return date(y, a, b)
            except ValueError:
                pass
        # Fall back: d/m/y if first num > 12
        if 1 <= b <= 12 and 1 <= a <= 31:
            try:
                return date(y, b, a)
            except ValueError:
                pass
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Google API helpers
# ─────────────────────────────────────────────────────────────────────────────
def make_service():
    creds = Credentials.from_service_account_file(
        KEY, scopes=['https://www.googleapis.com/auth/spreadsheets'])
    return build('sheets', 'v4', credentials=creds, cache_discovery=False)


def get_sheet_id(svc, file_id, title):
    meta = svc.spreadsheets().get(spreadsheetId=file_id).execute()
    for s in meta['sheets']:
        if s['properties']['title'] == title:
            return s['properties']['sheetId']
    return None


def delete_sheet_if_exists(svc, file_id, title):
    sid = get_sheet_id(svc, file_id, title)
    if sid is None:
        return
    print(f'  - deleting existing "{title}" (id={sid}) for fresh rebuild')
    svc.spreadsheets().batchUpdate(
        spreadsheetId=file_id,
        body={'requests': [{'deleteSheet': {'sheetId': sid}}]},
    ).execute()


def add_sheet(svc, file_id, title, rows, cols):
    print(f'  + creating sheet "{title}" ({rows}r × {cols}c)…')
    res = svc.spreadsheets().batchUpdate(
        spreadsheetId=file_id,
        body={'requests': [{
            'addSheet': {
                'properties': {
                    'title': title,
                    'gridProperties': {'rowCount': rows, 'columnCount': cols},
                }
            }
        }]},
    ).execute()
    return res['replies'][0]['addSheet']['properties']['sheetId']


def _qrange(sheet_title, cells):
    """Quote a sheet name properly for the Sheets v4 'range' parameter.
    Required when the name has spaces or trailing whitespace."""
    safe = sheet_title.replace("'", "''")
    return f"'{safe}'!{cells}"


def write_values(svc, file_id, sheet_title, values):
    """Write values as RAW so numeric dates land as numbers."""
    svc.spreadsheets().values().update(
        spreadsheetId=file_id,
        range=_qrange(sheet_title, 'A1'),
        valueInputOption='RAW',
        body={'values': values},
    ).execute()


def col_letter(idx):
    """0-based idx → A, B, …, Z, AA…"""
    s = ''
    i = idx
    while True:
        s = chr(ord('A') + i % 26) + s
        i = i // 26 - 1
        if i < 0:
            break
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Styling
# ─────────────────────────────────────────────────────────────────────────────
def hex_to_rgb(h):
    return {
        'red':   int(h[0:2], 16) / 255.0,
        'green': int(h[2:4], 16) / 255.0,
        'blue':  int(h[4:6], 16) / 255.0,
    }


def style_sheet(svc, file_id, sheet_id, columns, status_options,
                status_col_idx, conv_col_idx, date_col_idx,
                row_count, col_widths,
                loan_amount_col_idx=None, client_type_col_idx=None):
    """Apply header style, frozen header row, date format, dropdowns,
    per-status colour, etc."""
    n_cols = len(columns)
    reqs = []

    # 1) Freeze ONLY top row — leave columns scrollable left/right
    reqs.append({
        'updateSheetProperties': {
            'properties': {
                'sheetId': sheet_id,
                'gridProperties': {'frozenRowCount': 1, 'frozenColumnCount': 0},
            },
            'fields': 'gridProperties(frozenRowCount,frozenColumnCount)',
        }
    })

    # 2) Header style — dark blue bg, white bold text, taller
    reqs.append({
        'repeatCell': {
            'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 1,
                      'startColumnIndex': 0, 'endColumnIndex': n_cols},
            'cell': {'userEnteredFormat': {
                'backgroundColor': hex_to_rgb('1F3864'),
                'horizontalAlignment': 'CENTER',
                'verticalAlignment':   'MIDDLE',
                'textFormat': {
                    'foregroundColor': hex_to_rgb('FFFFFF'),
                    'fontFamily': FONT, 'fontSize': 11, 'bold': True,
                },
                'borders': {
                    'bottom': {'style': 'SOLID_MEDIUM',
                               'color': hex_to_rgb('12509B')}
                },
            }},
            'fields': ('userEnteredFormat(backgroundColor,horizontalAlignment,'
                       'verticalAlignment,textFormat,borders)'),
        }
    })
    reqs.append({
        'updateDimensionProperties': {
            'range': {'sheetId': sheet_id, 'dimension': 'ROWS',
                      'startIndex': 0, 'endIndex': 1},
            'properties': {'pixelSize': 38},
            'fields': 'pixelSize',
        }
    })

    # 3) Column widths
    for ci, w in enumerate(col_widths):
        reqs.append({
            'updateDimensionProperties': {
                'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS',
                          'startIndex': ci, 'endIndex': ci + 1},
                'properties': {'pixelSize': w},
                'fields': 'pixelSize',
            }
        })

    # 4) Data-area defaults: Lato 10, wrap, vertical middle, soft borders
    reqs.append({
        'repeatCell': {
            'range': {'sheetId': sheet_id, 'startRowIndex': 1,
                      'endRowIndex': row_count, 'startColumnIndex': 0,
                      'endColumnIndex': n_cols},
            'cell': {'userEnteredFormat': {
                'verticalAlignment': 'MIDDLE',
                'wrapStrategy':      'WRAP',
                'textFormat': {'fontFamily': FONT, 'fontSize': 10},
                'borders': {
                    'bottom': {'style': 'SOLID',
                               'color': hex_to_rgb('E5E7EB')},
                    'right':  {'style': 'SOLID',
                               'color': hex_to_rgb('E5E7EB')},
                },
            }},
            'fields': ('userEnteredFormat(verticalAlignment,wrapStrategy,'
                       'textFormat,borders)'),
        }
    })

    # 5) Banded rows
    reqs.append({
        'addBanding': {
            'bandedRange': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 0,
                          'endRowIndex': row_count,
                          'startColumnIndex': 0, 'endColumnIndex': n_cols},
                'rowProperties': {
                    'headerColor':     hex_to_rgb('1F3864'),
                    'firstBandColor':  hex_to_rgb('FFFFFF'),
                    'secondBandColor': hex_to_rgb('F7FAFD'),
                },
            }
        }
    })

    # 6) Date column number-format: dd/mm/yyyy
    reqs.append({
        'repeatCell': {
            'range': {'sheetId': sheet_id, 'startRowIndex': 1,
                      'endRowIndex': row_count,
                      'startColumnIndex': date_col_idx,
                      'endColumnIndex': date_col_idx + 1},
            'cell': {'userEnteredFormat': {
                'numberFormat': {'type': 'DATE', 'pattern': 'dd/mm/yyyy'},
                'horizontalAlignment': 'CENTER',
            }},
            'fields': 'userEnteredFormat(numberFormat,horizontalAlignment)',
        }
    })

    # 7) status dropdown
    reqs.append({
        'setDataValidation': {
            'range': {'sheetId': sheet_id, 'startRowIndex': 1,
                      'endRowIndex': row_count,
                      'startColumnIndex': status_col_idx,
                      'endColumnIndex': status_col_idx + 1},
            'rule': {
                'condition': {'type': 'ONE_OF_LIST',
                              'values': [{'userEnteredValue': v}
                                         for v in status_options]},
                'showCustomUi': True, 'strict': False,
                'inputMessage': 'Pick a status from the dropdown.',
            },
        }
    })

    # 8) is_converted? dropdown
    reqs.append({
        'setDataValidation': {
            'range': {'sheetId': sheet_id, 'startRowIndex': 1,
                      'endRowIndex': row_count,
                      'startColumnIndex': conv_col_idx,
                      'endColumnIndex': conv_col_idx + 1},
            'rule': {
                'condition': {'type': 'ONE_OF_LIST',
                              'values': [{'userEnteredValue': v} for v in YES_NO]},
                'showCustomUi': True, 'strict': True,
            },
        }
    })

    # 8b) loan_amount — number format with thousand separators, right-aligned
    if loan_amount_col_idx is not None:
        reqs.append({
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 1,
                          'endRowIndex': row_count,
                          'startColumnIndex': loan_amount_col_idx,
                          'endColumnIndex': loan_amount_col_idx + 1},
                'cell': {'userEnteredFormat': {
                    'numberFormat': {'type': 'NUMBER', 'pattern': '#,##0'},
                    'horizontalAlignment': 'RIGHT',
                    'textFormat': {'fontFamily': FONT, 'fontSize': 10},
                }},
                'fields': ('userEnteredFormat(numberFormat,'
                           'horizontalAlignment,textFormat)'),
            }
        })

    # 8c) client_type — dropdown New / Repeat with per-value colour
    if client_type_col_idx is not None:
        reqs.append({
            'setDataValidation': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 1,
                          'endRowIndex': row_count,
                          'startColumnIndex': client_type_col_idx,
                          'endColumnIndex': client_type_col_idx + 1},
                'rule': {
                    'condition': {'type': 'ONE_OF_LIST',
                                  'values': [{'userEnteredValue': v}
                                             for v in CLIENT_TYPE]},
                    'showCustomUi': True, 'strict': False,
                    'inputMessage': 'Pick New or Repeat (only for converted sales).',
                },
            }
        })
        # Colour-code client_type values
        client_type_colors = {
            'New':    ('DBEAFE', '1E40AF'),   # blue
            'Repeat': ('FEF3C7', '92400E'),   # amber
        }
        for value, (bg, fg) in client_type_colors.items():
            reqs.append({
                'addConditionalFormatRule': {
                    'rule': {
                        'ranges': [{'sheetId': sheet_id, 'startRowIndex': 1,
                                    'endRowIndex': row_count,
                                    'startColumnIndex': client_type_col_idx,
                                    'endColumnIndex': client_type_col_idx + 1}],
                        'booleanRule': {
                            'condition': {'type': 'TEXT_EQ',
                                          'values': [{'userEnteredValue': value}]},
                            'format': {
                                'backgroundColor': hex_to_rgb(bg),
                                'textFormat': {
                                    'bold': True,
                                    'foregroundColor': hex_to_rgb(fg),
                                },
                            },
                        },
                    },
                    'index': 0,
                }
            })

    # 9) Per-status conditional formatting on the status column
    for value in status_options:
        bg, fg = STATUS_COLORS.get(value, ('F9FAFB', '6B7280'))
        reqs.append({
            'addConditionalFormatRule': {
                'rule': {
                    'ranges': [{'sheetId': sheet_id, 'startRowIndex': 1,
                                'endRowIndex': row_count,
                                'startColumnIndex': status_col_idx,
                                'endColumnIndex': status_col_idx + 1}],
                    'booleanRule': {
                        'condition': {'type': 'TEXT_EQ',
                                      'values': [{'userEnteredValue': value}]},
                        'format': {
                            'backgroundColor': hex_to_rgb(bg),
                            'textFormat': {
                                'bold': True,
                                'foregroundColor': hex_to_rgb(fg),
                            },
                        },
                    },
                },
                'index': 0,
            }
        })

    # 10) is_converted=Yes → light green tint on whole row
    conv_letter = col_letter(conv_col_idx)
    reqs.append({
        'addConditionalFormatRule': {
            'rule': {
                'ranges': [{'sheetId': sheet_id, 'startRowIndex': 1,
                            'endRowIndex': row_count,
                            'startColumnIndex': 0,
                            'endColumnIndex': n_cols}],
                'booleanRule': {
                    'condition': {
                        'type': 'CUSTOM_FORMULA',
                        'values': [{'userEnteredValue':
                                    f'=${conv_letter}2="Yes"'}],
                    },
                    'format': {
                        'backgroundColor': hex_to_rgb('ECFDF5'),
                    },
                },
            },
            'index': 0,
        }
    })

    # Execute in one batch
    svc.spreadsheets().batchUpdate(spreadsheetId=file_id,
                                   body={'requests': reqs}).execute()


# ─────────────────────────────────────────────────────────────────────────────
# Migration helpers
# ─────────────────────────────────────────────────────────────────────────────
def fetch_all(svc, file_id, sheet, end_col='Z'):
    r = svc.spreadsheets().values().get(
        spreadsheetId=file_id, range=_qrange(sheet, f'A1:{end_col}')).execute()
    return r.get('values', [])


def _g(row, idx):
    return (row[idx] if idx is not None and idx >= 0 and idx < len(row)
            else '') or ''


def header_idx(header, *candidates):
    for cand in candidates:
        for i, h in enumerate(header):
            if str(h).strip().lower() == cand.lower():
                return i
    return -1


# ─────────────────────────────────────────────────────────────────────────────
# LBF/SME migration
# ─────────────────────────────────────────────────────────────────────────────
def migrate_lbf_sme(svc):
    print('\n── LBF/SME workbook ─────────────────────────────────────────')
    raw = fetch_all(svc, LBF_SME_ID, LBF_SME_SRC, end_col='AB')
    if not raw:
        print(f'  ⚠ source "{LBF_SME_SRC}" is empty')
        return
    header = [str(h).strip() for h in raw[0]]
    print(f'  source header: {header[:12]}')

    idx = {
        'product': header_idx(header, 'PRDT LEADS', 'PRODUCT', 'Product'),
        'channel': header_idx(header, 'CHANNEL', 'Channel', 'Platform'),
        # Customer name — prefer plural 'NAMES' so we don't collide with
        # agent column 'NAME' (the new May-2026 tab has both).
        'name':    header_idx(header, 'NAMES', 'Names'),
        'number':  header_idx(header, 'NUMBERS', 'NUMBER', 'PHONE',
                              'Phone Number', 'phone_number', 'phone_no'),
        'status':  header_idx(header, 'STATUS', 'Status'),
        'comment': header_idx(header, 'COMMENT', 'Comment'),
        'date':    header_idx(header, 'calling_date', 'CALLING DATE',
                              'CALL DATE', 'Call Date', 'Date'),
        # Agent name — May-2026 tab uses bare 'NAME'; older tabs use 'AGENT NAME'.
        'agent':   header_idx(header, 'AGENT NAME', 'AGENT', 'Agent Name',
                              'Assigned_to', 'assigned_to', 'NAME', 'Name'),
    }
    print(f'  detected indices: {idx}')

    # Forward-fill empty date cells using last seen
    last_date = None
    parsed_dates, raw_dates = [], []
    for row in raw[1:]:
        s = _g(row, idx['date']).strip()
        raw_dates.append(s)
        d = parse_lbf_date(s)
        if d is None:
            d = last_date              # forward-fill
        else:
            last_date = d
        parsed_dates.append(d)

    filled = sum(1 for s, d in zip(raw_dates, parsed_dates) if not s and d)
    print(f'  date column forward-fill: {filled} empty cells filled from prior')

    out = [LBF_COLS]
    skipped = 0
    for row, d in zip(raw[1:], parsed_dates):
        product = _g(row, idx['product']).strip()
        channel = _g(row, idx['channel']).strip()
        phone   = str(_g(row, idx['number'])).strip()
        name    = _g(row, idx['name']).strip()
        status  = _g(row, idx['status']).strip()
        comment = _g(row, idx['comment']).strip()
        agent   = _g(row, idx['agent']).strip()
        # Drop fully blank rows
        if not (product or channel or phone or name or status):
            skipped += 1
            continue
        date_cell = to_serial(d) if d else ''
        out.append([
            product, channel, name, '',           # check_no = empty for LBF
            date_cell,
            agent, phone,
            status,
            comment,
            'No',
            '',                                   # loan_amount — blank by default
            '',                                   # client_type — blank by default
        ])

    # Sort by date ASC (earliest first); rows without a date sink to the bottom
    header_row, *data_rows = out
    data_rows.sort(key=lambda r: (r[4] == '', r[4] if r[4] != '' else 0))
    out = [header_row] + data_rows

    print(f'  migrating {len(out) - 1} rows  (skipped {skipped} blank, sorted by date asc)')

    delete_sheet_if_exists(svc, LBF_SME_ID, NEW_SHEET_TITLE)
    row_count = max(len(out) + 100, 2000)
    sheet_id  = add_sheet(svc, LBF_SME_ID, NEW_SHEET_TITLE,
                          rows=row_count, cols=len(LBF_COLS))
    write_values(svc, LBF_SME_ID, NEW_SHEET_TITLE, out)
    # Column widths for LBF order:
    #   Product, Platform, name, check_no, date, assigned_to, phone_no,
    #   status, comment, is_converted?, loan_amount, client_type
    widths = [90, 130, 200, 90, 110, 140, 140, 180, 260, 120, 130, 110]
    style_sheet(svc, LBF_SME_ID, sheet_id,
                columns=LBF_COLS, status_options=LBF_STATUS,
                status_col_idx=7, conv_col_idx=9, date_col_idx=4,
                row_count=row_count, col_widths=widths,
                loan_amount_col_idx=10, client_type_col_idx=11)
    print('  ✓ done')


# ─────────────────────────────────────────────────────────────────────────────
# CS migration
# ─────────────────────────────────────────────────────────────────────────────
def migrate_cs(svc):
    print('\n── CS workbook ──────────────────────────────────────────────')
    raw = fetch_all(svc, CS_ID, CS_SRC, end_col='AB')
    if not raw:
        print(f'  ⚠ source "{CS_SRC}" is empty')
        return
    header = [str(h).strip() for h in raw[0]]
    print(f'  source header: {header[:12]}')

    idx = {
        'date':   header_idx(header, 'Date'),
        'type':   header_idx(header, 'Type of campaign', 'Product'),
        'plat':   header_idx(header, 'Platform', 'Channel'),
        'phone':  header_idx(header, 'Phone number', 'phone_number', 'phone_no'),
        'name':   header_idx(header, 'Name'),
        'check':  header_idx(header, 'check_no'),
        'agent':  header_idx(header, 'Assigned_to', 'assigned_to'),
        'status': header_idx(header, 'Status'),
        'conv':   header_idx(header, 'is_converted'),
    }
    print(f'  detected indices: {idx}')

    out = [CS_COLS]
    mapped, other, skipped = 0, 0, 0
    for row in raw[1:]:
        product  = _g(row, idx['type']).strip()
        channel  = _g(row, idx['plat']).strip()
        phone    = str(_g(row, idx['phone'])).strip()
        name     = _g(row, idx['name']).strip()
        check_no = _g(row, idx['check']).strip()
        agent    = _g(row, idx['agent']).strip()
        feedback = _g(row, idx['status']).strip()    # original messy text
        std      = map_cs_status(feedback)
        conv     = _g(row, idx['conv']).strip() or 'No'
        if conv.lower() not in ('yes', 'no'):
            conv = 'No'
        d        = parse_cs_date(_g(row, idx['date']))

        if not (product or channel or phone or name or feedback):
            skipped += 1
            continue
        if std == 'Other' and feedback:
            other += 1
        elif std:
            mapped += 1

        out.append([
            'CS', channel or product, name, check_no,
            to_serial(d) if d else '',
            agent, phone,
            feedback,
            std,
            '',                       # comment — blank for CS migration
            'Yes' if conv.lower() == 'yes' else 'No',
            '',                       # loan_amount — blank by default
            '',                       # client_type — blank by default
        ])

    # Sort by date ASC (earliest first); rows without a date sink to the bottom
    header_row, *data_rows = out
    data_rows.sort(key=lambda r: (r[4] == '', r[4] if r[4] != '' else 0))
    out = [header_row] + data_rows

    print(f'  migrating {len(out) - 1} rows  '
          f'(status mapped: {mapped}, fell to Other: {other}, '
          f'skipped {skipped}, sorted by date asc)')

    delete_sheet_if_exists(svc, CS_ID, NEW_SHEET_TITLE)
    row_count = max(len(out) + 100, 2000)
    sheet_id  = add_sheet(svc, CS_ID, NEW_SHEET_TITLE,
                          rows=row_count, cols=len(CS_COLS))
    write_values(svc, CS_ID, NEW_SHEET_TITLE, out)
    # Column widths for CS order:
    #   Product, Platform, name, check_no, date, assigned_to, phone_no,
    #   feedback, status, comment, is_converted?, loan_amount, client_type
    widths = [90, 130, 200, 110, 110, 140, 140, 260, 180, 260, 120, 130, 110]
    style_sheet(svc, CS_ID, sheet_id,
                columns=CS_COLS, status_options=CS_STATUS,
                status_col_idx=8, conv_col_idx=10, date_col_idx=4,
                row_count=row_count, col_widths=widths,
                loan_amount_col_idx=11, client_type_col_idx=12)
    print('  ✓ done')


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# SAFE APPEND-COLUMNS mode (no data deletion)
# ─────────────────────────────────────────────────────────────────────────────
def append_new_columns(svc, file_id, sheet_title, label):
    """Safely append loan_amount + client_type columns to an existing
    MAY 2026 SHEET tab WITHOUT deleting any rows or other columns.

    Steps:
      1. Read the existing header row to find the current column count
      2. If loan_amount / client_type already exist → skip (idempotent)
      3. Append the two headers to the right of the last column
      4. Apply number-format on loan_amount, dropdown + conditional
         formatting on client_type
    """
    print(f'\n── APPEND mode → {label} ───────────────────────────────────')
    sheet_id = get_sheet_id(svc, file_id, sheet_title)
    if sheet_id is None:
        print(f'  ⚠ sheet "{sheet_title}" not found in workbook — skipping')
        return

    # Read header row + row count
    meta = svc.spreadsheets().get(
        spreadsheetId=file_id,
        ranges=[_qrange(sheet_title, 'A1:ZZ1')],
        includeGridData=False,
    ).execute()
    grid = next(s for s in meta['sheets']
                if s['properties']['sheetId'] == sheet_id)
    row_count = grid['properties']['gridProperties'].get('rowCount', 2000)
    col_count = grid['properties']['gridProperties'].get('columnCount', 26)

    header_row = svc.spreadsheets().values().get(
        spreadsheetId=file_id, range=_qrange(sheet_title, '1:1')
    ).execute().get('values', [[]])[0]
    header = [str(h).strip().lower() for h in header_row]
    print(f'  current header ({len(header_row)} cols): {header_row}')

    has_loan  = 'loan_amount' in header
    has_ctype = 'client_type' in header
    if has_loan and has_ctype:
        print('  ✓ both columns already exist — nothing to do (idempotent)')
        return

    # Find the next empty column index (0-based)
    next_col = len(header_row)
    add_cols = []
    if not has_loan:
        add_cols.append(('loan_amount', next_col)); next_col += 1
    if not has_ctype:
        add_cols.append(('client_type', next_col)); next_col += 1

    # Make sure the sheet has enough columns; expand the grid if needed
    needed_cols = next_col
    if needed_cols > col_count:
        print(f'  + expanding grid: {col_count} → {needed_cols} columns')
        svc.spreadsheets().batchUpdate(
            spreadsheetId=file_id,
            body={'requests': [{
                'updateSheetProperties': {
                    'properties': {
                        'sheetId': sheet_id,
                        'gridProperties': {
                            'rowCount':    row_count,
                            'columnCount': needed_cols,
                        },
                    },
                    'fields': 'gridProperties(rowCount,columnCount)',
                }
            }]},
        ).execute()

    # Write the new header values
    for name, ci in add_cols:
        cell_addr = f'{col_letter(ci)}1'
        print(f'  + writing header "{name}" at {cell_addr}')
        svc.spreadsheets().values().update(
            spreadsheetId=file_id,
            range=_qrange(sheet_title, cell_addr),
            valueInputOption='RAW',
            body={'values': [[name]]},
        ).execute()

    # Apply formatting + validation to the new columns
    reqs = []

    # Header style (match the existing dark-blue band)
    for name, ci in add_cols:
        reqs.append({
            'repeatCell': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 0,
                          'endRowIndex': 1,
                          'startColumnIndex': ci, 'endColumnIndex': ci + 1},
                'cell': {'userEnteredFormat': {
                    'backgroundColor': hex_to_rgb('1F3864'),
                    'horizontalAlignment': 'CENTER',
                    'verticalAlignment':   'MIDDLE',
                    'textFormat': {
                        'foregroundColor': hex_to_rgb('FFFFFF'),
                        'fontFamily': FONT, 'fontSize': 11, 'bold': True,
                    },
                }},
                'fields': ('userEnteredFormat(backgroundColor,'
                           'horizontalAlignment,verticalAlignment,textFormat)'),
            }
        })

    # Column widths
    for name, ci in add_cols:
        width = 130 if name == 'loan_amount' else 110
        reqs.append({
            'updateDimensionProperties': {
                'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS',
                          'startIndex': ci, 'endIndex': ci + 1},
                'properties': {'pixelSize': width},
                'fields': 'pixelSize',
            }
        })

    # loan_amount: CLEAR any inherited dropdown first, then number format
    for name, ci in add_cols:
        if name != 'loan_amount':
            continue
        # Strip any data-validation rule that may have been inherited from
        # the adjacent is_converted? column (Google Sheets sometimes extends
        # validation across columns when the original range was wider).
        reqs.append({
            'setDataValidation': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 1,
                          'endRowIndex': row_count,
                          'startColumnIndex': ci, 'endColumnIndex': ci + 1},
                # No 'rule' key → clears all validation on this range.
            }
        })
        reqs.append({
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
        })

    # client_type: dropdown + colour-coded conditional formatting
    for name, ci in add_cols:
        if name != 'client_type':
            continue
        reqs.append({
            'setDataValidation': {
                'range': {'sheetId': sheet_id, 'startRowIndex': 1,
                          'endRowIndex': row_count,
                          'startColumnIndex': ci, 'endColumnIndex': ci + 1},
                'rule': {
                    'condition': {'type': 'ONE_OF_LIST',
                                  'values': [{'userEnteredValue': v}
                                             for v in CLIENT_TYPE]},
                    'showCustomUi': True, 'strict': False,
                    'inputMessage': 'Pick New or Repeat (only for converted sales).',
                },
            }
        })
        ctype_colors = {
            'New':    ('DBEAFE', '1E40AF'),
            'Repeat': ('FEF3C7', '92400E'),
        }
        for value, (bg, fg) in ctype_colors.items():
            reqs.append({
                'addConditionalFormatRule': {
                    'rule': {
                        'ranges': [{'sheetId': sheet_id, 'startRowIndex': 1,
                                    'endRowIndex': row_count,
                                    'startColumnIndex': ci,
                                    'endColumnIndex': ci + 1}],
                        'booleanRule': {
                            'condition': {'type': 'TEXT_EQ',
                                          'values': [{'userEnteredValue': value}]},
                            'format': {
                                'backgroundColor': hex_to_rgb(bg),
                                'textFormat': {
                                    'bold': True,
                                    'foregroundColor': hex_to_rgb(fg),
                                },
                            },
                        },
                    },
                    'index': 0,
                }
            })

    if reqs:
        svc.spreadsheets().batchUpdate(
            spreadsheetId=file_id, body={'requests': reqs}
        ).execute()
    print(f'  ✓ appended {len(add_cols)} column(s) to "{sheet_title}"')


# ─────────────────────────────────────────────────────────────────────────────
# Interactive menu
# ─────────────────────────────────────────────────────────────────────────────
def _prompt(question, options):
    """Show numbered options, return the chosen value. Keeps asking
    until a valid number is typed."""
    print('\n' + question)
    for k, (label, _) in options.items():
        print(f'  [{k}] {label}')
    while True:
        choice = input('> ').strip().lower()
        if choice in options:
            return options[choice][1]
        print('  (invalid choice, try again)')


def run_interactive():
    print('═' * 70)
    print('  PCL Analysis — MAY 2026 SHEET maintenance tool')
    print('═' * 70)

    mode = _prompt(
        'What do you want to do?',
        {
            '1': ('APPEND new columns (loan_amount, client_type) — SAFE, '
                  'keeps all existing data',                              'append'),
            '2': ('REBUILD MAY 2026 SHEET from source tabs — ⚠ DELETES '
                  'all data currently in the tab',                         'rebuild'),
            'q': ('Quit',                                                  'quit'),
        },
    )

    if mode == 'quit':
        print('  exiting — no changes made')
        return

    target = _prompt(
        'Which workbook(s)?',
        {
            '1': ('LBF/SME workbook only', 'lbf'),
            '2': ('CS workbook only',      'cs'),
            '3': ('Both workbooks',        'both'),
            'q': ('Quit',                  'quit'),
        },
    )

    if target == 'quit':
        print('  exiting — no changes made')
        return

    # Final confirmation for the destructive mode
    if mode == 'rebuild':
        print('\n⚠ ⚠ ⚠  DANGER  ⚠ ⚠ ⚠')
        print(f'  This will DELETE the "{NEW_SHEET_TITLE}" tab in the chosen workbook(s)')
        print('  and rebuild it from the source tabs. Any data typed directly into')
        print(f'  "{NEW_SHEET_TITLE}" (not in the source tab) will be LOST.')
        confirm = input('  Type the word REBUILD to proceed: ').strip()
        if confirm != 'REBUILD':
            print('  cancelled — no changes made')
            return

    svc = make_service()

    do_lbf = target in ('lbf', 'both')
    do_cs  = target in ('cs',  'both')

    try:
        if mode == 'append':
            if do_lbf:
                append_new_columns(svc, LBF_SME_ID, NEW_SHEET_TITLE, 'LBF/SME workbook')
            if do_cs:
                append_new_columns(svc, CS_ID, NEW_SHEET_TITLE, 'CS workbook')
        elif mode == 'rebuild':
            if do_lbf:
                migrate_lbf_sme(svc)
            if do_cs:
                migrate_cs(svc)
    except HttpError as e:
        print('\n❌ HTTP error from Google API:', e, file=sys.stderr)
        raise

    print('\n✓ all done')


if __name__ == '__main__':
    run_interactive()
