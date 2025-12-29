// utils/excelUtils.js
import * as XLSX from 'xlsx';

export const parseProblematicExcel = async (arrayBuffer) => {
  try {
    // Try to read with minimal settings
    const workbook = XLSX.read(arrayBuffer, {
      type: 'array',
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      cellDates: false,
      raw: true,
      sheetStubs: true,
      WTF: false,
    });
    
    // Find sheets that are likely to have data
    const dataSheets = [];
    
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const range = worksheet['!ref'];
      
      if (range) {
        // Convert to JSON with multiple attempts
        try {
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
          if (jsonData && jsonData.length > 1) {
            dataSheets.push({
              name: sheetName,
              data: jsonData,
              rowCount: jsonData.length - 1,
              colCount: jsonData[0]?.length || 0
            });
          }
        } catch (e) {
          console.warn(`Could not parse sheet ${sheetName}:`, e.message);
        }
      }
    });
    
    // Sort by data amount (most data first)
    dataSheets.sort((a, b) => b.rowCount - a.rowCount || b.colCount - a.colCount);
    
    return {
      success: true,
      sheets: dataSheets,
      totalSheets: workbook.SheetNames.length,
      hasPivotTables: dataSheets.length === 0 && workbook.SheetNames.length > 0
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      suggestion: 'File may be password protected or use unsupported features'
    };
  }
};




