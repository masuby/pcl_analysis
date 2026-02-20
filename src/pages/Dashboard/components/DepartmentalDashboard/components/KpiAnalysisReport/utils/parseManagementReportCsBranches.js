/**
 * Parse management report Excel to get CS branch-level Target and Disbursement.
 * CS sheets = all sheets that do NOT start with "LBF", "SME", or are named "Tukuyu".
 * In each CS sheet: find row with "Target" and "Disbursement this Month" as header, next row = data.
 * CS Clusters (Cluster 1, Cluster 2, Cluster 3, ZANZIBAR) are read from the Country sheet Branch column.
 */
import * as XLSX from 'xlsx';

const EXCLUDE_SHEET_PREFIXES = ['LBF', 'SME'];
const EXCLUDE_SHEET_NAMES = ['Tukuyu'];
const SKIP_SHEETS = new Set(['Country', 'KPI', 'Summary', 'Cover', 'Contents'].map(s => s.toLowerCase()));

/** CS cluster names as they appear in the Country sheet Branch column (matched case-insensitively; first occurrence used). */
const CLUSTER_BRANCH_NAMES = ['Cluster 1', 'Cluster 2', 'Cluster 3', 'ZANZIBAR'];

function isCsSheet(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  if (SKIP_SHEETS.has(lower)) return false;
  if (EXCLUDE_SHEET_NAMES.some(s => lower === s.toLowerCase())) return false;
  const upper = trimmed.toUpperCase();
  for (const p of EXCLUDE_SHEET_PREFIXES) {
    if (upper.startsWith(p)) return false;
  }
  return true;
}

/**
 * Find column index (0-based) where header contains the given text (case-insensitive).
 * Normalizes header: trim, collapse spaces. Tries "disbursement this month" and "disbursement".
 */
function findColumnIndex(headers, ...keywords) {
  for (let c = 0; c < headers.length; c++) {
    const h = String(headers[c] ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
    if (!h) continue;
    for (const k of keywords) {
      const kNorm = String(k).trim().replace(/\s+/g, ' ').toLowerCase();
      if (h.includes(kNorm) || kNorm.includes(h)) return c;
    }
  }
  return -1;
}

/** Find header row index (0-based) that contains both Target and Disbursement-like headers; data row = headerRow + 1 */
function findHeaderRow(raw) {
  const maxScan = Math.min(10, raw.length - 1);
  for (let r = 0; r < maxScan; r++) {
    const row = raw[r] || [];
    const headers = row.map(h => String(h ?? '').trim());
    const targetCol = findColumnIndex(headers, 'target');
    const disbursementCol = findColumnIndex(
      headers,
      'disbursement this month',
      'disbursement'
    );
    if (targetCol !== -1 && disbursementCol !== -1) return r;
  }
  return -1;
}

/** Parse cell to number; Excel often exports numbers as strings with commas (e.g. "40,000,000.00") */
function toNumber(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number' && !isNaN(val)) return val;
  const str = String(val).trim().replace(/,/g, '');
  const n = Number(str);
  return Number.isFinite(n) ? n : 0;
}

/** Return true if branch name (trimmed) is one of the CS cluster names (case-insensitive). */
function isClusterBranchName(branchName) {
  if (!branchName || typeof branchName !== 'string') return false;
  const trimmed = String(branchName).trim();
  return CLUSTER_BRANCH_NAMES.some(
    (c) => c.toLowerCase() === trimmed.toLowerCase()
  );
}

/**
 * Find column index (0-based) where header equals exactly "disbursements this month"
 * (case-insensitive, spaces collapsed). Used for Country sheet so we do not match "Buy Off Disbursements".
 */
function findDisbursementsThisMonthColumn(headers) {
  const want = 'disbursements this month';
  for (let c = 0; c < headers.length; c++) {
    const h = String(headers[c] ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
    if (h === want) return c;
  }
  return -1;
}

/**
 * Parse the Country sheet: find Branch, Target, and Disbursements This Month columns;
 * add rows whose Branch is Cluster 1, Cluster 2, Cluster 3, or ZANZIBAR (first occurrence per name)
 * into the clusters array only. Clusters are NOT added to branches so Branch Sales Achievement
 * shows only branches (sheet-based).
 */
function parseCountrySheetClusters(wb, clusters) {
  const countrySheet = wb.SheetNames.find(
    (n) => String(n).trim().toLowerCase() === 'country'
  );
  if (!countrySheet) return;

  const ws = wb.Sheets[countrySheet];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (raw.length < 2) return;

  const headerRow = raw[0] || [];
  const headers = headerRow.map((h) => String(h ?? '').trim());
  const branchCol = findColumnIndex(headers, 'branch');
  const targetCol = findColumnIndex(headers, 'target');
  const disbursementCol = findDisbursementsThisMonthColumn(headers);
  if (branchCol < 0 || targetCol < 0 || disbursementCol < 0) return;

  const seen = new Set();

  for (let r = 1; r < raw.length; r++) {
    const row = raw[r] || [];
    const branchVal = row[branchCol];
    const branchName = (branchVal != null && branchVal !== '')
      ? String(branchVal).trim()
      : '';
    if (!branchName || !isClusterBranchName(branchName)) continue;
    const key = branchName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const target = toNumber(row[targetCol]);
    const disbursement = toNumber(row[disbursementCol]);
    const pct = target > 0 ? (disbursement / target) * 100 : 0;

    clusters.push({
      branch: branchName,
      target,
      disbursement,
      pct
    });
  }
}

/**
 * @param {string} fileUrl - URL to fetch the management report Excel
 * @returns {Promise<{ branches: Array<...>, clusters: Array<...>, totalTarget: number, totalDisbursement: number, achieved100Count: number, notAchieved100Count: number }>}
 * branches = sheet-based only (no clusters). clusters = from Country sheet. Totals are branches-only.
 */
export async function parseManagementReportCsBranches(fileUrl) {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Failed to fetch management report: ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, raw: true });

  const branches = [];
  const totals = {
    totalTarget: 0,
    totalDisbursement: 0,
    achieved100Count: 0,
    notAchieved100Count: 0
  };

  for (const sheetName of wb.SheetNames) {
    if (!isCsSheet(sheetName)) continue;

    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (raw.length < 2) continue;

    const headerRowIdx = findHeaderRow(raw);
    if (headerRowIdx < 0 || headerRowIdx >= raw.length - 1) continue;

    const headerRow = raw[headerRowIdx] || [];
    const dataRow = raw[headerRowIdx + 1] || [];
    const headers = headerRow.map(h => String(h ?? '').trim());

    const targetCol = findColumnIndex(headers, 'target');
    const disbursementCol = findColumnIndex(
      headers,
      'disbursement this month',
      'disbursement'
    );
    if (targetCol === -1 || disbursementCol === -1) continue;

    const targetVal = dataRow[targetCol];
    const target = toNumber(targetVal);
    let disbursement = 0;
    if (targetCol === 2 && dataRow.length > 8) {
      disbursement = toNumber(dataRow[8]);
    }
    if (disbursement === 0) {
      disbursement = toNumber(dataRow[disbursementCol]);
    }
    if (disbursement === 0 && disbursementCol + 1 < dataRow.length) {
      disbursement = toNumber(dataRow[disbursementCol + 1]);
    }
    const pct = target > 0 ? (disbursement / target) * 100 : 0;

    branches.push({
      branch: sheetName.trim(),
      target,
      disbursement,
      pct
    });
    totals.totalTarget += target;
    totals.totalDisbursement += disbursement;
    if (pct >= 100) totals.achieved100Count += 1;
    else totals.notAchieved100Count += 1;
  }

  const clusters = [];
  parseCountrySheetClusters(wb, clusters);

  return {
    branches,
    clusters,
    totalTarget: totals.totalTarget,
    totalDisbursement: totals.totalDisbursement,
    achieved100Count: totals.achieved100Count,
    notAchieved100Count: totals.notAchieved100Count
  };
}
