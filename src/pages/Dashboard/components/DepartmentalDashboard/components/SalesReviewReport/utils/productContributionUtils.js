/**
 * Per-product (per-branch) contribution to total month sales (Disbursements This Month).
 * Uses parsedReports from useManagementData - each report has csBranches, lbfBranches, sme, zanzibar, agrifinance.
 */
import { formatBillions } from '../../../../ManagementDashboard/utils/summaryUtils';

// Product keys in display order (matches ManagementDashboard transform: CS, LBF branches, SME, ZANZIBAR, AgriFinance)
const PRODUCT_KEYS = [
  'CS',
  'Cs Asset Finance',
  'LBF',
  'IPF',
  'MIF',
  'MIF Customs',
  'Lbf Yard Finance',
  'LBF QUICKCASH',
  'LBF-FLEX',
  'SME',
  'ZANZIBAR',
  'AgriFinance'
];

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
    let value = 0;
    if (report.csBranches && (key === 'CS' || key === 'Cs Asset Finance')) {
      value = getVal(report.csBranches[key]);
    } else if (report.lbfBranches && ['LBF', 'IPF', 'MIF', 'MIF Customs', 'Lbf Yard Finance', 'LBF QUICKCASH', 'LBF-FLEX'].includes(key)) {
      value = getVal(report.lbfBranches[key]);
    } else if (key === 'SME' && report.sme) {
      value = getVal(report.sme);
    } else if (key === 'ZANZIBAR' && report.zanzibar) {
      value = getVal(report.zanzibar);
    } else if (key === 'AgriFinance' && report.agrifinance) {
      value = getVal(report.agrifinance);
    }
    products.push({
      name: key,
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

  const getVal = (branchObj) => getDisbursementFromBranch(branchObj);
  const products = keys.map((key, i) => {
    let value = 0;
    if (report.csBranches && (key === 'CS' || key === 'Cs Asset Finance')) {
      value = getVal(report.csBranches[key]);
    } else if (report.lbfBranches && ['LBF', 'IPF', 'MIF', 'MIF Customs', 'Lbf Yard Finance', 'LBF QUICKCASH', 'LBF-FLEX'].includes(key)) {
      value = getVal(report.lbfBranches[key]);
    }
    return {
      name: key,
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
