import { useState, useEffect, useRef, useCallback } from 'react';
import { getAllReports, getBatchReportData } from '../../../../../services/reports';
import { cacheGet, cacheSet, cacheInvalidate } from '../../../../../services/cache';
import { useReportRefresh } from '../../../../../contexts/ReportRefreshContext';

// Reports are fetched via getAllReports(limit 500, type MANAGEMENT). All management reports
// are included in parsedReports; reports with no report_data get an empty-metrics shape so they still appear in the UI.

// In-memory cache for parsed data (survives navigation)
const parsedDataCache = new Map();
let batchDataCache = null;

// Clear cache on module load to ensure fresh data after code changes
parsedDataCache.clear();
batchDataCache = null;

export const useManagementData = (selectedDepartment, fromDate = null, toDate = null) => {
  const { refreshTrigger, lastReportUpdate } = useReportRefresh();
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

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await getAllReports({ limit: 500, type: 'MANAGEMENT' });

      if (result.success) {
        const reportsData = (result.data || []).map(report => {
          const createdAt = report.createdAt || report.created_at
            ? new Date(report.createdAt || report.created_at)
            : new Date();
          const date = report.date != null && report.date !== ''
            ? (report.date instanceof Date ? report.date : new Date(report.date))
            : createdAt;
          return {
            id: report.id,
            ...report,
            fileName: report.fileName || report.file_name,
            fileUrl: report.fileUrl || report.file_url,
            filePath: report.filePath || report.file_path,
            fileSize: report.fileSize || report.file_size,
            createdAt,
            date // Normalized report date for sorting (like CSReports)
          };
        });
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
  }, []);

  // Listen for refresh events (e.g. report metadata edited in Report Management)
  useEffect(() => {
    if (refreshTrigger > 0) {

      parsedDataCache.clear();
      batchDataCache = null;
      cacheInvalidate('reports');
      cacheInvalidate('dashboard');
      initialLoadDone.current = false;
      fetchReports();
    }
  }, [refreshTrigger, fetchReports]);

  useEffect(() => {
    if (!initialLoadDone.current) {
      fetchReports();
      initialLoadDone.current = true;
    }
  }, [fetchReports]);

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

    // Sort by report date (latest first), like CSReports – so ordering stays correct after metadata edit
    const sorted = filtered.sort((a, b) => {
      const dateA = (a.date || a.createdAt)?.getTime ? (a.date || a.createdAt).getTime() : new Date(a.date || a.createdAt).getTime();
      const dateB = (b.date || b.createdAt)?.getTime ? (b.date || b.createdAt).getTime() : new Date(b.date || b.createdAt).getTime();
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

        const batchResult = await getBatchReportData();
        
        if (!batchResult.success) {
          console.error('Batch fetch failed:', batchResult.error);
          setError('Failed to load report data');
          setParsing(false);
          return;
        }
        
        batchData = batchResult.data || {};
        batchDataCache = batchData;

      } else {

      }
      
      // Transform batch data to expected format for each report. Include ALL reports so they are visible;
      // reports with no parsed data get empty metrics (row-data-only) so analysis can show them too.
      const parsed = managementReports.map(report => {
        const reportData = batchData[report.id];
        if (reportData && reportData.length > 0) {
          return transformBackendData(report, reportData);
        }
        return reportToParsedRow(report);
      });

      setParsedReports(parsed);
    } catch (err) {
      console.error('Error loading parsed data:', err);
      setError('Failed to load report data');
    } finally {
      setParsing(false);
    }
  };

  // Build parsed-report shape with empty metrics so reports without report_data still appear in the UI
  const reportToParsedRow = (report) => {
    const emptyBranches = { 'CS': {}, 'Cs Asset Finance': {} };
    const lbfEmpty = { 'LBF': {}, 'IPF': {}, 'MIF': {}, 'MIF Customs': {}, 'Lbf Yard Finance': {}, 'LBF QUICKCASH': {}, 'LBF-FLEX': {} };
    const effectiveDate = report.date || report.createdAt;
    return {
      ...report,
      countrywise: {},
      cs: {},
      csBranches: emptyBranches,
      lbf: {},
      lbfBranches: lbfEmpty,
      sme: {},
      zanzibar: {},
      agrifinance: {},
      date: effectiveDate
    };
  };

  // Transform backend report_data rows into the expected frontend format
  const transformBackendData = (report, data) => {
    const countrywiseData = {};
    const csData = {};
    const csBranches = { 'CS - MAINLAND': {}, 'CS': {}, 'Cs Asset Finance': {} };
    const lbfData = {};
    const lbfBranches = { 'LBF': {}, 'IPF': {}, 'MIF': {}, 'MIF Customs': {}, 'Lbf Yard Finance': {}, 'LBF QUICKCASH': {}, 'LBF-FLEX': {} };
    const smeData = {};
    const zanzibarData = {};
    let agrifinanceData = {};

    /* The management report renamed its CS rows when CS was split into two
       reporting units: the 'CS' row became 'CS - MAINLAND' and 'ZANZIBAR'
       became 'CS - ZANZIBAR'. Both spellings are listed so that reports filed
       before the rename still parse.

       Until this was noticed, nothing matched 'CS - MAINLAND', so CS had no
       Target row of its own and its target came out as 1 — the placeholder on
       'Cs Asset Finance' — which the score card printed as 84,553,626,955%
       achieved. */
    const csBranchNames = ['CS - MAINLAND', 'CS', 'Cs Asset Finance'];
    const zanzibarBranchNames = ['CS - ZANZIBAR', 'ZANZIBAR'];

    /* Sub-products with no target of their own carry a placeholder 1 (and a
       0.05 daily target): Cs Asset Finance, Cs Buyoff, IPF, LBF-FLEX,
       LBF QUICKCASH, CNG Loan, SALARY ADVANCE. Summing those placeholders is
       what made LBF's target read 5,105,000,003 rather than 5,105,000,000.
       One shilling is not a target. */
    const isPlaceholderTarget = (metric, v) =>
      (metric === 'Target' && v === 1) || (metric === 'Daily Target' && v > 0 && v < 1);
    const lbfBranchNames = ['LBF', 'IPF', 'MIF', 'MIF Customs', 'Lbf Yard Finance', 'LBF QUICKCASH', 'LBF-FLEX'];
    // Only the row named "Agrifinance" (or "AgriFinance") in the management report - no summing with other branches
    const agriFinanceBranchNames = ['AgriFinance', 'Agrifinance'];

    // Normalize metric names to canonical form (handles "Active Clients" vs "Active clients")
    const normalizeMetric = (m) => {
      if (!m || typeof m !== 'string') return m;
      const lower = m.toLowerCase();
      if (lower === 'number of clients') return 'Number of Clients';
      if (lower === 'active clients') return 'Active clients';
      if (lower === 'inactive clients') return 'Inactive clients';
      return m;
    };

    // First pass: build per-branch data (last value wins per branch+metric to avoid duplicate summing)
    data.forEach(row => {
      const branch = row.branch;
      const metric = normalizeMetric(row.metric_name || row.metricName);
      const value = row.metric_value ?? row.metricValue ?? 0;
      const numVal = typeof value === 'number' && !isNaN(value) ? value : parseFloat(value) || 0;

      if (branch === 'Country') {
        countrywiseData[metric] = numVal;
      } else if (csBranchNames.includes(branch)) {
        if (!csBranches[branch]) csBranches[branch] = {};
        csBranches[branch][metric] = numVal; // Last value wins (deduplicates if backend has duplicate rows)
      } else if (lbfBranchNames.includes(branch)) {
        if (!lbfBranches[branch]) lbfBranches[branch] = {};
        lbfBranches[branch][metric] = numVal; // Last value wins
      } else if (branch === 'SME') {
        smeData[metric] = numVal;
      } else if (zanzibarBranchNames.includes(branch)) {
        zanzibarData[metric] = numVal;
      } else if (agriFinanceBranchNames.includes(branch)) {
        if (!agrifinanceData) agrifinanceData = {};
        agrifinanceData[metric] = numVal; // Use the Agrifinance row from management report only
      }
    });

    // Second pass: sum branches to compute CS and LBF totals (avoids double summing if backend had duplicates)
    const csMetrics = new Set();
    const lbfMetrics = new Set();
    csBranchNames.forEach((branch) => {
      Object.keys(csBranches[branch] || {}).forEach((m) => csMetrics.add(m));
    });
    lbfBranchNames.forEach((branch) => {
      Object.keys(lbfBranches[branch] || {}).forEach((m) => lbfMetrics.add(m));
    });
    const sumBranches = (names, store, metric) => names.reduce((sum, branch) => {
      const v = store[branch]?.[metric] || 0;
      return sum + (isPlaceholderTarget(metric, v) ? 0 : v);
    }, 0);
    csMetrics.forEach((metric) => {
      csData[metric] = sumBranches(csBranchNames, csBranches, metric);
    });
    lbfMetrics.forEach((metric) => {
      lbfData[metric] = sumBranches(lbfBranchNames, lbfBranches, metric);
    });

    /* Make the CS history mean the same thing as the present.
     *
     * Before CS was split, the report carried ONE 'CS' row covering the whole
     * product and a separate 'ZANZIBAR' row that was part of it, not a sibling.
     * Checked on 31-08-2026: the management CS row — 1,045,944,930.11 over 679
     * loans — is the CS MTD grand total to the shilling, and that grand total
     * contains Zanzibar's 326,730,729.54.
     *
     * So a month-on-month comparison put this month's Mainland against last
     * month's Mainland-plus-Zanzibar and read it as a 40% collapse, when
     * Mainland against Mainland is about 13%. Where a report predates the
     * rename, Zanzibar is taken back out so both sides of every comparison,
     * trend and total mean Mainland.
     *
     * It also removes a double count: the score card lists CS and CS Zanzibar
     * as separate products, so for those months the company total counted
     * Zanzibar twice.
     *
     * Ratios are not additive and are left alone; average loan size is
     * recomputed from the corrected figures just below. */
    const usesOldCombinedCS =
      Object.keys(csBranches['CS - MAINLAND'] || {}).length === 0 &&
      Object.keys(csBranches['CS'] || {}).length > 0 &&
      Object.keys(zanzibarData).length > 0;

    const csCorrected = new Set();
    if (usesOldCombinedCS) {
      const nonAdditive = (m) => m.includes('%') || /^PAR/i.test(m) || /average/i.test(m);
      Object.keys(csData).forEach((metric) => {
        if (nonAdditive(metric)) return;
        const whole = csData[metric];
        const part = zanzibarData[metric] || 0;
        // A Zanzibar value of 0 against a non-zero CS one is a hole in the
        // report, not a real zero: on 31-08-2026 the Zanzibar row carried
        // 326,730,729.54 of disbursement but 0 loans, where the MTD counted
        // 199. Those metrics are left uncorrected, and anything derived from
        // them is left alone too — see the average below.
        if (typeof whole !== 'number' || typeof part !== 'number' || part === 0) return;
        const rest = whole - part;
        // A negative result would mean Zanzibar was never inside this row after
        // all. Leave the figure alone rather than invent one.
        if (rest >= 0) {
          csData[metric] = rest;
          csCorrected.add(metric);
        }
      });
    }

    // Average Loan Size (total) = Disbursement this month / Number of Loans (not sum of sub-product averages)
    const csDisb = csData['Disbursements This Month'] ?? csData['Disbursement this Month'] ?? csData['Disbursement This Month'] ?? 0;
    const csLoans = csData['Number of loans'] ?? csData['Number of Loans'] ?? 0;
    /* Recompute only when both halves of the fraction mean the same thing.
       Where Zanzibar was taken out of the disbursement but its loan count was
       missing, dividing one by the other invents an average far below either
       figure — 1.06m against a real 1.5m on August's numbers. The report's own
       average is closer to the truth than that, so it is left as filed. */
    const avgIsConsistent = !usesOldCombinedCS
      || (csCorrected.has('Disbursements This Month') === csCorrected.has('Number of loans'));
    if (avgIsConsistent && csLoans > 0 && typeof csDisb === 'number' && typeof csLoans === 'number') {
      csData['Average loan size'] = csDisb / csLoans;
    }
    const lbfDisb = lbfData['Disbursements This Month'] ?? lbfData['Disbursement this Month'] ?? lbfData['Disbursement This Month'] ?? 0;
    const lbfLoans = lbfData['Number of loans'] ?? lbfData['Number of Loans'] ?? 0;
    if (lbfLoans > 0 && typeof lbfDisb === 'number' && typeof lbfLoans === 'number') {
      lbfData['Average loan size'] = lbfDisb / lbfLoans;
    }

    // Prefer report_date from report_data (sync writes correct date) over report.date (may be stale)
    const dataDate = data.find(r => r.report_date || r.reportDate);
    const effectiveDate = (dataDate?.report_date || dataDate?.reportDate) || report.date || report.createdAt;

    return {
      ...report,
      countrywise: countrywiseData,
      cs: csData,
      csBranches,
      lbf: lbfData,
      lbfBranches,
      sme: smeData,
      zanzibar: zanzibarData,
      agrifinance: agrifinanceData || {},
      date: effectiveDate
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
