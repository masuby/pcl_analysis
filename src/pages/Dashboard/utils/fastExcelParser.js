import * as XLSX from 'xlsx';
import { getReportFileUrl } from '../../../services/supabase';

export const parseExcelFile = async (report, targetSheet = 'Country', options = {}) => {
  const { maxAttempts = 3, timeout = 30000 } = options;

  try {
    let fileUrl;
    if (report.filePath) {
      fileUrl = await getReportFileUrl(report.filePath);
    } else if (report.fileUrl) {
      fileUrl = report.fileUrl;
    } else {
      throw new Error('No file URL or path available');
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch(fileUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return parseExcelData(arrayBuffer, report.fileName, targetSheet);
  } catch (error) {
    console.error(`Failed to parse ${report.fileName}:`, error);
    throw error;
  }
};

const parseExcelData = (arrayBuffer, fileName, targetSheet) => {
  try {
    const workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellDates: true,
      cellNF: true,
      cellText: true,
      raw: false,
      dense: false
    });
    
    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('Workbook has no sheets');
    }
    
    if (!workbook.SheetNames.includes(targetSheet)) {
      targetSheet = workbook.SheetNames[0];
    }
    
    const worksheet = workbook.Sheets[targetSheet];
    
    return {
      workbook,
      targetSheet,
      worksheet
    };
  } catch (error) {
    console.error(`Failed to parse workbook for ${fileName}:`, error);
    throw error;
  }
};

export const extractColumnData = (worksheet, rowColumn, dataColumn) => {
  try {
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
      header: 1,
      defval: '',
      blankrows: false,
      raw: false
    });
    
    if (!jsonData || jsonData.length === 0) {
      return [];
    }
    
    const headers = jsonData[0] || [];
    const rowColumnIndex = headers.findIndex(header => 
      header && String(header).trim().toLowerCase() === rowColumn.toLowerCase()
    );
    
    const dataColumnIndex = headers.findIndex(header => 
      header && String(header).trim().toLowerCase() === dataColumn.toLowerCase()
    );
    
    if (rowColumnIndex === -1 || dataColumnIndex === -1) {
      return [];
    }
    
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
        rowIndex: i,
        rawValue: dataValue,
        dataColumn: dataColumn
      });
    }
    
    return extractedData;
  } catch (error) {
    return [];
  }
};

const parseNumericValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }
  
  if (typeof value === 'string') {
    const cleanStr = value
      .replace(/[^\d.,-]/g, '')
      .replace(/,/g, '')
      .trim();
    
    const num = parseFloat(cleanStr);
    return isNaN(num) ? null : num;
  }
  
  const num = Number(value);
  return isNaN(num) ? null : num;
};

export const parseMultipleReports = async (reports, rowColumn, dataColumn) => {
  const allData = [];
  
  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    
    try {
      const { worksheet, targetSheet } = await parseExcelFile(report, 'Country');
      const data = extractColumnData(worksheet, rowColumn, dataColumn);
      
      if (data.length > 0) {
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
      }
    } catch (error) {
      continue;
    }
  }
  
  return allData;
};

export const extractCountryData = async (reports, dataColumn) => {
  const allCountryData = [];
  
  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    
    try {
      const { worksheet } = await parseExcelFile(report, 'Country');
      const data = extractColumnData(worksheet, 'Branch', dataColumn);
      
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
      }
    } catch (error) {
      continue;
    }
  }
  
  return allCountryData;
};