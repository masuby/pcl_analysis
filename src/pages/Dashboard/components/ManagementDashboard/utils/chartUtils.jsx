// chartUtils.jsx
import React from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

/**
 * Format number with K, M, B suffixes
 */
const formatNumber = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  
  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  
  if (absNum >= 1000000000) {
    return sign + (absNum / 1000000000).toFixed(1) + 'B';
  } else if (absNum >= 1000000) {
    return sign + (absNum / 1000000).toFixed(1) + 'M';
  } else if (absNum >= 1000) {
    return sign + (absNum / 1000).toFixed(1) + 'K';
  }
  return sign + absNum.toString();
};

/**
 * Renders a Recharts chart based on the specified type.
 *
 * @param {Object} props
 * @param {'Bar' | 'Line' | 'Area' | 'Pie' | 'Scatter'} props.type - Chart type
 * @param {Array<Object>} props.data - Data array for the chart
 * @param {string} props.xKey - Key for X-axis (e.g., 'xLabel')
 * @param {string} props.yKey - Key for Y-axis / value (e.g., 'Disbursements This Month')
 * @param {string} props.dateKey - Key for date display in tooltip (e.g., 'dateLabel')
 * @param {string} props.columnName - Display name for the column
 * @returns {JSX.Element}
 */
export const renderChart = ({ type = 'Bar', data = [], xKey, yKey, dateKey = 'dateLabel', columnName = '' }) => {
  if (!data.length || !xKey || !yKey) {
    return <div style={{ padding: '1rem', textAlign: 'center', color: '#999' }}>No data available</div>;
  }

  const commonProps = {
    data,
    margin: { top: 10, right: 10, left: 10, bottom: 60 },
  };

  // Format X-axis labels to prevent overlap
  const formatXAxisLabel = (label) => {
    if (!label) return '';
    const str = String(label);
    return str.length > 12 ? str.substring(0, 10) + '...' : str;
  };

  // Format Y-axis labels with K, M, B
  const formatYAxisLabel = (value) => {
    return formatNumber(value);
  };

  // Custom tooltip to show date and value
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const dataPoint = payload[0].payload;
      const displayDate = dataPoint[dateKey] || label;
      // Get the value from the data point using yKey, fallback to payload value
      const value = dataPoint[yKey] !== undefined ? dataPoint[yKey] : payload[0].value;
      const displayColumnName = columnName || yKey;
      
      // Ensure we have a valid numeric value
      const numericValue = typeof value === 'number' && !isNaN(value) ? value : 0;
      
      return (
        <div className="custom-tooltip" style={{
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          border: '1px solid #e1e5e9',
          borderRadius: '6px',
          padding: '10px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          <p style={{ margin: '0 0 5px 0', fontWeight: 600, color: '#2a5298' }}>
            {displayDate}
          </p>
          <p style={{ margin: 0, color: '#666' }}>
            {displayColumnName}: <strong>{numericValue.toLocaleString()}</strong>
          </p>
        </div>
      );
    }
    return null;
  };

  /**
   * Generate color gradient from violet (high value) to red (low value)
   * @param {number} index - Current index (0 = highest value)
   * @param {number} total - Total number of items
   * @returns {string} Hex color code
   */
  const generateGradientColor = (index, total) => {
    if (total === 1) return '#8B5CF6'; // Single item - use violet
    
    // Normalize index to 0-1 range (0 = highest, 1 = lowest)
    const ratio = index / (total - 1);
    
    // Interpolate from violet (#8B5CF6) to red (#EF4444)
    // Violet: RGB(139, 92, 246)
    // Red: RGB(239, 68, 68)
    const r = Math.round(139 + (239 - 139) * ratio);
    const g = Math.round(92 + (68 - 92) * ratio);
    const b = Math.round(246 + (68 - 246) * ratio);
    
    return `rgb(${r}, ${g}, ${b})`;
  };

  // Check if dark mode is active
  const isDarkMode = typeof document !== 'undefined' && (
    document.documentElement.classList.contains('dark-mode') || 
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  
  const axisTickColor = isDarkMode ? '#ffffff' : '#2a5298';
  const legendTextColor = isDarkMode ? '#ffffff' : '#333';

  switch (type) {
    case 'Line':
      return (
        <LineChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#4a5568' : '#e1e5e9'} />
          <XAxis 
            dataKey={xKey} 
            angle={-45}
            textAnchor="end"
            height={80}
            tickFormatter={formatXAxisLabel}
            interval={0}
            tick={{ fill: axisTickColor, fontSize: 9 }}
          />
          <YAxis 
            tickFormatter={formatYAxisLabel}
            tick={{ fill: axisTickColor, fontSize: 9 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ color: legendTextColor }} />
          <Line type="monotone" dataKey={yKey} stroke="#2a5298" strokeWidth={2} dot={{ r: 4 }} />
        </LineChart>
      );

    case 'Area':
      return (
        <AreaChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#4a5568' : '#e1e5e9'} />
          <XAxis 
            dataKey={xKey} 
            angle={-45}
            textAnchor="end"
            height={80}
            tickFormatter={formatXAxisLabel}
            interval={0}
            tick={{ fill: axisTickColor, fontSize: 9 }}
          />
          <YAxis 
            tickFormatter={formatYAxisLabel}
            tick={{ fill: axisTickColor, fontSize: 9 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ color: legendTextColor }} />
          <Area type="monotone" dataKey={yKey} stroke="#2a5298" fill="#2a5298" fillOpacity={0.3} />
        </AreaChart>
      );

    case 'Pie':
      // Sort data by value (descending) to assign colors: highest = violet, lowest = red
      const sortedPieData = [...data].sort((a, b) => {
        const valA = a[yKey] !== undefined ? (typeof a[yKey] === 'number' ? a[yKey] : 0) : 0;
        const valB = b[yKey] !== undefined ? (typeof b[yKey] === 'number' ? b[yKey] : 0) : 0;
        return valB - valA; // Descending order
      });

      // Generate colors for each segment
      const pieColors = sortedPieData.map((_, index) => generateGradientColor(index, sortedPieData.length));

      // Custom legend formatter to show date and value
      const renderLegend = (props) => {
        const { payload } = props;
        return (
          <ul style={{ 
            listStyle: 'none', 
            padding: 0, 
            margin: '20px 0 0 0',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '15px'
          }}>
            {payload.map((entry, index) => {
              const dataPoint = sortedPieData[index];
              const value = dataPoint?.[yKey] || 0;
              const displayDate = dataPoint?.[dateKey] || entry.value || '';
              return (
                <li key={`legend-${index}`} style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px',
                  fontSize: '0.85rem'
                }}>
                  <span style={{
                    display: 'inline-block',
                    width: '14px',
                    height: '14px',
                    backgroundColor: entry.color,
                    borderRadius: '2px'
                  }}></span>
                  <span style={{ color: isDarkMode ? '#ffffff' : '#333' }}>
                    {formatXAxisLabel(displayDate)}: <strong>{formatNumber(value)}</strong>
                  </span>
                </li>
              );
            })}
          </ul>
        );
      };

      return (
        <PieChart>
          <Tooltip content={<CustomTooltip />} />
          <Legend content={renderLegend} />
          <Pie
            data={sortedPieData}
            dataKey={yKey}
            nameKey={dateKey || xKey}
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={false}
          >
            {sortedPieData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={pieColors[index]} />
            ))}
          </Pie>
        </PieChart>
      );

    case 'Scatter':
      return (
        <ScatterChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#4a5568' : '#e1e5e9'} />
          <XAxis 
            dataKey={xKey} 
            angle={-45}
            textAnchor="end"
            height={80}
            tickFormatter={formatXAxisLabel}
            interval={0}
            tick={{ fill: axisTickColor, fontSize: 9 }}
          />
          <YAxis 
            tickFormatter={formatYAxisLabel}
            tick={{ fill: axisTickColor, fontSize: 9 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ color: legendTextColor }} />
          <Scatter dataKey={yKey} fill="#2a5298" />
        </ScatterChart>
      );

    case 'Bar':
    default:
      return (
        <BarChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke={isDarkMode ? '#4a5568' : '#e1e5e9'} />
          <XAxis 
            dataKey={xKey} 
            angle={-45}
            textAnchor="end"
            height={80}
            tickFormatter={formatXAxisLabel}
            interval={0}
            tick={{ fill: axisTickColor, fontSize: 9 }}
          />
          <YAxis 
            tickFormatter={formatYAxisLabel}
            tick={{ fill: axisTickColor, fontSize: 9 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ color: legendTextColor }} />
          <Bar dataKey={yKey} fill="#2a5298" radius={[4, 4, 0, 0]} />
        </BarChart>
      );
  }
};