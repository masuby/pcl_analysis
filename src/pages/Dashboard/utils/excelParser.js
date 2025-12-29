/**
 * Excel Parser Utilities
 * Handles parsing and extracting data from Excel files
 */

import * as XLSX from 'xlsx';
import { getReportFileUrl } from '../../../services/supabase';

/**
 * Parse a single Excel file from URL or path
 */
export const parseExcelFile = async (report) => {
  try {
    let fileUrl;
    
    if (report.filePath) {
      fileUrl = await getReportFileUrl(report.filePath);
    } else if (report.fileUrl) {
      fileUrl = report.fileUrl;
      console.log(fileUrl)
    } else {
      throw new Error('No file URL or path available');
    }

    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    
    // Parse Excel with various options to handle different formats
    const workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellDates: true,
      cellNF: false,
      cellText: false,
      raw: true
    });
    
    return workbook;
  } catch (error) {
    console.error(`Error parsing Excel file ${report.fileName}:`, error);
    throw error;
  }
};

/**
 * Extract column headers from worksheet
 */
export const extractHeaders = (worksheet) => {
  try {
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    if (!jsonData || jsonData.length === 0) return [];
    
    const headers = jsonData[0];
    return headers.map(header => 
      header ? header.toString().trim() : ''
    );
  } catch (error) {
    console.error('Error extracting headers:', error);
    return [];
  }
};

/**
 * Extract data for specific columns
 */
export const extractColumnData = (worksheet, rowColumn, dataColumn) => {
  try {
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    if (!jsonData || jsonData.length < 2) return [];
    
    const headers = jsonData[0];
    const rowColumnIndex = headers.findIndex(col => 
      col && col.toString().toLowerCase() === rowColumn.toLowerCase()
    );
    const dataColumnIndex = headers.findIndex(col => 
      col && col.toString().toLowerCase() === dataColumn.toLowerCase()
    );
    
    if (rowColumnIndex === -1 || dataColumnIndex === -1) {
      throw new Error(`Required columns not found: ${rowColumn}, ${dataColumn}`);
    }
    
    const extractedData = [];
    
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;
      
      const rowValue = row[rowColumnIndex];
      const dataValue = row[dataColumnIndex];
      
      if (rowValue === undefined || rowValue === null || rowValue === '') continue;
      if (dataValue === undefined || dataValue === null || dataValue === '') continue;
      
      // Try to convert to number
      let numericValue;
      if (typeof dataValue === 'number') {
        numericValue = dataValue;
      } else if (typeof dataValue === 'string') {
        numericValue = parseFloat(dataValue.replace(/[^0-9.-]+/g, ''));
      } else {
        numericValue = parseFloat(dataValue);
      }
      
      if (isNaN(numericValue)) continue;
      
      extractedData.push({
        rowValue: rowValue.toString().trim(),
        numericValue,
        rowIndex: i
      });
    }
    
    return extractedData;
  } catch (error) {
    console.error('Error extracting column data:', error);
    return [];
  }
};

/**
 * Find available columns in a worksheet
 */
export const getAvailableColumns = (worksheet) => {
  try {
    const headers = extractHeaders(worksheet);
    return headers.filter(header => header && header.trim() !== '');
  } catch (error) {
    console.error('Error getting available columns:', error);
    return [];
  }
};

/**
 * Extract data with date filtering
 */
export const extractDataWithDateFilter = (worksheet, config, reportDate) => {
  try {
    const { rowColumn, dataColumn, dateRange } = config;
    
    // First, get all data
    const allData = extractColumnData(worksheet, rowColumn, dataColumn);
    
    // Filter by date range if specified
    if (dateRange.from || dateRange.to) {
      const itemDate = new Date(reportDate);
      const fromDate = dateRange.from ? new Date(dateRange.from) : null;
      const toDate = dateRange.to ? new Date(dateRange.to) : null;
      
      if ((fromDate && itemDate < fromDate) || (toDate && itemDate > toDate)) {
        return [];
      }
    }
    
    return allData;
  } catch (error) {
    console.error('Error extracting data with date filter:', error);
    return [];
  }
};

/**
 * Parse multiple reports and extract combined data
 */
export const parseMultipleReports = async (reports, config) => {
  const { rowColumn, dataColumn } = config;
  const allData = [];
  
  for (const report of reports) {
    try {
      const workbook = await parseExcelFile(report);
      const firstSheet = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheet];
      
      const data = extractDataWithDateFilter(worksheet, config, report.date);
      
      // Add metadata to each data point
      const enrichedData = data.map(item => ({
        ...item,
        date: report.date,
        fileName: report.fileName,
        department: report.department,
        reportId: report.id
      }));
      
      allData.push(...enrichedData);
    } catch (error) {
      console.error(`Error processing report ${report.fileName}:`, error);
      // Continue with next report
    }
  }
  
  return allData;
};