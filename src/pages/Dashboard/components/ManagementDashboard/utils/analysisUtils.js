/**
 * Format number to 3 significant digits with B/M/K abbreviations
 * @param {number} num - The number to format
 * @returns {string} - Formatted string (e.g., "4.39 B", "692 M", "1.23 K")
 */
export const formatNumberCompact = (num) => {
  if (num === null || num === undefined || isNaN(num)) return 'N/A';
  if (num === 0) return '0';
  
  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  
  // Determine magnitude and format
  if (absNum >= 1e9) {
    // Billions
    const value = absNum / 1e9;
    // Round to 3 significant digits
    const rounded = parseFloat(value.toPrecision(3));
    return `${sign}${rounded} B`;
  } else if (absNum >= 1e6) {
    // Millions
    const value = absNum / 1e6;
    const rounded = parseFloat(value.toPrecision(3));
    return `${sign}${rounded} M`;
  } else if (absNum >= 1e3) {
    // Thousands
    const value = absNum / 1e3;
    const rounded = parseFloat(value.toPrecision(3));
    return `${sign}${rounded} K`;
  } else {
    // Less than 1000, round to 3 significant digits
    const rounded = parseFloat(absNum.toPrecision(3));
    return `${sign}${rounded}`;
  }
};

export const analyzeData = (data, key) => {
  if (!data || !data.length) return null;

  // Filter data to only include items with valid numeric values for the key
  const validData = data
    .map(d => ({
      ...d,
      value: typeof d[key] === 'number' && !isNaN(d[key]) ? d[key] : null,
      date: d.date instanceof Date ? d.date : new Date(d.date)
    }))
    .filter(d => d.value !== null)
    .sort((a, b) => a.date - b.date); // Sort by date ascending

  if (validData.length === 0) return null;

  const values = validData.map(d => d.value);
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, val) => acc + val, 0);
  const avg = sum / values.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  // Latest value (last in sorted by date)
  const latest = validData[validData.length - 1];
  const latestValue = latest.value;
  const latestDate = latest.date;

  // Previous value (second to last)
  const previous = validData.length >= 2 ? validData[validData.length - 2] : null;
  const previousValue = previous ? previous.value : null;
  const previousDate = previous ? previous.date : null;

  // Calculate trend (comparing latest to previous)
  let trend = null;
  let trendPercentage = null;
  if (previous) {
    trend = latestValue > previousValue ? 'up' : latestValue < previousValue ? 'down' : 'stable';
    trendPercentage = previousValue !== 0 
      ? ((latestValue - previousValue) / previousValue * 100).toFixed(1)
      : latestValue > 0 ? 100 : 0;
  }

  // Maximum value and its date
  const maxItem = validData.reduce((max, item) => item.value > max.value ? item : max);
  const maxValue = maxItem.value;
  const maxDate = maxItem.date;

  // Minimum value and its date
  const minItem = validData.reduce((min, item) => item.value < min.value ? item : min);
  const minValue = minItem.value;
  const minDate = minItem.date;

  return {
    latest: latestValue,
    latestDate: latestDate,
    previous: previousValue,
    previousDate: previousDate,
    max: maxValue,
    maxDate: maxDate,
    min: minValue,
    minDate: minDate,
    avg: Number(avg.toFixed(2)),
    median: Number(median.toFixed(2)),
    sum: Number(sum.toFixed(2)),
    count: values.length,
    trend,
    trendPercentage: trendPercentage ? Number(trendPercentage) : null,
    range: Number((maxValue - minValue).toFixed(2))
  };
};
