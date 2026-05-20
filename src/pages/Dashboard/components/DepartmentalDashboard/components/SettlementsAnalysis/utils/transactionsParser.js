import * as XLSX from 'xlsx';

/**
 * Parse a Transactions XLSX (or blob) and return normalized row objects.
 *
 * Only four columns are used by Settlements Analysis:
 *   - Creation Date
 *   - Amount
 *   - Branch
 *   - Institution that buys the Loan
 *
 * We resolve the sheet by best-match name: preferred "Transactions", else first non-empty sheet.
 */

const readWorkbookFromAny = async (input) => {
  if (!input) throw new Error('No transactions file provided');
  if (input instanceof ArrayBuffer) {
    return XLSX.read(input, { type: 'array' });
  }
  if (input instanceof Uint8Array) {
    return XLSX.read(input, { type: 'array' });
  }
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    const buf = await input.arrayBuffer();
    return XLSX.read(buf, { type: 'array' });
  }
  if (typeof input === 'string') {
    return XLSX.read(input, { type: 'base64' });
  }
  throw new Error('Unsupported transactions input type');
};

const pickSheet = (wb) => {
  const preferred = wb.SheetNames.find((n) => /transaction/i.test(n));
  return preferred || wb.SheetNames[0];
};

const normalizeKey = (v) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Parse miscellaneous date inputs (Excel serial, ISO string, JS Date) to a JS Date. */
const parseDate = (value) => {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    // Excel serial date: days since 1899-12-30
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = value * 86400000;
    const d = new Date(epoch.getTime() + ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const parseAmount = (value) => {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return value;
  const num = parseFloat(String(value).replace(/,/g, ''));
  return isFinite(num) ? num : 0;
};

export const parseTransactionsWorkbook = async (input, options = {}) => {
  const wb = await readWorkbookFromAny(input);
  const sheetName = pickSheet(wb);
  if (!sheetName) throw new Error('Transactions workbook has no sheets');

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });

  const minDate = options?.minDate ? new Date(options.minDate) : null;
  const maxDate = options?.maxDate ? new Date(options.maxDate) : null;

  const parsed = [];
  for (const row of rows) {
    const keys = Object.keys(row);
    const dateKey = keys.find((k) => normalizeKey(k) === 'creation date');
    const amountKey = keys.find((k) => normalizeKey(k) === 'amount');
    const branchKey = keys.find((k) => normalizeKey(k) === 'branch');
    const instKey = keys.find((k) => {
      const nk = normalizeKey(k);
      return nk === 'institution that buys the loan' || nk.startsWith('institution');
    });

    const creationDate = parseDate(dateKey ? row[dateKey] : null);
    if (!creationDate) continue;
    if (minDate && creationDate < minDate) continue;
    if (maxDate && creationDate > maxDate) continue;

    const amount = parseAmount(amountKey ? row[amountKey] : 0);
    const branch = String((branchKey ? row[branchKey] : '') ?? '').trim();
    const institution = String((instKey ? row[instKey] : '') ?? '').trim();

    parsed.push({
      creationDate,
      amount,
      branch,
      institution,
      monthKey: monthKeyFor(creationDate),
    });
  }

  return { rows: parsed, sheetName };
};

export const monthKeyFor = (date) => {
  if (!(date instanceof Date) || isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
};

export const monthLabelFor = (monthKey) => {
  if (!monthKey) return '';
  const [y, m] = monthKey.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mi = parseInt(m, 10) - 1;
  if (mi < 0 || mi > 11) return monthKey;
  return `${monthNames[mi]} ${y}`;
};
