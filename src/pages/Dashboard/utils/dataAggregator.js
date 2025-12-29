/**
 * Data Aggregation Utilities
 * Handles aggregating and processing data based on configurations
 */

/**
 * Group data by aggregation period
 */
export const groupByAggregation = (data, aggregation) => {
  if (!data || data.length === 0) {
    console.log('[Aggregator] No data to group');
    return {};
  }

  console.log(`[Aggregator] Grouping ${data.length} items by ${aggregation}`);
  
  const grouped = {};
  let skippedItems = 0;
  
  data.forEach((item, index) => {
    try {
      if (!item.date) {
        console.warn(`[Aggregator] Item ${index} has no date, skipping`);
        skippedItems++;
        return;
      }
      
      let groupKey;
      let itemDate;
      
      try {
        itemDate = new Date(item.date);
        if (isNaN(itemDate.getTime())) {
          console.warn(`[Aggregator] Item ${index} has invalid date: ${item.date}, skipping`);
          skippedItems++;
          return;
        }
      } catch (dateError) {
        console.warn(`[Aggregator] Could not parse date for item ${index}: ${item.date}, skipping`);
        skippedItems++;
        return;
      }
      
      switch (aggregation) {
        case 'daily':
          groupKey = itemDate.toISOString().split('T')[0];
          break;
        case 'weekly':
          const weekStart = new Date(itemDate);
          weekStart.setDate(itemDate.getDate() - itemDate.getDay());
          groupKey = weekStart.toISOString().split('T')[0];
          break;
        case 'monthly':
          groupKey = `${itemDate.getFullYear()}-${String(itemDate.getMonth() + 1).padStart(2, '0')}`;
          break;
        default:
          groupKey = 'all';
      }
      
      if (!grouped[groupKey]) {
        grouped[groupKey] = [];
      }
      
      grouped[groupKey].push(item);
    } catch (error) {
      console.warn(`[Aggregator] Error processing item ${index}:`, error);
      skippedItems++;
    }
  });
  
  console.log(`[Aggregator] Grouped into ${Object.keys(grouped).length} groups, skipped ${skippedItems} items`);
  
  return grouped;
};


/**
 * Apply calculation to grouped data
 */
export const applyCalculation = (groupedData, calculation) => {
  const result = [];
  let skippedGroups = 0;
  
  console.log(`[Aggregator] Applying ${calculation} calculation to ${Object.keys(groupedData).length} groups`);
  
  Object.entries(groupedData).forEach(([date, items]) => {
    try {
      let calculatedValue;
      const values = items.map(item => {
        const num = item.numericValue || item.value || 0;
        return isNaN(num) ? 0 : num;
      });
      
      if (values.length === 0) {
        console.warn(`[Aggregator] Group ${date} has no valid values, skipping`);
        skippedGroups++;
        return;
      }
      
      switch (calculation) {
        case 'sum':
          calculatedValue = values.reduce((sum, val) => sum + val, 0);
          break;
        case 'average':
          calculatedValue = values.reduce((sum, val) => sum + val, 0) / values.length;
          break;
        case 'high':
          calculatedValue = Math.max(...values);
          break;
        case 'low':
          calculatedValue = Math.min(...values);
          break;
        case 'actual':
        default:
          calculatedValue = values.length > 0 ? values[0] : 0;
      }
      
      // Handle NaN results
      if (isNaN(calculatedValue)) {
        console.warn(`[Aggregator] Calculation resulted in NaN for group ${date}, using 0`);
        calculatedValue = 0;
      }
      
      result.push({
        date,
        value: calculatedValue,
        items: items,
        count: items.length,
        calculation: calculation
      });
    } catch (error) {
      console.warn(`[Aggregator] Error calculating for group ${date}:`, error);
      skippedGroups++;
    }
  });
  
  console.log(`[Aggregator] Calculated ${result.length} results, skipped ${skippedGroups} groups`);
  
  // Sort by date
  return result.sort((a, b) => {
    try {
      return new Date(a.date) - new Date(b.date);
    } catch (error) {
      return 0;
    }
  });
};
/**
 * Aggregate data by branch/row values
 */
export const aggregateByBranch = (data, branchRows) => {
  if (!data || data.length === 0) return [];
  
  const branchMap = {};
  
  data.forEach(item => {
    const branch = item.rowValue.toLowerCase();
    
    // Check if this branch matches any of the branch rows
    const matchingBranch = branchRows.find(row => 
      branch.includes(row.toLowerCase()) || branch === row.toLowerCase()
    );
    
    if (matchingBranch) {
      if (!branchMap[matchingBranch]) {
        branchMap[matchingBranch] = {
          branch: matchingBranch,
          values: []
        };
      }
      branchMap[matchingBranch].values.push(item.numericValue);
    }
  });
  
  // Convert to array and calculate totals
  return Object.values(branchMap).map(branchData => ({
    branch: branchData.branch,
    total: branchData.values.reduce((sum, val) => sum + val, 0),
    average: branchData.values.reduce((sum, val) => sum + val, 0) / branchData.values.length,
    count: branchData.values.length,
    values: branchData.values
  }));
};

/**
 * Calculate statistics for data
 */
export const calculateStatistics = (data) => {
  if (!data || data.length === 0) {
    return {
      total: 0,
      average: 0,
      median: 0,
      min: 0,
      max: 0,
      count: 0,
      stdDev: 0
    };
  }
  
  const values = data.map(item => item.numericValue || item.value || 0);
  const total = values.reduce((sum, val) => sum + val, 0);
  const average = total / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  
  // Calculate median
  const sortedValues = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sortedValues.length / 2);
  const median = sortedValues.length % 2 === 0
    ? (sortedValues[middle - 1] + sortedValues[middle]) / 2
    : sortedValues[middle];
  
  // Calculate standard deviation
  const squaredDifferences = values.map(value => Math.pow(value - average, 2));
  const variance = squaredDifferences.reduce((sum, val) => sum + val, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  
  return {
    total,
    average,
    median,
    min,
    max,
    count: values.length,
    stdDev
  };
};

/**
 * Format numbers for display
 */
export const formatNumber = (num, options = {}) => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  
  const {
    decimals = 0,
    compact = false
  } = options;
  
  let formattedNum;
  
  if (compact) {
    if (Math.abs(num) >= 1000000000) {
      formattedNum = (num / 1000000000).toFixed(decimals) + 'B';
    } else if (Math.abs(num) >= 1000000) {
      formattedNum = (num / 1000000).toFixed(decimals) + 'M';
    } else if (Math.abs(num) >= 1000) {
      formattedNum = (num / 1000).toFixed(decimals) + 'K';
    } else {
      formattedNum = num.toFixed(decimals);
    }
  } else {
    // Format with commas
    formattedNum = num.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }
  
  return formattedNum;
};

/**
 * Calculate difference between latest and previous data
 */
export const calculateDifference = (data) => {
  if (!data || data.length < 2) return { difference: 0, percentage: 0 };
  
  const sortedData = [...data].sort((a, b) => 
    new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp)
  );
  
  const latest = sortedData[0]?.value || sortedData[0]?.numericValue || 0;
  const previous = sortedData[1]?.value || sortedData[1]?.numericValue || 0;
  
  const difference = latest - previous;
  const percentage = previous !== 0 ? (difference / previous) * 100 : 0;
  
  return {
    difference,
    percentage,
    latest,
    previous
  };
};

/**
 * Get latest value
 */
export const getLatestValue = (data) => {
  if (!data || data.length === 0) return 0;
  
  const sortedData = [...data].sort((a, b) => 
    new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp)
  );
  
  return sortedData[0]?.value || sortedData[0]?.numericValue || 0;
};
/**
 * Detect trends in data
 */
export const detectTrend = (data) => {
  if (!data || data.length < 2) return 'stable';
  
  const sortedData = [...data].sort((a, b) => 
    new Date(a.date || a.timestamp) - new Date(b.date || b.timestamp)
  );
  
  const firstValue = sortedData[0]?.value || sortedData[0]?.numericValue || 0;
  const lastValue = sortedData[sortedData.length - 1]?.value || 
                   sortedData[sortedData.length - 1]?.numericValue || 0;
  
  const percentageChange = ((lastValue - firstValue) / Math.abs(firstValue)) * 100;
  
  if (percentageChange > 10) return 'strong_increase';
  if (percentageChange > 2) return 'increase';
  if (percentageChange < -10) return 'strong_decrease';
  if (percentageChange < -2) return 'decrease';
  return 'stable';
};

/**
 * Generate insights from data
 */
export const generateInsights = (data, stats, column) => {
  const insights = [];
  const trend = detectTrend(data);
  
  // Add trend insight
  switch (trend) {
    case 'strong_increase':
      insights.push(`Strong growth observed in ${column} with significant increase`);
      break;
    case 'increase':
      insights.push(`Steady growth in ${column} performance`);
      break;
    case 'strong_decrease':
      insights.push(`Significant decline in ${column} requires attention`);
      break;
    case 'decrease':
      insights.push(`Moderate decline detected in ${column}`);
      break;
    default:
      insights.push(`${column} remains stable with consistent performance`);
  }
  
  // Add statistical insights
  if (stats.max > stats.average * 2) {
    insights.push(`Peak values significantly higher than average (${formatNumber(stats.max)} vs ${formatNumber(stats.average)})`);
  }
  
  if (stats.stdDev > stats.average * 0.5) {
    insights.push(`High variability in data indicates inconsistent performance`);
  }
  
  if (data.length > 10) {
    insights.push(`Analysis based on ${data.length} data points provides reliable insights`);
  }
  
  return insights;
};
