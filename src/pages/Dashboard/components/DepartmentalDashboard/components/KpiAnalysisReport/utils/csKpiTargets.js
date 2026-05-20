/**
 * Load and parse CS KPI TARGET.xlsx (4 sheets: KPI, MAINLAND, ZANZIBAR, CALL CENTER).
 * Used for CS KPI Analysis Report dashboard and download.
 */
import * as XLSX from 'xlsx';

async function fetchArrayBufferExpectExcel(url, label) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${label} unavailable (HTTP ${res.status})`);
  }
  const ct = String(res.headers.get('content-type') || '').toLowerCase();
  // When XLSX is missing, dev server commonly falls back to SPA HTML (text/html).
  if (ct.includes('text/html')) {
    throw new Error(`${label} unavailable (received HTML instead of XLSX)`);
  }
  const ab = await res.arrayBuffer();
  // Extra safety: sniff the first bytes for "<html"/"<!DOCTYPE".
  try {
    const head = new TextDecoder('utf-8').decode(new Uint8Array(ab.slice(0, 512)));
    if (/^\s*</.test(head) || /<!doctype\s+html/i.test(head)) {
      throw new Error(`${label} unavailable (received HTML instead of XLSX)`);
    }
  } catch (e) {
    // If sniffing fails, let XLSX parsing decide.
  }
  return ab;
}

/** Public URL for "View KPI" button (opens uploaded KPI target file). */
export const CS_KPI_TARGET_FILE_URL = new URL('../CS KPI TARGET.xlsx', import.meta.url).href;
const TARGET_FILE = CS_KPI_TARGET_FILE_URL;

/** Public URL for cluster KPI target file (used when a cluster is selected). */
export const CS_KPI_CLUSTER_TARGET_FILE_URL = new URL('../CS_KPI_CLUSTER_TARGET_NEW_FILE_2026.xlsx', import.meta.url).href;
const CLUSTER_TARGET_FILE = CS_KPI_CLUSTER_TARGET_FILE_URL;

/**
 * Convert Excel serial (days since 1900-01-01, with 25569 = 1970-01-01) to YYYY-MM in UTC.
 * This is the single source of truth so January row always → "2026-01".
 */
function excelSerialToMonthKey(serial) {
  const n = Math.floor(Number(serial));
  if (!Number.isFinite(n) || n < 1 || n >= 100000) return null;
  const utcMs = (n - 25569) * 86400 * 1000;
  const d = new Date(utcMs);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Parse MONTH cell from CS KPI TARGET.xlsx to YYYY-MM.
 * We read the workbook with cellDates: false so MONTH is an Excel serial; we convert via excelSerialToMonthKey.
 * If the lib ever returns a Date or string, we normalize to the same logic.
 */
function toMonthKey(val) {
  if (val == null || val === '') return null;

  // Excel serial number (we read with cellDates: false so this is the normal case)
  if (typeof val === 'number' && Number.isFinite(val)) {
    return excelSerialToMonthKey(val);
  }

  // Date from another code path: use UTC components to match serial conversion
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  // String that might be a number (e.g. "45658") or date string
  if (typeof val === 'string') {
    const trimmed = val.trim();
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum)) return excelSerialToMonthKey(asNum);
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    }
  }

  return null;
}

function monthNameToMonthOnlyKey(val) {
  if (val == null) return null;
  const t = String(val).trim().toLowerCase();
  const map = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', sept: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12'
  };
  const mm = map[t];
  return mm ? `0000-${mm}` : null;
}

/**
 * Load and parse the target file. Returns:
 * - performanceStandards: string[] (10 items)
 * - mainland: { monthKey: { newBusiness, repeatBusiness, reactivation, total } }
 * - zanzibar: same
 * - callCenter: { monthKey: target }
 */
export async function loadCsKpiTargets(source = TARGET_FILE) {
  let ab;
  if (source instanceof ArrayBuffer) {
    ab = source;
  } else {
    ab = await fetchArrayBufferExpectExcel(source || TARGET_FILE, 'CS KPI target file');
  }
  // Read without cellDates so MONTH column stays as Excel serial; we convert in toMonthKey for correct YYYY-MM
  const wb = XLSX.read(ab, { type: 'array', cellDates: false });

  const out = {
    /** @type {{ name: string, weight: number }[]} */
    performanceStandards: [],
    mainland: {},
    zanzibar: {},
    callCenter: {}
  };

  // Sheet: KPI – PERFORMANCE STANDARDS (col A or "KPI"/"PERFORMANCE STANDARDS") and Weight (col B or "Weight"/"Weight (%)").
  // Weight can be decimal (0.1) or percentage (10) → we store as decimal.
  const kpiSheet = wb.Sheets['KPI'];
  if (kpiSheet) {
    const kpiRows = XLSX.utils.sheet_to_json(kpiSheet, { header: 1, defval: '' });
    const headerRow = kpiRows[0] || [];
    const nameCol = headerRow.findIndex((h) => /performance\s*standards|^kpi$/i.test(String(h || '').trim()));
    const weightCol = headerRow.findIndex((h) => /weight/i.test(String(h || '').trim()));
    const nameIdx = nameCol >= 0 ? nameCol : 0;
    const weightIdx = weightCol >= 0 ? weightCol : 1;
    for (let i = 1; i <= 10 && i < kpiRows.length; i++) {
      const row = kpiRows[i] || [];
      const name = row[nameIdx] != null ? String(row[nameIdx]).trim() : '';
      let weight = Number(row[weightIdx]);
      if (name) {
        // Normalize: if value > 1 assume it's stored as percentage (e.g. 10) → use 0.1
        if (Number.isFinite(weight) && weight > 1) weight = weight / 100;
        else if (!Number.isFinite(weight)) weight = 0;
        out.performanceStandards.push({
          name,
          weight
        });
      }
    }
  }

  // Sheet: MAINLAND – MONTH, NEW BUSINESS TARGET, REPEAT BUSINESS TARGET, REACTIVATION BUSINESS TARGET, TOTAL SALES TARGET
  const mainlandSheet = wb.Sheets['MAINLAND'];
  if (mainlandSheet) {
    const rows = XLSX.utils.sheet_to_json(mainlandSheet, { header: 1, defval: '' });
    const headers = (rows[0] || []).map(h => String(h || '').trim());
    const monthIdx = headers.findIndex(h => h === 'MONTH');
    const newIdx = headers.findIndex(h => h === 'NEW BUSINESS TARGET');
    const repeatIdx = headers.findIndex(h => h === 'REPEAT BUSINESS TARGET');
    const reactIdx = headers.findIndex(h => h === 'REACTIVATION BUSINESS TARGET');
    const totalIdx = headers.findIndex(h => h === 'TOTAL SALES TARGET');
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const monthKey = toMonthKey(row[monthIdx]);
      if (!monthKey) continue;
      out.mainland[monthKey] = {
        newBusiness: Number(row[newIdx]) || 0,
        repeatBusiness: Number(row[repeatIdx]) || 0,
        reactivation: Number(row[reactIdx]) || 0,
        total: Number(row[totalIdx]) || 0
      };
    }
  }

  // Sheet: ZANZIBAR – same structure
  const zanzibarSheet = wb.Sheets['ZANZIBAR'];
  if (zanzibarSheet) {
    const rows = XLSX.utils.sheet_to_json(zanzibarSheet, { header: 1, defval: '' });
    const headers = (rows[0] || []).map(h => String(h || '').trim());
    const monthIdx = headers.findIndex(h => h === 'MONTH');
    const newIdx = headers.findIndex(h => h === 'NEW BUSINESS TARGET');
    const repeatIdx = headers.findIndex(h => h === 'REPEAT BUSINESS TARGET');
    const reactIdx = headers.findIndex(h => h === 'REACTIVATION BUSINESS TARGET');
    const totalIdx = headers.findIndex(h => h === 'TOTAL SALES TARGET');
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const monthKey = toMonthKey(row[monthIdx]);
      if (!monthKey) continue;
      out.zanzibar[monthKey] = {
        newBusiness: Number(row[newIdx]) || 0,
        repeatBusiness: Number(row[repeatIdx]) || 0,
        reactivation: Number(row[reactIdx]) || 0,
        total: Number(row[totalIdx]) || 0
      };
    }
  }

  // Sheet: CALL CENTER – MONTH, TARGET
  const ccSheet = wb.Sheets['CALL CENTER'];
  if (ccSheet) {
    const rows = XLSX.utils.sheet_to_json(ccSheet, { header: 1, defval: '' });
    const headers = (rows[0] || []).map(h => String(h || '').trim());
    const monthIdx = headers.findIndex(h => h === 'MONTH');
    const targetIdx = headers.findIndex(h => h === 'TARGET');
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const monthKey = toMonthKey(row[monthIdx]);
      if (!monthKey) continue;
      out.callCenter[monthKey] = Number(row[targetIdx]) || 0;
    }
  }

  return out;
}

const CLUSTER_SHEET_NAMES = ['Cluster 1', 'Cluster 2', 'Cluster 3', 'Zanzibar'];

/**
 * Load and parse CS_KPI_CLUSTER_TARGET_NEW_FILE_2026.xlsx (KPI sheet + Cluster 1, Cluster 2, Cluster 3, Zanzibar).
 * Returns: { performanceStandards: { name, weight }[], clusters: { [sheetName]: { [monthKey]: { newBusiness, repeatBusiness, total } } } }
 */
export async function loadCsKpiClusterTargets(source = CLUSTER_TARGET_FILE) {
  let ab;
  if (source instanceof ArrayBuffer) {
    ab = source;
  } else {
    ab = await fetchArrayBufferExpectExcel(source || CLUSTER_TARGET_FILE, 'CS cluster KPI target file');
  }
  const wb = XLSX.read(ab, { type: 'array', cellDates: false });

  const out = {
    /** @type {{ name: string, weight: number }[]} */
    performanceStandards: [],
    /** @type {{ [cluster: string]: { [monthKey: string]: { newBusiness: number, repeatBusiness: number, total: number } } }} */
    clusters: {}
  };

  // KPI sheet – same structure as main target file
  const kpiSheet = wb.Sheets['KPI'];
  if (kpiSheet) {
    const kpiRows = XLSX.utils.sheet_to_json(kpiSheet, { header: 1, defval: '' });
    const headerRow = kpiRows[0] || [];
    const nameCol = headerRow.findIndex((h) => /performance\s*standards|^kpi$/i.test(String(h || '').trim()));
    const weightCol = headerRow.findIndex((h) => /weight/i.test(String(h || '').trim()));
    const nameIdx = nameCol >= 0 ? nameCol : 0;
    const weightIdx = weightCol >= 0 ? weightCol : 1;
    for (let i = 1; i < kpiRows.length; i++) {
      const row = kpiRows[i] || [];
      const name = row[nameIdx] != null ? String(row[nameIdx]).trim() : '';
      if (!name || /^\s*total\s*$/i.test(name)) continue; // skip empty and "Total" row
      let weight = Number(row[weightIdx]);
      if (Number.isFinite(weight) && weight > 1) weight = weight / 100;
      else if (!Number.isFinite(weight)) weight = 0;
      out.performanceStandards.push({ name, weight });
    }
  }

  // Each cluster sheet: Month, New Business, Repeat Business, Total Target
  for (const sheetName of CLUSTER_SHEET_NAMES) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) {
      out.clusters[sheetName] = {};
      continue;
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const headers = (rows[0] || []).map((h) => String(h || '').trim());
    const monthIdx = headers.findIndex((h) => /month/i.test(h));
    const newIdx = headers.findIndex((h) => /new\s*business/i.test(h));
    const repeatIdx = headers.findIndex((h) => /repeat\s*business/i.test(h));
    const totalIdx = headers.findIndex((h) => /total\s*target/i.test(h));
    const byMonth = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const monthKey = toMonthKey(row[monthIdx]);
      if (!monthKey) continue;
      byMonth[monthKey] = {
        newBusiness: Number(row[newIdx]) || 0,
        repeatBusiness: Number(row[repeatIdx]) || 0,
        total: Number(row[totalIdx]) || 0
      };
    }
    out.clusters[sheetName] = byMonth;
  }

  return out;
}

/**
 * Parse LBF/SME style KPI target workbook (KPI + TARGET) directly from XLSX bytes.
 * Returns { performanceStandards: [{name,weight}], targetsByMonth: { YYYY-MM|0000-MM: {...cols} } }
 */
export async function loadGenericKpiTargets(source) {
  let ab;
  if (source instanceof ArrayBuffer) {
    ab = source;
  } else {
    ab = await fetchArrayBufferExpectExcel(source, 'KPI target file');
  }
  const wb = XLSX.read(ab, { type: 'array', cellDates: false });
  const out = {
    performanceStandards: [],
    targetsByMonth: {}
  };

  const kpiSheet = wb.Sheets['KPI'];
  if (kpiSheet) {
    const rows = XLSX.utils.sheet_to_json(kpiSheet, { header: 1, defval: '' });
    const header = rows[0] || [];
    const nameIdx = header.findIndex((h) => /performance\s*standards|^kpi$/i.test(String(h || '').trim()));
    const weightIdx = header.findIndex((h) => /weight/i.test(String(h || '').trim()));
    const nI = nameIdx >= 0 ? nameIdx : 0;
    const wI = weightIdx >= 0 ? weightIdx : 1;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = r[nI] != null ? String(r[nI]).trim() : '';
      if (!name) continue;
      let weight = Number(r[wI]);
      if (Number.isFinite(weight) && weight > 1) weight = weight / 100;
      if (!Number.isFinite(weight)) weight = 0;
      out.performanceStandards.push({ name, weight });
    }
  }

  const targetSheet = wb.Sheets['TARGET'];
  if (targetSheet) {
    const rows = XLSX.utils.sheet_to_json(targetSheet, { header: 1, defval: '' });
    const header = (rows[0] || []).map((h) => String(h || '').trim());
    const monthIdx = header.findIndex((h) => /month|period/i.test(h));
    const mI = monthIdx >= 0 ? monthIdx : 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const rawMonth = r[mI];
      let key = toMonthKey(rawMonth);
      if (!key) key = monthNameToMonthOnlyKey(rawMonth);
      if (!key) continue;
      const entry = {};
      header.forEach((h, idx) => {
        if (!h) return;
        if (idx === mI) {
          entry.monthLabel = String(rawMonth ?? '').trim();
          return;
        }
        const n = Number(r[idx]);
        entry[h] = Number.isFinite(n) ? n : r[idx];
      });
      out.targetsByMonth[key] = entry;
    }
  }
  return out;
}

/**
 * Get weight from performanceStandards by matching KPI name (so correct weight is used regardless of row order in file).
 * @param {{ name: string, weight: number }[]} standards
 * @param {'growth'|'regions_clusters'|'crm'|'data_consent'} key
 * @returns {number} weight (decimal, e.g. 0.02 for 2%)
 */
export function getWeightForKpiKey(standards, key) {
  if (!Array.isArray(standards)) return 0;
  const lower = (s) => String(s || '').toLowerCase();
  const match = (name, phrases) => phrases.every((p) => lower(name).includes(p));
  const map = {
    growth: ['growth', 'active client'],
    regions_clusters: ['regions', 'cluster'],
    crm: ['crm', 'proper usage'],
    data_consent: ['data consent', 'consent']
  };
  const phrases = map[key];
  if (!phrases) return 0;
  const found = standards.find((s) => match(s.name, phrases));
  return found && Number.isFinite(found.weight) ? found.weight : 0;
}

/** Comma-separated accounting-style numbers (full value, no K/M/B abbreviation). */
export function formatTzs(num) {
  if (num == null || num === '') return '—';
  const n = typeof num === 'number' ? num : Number(num);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(n);
}

/** Percentage with grouping (e.g. 1,234.56%). */
export function formatPercentAccounting(num, decimals = 2) {
  if (num == null || num === '') return '—';
  const n = Number(num);
  if (!Number.isFinite(n)) return '—';
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(n)}%`;
}
