import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '../../../../../services/firebase';
import { getReportFileUrl } from '../../../../../services/supabase';
import * as XLSX from 'xlsx';

/**
 * Convert Excel column letter to number (A=1, B=2, ..., Z=26, AA=27, etc.)
 * @param {string} col - Excel column letter (e.g., 'A', 'B', 'AA', 'AE')
 * @returns {number} Column number (1-indexed)
 */
const excelColToNumber = (col) => {
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result;
};

/**
 * Extract all data from a sheet (for lead summary)
 * @param {Object} workbook - XLSX workbook object
 * @param {string} sheetName - Name of the sheet
 * @returns {Array} Array of objects with all data from the sheet
 */
const extractAllSheetData = (workbook, sheetName) => {
  try {
    if (!workbook.SheetNames.includes(sheetName)) {
      console.warn(`Sheet '${sheetName}' not found. Available sheets:`, workbook.SheetNames);
      return [];
    }

    const worksheet = workbook.Sheets[sheetName];
    
    // Convert entire sheet to JSON array
    const allData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      blankrows: false
    });

    if (!allData || allData.length === 0) {
      console.warn(`No data found in sheet '${sheetName}'`);
      return [];
    }

    console.log(`[extractAllSheetData] Sheet '${sheetName}' has ${allData.length} rows`);

    // Find the maximum number of columns
    const maxCols = Math.max(...allData.map(row => row ? row.length : 0), 0);
    
    // Use first row as headers, or generate column names
    // Keep "Column_X" as keys to preserve all columns, but we'll display empty string in the UI
    const headers = allData[0] || [];
    const headerMap = [];
    for (let i = 0; i < maxCols; i++) {
      const header = headers[i] ? String(headers[i]).trim() : `Column_${i + 1}`;
      headerMap.push(header);
    }

    // Convert to array of objects
    const result = [];
    for (let rowIdx = 1; rowIdx < allData.length; rowIdx++) {
      const row = allData[rowIdx] || [];
      const rowObj = {};
      let hasContent = false;

      for (let colIdx = 0; colIdx < maxCols; colIdx++) {
        const header = headerMap[colIdx];
        let cellValue = row[colIdx];
        
        // Handle empty/null values
        if (cellValue === null || cellValue === undefined || cellValue === '') {
          cellValue = '';
        } else if (typeof cellValue === 'number') {
          // Convert numbers between 0 and 1 (exclusive) with more than 4 decimal places to percentages
          if (cellValue > 0 && cellValue < 1) {
            const decimalStr = cellValue.toString();
            const decimalPart = decimalStr.includes('.') ? decimalStr.split('.')[1] : '';
            if (decimalPart.length > 4) {
              cellValue = `${(cellValue * 100).toFixed(2)}%`;
            }
          }
        } else {
          const strValue = String(cellValue).trim();
          const parsedNum = parseFloat(strValue);
          if (!isNaN(parsedNum) && parsedNum > 0 && parsedNum < 1) {
            const decimalStr = parsedNum.toString();
            const decimalPart = decimalStr.includes('.') ? decimalStr.split('.')[1] : '';
            if (decimalPart.length > 4) {
              cellValue = `${(parsedNum * 100).toFixed(2)}%`;
            } else {
              cellValue = strValue;
            }
          } else {
            cellValue = strValue;
          }
        }
        
        rowObj[header] = cellValue;
        
        if (cellValue !== '' && cellValue !== 'None' && cellValue !== 'NaN' && cellValue !== 'undefined') {
          hasContent = true;
        }
      }

      if (hasContent) {
        result.push(rowObj);
      }
    }

    console.log(`[extractAllSheetData] Extracted ${result.length} rows from ${sheetName}`);
    return result;
  } catch (error) {
    console.error(`[extractAllSheetData] Error extracting data from ${sheetName}:`, error);
    return [];
  }
};

/**
 * Extract data from summary sheet - finds agent summary and team leader summary by text markers
 * @param {Object} workbook - XLSX workbook object
 * @param {string} sheetName - Name of the sheet (usually 'summary')
 * @returns {Object} Object with agentSummary and teamLeaderSummary arrays
 */
const extractSummarySheetData = (workbook, sheetName) => {
  try {
    if (!workbook.SheetNames.includes(sheetName)) {
      console.warn(`Sheet '${sheetName}' not found. Available sheets:`, workbook.SheetNames);
      return { agentSummary: [], teamLeaderSummary: [] };
    }

    const worksheet = workbook.Sheets[sheetName];
    
    // Convert entire sheet to JSON array
    const allData = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      blankrows: false
    });

    if (!allData || allData.length === 0) {
      console.warn(`No data found in sheet '${sheetName}'`);
      return { agentSummary: [], teamLeaderSummary: [] };
    }

    console.log(`[extractSummarySheetData] Sheet '${sheetName}' has ${allData.length} rows`);

    // Find maximum columns
    const maxCols = Math.max(...allData.map(row => row ? row.length : 0), 0);
    
    // Find first occurrence of "SALES AGENT" (case insensitive)
    let salesAgentRow = -1;
    let salesAgentCol = -1;
    let foundSalesAgent = false;
    
    for (let rowIdx = 0; rowIdx < allData.length && !foundSalesAgent; rowIdx++) {
      const row = allData[rowIdx] || [];
      for (let colIdx = 0; colIdx < maxCols && !foundSalesAgent; colIdx++) {
        const cellValue = row[colIdx];
        const cellStr = String(cellValue || '').trim().toUpperCase();
        if (cellStr.includes('SALES AGENT')) {
          salesAgentRow = rowIdx;
          salesAgentCol = colIdx;
          foundSalesAgent = true;
          console.log(`[extractSummarySheetData] Found "SALES AGENT" at row ${rowIdx}, col ${colIdx}`);
          break;
        }
      }
    }

    // Find first occurrence of "TEAM LEADER" or "TEAM LEADERS" (case insensitive)
    let teamLeaderRow = -1;
    let teamLeaderCol = -1;
    let foundTeamLeader = false;
    
    for (let rowIdx = 0; rowIdx < allData.length && !foundTeamLeader; rowIdx++) {
      const row = allData[rowIdx] || [];
      for (let colIdx = 0; colIdx < maxCols && !foundTeamLeader; colIdx++) {
        const cellValue = row[colIdx];
        const cellStr = String(cellValue || '').trim().toUpperCase();
        if (cellStr.includes('TEAM LEADER')) {
          teamLeaderRow = rowIdx;
          teamLeaderCol = colIdx;
          foundTeamLeader = true;
          console.log(`[extractSummarySheetData] Found "TEAM LEADER" at row ${rowIdx}, col ${colIdx}`);
          break;
        }
      }
    }

    // Extract agent summary: from "SALES AGENT" row until column containing "TEAM LEADER"
    let agentSummary = [];
    if (foundSalesAgent) {
      // Find the end column - stop when we meet a column that contains "TEAM LEADER"
      let agentEndCol = maxCols;
      if (foundTeamLeader) {
        // Agent summary ends at the column where "TEAM LEADER" is found
        agentEndCol = teamLeaderCol;
      } else {
        // If no "TEAM LEADER" found, find first completely empty column after sales agent
        for (let colIdx = salesAgentCol; colIdx < maxCols; colIdx++) {
          let isEmpty = true;
          for (let rowIdx = salesAgentRow; rowIdx < allData.length; rowIdx++) {
            const cellValue = allData[rowIdx] ? allData[rowIdx][colIdx] : null;
            if (cellValue !== null && cellValue !== undefined && cellValue !== '' && String(cellValue).trim() !== '') {
              isEmpty = false;
              break;
            }
          }
          if (isEmpty) {
            agentEndCol = colIdx;
            break;
          }
        }
      }

      // Extract rows: from "SALES AGENT" row until completely empty row
      let agentEndRow = allData.length;
      for (let rowIdx = salesAgentRow + 1; rowIdx < allData.length; rowIdx++) {
        const row = allData[rowIdx] || [];
        let isRowEmpty = true;
        for (let colIdx = salesAgentCol; colIdx < agentEndCol; colIdx++) {
          const cellValue = row[colIdx];
          if (cellValue !== null && cellValue !== undefined && cellValue !== '' && String(cellValue).trim() !== '') {
            isRowEmpty = false;
            break;
          }
        }
        if (isRowEmpty) {
          agentEndRow = rowIdx;
          break;
        }
      }

      agentSummary = extractTableFromRange(allData, salesAgentRow, agentEndRow, salesAgentCol, agentEndCol, maxCols);
      console.log(`[extractSummarySheetData] Agent summary: ${agentSummary.length} rows (rows ${salesAgentRow}-${agentEndRow}, cols ${salesAgentCol}-${agentEndCol})`);
    }

    // Extract team leader summary: from "TEAM LEADER" row until completely empty column and row
    let teamLeaderSummary = [];
    if (foundTeamLeader) {
      // Find end column - completely empty column
      let tlEndCol = maxCols;
      for (let colIdx = teamLeaderCol; colIdx < maxCols; colIdx++) {
        let isEmpty = true;
        for (let rowIdx = teamLeaderRow; rowIdx < allData.length; rowIdx++) {
          const cellValue = allData[rowIdx] ? allData[rowIdx][colIdx] : null;
          if (cellValue !== null && cellValue !== undefined && cellValue !== '' && String(cellValue).trim() !== '') {
            isEmpty = false;
            break;
          }
        }
        if (isEmpty) {
          tlEndCol = colIdx;
          break;
        }
      }

      // Find end row - completely empty row
      let tlEndRow = allData.length;
      for (let rowIdx = teamLeaderRow + 1; rowIdx < allData.length; rowIdx++) {
        const row = allData[rowIdx] || [];
        let isRowEmpty = true;
        for (let colIdx = teamLeaderCol; colIdx < tlEndCol; colIdx++) {
          const cellValue = row[colIdx];
          if (cellValue !== null && cellValue !== undefined && cellValue !== '' && String(cellValue).trim() !== '') {
            isRowEmpty = false;
            break;
          }
        }
        if (isRowEmpty) {
          tlEndRow = rowIdx;
          break;
        }
      }

      teamLeaderSummary = extractTableFromRange(allData, teamLeaderRow, tlEndRow, teamLeaderCol, tlEndCol, maxCols);
      console.log(`[extractSummarySheetData] Team leader summary: ${teamLeaderSummary.length} rows (rows ${teamLeaderRow}-${tlEndRow}, cols ${teamLeaderCol}-${tlEndCol})`);
    }

    return { agentSummary, teamLeaderSummary };
  } catch (error) {
    console.error(`[extractSummarySheetData] Error extracting data from ${sheetName}:`, error);
    return { agentSummary: [], teamLeaderSummary: [] };
  }
};

/**
 * Extract table data from a specific row and column range
 * @param {Array} allData - 2D array of all sheet data
 * @param {number} startRow - Start row index (0-indexed, inclusive)
 * @param {number} endRow - End row index (0-indexed, exclusive)
 * @param {number} startCol - Start column index (0-indexed, inclusive)
 * @param {number} endCol - End column index (0-indexed, exclusive)
 * @param {number} maxCols - Maximum columns in sheet
 * @returns {Array} Array of objects
 */
const extractTableFromRange = (allData, startRow, endRow, startCol, endCol, maxCols) => {
  if (allData.length === 0 || startRow >= endRow || startCol >= endCol) {
    return [];
  }

  // Use the start row as headers
  // Keep "Column_X" as keys to preserve all columns, but we'll display empty string in the UI
  const headerRow = allData[startRow] || [];
  const headers = [];
  for (let colIdx = startCol; colIdx < endCol && colIdx < maxCols; colIdx++) {
    const header = headerRow[colIdx] ? String(headerRow[colIdx]).trim() : `Column_${colIdx + 1}`;
    headers.push(header);
  }

  // Extract data rows (start from startRow + 1 to skip header row)
  const result = [];
  for (let rowIdx = startRow + 1; rowIdx < endRow && rowIdx < allData.length; rowIdx++) {
    const row = allData[rowIdx] || [];
    const rowObj = {};
    let hasContent = false;

    for (let colIdx = startCol; colIdx < endCol && colIdx < maxCols; colIdx++) {
      const header = headers[colIdx - startCol];
      let cellValue = row[colIdx];
      
      // Handle empty/null values
      if (cellValue === null || cellValue === undefined || cellValue === '') {
        cellValue = '';
      } else if (typeof cellValue === 'number') {
        // Convert numbers between 0 and 1 (exclusive) with more than 4 decimal places to percentages
        if (cellValue > 0 && cellValue < 1) {
          const decimalStr = cellValue.toString();
          const decimalPart = decimalStr.includes('.') ? decimalStr.split('.')[1] : '';
          if (decimalPart.length > 4) {
            cellValue = `${(cellValue * 100).toFixed(2)}%`;
          }
        }
      } else {
        const strValue = String(cellValue).trim();
        const parsedNum = parseFloat(strValue);
        if (!isNaN(parsedNum) && parsedNum > 0 && parsedNum < 1) {
          const decimalStr = parsedNum.toString();
          const decimalPart = decimalStr.includes('.') ? decimalStr.split('.')[1] : '';
          if (decimalPart.length > 4) {
            cellValue = `${(parsedNum * 100).toFixed(2)}%`;
          } else {
            cellValue = strValue;
          }
        } else {
          cellValue = strValue;
        }
      }
      
      rowObj[header] = cellValue;
      
      if (cellValue !== '' && cellValue !== 'None' && cellValue !== 'NaN' && cellValue !== 'undefined') {
        hasContent = true;
      }
    }

    // Include row if it has any content
    if (hasContent) {
      result.push(rowObj);
    }
  }

  return result;
};

export const useCRMData = (department, selectedDate = null) => {
  const [reports, setReports] = useState([]);
  const [parsedData, setParsedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchCRMReports();
  }, [department]);

  useEffect(() => {
    if (reports.length > 0) {
      parseReports();
    } else {
      setParsedData(null);
    }
  }, [reports, selectedDate]);

  const fetchCRMReports = async () => {
    try {
      setLoading(true);
      setError(null);

      const reportsRef = collection(db, 'reports');
      
      // Try with orderBy first, fallback to without if index is missing
      let q = query(
        reportsRef,
        where('type', '==', 'CRM'),
        where('department', '==', department),
        where('isActive', '==', true),
        orderBy('date', 'desc')
      );

      let snapshot;
      try {
        snapshot = await getDocs(q);
      } catch (orderByError) {
        console.warn('OrderBy failed, fetching without orderBy:', orderByError);
        q = query(
          reportsRef,
          where('type', '==', 'CRM'),
          where('department', '==', department),
          where('isActive', '==', true)
        );
        snapshot = await getDocs(q);
      }

      const reportsData = [];

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const fileName = data.fileName || data.title || 'Unknown';
        
        // Check if file name contains CRM pattern (CS_CRM, LBF_CRM, SME_CRM)
        const crmPattern = department === 'CS' ? 'CS_CRM' : 
                          department === 'LBF' ? 'LBF_CRM' : 
                          department === 'SME' ? 'SME_CRM' : 'CRM';
        
        if (fileName.includes(crmPattern)) {
          let fileUrl = data.fileUrl;
          
          if (!fileUrl && data.filePath) {
            try {
              fileUrl = await getReportFileUrl(data.filePath);
            } catch (e) {
              console.warn(`Could not get file URL for ${fileName}:`, e);
              continue;
            }
          }

          if (fileUrl) {
            reportsData.push({
              id: doc.id,
              ...data,
              fileUrl,
              date: data.date?.toDate ? data.date.toDate() : new Date(data.date || Date.now())
            });
          }
        }
      }

      // Sort by date manually if orderBy wasn't used
      reportsData.sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date : new Date(a.date);
        const dateB = b.date instanceof Date ? b.date : new Date(b.date);
        return dateB - dateA;
      });

      setReports(reportsData);
    } catch (err) {
      console.error('Error fetching CRM reports:', err);
      setError('Failed to load CRM reports');
    } finally {
      setLoading(false);
    }
  };

  const parseReports = async () => {
    if (reports.length === 0) {
      setParsedData(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      // Use selected date report or most recent report
      let targetReport = reports[0];
      if (selectedDate) {
        const selected = reports.find(r => {
          const reportDate = r.date instanceof Date ? r.date : new Date(r.date);
          const selectDate = selectedDate instanceof Date ? selectedDate : new Date(selectedDate);
          return reportDate.toDateString() === selectDate.toDateString();
        });
        if (selected) {
          targetReport = selected;
        }
      }
      const latestReport = targetReport;
      
      if (!latestReport.fileUrl) {
        setError('No file URL available for parsing');
        setParsedData(null);
        return;
      }

      // Fetch and parse the Excel file
      const response = await fetch(latestReport.fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, {
        type: 'array',
        cellDates: true,
        cellNF: false,
        cellText: false,
        raw: false
      });

      const sheetNames = workbook.SheetNames;
      const parsed = {
        reportDate: latestReport.date,
        fileName: latestReport.fileName || latestReport.title,
        emailData: null, // Text/Value pairs from Email sheet
        leadsSummary: null, // Data from LEADS_SUMMARY sheet
        agentSummary: null, // Agent data from summary sheet
        teamLeaderSummary: null, // Team leader data from summary sheet
        historicalData: [] // For trend analysis
      };

      // Parse Email sheet (Text/Value pairs)
      if (sheetNames.includes('Email')) {
        const worksheet = workbook.Sheets['Email'];
        const emailData = XLSX.utils.sheet_to_json(worksheet);
        parsed.emailData = emailData;
      }

      // Extract data using new logic:
      // 1. Lead summary: Get all data from LEADS_SUMMARY/LEAD SUMMARY sheet (leave empty cells as empty)
      // 2. Agent summary & Team leader: Extract from "summary" sheet by detecting empty columns
      
      const getLeadSummarySheetName = (dept) => {
        if (dept === 'CS') {
          return 'LEADS_SUMMARY';
        } else {
          return 'LEAD SUMMARY';
        }
      };

      const leadSummarySheet = getLeadSummarySheetName(department);
      
      // Extract lead summary - get all data from the sheet
      if (sheetNames.includes(leadSummarySheet)) {
        const leadsData = extractAllSheetData(workbook, leadSummarySheet);
        parsed.leadsSummary = leadsData;
        console.log(`[parseReports] Extracted ${leadsData.length} rows from ${leadSummarySheet}`);
      }

      // Extract agent summary and team leader summary from "summary" sheet
      if (sheetNames.includes('summary')) {
        const summaryData = extractSummarySheetData(workbook, 'summary');
        parsed.agentSummary = summaryData.agentSummary;
        parsed.teamLeaderSummary = summaryData.teamLeaderSummary;
        console.log(`[parseReports] Extracted agent summary: ${summaryData.agentSummary.length} rows, team leader: ${summaryData.teamLeaderSummary.length} rows`);
      }

      // Parse historical reports for trend analysis
      if (reports.length > 1) {
        const historicalParsed = [];
        for (let i = 1; i < Math.min(reports.length, 10); i++) { // Get last 10 reports
          try {
            const histResponse = await fetch(reports[i].fileUrl);
            if (histResponse.ok) {
              const histArrayBuffer = await histResponse.arrayBuffer();
              const histWorkbook = XLSX.read(histArrayBuffer, {
                type: 'array',
                cellDates: true,
                cellNF: false,
                cellText: false,
                raw: false
              });
              
              if (histWorkbook.SheetNames.includes('Email')) {
                const histWorksheet = histWorkbook.Sheets['Email'];
                const histEmailData = XLSX.utils.sheet_to_json(histWorksheet);
                historicalParsed.push({
                  date: reports[i].date,
                  emailData: histEmailData
                });
              }
            }
          } catch (e) {
            console.warn(`Failed to parse historical report ${i}:`, e);
          }
        }
        parsed.historicalData = historicalParsed;
      }

      // Check if we have at least some data
      if (parsed.emailData || parsed.leadsSummary) {
        setParsedData(parsed);
      } else {
        setParsedData(null);
        setError('No valid data found in the report file');
      }
    } catch (err) {
      console.error('Error parsing CRM data:', err);
      setError(`Failed to parse CRM data: ${err.message}`);
      setParsedData(null);
    } finally {
      setLoading(false);
    }
  };

  return {
    reports,
    parsedData,
    loading,
    error,
    hasData: parsedData !== null,
    refreshData: fetchCRMReports
  };
};

