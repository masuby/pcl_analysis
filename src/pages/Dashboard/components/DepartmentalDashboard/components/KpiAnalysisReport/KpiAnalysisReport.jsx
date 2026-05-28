import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './KpiAnalysisReport.css';
import { formatTzs, formatPercentAccounting, getWeightForKpiKey, loadCsKpiTargets, loadCsKpiClusterTargets, loadGenericKpiTargets } from './utils/csKpiTargets';

const CLUSTER_TARGET_ATTACHMENT_NAME = 'CS_KPI_CLUSTER_TARGET_NEW_FILE_2026.xlsx';
import { useManagementData } from '../../../ManagementDashboard/hooks/useManagementData';
import { useMTDData } from '../../../MTDdashboard/hooks/useMTDData';
import { getReportFileUrl } from '../../../../../../services/supabase';
import { getReportsByDepartmentAndType } from '../../../../../../services/reports';
import { gapAnalysisAPI } from '../../../../../../services/api';
import { exportMultipleSheetsWithStyles, buildWorkbookBuffer } from '../../utils/excelExportStyled';
import { sendScoreCardEmail } from '../../utils/emailScoreCard';
import { buildKpiReportEmailHTML, buildClusterKpiReportEmailHTML, buildNonCsKpiReportEmailHTML } from '../../utils/emailTemplateKpi';
import { kpiTargetsAPI } from '../../../../../../services/kpiTargets';
import { parseManagementReportCsBranches } from './utils/parseManagementReportCsBranches';
import { getBranchToClusterCS, getBranchesByClusterCS } from './utils/zoneClusterMapping';
import { buildRSMData, buildRSMDataFromBranches } from '../GapAnalysis/utils/gapAnalysisUtils';
import { parseCrmClusterSheets, aggregateCrmForCluster } from './utils/parseCrmClusterSheets';
import { ZONES_BY_CLUSTER_CS } from './ClusterKpis/constants';
import { getCrmEmailMetrics } from './utils/crmMetricsFromReport';
import { extractMetrics } from '../../../CRMdashboard/utils/crmUtils';
import { useCRMData } from '../../../CRMdashboard/hooks/useCRMData';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';
import ClusterKpiView from './ClusterKpis/ClusterKpiView';
import { useNonCsKpiAnalysis } from './hooks/useNonCsKpiAnalysis';
import { useCsKpiAnalysis } from './hooks/useCsKpiAnalysis';
import {
  aggregateBranchDisbursementRows,
  aggregateCrmConsentDailyRows,
  aggregateCrmUsageDailyRows
} from './utils/kpiAppendixAggregates';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KPI_REPORT_RECIPIENTS_KEY = 'kpi_report_email_recipients';

/** Use UTC to avoid timezone off-by-one (e.g. Jan 31 UTC showing as Dec). */
function toMonthKey(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function monthKeyToLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-');
  const mi = parseInt(m, 10) - 1;
  return `${MONTH_LABELS[mi] || m} ${y}`;
}

/** 6-tier colour for Excel: Branch/Region/Cluster rows by % (violet best → red poorest). */
function getColorForPct(pct) {
  if (pct >= 100) return '#8B5CF6';  // violet
  if (pct >= 75) return '#2563EB';   // blue
  if (pct >= 50) return '#22C55E';   // green
  if (pct >= 25) return '#EAB308';   // yellow
  if (pct > 10) return '#F97316';    // orange
  return '#EF4444';                  // red
}

/** Blend hex with white; ratio 0.6 = 60% color + 40% white. Returns 6-char hex for rowFillColors. */
function blendHexWithWhite(hex, ratio = 0.6) {
  const h = String(hex || '#FFFFFF').replace(/^#/, '');
  if (h.length !== 6) return h;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const r2 = Math.round(r * ratio + 255 * (1 - ratio));
  const g2 = Math.round(g * ratio + 255 * (1 - ratio));
  const b2 = Math.round(b * ratio + 255 * (1 - ratio));
  return [r2, g2, b2].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function getAchievedRowStyle(pct) {
  if (!Number.isFinite(pct)) return undefined;
  if (pct <= 0) return { backgroundColor: '#FF6B6B' };
  if (pct < 50) return { backgroundColor: '#FFA94D' };
  return { backgroundColor: '#69DB7C' };
}

/** Normalize PAR >30 value to percentage. Some reports (e.g. Dec) store as decimal (0.0582 = 5.82%); others as percentage (5.82). If value is less than 1, treat as decimal and convert. */
function normalizeParToPercentage(val) {
  if (val == null || val === '') return NaN;
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  if (!Number.isFinite(n)) return NaN;
  if (n < 0) return 0;
  if (n > 0 && n < 1) return n * 100; // stored as decimal (e.g. 0.0582 → 5.82)
  return n; // already in percentage (e.g. 5.82)
}

function arrayBufferToBase64(ab) {
  const bytes = new Uint8Array(ab);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

const EMPTY_TOTAL_TARGETS = {
  performanceStandards: [],
  mainland: {},
  zanzibar: {},
  callCenter: {},
};

const EMPTY_CLUSTER_TARGETS = {
  performanceStandards: [],
  clusters: {},
};

function isMissingActiveKpiFileError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('no active kpi target file');
}

const KpiAnalysisReport = ({ initialProduct = 'CS', lockProduct = false }) => {
  const [product, setProduct] = useState(initialProduct);
  const [targets, setTargets] = useState(null);
  const [targetsError, setTargetsError] = useState(null);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [targetsMissing, setTargetsMissing] = useState(false);
  const [clusterTargetsMissing, setClusterTargetsMissing] = useState(false);
  /** Selected month YYYY-MM; null = use latest available */
  const [selectedMonthKey, setSelectedMonthKey] = useState(null);
  /** CS sub-view: Total (all) or Cluster 1, Cluster 2, Cluster 3, Zanzibar */
  const [csView, setCsView] = useState('Total');
  /** Branch-level data from management report Excel (for dashboard KPI Summary & Branch section) */
  const [branchSummaryData, setBranchSummaryData] = useState(null);
  /** Branch -> cluster (CS only), from Zone and cluster.xlsx */
  const [branchToClusterMap, setBranchToClusterMap] = useState(null);
  /** Branches per cluster (CS only) */
  const [branchesByCluster, setBranchesByCluster] = useState(null);
  /** Cluster KPI targets from CS_KPI_CLUSTER_TARGET_NEW_FILE_2026.xlsx (when a cluster is selected) */
  const [clusterTargets, setClusterTargets] = useState(null);
  /** Backend-managed KPI target versions */
  const [totalVersions, setTotalVersions] = useState([]);
  const [clusterVersions, setClusterVersions] = useState([]);
  const [totalVersionId, setTotalVersionId] = useState(null);
  const [clusterVersionId, setClusterVersionId] = useState(null);
  const [totalActiveFileName, setTotalActiveFileName] = useState('');
  const [clusterActiveFileName, setClusterActiveFileName] = useState('');

  const [kpiUploadLoading, setKpiUploadLoading] = useState(false);
  const [kpiUploadError, setKpiUploadError] = useState('');
  const kpiTargetFileInputRef = useRef(null);
  const fallbackParsedRef = useRef({ total: false, cluster: false });
  /** Parsed CRM agent_activity + Lead_Report for cluster view (by zone, then aggregated) */
  const [crmClusterSheetsData, setCrmClusterSheetsData] = useState(null);
  /** Actual reps from Gap Analysis API (uploaded template); keyed by RSM:Zone or TL|Supervision */
  const [gapActualRepsFromServer, setGapActualRepsFromServer] = useState({});
  /** Per-report CRM metrics for the month (all reports): on location + data consent for cluster */
  const [crmReportsInMonthData, setCrmReportsInMonthData] = useState([]);
  /** Parsed previous month Management report (Country sheet clusters) for cluster Portfolio / PAR30 */
  const [branchSummaryDataPrevious, setBranchSummaryDataPrevious] = useState(null);

  const [showEmailModal, setShowEmailModal] = useState(false);
  const [recipients, setRecipients] = useState(() => {
    try {
      const saved = localStorage.getItem(KPI_REPORT_RECIPIENTS_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [newRecipient, setNewRecipient] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendProgress, setSendProgress] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [copiedList, setCopiedList] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const [pasteBox, setPasteBox] = useState('');

  useEffect(() => {
    if (recipients.length > 0) {
      try {
        localStorage.setItem(KPI_REPORT_RECIPIENTS_KEY, JSON.stringify(recipients));
      } catch (_) {}
    }
  }, [recipients]);

  const { parsedReports: managementReports } = useManagementData();
  const { reports: mtdReports } = useMTDData('CS');

  /** Months available in DB (from management reports), newest first */
  const availableMonths = useMemo(() => {
    if (!managementReports?.length) return [];
    const set = new Set(managementReports.map(r => toMonthKey(r.date || r.createdAt)).filter(Boolean));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [managementReports]);

  const effectiveMonthKey = selectedMonthKey || availableMonths[0] || null;

  /** Latest MTD report in the chosen month (e.g. Feb 2026 → latest February MTD). Used for RSM: New Loans target/achieved and Actual Reps. */
  const latestMTDInMonth = useMemo(() => {
    if (!effectiveMonthKey || !mtdReports?.length) return null;
    const inMonth = mtdReports.filter((r) => toMonthKey(r.date) === effectiveMonthKey);
    if (inMonth.length === 0) return null;
    inMonth.sort((a, b) => new Date(b.date) - new Date(a.date));
    return inMonth[0];
  }, [effectiveMonthKey, mtdReports]);
  const { parsedData: mtdParsedData } = useMTDData('CS', latestMTDInMonth?.date ?? undefined);
  const latestManagementReport = useMemo(() => {
    if (!effectiveMonthKey || !managementReports?.length) return null;
    const inMonth = managementReports.filter(r => toMonthKey(r.date || r.createdAt) === effectiveMonthKey);
    if (inMonth.length === 0) return null;
    inMonth.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
    return inMonth[0];
  }, [effectiveMonthKey, managementReports]);

  const prevMonthKey = useMemo(() => {
    if (!effectiveMonthKey) return null;
    const [y, m] = effectiveMonthKey.split('-');
    const prev = parseInt(m, 10) - 1;
    if (prev < 1) return `${parseInt(y, 10) - 1}-12`;
    return `${y}-${String(prev).padStart(2, '0')}`;
  }, [effectiveMonthKey]);

  const previousMonthManagementReport = useMemo(() => {
    if (!prevMonthKey || !managementReports?.length) return null;
    const inMonth = managementReports.filter(r => toMonthKey(r.date || r.createdAt) === prevMonthKey);
    inMonth.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
    return inMonth[0];
  }, [prevMonthKey, managementReports]);

  const { reports: crmReports } = useCRMData('CS');
  /** All CRM reports in the selected month (for KPIs 7 & 8 per-report tables) */
  const crmReportsInMonth = useMemo(() => {
    if (!crmReports?.length || !effectiveMonthKey) return [];
    const inMonth = crmReports.filter((r) => toMonthKey(r.date) === effectiveMonthKey);
    inMonth.sort((a, b) => new Date(a.date || a.createdAt) - new Date(b.date || b.createdAt));
    return inMonth;
  }, [crmReports, effectiveMonthKey]);
  const crmDateForMonth = useMemo(() => {
    if (!crmReports?.length || !effectiveMonthKey) return null;
    const inMonth = crmReports.filter(r => toMonthKey(r.date) === effectiveMonthKey);
    return inMonth[0]?.date ?? null;
  }, [crmReports, effectiveMonthKey]);
  const crmReportForMonth = useMemo(() => {
    if (!crmReports?.length || !effectiveMonthKey) return null;
    const inMonth = crmReports.filter(r => toMonthKey(r.date) === effectiveMonthKey);
    inMonth.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
    return inMonth[0] ?? null;
  }, [crmReports, effectiveMonthKey]);
  const { parsedData: crmParsedDataForMonth } = useCRMData('CS', crmDateForMonth ?? undefined);

  useEffect(() => {
    if (!latestManagementReport) {
      setBranchSummaryData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let fileUrl = latestManagementReport.fileUrl || latestManagementReport.file_url;
        if (!fileUrl && (latestManagementReport.filePath || latestManagementReport.file_path)) {
          fileUrl = await getReportFileUrl(latestManagementReport.filePath || latestManagementReport.file_path);
        }
        if (!fileUrl) {
          if (!cancelled) setBranchSummaryData(null);
          return;
        }
        const data = await parseManagementReportCsBranches(fileUrl);
        if (!cancelled) setBranchSummaryData(data);
      } catch (e) {
        if (!cancelled) setBranchSummaryData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [latestManagementReport?.id, effectiveMonthKey]);

  /** Parse previous month Management report for cluster row (Portfolio, PAR30) so growth uses cluster-level data. */
  useEffect(() => {
    if (!previousMonthManagementReport) {
      setBranchSummaryDataPrevious(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let fileUrl = previousMonthManagementReport.fileUrl || previousMonthManagementReport.file_url;
        if (!fileUrl && (previousMonthManagementReport.filePath || previousMonthManagementReport.file_path)) {
          fileUrl = await getReportFileUrl(previousMonthManagementReport.filePath || previousMonthManagementReport.file_path);
        }
        if (!fileUrl) {
          if (!cancelled) setBranchSummaryDataPrevious(null);
          return;
        }
        const data = await parseManagementReportCsBranches(fileUrl);
        if (!cancelled) setBranchSummaryDataPrevious(data);
      } catch (e) {
        if (!cancelled) setBranchSummaryDataPrevious(null);
      }
    })();
    return () => { cancelled = true; };
  }, [previousMonthManagementReport?.id]);


  useEffect(() => {
    if (product !== 'CS' || csView === 'Total' || !crmReportForMonth) {
      setCrmClusterSheetsData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        let fileUrl = crmReportForMonth.fileUrl || crmReportForMonth.file_url;
        if (!fileUrl && (crmReportForMonth.filePath || crmReportForMonth.file_path)) {
          fileUrl = await getReportFileUrl(crmReportForMonth.filePath || crmReportForMonth.file_path);
        }
        if (!fileUrl) {
          if (!cancelled) setCrmClusterSheetsData(null);
          return;
        }
        const data = await parseCrmClusterSheets(fileUrl);
        if (!cancelled) setCrmClusterSheetsData(data);
      } catch (_) {
        if (!cancelled) setCrmClusterSheetsData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [product, csView, crmReportForMonth?.id]);

  /** Fetch Actual Sales Reps from Gap Analysis API (same source as Gap upload template) for latest MTD report */
  useEffect(() => {
    const reportId = mtdParsedData?.reportId;
    if (product !== 'CS' || !reportId) {
      setGapActualRepsFromServer({});
      return;
    }
    let cancelled = false;
    gapAnalysisAPI.getActualReps(reportId).then((res) => {
      if (cancelled) return;
      const data = res?.data ?? {};
      const normalized = {};
      Object.entries(data).forEach(([k, v]) => {
        if (v != null && v !== '') normalized[k] = Number(v);
      });
      setGapActualRepsFromServer(normalized);
    }).catch(() => {
      if (!cancelled) setGapActualRepsFromServer({});
    });
    return () => { cancelled = true; };
  }, [product, mtdParsedData?.reportId]);

  /** Load all CRM reports in the selected month; aggregate per report using CS only + zones in this cluster (KPIs 7 & 8). */
  useEffect(() => {
    if (product !== 'CS' || csView === 'Total' || !crmReportsInMonth?.length) {
      setCrmReportsInMonthData([]);
      return;
    }
    const clusterZones = ZONES_BY_CLUSTER_CS[csView];
    if (!clusterZones?.length) {
      setCrmReportsInMonthData([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const results = [];
      for (const report of crmReportsInMonth) {
        if (cancelled) return;
        try {
          let fileUrl = report.fileUrl || report.file_url;
          if (!fileUrl && (report.filePath || report.file_path)) {
            fileUrl = await getReportFileUrl(report.filePath || report.file_path);
          }
          if (!fileUrl) continue;
          const parsed = await parseCrmClusterSheets(fileUrl);
          const agg = aggregateCrmForCluster(parsed.agentActivity, parsed.leadReport, clusterZones);
          const reportDate = report.date || report.createdAt;
          const dateStr = reportDate ? new Date(reportDate).toISOString().slice(0, 10) : '—';
          results.push({
            reportDate: dateStr,
            completed: agg.completed ?? 0,
            atLocation: agg.atLocation ?? 0,
            totalLead: agg.total ?? 0,
            accepted: agg.accepted ?? 0
          });
        } catch (_) {
          // skip this report
        }
      }
      if (!cancelled) setCrmReportsInMonthData(results);
    })();
    return () => { cancelled = true; };
  }, [product, csView, crmReportsInMonth]);

  useEffect(() => {
    if (product !== 'CS') {
      setBranchToClusterMap(null);
      setBranchesByCluster(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [map, byCluster] = await Promise.all([getBranchToClusterCS(), getBranchesByClusterCS()]);
        if (!cancelled) {
          setBranchToClusterMap(map);
          setBranchesByCluster(byCluster);
        }
      } catch (_) {
        if (!cancelled) {
          setBranchToClusterMap(new Map());
          setBranchesByCluster({ 'Cluster 1': [], 'Cluster 2': [], 'Cluster 3': [], Zanzibar: [] });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [product]);

  const {
    filteredBranchSummaryData,
    mtdSalesAchievedForView,
    effectiveTargetsForKpi,
    countrySheetClusterDisbursement,
    countrySheetClusterPortfolio,
    countrySheetClusterPar30,
    countrySheetClusterPortfolioPrevious,
    rsmDataForCluster,
    crmClusterAggregated,
    onLocationTable,
    consentTable,
    clusterKpiTables,
    clusterDashboardRows,
    dashboardSummaryRows
  } = useCsKpiAnalysis({
    product,
    csView,
    branchSummaryData,
    branchToClusterMap,
    branchesByCluster,
    mtdParsedData,
    targets,
    clusterTargets,
    clusterTargetsMissing,
    effectiveMonthKey,
    branchSummaryDataPrevious,
    gapActualRepsFromServer,
    crmReportsInMonthData,
    crmClusterSheetsData,
    latestManagementReport,
    previousMonthManagementReport,
    crmParsedDataForMonth,
    toMonthKey,
    normalizeParToPercentage,
    formatTzs,
    formatPercentAccounting
  });


  useEffect(() => {
    let cancelled = false;
    const loadBackendTargets = async () => {
      setTargetsLoading(true);
      setTargetsError(null);
      setTargetsMissing(false);
      setClusterTargetsMissing(false);

      try {
        const backendProduct = product;

        // Versions lists (for dropdown)
        const [totalVersRes, clusterVersRes] = await Promise.all([
          kpiTargetsAPI.getVersions({ product: backendProduct, kind: 'TOTAL' }).catch(() => null),
          kpiTargetsAPI.getVersions({ product: backendProduct, kind: 'CLUSTER' }).catch(() => null)
        ]);

        const totalVers = totalVersRes?.data || [];
        const clusterVers = clusterVersRes?.data || [];

        if (!cancelled) {
          setTotalVersions(totalVers);
          setClusterVersions(clusterVers);
        }

        // Active TOTAL (required, but can be missing until upload)
        if (totalVers.length > 0) {
          try {
            const totalActiveRes = await kpiTargetsAPI.getActive({ product: backendProduct, kind: 'TOTAL' });
            if (!cancelled) {
              const file = totalActiveRes?.data?.file;
              const parsed = totalActiveRes?.data?.parsed;
              let parsedTargets = parsed || EMPTY_TOTAL_TARGETS;

              // If backend parsing fails (empty month maps), parse the uploaded XLSX directly as a fallback.
              // This is specifically for CS TOTAL where the UI depends on monthKey mappings.
              if (
                backendProduct === 'CS' &&
                file?.id &&
                !fallbackParsedRef.current.total &&
                Object.keys(parsedTargets?.mainland || {}).length === 0 &&
                Object.keys(parsedTargets?.zanzibar || {}).length === 0
              ) {
                fallbackParsedRef.current.total = true;
                try {
                  const blob = await kpiTargetsAPI.downloadBlob(file.id);
                  const ab = await blob.arrayBuffer();
                  const localParsed = await loadCsKpiTargets(ab);
                  if (localParsed) parsedTargets = localParsed;
                } catch (e) {
                  // Best-effort: keep backend parsed output if fallback download/parse fails.
                  console.warn('KPI fallback parse TOTAL failed:', e);
                }
              }
              if (backendProduct !== 'CS' && file?.id) {
                try {
                  // For LBF/SME, prefer direct XLSX parsing on the client to avoid backend mapping drift.
                  const blob = await kpiTargetsAPI.downloadBlob(file.id);
                  const ab = await blob.arrayBuffer();
                  const localParsed = await loadGenericKpiTargets(ab);
                  if (localParsed) parsedTargets = localParsed;
                } catch (e) {
                  console.warn('KPI fallback parse non-CS failed:', e);
                }
              }

              setTargets(parsedTargets || EMPTY_TOTAL_TARGETS);
              setTargetsMissing(false);
              setTotalVersionId(file?.id || null);
              setTotalActiveFileName(file?.fileName || '');
            }
          } catch (err) {
            if (isMissingActiveKpiFileError(err)) {
              if (!cancelled) {
                setTargets(EMPTY_TOTAL_TARGETS);
                setTargetsMissing(true);
                setTotalVersionId(null);
                setTotalActiveFileName('');
              }
            } else {
              throw err;
            }
          }
        } else {
          if (!cancelled) {
            setTargets(EMPTY_TOTAL_TARGETS);
            setTargetsMissing(true);
            setTotalVersionId(null);
            setTotalActiveFileName('');
          }
        }

        // Active CLUSTER (optional; needed when csView !== 'Total')
        if (clusterVers.length > 0) {
          try {
            const clusterActiveRes = await kpiTargetsAPI.getActive({ product: backendProduct, kind: 'CLUSTER' });
            if (!cancelled) {
              const file = clusterActiveRes?.data?.file;
              const parsed = clusterActiveRes?.data?.parsed;
              let parsedTargets = parsed || EMPTY_CLUSTER_TARGETS;

              // If backend parsing fails (empty cluster month maps), parse the uploaded XLSX directly.
              if (backendProduct === 'CS' && file?.id && !fallbackParsedRef.current.cluster) {
                const clustersObj = parsedTargets?.clusters || {};
                const allEmpty = Object.values(clustersObj).length === 0
                  ? true
                  : Object.values(clustersObj).every((v) => !v || Object.keys(v || {}).length === 0);

                if (allEmpty) {
                  fallbackParsedRef.current.cluster = true;
                  try {
                    const blob = await kpiTargetsAPI.downloadBlob(file.id);
                    const ab = await blob.arrayBuffer();
                    const localParsed = await loadCsKpiClusterTargets(ab);
                    if (localParsed) parsedTargets = localParsed;
                  } catch (e) {
                    console.warn('KPI fallback parse CLUSTER failed:', e);
                  }
                }
              }

              setClusterTargets(parsedTargets || EMPTY_CLUSTER_TARGETS);
              setClusterTargetsMissing(false);
              setClusterVersionId(file?.id || null);
              setClusterActiveFileName(file?.fileName || '');
            }
          } catch (err) {
            if (isMissingActiveKpiFileError(err)) {
              if (!cancelled) {
                setClusterTargets(EMPTY_CLUSTER_TARGETS);
                setClusterTargetsMissing(true);
                setClusterVersionId(null);
                setClusterActiveFileName('');
              }
            } else {
              throw err;
            }
          }
        } else {
          if (!cancelled) {
            setClusterTargets(EMPTY_CLUSTER_TARGETS);
            setClusterTargetsMissing(true);
            setClusterVersionId(null);
            setClusterActiveFileName('');
          }
        }
      } catch (err) {
        if (!cancelled) {
          setTargetsError(err?.message || 'Targets not available');
          setTargets(null);
          setClusterTargets(null);
          setTotalVersionId(null);
          setClusterVersionId(null);
          setTotalActiveFileName('');
          setClusterActiveFileName('');
        }
      } finally {
        if (!cancelled) setTargetsLoading(false);
      }
    };

    loadBackendTargets();
    return () => { cancelled = true; };
  }, [product]);

  // Build actuals by month from management reports (CS = mainland, zanzibar = zanzibar)
  const actualsByMonth = useMemo(() => {
    const out = { mainland: {}, zanzibar: {} };
    if (!managementReports || managementReports.length === 0) return out;
    const byMonth = {};
    managementReports.forEach((report) => {
      const key = toMonthKey(report.date || report.createdAt);
      if (!key) return;
      if (!byMonth[key]) byMonth[key] = { cs: null, zanzibar: null };
      const d = report.date ? new Date(report.date) : new Date(report.createdAt);
      const existing = byMonth[key]._date;
      if (!existing || d >= existing) {
        byMonth[key]._date = d;
        byMonth[key].cs = report.cs || {};
        byMonth[key].zanzibar = report.zanzibar || {};
      }
    });
    Object.keys(byMonth).forEach((key) => {
      const cs = byMonth[key].cs;
      const zan = byMonth[key].zanzibar;
      const mainVal = cs && (cs['Disbursements This Month'] != null || cs['Disbursement This Month'] != null)
        ? (Number(cs['Disbursements This Month'] ?? cs['Disbursement This Month']) || 0)
        : null;
      const zanVal = zan && (zan['Disbursements This Month'] != null || zan['Disbursement This Month'] != null)
        ? (Number(zan['Disbursements This Month'] ?? zan['Disbursement This Month']) || 0)
        : null;
      out.mainland[key] = mainVal;
      out.zanzibar[key] = zanVal;
    });
    return out;
  }, [managementReports]);

  // All month keys from targets, sorted
  const monthKeys = useMemo(() => {
    if (!targets) return [];
    const set = new Set([
      ...Object.keys(targets.mainland || {}),
      ...Object.keys(targets.zanzibar || {}),
      ...Object.keys(targets.callCenter || {})
    ]);
    return Array.from(set).sort();
  }, [targets]);

  /** Builds sheets and fileName for the current month; used by download and email. */
  const buildKpiReportSheetsAndFile = useCallback(async () => {
    if (product !== 'CS' || !targets) return null;
    const effective = effectiveTargetsForKpi;
    const standards = effective?.performanceStandards ?? targets.performanceStandards ?? [];
    const salesTarget = effective?.salesTarget ?? ((targets.mainland || {})[effectiveMonthKey]?.total ?? 0) + ((targets.zanzibar || {})[effectiveMonthKey]?.total ?? 0) + ((targets.callCenter || {})[effectiveMonthKey] ?? 0);
    const monthLabel = monthKeyToLabel(effectiveMonthKey);
    const viewSuffix = csView !== 'Total' ? ` — ${csView}` : '';

    const summaryRows = [];

    // ----- Sheet 1: Sales Target Achievement -----
    const mainT = (targets.mainland || {})[effectiveMonthKey];
    const zanT = (targets.zanzibar || {})[effectiveMonthKey];
    const salesAchievedNum = typeof mtdSalesAchievedForView === 'number' ? mtdSalesAchievedForView : (mtdSalesAchievedForView != null ? parseFloat(mtdSalesAchievedForView) : NaN);
    const pctSales = Number.isFinite(salesAchievedNum) && salesTarget > 0 ? (salesAchievedNum / salesTarget) * 100 : null;
    const weight1 = standards[0]?.weight ?? 0.1;
    const weightScored1 = pctSales != null ? (Math.min(100, pctSales) / 100) * weight1 : 0;

    const sheet1Tables = [{
      title: `Sales Target Achievement — ${monthLabel}${viewSuffix}`,
      data: [
        { 'Metric': csView !== 'Total' ? `Sales Target (${csView})` : 'Sales Target (Mainland + Zanzibar + Call Center)', 'Value': salesTarget },
        { 'Metric': csView !== 'Total' ? `Sales Achieved (${csView} — Management report)` : 'Sales Achieved (CS MTD)', 'Value': Number.isFinite(salesAchievedNum) ? salesAchievedNum : '—' },
        { 'Metric': '% Achieved', 'Value': pctSales != null ? formatPercentAccounting(pctSales) : '—' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [45, 22]
    }, {
      title: 'Summary',
      data: [
        { 'KPI': standards[0]?.name ?? 'Achieve 100% sales target', 'Target': salesTarget, 'Achieved': Number.isFinite(salesAchievedNum) ? salesAchievedNum : '—', '% Achieved': pctSales != null ? formatPercentAccounting(pctSales) : '—', 'Weight (%)': formatPercentAccounting(weight1 * 100), 'Weight Scored (%)': formatPercentAccounting(weightScored1 * 100) }
      ],
      headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Achieved': '#70AD47', '% Achieved': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [50, 16, 16, 14, 12, 16]
    }];
    summaryRows.push({
      kpi: standards[0]?.name ?? 'Sales target',
      target: salesTarget,
      achieved: salesAchievedNum,
      achievedDisplay: Number.isFinite(salesAchievedNum) ? salesAchievedNum : '—',
      pct: pctSales,
      weight: weight1,
      weightScored: weightScored1
    });

    // ----- Sheet 2: Branch Sales Achievement -----
    let branchData = { branches: [], clusters: [], totalTarget: 0, totalDisbursement: 0, achieved100Count: 0, notAchieved100Count: 0 };
    if (csView !== 'Total' && filteredBranchSummaryData) {
      branchData = filteredBranchSummaryData;
    } else if (latestManagementReport) {
      try {
        let fileUrl = latestManagementReport.fileUrl || latestManagementReport.file_url;
        if (!fileUrl && (latestManagementReport.filePath || latestManagementReport.file_path)) {
          fileUrl = await getReportFileUrl(latestManagementReport.filePath || latestManagementReport.file_path);
        }
        if (fileUrl) branchData = await parseManagementReportCsBranches(fileUrl);
      } catch (e) {
        console.warn('Could not parse management report for CS branches:', e);
      }
    }
    const totalBranches = branchData.achieved100Count + branchData.notAchieved100Count;
    const pctBranches100 = totalBranches > 0 ? (branchData.achieved100Count / totalBranches) * 100 : null;
    const weight2 = standards[1]?.weight ?? 0.1;
    const targetPct85 = 85;
    const weightScored2 = pctBranches100 != null ? (Math.min(100, (pctBranches100 / targetPct85) * 100) / 100) * weight2 : 0;

    const disbursementColLabel = 'Disbursement this Month';
    const sortedBranches = [...branchData.branches].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const sheet2Data = sortedBranches.map(b => ({
      'Branch': b.branch,
      'Target': b.target,
      [disbursementColLabel]: b.disbursement,
      '%': formatPercentAccounting(b.pct)
    }));
    const branchRowFillColors = sortedBranches.map(b => getColorForPct(b.pct ?? 0));
    if (sheet2Data.length > 0) {
      sheet2Data.push({
        __totalRow: true,
        'Branch': 'Total',
        'Target': branchData.totalTarget,
        [disbursementColLabel]: branchData.totalDisbursement,
        '%': branchData.totalTarget > 0 ? formatPercentAccounting((branchData.totalDisbursement / branchData.totalTarget) * 100) : '—'
      });
    }
    const sheet2Tables = [{
      title: `Branch Sales Achievement — ${monthLabel}${viewSuffix}`,
      data: sheet2Data.length ? sheet2Data : [{ 'Branch': '—', 'Target': '—', [disbursementColLabel]: '—', '%': '—' }],
      headerColors: { 'Branch': '#1e3a5f', 'Target': '#c45a11', [disbursementColLabel]: '#2d6a2d', '%': '#2d6a2d' },
      colWidths: [28, 16, 18, 12],
      totalRowIndices: sheet2Data.length ? [sheet2Data.length - 1] : [],
      rowFillColors: branchRowFillColors
    }, {
      title: 'Summary (85% of branches at 100% target)',
      data: [
        { 'Achieved ≥100%': branchData.achieved100Count, 'Not achieved <100%': branchData.notAchieved100Count, '% Branches at 100%': pctBranches100 != null ? formatPercentAccounting(pctBranches100) : '—', 'Weight (%)': formatPercentAccounting(weight2 * 100), 'Weight Scored (%)': formatPercentAccounting(weightScored2 * 100) }
      ],
      headerColors: { 'Achieved ≥100%': '#70AD47', 'Not achieved <100%': '#ED7D31', '% Branches at 100%': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [18, 20, 22, 12, 16]
    }];
    summaryRows.push({
      kpi: standards[1]?.name ?? 'Branch sales',
      target: targetPct85 + '%',
      achieved: pctBranches100,
      achievedDisplay: pctBranches100 != null ? formatPercentAccounting(pctBranches100) : '—',
      pct: pctBranches100,
      weight: weight2,
      weightScored: weightScored2
    });

    // ----- Sheet 3: Mainland 65% new business -----
    const newBizMainlandTarget = mainT?.newBusiness ?? null;
    const newBizMainlandActual = latestManagementReport?.cs?.['New Business'] ?? latestManagementReport?.cs?.['New business'] ?? null;
    const newBizMainlandNum = typeof newBizMainlandActual === 'number' ? newBizMainlandActual : (newBizMainlandActual != null ? parseFloat(newBizMainlandActual) : NaN);
    const pctMainland65 = newBizMainlandTarget > 0 && Number.isFinite(newBizMainlandNum) ? (newBizMainlandNum / newBizMainlandTarget) * 100 : null;
    const weight3 = standards[2]?.weight ?? 0.15;
    const target65 = 65;
    const weightScored3 = pctMainland65 != null ? (Math.min(100, (pctMainland65 / target65) * 100) / 100) * weight3 : 0;
    const sheet3Tables = [{
      title: `Attaining 65% new business (Mainland) — ${monthLabel}`,
      data: [
        { 'Metric': 'New Business Target (Mainland)', 'Value': newBizMainlandTarget ?? '—' },
        { 'Metric': 'New Business Actual (CS)', 'Value': Number.isFinite(newBizMainlandNum) ? newBizMainlandNum : '—' },
        { 'Metric': '% of target', 'Value': pctMainland65 != null ? formatPercentAccounting(pctMainland65) : '—' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [35, 22]
    }, {
      title: 'Summary',
      data: [{ 'KPI': standards[2]?.name ?? '65% new business Mainland', 'Target': target65 + '%', 'Achieved': pctMainland65 != null ? formatPercentAccounting(pctMainland65) : '—', 'Weight (%)': formatPercentAccounting(weight3 * 100), 'Weight Scored (%)': formatPercentAccounting(weightScored3 * 100) }],
      headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Achieved': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [50, 12, 16, 10, 14]
    }];
    summaryRows.push({
      kpi: standards[2]?.name ?? 'Mainland 65%',
      target: target65 + '%',
      achieved: pctMainland65,
      achievedDisplay: pctMainland65 != null ? formatPercentAccounting(pctMainland65) : '—',
      pct: pctMainland65,
      weight: weight3,
      weightScored: weightScored3
    });

    // ----- Sheet 4: Zanzibar 70% new business -----
    const newBizZanTarget = zanT?.newBusiness ?? null;
    const newBizZanActual = latestManagementReport?.zanzibar?.['New Business'] ?? latestManagementReport?.zanzibar?.['New business'] ?? null;
    const newBizZanNum = typeof newBizZanActual === 'number' ? newBizZanActual : (newBizZanActual != null ? parseFloat(newBizZanActual) : NaN);
    const pctZan70 = newBizZanTarget > 0 && Number.isFinite(newBizZanNum) ? (newBizZanNum / newBizZanTarget) * 100 : null;
    const weight4 = standards[3]?.weight ?? 0.05;
    const target70 = 70;
    const weightScored4 = pctZan70 != null ? (Math.min(100, (pctZan70 / target70) * 100) / 100) * weight4 : 0;
    const sheet4Tables = [{
      title: `Attaining 70% Zanzibar new business — ${monthLabel}`,
      data: [
        { 'Metric': 'New Business Target (Zanzibar)', 'Value': newBizZanTarget ?? '—' },
        { 'Metric': 'New Business Actual (Zanzibar)', 'Value': Number.isFinite(newBizZanNum) ? newBizZanNum : '—' },
        { 'Metric': '% of target', 'Value': pctZan70 != null ? formatPercentAccounting(pctZan70) : '—' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [35, 22]
    }, {
      title: 'Summary',
      data: [{ 'KPI': standards[3]?.name ?? '70% Zanzibar new business', 'Target': target70 + '%', 'Achieved': pctZan70 != null ? formatPercentAccounting(pctZan70) : '—', 'Weight (%)': formatPercentAccounting(weight4 * 100), 'Weight Scored (%)': formatPercentAccounting(weightScored4 * 100) }],
      headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Achieved': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [50, 12, 16, 10, 14]
    }];
    summaryRows.push({
      kpi: standards[3]?.name ?? 'Zanzibar 70%',
      target: target70 + '%',
      achieved: pctZan70,
      achievedDisplay: pctZan70 != null ? formatPercentAccounting(pctZan70) : '—',
      pct: pctZan70,
      weight: weight4,
      weightScored: weightScored4
    });

    // ----- Sheet 5: Portfolio growth 10% annually (~1% per month) -----
    const portfolioCurrent = latestManagementReport?.cs?.['Portfolio'] ?? latestManagementReport?.cs?.['Total Portfolio'] ?? latestManagementReport?.cs?.['Principle Balance'] ?? null;
    const portfolioNum = typeof portfolioCurrent === 'number' ? portfolioCurrent : (portfolioCurrent != null ? parseFloat(portfolioCurrent) : NaN);
    const portfolioPrev = previousMonthManagementReport?.cs?.['Portfolio'] ?? previousMonthManagementReport?.cs?.['Total Portfolio'] ?? previousMonthManagementReport?.cs?.['Principle Balance'] ?? null;
    const portfolioPrevNum = typeof portfolioPrev === 'number' ? portfolioPrev : (portfolioPrev != null ? parseFloat(portfolioPrev) : NaN);
    const growthPct = Number.isFinite(portfolioPrevNum) && portfolioPrevNum > 0 && Number.isFinite(portfolioNum) ? ((portfolioNum - portfolioPrevNum) / portfolioPrevNum) * 100 : null;
    const monthlyTargetGrowth = 10 / 12;
    const weight5 = standards[4]?.weight ?? 0.05;
    const weightScored5 = growthPct != null ? (Math.min(100, (growthPct / monthlyTargetGrowth) * 100) / 100) * weight5 : 0;
    const sheet5Tables = [{
      title: `Portfolio growth 10% annually — ${monthLabel}`,
      data: [
        { 'Metric': 'Current month portfolio (CS)', 'Value': Number.isFinite(portfolioNum) ? portfolioNum : '—' },
        { 'Metric': 'Previous month portfolio', 'Value': Number.isFinite(portfolioPrevNum) ? portfolioPrevNum : '—' },
        { 'Metric': 'Growth %', 'Value': growthPct != null ? formatPercentAccounting(growthPct) : '—' },
        { 'Metric': 'Target (monthly ~1%)', 'Value': formatPercentAccounting(monthlyTargetGrowth) }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [35, 22]
    }, {
      title: 'Summary',
      data: [{ 'KPI': standards[4]?.name ?? 'Portfolio growth 10%', 'Target': '~1% monthly', 'Achieved': growthPct != null ? formatPercentAccounting(growthPct) : '—', 'Weight (%)': formatPercentAccounting(weight5 * 100), 'Weight Scored (%)': formatPercentAccounting(weightScored5 * 100) }],
      headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Achieved': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [45, 14, 16, 10, 14]
    }];
    summaryRows.push({
      kpi: standards[4]?.name ?? 'Portfolio growth',
      target: '~1%',
      achieved: growthPct,
      achievedDisplay: growthPct != null ? formatPercentAccounting(growthPct) : '—',
      pct: growthPct,
      weight: weight5,
      weightScored: weightScored5
    });

    // ----- Sheet 6: PAR 30 below 5% (0.5% monthly improvement) -----
    const par30Current = latestManagementReport?.cs?.['PAR >30'] ?? latestManagementReport?.cs?.['PAR>30'] ?? null;
    const par30Num = normalizeParToPercentage(par30Current);
    const par30Prev = previousMonthManagementReport?.cs?.['PAR >30'] ?? previousMonthManagementReport?.cs?.['PAR>30'] ?? null;
    const par30PrevNum = normalizeParToPercentage(par30Prev);
    const par30Improvement = Number.isFinite(par30PrevNum) && Number.isFinite(par30Num) ? par30PrevNum - par30Num : null;
    const targetImprovement = 0.5;
    const weight6 = standards[5]?.weight ?? 0.05;
    const weightScored6 = par30Improvement != null ? (Math.max(0, Math.min(1, par30Improvement / targetImprovement)) * weight6) : 0;
    const sheet6Tables = [{
      title: `Maintain PAR 30 below 5% — ${monthLabel}`,
      data: [
        { 'Metric': 'Current PAR >30 (%)', 'Value': Number.isFinite(par30Num) ? formatPercentAccounting(par30Num) : '—' },
        { 'Metric': 'Previous month PAR >30 (%)', 'Value': Number.isFinite(par30PrevNum) ? formatPercentAccounting(par30PrevNum) : '—' },
        { 'Metric': 'Improvement (pp)', 'Value': par30Improvement != null ? formatTzs(par30Improvement) : '—' },
        { 'Metric': 'Target improvement (0.5% per month)', 'Value': targetImprovement + '%' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [35, 22]
    }, {
      title: 'Summary',
      data: [{ 'KPI': standards[5]?.name ?? 'PAR 30 below 5%', 'Current': par30Num != null && Number.isFinite(par30Num) ? formatPercentAccounting(par30Num) : '—', 'Improvement': par30Improvement != null ? formatPercentAccounting(par30Improvement) : '—', 'Weight (%)': formatPercentAccounting(weight6 * 100), 'Weight Scored (%)': formatPercentAccounting(weightScored6 * 100) }],
      headerColors: { 'KPI': '#4472C4', 'Current': '#70AD47', 'Improvement': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [40, 12, 14, 10, 14]
    }];
    summaryRows.push({
      kpi: standards[5]?.name ?? 'PAR 30',
      target: '0.5% improvement',
      achieved: par30Improvement,
      achievedDisplay: par30Improvement != null ? formatPercentAccounting(par30Improvement) : '—',
      pct: null,
      weight: weight6,
      weightScored: weightScored6
    });

    // ----- Sheet 7: Growth of active client base 20% annually (Active clients only) -----
    const activeNow = latestManagementReport?.cs?.['Active clients'] ?? latestManagementReport?.cs?.['Active Clients'];
    const activePrev = previousMonthManagementReport?.cs?.['Active clients'] ?? previousMonthManagementReport?.cs?.['Active Clients'];
    const toNum = (v) => (typeof v === 'number' && !isNaN(v)) ? v : (v != null ? parseFloat(v) : NaN);
    const activeNum = toNum(activeNow);
    const activePrevNum = toNum(activePrev);
    const monthlyGrowthPct = Number.isFinite(activePrevNum) && activePrevNum > 0 && Number.isFinite(activeNum)
      ? ((activeNum - activePrevNum) / activePrevNum) * 100 : null;
    const annualizedGrowth = monthlyGrowthPct != null ? monthlyGrowthPct * 12 : null;
    const weight7 = getWeightForKpiKey(standards, 'growth') || 0.02;
    const targetGrowth20 = 20;
    const weightScored7 = annualizedGrowth != null ? (Math.min(100, (annualizedGrowth / targetGrowth20) * 100) / 100) * weight7 : 0;
    const sheet7Tables = [{
      title: `Growth of active client base 20% annually — ${monthLabel}`,
      data: [
        { 'Metric': 'Active clients (current month)', 'Value': Number.isFinite(activeNum) ? activeNum : '—' },
        { 'Metric': 'Active clients (previous month)', 'Value': Number.isFinite(activePrevNum) ? activePrevNum : '—' },
        { 'Metric': 'Monthly growth (%)', 'Value': monthlyGrowthPct != null ? formatPercentAccounting(monthlyGrowthPct) : '—' },
        { 'Metric': 'Annualized growth (%)', 'Value': annualizedGrowth != null ? formatPercentAccounting(annualizedGrowth) : '—' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [35, 18]
    }, {
      title: 'Summary',
      data: [{ 'KPI': 'Growth of active client base 20% annually', 'Target': targetGrowth20 + '% (annualized)', 'Achieved': annualizedGrowth != null ? formatPercentAccounting(annualizedGrowth) : '—', 'Weight (%)': formatPercentAccounting(weight7 * 100), 'Weight Scored (%)': formatPercentAccounting(weightScored7 * 100) }],
      headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Achieved': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [45, 18, 16, 12, 16]
    }];
    summaryRows.push({
      kpi: 'Growth of active client base 20% annually',
      target: targetGrowth20 + '% (annualized)',
      achieved: annualizedGrowth,
      achievedDisplay: annualizedGrowth != null ? formatPercentAccounting(annualizedGrowth) : '—',
      pct: annualizedGrowth,
      weight: weight7,
      weightScored: weightScored7
    });

    // ----- Sheet 8: Regions and Clusters hit target (sorted by % desc, same row colours as Branch) -----
    const supervisionsList = mtdParsedData?.groupedData ? Object.entries(mtdParsedData.groupedData) : [];
    const getSupTarget = (d) => Number(d?.['MONTH TARGET'] ?? d?.['Month Target'] ?? d?.Target ?? 0) || 0;
    const getSupValue = (d) => Number(d?.VALUE ?? d?.Value ?? 0) || 0;
    const supervisionRows = supervisionsList.map(([name, g]) => {
      const d = g.supervisionData || {};
      const target = getSupTarget(d);
      const value = getSupValue(d);
      const pct = target > 0 ? (value / target) * 100 : 0;
      return { 'Supervision': name, 'Target': target, 'Sales': value, '%': formatPercentAccounting(pct), pct, hit: pct >= 100 };
    });
    const clusterRows = (branchData.clusters || []).map(b => ({
      'Cluster': b.branch,
      'Target': b.target,
      'Disbursement': b.disbursement,
      '%': formatPercentAccounting(b.pct),
      pct: b.pct ?? 0,
      hit: (b.pct ?? 0) >= 100
    }));
    const sortedSupervisionRows = [...supervisionRows].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const sortedClusterRows = [...clusterRows].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const weight8 = getWeightForKpiKey(standards, 'regions_clusters') || 0.05;
    const totalRegions = supervisionRows.length;
    const totalClusters = clusterRows.length;
    const regionsHit = supervisionRows.filter(r => r.hit).length;
    const clustersHit = clusterRows.filter(r => r.hit).length;
    const regionsClustersPct = (totalRegions + totalClusters) > 0 ? ((regionsHit + clustersHit) / (totalRegions + totalClusters)) * 100 : null;
    const weightScored8 = regionsClustersPct != null ? (Math.min(100, regionsClustersPct) / 100) * weight8 : 0;
    const sheet8SupervisionData = sortedSupervisionRows.map(({ Supervision, Target, Sales, '%': p }) => ({ Supervision, Target, Sales, '%': p }));
    const sheet8SupervisionRowFillColors = sortedSupervisionRows.map(r => getColorForPct(r.pct ?? 0));
    if (sheet8SupervisionData.length > 0) {
      const totTarget = sortedSupervisionRows.reduce((s, r) => s + r.Target, 0);
      const totSales = sortedSupervisionRows.reduce((s, r) => s + r.Sales, 0);
      sheet8SupervisionData.push({ __totalRow: true, Supervision: 'Total', Target: totTarget, Sales: totSales, '%': totTarget > 0 ? formatPercentAccounting((totSales / totTarget) * 100) : '—' });
    }
    const sheet8ClusterData = sortedClusterRows.map(({ Cluster, Target, Disbursement, '%': p }) => ({ Cluster, Target, Disbursement, '%': p }));
    const sheet8ClusterRowFillColors = sortedClusterRows.map(r => getColorForPct(r.pct ?? 0));
    if (sheet8ClusterData.length > 0) {
      const ct = sortedClusterRows.reduce((s, r) => s + r.Target, 0);
      const cd = sortedClusterRows.reduce((s, r) => s + r.Disbursement, 0);
      sheet8ClusterData.push({ __totalRow: true, Cluster: 'Total', Target: ct, Disbursement: cd, '%': ct > 0 ? formatPercentAccounting((cd / ct) * 100) : '—' });
    }
    const sheet8Tables = [
      { title: `Supervisions (Regions) — ${monthLabel}`, data: sheet8SupervisionData.length ? sheet8SupervisionData : [{ Supervision: '—', Target: '—', Sales: '—', '%': '—' }], headerColors: { Supervision: '#1e3a5f', Target: '#c45a11', Sales: '#2d6a2d', '%': '#2d6a2d' }, colWidths: [28, 14, 14, 10], totalRowIndices: sheet8SupervisionData.length ? [sheet8SupervisionData.length - 1] : [], accountingColumns: ['Target', 'Sales'], rowFillColors: sheet8SupervisionRowFillColors },
      { title: `Clusters — ${monthLabel}`, data: sheet8ClusterData.length ? sheet8ClusterData : [{ Cluster: '—', Target: '—', Disbursement: '—', '%': '—' }], headerColors: { Cluster: '#1e3a5f', Target: '#c45a11', Disbursement: '#2d6a2d', '%': '#2d6a2d' }, colWidths: [18, 14, 16, 10], totalRowIndices: sheet8ClusterData.length ? [sheet8ClusterData.length - 1] : [], accountingColumns: ['Target', 'Disbursement'], rowFillColors: sheet8ClusterRowFillColors },
      { title: 'Summary', data: [{ 'KPI': 'Ensure all Regions and Clusters hit their target', 'Regions hit': regionsHit, 'Regions total': totalRegions, 'Clusters hit': clustersHit, 'Clusters total': totalClusters, '% Hit': regionsClustersPct != null ? formatPercentAccounting(regionsClustersPct) : '—', 'Weight (%)': formatPercentAccounting(weight8 * 100), 'Weight Scored (%)': formatPercentAccounting(weightScored8 * 100) }], headerColors: { 'KPI': '#4472C4', 'Regions hit': '#70AD47', 'Regions total': '#70AD47', 'Clusters hit': '#70AD47', 'Clusters total': '#70AD47', '% Hit': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' }, colWidths: [40, 12, 12, 12, 12, 10, 12, 16] }
    ];
    summaryRows.push({
      kpi: 'Ensure all Regions and Clusters hit their target',
      target: '100% hit',
      achieved: regionsClustersPct,
      achievedDisplay: regionsClustersPct != null ? formatPercentAccounting(regionsClustersPct) : '—',
      pct: regionsClustersPct,
      weight: weight8,
      weightScored: weightScored8
    });

    // ----- Sheet 9: 90% proper usage of CRM & Sheet 10: 65% Data consent from each Cluster -----
    const crmResult = await getReportsByDepartmentAndType('CS', 'CRM');
    const crmReportsInMonth = (crmResult.data || []).filter(r => toMonthKey(r.date) === effectiveMonthKey);
    const crmMetricsList = crmReportsInMonth.length > 0 ? await Promise.all(crmReportsInMonth.map(r => getCrmEmailMetrics(r))) : [];
    const crmUsageRows = [];
    const crmConsentRows = [];
    let totalLeadsSum = 0;
    let totalConsentedSum = 0;
    crmMetricsList.forEach(({ date, metrics }) => {
      const tlTotal = metrics.count_team_leaders || 0;
      const tlLogged = metrics.logged_in_team_leaders || 0;
      const loTotal = metrics.total_agent || 0;
      const loLogged = metrics.total_agent_logged_in || 0;
      const dateStr = date ? (date instanceof Date ? date.toLocaleDateString() : new Date(date).toLocaleDateString()) : '—';
      crmUsageRows.push({ 'Date': dateStr, 'Role': 'Team Leader', 'Total workforce': tlTotal, 'Logged in': tlLogged, 'Percentage logged in': tlTotal > 0 ? formatPercentAccounting((tlLogged / tlTotal) * 100) : formatPercentAccounting(0) });
      crmUsageRows.push({ 'Date': dateStr, 'Role': 'Loan Officer', 'Total workforce': loTotal, 'Logged in': loLogged, 'Percentage logged in': loTotal > 0 ? formatPercentAccounting((loLogged / loTotal) * 100) : formatPercentAccounting(0) });
      const totalLeads = metrics.lead || 0;
      const consented = metrics.accepted_lead || 0;
      const rejected = metrics.rejected_lead || 0;
      const notProvided = metrics.not_provided_lead || 0;
      totalLeadsSum += totalLeads;
      totalConsentedSum += consented;
      const consentPct = totalLeads > 0 ? (consented / totalLeads) * 100 : 0;
      crmConsentRows.push({
        'Date': dateStr,
        'Total Leads': totalLeads,
        'Rejected Leads': `${formatTzs(rejected)} (${formatPercentAccounting(totalLeads > 0 ? (rejected / totalLeads) * 100 : 0)})`,
        'Not Provided Leads': `${formatTzs(notProvided)} (${formatPercentAccounting(totalLeads > 0 ? (notProvided / totalLeads) * 100 : 0)})`,
        'Consented Leads': `${formatTzs(consented)} (${formatPercentAccounting(consentPct)})`
      });
    });
    const totalWorkforce = crmUsageRows.reduce((s, r) => s + (Number(r['Total workforce']) || 0), 0);
    const totalLoggedIn = crmUsageRows.reduce((s, r) => s + (Number(r['Logged in']) || 0), 0);
    const overallUsagePct = totalWorkforce > 0 ? (totalLoggedIn / totalWorkforce) * 100 : null;
    const crmUsageTotalRow = { 'Date': 'Total', 'Role': '—', 'Total workforce': totalWorkforce, 'Logged in': totalLoggedIn, 'Percentage logged in': overallUsagePct != null ? formatPercentAccounting(overallUsagePct) : '—' };
    const weight9 = getWeightForKpiKey(standards, 'crm') || 0.05;
    const targetUsage90 = 90;
    const weightScored9 = overallUsagePct != null ? (Math.min(100, (overallUsagePct / targetUsage90) * 100) / 100) * weight9 : 0;
    const avgConsentPct = totalLeadsSum > 0 ? (totalConsentedSum / totalLeadsSum) * 100 : null;
    const weight10 = getWeightForKpiKey(standards, 'data_consent') || 0.05;
    const targetConsent65 = 65;
    const weightScored10 = avgConsentPct != null ? (Math.min(100, (avgConsentPct / targetConsent65) * 100) / 100) * weight10 : 0;
    const sheet9Data = crmUsageRows.length ? [...crmUsageRows, crmUsageTotalRow] : [{ 'Date': '—', 'Role': '—', 'Total workforce': '—', 'Logged in': '—', 'Percentage logged in': '—' }];
    const sheet9RowFillColors = crmUsageRows.length ? crmUsageRows.map((r) => r['Role'] === 'Team Leader' ? blendHexWithWhite('FFEB3B', 0.6) : blendHexWithWhite('87CEEB', 0.6)) : [];
    const sheet10TotalRow = { __totalRow: true, 'Date': 'Total', 'Total Leads': totalLeadsSum, 'Rejected Leads': '—', 'Not Provided Leads': '—', 'Consented Leads': avgConsentPct != null ? `${formatTzs(totalConsentedSum)} (${formatPercentAccounting(avgConsentPct)})` : String(formatTzs(totalConsentedSum)) };
    const sheet10Data = crmConsentRows.length ? crmConsentRows.concat([sheet10TotalRow]) : [{ 'Date': '—', 'Total Leads': '—', 'Rejected Leads': '—', 'Not Provided Leads': '—', 'Consented Leads': '—' }];
    const sheet10RowFillColors = crmConsentRows.length ? crmConsentRows.map((_, i) => (i % 2 === 0 ? blendHexWithWhite('FFEB3B', 0.4) : blendHexWithWhite('87CEEB', 0.4))) : [];
    const sheet9Tables = [
      { title: `90% proper usage of CRM — ${monthLabel}`, data: sheet9Data, headerColors: { 'Date': '#4472C4', 'Role': '#4472C4', 'Total workforce': '#70AD47', 'Logged in': '#70AD47', 'Percentage logged in': '#70AD47' }, colWidths: [14, 14, 16, 12, 18], totalRowIndices: crmUsageRows.length ? [sheet9Data.length - 1] : [], accountingColumns: ['Total workforce', 'Logged in'], rowFillColors: sheet9RowFillColors },
      { title: 'Summary', data: [{ 'KPI': '90% proper usage of CRM', 'Target': targetUsage90 + '%', 'Achieved': overallUsagePct != null ? formatPercentAccounting(overallUsagePct) : '—', 'Weight (%)': formatPercentAccounting(weight9 * 100), 'Weight Scored (%)': formatPercentAccounting(weightScored9 * 100) }], headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Achieved': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' }, colWidths: [32, 12, 14, 12, 16] }
    ];
    const sheet10Tables = [
      { title: `65% achieved of Data consent from each Cluster — ${monthLabel}`, data: sheet10Data, headerColors: { 'Date': '#4472C4', 'Total Leads': '#70AD47', 'Rejected Leads': '#ED7D31', 'Not Provided Leads': '#ED7D31', 'Consented Leads': '#70AD47' }, colWidths: [12, 14, 20, 22, 18], totalRowIndices: crmConsentRows.length ? [sheet10Data.length - 1] : [], accountingColumns: ['Total Leads'], rowFillColors: sheet10RowFillColors },
      { title: 'Summary', data: [{ 'KPI': '65% achieved of Data consent from each Cluster', 'Target': targetConsent65 + '%', 'Average consent': avgConsentPct != null ? formatPercentAccounting(avgConsentPct) : '—', 'Weight (%)': formatPercentAccounting(weight10 * 100), 'Weight Scored (%)': formatPercentAccounting(weightScored10 * 100) }], headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Average consent': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' }, colWidths: [42, 12, 16, 12, 16] }
    ];
    summaryRows.push({ kpi: '90% proper usage of CRM', target: targetUsage90 + '%', achieved: overallUsagePct, achievedDisplay: overallUsagePct != null ? formatPercentAccounting(overallUsagePct) : '—', pct: overallUsagePct, weight: weight9, weightScored: weightScored9 });
    summaryRows.push({ kpi: '65% achieved of Data consent from each Cluster', target: targetConsent65 + '%', achieved: avgConsentPct, achievedDisplay: avgConsentPct != null ? formatPercentAccounting(avgConsentPct) : '—', pct: avgConsentPct, weight: weight10, weightScored: weightScored10 });

    // ----- KPI Summary (first sheet): add % weight scored, sort by it (best first), colour rows like Branch Sales -----
    const totalWeight = summaryRows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
    const totalWeightScored = summaryRows.reduce((s, r) => s + (Number(r.weightScored) || 0), 0);
    const totalPctWeightScored = totalWeight > 0 ? (totalWeightScored / totalWeight) * 100 : 0;
    const summaryRowsWithPct = summaryRows.map((r) => {
      const w = Number(r.weight) || 0;
      const ws = Number(r.weightScored) || 0;
      const pctWeightScored = w > 0 ? (ws / w) * 100 : 0;
      return { ...r, pctWeightScored };
    });
    const sortedSummaryRows = [...summaryRowsWithPct].sort((a, b) => (b.pctWeightScored ?? 0) - (a.pctWeightScored ?? 0));
    const summaryTableDataWithDisplay = sortedSummaryRows.map((r) => ({
      'KPI': r.kpi,
      'Target': r.target,
      'Achieved': r.achievedDisplay !== undefined ? r.achievedDisplay : (r.achieved != null ? String(r.achieved) : '—'),
      '% Achieved': formatPercentAccounting(r.pct),
      'Weight (%)': formatPercentAccounting(Number(r.weight) * 100),
      'Weight Scored (%)': r.weightScored != null ? formatPercentAccounting(Number(r.weightScored) * 100) : '—',
      '% Weight Scored': Number.isFinite(r.pctWeightScored) ? formatPercentAccounting(r.pctWeightScored) : '—'
    }));
    summaryTableDataWithDisplay.push({
      __totalRow: true,
      'KPI': 'Total',
      'Target': '',
      'Achieved': '',
      '% Achieved': '',
      'Weight (%)': formatPercentAccounting(totalWeight * 100),
      'Weight Scored (%)': formatPercentAccounting(totalWeightScored * 100),
      '% Weight Scored': formatPercentAccounting(totalPctWeightScored)
    });
    const kpiSummaryRowFillColors = sortedSummaryRows.map((r) => getColorForPct(r.pctWeightScored ?? 0));

    const kpiSummaryTable = {
      title: `KPI Summary — ${monthLabel}${viewSuffix}`,
      data: summaryTableDataWithDisplay,
      headerColors: { 'KPI': '#1e3a5f', 'Target': '#c45a11', 'Achieved': '#2d6a2d', '% Achieved': '#2d6a2d', 'Weight (%)': '#1a3a6e', 'Weight Scored (%)': '#1a3a6e', '% Weight Scored': '#1a3a6e' },
      colWidths: [50, 18, 16, 14, 12, 16, 16],
      totalRowIndices: [summaryTableDataWithDisplay.length - 1],
      rowFillColors: kpiSummaryRowFillColors
    };

    const fileName = csView !== 'Total' ? `CS_KPI_REPORT_${monthLabel.replace(/\s+/g, '_')}_${csView.replace(/\s+/g, '_')}.xlsx` : `CS_KPI_REPORT_${monthLabel.replace(/\s+/g, '_')}.xlsx`;

    const darkSep = { darkSeparator: true };
    const allTablesForOneSheet = [
      kpiSummaryTable,
      darkSep,
      ...(sheet1Tables || []),
      darkSep,
      ...(sheet2Tables || []),
      darkSep,
      ...(sheet3Tables || []),
      darkSep,
      ...(sheet4Tables || []),
      darkSep,
      ...(sheet5Tables || []),
      darkSep,
      ...(sheet6Tables || []),
      darkSep,
      ...(sheet7Tables || []),
      darkSep,
      ...(sheet8Tables || []),
      darkSep,
      ...(sheet9Tables || []),
      darkSep,
      ...(sheet10Tables || [])
    ];

    const sheets = [
      { name: 'All in One', tables: allTablesForOneSheet },
      { name: 'KPI Summary', tables: [kpiSummaryTable] },
      { name: 'Sales Target Achieve', tables: sheet1Tables },
      { name: 'Branch Sales Achieve', tables: sheet2Tables },
      { name: 'Mainland 65% New Biz', tables: sheet3Tables },
      { name: 'Zanzibar 70% New Biz', tables: sheet4Tables },
      { name: 'Portfolio Growth', tables: sheet5Tables },
      { name: 'PAR 30 Below 5%', tables: sheet6Tables },
      { name: 'Growth of active client base 20% annually', tables: sheet7Tables },
      { name: 'Ensure all Regions and Clusters hit their target', tables: sheet8Tables },
      { name: '90% proper usage of CRM', tables: sheet9Tables },
      { name: '65% achieved of Data consent from each Cluster', tables: sheet10Tables }
    ];

    return { sheets, fileName };
  }, [product, targets, effectiveTargetsForKpi, effectiveMonthKey, csView, mtdSalesAchievedForView, countrySheetClusterDisbursement, filteredBranchSummaryData, latestManagementReport, previousMonthManagementReport, mtdParsedData, managementReports]);

  /** Cluster-only Excel: 8 KPIs from cluster file, Management report disbursement, RSM tables, branch table, CRM, calculation tables. */
  const buildClusterKpiReportSheetsAndFile = useCallback(() => {
    if (product !== 'CS' || csView === 'Total' || !clusterTargets || !effectiveTargetsForKpi) return null;
    const monthLabel = monthKeyToLabel(effectiveMonthKey);
    const salesTarget = effectiveTargetsForKpi.salesTarget;
    const salesAchievedNum = typeof countrySheetClusterDisbursement === 'number' ? countrySheetClusterDisbursement : (countrySheetClusterDisbursement != null ? parseFloat(countrySheetClusterDisbursement) : NaN);
    const pctSales = Number.isFinite(salesAchievedNum) && salesTarget > 0 ? (salesAchievedNum / salesTarget) * 100 : null;

    const regionsNewBiz = clusterKpiTables?.regionsNewBiz ?? [];
    const recruitment = clusterKpiTables?.recruitment ?? [];

    const summaryTableData = (clusterDashboardRows || []).map((r) => ({
      'KPI': r.kpi,
      'Target': typeof r.target === 'number' ? formatTzs(r.target) : r.target,
      'Achieved': r.achievedDisplay !== undefined ? r.achievedDisplay : (r.achieved != null ? String(r.achieved) : '—'),
      '% Achieved': formatPercentAccounting(r.pct),
      'Weight (%)': formatPercentAccounting(Number(r.weight) * 100),
      'Weight Scored (%)': r.weightScored != null ? formatPercentAccounting(Number(r.weightScored) * 100) : '—',
      '% Weight Scored': r.pctWeightScored != null ? formatPercentAccounting(r.pctWeightScored) : '—'
    }));
    const totalWeight = (clusterDashboardRows || []).reduce((s, r) => s + (Number(r.weight) || 0), 0);
    const totalWeightScored = (clusterDashboardRows || []).reduce((s, r) => s + (Number(r.weightScored) || 0), 0);
    summaryTableData.push({
      __totalRow: true,
      'KPI': 'Total',
      'Target': '',
      'Achieved': '',
      '% Achieved': '',
      'Weight (%)': formatPercentAccounting(totalWeight * 100),
      'Weight Scored (%)': formatPercentAccounting(totalWeightScored * 100),
      '% Weight Scored': totalWeight > 0 ? formatPercentAccounting((totalWeightScored / totalWeight) * 100) : '—'
    });

    const clusterSummaryRowFillColors = (clusterDashboardRows || []).map((r) => getColorForPct(r.pctWeightScored ?? 0));
    const sheet1 = {
      title: `KPI Summary — ${monthLabel} — ${csView}`,
      data: summaryTableData,
      headerColors: { 'KPI': '#1e3a5f', 'Target': '#c45a11', 'Achieved': '#2d6a2d', '% Achieved': '#2d6a2d', 'Weight (%)': '#1a3a6e', 'Weight Scored (%)': '#1a3a6e', '% Weight Scored': '#1a3a6e' },
      colWidths: [50, 18, 16, 14, 12, 16, 14],
      totalRowIndices: summaryTableData.length ? [summaryTableData.length - 1] : [],
      rowFillColors: clusterSummaryRowFillColors
    };
    const sheet2 = {
      title: `1. Achieve 100% cluster sales target — ${csView}`,
      data: [
        { 'Metric': 'Cluster target', 'Value': salesTarget },
        { 'Metric': 'Disbursement this month (Management report)', 'Value': Number.isFinite(salesAchievedNum) ? salesAchievedNum : '—' },
        { 'Metric': '% Achieved', 'Value': pctSales != null ? formatPercentAccounting(pctSales) : '—' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [45, 22]
    };
    const sheet3Data = regionsNewBiz.map((r) => ({
      'Region': r.region,
      'New Business Target': r.target,
      'Achieved': r.achieved,
      '%': formatPercentAccounting(r.pct),
      'Hit target': r.target > 0 && r.achieved >= r.target ? 'Yes' : 'No'
    }));
    const sheet3 = {
      title: `2. Regions hit new Business target at 100% — ${csView}`,
      data: sheet3Data.length ? sheet3Data : [{ 'Region': '—', 'New Business Target': '—', 'Achieved': '—', '%': '—', 'Hit target': '—' }],
      headerColors: { 'Region': '#1e3a5f', 'New Business Target': '#c45a11', 'Achieved': '#2d6a2d', '%': '#2d6a2d', 'Hit target': '#5B9BD5' },
      colWidths: [28, 20, 18, 12, 12]
    };
    const recTotalTarget = recruitment.reduce((s, r) => s + (Number(r.target) || 0), 0);
    const recTotalAchieved = recruitment.reduce((s, r) => s + (Number(r.achieved) || 0), 0);
    const sheetRecData = recruitment.map((r) => ({
      'Region': r.region,
      'Target': r.target,
      'Achieved': r.achieved,
      '%': formatPercentAccounting(r.pct)
    }));
    if (recruitment.length > 0) {
      sheetRecData.push({
        __totalRow: true,
        'Region': 'Cluster total',
        'Target': recTotalTarget,
        'Achieved': recTotalAchieved,
        '%': recTotalTarget > 0 ? formatPercentAccounting((recTotalAchieved / recTotalTarget) * 100) : '—'
      });
    }
    const sheetRec = {
      title: `4. Achieve 85% recruitment — ${csView}`,
      data: sheetRecData.length ? sheetRecData : [{ 'Region': '—', 'Target': '—', 'Achieved': '—', '%': '—' }],
      headerColors: { 'Region': '#1e3a5f', 'Target': '#c45a11', 'Achieved': '#2d6a2d', '%': '#2d6a2d' },
      colWidths: [28, 14, 14, 12],
      totalRowIndices: sheetRecData.length ? [sheetRecData.length - 1] : []
    };
    const branchData = filteredBranchSummaryData?.branches ?? [];
    const sortedBranches = [...branchData].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const sheet4Data = sortedBranches.map((b) => ({
      'Branch': b.branch,
      'Target': b.target,
      'Disbursement this Month': b.disbursement,
      '%': b.pct != null ? formatPercentAccounting(b.pct) : '—'
    }));
    if (sheet4Data.length > 0 && filteredBranchSummaryData) {
      sheet4Data.push({
        __totalRow: true,
        'Branch': 'Total',
        'Target': filteredBranchSummaryData.totalTarget,
        'Disbursement this Month': filteredBranchSummaryData.totalDisbursement,
        '%': filteredBranchSummaryData.totalTarget > 0 ? formatPercentAccounting((filteredBranchSummaryData.totalDisbursement / filteredBranchSummaryData.totalTarget) * 100) : '—'
      });
    }
    const branchRowFillColors = sortedBranches.map((b) => getColorForPct(b.pct ?? 0));
    const totalBranches = (filteredBranchSummaryData?.achieved100Count ?? 0) + (filteredBranchSummaryData?.notAchieved100Count ?? 0);
    const atOrAbove100 = filteredBranchSummaryData?.achieved100Count ?? 0;
    const pctBranches100 = totalBranches > 0 ? (atOrAbove100 / totalBranches) * 100 : null;
    const sheet4 = {
      title: `3. 90% branches on sales target — ${csView}`,
      data: sheet4Data.length ? sheet4Data : [{ 'Branch': '—', 'Target': '—', 'Disbursement this Month': '—', '%': '—' }],
      headerColors: { 'Branch': '#1e3a5f', 'Target': '#c45a11', 'Disbursement this Month': '#2d6a2d', '%': '#2d6a2d' },
      colWidths: [28, 16, 20, 12],
      totalRowIndices: sheet4Data.length ? [sheet4Data.length - 1] : [],
      rowFillColors: branchRowFillColors,
      accountingColumns: ['Target', 'Disbursement this Month']
    };
    const portfolioCurrent = countrySheetClusterPortfolio ?? latestManagementReport?.cs?.['Portfolio'] ?? latestManagementReport?.cs?.['Total Portfolio'] ?? latestManagementReport?.cs?.['Principle Balance'] ?? null;
    const portfolioPrev = countrySheetClusterPortfolioPrevious ?? previousMonthManagementReport?.cs?.['Portfolio'] ?? previousMonthManagementReport?.cs?.['Total Portfolio'] ?? previousMonthManagementReport?.cs?.['Principle Balance'] ?? null;
    const curPort = typeof portfolioCurrent === 'number' ? portfolioCurrent : (portfolioCurrent != null ? parseFloat(portfolioCurrent) : NaN);
    const prevPort = typeof portfolioPrev === 'number' ? portfolioPrev : (portfolioPrev != null ? parseFloat(portfolioPrev) : NaN);
    const growthPct = Number.isFinite(prevPort) && prevPort > 0 && Number.isFinite(curPort) ? ((curPort - prevPort) / prevPort) * 100 : null;
    const annualizedGrowth = growthPct != null ? growthPct * 12 : null;
    const sheet5 = {
      title: `5. Growth portfolio and client base by 20% annually — ${csView}`,
      data: [
        { 'Metric': `Portfolio (${monthLabel})`, 'Value': Number.isFinite(curPort) ? curPort : '—' },
        { 'Metric': 'Portfolio (previous month)', 'Value': Number.isFinite(prevPort) ? prevPort : '—' },
        { 'Metric': 'Monthly growth %', 'Value': growthPct != null ? formatPercentAccounting(growthPct) : '—' },
        { 'Metric': 'Annualized growth %', 'Value': annualizedGrowth != null ? formatPercentAccounting(annualizedGrowth) : '—' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [45, 22],
      accountingColumns: ['Value']
    };

    const par30Val = countrySheetClusterPar30 ?? latestManagementReport?.cs?.['PAR >30'] ?? latestManagementReport?.cs?.['PAR>30'] ?? null;
    const par30Pct = normalizeParToPercentage(par30Val);
    const par30Display = Number.isFinite(par30Pct) ? formatPercentAccounting(par30Pct) : '—';
    const sheet6 = {
      title: `6. Maintain PAR 30 days under 5% — ${csView}`,
      data: [
        { 'Metric': `PAR >30 (${monthLabel})`, 'Value': par30Display },
        { 'Metric': 'Target', 'Value': '≤ 5%' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [45, 22]
    };

    const onLocationPct = crmClusterAggregated?.completed > 0
      ? (crmClusterAggregated.atLocation / crmClusterAggregated.completed) * 100
      : null;
    const dataConsentPct = crmClusterAggregated?.total > 0
      ? (crmClusterAggregated.accepted / crmClusterAggregated.total) * 100
      : null;
    const sheetCrmLocation = {
      title: `7. On location completion (95% target) — ${csView}`,
      data: [
        { 'Metric': 'Completed (Status=COMPLETED)', 'Value': crmClusterAggregated?.completed ?? '—' },
        { 'Metric': 'At location (Target_Met=AT_LOCATION)', 'Value': crmClusterAggregated?.atLocation ?? '—' },
        { 'Metric': '% At location', 'Value': onLocationPct != null ? formatPercentAccounting(onLocationPct) : '—' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [45, 18]
    };
    const onLocationTableData = (onLocationTable || []).map((r) => ({
      'Report Date': r.reportDate,
      'Completed': r.completed,
      'At location': r.atLocation,
      '% At location': r.pctAtLocation != null ? formatPercentAccounting(r.pctAtLocation) : '—'
    }));
    const tableOnLocationByDate = onLocationTableData.length > 0 ? {
      title: 'Per-report (all CRM reports in month)',
      data: onLocationTableData,
      headerColors: { 'Report Date': '#4472C4', 'Completed': '#70AD47', 'At location': '#70AD47', '% At location': '#70AD47' },
      colWidths: [14, 12, 14, 16]
    } : null;

    const sheetCrmConsent = {
      title: `8. Data consent (80% target) — ${csView}`,
      data: [
        { 'Metric': 'Total lead (cluster, all reports in month)', 'Value': crmClusterAggregated?.total ?? '—' },
        { 'Metric': 'Total consent (Accepted) (cluster)', 'Value': crmClusterAggregated?.accepted ?? '—' },
        { 'Metric': '% consented', 'Value': dataConsentPct != null ? formatPercentAccounting(dataConsentPct) : '—' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [45, 18]
    };
    const consentTableData = (consentTable || []).map((r) => ({
      'Report Date': r.reportDate,
      'Total lead': r.totalLead,
      'Total consent (Accepted)': r.accepted,
      '% consented': r.pctConsented != null ? formatPercentAccounting(r.pctConsented) : '—'
    }));
    const tableConsentByDate = consentTableData.length > 0 ? {
      title: 'Per-report (all CRM reports in month)',
      data: consentTableData,
      headerColors: { 'Report Date': '#4472C4', 'Total lead': '#70AD47', 'Total consent (Accepted)': '#70AD47', '% consented': '#70AD47' },
      colWidths: [14, 12, 22, 14]
    } : null;
    const darkSep = { darkSeparator: true };
    const allTablesForOneSheet = [
      sheet1,
      darkSep,
      sheet2,
      darkSep,
      sheet3,
      darkSep,
      sheetRec,
      darkSep,
      sheet4,
      darkSep,
      sheet5,
      darkSep,
      sheet6,
      darkSep,
      sheetCrmLocation,
      ...(tableOnLocationByDate ? [tableOnLocationByDate] : []),
      darkSep,
      sheetCrmConsent,
      ...(tableConsentByDate ? [tableConsentByDate] : [])
    ];
    const sheets = [
      { name: 'All in One', tables: allTablesForOneSheet },
      { name: 'KPI Summary', tables: [sheet1] },
      { name: '1 Cluster Sales Target', tables: [sheet2] },
      { name: '2 Regions New Business', tables: [sheet3] },
      { name: '3 Branch Sales', tables: [sheet4] },
      { name: '4 Recruitment', tables: [sheetRec] },
      { name: '5 Portfolio Growth', tables: [sheet5] },
      { name: '6 PAR 30', tables: [sheet6] },
      { name: '7 On Location Completion', tables: [sheetCrmLocation, ...(tableOnLocationByDate ? [tableOnLocationByDate] : [])] },
      { name: '8 Data Consent', tables: [sheetCrmConsent, ...(tableConsentByDate ? [tableConsentByDate] : [])] }
    ];
    const fileName = `CS_Cluster_KPI_${monthLabel.replace(/\s+/g, '_')}_${csView.replace(/\s+/g, '_')}.xlsx`;
    return { sheets, fileName };
  }, [product, csView, clusterTargets, effectiveTargetsForKpi, effectiveMonthKey, countrySheetClusterDisbursement, countrySheetClusterPortfolio, countrySheetClusterPortfolioPrevious, countrySheetClusterPar30, clusterDashboardRows, clusterKpiTables, crmClusterAggregated, filteredBranchSummaryData, onLocationTable, consentTable, latestManagementReport, previousMonthManagementReport]);

  const handleDownloadXlsx = useCallback(async () => {
    if (csView !== 'Total') {
      const r = buildClusterKpiReportSheetsAndFile();
      if (r) await exportMultipleSheetsWithStyles(r.sheets, r.fileName, { twoDecimalPlaces: true });
    } else {
      const r = await buildKpiReportSheetsAndFile();
      if (r) await exportMultipleSheetsWithStyles(r.sheets, r.fileName, { twoDecimalPlaces: true });
    }
  }, [buildKpiReportSheetsAndFile, buildClusterKpiReportSheetsAndFile, csView]);

  const {
    nonCsSummaryRows,
    buildNonCsReportSheetsAndFile,
    lbfBranchSummaryData,
    lbfCrmDailyRows = [],
    sortedBranchesByPct = []
  } = useNonCsKpiAnalysis({
    product,
    targets,
    effectiveMonthKey,
    latestManagementReport,
    previousMonthManagementReport,
    toMonthKey,
    monthKeyToLabel,
    normalizeParToPercentage,
    formatTzs
  });

  const crmConsentTotals = useMemo(() => aggregateCrmConsentDailyRows(lbfCrmDailyRows), [lbfCrmDailyRows]);
  const crmUsageTotals = useMemo(() => aggregateCrmUsageDailyRows(lbfCrmDailyRows), [lbfCrmDailyRows]);
  const branchDisbursementTotals = useMemo(
    () => aggregateBranchDisbursementRows(sortedBranchesByPct),
    [sortedBranchesByPct]
  );

  const handleUploadKpiTargetFile = async (file) => {
    if (!file) return;
    setKpiUploadLoading(true);
    setKpiUploadError('');
    try {
      const kindToUpload = csView !== 'Total' ? 'CLUSTER' : 'TOTAL';
      const res = await kpiTargetsAPI.upload({ product, kind: kindToUpload, file });
      if (!res?.success) {
        throw new Error(res?.error || 'KPI target upload failed');
      }

      // Refresh versions + active parsed JSON for the uploaded kind
      if (kindToUpload === 'TOTAL') {
        const versRes = await kpiTargetsAPI.getVersions({ product, kind: 'TOTAL' }).catch(() => null);
        setTotalVersions(versRes?.data || []);

        const activeRes = await kpiTargetsAPI.getActive({ product, kind: 'TOTAL' });
        const fileMeta = activeRes?.data?.file;
        setTargets(activeRes?.data?.parsed || null);
        setTargetsMissing(false);
        setTotalVersionId(fileMeta?.id || null);
        setTotalActiveFileName(fileMeta?.fileName || '');
      } else {
        const versRes = await kpiTargetsAPI.getVersions({ product, kind: 'CLUSTER' }).catch(() => null);
        setClusterVersions(versRes?.data || []);

        const activeRes = await kpiTargetsAPI.getActive({ product, kind: 'CLUSTER' });
        const fileMeta = activeRes?.data?.file;
        setClusterTargets(activeRes?.data?.parsed || null);
        setClusterTargetsMissing(false);
        setClusterVersionId(fileMeta?.id || null);
        setClusterActiveFileName(fileMeta?.fileName || '');
      }
    } catch (e) {
      setKpiUploadError(e?.message || 'Failed to parse KPI target file. Ensure it matches the expected format.');
    } finally {
      setKpiUploadLoading(false);
    }
  };

  const activateTotalKpiVersion = async (fileId) => {
    if (!fileId) return;
    setTargetsLoading(true);
    setTargetsError(null);
    try {
      await kpiTargetsAPI.activate(fileId);
      const [activeRes, versRes] = await Promise.all([
        kpiTargetsAPI.getActive({ product, kind: 'TOTAL' }),
        kpiTargetsAPI.getVersions({ product, kind: 'TOTAL' }).catch(() => null)
      ]);
      const fileMeta = activeRes?.data?.file;
      setTargets(activeRes?.data?.parsed || null);
      setTargetsMissing(false);
      setTotalVersionId(fileMeta?.id || null);
      setTotalActiveFileName(fileMeta?.fileName || '');
      setTotalVersions(versRes?.data || []);
    } catch (e) {
      setTargetsError(e?.message || 'Failed to activate KPI version');
      setTargets(null);
      setTargetsMissing(true);
    } finally {
      setTargetsLoading(false);
    }
  };

  const activateClusterKpiVersion = async (fileId) => {
    if (!fileId) return;
    setTargetsLoading(true);
    try {
      await kpiTargetsAPI.activate(fileId);
      const [activeRes, versRes] = await Promise.all([
        kpiTargetsAPI.getActive({ product, kind: 'CLUSTER' }),
        kpiTargetsAPI.getVersions({ product, kind: 'CLUSTER' }).catch(() => null)
      ]);
      const fileMeta = activeRes?.data?.file;
      setClusterTargets(activeRes?.data?.parsed || null);
      setClusterTargetsMissing(false);
      setClusterVersionId(fileMeta?.id || null);
      setClusterActiveFileName(fileMeta?.fileName || '');
      setClusterVersions(versRes?.data || []);
    } catch (e) {
      // Keep totals intact; only cluster KPI changes.
      setClusterTargets(null);
      setClusterVersionId(null);
      setClusterActiveFileName('');
      setClusterTargetsMissing(true);
    } finally {
      setTargetsLoading(false);
    }
  };

  const removeTotalKpiVersion = async () => {
    if (!totalVersionId) return;
    const ok = window.confirm('Soft-delete this TOTAL KPI target version?');
    if (!ok) return;
    setTargetsLoading(true);
    setTargetsError(null);
    try {
      await kpiTargetsAPI.remove(totalVersionId);
      const [versRes, activeRes] = await Promise.all([
        kpiTargetsAPI.getVersions({ product, kind: 'TOTAL' }).catch(() => null),
        kpiTargetsAPI.getActive({ product, kind: 'TOTAL' }).catch(() => null)
      ]);
      setTotalVersions(versRes?.data || []);
      const fileMeta = activeRes?.data?.file;
      setTargets(activeRes?.data?.parsed || null);
      setTotalVersionId(fileMeta?.id || null);
      setTotalActiveFileName(fileMeta?.fileName || '');
      setTargetsMissing(activeRes?.data?.file ? false : true);
    } catch (e) {
      setTargetsError(e?.message || 'Failed to remove KPI target version');
    } finally {
      setTargetsLoading(false);
    }
  };

  const removeClusterKpiVersion = async () => {
    if (!clusterVersionId) return;
    const ok = window.confirm('Soft-delete this CLUSTER KPI target version?');
    if (!ok) return;
    setTargetsLoading(true);
    try {
      await kpiTargetsAPI.remove(clusterVersionId);
      const [versRes, activeRes] = await Promise.all([
        kpiTargetsAPI.getVersions({ product, kind: 'CLUSTER' }).catch(() => null),
        kpiTargetsAPI.getActive({ product, kind: 'CLUSTER' }).catch(() => null)
      ]);
      setClusterVersions(versRes?.data || []);
      const fileMeta = activeRes?.data?.file;
      setClusterTargets(activeRes?.data?.parsed || null);
      setClusterVersionId(fileMeta?.id || null);
      setClusterActiveFileName(fileMeta?.fileName || '');
      setClusterTargetsMissing(activeRes?.data?.file ? false : true);
    } catch (e) {
      // Keep going: total targets remain intact.
    } finally {
      setTargetsLoading(false);
    }
  };

  const getBuildResultForEmail = useCallback(async () => {
    if (csView !== 'Total') return buildClusterKpiReportSheetsAndFile();
    return await buildKpiReportSheetsAndFile();
  }, [csView, buildClusterKpiReportSheetsAndFile, buildKpiReportSheetsAndFile]);

  const addRecipient = () => {
    const email = (newRecipient || '').trim().toLowerCase();
    if (!email) return;
    if (recipients.includes(email)) return;
    setRecipients((prev) => [...prev, email]);
    setNewRecipient('');
  };

  const removeRecipient = (email) => {
    setRecipients((prev) => prev.filter((r) => r !== email));
  };

  const copyRecipientList = () => {
    if (recipients.length === 0) return;
    navigator.clipboard.writeText(recipients.join('\n')).then(() => {
      setCopiedList(true);
      setTimeout(() => setCopiedList(false), 2000);
    }).catch(() => {});
  };

  const parseEmailsFromText = (text) => {
    const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return [...new Set(text.split(/\s*[\n,;\t]\s*/).map((s) => s.trim().toLowerCase()).filter((s) => emailLike.test(s)))];
  };

  const pasteEmails = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const toAdd = parseEmailsFromText(text).filter((e) => !recipients.includes(e));
      if (toAdd.length === 0) {
        setSendError(recipients.length === 0 ? 'No valid emails in clipboard. Paste lines or comma-separated addresses.' : 'No new valid emails to add.');
        return;
      }
      setRecipients((prev) => [...prev, ...toAdd]);
      setSendError('');
    } catch {
      setSendError('Clipboard access denied. Paste into the box below and click "Add pasted".');
    }
  };

  const addPasteBoxEmails = () => {
    const toAdd = parseEmailsFromText(pasteBox).filter((e) => !recipients.includes(e));
    if (toAdd.length === 0) {
      setSendError(pasteBox.trim() ? 'No valid emails in the box.' : 'Paste emails above (one per line or comma-separated), then click Add pasted.');
      return;
    }
    setRecipients((prev) => [...prev, ...toAdd]);
    setPasteBox('');
    setSendError('');
  };

  const copyMessageBody = () => {
    const monthLabel = monthKeyToLabel(effectiveMonthKey);
    if (product !== 'CS') {
      const html = emailBody || buildNonCsKpiReportEmailHTML(product, monthLabel, true);
      const div = document.createElement('div');
      div.innerHTML = html;
      const text = (div.innerText || div.textContent || '').trim();
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        setCopiedBody(true);
        setTimeout(() => setCopiedBody(false), 2000);
      }).catch(() => {});
      return;
    }
    const html = emailBody || (csView !== 'Total'
      ? buildClusterKpiReportEmailHTML(monthLabel, true, csView)
      : buildKpiReportEmailHTML(monthLabel, true));
    const div = document.createElement('div');
    div.innerHTML = html;
    const text = (div.innerText || div.textContent || '').trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedBody(true);
      setTimeout(() => setCopiedBody(false), 2000);
    }).catch(() => {});
  };

  const generatePreview = () => {
    const monthLabel = monthKeyToLabel(effectiveMonthKey);
    if (product !== 'CS') {
      setEmailSubject(`${product} KPI Analysis Report — ${monthLabel}`);
      setEmailBody(buildNonCsKpiReportEmailHTML(product, monthLabel, true));
      setShowPreview(true);
      return;
    }
    const defaultSubject = csView !== 'Total'
      ? `CS Cluster KPI Report — ${monthLabel} — ${csView}`
      : `CS KPI Analysis Report — ${monthLabel}`;
    const html = csView !== 'Total'
      ? buildClusterKpiReportEmailHTML(monthLabel, true, csView)
      : buildKpiReportEmailHTML(monthLabel, true);
    setEmailSubject(defaultSubject);
    setEmailBody(html);
    setShowPreview(true);
  };

  const handleSendEmail = async () => {
    if (recipients.length === 0) {
      setSendError('Add at least one recipient.');
      return;
    }
    setSending(true);
    setSendError('');
    setSendProgress(recipients.map((email) => ({ email, status: 'sending', error: null })));

    const monthLabel = monthKeyToLabel(effectiveMonthKey);

    if (product !== 'CS') {
      const defaultSubject = `${product} KPI Analysis Report — ${monthLabel}`;
      const subject = emailSubject || defaultSubject;
      const htmlBody = emailBody || buildNonCsKpiReportEmailHTML(product, monthLabel, true);
      const attachments = [];
      if (totalVersionId) {
        try {
          const blob = await kpiTargetsAPI.downloadBlob(totalVersionId);
          const ab = await blob.arrayBuffer();
          attachments.push({
            base64: arrayBufferToBase64(ab),
            name: totalActiveFileName || `${product}_KPI_TARGET.xlsx`
          });
        } catch (e) {
          setSendProgress((prev) => prev.map((p) => ({
            ...p,
            status: 'failed',
            error: e?.message || 'Could not download KPI target file for attachment'
          })));
          setSending(false);
          return;
        }
      }
      const nonCsReport = buildNonCsReportSheetsAndFile();
      if (nonCsReport) {
        const built = await buildWorkbookBuffer(nonCsReport.sheets, nonCsReport.fileName, { twoDecimalPlaces: true });
        if (built?.buffer) {
          const binary = Array.from(built.buffer).map((b) => String.fromCharCode(b)).join('');
          attachments.push({ base64: btoa(binary), name: built?.fileName || nonCsReport.fileName });
        }
      }
      if (attachments.length === 0) {
        setSendProgress((prev) => prev.map((p) => ({
          ...p,
          status: 'failed',
          error: 'Could not build report for attachment. Download xlsx first or check KPI data.'
        })));
        setSending(false);
        return;
      }
      const emailOptions = { mode: 'KPI' };
      if (attachments.length === 1) {
        emailOptions.attachmentBase64 = attachments[0].base64;
        emailOptions.attachmentName = attachments[0].name;
      } else {
        emailOptions.attachments = attachments;
      }
      const emailResult = await sendScoreCardEmail(recipients, subject, htmlBody, emailOptions);
      const status = emailResult.success ? 'success' : 'failed';
      const error = emailResult.success ? null : (emailResult.error || 'Failed to send');
      setSendProgress((prev) => prev.map((p) => ({ ...p, status, error })));
      setSending(false);
      return;
    }

    const defaultSubject = csView !== 'Total'
      ? `CS Cluster KPI Report — ${monthLabel} — ${csView}`
      : `CS KPI Analysis Report — ${monthLabel}`;
    const subject = emailSubject || defaultSubject;
    const htmlBody = emailBody || (csView !== 'Total'
      ? buildClusterKpiReportEmailHTML(monthLabel, true, csView)
      : buildKpiReportEmailHTML(monthLabel, true));

    const isCluster = csView !== 'Total';
    let attachments = [];

    if (isCluster) {
      // Cluster email: attach (1) target file, (2) KPI analysis workbook
      try {
        if (!clusterVersionId) {
          throw new Error('No active cluster KPI target file selected.');
        }
        const blob = await kpiTargetsAPI.downloadBlob(clusterVersionId);
        const ab = await blob.arrayBuffer();
        const base64 = arrayBufferToBase64(ab);
        attachments.push({
          base64,
          name: clusterActiveFileName || CLUSTER_TARGET_ATTACHMENT_NAME
        });
      } catch (e) {
        setSendProgress((prev) => prev.map((p) => ({ ...p, status: 'failed', error: 'Could not load cluster target file for attachment' })));
        setSending(false);
        return;
      }
    }

    const r = await getBuildResultForEmail();
    if (r) {
      const result = await buildWorkbookBuffer(r.sheets, r.fileName, { twoDecimalPlaces: true });
      if (result?.buffer) {
        const binary = Array.from(result.buffer).map((b) => String.fromCharCode(b)).join('');
        const kpiAttachment = { base64: btoa(binary), name: result.fileName };
        if (isCluster) {
          attachments.push(kpiAttachment);
        } else {
          attachments = [{ base64: kpiAttachment.base64, name: kpiAttachment.name }];
        }
      }
    }

    if (attachments.length === 0) {
      setSendProgress((prev) => prev.map((p) => ({ ...p, status: 'failed', error: 'Could not build report for attachment. Try again or download first.' })));
      setSending(false);
      return;
    }
    // Use legacy single-attachment fields when exactly one (backend compatibility); use attachments array when multiple
    const emailOptions = { mode: 'KPI' };
    if (attachments.length === 1) {
      emailOptions.attachmentBase64 = attachments[0].base64;
      emailOptions.attachmentName = attachments[0].name;
    } else {
      emailOptions.attachments = attachments;
    }
    const emailResult = await sendScoreCardEmail(recipients, subject, htmlBody, emailOptions);

    const status = emailResult.success ? 'success' : 'failed';
    const error = emailResult.success ? null : (emailResult.error || 'Failed to send');
    setSendProgress((prev) => prev.map((p) => ({ ...p, status, error })));
    setSending(false);
  };

  const renderKpiEmailModal = () => {
    if (!showEmailModal) return null;
    return (
      <div
        className="kpi-ar-email-overlay"
        onClick={() => { if (!sending) { setShowEmailModal(false); setSendProgress(null); } }}
      >
        <div className="kpi-ar-email-modal" onClick={(e) => e.stopPropagation()}>
          <div className="kpi-ar-email-modal-header">
            <div className="kpi-ar-email-modal-title-wrap">
              <h3 className="kpi-ar-email-modal-title">Send KPI Analysis Report by Email</h3>
              <p className="kpi-ar-email-modal-view-hint">
                {product !== 'CS' ? (
                  <>Sending <strong>{product}</strong> KPI Analysis Report (KPI target file + analysis workbook when available).</>
                ) : (
                  <>
                    Sending for current view: <strong>{csView}</strong>
                    {csView !== 'Total' && ' — attachment and content are for this cluster only.'}
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              className="kpi-ar-email-modal-close"
              onClick={() => { if (!sending) { setShowEmailModal(false); setShowPreview(false); setSendProgress(null); } }}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {sendProgress && sendProgress.length > 0 && (
            <div className="kpi-ar-email-progress">
              <h4 className="kpi-ar-email-progress-title">
                {sending ? 'Sending email to all recipients…' : 'Send result'}
              </h4>
              <ul className="kpi-ar-email-progress-list">
                {sendProgress.map(({ email, status, error }) => (
                  <li key={email} className={`kpi-ar-email-progress-item kpi-ar-email-progress-item--${status}`}>
                    <span className="kpi-ar-email-progress-email">{email}</span>
                    <span className="kpi-ar-email-progress-status">
                      {status === 'sending' && <span className="kpi-ar-email-progress-spinner" aria-hidden>⏳</span>}
                      {status === 'success' && <span className="kpi-ar-email-progress-ok" title="Sent">✓</span>}
                      {status === 'failed' && <span className="kpi-ar-email-progress-fail" title={error || 'Failed'}>✗</span>}
                    </span>
                    {status === 'failed' && error && (
                      <span className="kpi-ar-email-progress-error">{error}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="kpi-ar-email-modal-body">
            <p className="kpi-ar-email-hint">Recipients (saved for next time):</p>
            <div className="kpi-ar-email-recipients-input">
              <input
                type="email"
                placeholder="Enter email address"
                value={newRecipient}
                onChange={(e) => setNewRecipient(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
                className="kpi-ar-email-recipient-input"
              />
              <button type="button" className="kpi-ar-email-add-btn" onClick={addRecipient}>
                Add
              </button>
            </div>
            <div className="kpi-ar-email-copy-actions">
              <button
                type="button"
                className="kpi-ar-email-copy-btn"
                onClick={copyRecipientList}
                disabled={sending || recipients.length === 0}
                title="Copy all emails to clipboard"
              >
                {copiedList ? '✓ Copied!' : 'Copy email list'}
              </button>
              <button
                type="button"
                className="kpi-ar-email-copy-btn"
                onClick={pasteEmails}
                disabled={sending}
                title="Paste emails from clipboard (one per line or comma/semicolon separated)"
              >
                Paste
              </button>
              <button
                type="button"
                className="kpi-ar-email-copy-btn kpi-ar-email-copy-body-btn"
                onClick={copyMessageBody}
                disabled={sending}
                title="Copy message (plain text)"
              >
                {copiedBody ? '✓ Copied!' : 'Copy message'}
              </button>
            </div>
            <div className="kpi-ar-email-paste-box-wrap">
              <textarea
                className="kpi-ar-email-paste-box"
                placeholder="Or paste emails here (one per line or comma/semicolon separated)"
                value={pasteBox}
                onChange={(e) => setPasteBox(e.target.value)}
                rows={2}
              />
              <button type="button" className="kpi-ar-email-copy-btn kpi-ar-email-add-pasted-btn" onClick={addPasteBoxEmails}>
                Add pasted
              </button>
            </div>
            <ul className="kpi-ar-email-recipients-list">
              {recipients.map((email) => (
                <li key={email} className="kpi-ar-email-recipient-item">
                  <span className="kpi-ar-email-recipient-email">{email}</span>
                  <button type="button" className="kpi-ar-email-remove-btn" onClick={() => removeRecipient(email)} title="Remove">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {recipients.length === 0 && (
              <p className="kpi-ar-email-empty">No recipients yet. Add one above.</p>
            )}

            <div className="kpi-ar-email-preview-section">
              <button type="button" className="kpi-ar-email-preview-toggle" onClick={() => showPreview ? setShowPreview(false) : generatePreview()}>
                {showPreview ? '▼ Hide Email Preview' : '▶ Preview Email'}
              </button>
              {showPreview && (
                <div className="kpi-ar-email-preview-container">
                  <div className="kpi-ar-email-preview-subject">
                    <label>Subject:</label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      className="kpi-ar-email-subject-input"
                    />
                  </div>
                  <div className="kpi-ar-email-preview-body">
                    <label>Email Body:</label>
                    <div className="kpi-ar-email-preview-html" dangerouslySetInnerHTML={{ __html: emailBody }} />
                  </div>
                  <p className="kpi-ar-email-preview-attachment">
                    📎 {product !== 'CS' ? (
                      totalVersionId && totalActiveFileName ? (
                        <>Attachments: (1) {totalActiveFileName} (2) {product}_KPI_REPORT_{effectiveMonthKey ? monthKeyToLabel(effectiveMonthKey).replace(/\s+/g, '_') : 'report'}.xlsx</>
                      ) : (
                        <>Attachment: {product}_KPI_REPORT_{effectiveMonthKey ? monthKeyToLabel(effectiveMonthKey).replace(/\s+/g, '_') : 'report'}.xlsx</>
                      )
                    ) : csView !== 'Total' ? (
                      <>Attachments: (1) {CLUSTER_TARGET_ATTACHMENT_NAME} (2) CS_Cluster_KPI_{effectiveMonthKey ? monthKeyToLabel(effectiveMonthKey).replace(/\s+/g, '_') : 'report'}_{csView.replace(/\s+/g, '_')}.xlsx</>
                    ) : (
                      <>Attachment: CS_KPI_REPORT_{effectiveMonthKey ? monthKeyToLabel(effectiveMonthKey).replace(/\s+/g, '_') : 'report'}.xlsx</>
                    )}
                  </p>
                </div>
              )}
            </div>

            {sendError && <p className="kpi-ar-email-error">{sendError}</p>}
          </div>
          <div className="kpi-ar-email-modal-footer">
            <button
              type="button"
              className="kpi-ar-email-cancel"
              onClick={() => { if (!sending) { setShowEmailModal(false); setShowPreview(false); setSendProgress(null); } }}
            >
              {sendProgress && !sending ? 'Close' : 'Cancel'}
            </button>
            <button
              type="button"
              className="kpi-ar-email-send"
              onClick={handleSendEmail}
              disabled={sending || recipients.length === 0}
            >
              {sending ? 'Sending…' : 'Send Email'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (product !== 'CS') {
    return (
      <div className="kpi-ar-container">
        <div className="kpi-ar-header-bar">
          <h1 className="kpi-ar-title">KPI ANALYSIS REPORT — {product}</h1>
          <div className="kpi-ar-header-controls">
            <label className="kpi-ar-month-label">
              Month
              <select
                className="kpi-ar-month-select"
                value={effectiveMonthKey || ''}
                onChange={(e) => setSelectedMonthKey(e.target.value || null)}
              >
                {availableMonths.length === 0 && <option value="">No data</option>}
                {availableMonths.map((key) => (
                  <option key={key} value={key}>{monthKeyToLabel(key)}</option>
                ))}
              </select>
            </label>
            <label className="kpi-ar-month-label">
              Total KPI Version
              <select
                className="kpi-ar-month-select"
                value={totalVersionId || ''}
                onChange={(e) => activateTotalKpiVersion(e.target.value)}
                disabled={!totalVersions?.length}
              >
                {(!totalVersions || totalVersions.length === 0) && <option value="">No versions</option>}
                {(totalVersions || []).map((v) => (
                  <option key={v.id} value={v.id}>{v.fileName}</option>
                ))}
              </select>
              <button type="button" className="kpi-ar-btn" onClick={removeTotalKpiVersion} disabled={!totalVersionId}>Remove</button>
            </label>
            <button type="button" className="kpi-ar-btn kpi-ar-btn-email" onClick={() => setShowEmailModal(true)}>
              <span className="kpi-ar-btn-icon">✉</span> Send Email
            </button>
            <button
              type="button"
              className="kpi-ar-btn kpi-ar-btn-view"
              disabled={!totalVersionId}
              onClick={() => {
                if (!totalVersionId) return;
                (async () => {
                  const blob = await kpiTargetsAPI.downloadBlob(totalVersionId);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = totalActiveFileName || 'kpi-target.xlsx';
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
                })().catch(() => {});
              }}
            >
              <span className="kpi-ar-btn-icon">📋</span> View KPI
            </button>
            <button
              type="button"
              className="kpi-ar-btn kpi-ar-btn-upload"
              onClick={() => kpiTargetFileInputRef.current?.click()}
              disabled={kpiUploadLoading}
              title="Upload KPI target XLSX (backend-managed)"
            >
              <span className="kpi-ar-btn-icon">⤒</span> Upload KPI (TOTAL)
            </button>
            <input
              ref={kpiTargetFileInputRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUploadKpiTargetFile(file);
                // allow re-upload of the same file name
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="kpi-ar-btn kpi-ar-btn-download"
              onClick={async () => {
                const report = buildNonCsReportSheetsAndFile();
                if (!report) return;
                await exportMultipleSheetsWithStyles(report.sheets, report.fileName, { twoDecimalPlaces: true });
              }}
              disabled={targetsMissing || !totalVersionId}
              title="Download KPI summary xlsx"
            >
              <span className="kpi-ar-btn-icon">📥</span> Download xlsx
            </button>
          </div>
        </div>
        {!lockProduct && (
          <div className="kpi-ar-product-toggles">
            <button
              type="button"
              className={`kpi-ar-product-btn ${product === 'CS' ? 'kpi-ar-product-btn--active' : ''}`}
              onClick={() => setProduct('CS')}
            >CS</button>
            <button
              type="button"
              className={`kpi-ar-product-btn ${product === 'LBF' ? 'kpi-ar-product-btn--active' : ''}`}
              onClick={() => setProduct('LBF')}
            >LBF</button>
            <button
              type="button"
              className={`kpi-ar-product-btn ${product === 'SME' ? 'kpi-ar-product-btn--active' : ''}`}
              onClick={() => setProduct('SME')}
            >SME</button>
          </div>
        )}
        {targetsMissing ? (
          <div className="kpi-ar-placeholder">
            <p className="kpi-ar-message kpi-ar-note">
              No active <strong>TOTAL</strong> KPI target version found on the backend yet. Upload a TOTAL KPI target file to continue.
            </p>
          </div>
        ) : (
          <div className="kpi-ar-main">
            <section className="kpi-ar-section kpi-ar-section--summary">
              <h2 className="kpi-ar-section-title">KPI Summary — {monthKeyToLabel(effectiveMonthKey)}</h2>
              <div className="kpi-ar-table-wrap">
                <table className="kpi-ar-table">
                  <thead>
                    <tr>
                      <th>KPI</th><th>Target</th><th>Achieved</th><th>% Achieved</th><th>Weight (%)</th><th>Weight Scored (%)</th><th>% Weight Scored</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nonCsSummaryRows.map((r, idx) => (
                      <tr key={`${r.kpi}-${idx}`} style={getAchievedRowStyle(r.pct)}>
                        <td>{r.kpi}</td>
                        <td className="kpi-ar-num">{typeof r.target === 'number' ? formatTzs(r.target) : r.target}</td>
                        <td className="kpi-ar-num">{typeof r.achievedDisplay === 'number' ? formatTzs(r.achievedDisplay) : r.achievedDisplay}</td>
                        <td className="kpi-ar-num">{formatPercentAccounting(r.pct)}</td>
                        <td className="kpi-ar-num">{formatPercentAccounting((r.weight || 0) * 100)}</td>
                        <td className="kpi-ar-num">{formatPercentAccounting((r.weightScored || 0) * 100)}</td>
                        <td className="kpi-ar-num">{formatPercentAccounting(r.pctWeightScored || 0)}</td>
                      </tr>
                    ))}
                    {nonCsSummaryRows.length > 0 && (() => {
                      const tw = nonCsSummaryRows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
                      const tws = nonCsSummaryRows.reduce((s, r) => s + (Number(r.weightScored) || 0), 0);
                      const totalPctWs = tw > 0 ? (tws / tw) * 100 : 0;
                      return (
                        <tr className="kpi-ar-table-total">
                          <td>Total</td>
                          <td className="kpi-ar-num" />
                          <td className="kpi-ar-num" />
                          <td className="kpi-ar-num" />
                          <td className="kpi-ar-num">{formatPercentAccounting(tw * 100)}</td>
                          <td className="kpi-ar-num">{formatPercentAccounting(tws * 100)}</td>
                          <td className="kpi-ar-num">{formatPercentAccounting(totalPctWs)}</td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </section>
            {nonCsSummaryRows.map((r, idx) => (
              <section key={`${r.kpi}-section-${idx}`} className="kpi-ar-section">
                <h2 className="kpi-ar-section-title">{r.kpi}</h2>
                <div className="kpi-ar-table-wrap">
                  <table className="kpi-ar-table">
                    <thead>
                      <tr>
                        <th>KPI</th><th>Target</th><th>Achieved</th><th>% Achieved</th><th>Weight (%)</th><th>Weight Scored (%)</th><th>% Weight Scored</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={getAchievedRowStyle(r.pct)}>
                        <td>{r.kpi}</td>
                        <td className="kpi-ar-num">{typeof r.target === 'number' ? formatTzs(r.target) : r.target}</td>
                        <td className="kpi-ar-num">{typeof r.achievedDisplay === 'number' ? formatTzs(r.achievedDisplay) : r.achievedDisplay}</td>
                        <td className="kpi-ar-num">{formatPercentAccounting(r.pct)}</td>
                        <td className="kpi-ar-num">{formatPercentAccounting((r.weight || 0) * 100)}</td>
                        <td className="kpi-ar-num">{formatPercentAccounting((r.weightScored || 0) * 100)}</td>
                        <td className="kpi-ar-num">{formatPercentAccounting(r.pctWeightScored || 0)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {(() => {
                  const bd = product === 'SME' ? r.smeBreakdown : product === 'LBF' ? r.lbfBreakdown : null;
                  if (!bd?.rows?.length) return null;
                  return (
                    <div className="kpi-ar-table-wrap kpi-ar-subtable">
                      <h3 className="kpi-ar-subsection-title">{bd.title}</h3>
                      <table className="kpi-ar-table">
                        <thead>
                          <tr><th>Metric</th><th>Value</th></tr>
                        </thead>
                        <tbody>
                          {bd.rows.map((br, bri) => (
                            <tr key={`${r.sectionKey}-brk-${bri}`}>
                              <td>{br.metric}</td>
                              <td className="kpi-ar-num">{br.value}</td>
                            </tr>
                          ))}
                          {r.pct != null && Number.isFinite(r.pct) ? (
                            <tr className="kpi-ar-table-total">
                              <td><strong>Overall — % Achieved (this KPI)</strong></td>
                              <td className="kpi-ar-num"><strong>{formatPercentAccounting(r.pct)}</strong></td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
                {product === 'LBF' && r.sectionKey === 'portfolio_growth' && r.lbfPortfolioDetail ? (
                  <div className="kpi-ar-table-wrap kpi-ar-subtable">
                    <h3 className="kpi-ar-subsection-title">Portfolio calculation</h3>
                    <table className="kpi-ar-table">
                      <thead>
                        <tr><th>Metric</th><th>Value</th></tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Current month portfolio</td>
                          <td className="kpi-ar-num">{Number.isFinite(r.lbfPortfolioDetail.portfolioCur) ? formatTzs(r.lbfPortfolioDetail.portfolioCur) : '—'}</td>
                        </tr>
                        <tr>
                          <td>Previous month portfolio</td>
                          <td className="kpi-ar-num">{Number.isFinite(r.lbfPortfolioDetail.portfolioPrev) ? formatTzs(r.lbfPortfolioDetail.portfolioPrev) : '—'}</td>
                        </tr>
                        <tr>
                          <td>Monthly growth %</td>
                          <td className="kpi-ar-num">{Number.isFinite(r.lbfPortfolioDetail.monthlyGrowth) ? formatPercentAccounting(r.lbfPortfolioDetail.monthlyGrowth) : '—'}</td>
                        </tr>
                        <tr>
                          <td>Annualized growth % (vs 10% target)</td>
                          <td className="kpi-ar-num">{Number.isFinite(r.lbfPortfolioDetail.annualizedGrowth) ? formatPercentAccounting(r.lbfPortfolioDetail.annualizedGrowth) : '—'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {product === 'LBF' && (r.sectionKey === 'branch_90' || r.sectionKey === 'branch_cluster_100') && sortedBranchesByPct.length ? (
                  <div className="kpi-ar-table-wrap kpi-ar-subtable">
                    <h3 className="kpi-ar-subsection-title">Branches — target vs disbursement (sorted by % achieved)</h3>
                    <table className="kpi-ar-table">
                      <thead>
                        <tr>
                          <th>Branch</th><th>Target</th><th>Disbursement this Month</th><th>% Achieved</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedBranchesByPct.map((b) => (
                          <tr key={`${r.sectionKey}-${b.branch}`} style={getAchievedRowStyle(b.pct)}>
                            <td>{b.branch}</td>
                            <td className="kpi-ar-num">{formatTzs(b.target)}</td>
                            <td className="kpi-ar-num">{formatTzs(b.disbursement)}</td>
                            <td className="kpi-ar-num">{Number.isFinite(b.pct) ? formatPercentAccounting(b.pct) : '—'}</td>
                          </tr>
                        ))}
                        {branchDisbursementTotals && branchDisbursementTotals.totalTarget > 0 ? (
                          <tr className="kpi-ar-table-total">
                            <td><strong>Total / Average</strong></td>
                            <td className="kpi-ar-num"><strong>{formatTzs(branchDisbursementTotals.totalTarget)}</strong></td>
                            <td className="kpi-ar-num"><strong>{formatTzs(branchDisbursementTotals.totalDisbursement)}</strong></td>
                            <td className="kpi-ar-num">
                              <strong>{Number.isFinite(branchDisbursementTotals.pct) ? formatPercentAccounting(branchDisbursementTotals.pct) : '—'}</strong>
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {product === 'LBF' && r.sectionKey === 'data_consent' && lbfCrmDailyRows.length ? (
                  <div className="kpi-ar-table-wrap kpi-ar-subtable">
                    <h3 className="kpi-ar-subsection-title">Data consent — all LBF CRM reports in month</h3>
                    <table className="kpi-ar-table">
                      <thead>
                        <tr>
                          <th>Date</th><th>Total Leads</th><th>Rejected Leads</th><th>Not Provided Leads</th><th>Consented Leads</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lbfCrmDailyRows.map((row) => {
                          const tl = row.totalLeads || 0;
                          const share = (n) => (tl > 0
                            ? `${formatTzs(n)} (${formatPercentAccounting((n / tl) * 100)})`
                            : `${formatTzs(n)} (${formatPercentAccounting(0)})`);
                          return (
                            <tr key={row.date}>
                              <td>{row.date}</td>
                              <td className="kpi-ar-num">{formatTzs(tl)}</td>
                              <td className="kpi-ar-num">{share(row.rejected)}</td>
                              <td className="kpi-ar-num">{share(row.notProvided)}</td>
                              <td className="kpi-ar-num">{`${formatTzs(row.consented)} (${formatPercentAccounting(tl > 0 ? (row.consented / tl) * 100 : 0)})`}</td>
                            </tr>
                          );
                        })}
                        {crmConsentTotals ? (
                          <tr className="kpi-ar-table-total">
                            <td><strong>Total / Average</strong></td>
                            <td className="kpi-ar-num"><strong>{formatTzs(crmConsentTotals.totalLeads)}</strong></td>
                            <td className="kpi-ar-num"><strong>{`${formatTzs(crmConsentTotals.rejected)} (${formatPercentAccounting(crmConsentTotals.pctRejected)})`}</strong></td>
                            <td className="kpi-ar-num"><strong>{`${formatTzs(crmConsentTotals.notProvided)} (${formatPercentAccounting(crmConsentTotals.pctNotProvided)})`}</strong></td>
                            <td className="kpi-ar-num"><strong>{`${formatTzs(crmConsentTotals.consented)} (${formatPercentAccounting(crmConsentTotals.pctConsented)})`}</strong></td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {product === 'LBF' && r.sectionKey === 'crm_usage' && lbfCrmDailyRows.length ? (
                  <div className="kpi-ar-table-wrap kpi-ar-subtable">
                    <h3 className="kpi-ar-subsection-title">CRM usage — workforce per report</h3>
                    <table className="kpi-ar-table">
                      <thead>
                        <tr>
                          <th>Date</th><th>Total workforce (TL + agents)</th><th>Logged in workforce</th><th>% Logged in</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lbfCrmDailyRows.map((row) => {
                          const tw = row.totalWorkforce || 0;
                          const li = row.loggedIn || 0;
                          return (
                            <tr key={`${row.date}-usage`}>
                              <td>{row.date}</td>
                              <td className="kpi-ar-num">{formatTzs(tw)}</td>
                              <td className="kpi-ar-num">{formatTzs(li)}</td>
                              <td className="kpi-ar-num">{formatPercentAccounting(tw > 0 ? (li / tw) * 100 : 0)}</td>
                            </tr>
                          );
                        })}
                        {crmUsageTotals ? (
                          <tr className="kpi-ar-table-total">
                            <td><strong>Total / Average</strong></td>
                            <td className="kpi-ar-num"><strong>{formatTzs(crmUsageTotals.totalWorkforce)}</strong></td>
                            <td className="kpi-ar-num"><strong>{formatTzs(crmUsageTotals.loggedIn)}</strong></td>
                            <td className="kpi-ar-num"><strong>{formatPercentAccounting(crmUsageTotals.pctLoggedIn)}</strong></td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {product === 'SME' && r.sectionKey === 'sme_consent_65' && lbfCrmDailyRows.length ? (
                  <div className="kpi-ar-table-wrap kpi-ar-subtable">
                    <h3 className="kpi-ar-subsection-title">Data consent — all SME CRM reports in month</h3>
                    <table className="kpi-ar-table">
                      <thead>
                        <tr>
                          <th>Date</th><th>Total Leads</th><th>Rejected Leads</th><th>Not Provided Leads</th><th>Consented Leads</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lbfCrmDailyRows.map((row) => {
                          const tl = row.totalLeads || 0;
                          const share = (n) => (tl > 0
                            ? `${formatTzs(n)} (${formatPercentAccounting((n / tl) * 100)})`
                            : `${formatTzs(n)} (${formatPercentAccounting(0)})`);
                          return (
                            <tr key={row.date}>
                              <td>{row.date}</td>
                              <td className="kpi-ar-num">{formatTzs(tl)}</td>
                              <td className="kpi-ar-num">{share(row.rejected)}</td>
                              <td className="kpi-ar-num">{share(row.notProvided)}</td>
                              <td className="kpi-ar-num">{`${formatTzs(row.consented)} (${formatPercentAccounting(tl > 0 ? (row.consented / tl) * 100 : 0)})`}</td>
                            </tr>
                          );
                        })}
                        {crmConsentTotals ? (
                          <tr className="kpi-ar-table-total">
                            <td><strong>Total / Average</strong></td>
                            <td className="kpi-ar-num"><strong>{formatTzs(crmConsentTotals.totalLeads)}</strong></td>
                            <td className="kpi-ar-num"><strong>{`${formatTzs(crmConsentTotals.rejected)} (${formatPercentAccounting(crmConsentTotals.pctRejected)})`}</strong></td>
                            <td className="kpi-ar-num"><strong>{`${formatTzs(crmConsentTotals.notProvided)} (${formatPercentAccounting(crmConsentTotals.pctNotProvided)})`}</strong></td>
                            <td className="kpi-ar-num"><strong>{`${formatTzs(crmConsentTotals.consented)} (${formatPercentAccounting(crmConsentTotals.pctConsented)})`}</strong></td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {product === 'SME' && r.sectionKey === 'sme_crm_95' && lbfCrmDailyRows.length ? (
                  <div className="kpi-ar-table-wrap kpi-ar-subtable">
                    <h3 className="kpi-ar-subsection-title">CRM usage — workforce per report</h3>
                    <table className="kpi-ar-table">
                      <thead>
                        <tr>
                          <th>Date</th><th>Total workforce (TL + agents)</th><th>Logged in workforce</th><th>% Logged in</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lbfCrmDailyRows.map((row) => {
                          const tw = row.totalWorkforce || 0;
                          const li = row.loggedIn || 0;
                          return (
                            <tr key={`${row.date}-sme-usage`}>
                              <td>{row.date}</td>
                              <td className="kpi-ar-num">{formatTzs(tw)}</td>
                              <td className="kpi-ar-num">{formatTzs(li)}</td>
                              <td className="kpi-ar-num">{formatPercentAccounting(tw > 0 ? (li / tw) * 100 : 0)}</td>
                            </tr>
                          );
                        })}
                        {crmUsageTotals ? (
                          <tr className="kpi-ar-table-total">
                            <td><strong>Total / Average</strong></td>
                            <td className="kpi-ar-num"><strong>{formatTzs(crmUsageTotals.totalWorkforce)}</strong></td>
                            <td className="kpi-ar-num"><strong>{formatTzs(crmUsageTotals.loggedIn)}</strong></td>
                            <td className="kpi-ar-num"><strong>{formatPercentAccounting(crmUsageTotals.pctLoggedIn)}</strong></td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        )}
        {kpiUploadError ? <p className="kpi-ar-message kpi-ar-error">{kpiUploadError}</p> : null}
        {renderKpiEmailModal()}
      </div>
    );
  }

  if (targetsLoading) {
    return (
      <div className="kpi-ar-container">
        <div className="kpi-ar-header-bar">
          <h1 className="kpi-ar-title">KPI ANALYSIS REPORT — CS</h1>
        </div>
        <div className="kpi-ar-loading">
          <LoadingSpinner size="medium" />
          <p>Loading targets…</p>
        </div>
      </div>
    );
  }

  if (targetsError) {
    return (
      <div className="kpi-ar-container">
        <div className="kpi-ar-header-bar">
          <h1 className="kpi-ar-title">KPI ANALYSIS REPORT — CS</h1>
        </div>
        <div className="kpi-ar-placeholder">
          <p className="kpi-ar-message kpi-ar-error">{targetsError || 'Targets not available.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="kpi-ar-container">
      <div className="kpi-ar-header-bar">
        <h1 className="kpi-ar-title">KPI ANALYSIS REPORT — CS{csView !== 'Total' ? ` — ${csView}` : ''}</h1>
        <div className="kpi-ar-header-controls">
          <label className="kpi-ar-month-label">
            Month
            <select
              className="kpi-ar-month-select"
              value={effectiveMonthKey || ''}
              onChange={(e) => setSelectedMonthKey(e.target.value || null)}
            >
              {availableMonths.length === 0 && <option value="">No data</option>}
              {availableMonths.map((key) => (
                <option key={key} value={key}>{monthKeyToLabel(key)}</option>
              ))}
            </select>
          </label>
          {csView === 'Total' && (
            <label className="kpi-ar-month-label">
              Total KPI Version
              <select
                className="kpi-ar-month-select"
                value={totalVersionId || ''}
                onChange={(e) => activateTotalKpiVersion(e.target.value)}
                disabled={!totalVersions?.length}
              >
                {(!totalVersions || totalVersions.length === 0) && <option value="">No versions</option>}
                {(totalVersions || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.fileName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="kpi-ar-btn"
                onClick={removeTotalKpiVersion}
                disabled={!totalVersionId}
                title="Soft-delete this KPI target file version"
              >
                Remove
              </button>
            </label>
          )}
          {csView !== 'Total' && (
            <label className="kpi-ar-month-label">
              Cluster KPI Version
              <select
                className="kpi-ar-month-select"
                value={clusterVersionId || ''}
                onChange={(e) => activateClusterKpiVersion(e.target.value)}
                disabled={!clusterVersions?.length}
              >
                {(!clusterVersions || clusterVersions.length === 0) && <option value="">No versions</option>}
                {(clusterVersions || []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.fileName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="kpi-ar-btn"
                onClick={removeClusterKpiVersion}
                disabled={!clusterVersionId}
                title="Soft-delete this KPI target file version"
              >
                Remove
              </button>
            </label>
          )}
          <button
            type="button"
            className="kpi-ar-btn kpi-ar-btn-email"
            onClick={() => setShowEmailModal(true)}
            title="Send KPI report by email"
          >
            <span className="kpi-ar-btn-icon">✉</span> Send Email
          </button>
          <button
            type="button"
            className="kpi-ar-btn kpi-ar-btn-view"
            disabled={csView !== 'Total' ? !clusterVersionId : !totalVersionId}
            onClick={() => {
              const id = csView !== 'Total' ? clusterVersionId : totalVersionId;
              if (!id) return;
              (async () => {
                const blob = await kpiTargetsAPI.downloadBlob(id);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = csView !== 'Total' ? (clusterActiveFileName || 'kpi-target.xlsx') : (totalActiveFileName || 'kpi-target.xlsx');
                document.body.appendChild(a);
                a.click();
                a.remove();
                // Best-effort cleanup
                setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
              })().catch(() => {});
            }}
            title={csView !== 'Total'
              ? (clusterActiveFileName ? `Open cluster KPI target file (${clusterActiveFileName})` : 'Open cluster KPI target file')
              : (totalActiveFileName ? `Open total KPI target file (${totalActiveFileName})` : 'Open total KPI target file')}
          >
            <span className="kpi-ar-btn-icon">📋</span> View KPI
          </button>
          <button
            type="button"
            className="kpi-ar-btn kpi-ar-btn-upload"
            onClick={() => kpiTargetFileInputRef.current?.click()}
            disabled={kpiUploadLoading}
            title={csView !== 'Total' ? 'Upload a new cluster KPI target XLSX' : 'Upload a new total KPI target XLSX'}
          >
            <span className="kpi-ar-btn-icon">⤒</span> {csView !== 'Total' ? 'Upload Cluster KPI' : 'Upload KPI'}
          </button>
          <input
            ref={kpiTargetFileInputRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUploadKpiTargetFile(file);
              // allow re-upload of the same file name
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="kpi-ar-btn kpi-ar-btn-download"
            onClick={() => handleDownloadXlsx()}
            disabled={csView !== 'Total'
              ? (clusterTargetsMissing || !clusterVersionId)
              : (targetsMissing || !totalVersionId)}
            title="Download 7-sheet Excel (6 KPIs + Summary)"
          >
            <span className="kpi-ar-btn-icon">📥</span> Download xlsx
          </button>
        </div>
      </div>
      {kpiUploadError && <div className="kpi-ar-upload-error">{kpiUploadError}</div>}
      {targetsMissing && (
        <div className="kpi-ar-placeholder">
          <p className="kpi-ar-message kpi-ar-note">
            No active <strong>TOTAL</strong> KPI target version found on the backend yet. Upload a TOTAL KPI target file to continue.
          </p>
        </div>
      )}
      {csView !== 'Total' && clusterTargetsMissing && (
        <div className="kpi-ar-placeholder">
          <p className="kpi-ar-message kpi-ar-note">
            No active <strong>CLUSTER</strong> KPI target version found on the backend yet. Upload a CLUSTER KPI target file to view cluster analysis.
          </p>
        </div>
      )}

      {!lockProduct && (
        <div className="kpi-ar-product-toggles">
          <button
            type="button"
            className="kpi-ar-product-btn kpi-ar-product-btn--active"
            onClick={() => setProduct('CS')}
          >CS</button>
          <button type="button" className="kpi-ar-product-btn" onClick={() => setProduct('LBF')}>LBF</button>
          <button type="button" className="kpi-ar-product-btn" onClick={() => setProduct('SME')}>SME</button>
        </div>
      )}

      <div className={`kpi-ar-main ${product === 'CS' ? 'kpi-ar-main--with-sidebar' : ''}`}>
        {product === 'CS' && (
          <aside className="kpi-ar-cs-sidebar">
            <span className="kpi-ar-cs-sidebar-label">View</span>
            {['Total', 'Cluster 1', 'Cluster 2', 'Cluster 3', 'Zanzibar'].map((view) => (
              <button
                key={view}
                type="button"
                className={`kpi-ar-cs-sidebar-btn ${csView === view ? 'kpi-ar-cs-sidebar-btn--active' : ''}`}
                onClick={() => setCsView(view)}
              >
                {view}
              </button>
            ))}
          </aside>
        )}
        <div className="kpi-ar-content">
          {/* 1. KPI Summary (matches Excel: same columns and row colors as Total KPI) */}
          <section className="kpi-ar-section kpi-ar-section--summary">
            <h2 className="kpi-ar-section-title">KPI Summary — {monthKeyToLabel(effectiveMonthKey)}{csView !== 'Total' ? ` (${csView})` : ''}</h2>
            <div className="kpi-ar-table-wrap">
              <table className="kpi-ar-table">
                <thead>
                  <tr>
                    <th>KPI</th>
                    <th>Target</th>
                    <th>Achieved</th>
                    <th>% Achieved</th>
                    <th>Weight (%)</th>
                    <th>Weight Scored (%)</th>
                    <th>% Weight Scored</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardSummaryRows.map((r, i) => (
                    <tr key={i} style={{ backgroundColor: getColorForPct(r.pctWeightScored ?? 0) }}>
                      <td>{r.kpi}</td>
                      <td className="kpi-ar-num">{typeof r.target === 'number' ? formatTzs(r.target) : r.target}</td>
                      <td className="kpi-ar-num">{typeof r.achievedDisplay === 'number' ? formatTzs(r.achievedDisplay) : r.achievedDisplay}</td>
                      <td className="kpi-ar-num">{formatPercentAccounting(r.pct)}</td>
                      <td className="kpi-ar-num">{formatPercentAccounting(Number(r.weight) * 100)}</td>
                      <td className="kpi-ar-num">{r.weightScored != null ? formatPercentAccounting(Number(r.weightScored) * 100) : '—'}</td>
                      <td className="kpi-ar-num">{r.pctWeightScored != null ? formatPercentAccounting(r.pctWeightScored) : '—'}</td>
                    </tr>
                  ))}
                  {dashboardSummaryRows.length > 0 && (() => {
                    const tw = dashboardSummaryRows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
                    const tws = dashboardSummaryRows.reduce((s, r) => s + (Number(r.weightScored) || 0), 0);
                    const totalPctWs = tw > 0 ? (tws / tw) * 100 : 0;
                    return (
                      <tr className="kpi-ar-table-total">
                        <td>Total</td>
                        <td className="kpi-ar-num" />
                        <td className="kpi-ar-num" />
                        <td className="kpi-ar-num" />
                        <td className="kpi-ar-num">{formatPercentAccounting(tw * 100)}</td>
                        <td className="kpi-ar-num">{formatPercentAccounting(tws * 100)}</td>
                        <td className="kpi-ar-num">{formatPercentAccounting(totalPctWs)}</td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </section>

          {/* 2. Sales Target Achievement */}
          <section className="kpi-ar-section">
            <h2 className="kpi-ar-section-title">{csView !== 'Total' ? `Sales Target Achievement — ${csView}` : 'Sales Target Achievement'}</h2>
            <div className="kpi-ar-table-wrap">
              <table className="kpi-ar-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{csView !== 'Total' ? `Sales Target (${csView})` : 'Sales Target (Mainland + Zanzibar + Call Center)'}</td>
                    <td className="kpi-ar-num">{typeof dashboardSummaryRows[0]?.target === 'number' ? formatTzs(dashboardSummaryRows[0].target) : (dashboardSummaryRows[0]?.target ?? '—')}</td>
                  </tr>
                  <tr>
                    <td>{csView !== 'Total' ? `Sales Achieved (${csView} — Management report Disbursement this month)` : 'Sales Achieved (CS MTD)'}</td>
                    <td className="kpi-ar-num">{typeof dashboardSummaryRows[0]?.achievedDisplay === 'number' ? formatTzs(dashboardSummaryRows[0].achievedDisplay) : (dashboardSummaryRows[0]?.achievedDisplay ?? '—')}</td>
                  </tr>
                  <tr>
                    <td>% Achieved</td>
                    <td className="kpi-ar-num">{formatPercentAccounting(dashboardSummaryRows[0]?.pct)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* 3. Branch Sales Achievement (branches only; in cluster view = 90% at 100% target) */}
          <section className="kpi-ar-section kpi-ar-section-branch-sales">
            <h2 className="kpi-ar-section-title">{csView !== 'Total' ? `Branch Sales Achievement — ${csView} (90% at 100% target)` : 'Branch Sales Achievement (85% at 100% target)'}</h2>
            <div className="kpi-ar-table-wrap">
              <table className="kpi-ar-table">
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>Target</th>
                    <th>Disbursement this Month</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(filteredBranchSummaryData?.branches ?? [])]
                    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
                    .map((b, i) => (
                      <tr key={i}>
                        <td>{b.branch}</td>
                        <td className="kpi-ar-num">{formatTzs(b.target)}</td>
                        <td className="kpi-ar-num">{formatTzs(b.disbursement)}</td>
                        <td className="kpi-ar-num">{Number.isFinite(b.pct) ? formatPercentAccounting(b.pct) : '—'}</td>
                      </tr>
                    ))}
                  {filteredBranchSummaryData && filteredBranchSummaryData.branches.length > 0 && (
                    <tr className="kpi-ar-table-total">
                      <td>Total</td>
                      <td className="kpi-ar-num">{formatTzs(filteredBranchSummaryData.totalTarget)}</td>
                      <td className="kpi-ar-num">{formatTzs(filteredBranchSummaryData.totalDisbursement)}</td>
                      <td className="kpi-ar-num">{filteredBranchSummaryData.totalTarget > 0 ? formatPercentAccounting((filteredBranchSummaryData.totalDisbursement / filteredBranchSummaryData.totalTarget) * 100) : '—'}</td>
                    </tr>
                  )}
                  {(!filteredBranchSummaryData || filteredBranchSummaryData.branches.length === 0) && (
                    <tr><td colSpan={4} className="kpi-ar-num">No branch data for selected month</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredBranchSummaryData && (
              <p className="kpi-ar-section-note">
              Branches at ≥100%: {formatTzs(filteredBranchSummaryData.achieved100Count)} — Below 100%: {formatTzs(filteredBranchSummaryData.notAchieved100Count)} — % at 100%: {filteredBranchSummaryData.achieved100Count + filteredBranchSummaryData.notAchieved100Count > 0 ? formatPercentAccounting((filteredBranchSummaryData.achieved100Count / (filteredBranchSummaryData.achieved100Count + filteredBranchSummaryData.notAchieved100Count)) * 100) : formatPercentAccounting(0)}
              </p>
            )}
          </section>

          {/* Cluster KPI detail sections (each KPI in its own file) — shown when a cluster is selected */}
          {csView !== 'Total' && (
            <ClusterKpiView
              cluster={csView}
              monthLabel={monthKeyToLabel(effectiveMonthKey)}
              effectiveMonthKey={effectiveMonthKey}
              clusterTarget={effectiveTargetsForKpi?.salesTarget ?? 0}
              clusterTargetFileName={clusterActiveFileName}
              countrySheetDisbursement={countrySheetClusterDisbursement}
              countrySheetClusterPortfolio={countrySheetClusterPortfolio}
              countrySheetClusterPortfolioPrevious={countrySheetClusterPortfolioPrevious}
              countrySheetClusterPar30={countrySheetClusterPar30}
              mtdGroupedData={mtdParsedData?.groupedData ?? null}
              branchesByCluster={branchesByCluster}
              filteredBranchSummaryData={filteredBranchSummaryData}
              latestManagementReport={latestManagementReport}
              previousMonthManagementReport={previousMonthManagementReport}
              clusterTargets={clusterTargets}
              loading={!latestManagementReport && !!effectiveMonthKey}
              regionsNewBizTable={clusterKpiTables?.regionsNewBiz ?? []}
              recruitmentTable={clusterKpiTables?.recruitment ?? []}
              crmClusterAggregated={crmClusterAggregated}
              onLocationTable={onLocationTable}
              consentTable={consentTable}
            />
          )}

          {/* 4. Mainland 65% new business — Total view only */}
          {csView === 'Total' && (
            <section className="kpi-ar-section">
              <h2 className="kpi-ar-section-title">Attaining 65% new business (Mainland)</h2>
              <div className="kpi-ar-table-wrap">
                <table className="kpi-ar-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>New Business Target (Mainland)</td><td className="kpi-ar-num">{formatTzs((targets.mainland || {})[effectiveMonthKey]?.newBusiness)}</td></tr>
                    <tr><td>New Business Actual (CS)</td><td className="kpi-ar-num">{formatTzs(latestManagementReport?.cs?.['New Business'] ?? latestManagementReport?.cs?.['New business'])}</td></tr>
                    <tr><td>% of target</td><td className="kpi-ar-num">{formatPercentAccounting(dashboardSummaryRows[2]?.pct)}</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 5. Zanzibar 70% new business — Total view only */}
          {csView === 'Total' && (
            <section className="kpi-ar-section">
              <h2 className="kpi-ar-section-title">Attaining 70% Zanzibar new business</h2>
              <div className="kpi-ar-table-wrap">
                <table className="kpi-ar-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>New Business Target (Zanzibar)</td><td className="kpi-ar-num">{formatTzs((targets.zanzibar || {})[effectiveMonthKey]?.newBusiness)}</td></tr>
                    <tr><td>New Business Actual (Zanzibar)</td><td className="kpi-ar-num">{formatTzs(latestManagementReport?.zanzibar?.['New Business'] ?? latestManagementReport?.zanzibar?.['New business'])}</td></tr>
                    <tr><td>% of target</td><td className="kpi-ar-num">{formatPercentAccounting(dashboardSummaryRows[3]?.pct)}</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 6. Portfolio growth — Total view only */}
          {csView === 'Total' && (
            <section className="kpi-ar-section">
              <h2 className="kpi-ar-section-title">Portfolio growth 10% annually (~1% per month)</h2>
              <div className="kpi-ar-table-wrap">
                <table className="kpi-ar-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>Current month portfolio (CS)</td><td className="kpi-ar-num">{formatTzs(latestManagementReport?.cs?.['Portfolio'] ?? latestManagementReport?.cs?.['Total Portfolio'])}</td></tr>
                    <tr><td>Previous month portfolio</td><td className="kpi-ar-num">{formatTzs(previousMonthManagementReport?.cs?.['Portfolio'] ?? previousMonthManagementReport?.cs?.['Total Portfolio'])}</td></tr>
                    <tr><td>Growth %</td><td className="kpi-ar-num">{dashboardSummaryRows[4]?.achievedDisplay ?? '—'}</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 7. PAR 30 below 5% — Total view only */}
          {csView === 'Total' && (
            <section className="kpi-ar-section">
              <h2 className="kpi-ar-section-title">Maintain PAR 30 below 5% (0.5% monthly improvement)</h2>
              <div className="kpi-ar-table-wrap">
                <table className="kpi-ar-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>Current PAR &gt;30 (%)</td><td className="kpi-ar-num">{(() => { const v = normalizeParToPercentage(latestManagementReport?.cs?.['PAR >30'] ?? latestManagementReport?.cs?.['PAR>30']); return Number.isFinite(v) ? formatPercentAccounting(v) : '—'; })()}</td></tr>
                    <tr><td>Previous month PAR &gt;30 (%)</td><td className="kpi-ar-num">{(() => { const v = normalizeParToPercentage(previousMonthManagementReport?.cs?.['PAR >30'] ?? previousMonthManagementReport?.cs?.['PAR>30']); return Number.isFinite(v) ? formatPercentAccounting(v) : '—'; })()}</td></tr>
                    <tr><td>Improvement (pp)</td><td className="kpi-ar-num">{dashboardSummaryRows[5]?.achievedDisplay ?? '—'}</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 8. Growth of active client base 20% annually — Total view only */}
          {csView === 'Total' && (
            <section className="kpi-ar-section">
              <h2 className="kpi-ar-section-title">Growth of active client base 20% annually</h2>
              <div className="kpi-ar-table-wrap">
                <table className="kpi-ar-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>Active clients (current)</td><td className="kpi-ar-num">{formatTzs(latestManagementReport?.cs?.['Active clients'] ?? latestManagementReport?.cs?.['Active Clients'])}</td></tr>
                    <tr><td>Active clients (previous month)</td><td className="kpi-ar-num">{formatTzs(previousMonthManagementReport?.cs?.['Active clients'] ?? previousMonthManagementReport?.cs?.['Active Clients'])}</td></tr>
                    <tr><td>Annualized growth (%)</td><td className="kpi-ar-num">{dashboardSummaryRows[6]?.achievedDisplay ?? '—'}</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 9. Regions and Clusters hit target — Total view only */}
          {csView === 'Total' && (
            <section className="kpi-ar-section">
              <h2 className="kpi-ar-section-title">Ensure all Regions and Clusters hit their target</h2>
              <p className="kpi-ar-section-note">Supervisions from CS MTD; Clusters from management report (Cluster 1, Cluster 2, Cluster 3, ZANZIBAR).</p>
              <div className="kpi-ar-table-wrap">
                <table className="kpi-ar-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>Regions &amp; Clusters % hit target</td><td className="kpi-ar-num">{dashboardSummaryRows[7]?.achievedDisplay ?? '—'}</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 10. 90% proper usage of CRM — Total view only */}
          {csView === 'Total' && (
            <section className="kpi-ar-section">
              <h2 className="kpi-ar-section-title">90% proper usage of CRM by all Sales force teams</h2>
              <div className="kpi-ar-table-wrap">
                <table className="kpi-ar-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>% Logged in (Team Leaders + Loan Officers)</td><td className="kpi-ar-num">{dashboardSummaryRows[8]?.achievedDisplay ?? '—'}</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 11. 65% achieved of Data consent — Total view only */}
          {csView === 'Total' && (
            <section className="kpi-ar-section">
              <h2 className="kpi-ar-section-title">65% achieved of Data consent from each Cluster</h2>
              <div className="kpi-ar-table-wrap">
                <table className="kpi-ar-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>Average consent % (from CRM leads)</td><td className="kpi-ar-num">{dashboardSummaryRows[9]?.achievedDisplay ?? '—'}</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>

      {renderKpiEmailModal()}
    </div>
  );
};

export default KpiAnalysisReport;
