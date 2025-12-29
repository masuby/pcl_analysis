/**
 * Utility functions for CRM Dashboard
 */

/**
 * Extract metrics from Email sheet data (Text/Value pairs)
 */
export const extractMetrics = (emailData) => {
  if (!emailData || emailData.length === 0) {
    return {};
  }

  const metrics = {};
  
  // Create a dictionary from Text/Value pairs
  emailData.forEach(row => {
    const text = (row['Text'] || row['text'] || '').toString().toLowerCase().trim();
    const value = row['Value'] || row['value'] || '';
    
    if (text && value !== null && value !== undefined && value !== '') {
      metrics[text] = value;
    }
  });

  return metrics;
};

/**
 * Get formatted value for display
 */
export const getFormattedValue = (metrics, key, defaultVal = 'N/A') => {
  const value = metrics[key.toLowerCase()] || defaultVal;
  
  if (value === 'N/A' || value === '' || value === null || value === undefined) {
    return defaultVal;
  }

  // Check if key contains percentage indicators
  const keyLower = key.toLowerCase();
  const isPercentageKey = ['percentage', 'percent', '%', 'rate', 'ratio'].some(
    indicator => keyLower.includes(indicator)
  );

  try {
    let numValue;
    if (typeof value === 'string') {
      const cleanStr = value.replace('%', '').replace(',', '').trim();
      numValue = parseFloat(cleanStr);
    } else {
      numValue = parseFloat(value);
    }

    if (isNaN(numValue)) {
      return value.toString();
    }

    if (isPercentageKey) {
      // Format as percentage
      if (numValue >= 0 && numValue <= 1) {
        return `${(numValue * 100).toFixed(2)}%`;
      } else if (numValue >= 0 && numValue <= 100) {
        return `${numValue.toFixed(2)}%`;
      } else {
        return `${numValue.toFixed(2)}%`;
      }
    } else {
      // Format as number
      if (Number.isInteger(numValue)) {
        return numValue.toLocaleString();
      } else {
        return numValue.toFixed(0);
      }
    }
  } catch (e) {
    return value.toString();
  }
};

/**
 * Format number with commas
 */
export const formatNumber = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

/**
 * Calculate trends from historical data
 */
export const calculateTrends = (currentMetrics, historicalData) => {
  if (!historicalData || historicalData.length === 0) {
    return {};
  }

  const trends = {};
  const lastHistorical = historicalData[0]; // Most recent historical
  const lastMetrics = extractMetrics(lastHistorical.emailData);

  // Compare current with last historical
  Object.keys(currentMetrics).forEach(key => {
    const currentVal = parseFloat(currentMetrics[key]) || 0;
    const lastVal = parseFloat(lastMetrics[key]) || 0;
    
    if (lastVal !== 0) {
      const change = ((currentVal - lastVal) / lastVal) * 100;
      trends[key] = {
        value: currentVal,
        previousValue: lastVal,
        change: change,
        changeAbs: Math.abs(change),
        direction: change >= 0 ? 'up' : 'down'
      };
    } else {
      trends[key] = {
        value: currentVal,
        previousValue: lastVal,
        change: currentVal > 0 ? 100 : 0,
        changeAbs: currentVal > 0 ? 100 : 0,
        direction: currentVal > 0 ? 'up' : 'neutral'
      };
    }
  });

  return trends;
};

/**
 * Prepare leads summary data for table/chart
 */
export const prepareLeadsSummary = (leadsSummaryData) => {
  if (!leadsSummaryData || leadsSummaryData.length === 0) {
    return [];
  }

  return leadsSummaryData.map(row => ({
    ...row,
    // Ensure numeric values are properly formatted
    ...Object.keys(row).reduce((acc, key) => {
      const value = row[key];
      if (typeof value === 'number') {
        acc[key] = value;
      } else if (typeof value === 'string' && !isNaN(value) && value.trim() !== '') {
        acc[key] = parseFloat(value);
      } else {
        acc[key] = value;
      }
      return acc;
    }, {})
  }));
};

/**
 * Prepare agent/team leader summary data
 */
export const prepareSummaryData = (summaryData, type = 'agent') => {
  if (!summaryData || summaryData.length === 0) {
    return [];
  }

  // Filter and format based on type
  return summaryData.map(row => ({
    ...row,
    ...Object.keys(row).reduce((acc, key) => {
      const value = row[key];
      if (typeof value === 'number') {
        acc[key] = value;
      } else if (typeof value === 'string' && !isNaN(value) && value.trim() !== '') {
        acc[key] = parseFloat(value);
      } else {
        acc[key] = value;
      }
      return acc;
    }, {})
  }));
};





