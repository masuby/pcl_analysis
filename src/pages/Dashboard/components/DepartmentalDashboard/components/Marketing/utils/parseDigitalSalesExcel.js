/**
 * Parser for DIGITAL SALES Excel files.
 *
 * Structure (confirmed against actual files):
 *  Header row: months in cols B–N (row 1 for 2025, row 2 for 2026)
 *  Sections:  DIGITAL > CS (7 rows) > LBF (7 rows) > SME (7 rows) > Total Current
 *             > Historical > CS hist (4 rows) > LBF hist (4 rows)
 *             > Total Historical > TOTAL SALES
 *             > CS / LBF / SME segment totals (current+historical combined)
 *             > MONTH / TARGET / ACTUAL / ACHIEVEMENT block
 *
 * When the 2026 file is uploaded it contains BOTH the 2025 reference sheet AND the 2026
 * active sheet, so both years are returned automatically.
 */

import * as XLSX from 'xlsx';

const MONTH_FULL  = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function safeNum(v) {
  if (v == null || v === '' || v === '-') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  // Handle malformed strings like "70,577.603.59"
  let s = String(v).replace(/,/g, '');
  let firstDot = true;
  s = s.split('').filter(ch => {
    if (ch === '.') { const ok = firstDot; firstDot = false; return ok; }
    return /[\d\-]/.test(ch);
  }).join('');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function findMonthCols(row) {
  const cols = [];
  for (let c = 0; c < (row || []).length; c++) {
    const v = String(row[c] || '').trim().toLowerCase();
    const mi = MONTH_FULL.indexOf(v);
    if (mi >= 0) cols.push({ col: c, monthIndex: mi });
  }
  return cols;
}

function findHeaderRow(raw) {
  for (let r = 0; r <= 4 && r < raw.length; r++) {
    const cols = findMonthCols(raw[r]);
    if (cols.length >= 2) return { rowIdx: r, monthCols: cols };
  }
  return null;
}

function extract(raw, rowIdx, monthCols) {
  if (rowIdx < 0 || rowIdx >= raw.length) return monthCols.map(() => 0);
  const row = raw[rowIdx] || [];
  return monthCols.map(({ col }) => safeNum(row[col]));
}

function labelAt(colA, i) { return colA[i] || ''; }

function findFirst(colA, label, from, to) {
  for (let i = from; i < Math.min(to, colA.length); i++) {
    if (colA[i] === label) return i;
  }
  return -1;
}

function findLast(colA, predicate, from, to) {
  for (let i = Math.min(to, colA.length) - 1; i >= from; i--) {
    if (predicate(colA[i])) return i;
  }
  return -1;
}

function parseSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const header = findHeaderRow(raw);
  if (!header) return null;

  const { rowIdx: hRow, monthCols } = header;
  const colA = raw.map(r => String(r?.[0] || '').trim().toLowerCase());
  const n = colA.length;

  const months      = monthCols.map(({ monthIndex }) => MONTH_FULL[monthIndex]);
  const monthLabels = monthCols.map(({ monthIndex }) => MONTH_SHORT[monthIndex]);

  // ── Historical boundary ──────────────────────────────────────
  const histRow   = findFirst(colA, 'historical', hRow, n);
  const currLimit = histRow > 0 ? histRow : n;

  // ── Current pipeline sections ────────────────────────────────
  const csRow  = findFirst(colA, 'cs',  hRow + 1, currLimit);
  const lbfRow = findFirst(colA, 'lbf', hRow + 1, currLimit);
  const smeRow = findFirst(colA, 'sme', hRow + 1, currLimit);

  const parseCurrent = (sRow) => {
    if (sRow < 0) return null;
    const rate = extract(raw, sRow + 5, monthCols)
      .map(v => v > 0 && v <= 1 ? +(v * 100).toFixed(2) : +v.toFixed(2));
    return {
      totalLeads:     extract(raw, sRow + 1, monthCols),
      leadsContacted: extract(raw, sRow + 2, monthCols),
      viableLeads:    extract(raw, sRow + 3, monthCols),
      convertedLeads: extract(raw, sRow + 4, monthCols),
      conversionRate: rate,
      avgLoanSize:    extract(raw, sRow + 6, monthCols),
      totalSales:     extract(raw, sRow + 7, monthCols),
    };
  };

  const cs  = parseCurrent(csRow);
  const lbf = parseCurrent(lbfRow);
  const sme = parseCurrent(smeRow);

  // ── Historical pipeline sections (fewer metrics) ─────────────
  const parseHist = (sRow) => {
    if (sRow < 0) return null;
    return {
      contacted:      extract(raw, sRow + 1, monthCols),
      convertedLeads: extract(raw, sRow + 2, monthCols),
      avgLoanSize:    extract(raw, sRow + 3, monthCols),
      totalSales:     extract(raw, sRow + 4, monthCols),
    };
  };

  const csHistRow  = histRow > 0 ? findFirst(colA, 'cs',  histRow + 1, n) : -1;
  const lbfHistRow = histRow > 0 ? findFirst(colA, 'lbf', histRow > 0 ? histRow + 1 : 0, n) : -1;

  const csHist  = parseHist(csHistRow);
  const lbfHist = parseHist(lbfHistRow);

  // ── Segment totals (current + historical combined) ────────────
  // Located after TOTAL SALES / TOTAL DIGITAL, scanning backward from end
  const totalSalesRow = findLast(
    colA,
    v => v === 'total sales' || v === 'total digital',
    currLimit, n
  );

  let segCS = [], segLBF = [], segSME = [];
  if (totalSalesRow > 0) {
    let foundCS = false, foundLBF = false, foundSME = false;
    for (let r = totalSalesRow + 1; r < Math.min(totalSalesRow + 12, n); r++) {
      const v = colA[r];
      if (v === 'cs'  && !foundCS)  { segCS  = extract(raw, r, monthCols); foundCS  = true; }
      if (v === 'lbf' && !foundLBF) { segLBF = extract(raw, r, monthCols); foundLBF = true; }
      if (v === 'sme' && !foundSME) { segSME = extract(raw, r, monthCols); foundSME = true; }
      if (foundCS && foundLBF && foundSME) break;
    }
  }

  // Grand total = sum of segments (avoids the malformed string in 2026 grand total row)
  const segGrand = monthCols.map((_, i) =>
    (segCS[i] || 0) + (segLBF[i] || 0) + (segSME[i] || 0)
  );

  // ── TARGET / ACTUAL / ACHIEVEMENT block ──────────────────────
  // Always at the very end — scan last 10 rows
  let targetRow = -1, actualRow = -1, achieveRow = -1;
  for (let r = n - 1; r >= Math.max(0, n - 12); r--) {
    const v = colA[r];
    if (v === 'achievement' && achieveRow < 0) achieveRow = r;
    if (v === 'actual'      && actualRow  < 0) actualRow  = r;
    if (v === 'target'      && targetRow  < 0) targetRow  = r;
  }

  const target = extract(raw, targetRow, monthCols);
  const actual = extract(raw, actualRow, monthCols);
  const achievement = extract(raw, achieveRow, monthCols)
    .map(v => v > 0 && v <= 2 ? Math.round(v * 100) : Math.round(v));

  return { months, monthLabels, cs, lbf, sme, csHist, lbfHist, segCS, segLBF, segSME, segGrand, target, actual, achievement };
}

/**
 * Parse a DIGITAL SALES Excel file uploaded by the user.
 * Returns data for ALL years found in the workbook (e.g. 2026 file has both 2025 & 2026 sheets).
 *
 * @param {File} file
 * @returns {Promise<{ years: Record<number, YearData>, fileName: string, parseError: string|null }>}
 */
export async function parseDigitalSalesExcel(file) {
  try {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });

    const result = { years: {}, fileName: file.name, parseError: null };

    for (const sname of wb.SheetNames) {
      if (!sname.toUpperCase().includes('DIGITAL SALES REPORT')) continue;
      const ym = sname.match(/(\d{4})/);
      if (!ym) continue;
      const year = parseInt(ym[1]);

      const data = parseSheet(wb, sname);
      if (!data || !data.months?.length) continue;

      result.years[year] = { year, sheetName: sname, ...data };
    }

    if (!Object.keys(result.years).length) {
      return { ...result, parseError: 'No "DIGITAL SALES REPORT" sheet found in the file.' };
    }

    return result;
  } catch (e) {
    return { years: {}, fileName: file?.name || '', parseError: `Parse failed: ${e.message}` };
  }
}
