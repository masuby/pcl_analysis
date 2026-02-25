/**
 * Load and parse CS KPI TARGET.xlsx (4 sheets: KPI, MAINLAND, ZANZIBAR, CALL CENTER).
 * Used for CS KPI Analysis Report dashboard and download.
 */
import * as XLSX from 'xlsx';

/** Public URL for "View KPI" button (opens uploaded KPI target file). */
export const CS_KPI_TARGET_FILE_URL = new URL('../CS KPI TARGET.xlsx', import.meta.url).href;
const TARGET_FILE = CS_KPI_TARGET_FILE_URL;

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

/**
 * Load and parse the target file. Returns:
 * - performanceStandards: string[] (10 items)
 * - mainland: { monthKey: { newBusiness, repeatBusiness, reactivation, total } }
 * - zanzibar: same
 * - callCenter: { monthKey: target }
 */
export async function loadCsKpiTargets() {
  const res = await fetch(TARGET_FILE);
  if (!res.ok) throw new Error('Failed to load CS KPI target file');
  const ab = await res.arrayBuffer();
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

export function formatTzs(num) {
  if (num == null || isNaN(num)) return '—';
  const n = Number(num);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' K';
  return n.toLocaleString();
}
