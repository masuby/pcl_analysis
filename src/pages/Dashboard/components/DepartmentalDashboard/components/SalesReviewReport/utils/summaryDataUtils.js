/**
 * Summary data for "SALES AND PERFORMANCE SUMMARY" and "PERFORMANCE COMPARISON" pages.
 * Uses same data shape as ManagementDashboard countrywise (from getMonthData).
 */
import {
  getMonthData,
  formatBillions,
  formatTZS,
  calculatePercentageChange
} from '../../../../ManagementDashboard/utils/summaryUtils';

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
      averageLoanSize: comparisonMetric(get(currRow, 'Average loan size'), get(prevRow, 'Average loan size'), (n) => formatTZS(n) + ' TZS'),
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
