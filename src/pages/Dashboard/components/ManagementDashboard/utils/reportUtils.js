import * as XLSX from 'xlsx';

/**
 * Reads Country sheet and returns row data
 */
export const readCountrySheet = async (fileUrl) => {
  const res = await fetch(fileUrl);
  const arrayBuffer = await res.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  const sheet = workbook.Sheets['Country'];
  if (!sheet) return [];

  return XLSX.utils.sheet_to_json(sheet);
};

/**
 * Section calculators
 */
export const extractCountrywise = (rows) =>
  rows.find(r => r.Branch === 'Country')?.['Active Reps'] ?? 0;

export const extractCS = (rows) =>
  rows
    .filter(r =>
      r.Branch === 'CS' ||
      r.Branch === 'Cs Asset Finance'
    )
    .reduce((sum, r) => sum + (r['Active Reps'] || 0), 0);

export const extractLBF = (rows) =>
  rows
    .filter(r =>
      [
        'LBF',
        'IPF',
        'MIF',
        'MIF Customs',
        'Lbf Yard Finance',
        'LBF QUICKCASH',
        'LBF-FLEX'
      ].includes(r.Branch)
    )
    .reduce((sum, r) => sum + (r['Active Reps'] || 0), 0);

export const extractSME = (rows) =>
  rows.find(r => r.Branch === 'SME')?.['Active Reps'] ?? 0;

/** Management report client metrics - always include when Number of Clients exists */
export const MANAGEMENT_CLIENT_METRICS = [
  'Number of Clients',
  'Active clients',
  'Inactive clients'
];

/**
 * Get numeric value from a data item for a given metric/column name.
 * Handles key variations (case, "Clients" vs "clients") and string numbers.
 */
export const getMetricValue = (item, column) => {
  if (!item || !column) return 0;
  let val = item[column];
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (val !== undefined && val !== null) {
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && isFinite(parsed)) return parsed;
  }
  // Case-insensitive / alias lookup
  const colLower = String(column).toLowerCase();
  for (const [key, value] of Object.entries(item)) {
    if (key === 'date' || key === 'fileName' || key === 'xLabel' || key === 'dateLabel') continue;
    if (String(key).toLowerCase() === colLower) {
      const v = value;
      if (typeof v === 'number' && !isNaN(v)) return v;
      const p = parseFloat(v);
      if (!isNaN(p) && isFinite(p)) return p;
      return 0;
    }
  }
  return 0;
};

const PREFERRED_METRIC_ORDER = [
  'Number of Clients',
  'Active clients',
  'Inactive clients',
  'Disbursements This Month',
  'Active Reps'
];

export const getNumericColumns = (rows) => {
  if (!rows || !rows.length) return [];
  
  // Collect all numeric keys from all rows (not just first row)
  const numericKeys = new Set();
  
  rows.forEach(row => {
    if (row && typeof row === 'object') {
      Object.keys(row).forEach(key => {
        const value = row[key];
        const lower = key.toLowerCase();
        const isDateLike = lower.includes('date') || 
                          lower.includes('time') || 
                          lower.includes('created') || 
                          lower.includes('updated') ||
                          lower.includes('reportid') ||
                          lower.includes('filename') ||
                          lower === 'branch' ||
                          lower === 'rowtype' ||
                          lower === 'parentteamleader' ||
                          lower === 'id';
        
        // Check if value is a number (including 0)
        if (typeof value === 'number' && !isNaN(value) && !isDateLike) {
          numericKeys.add(key);
        }
        // Also check if value is a string that represents a number
        else if (typeof value === 'string' && value.trim() !== '' && !isNaN(parseFloat(value)) && isFinite(value) && !isDateLike) {
          numericKeys.add(key);
        }
      });
    }
  });

  // When we have management client data, ensure all three metrics appear in dropdown
  const hasManagementData = rows.some(r => r && Object.prototype.hasOwnProperty.call(r, 'Number of Clients'));
  if (hasManagementData) {
    MANAGEMENT_CLIENT_METRICS.forEach(m => numericKeys.add(m));
  }
  
  const sorted = Array.from(numericKeys).sort();
  return sorted.sort((a, b) => {
    const idxA = PREFERRED_METRIC_ORDER.indexOf(a);
    const idxB = PREFERRED_METRIC_ORDER.indexOf(b);
    if (idxA >= 0 && idxB >= 0) return idxA - idxB;
    if (idxA >= 0) return -1;
    if (idxB >= 0) return 1;
    return a.localeCompare(b);
  });
};
