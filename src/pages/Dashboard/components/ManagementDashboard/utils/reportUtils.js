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
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter(key => {
    const value = rows[0][key];
    const lower = key.toLowerCase();
    const isDateLike = lower.includes('date') || lower.includes('time') || lower.includes('created') || lower.includes('updated');
    return typeof value === 'number' && !isDateLike;
  });
};
