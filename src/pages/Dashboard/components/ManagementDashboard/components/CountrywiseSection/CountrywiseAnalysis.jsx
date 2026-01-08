// C:\Users\Daniel\Desktop\code\Website\pcl_analysis\src\pages\Dashboard\components\ManagementDashboard\components\CountrywiseSection\CountrywiseAnalysis.jsx
import { analyzeData, formatNumberCompact } from '../../utils/analysisUtils';
import './CountrywiseSection.css';

const CountrywiseAnalysis = ({ data, metric, fromDate, toDate }) => {
  const stats = analyzeData(data, metric);

  if (!stats || !metric) {
    return (
      <div className="analysis-box">
        <h4>Analysis</h4>
        <p className="analysis-placeholder">Select a metric to view analysis</p>
      </div>
    );
  }

  const formatNumber = formatNumberCompact;

  const formatDate = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const formatDateShort = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  const getTrendIcon = () => {
    if (!stats.trend) return '';
    if (stats.trend === 'up') return '📈';
    if (stats.trend === 'down') return '📉';
    return '➡️';
  };

  const getTrendColor = () => {
    if (!stats.trend) return '#666';
    if (stats.trend === 'up') return '#22c55e';
    if (stats.trend === 'down') return '#ef4444';
    return '#666';
  };

  return (
    <div className="analysis-box">
      <h4>Analysis: {metric}</h4>
      
      <div className="analysis-stats">
        <div className="stat-row">
          <span className="stat-label">Latest Value:</span>
          <span className="stat-value-primary">{formatNumber(stats.latest)}</span>
        </div>
        {stats.latestDate && (
          <div className="stat-date">on {formatDate(stats.latestDate)}</div>
        )}

        {stats.previous !== null && (
          <>
            <div className="stat-row">
              <span className="stat-label">Previous Value:</span>
              <span className="stat-value">{formatNumber(stats.previous)}</span>
            </div>
            {stats.previousDate && (
              <div className="stat-date">on {formatDate(stats.previousDate)}</div>
            )}
          </>
        )}

        {stats.trend && (
          <div className="stat-row trend-row">
            <span className="stat-label">Trend:</span>
            <span className="stat-value" style={{ color: getTrendColor() }}>
              {getTrendIcon()} {stats.trendPercentage !== null && `${stats.trendPercentage > 0 ? '+' : ''}${stats.trendPercentage}%`}
            </span>
          </div>
        )}

        <div className="stat-divider" />

        <div className="stat-row">
          <span className="stat-label">Minimum:</span>
          <span className="stat-value">{formatNumber(stats.min)}</span>
        </div>
        {stats.minDate && (
          <div className="stat-date">on {formatDate(stats.minDate)}</div>
        )}

        <div className="stat-row">
          <span className="stat-label">Maximum:</span>
          <span className="stat-value">{formatNumber(stats.max)}</span>
        </div>
        {stats.maxDate && (
          <div className="stat-date">on {formatDate(stats.maxDate)}</div>
        )}

        <div className="stat-row">
          <span className="stat-label">Average:</span>
          <span className="stat-value">{formatNumber(stats.avg)}</span>
        </div>

        <div className="stat-row">
          <span className="stat-label">Median:</span>
          <span className="stat-value">{formatNumber(stats.median)}</span>
        </div>

        <div className="stat-row">
          <span className="stat-label">Range:</span>
          <span className="stat-value">{formatNumber(stats.range)}</span>
        </div>

        <div className="stat-row">
          <span className="stat-label">Data Points:</span>
          <span className="stat-value">{stats.count}</span>
        </div>
      </div>

      {/* Trend Section */}
      {stats && metric && fromDate && toDate && (
        <>
          <div className="trend-divider" />
          <div className="trend-section">
            <h5 className="trend-title">Trend</h5>
            <p className="trend-text">
              From <strong>{formatDateShort(fromDate)}</strong> to <strong>{formatDateShort(toDate)}</strong>, 
              The Latest Amount is <strong>{formatNumber(stats.latest)}</strong> on <strong>{formatDateShort(stats.latestDate)}</strong>, 
              where the maximum was <strong>{formatNumber(stats.max)}</strong> captured on <strong>{formatDateShort(stats.maxDate)}</strong> 
              and the minimum was <strong>{formatNumber(stats.min)}</strong> captured on <strong>{formatDateShort(stats.minDate)}</strong>. 
              This shows an <strong>{stats.trend === 'up' ? 'increase' : stats.trend === 'down' ? 'decrease' : 'no change'}</strong> of{' '}
              <strong>{stats.trendPercentage !== null ? `${stats.trendPercentage > 0 ? '+' : ''}${stats.trendPercentage}%` : 'N/A'}</strong> 
              from the previous Amount (<strong>{formatNumber(stats.previous)}</strong>).
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default CountrywiseAnalysis;