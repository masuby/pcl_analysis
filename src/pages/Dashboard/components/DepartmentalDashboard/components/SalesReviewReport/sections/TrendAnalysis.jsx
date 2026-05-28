import './TrendAnalysis.css';

const TrendAnalysis = ({ data, selectedMonth }) => {
  // Calculate trends and insights
  const insights = useMemo(() => {
    if (!data.countrywiseData || data.countrywiseData.length < 2) {
      return null;
    }

    const sorted = [...data.countrywiseData].sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateB - dateA;
    });

    const latest = sorted[0];
    const previous = sorted[1];

    const calculateChange = (current, prev, label) => {
      const change = current - prev;
      const percentChange = prev !== 0 ? ((change / prev) * 100).toFixed(1) : 0;
      const isPositive = change >= 0;
      
      return {
        label,
        current,
        previous: prev,
        change,
        percentChange,
        isPositive,
        icon: isPositive ? '📈' : '📉',
        color: isPositive ? '#22c55e' : '#ef4444'
      };
    };

    const disbursements = calculateChange(
      latest['Disbursements This Month'] || 0,
      previous['Disbursements This Month'] || 0,
      'Disbursements'
    );

    const portfolio = calculateChange(
      latest['Portfolio'] || latest['Total Portfolio'] || 0,
      previous['Portfolio'] || previous['Total Portfolio'] || 0,
      'Portfolio'
    );

    const activeReps = calculateChange(
      latest['Active Reps'] || latest['Active clients'] || 0,
      previous['Active Reps'] || previous['Active clients'] || 0,
      'Active Clients'
    );

    const loans = calculateChange(
      latest['Number of loans'] || latest['Number of Loans'] || 0,
      previous['Number of loans'] || previous['Number of Loans'] || 0,
      'Active Loans'
    );

    const par30 = calculateChange(
      latest['PAR>30'] || 0,
      previous['PAR>30'] || 0,
      'PAR > 30'
    );

    const newBusiness = calculateChange(
      latest['New Business'] || 0,
      previous['New Business'] || 0,
      'New Business'
    );

    const repeatBusiness = calculateChange(
      latest['Repeat Business'] || 0,
      previous['Repeat Business'] || 0,
      'Repeat Business'
    );

    return {
      disbursements,
      portfolio,
      activeReps,
      loans,
      par30,
      newBusiness,
      repeatBusiness,
      latestDate: latest.date,
      previousDate: previous.date
    };
  }, [data.countrywiseData]);

  const formatNumber = (num) => {
    if (num === 0 || num === null || num === undefined) return '0';
    if (Math.abs(num) >= 1000000) {
      return `${(num / 1000000).toFixed(2)}M`;
    } else if (Math.abs(num) >= 1000) {
      return `${(num / 1000).toFixed(0)}K`;
    }
    return num.toFixed(0);
  };

  const formatDate = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  if (!insights) {
    return (
      <div className="sales-review-section">
        <h3 className="section-title">
          <span>📊</span>
          Trend Analysis & Insights
        </h3>
        <p className="no-data-message">Insufficient data for trend analysis. Need at least 2 data points.</p>
      </div>
    );
  }

  const trendItems = [
    insights.disbursements,
    insights.portfolio,
    insights.activeReps,
    insights.loans,
    insights.par30,
    insights.newBusiness,
    insights.repeatBusiness
  ];

  return (
    <div className="sales-review-section">
      <h3 className="section-title">
        <span>📊</span>
        Trend Analysis & Insights
      </h3>

      <div className="trend-period-info">
        <p>
          <strong>Comparing:</strong> {formatDate(insights.latestDate)} vs {formatDate(insights.previousDate)}
        </p>
      </div>

      <div className="trends-grid">
        {trendItems.map((trend, index) => (
          <div key={index} className="trend-card">
            <div className="trend-header">
              <span className="trend-icon">{trend.icon}</span>
              <span className="trend-label">{trend.label}</span>
            </div>
            
            <div className="trend-values">
              <div className="trend-value-row">
                <span className="value-label">Current:</span>
                <span className="value-number">{formatNumber(trend.current)}</span>
              </div>
              <div className="trend-value-row">
                <span className="value-label">Previous:</span>
                <span className="value-number">{formatNumber(trend.previous)}</span>
              </div>
            </div>

            <div className="trend-change" style={{ color: trend.color }}>
              <div className="change-row">
                <span className="change-label">Change:</span>
                <span className="change-value">
                  {trend.isPositive ? '+' : ''}{formatNumber(trend.change)}
                </span>
              </div>
              <div className="percentage-badge" style={{ backgroundColor: `${trend.color}20`, color: trend.color }}>
                {trend.isPositive ? '+' : ''}{trend.percentChange}%
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Key Insights Summary */}
      <div className="insights-summary">
        <h4 className="insights-title">Key Insights</h4>
        <ul className="insights-list">
          {insights.disbursements.percentChange > 10 && (
            <li className="insight-item positive">
              <span className="insight-icon">✅</span>
              <strong>Strong Growth:</strong> Disbursements increased by {insights.disbursements.percentChange}%, 
              indicating robust lending activity.
            </li>
          )}
          {insights.disbursements.percentChange < -10 && (
            <li className="insight-item negative">
              <span className="insight-icon">⚠️</span>
              <strong>Decline Alert:</strong> Disbursements decreased by {Math.abs(insights.disbursements.percentChange)}%, 
              requiring attention to lending operations.
            </li>
          )}
          {insights.portfolio.isPositive && (
            <li className="insight-item positive">
              <span className="insight-icon">💼</span>
              <strong>Portfolio Growth:</strong> Portfolio outstanding increased by {insights.portfolio.percentChange}%, 
              showing healthy business expansion.
            </li>
          )}
          {insights.par30.percentChange > 5 && (
            <li className="insight-item warning">
              <span className="insight-icon">⚠️</span>
              <strong>Risk Alert:</strong> PAR > 30 increased by {insights.par30.percentChange}%, 
              portfolio quality requires monitoring.
            </li>
          )}
          {insights.activeReps.isPositive && (
            <li className="insight-item positive">
              <span className="insight-icon">👥</span>
              <strong>Client Base Growth:</strong> Active clients increased by {insights.activeReps.percentChange}%, 
              expanding market reach.
            </li>
          )}
          {insights.newBusiness.current > insights.repeatBusiness.current && (
            <li className="insight-item info">
              <span className="insight-icon">🆕</span>
              <strong>New Business Focus:</strong> New business ({formatNumber(insights.newBusiness.current)}) 
              exceeds repeat business ({formatNumber(insights.repeatBusiness.current)}), indicating strong customer acquisition.
            </li>
          )}
          {insights.repeatBusiness.current > insights.newBusiness.current && (
            <li className="insight-item info">
              <span className="insight-icon">🔄</span>
              <strong>Retention Strength:</strong> Repeat business ({formatNumber(insights.repeatBusiness.current)}) 
              exceeds new business ({formatNumber(insights.newBusiness.current)}), showing good customer loyalty.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default TrendAnalysis;
