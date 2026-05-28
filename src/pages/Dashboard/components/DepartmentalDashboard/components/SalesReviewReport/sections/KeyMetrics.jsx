import './KeyMetrics.css';

const KeyMetrics = ({ data, selectedMonth }) => {
  // Get latest data point for each category
  const getLatestValue = (dataArray, metric) => {
    if (!dataArray || dataArray.length === 0) return 0;
    
    const sorted = [...dataArray].sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateB - dateA;
    });
    
    return sorted[0][metric] || 0;
  };

  // Calculate total disbursements
  const totalDisbursements = 
    getLatestValue(data.countrywiseData, 'Disbursements This Month');

  // Calculate active reps
  const totalActiveReps = 
    getLatestValue(data.countrywiseData, 'Active Reps') ||
    getLatestValue(data.countrywiseData, 'Active clients');

  // Calculate portfolio
  const totalPortfolio = 
    getLatestValue(data.countrywiseData, 'Portfolio') ||
    getLatestValue(data.countrywiseData, 'Total Portfolio');

  // Calculate PAR>30
  const par30 = 
    getLatestValue(data.countrywiseData, 'PAR>30');

  // Calculate number of loans
  const numberOfLoans = 
    getLatestValue(data.countrywiseData, 'Number of loans') ||
    getLatestValue(data.countrywiseData, 'Number of Loans');

  // Calculate new vs repeat business
  const newBusiness = getLatestValue(data.countrywiseData, 'New Business');
  const repeatBusiness = getLatestValue(data.countrywiseData, 'Repeat Business');

  const formatNumber = (num) => {
    if (num === 0 || num === null || num === undefined) return '0';
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(2)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(2)}K`;
    }
    return num.toFixed(0);
  };

  const formatCurrency = (num) => {
    return `TZS ${formatNumber(num)}`;
  };

  const calculatePercentage = (value, total) => {
    if (!total || total === 0) return '0';
    return ((value / total) * 100).toFixed(1);
  };

  const metrics = [
    {
      title: 'Total Disbursements',
      value: formatCurrency(totalDisbursements),
      icon: '💰',
      color: '#22c55e',
      bgColor: '#dcfce7'
    },
    {
      title: 'Active Clients',
      value: formatNumber(totalActiveReps),
      icon: '👥',
      color: '#3b82f6',
      bgColor: '#dbeafe'
    },
    {
      title: 'Portfolio Outstanding',
      value: formatCurrency(totalPortfolio),
      icon: '📊',
      color: '#8b5cf6',
      bgColor: '#ede9fe'
    },
    {
      title: 'Active Loans',
      value: formatNumber(numberOfLoans),
      icon: '📝',
      color: '#f59e0b',
      bgColor: '#fef3c7'
    },
    {
      title: 'PAR > 30 Days',
      value: formatCurrency(par30),
      icon: '⚠️',
      color: '#ef4444',
      bgColor: '#fee2e2'
    },
    {
      title: 'New Business',
      value: formatCurrency(newBusiness),
      subtitle: `${calculatePercentage(newBusiness, totalDisbursements)}% of total`,
      icon: '🆕',
      color: '#06b6d4',
      bgColor: '#cffafe'
    },
    {
      title: 'Repeat Business',
      value: formatCurrency(repeatBusiness),
      subtitle: `${calculatePercentage(repeatBusiness, totalDisbursements)}% of total`,
      icon: '🔄',
      color: '#ec4899',
      bgColor: '#fce7f3'
    },
    {
      title: 'Portfolio Quality',
      value: `${calculatePercentage(par30, totalPortfolio)}%`,
      subtitle: 'PAR ratio',
      icon: '📈',
      color: totalPortfolio > 0 && (par30 / totalPortfolio) < 0.05 ? '#22c55e' : '#ef4444',
      bgColor: totalPortfolio > 0 && (par30 / totalPortfolio) < 0.05 ? '#dcfce7' : '#fee2e2'
    }
  ];

  return (
    <div className="sales-review-section">
      <h3 className="section-title">
        <span>🎯</span>
        Key Performance Metrics
      </h3>
      <div className="key-metrics-grid">
        {metrics.map((metric, index) => (
          <div key={index} className="metric-card" style={{ borderLeftColor: metric.color }}>
            <div className="metric-header">
              <span 
                className="metric-icon" 
                style={{ 
                  backgroundColor: metric.bgColor,
                  color: metric.color 
                }}
              >
                {metric.icon}
              </span>
              <span className="metric-title">{metric.title}</span>
            </div>
            <div className="metric-value" style={{ color: metric.color }}>
              {metric.value}
            </div>
            {metric.subtitle && (
              <div className="metric-subtitle">{metric.subtitle}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default KeyMetrics;
