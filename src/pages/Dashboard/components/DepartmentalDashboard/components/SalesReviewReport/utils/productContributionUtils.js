/**
 * Per-product (per-branch) contribution to total month sales (Disbursements This Month).
 * Uses parsedReports from useManagementData - each report has csBranches, lbfBranches, sme, zanzibar, agrifinance.
 */
import { formatBillions } from '../../../../ManagementDashboard/utils/summaryUtils';

/* Product keys in display order, as the management report names its rows.
 *
 * 'CS - MAINLAND' and 'CS - ZANZIBAR' are what the report calls the two halves
 * of CS since they were split. The old names were 'CS' and 'ZANZIBAR', and
 * while this file still asked for 'CS' the contribution chart showed CS at
 * zero — csBranches['CS'] has been an empty bucket ever since the rename. */
const PRODUCT_KEYS = [
  'CS - MAINLAND',
  'Cs Asset Finance',
  'LBF',
  'IPF',
  'MIF',
  'MIF Customs',
  'Lbf Yard Finance',
  'LBF QUICKCASH',
  'LBF-FLEX',
  'SME',
  'CS - ZANZIBAR',
  'AgriFinance'
];

// What a reader should see; the keys above are the report's own spelling.
const PRODUCT_LABELS = {
  'CS - MAINLAND': 'CS Mainland',
  'CS - ZANZIBAR': 'CS Zanzibar',
};
const labelFor = (key) => PRODUCT_LABELS[key] || key;

// Distinct colors for pie and list (one per product)
const PRODUCT_COLORS = [
  '#2a5298', // primary blue
  '#0ea5e9',
  '#8b5cf6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
  '#6366f1',
  '#84cc16',
  '#f97316'
];

/* Disbursement for one product key.
 *
 * Kept in one place because the whole-report and per-section builders below
 * both need it, and when they each carried their own copy of the chain only
 * one of them learnt about Zanzibar. */
function valueForKey(report, key, getVal) {
  if (key === 'CS - ZANZIBAR' || key === 'ZANZIBAR') return getVal(report.zanzibar);
  if (key === 'SME') return getVal(report.sme);
  if (key === 'AgriFinance') return getVal(report.agrifinance);
  if (['LBF', 'IPF', 'MIF', 'MIF Customs', 'Lbf Yard Finance', 'LBF QUICKCASH', 'LBF-FLEX'].includes(key)) {
    return getVal(report.lbfBranches?.[key]);
  }
  return getVal(report.csBranches?.[key]);
}

function getDisbursementFromBranch(branchData) {
  if (!branchData || typeof branchData !== 'object') return 0;
  const v = branchData['Disbursements This Month'] ?? branchData['Disbursement This Month'];
  return Number(v) || 0;
}

/** Short format for table: 5.04 B, 5.04 M, 1.2 K (no "million"/"billion" word, no TZS in cell) */
function formatShort(num) {
  if (num == null || isNaN(num)) return 'N/A';
  const n = Number(num);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' K';
  return String(Math.round(n));
}

/**
 * Get the report for the selected month (YYYY-MM). If multiple reports in that month, use the latest (max date).
 */
export function getReportForMonth(parsedReports, selectedMonth) {
  if (!parsedReports || parsedReports.length === 0) return null;
  const [year, month] = selectedMonth.split('-').map(Number);
  const inMonth = parsedReports.filter((r) => {
    const d = r.date ? (r.date instanceof Date ? r.date : new Date(r.date)) : null;
    if (!d) return false;
    return d.getFullYear() === year && d.getMonth() === month - 1;
  });
  if (inMonth.length === 0) return null;
  inMonth.sort((a, b) => {
    const da = a.date ? (a.date instanceof Date ? a.date : new Date(a.date)) : new Date(0);
    const db = b.date ? (b.date instanceof Date ? b.date : new Date(b.date)) : new Date(0);
    return db - da;
  });
  return inMonth[0];
}

/**
 * Build per-product contribution from a single report.
 * @param {Object} report - parsed report with csBranches, lbfBranches, sme, zanzibar, agrifinance
 * @returns {Array<{ name: string, value: number, percentage: number, color: string, valueFormatted: string }>}
 */
function extractProductsFromReport(report) {
  const products = [];
  const getVal = (branchObj) => getDisbursementFromBranch(branchObj);

  PRODUCT_KEYS.forEach((key, i) => {
    const value = valueForKey(report, key, getVal);
    products.push({
      name: labelFor(key),
      value,
      percentage: 0,
      color: PRODUCT_COLORS[i % PRODUCT_COLORS.length],
      valueFormatted: formatShort(value)
    });
  });

  const sumProducts = products.reduce((sum, p) => sum + p.value, 0);
  products.forEach((p) => {
    p.percentage = sumProducts > 0 ? ((p.value / sumProducts) * 100).toFixed(2) : '0.00';
  });

  return { products, sumProducts };
}

/**
 * Get per-product contribution for the selected month.
 * Total at top = countrywise "Disbursements This Month" (same as Sales and Performance page).
 * productsRanked = products sorted by percentage descending with rank 1, 2, 3...
 * @param {Array} parsedReports - from useManagementData()
 * @param {string} selectedMonth - "YYYY-MM"
 * @returns {Object} { monthLabel, products, productsRanked, totalFormatted }
 */
export function getProductContributionData(parsedReports, selectedMonth) {
  const [y, m] = selectedMonth.split('-').map(Number);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const report = getReportForMonth(parsedReports, selectedMonth);
  if (!report) {
    return {
      monthLabel,
      products: PRODUCT_KEYS.map((name, i) => ({
        name,
        value: 0,
        percentage: '0.00',
        color: PRODUCT_COLORS[i % PRODUCT_COLORS.length],
        valueFormatted: 'N/A'
      })),
      productsRanked: [],
      totalFormatted: 'N/A'
    };
  }

  const countrywiseTotal = Number(report.countrywise?.['Disbursements This Month'] ?? report.countrywise?.['Disbursement This Month']) || 0;
  const totalFormatted = formatBillions(countrywiseTotal);

  const { products } = extractProductsFromReport(report);
  const productsRanked = [...products]
    .sort((a, b) => parseFloat(b.percentage) - parseFloat(a.percentage))
    .map((p, i) => ({ ...p, rank: i + 1 }));

  return { monthLabel, products, productsRanked, totalFormatted };
}

/**
 * Per-product contribution for a section (e.g. CS = 2 products, LBF = 6 products).
 * @param {Array} parsedReports
 * @param {string} selectedMonth - "YYYY-MM"
 * @param {{ productKeys: string[] }} section - from reportSectionConfig (productKeys e.g. ['CS', 'Cs Asset Finance'])
 * @returns {Object|null} same shape as getProductContributionData, or null if no productKeys
 */
export function getProductContributionForSection(parsedReports, selectedMonth, section) {
  const keys = section?.productKeys;
  if (!keys || keys.length === 0) return null;

  const [y, m] = selectedMonth.split('-').map(Number);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const report = getReportForMonth(parsedReports, selectedMonth);
  if (!report) {
    return {
      monthLabel,
      products: keys.map((name, i) => ({
        name: labelFor(name),
        value: 0,
        percentage: '0.00',
        color: PRODUCT_COLORS[i % PRODUCT_COLORS.length],
        valueFormatted: 'N/A'
      })),
      productsRanked: [],
      totalFormatted: 'N/A'
    };
  }

  const getVal = (branchObj) => getDisbursementFromBranch(branchObj);
  const products = keys.map((key, i) => {
    const value = valueForKey(report, key, getVal);
    return {
      name: labelFor(key),
      value,
      percentage: '0',
      color: PRODUCT_COLORS[i % PRODUCT_COLORS.length],
      valueFormatted: formatShort(value)
    };
  });

  const sumProducts = products.reduce((s, p) => s + p.value, 0);
  products.forEach((p) => {
    p.percentage = sumProducts > 0 ? ((p.value / sumProducts) * 100).toFixed(2) : '0.00';
  });

  const totalFormatted = formatBillions(sumProducts);
  const productsRanked = [...products]
    .sort((a, b) => parseFloat(b.percentage) - parseFloat(a.percentage))
    .map((p, i) => ({ ...p, rank: i + 1 }));

  return { monthLabel, products, productsRanked, totalFormatted };
}

export { PRODUCT_COLORS };
