import { useState, useEffect, useRef, useCallback } from 'react';
import { getReportsByDepartmentAndType } from '../../../../../services/reports';
import { getReportFileUrl } from '../../../../../services/supabase';
import { cacheInvalidate } from '../../../../../services/cache';
import { useReportRefresh } from '../../../../../contexts/ReportRefreshContext';
import * as XLSX from 'xlsx';

// In-memory cache for parsed MTD data
const mtdParsedCache = new Map();

/**
 * Process MTD Excel file and extract data
 */
const processExcelFile = async (fileUrl, fileName, department) => {
  try {
    const response = await fetch(fileUrl);
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
    console.log('[MTD] Sheet names:', sheetNames);
    console.log('[MTD] Department:', department);
    
    // Find the MTD sheet (first sheet) and Sales Listing sheet
    let mtdSheetName = sheetNames[0];
    let listingSheetName = null;
    
    // Look for LISTING sheet by name (handle typos like LISITING)
    for (const name of sheetNames) {
      const upper = name.toUpperCase();
      if (upper.includes('LISTING') || upper.includes('LISITING')) {
        listingSheetName = name;
        break;
      }
    }
    
    // Fallback to last sheet
    if (!listingSheetName && sheetNames.length >= 2) {
      listingSheetName = sheetNames[sheetNames.length - 1];
    }
    
    console.log('[MTD] Using sheets:', { mtdSheetName, listingSheetName });
    
    // ============================================
    // STEP 1: Read Listing sheet FIRST to get supervisions
    // ============================================
    let listingData = [];
    let supervisions = [];
    let teamLeadersFromListing = [];
    
    if (listingSheetName && workbook.Sheets[listingSheetName]) {
      const listingRaw = XLSX.utils.sheet_to_json(workbook.Sheets[listingSheetName], { header: 1 });
      
      // Find header row
      let listingHeaderIndex = 0;
      for (let i = 0; i < Math.min(5, listingRaw.length); i++) {
        const row = listingRaw[i];
        if (row && row.some(cell => {
          const cellStr = String(cell || '').toUpperCase().trim();
          return cellStr === 'SALES REP' || 
                 cellStr === 'SALES REP. NAME' ||
                 cellStr.includes('SUPERVISION') || 
                 cellStr === 'TERM';
        })) {
          listingHeaderIndex = i;
          break;
        }
      }
      
      const listingHeaders = listingRaw[listingHeaderIndex] || [];
      console.log('[MTD] Listing headers:', listingHeaders);
      
      // Find supervision and team columns
      const supervisionColIdx = listingHeaders.findIndex(h => 
        h && String(h).toUpperCase().includes('SUPERVISION')
      );
      const teamColIdx = listingHeaders.findIndex(h => 
        h && String(h).toUpperCase() === 'TEAM'
      );
      // For CS, team leader column might be "Branch"
      const branchColIdx = listingHeaders.findIndex(h => 
        h && String(h).toUpperCase() === 'BRANCH'
      );
      
      console.log('[MTD] Column indices:', { supervisionColIdx, teamColIdx, branchColIdx });
      
      // Extract listing data
      for (let i = listingHeaderIndex + 1; i < listingRaw.length; i++) {
        const row = listingRaw[i];
        if (row && row.length > 0) {
          const rowObj = {};
          let hasData = false;
          listingHeaders.forEach((header, idx) => {
            if (header && row[idx] !== undefined && row[idx] !== null && row[idx] !== '') {
              rowObj[header] = row[idx];
              hasData = true;
            }
          });
          if (hasData && Object.keys(rowObj).length > 0) {
            listingData.push(rowObj);
          }
        }
      }
      
      // Get unique supervisions
      if (supervisionColIdx !== -1) {
        const supCol = listingHeaders[supervisionColIdx];
        supervisions = [...new Set(listingData.map(r => r[supCol]).filter(Boolean))];
      }
      
      // Get unique team leaders (for LBF it's TEAM, for CS it's Branch)
      const tlColIdx = teamColIdx !== -1 ? teamColIdx : branchColIdx;
      if (tlColIdx !== -1) {
        const tlCol = listingHeaders[tlColIdx];
        teamLeadersFromListing = [...new Set(listingData.map(r => r[tlCol]).filter(Boolean))];
      }
      
      console.log('[MTD] Supervisions from listing:', supervisions.length, supervisions.slice(0, 5));
      console.log('[MTD] Team leaders from listing:', teamLeadersFromListing.length, teamLeadersFromListing.slice(0, 5));
    }
    
    // ============================================
    // STEP 2: Read MTD sheet
    // ============================================
    const mtdRaw = XLSX.utils.sheet_to_json(workbook.Sheets[mtdSheetName], { header: 1 });
    
    // Find header row (row with NO. OF LOANS, VALUE, etc.)
    let headerRowIndex = 3;
    for (let i = 0; i < Math.min(10, mtdRaw.length); i++) {
      const row = mtdRaw[i];
      if (row && row.some(cell => {
        const cellStr = String(cell || '').toUpperCase();
        return cellStr.includes('NO. OF LOANS') || cellStr.includes('VALUE') || cellStr.includes('MONTH TARGET');
      })) {
        headerRowIndex = i;
        break;
      }
    }
    
    const headers = mtdRaw[headerRowIndex] || [];
    console.log('[MTD] MTD Headers at row', headerRowIndex, ':', headers.slice(0, 10));
    
    // Determine the branch/name column index
    // For CS: header has "BRANCH/ TEAM LEADER" at some index
    // For LBF: first column (index 0) contains the names, but header might be empty there
    let branchColIndex = headers.findIndex(h => {
      const hStr = String(h || '').toUpperCase();
      return hStr.includes('BRANCH') || hStr.includes('TEAM LEADER');
    });
    
    // If not found, default to column 0 (LBF case)
    if (branchColIndex === -1) {
      branchColIndex = 0;
    }
    
    // For CS, the branch column might be at index 1
    // Check the actual data to confirm
    const firstDataRow = mtdRaw[headerRowIndex + 1];
    if (firstDataRow) {
      // If column 0 is empty but column 1 has a supervision name, use column 1
      if (!firstDataRow[0] || !String(firstDataRow[0]).trim()) {
        if (firstDataRow[1] && String(firstDataRow[1]).trim()) {
          branchColIndex = 1;
        }
      }
      // If column 0 has a supervision name, use column 0
      else if (supervisions.some(s => 
        String(s).toUpperCase() === String(firstDataRow[0]).toUpperCase().trim()
      )) {
        branchColIndex = 0;
      }
    }
    
    console.log('[MTD] Using branch column index:', branchColIndex);
    
    const branchCol = headers[branchColIndex] || `Column_${branchColIndex}`;
    
    // Extract data rows and capture Grand Total row (for Gap Analysis overall total)
    const mtdData = [];
    let grandTotalRow = null;
    for (let i = headerRowIndex + 1; i < mtdRaw.length; i++) {
      const row = mtdRaw[i];
      if (row && row.length > 0) {
        const cellValue = row[branchColIndex];
        const cellStr = cellValue != null ? String(cellValue).trim() : '';
        const isGrandTotal = cellStr && cellStr.toUpperCase().includes('GRAND TOTAL');

        const rowObj = {};
        headers.forEach((header, idx) => {
          if (header) {
            rowObj[header] = row[idx];
          }
        });
        rowObj._branchValue = cellStr;
        rowObj._rowIndex = i;

        if (isGrandTotal) {
          grandTotalRow = rowObj;
          console.log('[MTD] Found Grand Total row');
        } else if (cellStr) {
          mtdData.push(rowObj);
        }
      }
    }

    console.log('[MTD] Extracted', mtdData.length, 'rows from MTD sheet');
    
    // ============================================
    // STEP 3: Group MTD data by supervision
    // ============================================
    const groupedData = {};
    let currentSupervision = null;
    
    for (const row of mtdData) {
      const branchValue = row._branchValue;
      
      // Check if this is a supervision row
      const isSupervision = supervisions.some(s => 
        s && branchValue && 
        String(s).toUpperCase().trim() === branchValue.toUpperCase().trim()
      );
      
      if (isSupervision) {
        currentSupervision = branchValue;
        groupedData[currentSupervision] = {
          supervision: currentSupervision,
          supervisionData: row,
          teamLeaders: []
        };
        console.log('[MTD] Found supervision:', currentSupervision);
      } else if (currentSupervision && branchValue) {
        // This is a team leader under the current supervision
        groupedData[currentSupervision].teamLeaders.push({
          name: branchValue,
          data: row,
          salesReps: []
        });
      }
    }
    
    // If no grouping found, use flat structure
    if (Object.keys(groupedData).length === 0 && mtdData.length > 0) {
      console.log('[MTD] No supervision grouping found, using flat structure');
      groupedData['All'] = {
        supervision: 'All',
        supervisionData: {},
        teamLeaders: mtdData.map(row => ({
          name: row._branchValue || '',
          data: row,
          salesReps: []
        }))
      };
    }
    
    console.log('[MTD] Grouped into', Object.keys(groupedData).length, 'supervisions');
    
    // ============================================
    // STEP 4: Match sales reps to team leaders
    // ============================================
    // For LBF: TEAM column in listing = team leader name
    // For CS: Branch column in listing = team leader name
    
    const listingHeadersArr = Object.keys(listingData[0] || {});
    const teamMatchCol = listingHeadersArr.find(k => k.toUpperCase() === 'TEAM') ||
                         listingHeadersArr.find(k => k.toUpperCase() === 'BRANCH');
    
    console.log('[MTD] Using team match column:', teamMatchCol);
    
    if (teamMatchCol && listingData.length > 0) {
      for (const supervision of Object.values(groupedData)) {
        for (const tl of supervision.teamLeaders) {
          const tlName = tl.name || '';
          const tlNameUpper = tlName.toUpperCase().trim();
          const tlNameNormalized = tlNameUpper.replace(/\s+/g, ' ');
          
          if (!tlNameNormalized) continue;
          
          // Match sales reps
          tl.salesReps = listingData.filter(r => {
            const matchValue = r[teamMatchCol];
            if (matchValue == null) return false;
            const matchUpper = String(matchValue).toUpperCase().trim();
            const matchNormalized = matchUpper.replace(/\s+/g, ' ');
            
            return matchNormalized === tlNameNormalized || 
                   matchNormalized.includes(tlNameNormalized) || 
                   tlNameNormalized.includes(matchNormalized);
          });
          
          if (tl.salesReps.length > 0) {
            console.log(`[MTD] TL "${tl.name}" has ${tl.salesReps.length} sales reps`);
          }
        }
      }
    }
    
    // Log summary
    let totalTLs = 0;
    let totalReps = 0;
    for (const sup of Object.values(groupedData)) {
      totalTLs += sup.teamLeaders.length;
      for (const tl of sup.teamLeaders) {
        totalReps += tl.salesReps.length;
      }
    }
    console.log(`[MTD] FINAL: ${Object.keys(groupedData).length} supervisions, ${totalTLs} TLs, ${totalReps} sales reps`);
    
    // Find column mappings for UI
    const salesRepCol = listingHeadersArr.find(k => k.toUpperCase() === 'SALES REP') ||
                        listingHeadersArr.find(k => k.toUpperCase() === 'SALES REP. NAME');
    const amountCol = listingHeadersArr.find(k => 
      k.toUpperCase().includes('DISBURSE') && k.toUpperCase().includes('AMOUNT')
    );
    const termCol = listingHeadersArr.find(k => k.toUpperCase() === 'TERM');
    
    return {
      headers,
      mtdData,
      listingData,
      supervisions,
      groupedData,
      grandTotalRow: grandTotalRow || null,
      branchCol,
      headerRowIndex,
      fileName,
      columnMap: {
        salesRep: salesRepCol,
        amount: amountCol,
        term: termCol,
        teamMatch: teamMatchCol
      }
    };
  } catch (error) {
    console.error('[MTD] Error processing Excel:', error);
    throw error;
  }
};

export const useMTDData = (department, selectedDate = null) => {
  const { refreshTrigger } = useReportRefresh();
  const [reports, setReports] = useState([]);
  const [parsedData, setParsedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const initialLoadDone = useRef(false);

  const fetchMTDReports = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await getReportsByDepartmentAndType(department, 'MTD');

      if (!result.success) {
        setError(result.error || 'Failed to load MTD reports');
        setReports([]);
        return;
      }

      const reportsData = [];

      for (const report of result.data || []) {
        const fileName = report.fileName || report.file_name || report.title || 'Unknown';
        
        const mtdPattern = department.toUpperCase();
        const hasMTD = fileName.toUpperCase().includes('MTD');
        const hasDept = fileName.toUpperCase().includes(mtdPattern);
        
        if (hasMTD && hasDept) {
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

      reportsData.sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date : new Date(a.date);
        const dateB = b.date instanceof Date ? b.date : new Date(b.date);
        return dateB - dateA;
      });

      console.log(`[MTD] Found ${reportsData.length} ${department} MTD reports`);
      setReports(reportsData);
    } catch (err) {
      console.error('Error fetching MTD reports:', err);
      setError('Failed to load MTD reports');
    } finally {
      setLoading(false);
      initialLoadDone.current = true;
    }
  }, [department]);

  // Listen for refresh events
  useEffect(() => {
    if (refreshTrigger > 0 && initialLoadDone.current) {
      console.log(`[MTDDashboard-${department}] Refresh triggered, clearing cache`);
      mtdParsedCache.clear();
      cacheInvalidate('reports');
      setParsedData(null);
      initialLoadDone.current = false;
      fetchMTDReports();
    }
  }, [refreshTrigger, department, fetchMTDReports]);

  // When department changes (e.g. CS → LBF in Gap Analysis), clear previous data and fetch the new department's reports
  useEffect(() => {
    setParsedData(null);
    setReports([]);
    setError(null);
    initialLoadDone.current = false;
    fetchMTDReports();
  }, [department, fetchMTDReports]);

  useEffect(() => {
    if (reports.length > 0) {
      parseReports();
    } else {
      setParsedData(null);
    }
  }, [reports, selectedDate]);

  const parseReports = async () => {
    if (reports.length === 0) {
      setParsedData(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
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
      
      const cacheKey = `mtd_${department}_${targetReport.id}`;
      if (mtdParsedCache.has(cacheKey)) {
        console.log(`[Cache] Using cached MTD data for ${targetReport.fileName}`);
        setParsedData(mtdParsedCache.get(cacheKey));
        setLoading(false);
        return;
      }
      
      if (!targetReport.fileUrl) {
        setError('No file URL available for parsing');
        setParsedData(null);
        return;
      }

      console.log(`[MTD] Parsing Excel file: ${targetReport.fileName}`);
      
      const data = await processExcelFile(targetReport.fileUrl, targetReport.fileName, department);
      
      const parsed = {
        ...data,
        reportDate: targetReport.date,
        reportId: targetReport.id
      };
      
      mtdParsedCache.set(cacheKey, parsed);
      setParsedData(parsed);
    } catch (err) {
      console.error('Error parsing MTD data:', err);
      setError(`Failed to parse MTD data: ${err.message}`);
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
    refreshData: fetchMTDReports
  };
};

export default useMTDData;
