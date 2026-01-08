import { getLatestMonthData, formatTZS, formatBillions } from '../../utils/summaryUtils';
import './ClusterAnalysisSection.css';

const ClusterSummary = ({ data, selectedType, selectedCluster, selectedZone, selectedBranch }) => {
  if (!data || data.length === 0) {
    return null;
  }

  // Get latest month data (independent of chart filters)
  const latestMonth = getLatestMonthData(data);
  if (!latestMonth) {
    return null;
  }

  const latestDate = latestMonth.date instanceof Date ? latestMonth.date : new Date(latestMonth.date);
  const currentMonthName = latestDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

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
    </div>
  );
};

export default ClusterSummary;

