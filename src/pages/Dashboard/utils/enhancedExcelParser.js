/**
 * Enhanced Excel Parser Utility - Updated for your Excel structure
 */

import * as XLSX from 'xlsx';
import { getReportFileUrl } from '../../../services/supabase';

/**
 * Parse Excel file targeting specific sheet
 */
export const parseExcelFile = async (report, targetSheet = 'Country', options = {}) => {
  const {
    maxAttempts = 3,
    timeout = 30000,
    debug = true  // Enable debug by default for now
  } = options;

  console.log(`[Excel Parser] Starting to parse: ${report.fileName || report.filePath}`);
  console.log(`[Excel Parser] Target sheet: ${targetSheet}`);
  
  try {
    // Get file URL
    let fileUrl;
    if (report.filePath) {
      console.log(`[Excel Parser] Getting URL for file path: ${report.filePath}`);
      fileUrl = await getReportFileUrl(report.filePath);
    } else if (report.fileUrl) {
      console.log(`[Excel Parser] Using provided URL: ${report.fileUrl}`);
      fileUrl = report.fileUrl;
    } else {
      throw new Error('No file URL or path available');
    }

    console.log(`[Excel Parser] File URL obtained`);
    
    // Fetch the file with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(fileUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      console.log(`[Excel Parser] File fetched successfully, size: ${arrayBuffer.byteLength} bytes`);
      
      return parseExcelData(arrayBuffer, report.fileName, targetSheet, debug);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    console.error(`[Excel Parser] Failed to parse ${report.fileName}:`, error);
    throw error;
  }
};

/**
 * Parse Excel data targeting specific sheet
 */
const parseExcelData = (arrayBuffer, fileName, targetSheet, debug = true) => {
  console.log(`[Excel Parser] Parsing data for: ${fileName}`);
  
  try {
    // Read the workbook
    const workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellDates: true,
      cellNF: true,  // Keep number formatting
      cellText: true,
      raw: false,    // Get formatted values
      dense: false
    });
    
    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('Workbook has no sheets');
    }
    
    console.log(`[Excel Parser] Workbook parsed, available sheets:`, workbook.SheetNames);
    
    // Check if target sheet exists
    if (!workbook.SheetNames.includes(targetSheet)) {
      console.warn(`[Excel Parser] Target sheet "${targetSheet}" not found. Available sheets:`, workbook.SheetNames);
      // Use first sheet as fallback
      targetSheet = workbook.SheetNames[0];
      console.log(`[Excel Parser] Using first sheet instead: ${targetSheet}`);
    }
    
    console.log(`[Excel Parser] Using sheet: ${targetSheet}`);
    
    const worksheet = workbook.Sheets[targetSheet];
    
    if (debug) {
      // Get the range of the worksheet
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      console.log(`[Excel Parser] Worksheet range: ${XLSX.utils.encode_range(range)}`);
      console.log(`[Excel Parser] Total cells: ${range.e.r + 1} rows x ${range.e.c + 1} columns`);
      
      // Get first few rows for debugging
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      console.log(`[Excel Parser] First 5 rows of sheet "${targetSheet}":`, jsonData.slice(0, 5));
      console.log(`[Excel Parser] Total rows in sheet: ${jsonData.length}`);
      
      if (jsonData.length > 0 && jsonData[0].length > 0) {
        console.log(`[Excel Parser] Column headers:`, jsonData[0]);
      }
    }
    
    return {
      workbook,
      targetSheet,
      worksheet
    };
  } catch (error) {
    console.error(`[Excel Parser] Failed to parse workbook for ${fileName}:`, error);
    throw error;
  }
};

/**
 * Extract data from worksheet for specific columns
 */
export const extractColumnData = (worksheet, rowColumn, dataColumn, debug = true) => {
  try {
    console.log(`[Excel Parser] Extracting data: rowColumn="${rowColumn}", dataColumn="${dataColumn}"`);
    
    // Convert worksheet to JSON with headers
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1,
      defval: '',
      blankrows: false,
      raw: false
    });
    
    if (!jsonData || jsonData.length === 0) {
      console.log('[Excel Parser] No data found in worksheet');
      return [];
    }
    
    console.log(`[Excel Parser] Total rows in data: ${jsonData.length}`);
    
    if (debug && jsonData.length > 0) {
      console.log('[Excel Parser] First row (headers):', jsonData[0]);
      console.log('[Excel Parser] First 5 rows of data:', jsonData.slice(0, 5));
    }
    
    // Find column indices
    const headers = jsonData[0] || [];
    
    console.log('[Excel Parser] Available headers:', headers);
    
    // Find column indices - case insensitive and with trimming
    const rowColumnIndex = headers.findIndex(header => 
      header && String(header).trim().toLowerCase() === rowColumn.toLowerCase()
    );
    
    const dataColumnIndex = headers.findIndex(header => 
      header && String(header).trim().toLowerCase() === dataColumn.toLowerCase()
    );
    
    console.log(`[Excel Parser] Column indices found: row="${rowColumn}"=${rowColumnIndex}, data="${dataColumn}"=${dataColumnIndex}`);
    
    if (rowColumnIndex === -1) {
      console.error(`[Excel Parser] Row column "${rowColumn}" not found in headers`);
      console.error('[Excel Parser] Available headers:', headers.map((h, i) => `${i}: "${h}"`).join(', '));
      return [];
    }
    
    if (dataColumnIndex === -1) {
      console.error(`[Excel Parser] Data column "${dataColumn}" not found in headers`);
      console.error('[Excel Parser] Available headers:', headers.map((h, i) => `${i}: "${h}"`).join(', '));
      return [];
    }
    
    // Extract data
    const extractedData = [];
    let skippedRows = 0;
    
    for (let i = 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;
      
      const rowValue = row[rowColumnIndex];
      const dataValue = row[dataColumnIndex];
      
      // Skip empty rows or rows without branch name
      if (!rowValue || String(rowValue).trim() === '') {
        skippedRows++;
        continue;
      }
      
      // Parse numeric value
      const numericValue = parseNumericValue(dataValue);
      if (numericValue === null) {
        console.log(`[Excel Parser] Skipping row ${i}: Could not parse value "${dataValue}" for "${rowValue}"`);
        skippedRows++;
        continue;
      }
      
      extractedData.push({
        rowValue: String(rowValue).trim(),
        numericValue,
        rowIndex: i,
        rawValue: dataValue,
        dataColumn: dataColumn
      });
      
      if (debug && extractedData.length <= 5) {
        console.log(`[Excel Parser] Extracted: "${rowValue}" = ${numericValue}`);
      }
    }
    
    console.log(`[Excel Parser] Successfully extracted ${extractedData.length} rows, skipped ${skippedRows} rows`);
    
    if (extractedData.length > 0) {
      console.log('[Excel Parser] Sample extracted data (first 10):', 
        extractedData.slice(0, 10).map(d => `${d.rowValue}: ${d.numericValue}`)
      );
    }
    
    return extractedData;
  } catch (error) {
    console.error('[Excel Parser] Error extracting column data:', error);
    return [];
  }
};

/**
 * Parse numeric value from various formats - UPDATED FOR YOUR FORMAT
 */
const parseNumericValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  // If already a number
  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }
  
  // If string, try to parse
  if (typeof value === 'string') {
    // Remove everything except digits, decimal point, and minus sign
    // But keep commas for thousands separators
    const cleanStr = value
      .replace(/[^\d.,-]/g, '')  // Keep digits, dots, commas, minus
      .replace(/,/g, '')         // Remove commas for parsing
      .trim();
    
    // Try to parse as float
    const num = parseFloat(cleanStr);
    return isNaN(num) ? null : num;
  }
  
  // Try to convert to number
  const num = Number(value);
  return isNaN(num) ? null : num;
};

/**
 * Get all available columns from worksheet
 */
export const getAvailableColumns = (worksheet) => {
  try {
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    if (!jsonData || jsonData.length === 0) return [];
    
    const headers = jsonData[0] || [];
    return headers
      .map((header, index) => ({
        index,
        name: header ? String(header).trim() : `Column ${index + 1}`,
        original: header
      }))
      .filter(col => col.name !== '');
  } catch (error) {
    console.error('[Excel Parser] Error getting available columns:', error);
    return [];
  }
};

/**
 * Parse multiple reports targeting Country sheet
 */
export const parseMultipleReports = async (reports, rowColumn, dataColumn, debug = true) => {
  console.log(`[Excel Parser] Starting to parse ${reports.length} reports`);
  console.log(`[Excel Parser] Looking for: row="${rowColumn}", data="${dataColumn}"`);
  
  const allData = [];
  let successfulParses = 0;
  let failedParses = 0;
  
  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    console.log(`\n[Excel Parser] Processing report ${i + 1}/${reports.length}: ${report.fileName}`);
    
    try {
      // Parse the file targeting "Country" sheet
      const { worksheet, targetSheet } = await parseExcelFile(report, 'Country', { debug });
      
      console.log(`[Excel Parser] Extracting data from sheet: ${targetSheet}`);
      
      const data = extractColumnData(worksheet, rowColumn, dataColumn, debug);
      
      if (data.length > 0) {
        // Add metadata to each data point
        const enrichedData = data.map(item => ({
          ...item,
          date: report.date,
          fileName: report.fileName,
          department: report.department,
          reportId: report.id,
          reportIndex: i,
          sheetName: targetSheet
        }));
        
        allData.push(...enrichedData);
        successfulParses++;
        
        console.log(`[Excel Parser] ✓ Report ${report.fileName}: extracted ${data.length} rows from "${targetSheet}" sheet`);
      } else {
        console.log(`[Excel Parser] ⚠ Report ${report.fileName}: no data extracted from "${targetSheet}" sheet`);
        failedParses++;
        
        // Try to get available columns to help debug
        try {
          const columns = getAvailableColumns(worksheet);
          console.log(`[Excel Parser] Available columns in "${targetSheet}" sheet:`, 
            columns.map(c => `"${c.name}"`).join(', ')
          );
        } catch (colError) {
          console.log(`[Excel Parser] Could not get columns: ${colError.message}`);
        }
      }
    } catch (error) {
      console.error(`[Excel Parser] ✗ Report ${report.fileName}: failed with error:`, error.message);
      failedParses++;
    }
  }
  
  console.log(`\n[Excel Parser] Completed: ${successfulParses} successful, ${failedParses} failed`);
  console.log(`[Excel Parser] Total data points extracted: ${allData.length}`);
  
  if (allData.length > 0) {
    console.log('[Excel Parser] Unique branches found:', [...new Set(allData.map(d => d.rowValue))]);
    console.log('[Excel Parser] Sample data structure:', allData.slice(0, 3));
  }
  
  return allData;
};

/**
 * Special function to extract country-level data only
 */
export const extractCountryData = async (reports, dataColumn, debug = true) => {
  console.log(`[Excel Parser] Extracting Country-level data for column: ${dataColumn}`);
  
  const allCountryData = [];
  
  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    console.log(`\n[Excel Parser] Processing Country data from: ${report.fileName}`);
    
    try {
      const { worksheet } = await parseExcelFile(report, 'Country', { debug });
      const data = extractColumnData(worksheet, 'Branch', dataColumn, debug);
      
      // Filter for country row only
      const countryData = data.filter(item => 
        item.rowValue && 
        item.rowValue.toString().toLowerCase().includes('country')
      );
      
      if (countryData.length > 0) {
        const enrichedData = countryData.map(item => ({
          ...item,
          date: report.date,
          fileName: report.fileName,
          isCountryData: true
        }));
        
        allCountryData.push(...enrichedData);
        console.log(`[Excel Parser] ✓ Found Country data: ${countryData[0].rowValue} = ${countryData[0].numericValue}`);
      } else {
        console.log(`[Excel Parser] ⚠ No Country row found in ${report.fileName}`);
      }
    } catch (error) {
      console.error(`[Excel Parser] ✗ Error extracting Country data from ${report.fileName}:`, error.message);
    }
  }
  
  return allCountryData;
};