/**
 * Optimized Excel Parser - Fast parsing without debug logs
 */

import * as XLSX from 'xlsx';
import { getReportFileUrl } from '../../../services/supabase';

/**
 * Parse Excel file targeting specific sheet (optimized)
 */
export const parseExcelFile = async (report, targetSheet = 'Country') => {
  try {
    // Get file URL
    let fileUrl;
    if (report.filePath) {
      fileUrl = await getReportFileUrl(report.filePath);
    } else if (report.fileUrl) {
      fileUrl = report.fileUrl;
    } else {
      throw new Error('No file URL or path available');
    }

    // Fetch the file
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    
    // Read workbook
    const workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellDates: true,
      cellNF: false,
      cellText: false,
      raw: false
    });
    
    // Find target sheet
    const sheetName = workbook.SheetNames.find(name => 
      name.toLowerCase() === targetSheet.toLowerCase()
    ) || workbook.SheetNames[0];
    
    const worksheet = workbook.Sheets[sheetName];
    
    return {
      workbook,
      sheetName,
      worksheet
    };
  } catch (error) {
    console.warn(`Failed to parse ${report.fileName}:`, error.message);
    throw error;
  }
};

/**
 * Extract data from worksheet for specific columns (optimized)
 */
export const extractColumnData = (worksheet, rowColumn, dataColumn) => {
  try {
    // Convert to JSON with headers
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1,
      defval: '',
      blankrows: false
    });
    
    if (!jsonData || jsonData.length < 2) return [];
    
    const headers = jsonData[0] || [];
    
    // Find column indices
    const rowColumnIndex = headers.findIndex(header => 
      header && String(header).trim().toLowerCase() === rowColumn.toLowerCase()
    );
    
    const dataColumnIndex = headers.findIndex(header => 
      header && String(header).trim().toLowerCase() === dataColumn.toLowerCase()
    );
    
    if (rowColumnIndex === -1 || dataColumnIndex === -1) return [];
    
    // Extract data efficiently
    const extractedData = [];
    
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;
      
      const rowValue = row[rowColumnIndex];
      const dataValue = row[dataColumnIndex];
      
      if (!rowValue || String(rowValue).trim() === '') continue;
      
      const numericValue = parseNumericValue(dataValue);
      if (numericValue === null) continue;
      
      extractedData.push({
        rowValue: String(rowValue).trim(),
        numericValue,
        rowIndex: i
      });
    }
    
    return extractedData;
  } catch (error) {
    console.warn('Error extracting column data:', error.message);
    return [];
  }
};

/**
 * Parse numeric value
 */
const parseNumericValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }
  
  if (typeof value === 'string') {
    const cleanStr = value.replace(/[^\d.,-]/g, '').replace(/,/g, '').trim();
    const num = parseFloat(cleanStr);
    return isNaN(num) ? null : num;
  }
  
  const num = Number(value);
  return isNaN(num) ? null : num;
};

/**
 * Parse multiple reports in parallel (optimized)
 */
export const parseMultipleReports = async (reports, rowColumn, dataColumn) => {
  const parsePromises = reports.map(async (report) => {
    try {
      const { worksheet } = await parseExcelFile(report, 'Country');
      const data = extractColumnData(worksheet, rowColumn, dataColumn);
      
      return data.map(item => ({
        ...item,
        date: report.date,
        fileName: report.fileName,
        department: report.department,
        reportId: report.id
      }));
    } catch (error) {
      return [];
    }
  });
  
  const results = await Promise.all(parsePromises);
  return results.flat();
};

/**
 * Extract data for specific department
 */
export const extractDepartmentData = async (reports, departmentConfig) => {
  const { branchRows, dataColumn } = departmentConfig;
  
  const allData = await parseMultipleReports(reports, 'Branch', dataColumn);
  
  // Filter for department-specific rows
  return allData.filter(item => {
    const branchLower = item.rowValue.toLowerCase();
    return branchRows.some(row => 
      branchLower.includes(row.toLowerCase()) || 
      branchLower === row.toLowerCase()
    );
  });
};