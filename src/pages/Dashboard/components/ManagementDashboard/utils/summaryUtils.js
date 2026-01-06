/**
 * Get monthly data - groups data by month and takes the latest data point for each month
 * This is independent of the chart filters
 */
export const getMonthlyData = (allData) => {
  if (!allData || allData.length === 0) return [];

  // Sort by date
  const sortedData = [...allData].sort((a, b) => {
    const dateA = a.date instanceof Date ? a.date : new Date(a.date);
    const dateB = b.date instanceof Date ? b.date : new Date(b.date);
    return dateA - dateB;
  });

  // Group by month and take the latest data point for each month
  const monthlyData = {};
  sortedData.forEach(item => {
    const itemDate = item.date instanceof Date ? item.date : new Date(item.date);
    const monthKey = `${itemDate.getFullYear()}-${String(itemDate.getMonth() + 1).padStart(2, '0')}`;
    
    if (!monthlyData[monthKey] || itemDate > new Date(monthlyData[monthKey].date)) {
      monthlyData[monthKey] = item;
    }
  });

  return Object.values(monthlyData).sort((a, b) => {
    const dateA = a.date instanceof Date ? a.date : new Date(a.date);
    const dateB = b.date instanceof Date ? b.date : new Date(b.date);
    return dateA - dateB;
  });
};

/**
 * Get the latest month data
 */
export const getLatestMonthData = (allData) => {
  const monthlyData = getMonthlyData(allData);
  return monthlyData.length > 0 ? monthlyData[monthlyData.length - 1] : null;
};

/**
 * Get data for a specific month and year
 */
export const getMonthData = (allData, year, month) => {
  const monthlyData = getMonthlyData(allData);
  return monthlyData.find(item => {
    const itemDate = item.date instanceof Date ? item.date : new Date(item.date);
    return itemDate.getFullYear() === year && itemDate.getMonth() === month - 1;
  }) || null;
};

/**
 * Calculate percentage change
 */
export const calculatePercentageChange = (current, previous) => {
  if (!previous || previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous * 100).toFixed(2);
};

/**
 * Format number with TZS
 */
export const formatTZS = (num) => {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  return typeof num === 'number' ? num.toLocaleString() : num;
};

/**
 * Format number as billions
 */
export const formatBillions = (num) => {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  if (num >= 1000000000) {
    return (num / 1000000000).toFixed(2) + ' billion';
  }
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + ' million';
  }
  return num.toLocaleString();
};











