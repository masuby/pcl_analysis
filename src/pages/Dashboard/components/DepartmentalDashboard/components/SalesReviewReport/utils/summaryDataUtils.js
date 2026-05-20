/**
 * Summary data for "SALES AND PERFORMANCE SUMMARY" and "PERFORMANCE COMPARISON" pages.
 * Uses same data shape as ManagementDashboard countrywise (from getMonthData).
 * Active agents (countrywide headline) match ScoreCard Management Summary: CS+LBF from MTD
 * (same unique-rep-with-Term logic as ManagementSummary.getMTDTotals), SME+Agrifinance from
 * that month’s management report product rows — not countrywise "Active Reps".
 */
import {
  getMonthData,
  formatBillions,
  formatTZS,
  calculatePercentageChange
} from '../../../../ManagementDashboard/utils/summaryUtils';
import { getReportForMonth } from './productContributionUtils';

const numLocal = (v) => {
  if (v == null || v === '' || v === '-') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/,/g, '').replace('%', '').trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * Same as ScoreCard ManagementSummary.getMTDTotals — Active Reps = unique sales reps with Term in MTD listing.
 */
export function getMTDTotalsManagementStyle(parsedData) {
  if (!parsedData) return null;
  const cm = parsedData.columnMap || {};
  const headers = Object.keys((parsedData.listingData || [])[0] || {});
  const termCol = cm.term || headers.find((h) => String(h).toUpperCase() === 'TERM');
  const salesRepCol = cm.salesRep || headers.find((h) => ['SALES REP', 'SALES REP. NAME'].includes(String(h).toUpperCase()));
  const gd = parsedData.groupedData || {};
  const allReps = [];
  Object.values(gd).forEach((sup) => sup.teamLeaders?.forEach((tl) => {
    allReps.push(...(tl.salesReps || []));
  }));
  const activeReps = !salesRepCol ? 0 : new Set(
    allReps
      .filter((rep) => {
        const term = termCol ? (rep[termCol] ?? rep.Term ?? rep.TERM) : null;
        return term != null && String(term).trim() !== '';
      })
      .map((rep) => String(rep[salesRepCol] ?? rep['SALES REP'] ?? rep['SALES REP. NAME'] ?? '').trim())
      .filter(Boolean)
  ).size;
  const gt = parsedData.grandTotalRow || {};
  return {
    disbursement: numLocal(gt.VALUE ?? gt.Value),
    noLoans: numLocal(gt['NO. OF LOANS'] ?? gt['No. of Loans'] ?? gt['No. Of Loans']),
    activeReps
  };
}

function getProductActiveRepsFromReport(report, product) {
  if (!report) return 0;
  const data = product === 'CS'
    ? report.cs
    : product === 'LBF'
      ? report.lbf
      : product === 'SME'
        ? report.sme
        : (report.agrifinance || report.AgriFinance || {});
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return 0;
  return numLocal(data['Active Reps'] ?? data['Active reps']);
}

/**
 * Total Active agents = CS + LBF + SME + Agrifinance, aligned with Management Summary sales grid.
 * @param {(parsedData: object, yyyyMm: string) => boolean} monthMatches - true when MTD file is for that calendar month
 */
export function getMgmtStyleActiveRepsTotal(parsedReports, selectedMonth, mtdCS, mtdLBF, monthMatches) {
  if (!selectedMonth || typeof selectedMonth !== 'string') return 0;
  const report = getReportForMonth(parsedReports, selectedMonth);
  const useCsMtd = mtdCS && monthMatches(mtdCS, selectedMonth);
  const useLbfMtd = mtdLBF && monthMatches(mtdLBF, selectedMonth);
  const cs = useCsMtd ? numLocal(getMTDTotalsManagementStyle(mtdCS)?.activeReps) : getProductActiveRepsFromReport(report, 'CS');
  const lbf = useLbfMtd ? numLocal(getMTDTotalsManagementStyle(mtdLBF)?.activeReps) : getProductActiveRepsFromReport(report, 'LBF');
  const sme = getProductActiveRepsFromReport(report, 'SME');
  const agri = getProductActiveRepsFromReport(report, 'Agrifinance');
  return Math.round(cs + lbf + sme + agri);
}

/**
 * Get summary for a specific month from countrywiseData (array of { date, ...metrics }).
 * @param {Array} countrywiseData - same as ManagementDashboard countrywiseData
 * @param {string} selectedMonth - "YYYY-MM"
 * @returns {Object} summary with raw values and formatted strings for display
 */
export function getSummaryForMonth(countrywiseData, selectedMonth) {
  if (!countrywiseData || countrywiseData.length === 0) {
    return getEmptySummary(selectedMonth);
  }

  const [year, month] = selectedMonth.split('-').map(Number);
  const row = getMonthData(countrywiseData, year, month);
  if (!row) {
    return getEmptySummary(selectedMonth);
  }

  const disbursements = Number(row['Disbursements This Month']) || 0;
  const target = Number(row['Target']) || 0;
  const newBusiness = Number(row['New Business']) || 0;
  const repeatBusiness = Number(row['Repeat Business']) || 0;
  const numberOfLoans = Number(row['Number of loans']) || 0;
  const averageLoanSize = Number(row['Average loan size']) || 0;
  const activeReps = Number(row['Active Reps']) || 0;

  const targetPct = target > 0 ? ((disbursements / target) * 100).toFixed(2) : '0';
  const newPct = disbursements > 0 ? ((newBusiness / disbursements) * 100).toFixed(2) : '0';
  const repeatPct = disbursements > 0 ? ((repeatBusiness / disbursements) * 100).toFixed(2) : '0';

  const monthDate = new Date(year, month - 1, 1);
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return {
    monthLabel,
    disbursements,
    target,
    targetPct,
    newBusiness,
    repeatBusiness,
    newPct,
    repeatPct,
    numberOfLoans,
    averageLoanSize,
    activeReps,
    disbursementsFormatted: formatBillions(disbursements),
    targetFormatted: formatBillions(target),
    newBusinessFormatted: formatBillions(newBusiness),
    repeatBusinessFormatted: formatBillions(repeatBusiness),
    numberOfLoansFormatted: formatTZS(numberOfLoans),
    averageLoanSizeFormatted: formatTZS(averageLoanSize),
    activeRepsFormatted: formatTZS(activeReps)
  };
}

function getEmptySummary(selectedMonth) {
  const [y, m] = selectedMonth.split('-').map(Number);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return {
    monthLabel,
    disbursements: 0,
    target: 0,
    targetPct: '0',
    newBusiness: 0,
    repeatBusiness: 0,
    newPct: '0',
    repeatPct: '0',
    numberOfLoans: 0,
    averageLoanSize: 0,
    activeReps: 0,
    disbursementsFormatted: 'N/A',
    targetFormatted: 'N/A',
    newBusinessFormatted: 'N/A',
    repeatBusinessFormatted: 'N/A',
    numberOfLoansFormatted: 'N/A',
    averageLoanSizeFormatted: 'N/A',
    activeRepsFormatted: 'N/A'
  };
}

/**
 * Build one comparison metric (direction, pct, current/previous formatted).
 */
function comparisonMetric(current, previous, formatFn) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  const pct = prev !== 0 ? calculatePercentageChange(cur, prev) : (cur > 0 ? '100' : '0');
  const dir = parseFloat(pct) >= 0 ? 'increased' : 'decreased';
  const absPct = Math.abs(parseFloat(pct));
  return {
    dir,
    pct: absPct.toFixed(2),
    currentFmt: formatFn(cur),
    prevFmt: formatFn(prev)
  };
}

function getPortfolioValue(row) {
  if (!row) return 0;
  return Number(
    row['Portfolio'] ??
    row['Portifolio'] ??
    row['Outstanding Loan Book'] ??
    row['Outstanding Portfolio'] ??
    row['Loan Book'] ??
    row['Total Portfolio'] ??
    0
  ) || 0;
}

/**
 * Get comparison data for "PERFORMANCE COMPARISON" page: current vs last month, current vs same month last year.
 * @param {Array} countrywiseData
 * @param {string} selectedMonth - "YYYY-MM"
 * @returns {Object} { lastMonthLabel, lastYearLabel, lastMonth, lastYear }
 */
export function getComparisonData(countrywiseData, selectedMonth) {
  if (!countrywiseData || countrywiseData.length === 0) {
    const [y, m] = selectedMonth.split('-').map(Number);
    const lastMonthDate = m > 1 ? new Date(y, m - 2, 1) : new Date(y - 1, 11, 1);
    const lastYearDate = new Date(y - 1, m - 1, 1);
    return {
      lastMonthLabel: lastMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      lastYearLabel: lastYearDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      lastMonth: null,
      lastYear: null
    };
  }

  const [year, month] = selectedMonth.split('-').map(Number);
  const current = getMonthData(countrywiseData, year, month);
  const lastMonthYear = month > 1 ? year : year - 1;
  const lastMonthMonth = month > 1 ? month - 1 : 12;
  const lastMonth = getMonthData(countrywiseData, lastMonthYear, lastMonthMonth);
  const lastYear = getMonthData(countrywiseData, year - 1, month);

  const lastMonthDate = new Date(lastMonthYear, lastMonthMonth - 1, 1);
  const lastYearDate = new Date(year - 1, month - 1, 1);

  const get = (row, key) => (row ? Number(row[key]) || 0 : 0);
  const fmtB = (n) => formatBillions(n);
  const fmtT = (n) => formatTZS(n);

  const build = (currRow, prevRow) => {
    if (!currRow || !prevRow) return null;
    return {
      disbursements: comparisonMetric(get(currRow, 'Disbursements This Month'), get(prevRow, 'Disbursements This Month'), fmtB),
      newBusiness: comparisonMetric(get(currRow, 'New Business'), get(prevRow, 'New Business'), fmtB),
      numberOfLoans: comparisonMetric(get(currRow, 'Number of loans'), get(prevRow, 'Number of loans'), fmtT),
      /** Same compact B/M scale as disbursements — avoids full TZS strings overflowing PPTX / wrapping badly */
      averageLoanSize: comparisonMetric(get(currRow, 'Average loan size'), get(prevRow, 'Average loan size'), fmtB),
      portfolio: comparisonMetric(getPortfolioValue(currRow), getPortfolioValue(prevRow), fmtB),
      activeReps: comparisonMetric(get(currRow, 'Active Reps'), get(prevRow, 'Active Reps'), fmtT)
    };
  };

  return {
    lastMonthLabel: lastMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    lastYearLabel: lastYearDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    lastMonth: build(current, lastMonth),
    lastYear: build(current, lastYear)
  };
}
