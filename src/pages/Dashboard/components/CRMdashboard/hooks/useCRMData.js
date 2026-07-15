import { useState, useEffect, useRef } from 'react';
import { getReportsByDepartmentAndType } from '../../../../../services/reports';
import { getReportFileUrl } from '../../../../../services/supabase';
import { cacheGet, cacheSet, cacheInvalidate } from '../../../../../services/cache';
import { useReportRefresh } from '../../../../../contexts/ReportRefreshContext';
import * as XLSX from 'xlsx';

// In-memory cache for parsed CRM data
const crmParsedCache = new Map();

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

    return result;
  } catch (error) {
    console.error(`[extractAllSheetData] Error extracting data from ${sheetName}:`, error);
    return [];
  }
};

/**
 * Extract agent + team-leader summary tables from the Summary sheet.
 *
 * The report stacks the blocks VERTICALLY, each led by a title cell in column A
 * ("SALES AGENTS — by ZONE", "TEAM LEADERS — by BRANCH", …). For each role we
 * pick the block matching `preferGroup` (zone for CS, branch for LBF/SME),
 * falling back to whichever block for that role exists.
 *
 * @returns {{ agentSummary: {indexLabel, rows}, teamLeaderSummary: {indexLabel, rows} }}
 */
const extractSummarySheetData = (workbook, sheetName, preferGroup = 'zone') => {
  const empty = () => ({ indexLabel: 'Group', rows: [] });
  try {
    if (!workbook.SheetNames.includes(sheetName)) {
      return { agentSummary: empty(), teamLeaderSummary: empty() };
    }
    const aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1, defval: '', blankrows: true,
    });

    // Locate every block by its title cell in column A.
    const blockDefs = [];
    for (let r = 0; r < aoa.length; r++) {
      const c0 = String((aoa[r] || [])[0] || '').toUpperCase();
      const role = c0.includes('SALES AGENT') ? 'agent' : c0.includes('TEAM LEADER') ? 'tl' : null;
      if (role) blockDefs.push({ role, group: c0.includes('BRANCH') ? 'branch' : 'zone', titleRow: r });
    }

    // Parse one block: header row = titleRow+1, data until a blank row or TOTAL.
    const parseBlock = (titleRow) => {
      const headerRow = aoa[titleRow + 1] || [];
      let lastCol = 0;
      for (let c = 0; c < headerRow.length; c++) {
        if (String(headerRow[c] ?? '').trim() !== '') lastCol = c;
      }
      const indexLabel = String(headerRow[0] ?? '').trim() || 'Group';
      const colLabels = [];
      for (let c = 1; c <= lastCol; c++) colLabels.push(String(headerRow[c] ?? '').trim() || `Column_${c + 1}`);

      const rows = [];
      for (let r = titleRow + 2; r < aoa.length; r++) {
        const row = aoa[r] || [];
        const first = String(row[0] ?? '').trim();
        if (first === '') break;
        const isTotal = first.toUpperCase() === 'TOTAL';
        const obj = { __index: first, __isTotal: isTotal };
        colLabels.forEach((lab, i) => { obj[lab] = row[i + 1] ?? ''; });
        rows.push(obj);
        if (isTotal) break;
      }
      return { indexLabel, rows };
    };

    const pick = (role) => {
      const match = blockDefs.find((b) => b.role === role && b.group === preferGroup)
        || blockDefs.find((b) => b.role === role);
      return match ? parseBlock(match.titleRow) : empty();
    };

    return { agentSummary: pick('agent'), teamLeaderSummary: pick('tl') };
  } catch (error) {
    console.error(`[extractSummarySheetData] Error extracting data from ${sheetName}:`, error);
    return { agentSummary: empty(), teamLeaderSummary: empty() };
  }
};

/** @deprecated legacy side-by-side extractor (kept for reference). */
const _extractSummarySheetDataLegacy = (workbook, sheetName) => {
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

/**
 * Find a sheet by name, tolerant of case / spacing / underscore differences.
 * @returns {string|null} the actual sheet name, or null
 */
const findSheet = (sheetNames, ...candidates) => {
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s_]+/g, ' ');
  const wanted = candidates.map(norm);
  return sheetNames.find((n) => wanted.includes(norm(n))) || null;
};

/**
 * Maps the new "Email Summary" sheet (Section | Metric | Value) to the legacy
 * Email-sheet keys the UI reads. Keyed by "section|metric" (normalised).
 * Each entry lists every legacy key the value should populate (aliases used
 * across the CS / LBF / SME dashboard variants).
 */
const EMAIL_SUMMARY_MAP = {
  // ── Leads ──────────────────────────────────────────────────────────────
  'leads|leads generated':          ['lead', 'count_leads', 'total_count_leads'],
  'leads|accepted consent':         ['accepted_lead', 'number_consented_lead'],
  'leads|not provided':             ['not_provided_lead'],
  'leads|rejected':                 ['rejected_lead'],
  'leads|prospects':                ['prospect_lead'],
  'leads|% accepted':               ['percentage_accepted_lead', 'percentage_consented_lead'],
  // ── Sales Agents ───────────────────────────────────────────────────────
  'sales agents|actual on crm':        ['total_agent', 'total_count_agent'],
  'sales agents|logged in':            ['total_agent_logged_in', 'logged_in_agent'],
  'sales agents|assigned activities':  ['agent_assigned_activities'],
  'sales agents|completing at location': ['agent_completed_at_location', 'agents_completed_at_location'],
  'sales agents|activity completion rate': ['percentage_agent_completed_at_location'],
  'sales agents|locations planned':    ['agent_location_planned', 'agents_location_planned'],
  'sales agents|locations reached':    ['agent_reached_location', 'agents_location_reached'],
  'sales agents|% locations reached':  ['percentage_reached_location', 'percentage_agents_location_reached'],
  "sales agents|assigned in today's plan": ['todays_agents_assigned', 'todays_agents_assigned_activities'],
  'sales agents|% assigned today':     ['percentage_todays_agents_assigned'],
  // Extended detail (branch lists + today plan)
  'sales agents|branches with no location visited (count)':    ['agent_count_without_planned_location'],
  'sales agents|branches with no location visited':            ['agent_branch_without_planned_location'],
  'sales agents|branches with no activities assigned (count)': ['branches_count_without_assgned_activities'],
  'sales agents|branches with no activities assigned':         ['branches_without_assgned_activities', 'agents_no_assigned_location'],
  'sales agents|today locations planned':                      ['todays_locations_planned', 'agents_todays_location_planned', 'today_tl_location_planned'],
  'sales agents|avg locations visited':                        ['average_location_agent_visited', 'today_average_location_visited', 'todays_average_location_visited_by_agents'],
  // ── Team Leaders ───────────────────────────────────────────────────────
  'team leaders|actual on crm':        ['count_team_leaders', 'total_count_team_leaders'],
  'team leaders|logged in':            ['logged_in_team_leaders'],
  'team leaders|assigned activities':  ['team_leaders_assigned_activities'],
  'team leaders|completing at location': ['team_leaders_completed_at_location', 'tl_completed_activities_at_location'],
  'team leaders|activity completion rate': ['percentage_completed_at_location', 'percentage_tl_completed_at_location'],
  'team leaders|locations planned':    ['team_leaders_location_planned', 'tl_location_planned', 'tl_planned_visited_location'],
  'team leaders|locations reached':    ['team_leaders_location_reached', 'tl_location_reached'],
  'team leaders|% locations reached':  ['percentage_tl_location_reached'],
  "team leaders|assigned in today's plan": ['todays_tls_assigned_activities', 'today_tl_assigned_activities'],
  'team leaders|% assigned today':     ['percentage_today_tl_assigned_activities'],
  // Extended detail (branch lists + today plan)
  'team leaders|branches with no location visited (count)':    ['branches_tl_count_no_planned_location'],
  'team leaders|branches with no location visited':            ['branches_tl_no_planned_location', 'tl_no_assigned_planned_location'],
  'team leaders|branches with no activities assigned (count)': ['branches_tl_count_no_assigned_activites'],
  'team leaders|branches with no activities assigned':         ['branches_tl_no_assigned_activities'],
  'team leaders|today locations planned':                      ['todays_tls_location_planned', 'today_tl_location_planned'],
  'team leaders|avg locations visited':                        ['average_location_visited_by_tl'],
};

/**
 * Parse the new "Email Summary" sheet into the legacy [{Text, Value}] shape so
 * the existing UI (extractMetrics / getValue) works unchanged. Unmapped rows
 * are still exposed under a generated snake_case key so nothing is lost.
 */
const extractEmailSummarySheet = (workbook, sheetName) => {
  try {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const out = [];
    let currentSection = '';

    for (const row of rows) {
      const c0 = norm(row[0]);
      const c1 = norm(row[1]);
      const value = row[2];

      if (!c0 && !c1) continue;                       // blank row
      if (c0 === 'email summary') continue;           // title row
      if (c0 === 'section' && c1 === 'metric') continue; // header row

      if (c0) currentSection = c0;
      const section = c0 || currentSection;
      const metric  = c1;
      if (!metric) continue;

      const mapKey  = `${section}|${metric}`;
      const legacy  = EMAIL_SUMMARY_MAP[mapKey];
      if (legacy && legacy.length) {
        legacy.forEach((k) => out.push({ Text: k, Value: value }));
      } else {
        // Fallback so unmapped metrics are still available (not silently dropped).
        out.push({ Text: `${section}_${metric}`.replace(/[^a-z0-9]+/g, '_'), Value: value });
      }
    }
    return out;
  } catch (error) {
    console.error(`[extractEmailSummarySheet] Error reading '${sheetName}':`, error);
    return [];
  }
};

export const useCRMData = (department, selectedDate = null) => {
  const { refreshTrigger } = useReportRefresh();
  const [reports, setReports] = useState([]);
  const [parsedData, setParsedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Listen for refresh events
  useEffect(() => {
    if (refreshTrigger > 0) {

      crmParsedCache.clear();
      cacheInvalidate('reports');
      setParsedData(null);
      fetchCRMReports();
    }
  }, [refreshTrigger, department]);

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

      // Use Go API instead of Firebase
      const result = await getReportsByDepartmentAndType(department, 'CRM');

      if (!result.success) {
        setError(result.error || 'Failed to load CRM reports');
        setReports([]);
        return;
      }

      const reportsData = [];

      for (const report of result.data || []) {
        const fileName = report.fileName || report.file_name || report.title || 'Unknown';
        
        // Check if file name contains CRM pattern (CS_CRM, LBF_CRM, SME_CRM)
        const crmPattern = department === 'CS' ? 'CS_CRM' : 
          department === 'LBF' ? 'LBF_CRM' : 
            department === 'SME' ? 'SME_CRM' : 'CRM';
        
        if (fileName.includes(crmPattern)) {
          let fileUrl = report.fileUrl || report.file_url;
          
          if (!fileUrl && (report.filePath || report.file_path)) {
            try {
              fileUrl = await getReportFileUrl(report.filePath || report.file_path);
            } catch (e) {
              console.warn(`Could not get file URL for ${fileName}:`, e);
              continue;
            }
          }

          if (fileUrl) {
            reportsData.push({
              id: report.id,
              ...report,
              fileName,
              fileUrl,
              date: report.date ? new Date(report.date) : 
                report.created_at ? new Date(report.created_at) : new Date()
            });
          }
        }
      }

      // Sort by date
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
      // When selectedDate is provided, ONLY use data for that exact date - do NOT fall back to latest
      let targetReport = null;
      if (selectedDate) {
        const selected = reports.find(r => {
          const reportDate = r.date instanceof Date ? r.date : new Date(r.date);
          const selectDate = selectedDate instanceof Date ? selectedDate : new Date(selectedDate);
          return reportDate.toDateString() === selectDate.toDateString();
        });
        targetReport = selected || null;
      } else {
        targetReport = reports[0];
      }
      const latestReport = targetReport;

      if (!latestReport) {
        setParsedData(null);
        setLoading(false);
        return;
      }
      
      // Check cache first
      const cacheKey = `crm_${department}_${latestReport.id}`;
      if (crmParsedCache.has(cacheKey)) {

        setParsedData(crmParsedCache.get(cacheKey));
        setLoading(false);
        return;
      }
      
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
        emailData: null,
        leadsSummary: null,
        agentSummary: null,
        teamLeaderSummary: null,
        historicalData: [] // Skip historical data to improve performance
      };

      // ── Email metrics ──────────────────────────────────────────────────────
      // Legacy format: an "Email" sheet of Text/Value pairs. New format
      // (crm_reports.py): an "Email Summary" sheet of Section/Metric/Value.
      // Prefer the legacy sheet when present, otherwise fall back to the new one.
      const emailSheet = findSheet(sheetNames, 'Email');
      if (emailSheet) {
        parsed.emailData = XLSX.utils.sheet_to_json(workbook.Sheets[emailSheet]);
      }
      if (!parsed.emailData || parsed.emailData.length === 0) {
        const emailSummarySheet = findSheet(sheetNames, 'Email Summary', 'Email_Summary');
        if (emailSummarySheet) {
          parsed.emailData = extractEmailSummarySheet(workbook, emailSummarySheet);
        }
      }

      // ── Lead summary ───────────────────────────────────────────────────────
      // Match any casing/spacing variant ('LEADS_SUMMARY', 'LEAD SUMMARY', 'Lead Summary').
      const leadSummarySheet = findSheet(sheetNames, 'LEADS_SUMMARY', 'LEAD SUMMARY', 'Lead Summary', 'Leads Summary');
      if (leadSummarySheet) {
        parsed.leadsSummary = extractAllSheetData(workbook, leadSummarySheet);
      }

      // ── Agent / Team-leader summary (case-insensitive 'summary' / 'Summary') ─
      const summarySheet = findSheet(sheetNames, 'summary', 'Summary');
      if (summarySheet) {
        const preferGroup = department === 'CS' ? 'zone' : 'branch';
        const summaryData = extractSummarySheetData(workbook, summarySheet, preferGroup);
        parsed.agentSummary = summaryData.agentSummary;
        parsed.teamLeaderSummary = summaryData.teamLeaderSummary;
      }

      // Check if we have at least some data
      if (parsed.emailData || parsed.leadsSummary) {
        // Cache the parsed result
        crmParsedCache.set(cacheKey, parsed);
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

