/**
 * Utilities for extracting and formatting New Business and Repeat Business performance data
 */

import { format } from 'date-fns';

/**
 * Extract new business trend data (latest per month, max 15 months)
 */
export function getNewBusinessTrendData(data) {
  if (!Array.isArray(data) || data.length === 0) return [];
  
  const monthMap = new Map();
  for (const row of data) {
    if (!row.date || row['New Business'] == null) continue;
    const d = row.date instanceof Date ? row.date : new Date(row.date);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const existing = monthMap.get(key);
    if (!existing || d > existing.dateObj) {
      monthMap.set(key, {
        dateObj: d,
        label: format(d, 'MMM yyyy'),
        newBusiness: row['New Business'] || 0
      });
    }
  }
  
  const sorted = Array.from(monthMap.values()).sort((a, b) => a.dateObj - b.dateObj);
  return sorted.slice(-15);
}

/**
 * Extract repeat business trend data (latest per month, max 15 months)
 */
export function getRepeatBusinessTrendData(data) {
  if (!Array.isArray(data) || data.length === 0) return [];
  
  const monthMap = new Map();
  for (const row of data) {
    if (!row.date || row['Repeat Business'] == null) continue;
    const d = row.date instanceof Date ? row.date : new Date(row.date);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const existing = monthMap.get(key);
    if (!existing || d > existing.dateObj) {
      monthMap.set(key, {
        dateObj: d,
        label: format(d, 'MMM yyyy'),
        repeatBusiness: row['Repeat Business'] || 0
      });
    }
  }
  
  const sorted = Array.from(monthMap.values()).sort((a, b) => a.dateObj - b.dateObj);
  return sorted.slice(-15);
}

/**
 * Calculate comparison metrics for new business for the selected month
 */
export function getNewBusinessComparison(data, selectedMonth) {
  if (!data || data.length === 0) return null;
  
  const trendData = getNewBusinessTrendData(data);
  if (trendData.length === 0) return null;
  
  const selectedDate = new Date(selectedMonth);
  const selectedYearMonth = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`;
  
  // Find current, last month, last year
  const currentIdx = trendData.findIndex((d) => {
    const key = `${d.dateObj.getFullYear()}-${String(d.dateObj.getMonth() + 1).padStart(2, '0')}`;
    return key === selectedYearMonth;
  });
  
  if (currentIdx === -1) return null;
  
  const current = trendData[currentIdx];
  const lastMonth = currentIdx > 0 ? trendData[currentIdx - 1] : null;
  const lastYear = trendData.find((d) => {
    return d.dateObj.getFullYear() === selectedDate.getFullYear() - 1 &&
           d.dateObj.getMonth() === selectedDate.getMonth();
  });
  
  const formatValue = (val) => {
    const b = val / 1e9;
    return b.toFixed(2) + ' billion';
  };
  
  const calcChange = (curr, prev) => {
    if (!prev || prev.newBusiness === 0) return null;
    const pct = ((curr.newBusiness - prev.newBusiness) / prev.newBusiness * 100).toFixed(2);
    const dir = curr.newBusiness >= prev.newBusiness ? 'increased' : 'decreased';
    return { pct: Math.abs(parseFloat(pct)), dir };
  };
  
  return {
    monthLabel: current.label,
    currentValue: current.newBusiness,
    currentFormatted: formatValue(current.newBusiness),
    lastMonthChange: lastMonth ? calcChange(current, lastMonth) : null,
    lastMonthLabel: lastMonth ? lastMonth.label : null,
    lastYearChange: lastYear ? calcChange(current, lastYear) : null,
    lastYearLabel: lastYear ? lastYear.label : null
  };
}

/**
 * Calculate comparison metrics for repeat business for the selected month
 */
export function getRepeatBusinessComparison(data, selectedMonth) {
  if (!data || data.length === 0) return null;
  
  const trendData = getRepeatBusinessTrendData(data);
  if (trendData.length === 0) return null;
  
  const selectedDate = new Date(selectedMonth);
  const selectedYearMonth = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`;
  
  const currentIdx = trendData.findIndex((d) => {
    const key = `${d.dateObj.getFullYear()}-${String(d.dateObj.getMonth() + 1).padStart(2, '0')}`;
    return key === selectedYearMonth;
  });
  
  if (currentIdx === -1) return null;
  
  const current = trendData[currentIdx];
  const lastMonth = currentIdx > 0 ? trendData[currentIdx - 1] : null;
  const lastYear = trendData.find((d) => {
    return d.dateObj.getFullYear() === selectedDate.getFullYear() - 1 &&
           d.dateObj.getMonth() === selectedDate.getMonth();
  });
  
  const formatValue = (val) => {
    const b = val / 1e9;
    return b.toFixed(2) + ' billion';
  };
  
  const calcChange = (curr, prev) => {
    if (!prev || prev.repeatBusiness === 0) return null;
    const pct = ((curr.repeatBusiness - prev.repeatBusiness) / prev.repeatBusiness * 100).toFixed(2);
    const dir = curr.repeatBusiness >= prev.repeatBusiness ? 'increased' : 'decreased';
    return { pct: Math.abs(parseFloat(pct)), dir };
  };
  
  return {
    monthLabel: current.label,
    currentValue: current.repeatBusiness,
    currentFormatted: formatValue(current.repeatBusiness),
    lastMonthChange: lastMonth ? calcChange(current, lastMonth) : null,
    lastMonthLabel: lastMonth ? lastMonth.label : null,
    lastYearChange: lastYear ? calcChange(current, lastYear) : null,
    lastYearLabel: lastYear ? lastYear.label : null
  };
}
