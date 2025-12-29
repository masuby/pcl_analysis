import { getLatestMonthData, getMonthData, calculatePercentageChange, formatTZS, formatBillions } from '../../utils/summaryUtils';
import './CountrywiseSection.css';

const CountrywiseSummary = ({ allData }) => {
  if (!allData || allData.length === 0) {
    return null;
  }

  // Get latest month data (independent of chart filters)
  const latestMonth = getLatestMonthData(allData);
  if (!latestMonth) {
    return null;
  }

  const latestDate = latestMonth.date instanceof Date ? latestMonth.date : new Date(latestMonth.date);
  const currentYear = latestDate.getFullYear();
  const currentMonth = latestDate.getMonth() + 1;
  const currentMonthName = latestDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Get last month data
  let lastMonthData = null;
  let lastMonthName = '';
  if (currentMonth > 1) {
    lastMonthData = getMonthData(allData, currentYear, currentMonth - 1);
    if (lastMonthData) {
      const lastMonthDate = lastMonthData.date instanceof Date ? lastMonthData.date : new Date(lastMonthData.date);
      lastMonthName = lastMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
  } else {
    lastMonthData = getMonthData(allData, currentYear - 1, 12);
    if (lastMonthData) {
      const lastMonthDate = lastMonthData.date instanceof Date ? lastMonthData.date : new Date(lastMonthData.date);
      lastMonthName = lastMonthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
  }

  // Get last year same month data
  const lastYearData = getMonthData(allData, currentYear - 1, currentMonth);
  const lastYearMonthName = lastYearData ? currentMonthName : '';

  // Extract values from latest month
  const disbursements = latestMonth['Disbursements This Month'] || 0;
  const target = latestMonth['Target'] || 0;
  const newBusiness = latestMonth['New Business'] || 0;
  const repeatBusiness = latestMonth['Repeat Business'] || 0;
  const numberOfLoans = latestMonth['Number of loans'] || 0;
  const averageLoanSize = latestMonth['Average loan size'] || 0;
  const activeReps = latestMonth['Active Reps'] || 0;

  // Calculate percentages
  const targetPercentage = target > 0 ? ((disbursements / target) * 100).toFixed(2) : 0;
  const newBusinessPercentage = disbursements > 0 ? ((newBusiness / disbursements) * 100).toFixed(2) : 0;
  const repeatBusinessPercentage = disbursements > 0 ? ((repeatBusiness / disbursements) * 100).toFixed(2) : 0;

  // Helper function to get change text
  const getChangeText = (current, previous, label) => {
    if (!previous || previous === 0) {
      return current > 0 ? `increased by 100%` : 'no change';
    }
    const change = calculatePercentageChange(current, previous);
    const direction = parseFloat(change) >= 0 ? 'increased' : 'decreased';
    const absChange = Math.abs(parseFloat(change));
    return `${direction} by ${absChange}%`;
  };

  return (
    <div className="summary-section">
      {/* Summary */}
      <div className="summary-block">
        <h5 className="summary-title">Summary</h5>
        <div className="summary-content">
          <p className="summary-text">
            The total amount disbursed in the month of <strong>{currentMonthName}</strong> is{' '}
            <strong>{formatBillions(disbursements)} TZS</strong>, having achieved{' '}
            <strong>{targetPercentage}%</strong> of the total target{' '}
            <strong>{formatBillions(target)} TZS</strong>.
          </p>
          <p className="summary-text">
            Of the total amount disbursed in the month of <strong>{currentMonthName}</strong>,{' '}
            <strong>{formatBillions(newBusiness)} TZS ({newBusinessPercentage}%)</strong> came from new business and{' '}
            <strong>{formatBillions(repeatBusiness)} TZS ({repeatBusinessPercentage}%)</strong> came from repeat business.
          </p>
          <p className="summary-text">
            The total loan counts for the month of <strong>{currentMonthName}</strong> is{' '}
            <strong>{formatTZS(numberOfLoans)}</strong>, making the average loan size be{' '}
            <strong>{formatTZS(averageLoanSize)} TZS</strong>.
          </p>
          <p className="summary-text">
            The total number of Active agents for the month of <strong>{currentMonthName}</strong> stands at{' '}
            <strong>{formatTZS(activeReps)}</strong>.
          </p>
        </div>
      </div>

      <div className="summary-divider" />

      {/* Comparison to Last Month */}
      {lastMonthData && lastMonthName && (
        <>
          <div className="summary-block">
            <h5 className="summary-title">Comparison to Last Month ({lastMonthName})</h5>
            <div className="summary-content">
              <p className="summary-text">
                The total amount disbursed has{' '}
                <strong>{getChangeText(disbursements, lastMonthData['Disbursements This Month'] || 0)}</strong>{' '}
                ({formatBillions(disbursements)} TZS vs {formatBillions(lastMonthData['Disbursements This Month'] || 0)} TZS).
              </p>
              <p className="summary-text">
                The amount disbursed for new business has{' '}
                <strong>{getChangeText(newBusiness, lastMonthData['New Business'] || 0)}</strong>{' '}
                ({formatBillions(newBusiness)} TZS vs {formatBillions(lastMonthData['New Business'] || 0)} TZS).
              </p>
              <p className="summary-text">
                The total loan counts have{' '}
                <strong>{getChangeText(numberOfLoans, lastMonthData['Number of loans'] || 0)}</strong>{' '}
                ({formatTZS(numberOfLoans)} vs {formatTZS(lastMonthData['Number of loans'] || 0)}).
              </p>
              <p className="summary-text">
                The average loan size has{' '}
                <strong>{getChangeText(averageLoanSize, lastMonthData['Average loan size'] || 0)}</strong>{' '}
                ({formatTZS(averageLoanSize)} TZS vs {formatTZS(lastMonthData['Average loan size'] || 0)} TZS).
              </p>
              <p className="summary-text">
                The number of Active agents has{' '}
                <strong>{getChangeText(activeReps, lastMonthData['Active Reps'] || 0)}</strong>{' '}
                ({formatTZS(activeReps)} vs {formatTZS(lastMonthData['Active Reps'] || 0)}).
              </p>
            </div>
          </div>
          <div className="summary-divider" />
        </>
      )}

      {/* Comparison to Last Year */}
      {lastYearData && (
        <div className="summary-block">
          <h5 className="summary-title">Comparison to Last Year ({currentMonthName})</h5>
          <div className="summary-content">
            <p className="summary-text">
              The total amount disbursed has{' '}
              <strong>{getChangeText(disbursements, lastYearData['Disbursements This Month'] || 0)}</strong>{' '}
              ({formatBillions(disbursements)} TZS vs {formatBillions(lastYearData['Disbursements This Month'] || 0)} TZS).
            </p>
            <p className="summary-text">
              The amount disbursed for new business has{' '}
              <strong>{getChangeText(newBusiness, lastYearData['New Business'] || 0)}</strong>{' '}
              ({formatBillions(newBusiness)} TZS vs {formatBillions(lastYearData['New Business'] || 0)} TZS).
            </p>
            <p className="summary-text">
              The total loan counts have{' '}
              <strong>{getChangeText(numberOfLoans, lastYearData['Number of loans'] || 0)}</strong>{' '}
              ({formatTZS(numberOfLoans)} vs {formatTZS(lastYearData['Number of loans'] || 0)}).
            </p>
            <p className="summary-text">
              The average loan size has{' '}
              <strong>{getChangeText(averageLoanSize, lastYearData['Average loan size'] || 0)}</strong>{' '}
              ({formatTZS(averageLoanSize)} TZS vs {formatTZS(lastYearData['Average loan size'] || 0)} TZS).
            </p>
            <p className="summary-text">
              The number of Active agents has{' '}
              <strong>{getChangeText(activeReps, lastYearData['Active Reps'] || 0)}</strong>{' '}
              ({formatTZS(activeReps)} vs {formatTZS(lastYearData['Active Reps'] || 0)}).
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CountrywiseSummary;



