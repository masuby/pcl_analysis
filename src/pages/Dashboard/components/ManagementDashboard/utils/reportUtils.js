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
        'LBF QUICKCASH'
      ].includes(r.Branch)
    )
    .reduce((sum, r) => sum + (r['Active Reps'] || 0), 0);

export const extractSME = (rows) =>
  rows.find(r => r.Branch === 'SME')?.['Active Reps'] ?? 0;

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
  
  return Array.from(numericKeys).sort();
};
