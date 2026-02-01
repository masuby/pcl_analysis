import * as XLSX from 'xlsx';

/**
 * Column color definitions for different data categories
 */
export const COLUMN_COLORS = {
  // Main categories - used for Excel cell backgrounds
  PRODUCT: { bg: 'FF4472C4', font: 'FFFFFFFF' },      // Dark Blue
  HOD: { bg: 'FF4472C4', font: 'FFFFFFFF' },          // Dark Blue
  SUB_PRODUCT: { bg: 'FF4472C4', font: 'FFFFFFFF' },  // Dark Blue
  DAY: { bg: 'FF70AD47', font: 'FFFFFFFF' },          // Green
  SALES: { bg: 'FFED7D31', font: 'FFFFFFFF' },        // Orange
  PORTFOLIO: { bg: 'FFA5A5A5', font: 'FFFFFFFF' },    // Gray
  CRM: { bg: 'FFFFC000', font: 'FF000000' },          // Yellow
  CALL_CENTER: { bg: 'FF5B9BD5', font: 'FFFFFFFF' },  // Light Blue
  MTD: { bg: 'FF7030A0', font: 'FFFFFFFF' },          // Purple
  
  // Semantic colors for values
  POSITIVE: { bg: 'FFE2EFDA', font: 'FF38A169' },     // Light green bg, green text
  WARNING: { bg: 'FFFEF3CD', font: 'FFD69E2E' },      // Light yellow bg, amber text
  NEGATIVE: { bg: 'FFF8D7DA', font: 'FFE53E3E' },     // Light red bg, red text
  NEUTRAL: { bg: 'FFFFFFFF', font: 'FF333333' },      // White bg, dark text
};

/**
 * Map column header text to color category
 */
const getColumnColorCategory = (header) => {
  const h = header.toUpperCase();
  
  if (h.includes('PRODUCT')) return 'PRODUCT';
  if (h.includes('HOD')) return 'HOD';
  if (h.includes('SUB-PRODUCT') || h.includes('SUBPRODUCT')) return 'SUB_PRODUCT';
  if (h.includes('DAY') || h.includes('DATE') || h.includes('WEEK')) return 'DAY';
  
  // Sales columns
  if (h.includes('TARGET') || h.includes('DISBURSEMENT') || h.includes('SALES') || 
      h.includes('NUMBER OF LOANS') || h.includes('ACTIVE REPS') || h.includes('PERCENTAGE')) return 'SALES';
  
  // Portfolio columns
  if (h.includes('ARREAR') || h.includes('PAR') || h.includes('PORTFOLIO')) return 'PORTFOLIO';
  
  // CRM columns
  if (h.includes('LEAD') || h.includes('PROSPECT') || h.includes('AGENT') && !h.includes('CALL') ||
      h.includes('TLS') || h.includes('TEAM LEADER') || h.includes('LOGGED') || h.includes('LOCATION')) return 'CRM';
  
  // Call Center columns
  if (h.includes('CALL') || h.includes('SUCCESS') && h.includes('RATE')) return 'CALL_CENTER';
  
  // MTD columns
  if (h.includes('VALUE') || h.includes('LOAN SIZE')) return 'MTD';
  
  return null;
};

/**
 * Export data to Excel with formatting
 * @param {Array} data - Array of objects to export
 * @param {string} sheetName - Name of the sheet
 * @param {Object} options - Additional options
 */
export const exportToExcel = (data, sheetName, options = {}) => {
  if (!data || data.length === 0) {
    console.warn('No data to export');
    return;
  }

  // Create workbook
  const wb = XLSX.utils.book_new();
  
  // Convert data to worksheet
  const ws = XLSX.utils.json_to_sheet(data);
  
  // Set column widths
  const colWidths = options.colWidths || [];
  if (colWidths.length > 0) {
    ws['!cols'] = colWidths.map(width => ({ wch: width }));
  }
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  
  // Write file
  const fileName = options.fileName || `${sheetName}_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, fileName);
};

/**
 * Export multiple sheets to a single Excel file
 * @param {Array} sheets - Array of { name, data, colWidths } objects
 * @param {string} fileName - Name of the Excel file
 */
export const exportMultipleSheets = (sheets, fileName) => {
  if (!sheets || sheets.length === 0) {
    console.warn('No sheets to export');
    return;
  }

  const wb = XLSX.utils.book_new();
  
  sheets.forEach(sheet => {
    if (!sheet.data || sheet.data.length === 0) {
      console.warn(`No data for sheet: ${sheet.name}`);
      return;
    }
    
    const ws = XLSX.utils.json_to_sheet(sheet.data);
    
    // Set column widths if provided
    if (sheet.colWidths && sheet.colWidths.length > 0) {
      ws['!cols'] = sheet.colWidths.map(width => ({ wch: width }));
    } else {
      // Auto-size columns if no widths provided
      const maxWidth = 15;
      const colCount = sheet.data[0] ? Object.keys(sheet.data[0]).length : 0;
      ws['!cols'] = Array(colCount).fill({ wch: maxWidth });
    }
    
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  });
  
  const finalFileName = fileName || `HOD_ScoreCard_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, finalFileName);
};

/**
 * Export multiple sheets with color formatting to a single Excel file
 * Note: XLSX-style library with styling support is required for full colors
 * This version uses basic XLSX and adds comments about intended colors
 * @param {Array} sheets - Array of { name, data, colWidths, freeze, headerColors } objects
 * @param {string} fileName - Name of the Excel file
 */
export const exportMultipleSheetsWithColors = (sheets, fileName) => {
  if (!sheets || sheets.length === 0) {
    console.warn('No sheets to export');
    return;
  }

  const wb = XLSX.utils.book_new();
  
  sheets.forEach(sheet => {
    if (!sheet.data || sheet.data.length === 0) {
      console.warn(`No data for sheet: ${sheet.name}`);
      return;
    }
    
    const ws = XLSX.utils.json_to_sheet(sheet.data);
    
    // Set column widths if provided
    if (sheet.colWidths && sheet.colWidths.length > 0) {
      ws['!cols'] = sheet.colWidths.map(width => ({ wch: width }));
    } else {
      // Auto-size columns based on content
      const colCount = sheet.data[0] ? Object.keys(sheet.data[0]).length : 0;
      ws['!cols'] = Array(colCount).fill({ wch: 15 });
    }
    
    // Set row heights for better readability
    const rowCount = sheet.data.length + 1; // +1 for header
    ws['!rows'] = Array(rowCount).fill({ hpt: 22 }); // 22 points height
    
    // Set freeze panes if provided
    if (sheet.freeze) {
      ws['!freeze'] = { 
        xSplit: sheet.freeze.col || 0, 
        ySplit: sheet.freeze.row || 1 
      };
    }
    
    // Add auto-filter to headers
    const range = XLSX.utils.decode_range(ws['!ref']);
    ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
    
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.substring(0, 31)); // Excel sheet names max 31 chars
  });
  
  const finalFileName = fileName || `HOD_ScoreCard_${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(wb, finalFileName);
};

/**
 * Create a styled data array with color metadata
 * This can be used for visual display and Excel export reference
 */
export const createStyledData = (data, headerColorMap = {}) => {
  if (!data || data.length === 0) return [];
  
  const headers = Object.keys(data[0]);
  
  return {
    headers: headers.map(h => ({
      text: h,
      color: getColumnColorCategory(h) || headerColorMap[h] || 'NEUTRAL'
    })),
    rows: data.map(row => 
      headers.map(h => ({
        value: row[h],
        header: h,
        color: getColumnColorCategory(h) || 'NEUTRAL'
      }))
    )
  };
};

/**
 * Format number with commas
 */
export const formatNumber = (num) => {
  if (num === null || num === undefined || num === '') return '0';
  return new Intl.NumberFormat('en-US').format(Math.round(Number(num)));
};

/**
 * Format currency
 */
export const formatCurrency = (num) => {
  if (num === null || num === undefined || num === '') return 'TZS 0';
  const value = Number(num);
  if (value >= 1000000000) {
    return `TZS ${(value / 1000000000).toFixed(2)}B`;
  }
  if (value >= 1000000) {
    return `TZS ${(value / 1000000).toFixed(2)}M`;
  }
  if (value >= 1000) {
    return `TZS ${(value / 1000).toFixed(2)}K`;
  }
  return `TZS ${formatNumber(value)}`;
};

/**
 * Format percentage
 */
export const formatPercent = (num) => {
  if (num === null || num === undefined || num === '') return '0%';
  return `${Number(num).toFixed(1)}%`;
};

/**
 * Get day name from date
 */
export const getDayName = (date) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const d = date instanceof Date ? date : new Date(date);
  return days[d.getDay()];
};

/**
 * Get week number from date
 */
export const getWeekNumber = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  const firstDayOfYear = new Date(d.getFullYear(), 0, 1);
  const pastDaysOfYear = (d - firstDayOfYear) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
};

/**
 * Get latest week's data from a dataset
 * Returns data from Monday to Sunday of the latest available week
 */
export const getLatestWeekData = (data, dateField = 'date') => {
  if (!data || data.length === 0) return [];
  
  // Sort by date descending
  const sorted = [...data].sort((a, b) => {
    const dateA = a[dateField] instanceof Date ? a[dateField] : new Date(a[dateField]);
    const dateB = b[dateField] instanceof Date ? b[dateField] : new Date(b[dateField]);
    return dateB - dateA;
  });
  
  // Get the latest date
  const latestDate = sorted[0][dateField] instanceof Date 
    ? sorted[0][dateField] 
    : new Date(sorted[0][dateField]);
  
  // Find Monday of that week
  const dayOfWeek = latestDate.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Handle Sunday case
  const monday = new Date(latestDate);
  monday.setDate(latestDate.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  
  // Find Sunday of that week
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  
  // Filter data within that week
  return sorted.filter(item => {
    const itemDate = item[dateField] instanceof Date 
      ? item[dateField] 
      : new Date(item[dateField]);
    return itemDate >= monday && itemDate <= sunday;
  });
};

/**
 * Group data by day of week for weekly view
 */
export const groupByDayOfWeek = (data, dateField = 'date') => {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const grouped = {};
  
  days.forEach(day => {
    grouped[day] = null;
  });
  
  data.forEach(item => {
    const date = item[dateField] instanceof Date 
      ? item[dateField] 
      : new Date(item[dateField]);
    const dayName = getDayName(date);
    if (dayName && days.includes(dayName)) {
      grouped[dayName] = item;
    }
  });
  
  return grouped;
};
