import { useState, useEffect, useRef, useCallback } from 'react';
import { getAllReports, getBatchReportData } from '../../../../../services/reports';
import { cacheGet, cacheSet } from '../../../../../services/cache';

// In-memory cache for parsed data (survives navigation)
const parsedDataCache = new Map();
let batchDataCache = null;

// Clear cache on module load to ensure fresh data after code changes
parsedDataCache.clear();
batchDataCache = null;

export const useManagementData = (selectedDepartment, fromDate = null, toDate = null) => {
  const [allReports, setAllReports] = useState([]);
  const [managementReports, setManagementReports] = useState([]);
  const [parsedReports, setParsedReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    totalFiles: 0,
    totalSize: 0,
    totalViews: 0,
    totalDownloads: 0
  });
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (!initialLoadDone.current) {
      fetchReports();
      initialLoadDone.current = true;
    }
  }, []);

  useEffect(() => {
    filterReports();
  }, [allReports, selectedDepartment, fromDate, toDate]);

  useEffect(() => {
    if (managementReports.length > 0) {
      loadParsedData();
    } else {
      setParsedReports([]);
    }
  }, [managementReports]);

  const fetchReports = async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await getAllReports({ limit: 500, type: 'MANAGEMENT' });

      if (result.success) {
        const reportsData = (result.data || []).map(report => ({
          id: report.id,
          ...report,
          fileName: report.fileName || report.file_name,
          fileUrl: report.fileUrl || report.file_url,
          filePath: report.filePath || report.file_path,
          fileSize: report.fileSize || report.file_size,
          createdAt: report.createdAt || report.created_at 
            ? new Date(report.createdAt || report.created_at) 
            : new Date()
        }));
        setAllReports(reportsData);
      } else {
        setError(result.error || 'Failed to load reports');
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
      setError('Failed to load reports from database');
    } finally {
      setLoading(false);
    }
  };

  const filterReports = useCallback(() => {
    if (!allReports.length) {
      setManagementReports([]);
      return;
    }

    const filtered = allReports.filter(report => {
      const isManagement = report.type === 'MANAGEMENT';
      const matchesDepartment = 
        !selectedDepartment || 
        selectedDepartment === 'ALL' || 
        report.department === selectedDepartment ||
        report.department === 'ALL';

      const isActive = report.isActive !== false && report.is_active !== false;

      let inDateRange = true;
      if (fromDate || toDate) {
        const reportDate = report.date ? new Date(report.date) : report.createdAt;
        if (fromDate && reportDate < new Date(fromDate)) inDateRange = false;
        if (toDate && reportDate > new Date(toDate)) inDateRange = false;
      }

      return isManagement && matchesDepartment && isActive && inDateRange;
    });

    const sorted = filtered.sort((a, b) => {
      const dateA = a.createdAt?.getTime ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const dateB = b.createdAt?.getTime ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    setManagementReports(sorted);
    calculateStats(sorted);
  }, [allReports, selectedDepartment, fromDate, toDate]);

  // Load ALL pre-parsed data from backend in a SINGLE batch call (much faster!)
  const loadParsedData = async () => {
    if (!managementReports.length) return;

    setParsing(true);
    try {
      // Use batch endpoint - single call instead of 100+ individual calls
      let batchData = batchDataCache;
      
      if (!batchData) {
        console.log('[API] Fetching ALL report data in single batch call...');
        const batchResult = await getBatchReportData();
        
        if (!batchResult.success) {
          console.error('Batch fetch failed:', batchResult.error);
          setError('Failed to load report data');
          setParsing(false);
          return;
        }
        
        batchData = batchResult.data || {};
        batchDataCache = batchData;
        console.log(`[Batch] Loaded data for ${Object.keys(batchData).length} reports in single call`);
      } else {
        console.log('[Cache] Using cached batch data');
      }
      
      // Transform batch data to expected format for each report
      const parsed = managementReports.map(report => {
        const reportData = batchData[report.id];
        
        if (!reportData || reportData.length === 0) {
          return null;
        }

        // Transform backend data to expected format
        return transformBackendData(report, reportData);
      });

      const validParsed = parsed.filter(r => r !== null);
      setParsedReports(validParsed);
    } catch (err) {
      console.error('Error loading parsed data:', err);
      setError('Failed to load report data');
    } finally {
      setParsing(false);
    }
  };

  // Transform backend report_data rows into the expected frontend format
  const transformBackendData = (report, data) => {
    const countrywiseData = {};
    const csData = {};
    const csBranches = { 'CS': {}, 'Cs Asset Finance': {} };
    const lbfData = {};
    const lbfBranches = { 'LBF': {}, 'IPF': {}, 'MIF': {}, 'MIF Customs': {}, 'Lbf Yard Finance': {}, 'LBF QUICKCASH': {} };
    const smeData = {};
    const zanzibarData = {};

    const csBranchNames = ['CS', 'Cs Asset Finance'];
    const lbfBranchNames = ['LBF', 'IPF', 'MIF', 'MIF Customs', 'Lbf Yard Finance', 'LBF QUICKCASH'];

    // Group data by branch and metric
    data.forEach(row => {
      const branch = row.branch;
      const metric = row.metric_name || row.metricName;
      const value = row.metric_value || row.metricValue || 0;

      if (branch === 'Country') {
        countrywiseData[metric] = value;
      } else if (csBranchNames.includes(branch)) {
        csData[metric] = (csData[metric] || 0) + value;
        if (!csBranches[branch]) csBranches[branch] = {};
        csBranches[branch][metric] = value;
      } else if (lbfBranchNames.includes(branch)) {
        lbfData[metric] = (lbfData[metric] || 0) + value;
        if (!lbfBranches[branch]) lbfBranches[branch] = {};
        lbfBranches[branch][metric] = value;
      } else if (branch === 'SME') {
        smeData[metric] = value;
      } else if (branch === 'ZANZIBAR') {
        zanzibarData[metric] = value;
      }
    });

    return {
      ...report,
      countrywise: countrywiseData,
      cs: csData,
      csBranches,
      lbf: lbfData,
      lbfBranches,
      sme: smeData,
      zanzibar: zanzibarData,
      date: report.date || report.createdAt
    };
  };

  const calculateStats = (reports) => {
    const totalSize = reports.reduce((sum, r) => sum + (r.fileSize || 0), 0);
    const totalViews = reports.reduce((sum, r) => sum + (r.views || 0), 0);
    const totalDownloads = reports.reduce((sum, r) => sum + (r.downloads || 0), 0);

    setStats({
      totalFiles: reports.length,
      totalSize,
      totalViews,
      totalDownloads
    });
  };

  const refreshData = () => {
    initialLoadDone.current = false;
    parsedDataCache.clear();
    batchDataCache = null;
    fetchReports();
  };

  return {
    allReports,
    managementReports,
    parsedReports,
    stats,
    loading: loading || parsing,
    error,
    refreshData
  };
};
