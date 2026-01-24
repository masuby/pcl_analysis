import { useState, useEffect } from 'react';
import { getReportsByDepartmentAndType } from '../../../../../services/reports';
import { getReportFileUrl } from '../../../../../services/supabase';
import * as XLSX from 'xlsx';

// In-memory cache for parsed Call Center data
const callCenterParsedCache = new Map();

export const useCallCenterData = (department, selectedDate = null) => {
  const [reports, setReports] = useState([]);
  const [parsedData, setParsedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchCallCenterReports();
  }, [department]);

  useEffect(() => {
    if (reports.length > 0) {
      parseReports();
    } else {
      setParsedData(null);
    }
  }, [reports, selectedDate]);

  const fetchCallCenterReports = async () => {
    try {
      setLoading(true);
      setError(null);

      // Use Go API instead of Firebase
      const result = await getReportsByDepartmentAndType(department, 'CALL CENTER');

      if (!result.success) {
        setError(result.error || 'Failed to load call center reports');
        setReports([]);
        return;
      }

      const reportsData = [];

      for (const report of result.data || []) {
        const fileName = report.fileName || report.file_name || report.title || 'Unknown';
        
        // Check if file name contains FINAL_CDR_CALL_REPORT
        if (fileName.includes('FINAL_CDR_CALL_REPORT')) {
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
      console.error('Error fetching call center reports:', err);
      setError('Failed to load call center reports');
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
      
      // Check cache first
      const cacheKey = `callcenter_${department}_${latestReport.id}`;
      if (callCenterParsedCache.has(cacheKey)) {
        console.log(`[Cache] Using cached Call Center data for ${latestReport.fileName}`);
        setParsedData(callCenterParsedCache.get(cacheKey));
        setLoading(false);
        return;
      }
      
      if (!latestReport.fileUrl) {
        setError('No file URL available for parsing');
        setParsedData(null);
        return;
      }

      console.log(`[CallCenter] Parsing Excel file: ${latestReport.fileName}`);

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

      // Parse all 5 sheets
      const sheetNames = workbook.SheetNames;
      const parsed = {
        reportDate: latestReport.date,
        fileName: latestReport.fileName || latestReport.title,
        allCallData: null,
        agentPerformance: null,
        outboundSummary: null,
        inboundSummary: null,
        callNotesSummary: null
      };

      // Parse All_Call_Data sheet
      if (sheetNames.includes('All_Call_Data')) {
        const worksheet = workbook.Sheets['All_Call_Data'];
        parsed.allCallData = XLSX.utils.sheet_to_json(worksheet);
      }

      // Parse Agent_Performance sheet
      if (sheetNames.includes('Agent_Performance')) {
        const worksheet = workbook.Sheets['Agent_Performance'];
        parsed.agentPerformance = XLSX.utils.sheet_to_json(worksheet);
      }

      // Parse Outbound_Summary sheet
      if (sheetNames.includes('Outbound_Summary')) {
        const worksheet = workbook.Sheets['Outbound_Summary'];
        parsed.outboundSummary = XLSX.utils.sheet_to_json(worksheet);
      }

      // Parse Inbound_Summary sheet
      if (sheetNames.includes('Inbound_Summary')) {
        const worksheet = workbook.Sheets['Inbound_Summary'];
        parsed.inboundSummary = XLSX.utils.sheet_to_json(worksheet);
      }

      // Parse Call_Notes_Summary sheet
      if (sheetNames.includes('Call_Notes_Summary')) {
        const worksheet = workbook.Sheets['Call_Notes_Summary'];
        parsed.callNotesSummary = XLSX.utils.sheet_to_json(worksheet);
      }

      // Check if we have at least some data
      if (parsed.allCallData || parsed.agentPerformance) {
        // Cache the parsed result
        callCenterParsedCache.set(cacheKey, parsed);
        setParsedData(parsed);
      } else {
        setParsedData(null);
        setError('No valid data found in the report file');
      }
    } catch (err) {
      console.error('Error parsing call center data:', err);
      setError(`Failed to parse call center data: ${err.message}`);
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
    refreshData: fetchCallCenterReports
  };
};
