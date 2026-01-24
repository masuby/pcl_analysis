// RegionalAnalysis.jsx - Box-style metrics display
import { useMemo } from 'react';
import { analyzeData, formatNumberCompact } from '../../utils/analysisUtils';
import './RegionalAnalysisSection.css';

const RegionalAnalysis = ({ data, metric, fromDate, toDate }) => {
  const stats = analyzeData(data, metric);
  
  const latestData = useMemo(() => {
    if (!data || data.length === 0) return null;
    const sorted = [...data].sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateB - dateA;
    });
    return sorted[0];
  }, [data]);

  if (!stats || !metric) {
    return (
      <div className="analysis-box-container">
        <h4 className="analysis-title">Analysis</h4>
        <p className="analysis-placeholder">Select a metric to view analysis</p>
      </div>
    );
  }

  const formatNumber = formatNumberCompact;
  const formatDate = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const getTrendIcon = () => { if (!stats.trend) return '➡️'; if (stats.trend === 'up') return '📈'; if (stats.trend === 'down') return '📉'; return '➡️'; };
  const getTrendColor = () => { if (!stats.trend) return '#666'; if (stats.trend === 'up') return '#22c55e'; if (stats.trend === 'down') return '#ef4444'; return '#666'; };
  const getTrendText = () => { if (!stats.trend) return 'No Change'; if (stats.trend === 'up') return 'Increasing'; if (stats.trend === 'down') return 'Decreasing'; return 'Stable'; };

  const getMetricValue = (metricName) => {
    if (!latestData) return null;
    const variations = [metricName, metricName.replace(/ /g, ''), metricName.toLowerCase()];
    for (const name of variations) { if (latestData[name] !== undefined && latestData[name] !== null) return latestData[name]; }
    const keys = Object.keys(latestData);
    for (const key of keys) { if (key.toLowerCase().includes(metricName.toLowerCase().replace(/ /g, ''))) return latestData[key]; }
    return null;
  };

  const metricBoxes = [
    { label: 'Latest Value', value: formatNumber(stats.latest), subtext: stats.latestDate ? formatDate(stats.latestDate) : null, color: '#2a5298', icon: '📊' },
    { label: 'Previous Value', value: formatNumber(stats.previous), subtext: stats.previousDate ? formatDate(stats.previousDate) : null, color: '#666', icon: '📋' },
    { label: 'Trend', value: stats.trendPercentage !== null ? `${stats.trendPercentage > 0 ? '+' : ''}${stats.trendPercentage}%` : 'N/A', subtext: getTrendText(), color: getTrendColor(), icon: getTrendIcon() },
    { label: 'New Business', value: formatNumber(getMetricValue('New Business')), subtext: 'From Excel', color: '#0ea5e9', icon: '🆕' },
    { label: 'Repeat Business', value: formatNumber(getMetricValue('Repeat Business')), subtext: 'From Excel', color: '#8b5cf6', icon: '🔄' },
    { label: 'Number of Loans', value: formatNumber(getMetricValue('Number of loans')), subtext: 'Active Loans', color: '#f59e0b', icon: '📝' },
    { label: 'PAR>30', value: formatNumber(getMetricValue('PAR>30')), subtext: 'Portfolio at Risk', color: '#ef4444', icon: '⚠️' },
    { label: 'Active Reps', value: formatNumber(getMetricValue('Active Reps') || getMetricValue('Active clients')), subtext: 'Current Active', color: '#22c55e', icon: '👥' },
    { label: 'Maximum', value: formatNumber(stats.max), subtext: stats.maxDate ? formatDate(stats.maxDate) : null, color: '#10b981', icon: '📈' },
    { label: 'Minimum', value: formatNumber(stats.min), subtext: stats.minDate ? formatDate(stats.minDate) : null, color: '#f97316', icon: '📉' }
  ];

  return (
    <div className="analysis-box-container">
      <h4 className="analysis-title">📊 Analysis: {metric}</h4>
      <div className="analysis-metrics-grid">
        {metricBoxes.map((box, index) => (
          <div key={index} className="metric-box">
            <div className="metric-box-header">
              <span className="metric-box-icon">{box.icon}</span>
              <span className="metric-box-label">{box.label}</span>
            </div>
            <div className="metric-box-value" style={{ color: box.color }}>{box.value || '—'}</div>
            {box.subtext && <div className="metric-box-subtext">{box.subtext}</div>}
          </div>
        ))}
      </div>
      {stats && fromDate && toDate && (
        <div className="trend-summary">
          <p className="trend-summary-text">
            <strong>{metric}</strong> from {formatDate(fromDate)} to {formatDate(toDate)}: 
            Latest <strong style={{ color: '#2a5298' }}>{formatNumber(stats.latest)}</strong>, 
            showing a <strong style={{ color: getTrendColor() }}>{getTrendText().toLowerCase()}</strong> of{' '}
            <strong style={{ color: getTrendColor() }}>{stats.trendPercentage !== null ? `${stats.trendPercentage > 0 ? '+' : ''}${stats.trendPercentage}%` : 'N/A'}</strong> from previous.
          </p>
        </div>
      )}
    </div>
  );
};

export default RegionalAnalysis;
