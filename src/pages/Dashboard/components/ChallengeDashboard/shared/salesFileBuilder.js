/**
 * salesFileBuilder
 * ──────────────────────────────────────────────────────────────────────────
 * Rebuilds the Challenge "Sales File" (sales_2026.xlsx) automatically from the
 * MTD reports instead of requiring a manual upload.
 *
 * For every completed calendar month of the current year — January through the
 * last finished month (the current, still-open month is skipped because its MTD
 * is not final yet) — it takes the FINAL last-date MTD of CS, LBF and SME, reads
 * that report's "SALES LISTING" sheet, and maps every row into the 12-column
 * `Sales` layout the challenge processors expect:
 *
 *   SALES REP. | Full Name | Term | Contract Number | Day of Month | Month |
 *   Reps Target | Disburse Amount | Status | Branch / TL | Supervision / Region | Product
 *
 * Rules (confirmed with product owner):
 *   • Reps Target  → CS = 3,000,000 ; LBF & SME = 8,500,000
 *   • Product      → the source department (CS / LBF / SME)
 *   • Month        → the source report's month name (January, February, …)
 *   • The existing file's `Target` sheet is PRESERVED untouched (MTD data can't
 *     reproduce the per-TL/region targets the processors rely on).
 *
 * The `Sales` sheet is styled for readability (frozen header + first column,
 * auto-filter, coloured header, per-month banding with separator lines, and
 * colour-coded Product cells). The freshly-built workbook is then uploaded
 * through the normal SALES upload endpoint, replacing the active Sales file.
 */

import XLSXStyle from 'xlsx-js-style';
import { getReportsByDepartmentAndType } from '../../../../../services/reports';
import { getReportFileUrl } from '../../../../../services/supabase';
import { localTripAPI, lbfCallCenterAPI } from '../../../../../services/api';
import { injectFreezePanes } from '../../DepartmentalDashboard/utils/excelFreezePanes';

const DEPARTMENTS = ['CS', 'LBF', 'SME'];

const REPS_TARGET = { CS: 3_000_000, LBF: 8_500_000, SME: 8_500_000 };

// Per-rep monthly target used to derive the Loan Count / Reps targets on the
// Target sheet: CS = 3,000,000 ; LBF & SME = 8,500,000.
const repRate = (product) => (String(product).toUpperCase() === 'CS' ? 3_000_000 : 8_500_000);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SALES_HEADERS = [
  'SALES REP.', 'Full Name', 'Term', 'Contract Number', 'Day of Month',
  'Month', 'Reps Target', 'Disburse Amount', 'Status',
  'Branch / TL', 'Supervision / Region', 'Product',
];

// Column widths (characters), one per header column.
const COL_WIDTHS = [24, 26, 22, 16, 13, 11, 14, 16, 16, 24, 22, 10];

const up = (v) => String(v ?? '').trim().toUpperCase();
// Matches the challenge processor's target key: trim → collapse spaces → lowercase.
const normKey = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// ── styling palette ───────────────────────────────────────────────────────────
const BORDER_THIN = { style: 'thin', color: { rgb: 'D9DEE7' } };
const BORDER = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
const SEP_TOP = { style: 'medium', color: { rgb: '1E3A8A' } }; // month separator line

const HEADER_STYLE = {
  font: { name: 'Arial', bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDER,
};

// Alternating tint per month block (light zebra by month).
const MONTH_TINT = ['FFFFFF', 'EAF1FB'];

// Product cell colour per department.
const PRODUCT_STYLE = {
  CS:  { bg: 'DBEAFE', fg: '1E40AF' },
  LBF: { bg: 'DCFCE7', fg: '166534' },
  SME: { bg: 'F3E8FF', fg: '7E22CE' },
};

// "Branches Without Target" diagnostic sheet.
const NT_HEADERS = ['Product', 'Branch / TL', 'Supervision / Region', 'Loans', 'Disburse Amount', 'Month Target (from MTD)'];
const NT_COL_WIDTHS = [10, 30, 26, 10, 18, 20];
const NT_HEADER_STYLE = {
  font: { name: 'Arial', bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: 'B45309' } }, // amber → "needs attention"
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDER,
};

// "LBF call center" sheet — monthly targets pulled from the LBF Call Centre
// Performance-Dashboard Google Sheet, matched to the actual sales-rep name.
const CC_HEADERS = ['Actual Name', 'Target Sheet Name', 'Target', 'Month'];
const CC_COL_WIDTHS = [30, 20, 16, 14];
const CC_HEADER_STYLE = {
  font: { name: 'Arial', bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: '166534' } }, // green
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDER,
};

// First name token of a person's name, upper-cased (ignores initials/punctuation).
function firstToken(name) {
  const parts = String(name ?? '').replace(/[^A-Za-z\s.]/g, ' ').split(/[\s.]+/).filter(Boolean);
  return up(parts[0] || '');
}

// Levenshtein distance — tolerates minor spelling drift (Geogina↔Georgina, Hadija↔Khadija).
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

// Resolve a target-sheet name (e.g. "Neema N.") to the actual sales-rep full
// name using first-name matching (exact, then fuzzy ≤2). Returns null if none.
function resolveCcActual(sheetName, repByFirst) {
  const ft = firstToken(sheetName);
  if (!ft) return null;
  if (repByFirst.has(ft)) return repByFirst.get(ft);
  let best = null, bd = 99;
  for (const key of repByFirst.keys()) {
    const dist = editDistance(ft, key);
    if (dist < bd) { bd = dist; best = key; }
  }
  return (best && bd <= 2) ? repByFirst.get(best) : null;
}

// Words that are headers/totals in the Performance-Dashboard layout, not agents.
const CC_STOPWORDS = new Set(['', 'LBF', 'CS', 'TARGET', 'SALES', 'COUNT', 'DEFICIT']);

/**
 * Parse one monthly Performance-Dashboard tab (array-of-arrays) into the LBF
 * agent → target list. LBF target columns are those whose header cell is
 * 'TARGET' with an 'LBF' header immediately to the left; the agent name sits in
 * that left column. Scans every row of those columns (handles the multiple
 * team blocks — ZAITUNI / AZIZA / NGASSA — laid out across the sheet).
 */
function parseCallCenterTab(values) {
  const targetCols = new Set();
  for (const row of values) {
    const len = row?.length || 0;
    for (let c = 1; c < len; c++) {
      if (up(row[c]) === 'TARGET' && up(row[c - 1]).startsWith('LBF')) targetCols.add(c);
    }
  }
  const agents = new Map(); // upper(name) → { name, target }
  for (const c of targetCols) {
    const nameCol = c - 1;
    for (const row of values) {
      const name = String(row?.[nameCol] ?? '').trim();
      if (!name) continue;
      const U = up(name);
      if (CC_STOPWORDS.has(U) || U.includes('TEAM') || U.includes('TOTAL')) continue;
      const t = row?.[c];
      if (typeof t !== 'number' || t <= 0) continue;
      if (!agents.has(U)) agents.set(U, { name, target: t });
    }
  }
  return [...agents.values()];
}

/**
 * Every completed month of the current year, January → last finished month,
 * oldest first. The current (still-open) month is excluded because its MTD is
 * not final yet. e.g. run in July 2026 → Jan…Jun 2026.
 */
function targetMonths(now = new Date()) {
  const year = now.getFullYear();
  const lastCompletedMonth = now.getMonth(); // 0-based current month == count of finished months (Jan..prev)
  const out = [];
  for (let m = 1; m <= lastCompletedMonth; m++) {
    out.push({ year, month: m, name: MONTH_NAMES[m - 1] });
  }
  return out;
}

/** Resolve a department's MTD reports into {id, fileName, fileUrl, date, createdAt}. */
async function loadDeptReports(dept) {
  const res = await getReportsByDepartmentAndType(dept, 'MTD');
  if (!res?.success) return [];
  const out = [];
  for (const report of res.data || []) {
    const fileName = report.fileName || report.file_name || report.title || '';
    if (!up(fileName).includes('MTD')) continue;
    if (!up(fileName).includes(dept.toUpperCase())) continue;

    let fileUrl = report.fileUrl || report.file_url;
    if (!fileUrl && (report.filePath || report.file_path)) {
      try { fileUrl = await getReportFileUrl(report.filePath || report.file_path); }
      catch { continue; }
    }
    if (!fileUrl) continue;

    const date = report.date ? new Date(report.date)
      : report.created_at ? new Date(report.created_at)
      : new Date();
    out.push({ id: report.id, fileName, fileUrl, date, createdAt: report.created_at || report.createdAt || 0 });
  }
  return out;
}

/** Pick the FINAL (latest-date, latest-uploaded) report inside a given month. */
function pickFinalForMonth(reports, year, month) {
  const inMonth = reports.filter((r) => r.date.getFullYear() === year && r.date.getMonth() === month - 1);
  if (!inMonth.length) return null;
  inMonth.sort((a, b) => (b.date - a.date) || (new Date(b.createdAt) - new Date(a.createdAt)));
  return inMonth[0];
}

/**
 * Extract the branch/TL → MONTH TARGET map from an MTD's FIRST sheet.
 * Works for both layouts: CS ("BRANCH/ TEAM LEADER" column + "MONTH TARGET")
 * and LBF (names in column 0, "MONTH TARGET" column). Used to auto-fill targets
 * for Sales branches that are missing from the Target sheet.
 */
function extractFirstSheetTargets(wb) {
  const map = new Map();
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return map;
  const aoa = XLSXStyle.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

  // Header row = first row (scan up to 12) that carries a "MONTH TARGET" column.
  let hi = -1;
  for (let i = 0; i < Math.min(12, aoa.length); i++) {
    if ((aoa[i] || []).some((c) => up(c).includes('MONTH TARGET'))) { hi = i; break; }
  }
  if (hi < 0) return map;

  const H = (aoa[hi] || []).map(up);
  let tgtCol = H.findIndex((h) => h.includes('MONTH TARGET'));
  if (tgtCol < 0) tgtCol = H.findIndex((h) => h === 'TARGET');
  if (tgtCol < 0) return map;
  let brCol = H.findIndex((h) => h.includes('BRANCH') || h.includes('TEAM LEADER'));
  if (brCol < 0) brCol = 0; // LBF: names sit in column 0 with a blank header

  const toNum = (v) => (typeof v === 'number' ? v : parseFloat(String(v ?? '0').replace(/,/g, '')) || 0);
  for (let i = hi + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const name = String(row[brCol] ?? '').trim();
    if (!name) continue;
    const val = toNum(row[tgtCol]);
    if (val <= 0) continue;
    const key = normKey(name);
    if (!map.has(key)) map.set(key, val); // first occurrence within the sheet
  }
  return map;
}

/** Read the "SALES LISTING" sheet of one MTD workbook → normalized row objects. */
function extractListing(wb) {
  // Locate the listing sheet (tolerate the "LISITING" typo seen in LBF files).
  let sheetName = wb.SheetNames.find((n) => {
    const u = up(n);
    return u.includes('LISTING') || u.includes('LISITING');
  });
  if (!sheetName) sheetName = wb.SheetNames[wb.SheetNames.length - 1];

  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const aoa = XLSXStyle.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, cellDates: true });

  // Header row = first row (scan up to 8) that carries the rep-name column.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(8, aoa.length); i++) {
    const row = aoa[i] || [];
    if (row.some((c) => { const u = up(c); return u === 'SALES REP' || u === 'SALES REP. NAME'; })) {
      headerIdx = i;
      break;
    }
  }
  const H = (aoa[headerIdx] || []).map(up);

  const find = (pred) => H.findIndex(pred);
  const idxRep     = find((h) => h === 'SALES REP' || h === 'SALES REP. NAME');
  const idxFull    = find((h) => h === 'FULL NAME');
  const idxTerm    = find((h) => h === 'TERM');
  const idxNumber  = find((h) => h === 'CONTRACT NUMBER' || h === 'ID');
  const idxDay     = find((h) => h.includes('DAY OF MONTH'));
  const idxAmount  = find((h) => h.includes('DISBURSE') && h.includes('AMOUNT'));
  const idxStatus  = find((h) => h === 'STATUS');
  const idxBranch  = find((h) => h === 'BRANCH' || h === 'TEAM'); // CS=Branch, LBF=TEAM, SME=none
  const idxSup     = find((h) => h.includes('SUPERVISION'));

  const at = (row, idx) => (idx >= 0 ? row[idx] : '');
  const toNum = (v) => (typeof v === 'number' ? v : parseFloat(String(v ?? '0').replace(/,/g, '')) || 0);

  const rows = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const rep = String(at(row, idxRep) ?? '').trim();
    if (!rep) continue; // skips blank rows and the pivot table that sits to the right
    rows.push({
      rep,
      fullName:    String(at(row, idxFull) ?? '').trim(),
      term:        String(at(row, idxTerm) ?? '').trim(),
      number:      String(at(row, idxNumber) ?? '').trim(),
      day:         at(row, idxDay),
      amount:      toNum(at(row, idxAmount)),
      status:      String(at(row, idxStatus) ?? '').trim(),
      branch:      String(at(row, idxBranch) ?? '').trim(),
      supervision: String(at(row, idxSup) ?? '').trim(),
    });
  }
  return rows;
}

/** Preserve the `Target` sheet from the currently-active Sales file (if any). */
async function loadExistingTargetSheet(existingFileId) {
  if (!existingFileId) return null;
  try {
    const buf = await localTripAPI.downloadFileBuffer(existingFileId);
    const wb = XLSXStyle.read(buf, { type: 'array' });
    const name = wb.SheetNames.find((n) => up(n) === 'TARGET');
    return name ? wb.Sheets[name] : null;
  } catch {
    return null;
  }
}

/**
 * Read the currently-active Sales file once so `refreshSalesFileFromMTD` can
 * APPEND new months to it instead of rebuilding every month from scratch.
 * Returns the existing Sales rows (as 12-column arrays, in the SALES_HEADERS
 * order), the set of month names already present, and the Target sheet.
 */
async function loadExistingSalesWorkbook(existingFileId) {
  if (!existingFileId) return null;
  try {
    const buf = await localTripAPI.downloadFileBuffer(existingFileId);
    const wb = XLSXStyle.read(buf, { type: 'array', cellDates: true });
    const salesName  = wb.SheetNames.find((n) => up(n) === 'SALES');
    const targetName = wb.SheetNames.find((n) => up(n) === 'TARGET');

    const salesRows = [];
    const presentMonths = new Set();
    if (salesName) {
      // raw:true keeps numbers numeric and dates as serials (preserved verbatim).
      const aoa = XLSXStyle.utils.sheet_to_json(wb.Sheets[salesName], { header: 1, defval: null, raw: true });
      for (let i = 1; i < aoa.length; i++) { // row 0 = header
        const row = aoa[i];
        if (!row || !row.some((c) => c !== null && String(c).trim() !== '')) continue;
        const r12 = row.slice(0, SALES_HEADERS.length);
        salesRows.push(r12);
        const mn = String(r12[5] ?? '').trim();
        if (mn) presentMonths.add(mn);
      }
    }
    return { salesRows, presentMonths, targetSheet: targetName ? wb.Sheets[targetName] : null };
  } catch {
    return null;
  }
}

/** Apply header/zebra/product/border styling, freeze panes and auto-filter. */
function styleSalesSheet(ws, rows) {
  const enc = XLSXStyle.utils.encode_cell;
  const nCols = SALES_HEADERS.length;

  const alignFor = (c) => (c === 6 || c === 7) ? 'right' : (c === 4 || c === 5 || c === 11) ? 'center' : 'left';
  const numFmtFor = (c) => (c === 6 || c === 7) ? '#,##0' : (c === 4 ? 'dd/mm/yyyy' : undefined);

  // Header row
  for (let c = 0; c < nCols; c++) {
    const cell = ws[enc({ r: 0, c })];
    if (cell) cell.s = HEADER_STYLE;
  }

  // Data rows
  let prevMonth = null;
  for (let i = 0; i < rows.length; i++) {
    const r = i + 1;
    const month = rows[i][5];
    const dept = rows[i][11];
    const newMonth = prevMonth !== null && month !== prevMonth;
    prevMonth = month;

    const tint = MONTH_TINT[Math.max(0, MONTH_NAMES.indexOf(month)) % 2];

    for (let c = 0; c < nCols; c++) {
      const cell = ws[enc({ r, c })];
      if (!cell) continue;
      const pal = c === 11 ? PRODUCT_STYLE[dept] : null;
      const numFmt = numFmtFor(c);
      cell.s = {
        font: { name: 'Arial', sz: 9, bold: c === 11, color: { rgb: pal ? pal.fg : '1F2937' } },
        fill: { patternType: 'solid', fgColor: { rgb: pal ? pal.bg : tint } },
        alignment: { horizontal: alignFor(c), vertical: 'center' },
        border: newMonth ? { ...BORDER, top: SEP_TOP } : BORDER,
        ...(numFmt ? { numFmt } : {}),
      };
    }
  }

  ws['!cols'] = COL_WIDTHS.map((w) => ({ wch: w }));
  ws['!rows'] = [{ hpt: 24 }]; // taller header row

  // Auto-filter across the whole table (header + data). This one xlsx-js-style
  // persists natively; the freeze pane is injected into the buffer after write
  // (see refreshSalesFileFromMTD) because the library drops it on write.
  const lastRow = rows.length + 1;
  ws['!autofilter'] = { ref: `A1:${XLSXStyle.utils.encode_col(nCols - 1)}${lastRow}` };

  return ws;
}

/** Set of normalised Branch/TL keys that DO have a (non-zero) target. */
function targetKeySet(targetSheet) {
  const set = new Set();
  if (!targetSheet) return set;
  const aoa = XLSXStyle.utils.sheet_to_json(targetSheet, { header: 1, defval: '' });
  for (const row of aoa) {
    const key = normKey(row[0]);
    if (!key || key === 'branch/tl' || key === 'branch / tl' || key === 'target') continue;
    const raw = row[1];
    const val = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '0').replace(/,/g, '')) || 0;
    if (val === 0) continue; // a 0 target counts as "no target" (same as the processor)
    set.add(key);
  }
  return set;
}

/**
 * Branches present in the Sales sheet whose Branch/TL has no matching target in
 * the Target sheet — aggregated with loan count and disbursed total.
 * (SME rows have a blank Branch/TL and are skipped — SME qualifies by region.)
 */
function buildNoTargetRows(dataRows, tset) {
  const groups = new Map();
  for (const r of dataRows) {
    const branch = String(r[9] ?? '').trim();
    if (!branch) continue;                 // no branch to check (e.g. SME)
    if (tset.has(normKey(branch))) continue; // has a target → fine
    const product = r[11];
    const sup = String(r[10] ?? '').trim();
    const amount = Number(r[7]) || 0;
    const k = `${product}|||${branch}|||${sup}`;
    const g = groups.get(k) || { product, branch, sup, loans: 0, amount: 0 };
    g.loans += 1;
    g.amount += amount;
    groups.set(k, g);
  }
  return [...groups.values()].sort(
    (a, b) => a.product.localeCompare(b.product) || a.branch.localeCompare(b.branch),
  );
}

// Target sheet, extended with rep-count targets.
const TGT_HEADERS = ['Branch/TL', 'Target', 'Loan Count target', 'Active Reps Target', 'Actual Reps Target'];
const TGT_COL_WIDTHS = [30, 18, 16, 16, 16];
const TGT_HEADER_STYLE = {
  font: { name: 'Arial', bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDER,
};

/**
 * Rebuild the Target sheet as a styled 5-column sheet, deriving per row:
 *   Loan Count target  = round(Target / rate)   rate: CS 3M, LBF/SME 8.5M
 *   Active Reps Target = same as Loan Count target
 *   Actual Reps Target = round(Active Reps Target × 1.4)   (active + 40%)
 * Product per Target key comes from the Sales branch/region → product map.
 * Keeps every Branch/TL + Target value (existing + MTD-appended); rows whose
 * product can't be resolved keep blank rep columns.
 *
 * @returns {{ sheet: object, computed: number, unresolved: number }}
 */
function buildTargetSheetWithReps(existingTargetSheet, productByTargetKey) {
  const aoa = XLSXStyle.utils.sheet_to_json(existingTargetSheet, { header: 1, defval: '' });
  const body = [];
  let computed = 0, unresolved = 0;

  for (const row of aoa) {
    const name = String(row[0] ?? '').trim();
    if (!name) continue;
    const k = normKey(name);
    if (k === 'branch/tl' || k === 'branch / tl' || k === 'target') continue; // skip header row(s)

    const raw = row[1];
    const val = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '0').replace(/,/g, '')) || 0;

    let loanCount = '', activeReps = '', actualReps = '';
    if (val > 0) {
      const product = productByTargetKey.get(k);
      if (product) {
        const cnt = Math.round(val / repRate(product));
        loanCount = cnt;
        activeReps = cnt;
        actualReps = Math.round(cnt * 1.4);
        computed++;
      } else {
        unresolved++;
      }
    }
    body.push([name, val, loanCount, activeReps, actualReps]);
  }

  const ws = XLSXStyle.utils.aoa_to_sheet([TGT_HEADERS, ...body]);
  const enc = XLSXStyle.utils.encode_cell;
  const nCols = TGT_HEADERS.length;
  for (let c = 0; c < nCols; c++) {
    const cell = ws[enc({ r: 0, c })];
    if (cell) cell.s = TGT_HEADER_STYLE;
  }
  for (let i = 0; i < body.length; i++) {
    const r = i + 1;
    const tint = MONTH_TINT[i % 2];
    for (let c = 0; c < nCols; c++) {
      const cell = ws[enc({ r, c })];
      if (!cell) continue;
      cell.s = {
        font: { name: 'Arial', sz: 9, bold: c === 0, color: { rgb: '1F2937' } },
        fill: { patternType: 'solid', fgColor: { rgb: tint } },
        alignment: { horizontal: c === 0 ? 'left' : 'right', vertical: 'center' },
        border: BORDER,
        ...(c >= 1 ? { numFmt: '#,##0' } : {}),
      };
    }
  }
  ws['!cols'] = TGT_COL_WIDTHS.map((w) => ({ wch: w }));
  ws['!rows'] = [{ hpt: 24 }];
  ws['!autofilter'] = { ref: `A1:${XLSXStyle.utils.encode_col(nCols - 1)}${body.length + 1}` };
  return { sheet: ws, computed, unresolved };
}

/** Append [Branch/TL, Target] rows to the existing Target worksheet in place. */
function appendTargetRows(ws, entries) {
  if (!ws || !entries.length) return;
  const range = XLSXStyle.utils.decode_range(ws['!ref'] || 'A1');
  let r = range.e.r + 1; // first empty row (0-based)
  for (const { name, target } of entries) {
    ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = { t: 's', v: name };
    ws[XLSXStyle.utils.encode_cell({ r, c: 1 })] = { t: 'n', v: target, z: '#,##0' };
    r++;
  }
  range.s.r = 0; range.s.c = 0;
  range.e.r = r - 1;
  if (range.e.c < 1) range.e.c = 1;
  ws['!ref'] = XLSXStyle.utils.encode_range(range);
}

/** Build the styled "Branches Without Target" worksheet. */
function buildNoTargetSheet(rows) {
  const body = rows.length
    ? rows.map((g) => [g.product, g.branch, g.sup, g.loans, g.amount, g.pulledTarget != null ? g.pulledTarget : 'NOT FOUND'])
    : [['—', 'None — every Sales branch has a matching target ✓', '', 0, 0, '']];

  const ws = XLSXStyle.utils.aoa_to_sheet([NT_HEADERS, ...body]);
  const enc = XLSXStyle.utils.encode_cell;
  const nCols = NT_HEADERS.length;
  const alignFor = (c) => (c === 3 || c === 4) ? 'right' : (c === 0 ? 'center' : 'left');
  const numFmtFor = (c) => (c === 3 || c === 4) ? '#,##0' : undefined;

  for (let c = 0; c < nCols; c++) {
    const cell = ws[enc({ r: 0, c })];
    if (cell) cell.s = NT_HEADER_STYLE;
  }
  for (let i = 0; i < body.length; i++) {
    const r = i + 1;
    const dept = body[i][0];
    const tint = MONTH_TINT[i % 2];
    for (let c = 0; c < nCols; c++) {
      const cell = ws[enc({ r, c })];
      if (!cell) continue;

      // Month Target column: green when auto-filled, red "NOT FOUND" otherwise.
      if (c === 5) {
        const isNum = typeof cell.v === 'number';
        cell.s = {
          font: { name: 'Arial', sz: 9, bold: true, color: { rgb: isNum ? '166534' : 'B91C1C' } },
          fill: { patternType: 'solid', fgColor: { rgb: isNum ? 'DCFCE7' : 'FEE2E2' } },
          alignment: { horizontal: isNum ? 'right' : 'center', vertical: 'center' },
          border: BORDER,
          ...(isNum ? { numFmt: '#,##0' } : {}),
        };
        continue;
      }

      const pal = c === 0 ? PRODUCT_STYLE[dept] : null;
      const numFmt = numFmtFor(c);
      cell.s = {
        font: { name: 'Arial', sz: 9, bold: c === 0, color: { rgb: pal ? pal.fg : '1F2937' } },
        fill: { patternType: 'solid', fgColor: { rgb: pal ? pal.bg : tint } },
        alignment: { horizontal: alignFor(c), vertical: 'center' },
        border: BORDER,
        ...(numFmt ? { numFmt } : {}),
      };
    }
  }
  ws['!cols'] = NT_COL_WIDTHS.map((w) => ({ wch: w }));
  ws['!rows'] = [{ hpt: 24 }];
  ws['!autofilter'] = { ref: `A1:${XLSXStyle.utils.encode_col(nCols - 1)}${body.length + 1}` };
  return ws;
}

/**
 * Fetch the LBF Call Centre monthly targets for the given months and match each
 * to the actual sales-rep name. Returns rows [Actual Name, Target Sheet Name,
 * Target, Month]. Best-effort: returns [] if the backend/sheet is unavailable.
 *
 * @param {Array<{year:number,month:number,name:string}>} months
 * @param {Map<string,string>} ccRepByFirst  firstName → actual full name (from Sales)
 */
async function buildLbfCallCenterRows(months, ccRepByFirst) {
  const monthKeys = months.map((m) => `${m.year}-${String(m.month).padStart(2, '0')}`);
  let resp;
  try {
    resp = await lbfCallCenterAPI.getTargets(monthKeys);
  } catch {
    return [];
  }
  if (!resp?.success || !resp.tabs) return [];

  const rows = [];
  for (const m of months) {
    const key = `${m.year}-${String(m.month).padStart(2, '0')}`;
    const entry = resp.tabs[key];
    if (!entry?.values) continue;
    for (const agent of parseCallCenterTab(entry.values)) {
      const actual = resolveCcActual(agent.name, ccRepByFirst) || agent.name;
      rows.push([actual, agent.name, agent.target, m.name]);
    }
  }
  return rows;
}

/** Build the styled "LBF call center" worksheet from the target rows. */
function buildLbfCallCenterSheet(rows) {
  const body = rows.length ? rows : [['No LBF Call Centre targets found', '', 0, '']];
  const ws = XLSXStyle.utils.aoa_to_sheet([CC_HEADERS, ...body]);
  const enc = XLSXStyle.utils.encode_cell;
  const nCols = CC_HEADERS.length;
  const alignFor = (c) => (c === 2) ? 'right' : (c === 3 ? 'center' : 'left');

  for (let c = 0; c < nCols; c++) {
    const cell = ws[enc({ r: 0, c })];
    if (cell) cell.s = CC_HEADER_STYLE;
  }

  let prevMonth = null;
  for (let i = 0; i < body.length; i++) {
    const r = i + 1;
    const month = body[i][3];
    const newMonth = prevMonth !== null && month !== prevMonth;
    prevMonth = month;
    const tint = MONTH_TINT[Math.max(0, MONTH_NAMES.indexOf(month)) % 2];

    for (let c = 0; c < nCols; c++) {
      const cell = ws[enc({ r, c })];
      if (!cell) continue;
      cell.s = {
        font: { name: 'Arial', sz: 9, bold: c === 0, color: { rgb: '1F2937' } },
        fill: { patternType: 'solid', fgColor: { rgb: tint } },
        alignment: { horizontal: alignFor(c), vertical: 'center' },
        border: newMonth ? { ...BORDER, top: SEP_TOP } : BORDER,
        ...(c === 2 ? { numFmt: '#,##0' } : {}),
      };
    }
  }
  ws['!cols'] = CC_COL_WIDTHS.map((w) => ({ wch: w }));
  ws['!rows'] = [{ hpt: 24 }];
  ws['!autofilter'] = { ref: `A1:${XLSXStyle.utils.encode_col(nCols - 1)}${body.length + 1}` };
  return ws;
}

/**
 * Refresh the active Sales file from MTD data.
 *
 * INCREMENTAL: when an existing Sales file is passed, its earlier months are
 * preserved verbatim (so manual corrections to Jan–July survive) and only the
 * CURRENT calendar month is (re)built from the latest MTDs and appended — plus
 * any completed month that is somehow missing. The file KEEPS ITS NAME. When
 * there is no existing file it falls back to a full build (Jan → last completed
 * month) named `sales_2026.xlsx`.
 *
 * @param {object}   opts
 * @param {string}   [opts.existingFileId]    id of the active Sales file (rows + Target sheet are preserved from it)
 * @param {string}   [opts.existingFileName]  keep this file name on the refreshed upload
 * @param {function} [opts.onProgress]        (message:string) => void  — status updates for a toast/log
 */
export async function refreshSalesFileFromMTD({ existingFileId = null, existingFileName = null, onProgress } = {}) {
  const say = (m) => { try { onProgress?.(m); } catch { /* noop */ } };

  const now = new Date();
  const year = now.getFullYear();
  const curMonthIdx = now.getMonth() + 1;                 // 1-based current calendar month (Aug = 8)

  // Read the existing Sales file so we can append to it rather than rebuild it.
  say('Reading existing Sales file…');
  const existing = existingFileId ? await loadExistingSalesWorkbook(existingFileId) : null;
  const incremental = !!(existing && existing.salesRows.length);

  // Which months to (re)build from the MTDs.
  //  • Incremental: always re-pull the CURRENT month (so it tracks the latest
  //    MTD) plus any completed month missing from the file; every other month
  //    already in the file is kept untouched.
  //  • First build: Jan → last completed month.
  let months;
  if (incremental) {
    months = [];
    for (let m = 1; m <= curMonthIdx; m++) {
      const name = MONTH_NAMES[m - 1];
      if (m === curMonthIdx || !existing.presentMonths.has(name)) {
        months.push({ year, month: m, name });
      }
    }
  } else {
    months = targetMonths(now);
  }
  if (months.length === 0) {
    throw new Error('No months to update — the Sales file is already current.');
  }
  const monthLabel = months.length === 1
    ? `${months[0].name} ${year}`
    : `${months[0].name}–${months[months.length - 1].name} ${year}`;
  say(incremental
    ? `Updating ${monthLabel} from MTD (keeping earlier months)…`
    : `Collecting MTD data for ${monthLabel}…`);

  // Load each department's report list once, up front.
  const deptReports = {};
  for (const dept of DEPARTMENTS) deptReports[dept] = await loadDeptReports(dept);

  const newRows = [];
  const byDept = { CS: 0, LBF: 0, SME: 0 };
  const skipped = [];
  // Branch/TL → MONTH TARGET, accumulated from each processed MTD's first sheet.
  const mtdTargets = { CS: new Map(), LBF: new Map(), SME: new Map() };
  // firstName → actual full name, for LBF reps under CALL CENTER supervision.
  const ccRepByFirst = new Map();

  // Group by MONTH first (so the sheet reads month-by-month, with separators),
  // then by department within each month.
  for (const m of months) {
    for (const dept of DEPARTMENTS) {
      const report = pickFinalForMonth(deptReports[dept], m.year, m.month);
      if (!report) { skipped.push(`${dept} ${m.name}`); continue; }

      say(`Reading ${dept} — ${report.fileName}…`);
      let listing;
      try {
        const resp = await fetch(report.fileUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const wb = XLSXStyle.read(await resp.arrayBuffer(), { type: 'array', cellDates: true });
        listing = extractListing(wb);
        for (const [k, v] of extractFirstSheetTargets(wb)) mtdTargets[dept].set(k, v);
      } catch {
        skipped.push(`${dept} ${m.name} (read failed)`);
        continue;
      }

      for (const r of listing) {
        newRows.push([
          r.rep, r.fullName, r.term, r.number, r.day,
          m.name, REPS_TARGET[dept], r.amount, r.status,
          r.branch, r.supervision, dept,
        ]);
        byDept[dept] += 1;

        // Remember LBF CALL CENTER reps so the target-sheet aliases can be
        // resolved back to their actual names.
        if (dept === 'LBF' && /CALL\s*CENTER/i.test(r.supervision)) {
          const ft = firstToken(r.rep);
          if (ft && !ccRepByFirst.has(ft)) ccRepByFirst.set(ft, r.rep);
        }
      }
    }
  }

  // Keep the existing rows for every month we are NOT reprocessing.
  const processedNames = new Set(months.map((c) => c.name));
  const keptRows = incremental
    ? existing.salesRows.filter((r) => !processedNames.has(String(r[5] ?? '').trim()))
    : [];

  if (newRows.length === 0 && keptRows.length === 0) {
    throw new Error(`No MTD SALES LISTING data found for ${monthLabel}. Make sure the final MTD reports are uploaded.`);
  }

  // Combine kept + new, then order by calendar month so the sheet reads Jan → latest.
  const dataRows = [...keptRows, ...newRows];
  dataRows.sort((a, b) =>
    MONTH_NAMES.indexOf(String(a[5] ?? '').trim()) - MONTH_NAMES.indexOf(String(b[5] ?? '').trim()));

  const monthsCovered = [...new Set(dataRows.map((r) => String(r[5] ?? '').trim()).filter(Boolean))];

  say('Preserving existing Target sheet…');
  const targetSheet = (incremental ? existing.targetSheet : await loadExistingTargetSheet(existingFileId))
    || XLSXStyle.utils.aoa_to_sheet([['Branch/TL', 'Target']]);

  // Branches present in Sales but missing from the Target sheet.
  const noTargetRows = buildNoTargetRows(dataRows, targetKeySet(targetSheet));

  // Auto-fill: for each missing branch, pull its MONTH TARGET from the MTD first
  // sheet and append it to the Target sheet so the processors can read it.
  const appended = new Map(); // normKey → { name, target }
  for (const g of noTargetRows) {
    const t = mtdTargets[g.product]?.get(normKey(g.branch));
    g.pulledTarget = (typeof t === 'number' && t > 0) ? t : null;
    if (g.pulledTarget != null && !appended.has(normKey(g.branch))) {
      appended.set(normKey(g.branch), { name: g.branch, target: g.pulledTarget });
    }
  }
  say(`Filling ${appended.size} target(s) from MTD…`);
  appendTargetRows(targetSheet, [...appended.values()]);
  const targetsFilled = appended.size;
  const stillMissing = noTargetRows.filter((g) => g.pulledTarget == null).length;

  // LBF Call Centre monthly targets (from the Performance-Dashboard Google
  // Sheet), matched to actual rep names. Best-effort — never blocks the refresh.
  say('Reading LBF Call Centre targets…');
  const ccRows = await buildLbfCallCenterRows(months, ccRepByFirst);

  // Override the flat Reps Target with each LBF CALL CENTER rep's actual monthly
  // target, keyed by month + first name (unique within the call-centre teams).
  const ccTargetByMonthRep = new Map();
  for (const [actualName, , target, monthName] of ccRows) {
    if (typeof target === 'number' && target > 0) {
      const key = `${monthName}|${firstToken(actualName)}`;
      if (!ccTargetByMonthRep.has(key)) ccTargetByMonthRep.set(key, target);
    }
  }
  let ccApplied = 0;
  for (const row of newRows) {   // kept rows already carry their call-centre targets
    if (row[11] !== 'LBF' || !/CALL\s*CENTER/i.test(row[10])) continue;
    const t = ccTargetByMonthRep.get(`${row[5]}|${firstToken(row[0])}`);
    if (typeof t === 'number' && t > 0) { row[6] = t; ccApplied++; }
  }
  if (ccApplied) say(`Applied ${ccApplied} LBF Call Centre target(s) to Sales rows…`);

  // Extend the Target sheet with Loan Count / Active Reps / Actual Reps targets,
  // deriving the divisor from each Target key's product (CS 3M, LBF/SME 8.5M).
  const productByTargetKey = new Map();
  for (const row of dataRows) {
    const product = row[11];
    const b = normKey(row[9]);
    const rg = normKey(row[10]);
    if (b && !productByTargetKey.has(b)) productByTargetKey.set(b, product);
    if (rg && !productByTargetKey.has(rg)) productByTargetKey.set(rg, product);
  }
  const { sheet: styledTargetSheet, computed: repTargetsComputed, unresolved: repTargetsUnresolved } =
    buildTargetSheetWithReps(targetSheet, productByTargetKey);
  say(`Derived rep targets for ${repTargetsComputed} branch/region row(s)…`);

  say(`Building workbook (${dataRows.length} rows)…`);
  const wb = XLSXStyle.utils.book_new();
  const salesSheet = XLSXStyle.utils.aoa_to_sheet([SALES_HEADERS, ...dataRows], { cellDates: true });
  styleSalesSheet(salesSheet, dataRows);
  XLSXStyle.utils.book_append_sheet(wb, salesSheet, 'Sales');
  XLSXStyle.utils.book_append_sheet(wb, styledTargetSheet, 'Target');
  XLSXStyle.utils.book_append_sheet(wb, buildNoTargetSheet(noTargetRows), 'Branches Without Target');
  XLSXStyle.utils.book_append_sheet(wb, buildLbfCallCenterSheet(ccRows), 'LBF call center');

  let outBuf = XLSXStyle.write(wb, { bookType: 'xlsx', type: 'array', cellDates: true });
  // xlsx-js-style drops freeze panes on write — inject them into the buffer.
  // Sheet order: [Sales, Target, Branches Without Target, LBF call center];
  // freeze the header row + first column on each.
  outBuf = await injectFreezePanes(outBuf, [
    { freeze: { row: 1, col: 1 } },
    { freeze: { row: 1, col: 1 } },
    { freeze: { row: 1, col: 1 } },
    { freeze: { row: 1, col: 1 } },
  ]);
  const blob = new Blob([outBuf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  // Keep the existing file's name on refresh; only name it sales_2026.xlsx on a first build.
  const outName = (existingFileName && String(existingFileName).trim()) || 'sales_2026.xlsx';
  const file = new File([blob], outName, { type: blob.type });

  say('Uploading refreshed Sales file…');
  const result = await localTripAPI.uploadFile(file, 'SALES');
  if (!result?.success) throw new Error(result?.error || 'Upload failed');

  return {
    record: result.data,
    stats: {
      total: dataRows.length,
      appended: newRows.length,
      kept: keptRows.length,
      incremental,
      monthsLabel: monthLabel,
      months: monthsCovered,
      byDept,
      skipped,
      noTarget: noTargetRows.length,
      targetsFilled,
      stillMissing,
      lbfCallCenter: ccRows.length,
      ccTargetsApplied: ccApplied,
      repTargets: repTargetsComputed,
      repTargetsUnresolved,
    },
  };
}

export default refreshSalesFileFromMTD;
