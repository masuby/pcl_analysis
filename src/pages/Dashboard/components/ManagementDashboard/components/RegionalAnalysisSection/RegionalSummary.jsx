import './RegionalAnalysisSection.css';

const RegionalSummary = ({ data, selectedBranch, selectedType, selectedPerson }) => {
  if (!data || data.length === 0) {
    return null;
  }

  // Get the latest data point
  const sortedData = [...data].sort((a, b) => {
    const dateA = a.date instanceof Date ? a.date : new Date(a.date);
    const dateB = b.date instanceof Date ? b.date : new Date(b.date);
    return dateB - dateA;
  });

  const latestData = sortedData[0];
  
  // Get key metrics to display
  const keyMetrics = [
    'Disbursements This Month',
    'Disbursements YTD',
    'Active Reps',
    'O/S Amount',
    'No of A/Cs',
    'Arrears',
    'Total Collection'
  ];

  // Filter metrics that exist in the data
  const availableMetrics = keyMetrics.filter(metric => 
    latestData[metric] !== undefined && latestData[metric] !== null
  );

  // If no key metrics, show first few numeric columns
  if (availableMetrics.length === 0) {
    Object.keys(latestData).forEach(key => {
      if (typeof latestData[key] === 'number' && 
          !['id', 'reportId'].includes(key) &&
          availableMetrics.length < 6) {
        availableMetrics.push(key);
      }
    });
  }

  const formatValue = (value) => {
    if (typeof value !== 'number' || isNaN(value)) return '—';
    
    const absValue = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    
    if (absValue >= 1000000000) {
      return sign + (absValue / 1000000000).toFixed(2) + 'B';
    } else if (absValue >= 1000000) {
      return sign + (absValue / 1000000).toFixed(2) + 'M';
    } else if (absValue >= 1000) {
      return sign + (absValue / 1000).toFixed(2) + 'K';
    }
    return sign + absValue.toLocaleString();
  };

  const formatDate = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  // Build summary title based on selection
  const getSummaryTitle = () => {
    let title = selectedBranch || 'Branch';
    if (selectedType !== 'Total') {
      title += ` - ${selectedType}`;
      if (selectedPerson) {
        title += `: ${selectedPerson}`;
      } else {
        title += ' (All)';
      }
    } else {
      title += ' (Total)';
    }
    return title;
  };

  return (
    <div className="regional-summary">
      <div className="summary-header">
        <h5 className="summary-title">
          📊 Summary: {getSummaryTitle()}
        </h5>
        <span className="summary-date">
          Latest data: {formatDate(latestData.date)}
        </span>
      </div>
      
      <div className="summary-metrics">
        {availableMetrics.slice(0, 6).map(metric => (
          <div key={metric} className="summary-metric">
            <span className="metric-label">{metric}</span>
            <span className="metric-value">{formatValue(latestData[metric])}</span>
          </div>
        ))}
      </div>
      
      <div className="summary-footer">
        <span className="data-count">
          {data.length} data points available
        </span>
      </div>
    </div>
  );
};

export default RegionalSummary;
