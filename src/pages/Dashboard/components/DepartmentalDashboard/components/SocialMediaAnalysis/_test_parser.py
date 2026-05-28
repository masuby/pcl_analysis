"""Smoke-test parse_lbf_date against every distinct value seen in the source."""
import sys, os
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bootstrap_may2026 import parse_lbf_date

samples = [
    '22/05/2026', '11-May-2026', '19 May 2026', '13-May-2026', '21 May 2026',
    '14 May 2026', '11/5/2026', '25/05', '11/05/2026', '13/05/2026',
    '26 May 2026', '25/05/2026', '19/05/2026', '13May2026', '25 May 2026',
    '11 05 2026', '22/5/2026', '25/5/2026', '21/5/2026', '28/05/2026',
    '25-May-2026', '18 May 2026', '18 05 2026', '5/11/2026', '22/05',
    '11/6/2026', '11/7/2026', '11/8/2026', '11/9/2026', '11/10/2026',
    '11/11/2026', '11/02/2026', '05/13/2026', '05/28/2026', '05/26/2026',
    '05/29/2026', '06/02/2026', '11/12/2026', '11/13/2026', '18/05/2026',
    '15 05 2026', '15/05/2026', '30/05/2026', '26/05/2026', '27-May-2026',
    '26-May-2026',
]

print(f'{"input":<22} →  parsed')
print('-' * 50)
fail = 0
for s in samples:
    d = parse_lbf_date(s)
    out = d.strftime('%d/%m/%Y') if d else '— failed'
    if not d: fail += 1
    print(f'{s:<22} →  {out}')
print(f'\nTotal: {len(samples)}, failed: {fail}')
