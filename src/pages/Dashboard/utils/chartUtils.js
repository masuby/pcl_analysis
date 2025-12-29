/**
 * Chart Configuration Utilities
 * Handles chart configurations and visualizations
 */

/**
 * Get chart colors based on chart type and department
 */
export const getChartColors = (chartType, department = null) => {
  const baseColors = {
    primary: '#2a5298',
    secondary: '#1e3c72',
    success: '#38a169',
    warning: '#d69e2e',
    danger: '#e53e3e',
    info: '#3182ce'
  };
  
  const departmentColors = {
    cs: '#38a169',
    lbf: '#d69e2e',
    sme: '#dd6b20',
    country: '#2a5298',
    default: '#2a5298'
  };
  
  const color = department ? departmentColors[department] || departmentColors.default : baseColors.primary;
  
  switch (chartType) {
    case 'bar':
      return {
        backgroundColor: `${color}CC`,
        borderColor: color,
        hoverBackgroundColor: color,
        pointBackgroundColor: color
      };
    case 'area':
      return {
        backgroundColor: `${color}33`,
        borderColor: color,
        pointBackgroundColor: color,
        pointBorderColor: '#ffffff'
      };
    case 'pie':
      return [
        color,
        `${color}CC`,
        `${color}99`,
        `${color}66`,
        `${color}33`
      ];
    case 'line':
      return {
        backgroundColor: `${color}33`,
        borderColor: color,
        pointBackgroundColor: color,
        pointBorderColor: '#ffffff'
      };
    default:
      return {
        backgroundColor: `${color}CC`,
        borderColor: color,
        hoverBackgroundColor: color
      };
  }
};

/**
 * Generate chart configuration
 */
export const generateChartConfig = (data, config) => {
  const { graphType, aggregation, calculation, column, department } = config;
  const colors = getChartColors(graphType, department);
  
  // Prepare labels and data
  let labels, chartData;
  
  if (graphType === 'pie') {
    // For pie charts, group by branch
    const branchGroups = {};
    data.forEach(item => {
      const branch = item.branch || item.rowValue || 'Other';
      if (!branchGroups[branch]) branchGroups[branch] = 0;
      branchGroups[branch] += item.value || item.numericValue || 0;
    });
    
    labels = Object.keys(branchGroups);
    chartData = Object.values(branchGroups);
  } else {
    // For other charts, use dates or sequence
    labels = data.map(item => item.date || item.branch || `Item ${item.rowIndex}`);
    chartData = data.map(item => item.value || item.numericValue || 0);
  }
  
  const datasets = [{
    label: `${aggregation} ${column} ${calculation}`,
    data: chartData,
    ...colors
  }];
  
  return {
    type: graphType,
    data: {
      labels,
      datasets
    },
    options: getChartOptions(config, chartData)
  };
};

/**
 * Get chart options based on configuration
 */
export const getChartOptions = (config, data) => {
  const { graphType, aggregation, calculation, column } = config;
  
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: '#333',
          font: {
            size: 12
          }
        }
      },
      title: {
        display: true,
        text: `${aggregation.charAt(0).toUpperCase() + aggregation.slice(1)} ${column} ${calculation.charAt(0).toUpperCase() + calculation.slice(1)}`,
        color: '#2a5298',
        font: {
          size: 14,
          weight: '600'
        }
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        titleColor: '#ffffff',
        bodyColor: '#ffffff'
      }
    },
    scales: graphType !== 'pie' ? {
      x: {
        grid: {
          display: false
        },
        ticks: {
          color: '#666',
          maxRotation: 45
        }
      },
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        },
        ticks: {
          color: '#666',
          callback: function(value) {
            if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
            if (value >= 1000) return '$' + (value / 1000).toFixed(1) + 'K';
            return '$' + value;
          }
        }
      }
    } : {}
  };
  
  // Add animation options
  if (graphType !== 'pie') {
    baseOptions.animation = {
      duration: 1000,
      easing: 'easeOutQuart'
    };
  }
  
  return baseOptions;
};

/**
 * Generate simple HTML chart for fallback
 */
export const generateSimpleChartHTML = (data, config) => {
  if (!data || data.length === 0) {
    return '<div class="no-chart-data">No data available for chart</div>';
  }
  
  const maxValue = Math.max(...data.map(item => item.value || item.numericValue || 0));
  const chartHeight = 200;
  
  let chartHTML = '<div class="simple-chart-container">';
  
  data.slice(0, 10).forEach((item, index) => {
    const value = item.value || item.numericValue || 0;
    const label = item.branch || item.date || `Item ${index + 1}`;
    const height = maxValue > 0 ? (value / maxValue) * chartHeight : 0;
    const color = getChartColors(config.graphType, config.department).backgroundColor;
    
    chartHTML += `
      <div class="simple-chart-bar" style="height: ${height}px; background-color: ${color};" 
           title="${label}: ${formatNumber(value)}">
        <span class="simple-chart-label">${label}</span>
      </div>
    `;
  });
  
  chartHTML += '</div>';
  return chartHTML;
};

/**
 * Format number for chart display
 */
export const formatNumber = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  
  if (num >= 1000000) {
    return '$' + (num / 1000000).toFixed(2) + 'M';
  }
  if (num >= 1000) {
    return '$' + (num / 1000).toFixed(2) + 'K';
  }
  return '$' + num.toFixed(2);
};

/**
 * Generate chart legend HTML
 */
export const generateChartLegend = (config, data) => {
  const { column, calculation, aggregation } = config;
  
  let legendHTML = '<div class="chart-legend">';
  legendHTML += `<span class="legend-title">${aggregation} ${column} ${calculation}</span>`;
  
  if (config.graphType === 'pie' && data.length > 0) {
    data.slice(0, 5).forEach((item, index) => {
      const colors = getChartColors('pie', config.department);
      const color = colors[index % colors.length];
      legendHTML += `
        <span class="legend-item">
          <span class="legend-color" style="background-color: ${color};"></span>
          <span class="legend-text">${item.branch || item.rowValue}</span>
        </span>
      `;
    });
  }
  
  legendHTML += '</div>';
  return legendHTML;
};