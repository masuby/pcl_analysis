import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './KpiAnalysisReport.css';
import { loadCsKpiTargets, formatTzs, CS_KPI_TARGET_FILE_URL } from './utils/csKpiTargets';
import { useManagementData } from '../../../ManagementDashboard/hooks/useManagementData';
import { useMTDData } from '../../../MTDdashboard/hooks/useMTDData';
import { getReportFileUrl } from '../../../../../../services/supabase';
import { getReportsByDepartmentAndType } from '../../../../../../services/reports';
import { exportMultipleSheetsWithStyles, buildWorkbookBuffer } from '../../utils/excelExportStyled';
import { sendScoreCardEmail } from '../../utils/emailScoreCard';
import { buildKpiReportEmailHTML } from '../../utils/emailTemplateKpi';
import { parseManagementReportCsBranches } from './utils/parseManagementReportCsBranches';
import { getCrmEmailMetrics } from './utils/crmMetricsFromReport';
import { extractMetrics } from '../../../CRMdashboard/utils/crmUtils';
import { useCRMData } from '../../../CRMdashboard/hooks/useCRMData';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';

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

/** Normalize PAR >30 value to percentage. Some reports (e.g. Dec) store as decimal (0.0582 = 5.82%); others as percentage (5.82). If value is less than 1, treat as decimal and convert. */
function normalizeParToPercentage(val) {
  if (val == null || val === '') return NaN;
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  if (!Number.isFinite(n)) return NaN;
  if (n < 0) return 0;
  if (n > 0 && n < 1) return n * 100; // stored as decimal (e.g. 0.0582 → 5.82)
  return n; // already in percentage (e.g. 5.82)
}

const KpiAnalysisReport = () => {
  const [product, setProduct] = useState('CS');
  const [targets, setTargets] = useState(null);
  const [targetsError, setTargetsError] = useState(null);
  const [targetsLoading, setTargetsLoading] = useState(true);
  /** Selected month YYYY-MM; null = use latest available */
  const [selectedMonthKey, setSelectedMonthKey] = useState(null);
  /** Branch-level data from management report Excel (for dashboard KPI Summary & Branch section) */
  const [branchSummaryData, setBranchSummaryData] = useState(null);

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

  useEffect(() => {
    if (recipients.length > 0) {
      try {
        localStorage.setItem(KPI_REPORT_RECIPIENTS_KEY, JSON.stringify(recipients));
      } catch (_) {}
    }
  }, [recipients]);

  const { parsedReports: managementReports } = useManagementData();
  const { reports: mtdReports } = useMTDData('CS');
  const latestMTDInMonth = useMemo(() => {
    if (!selectedMonthKey || !mtdReports?.length) return null;
    const inMonth = mtdReports.filter(r => toMonthKey(r.date) === selectedMonthKey);
    if (inMonth.length === 0) return null;
    inMonth.sort((a, b) => new Date(b.date) - new Date(a.date));
    return inMonth[0];
  }, [selectedMonthKey, mtdReports]);
  const { parsedData: mtdParsedData } = useMTDData('CS', latestMTDInMonth?.date ?? undefined);

  /** Months available in DB (from management reports), newest first */
  const availableMonths = useMemo(() => {
    if (!managementReports?.length) return [];
    const set = new Set(managementReports.map(r => toMonthKey(r.date || r.createdAt)).filter(Boolean));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [managementReports]);

  const effectiveMonthKey = selectedMonthKey || availableMonths[0] || null;
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
  const crmDateForMonth = useMemo(() => {
    if (!crmReports?.length || !effectiveMonthKey) return null;
    const inMonth = crmReports.filter(r => toMonthKey(r.date) === effectiveMonthKey);
    return inMonth[0]?.date ?? null;
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

  /** Summary rows for dashboard KPI Summary section (same logic as Excel, using branchSummaryData) */
  const dashboardSummaryRows = useMemo(() => {
    if (!targets || !effectiveMonthKey) return [];
    const standards = targets.performanceStandards || [];
    const mainT = (targets.mainland || {})[effectiveMonthKey];
    const zanT = (targets.zanzibar || {})[effectiveMonthKey];
    const ccT = (targets.callCenter || {})[effectiveMonthKey];
    const salesTarget = (mainT?.total ?? 0) + (zanT?.total ?? 0) + (ccT ?? 0);
    const salesAchievedNum = mtdParsedData?.grandTotalRow?.VALUE ?? mtdParsedData?.grandTotalRow?.value;
    const salesAchieved = typeof salesAchievedNum === 'number' ? salesAchievedNum : (salesAchievedNum != null ? parseFloat(salesAchievedNum) : NaN);
    const pctSales = Number.isFinite(salesAchieved) && salesTarget > 0 ? (salesAchieved / salesTarget) * 100 : null;
    const w1 = standards[0]?.weight ?? 0.1;
    const ws1 = pctSales != null ? (Math.min(100, pctSales) / 100) * w1 : 0;

    const totalBranches = (branchSummaryData?.achieved100Count ?? 0) + (branchSummaryData?.notAchieved100Count ?? 0);
    const pctBranches100 = totalBranches > 0 ? ((branchSummaryData?.achieved100Count ?? 0) / totalBranches) * 100 : null;
    const w2 = standards[1]?.weight ?? 0.1;
    const ws2 = pctBranches100 != null ? (Math.min(100, (pctBranches100 / 85) * 100) / 100) * w2 : 0;

    const newBizMainlandTarget = mainT?.newBusiness ?? null;
    const newBizMainlandActual = latestManagementReport?.cs?.['New Business'] ?? latestManagementReport?.cs?.['New business'] ?? null;
    const newBizMainlandNum = typeof newBizMainlandActual === 'number' ? newBizMainlandActual : (newBizMainlandActual != null ? parseFloat(newBizMainlandActual) : NaN);
    const pctMainland65 = newBizMainlandTarget > 0 && Number.isFinite(newBizMainlandNum) ? (newBizMainlandNum / newBizMainlandTarget) * 100 : null;
    const w3 = standards[2]?.weight ?? 0.15;
    const ws3 = pctMainland65 != null ? (Math.min(100, (pctMainland65 / 65) * 100) / 100) * w3 : 0;

    const newBizZanTarget = zanT?.newBusiness ?? null;
    const newBizZanActual = latestManagementReport?.zanzibar?.['New Business'] ?? latestManagementReport?.zanzibar?.['New business'] ?? null;
    const newBizZanNum = typeof newBizZanActual === 'number' ? newBizZanActual : (newBizZanActual != null ? parseFloat(newBizZanActual) : NaN);
    const pctZan70 = newBizZanTarget > 0 && Number.isFinite(newBizZanNum) ? (newBizZanNum / newBizZanTarget) * 100 : null;
    const w4 = standards[3]?.weight ?? 0.05;
    const ws4 = pctZan70 != null ? (Math.min(100, (pctZan70 / 70) * 100) / 100) * w4 : 0;

    const portfolioCurrent = latestManagementReport?.cs?.['Portfolio'] ?? latestManagementReport?.cs?.['Total Portfolio'] ?? latestManagementReport?.cs?.['Principle Balance'] ?? null;
    const portfolioNum = typeof portfolioCurrent === 'number' ? portfolioCurrent : (portfolioCurrent != null ? parseFloat(portfolioCurrent) : NaN);
    const portfolioPrev = previousMonthManagementReport?.cs?.['Portfolio'] ?? previousMonthManagementReport?.cs?.['Total Portfolio'] ?? previousMonthManagementReport?.cs?.['Principle Balance'] ?? null;
    const portfolioPrevNum = typeof portfolioPrev === 'number' ? portfolioPrev : (portfolioPrev != null ? parseFloat(portfolioPrev) : NaN);
    const growthPct = Number.isFinite(portfolioPrevNum) && portfolioPrevNum > 0 && Number.isFinite(portfolioNum) ? ((portfolioNum - portfolioPrevNum) / portfolioPrevNum) * 100 : null;
    const w5 = standards[4]?.weight ?? 0.05;
    const ws5 = growthPct != null ? (Math.min(100, (growthPct / (10 / 12)) * 100) / 100) * w5 : 0;

    const par30Current = latestManagementReport?.cs?.['PAR >30'] ?? latestManagementReport?.cs?.['PAR>30'] ?? null;
    const par30Num = normalizeParToPercentage(par30Current);
    const par30Prev = previousMonthManagementReport?.cs?.['PAR >30'] ?? previousMonthManagementReport?.cs?.['PAR>30'] ?? null;
    const par30PrevNum = normalizeParToPercentage(par30Prev);
    const par30Improvement = Number.isFinite(par30PrevNum) && Number.isFinite(par30Num) ? par30PrevNum - par30Num : null;
    const w6 = standards[5]?.weight ?? 0.05;
    const ws6 = par30Improvement != null ? Math.max(0, Math.min(1, par30Improvement / 0.5)) * w6 : 0;

    // KPI 7: Active client base growth 20% annually
    const activeNowVal = latestManagementReport?.cs?.['Active clients'] ?? latestManagementReport?.cs?.['Active Clients'];
    const activePrevVal = previousMonthManagementReport?.cs?.['Active clients'] ?? previousMonthManagementReport?.cs?.['Active Clients'];
    const toNumVal = (v) => (typeof v === 'number' && !isNaN(v)) ? v : (v != null ? parseFloat(v) : NaN);
    const activeNumCur = toNumVal(activeNowVal);
    const activeNumPrev = toNumVal(activePrevVal);
    const monthlyGrowth = Number.isFinite(activeNumPrev) && activeNumPrev > 0 && Number.isFinite(activeNumCur) ? ((activeNumCur - activeNumPrev) / activeNumPrev) * 100 : null;
    const annualizedGrowth = monthlyGrowth != null ? monthlyGrowth * 12 : null;
    const w7 = standards[6]?.weight ?? 0.02;
    const ws7 = annualizedGrowth != null ? (Math.min(100, (annualizedGrowth / 20) * 100) / 100) * w7 : 0;

    // KPI 8: Regions and Clusters hit target
    const supervisionsList = mtdParsedData?.groupedData ? Object.entries(mtdParsedData.groupedData) : [];
    const getTarget = (d) => Number(d?.['MONTH TARGET'] ?? d?.['Month Target'] ?? d?.Target ?? 0) || 0;
    const getVal = (d) => Number(d?.VALUE ?? d?.Value ?? 0) || 0;
    const regionsHit = supervisionsList.filter(([, g]) => { const d = g.supervisionData || {}; const t = getTarget(d); const v = getVal(d); return t > 0 && v >= t; }).length;
    const clusterBranches = branchSummaryData?.clusters ?? [];
    const clustersHit = clusterBranches.filter(b => (b.pct ?? 0) >= 100).length;
    const totalR = supervisionsList.length;
    const totalC = clusterBranches.length;
    const regionsClustersPct = (totalR + totalC) > 0 ? ((regionsHit + clustersHit) / (totalR + totalC)) * 100 : null;
    const w8 = standards[7]?.weight ?? 0.05;
    const ws8 = regionsClustersPct != null ? (Math.min(100, regionsClustersPct) / 100) * w8 : 0;

    // KPI 9 & 10: 90% CRM usage and 65% Data consent — use CRM data for selected month when available
    const crmForMonth = crmParsedDataForMonth && toMonthKey(crmParsedDataForMonth.reportDate) === effectiveMonthKey ? crmParsedDataForMonth : null;
    const crmMetrics = crmForMonth?.emailData ? extractMetrics(crmForMonth.emailData) : {};
    const toN = (v) => (typeof v === 'number' && !isNaN(v)) ? v : (v != null ? parseFloat(String(v).replace(/%|,/g, '')) : 0);
    const tlTotal = toN(crmMetrics.count_team_leaders ?? crmMetrics['count team leaders']);
    const tlLogged = toN(crmMetrics.logged_in_team_leaders ?? crmMetrics['logged in team leaders']);
    const loTotal = toN(crmMetrics.total_agent ?? crmMetrics['total agent']);
    const loLogged = toN(crmMetrics.total_agent_logged_in ?? crmMetrics['total agent logged in']);
    const totalWorkforce = tlTotal + loTotal;
    const totalLogged = tlLogged + loLogged;
    const overallUsagePct = totalWorkforce > 0 ? (totalLogged / totalWorkforce) * 100 : null;
    const w9 = standards[8]?.weight ?? 0.05;
    const ws9 = overallUsagePct != null ? (Math.min(100, (overallUsagePct / 90) * 100) / 100) * w9 : 0;
    const totalLeads = toN(crmMetrics.lead ?? crmMetrics.count_leads ?? crmMetrics['lead']);
    const consented = toN(crmMetrics.accepted_lead ?? crmMetrics['accepted lead']);
    const avgConsentPct = totalLeads > 0 ? (consented / totalLeads) * 100 : null;
    const w10 = standards[9]?.weight ?? 0.05;
    const ws10 = avgConsentPct != null ? (Math.min(100, (avgConsentPct / 65) * 100) / 100) * w10 : 0;

    return [
      { kpi: standards[0]?.name ?? 'Sales target', target: salesTarget, achievedDisplay: Number.isFinite(salesAchieved) ? salesAchieved : '—', pct: pctSales, weight: w1, weightScored: ws1 },
      { kpi: standards[1]?.name ?? 'Branch sales', target: '85%', achievedDisplay: pctBranches100 != null ? pctBranches100.toFixed(2) + '%' : '—', pct: pctBranches100, weight: w2, weightScored: ws2 },
      { kpi: standards[2]?.name ?? 'Mainland 65%', target: '65%', achievedDisplay: pctMainland65 != null ? pctMainland65.toFixed(2) + '%' : '—', pct: pctMainland65, weight: w3, weightScored: ws3 },
      { kpi: standards[3]?.name ?? 'Zanzibar 70%', target: '70%', achievedDisplay: pctZan70 != null ? pctZan70.toFixed(2) + '%' : '—', pct: pctZan70, weight: w4, weightScored: ws4 },
      { kpi: standards[4]?.name ?? 'Portfolio growth', target: '~1%', achievedDisplay: growthPct != null ? growthPct.toFixed(2) + '%' : '—', pct: growthPct, weight: w5, weightScored: ws5 },
      { kpi: standards[5]?.name ?? 'PAR 30', target: '0.5% improvement', achievedDisplay: par30Improvement != null ? par30Improvement.toFixed(2) + '%' : '—', pct: null, weight: w6, weightScored: ws6 },
      { kpi: standards[6]?.name ?? 'Growth of active client base 20% annually', target: '20% (annualized)', achievedDisplay: annualizedGrowth != null ? annualizedGrowth.toFixed(2) + '%' : '—', pct: annualizedGrowth, weight: w7, weightScored: ws7 },
      { kpi: standards[7]?.name ?? 'Ensure all Regions and Clusters hit their target', target: '100% hit', achievedDisplay: regionsClustersPct != null ? regionsClustersPct.toFixed(2) + '%' : '—', pct: regionsClustersPct, weight: w8, weightScored: ws8 },
      { kpi: standards[8]?.name ?? '90% proper usage of CRM', target: '90%', achievedDisplay: overallUsagePct != null ? overallUsagePct.toFixed(2) + '%' : '—', pct: overallUsagePct, weight: w9, weightScored: ws9 },
      { kpi: standards[9]?.name ?? '65% achieved of Data consent from each Cluster', target: '65%', achievedDisplay: avgConsentPct != null ? avgConsentPct.toFixed(2) + '%' : '—', pct: avgConsentPct, weight: w10, weightScored: ws10 }
    ];
  }, [targets, effectiveMonthKey, latestManagementReport, previousMonthManagementReport, mtdParsedData, branchSummaryData, crmParsedDataForMonth]);

  useEffect(() => {
    if (product !== 'CS') {
      setTargets(null);
      setTargetsLoading(false);
      return;
    }
    setTargetsLoading(true);
    setTargetsError(null);
    loadCsKpiTargets()
      .then(setTargets)
      .catch((err) => {
        setTargetsError(err?.message || 'Failed to load targets');
        setTargets(null);
      })
      .finally(() => setTargetsLoading(false));
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
    const standards = targets.performanceStandards || [];
    const monthLabel = monthKeyToLabel(effectiveMonthKey);

    const summaryRows = [];

    // ----- Sheet 1: Sales Target Achievement -----
    const mainT = (targets.mainland || {})[effectiveMonthKey];
    const zanT = (targets.zanzibar || {})[effectiveMonthKey];
    const ccT = (targets.callCenter || {})[effectiveMonthKey];
    const salesTarget = (mainT?.total ?? 0) + (zanT?.total ?? 0) + (ccT ?? 0);
    const salesAchieved = mtdParsedData?.grandTotalRow?.VALUE ?? mtdParsedData?.grandTotalRow?.value ?? null;
    const salesAchievedNum = typeof salesAchieved === 'number' ? salesAchieved : (salesAchieved != null ? parseFloat(salesAchieved) : NaN);
    const pctSales = Number.isFinite(salesAchievedNum) && salesTarget > 0 ? (salesAchievedNum / salesTarget) * 100 : null;
    const weight1 = standards[0]?.weight ?? 0.1;
    const weightScored1 = pctSales != null ? (Math.min(100, pctSales) / 100) * weight1 : 0;

    const sheet1Tables = [{
      title: `Sales Target Achievement — ${monthLabel}`,
      data: [
        { 'Metric': 'Sales Target (Mainland + Zanzibar + Call Center)', 'Value': salesTarget },
        { 'Metric': 'Sales Achieved (CS MTD)', 'Value': Number.isFinite(salesAchievedNum) ? salesAchievedNum : '—' },
        { 'Metric': '% Achieved', 'Value': pctSales != null ? pctSales.toFixed(2) + '%' : '—' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [45, 22]
    }, {
      title: 'Summary',
      data: [
        { 'KPI': standards[0]?.name ?? 'Achieve 100% sales target', 'Target': salesTarget, 'Achieved': Number.isFinite(salesAchievedNum) ? salesAchievedNum : '—', '% Achieved': pctSales != null ? pctSales.toFixed(2) + '%' : '—', 'Weight (%)': (weight1 * 100).toFixed(2) + '%', 'Weight Scored (%)': (weightScored1 * 100).toFixed(2) + '%' }
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
    if (latestManagementReport) {
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
      '%': b.pct.toFixed(2) + '%'
    }));
    const branchRowFillColors = sortedBranches.map(b => getColorForPct(b.pct ?? 0));
    if (sheet2Data.length > 0) {
      sheet2Data.push({
        __totalRow: true,
        'Branch': 'Total',
        'Target': branchData.totalTarget,
        [disbursementColLabel]: branchData.totalDisbursement,
        '%': branchData.totalTarget > 0 ? ((branchData.totalDisbursement / branchData.totalTarget) * 100).toFixed(2) + '%' : '—'
      });
    }
    const sheet2Tables = [{
      title: `Branch Sales Achievement — ${monthLabel}`,
      data: sheet2Data.length ? sheet2Data : [{ 'Branch': '—', 'Target': '—', [disbursementColLabel]: '—', '%': '—' }],
      headerColors: { 'Branch': '#1e3a5f', 'Target': '#c45a11', [disbursementColLabel]: '#2d6a2d', '%': '#2d6a2d' },
      colWidths: [28, 16, 18, 12],
      totalRowIndices: sheet2Data.length ? [sheet2Data.length - 1] : [],
      rowFillColors: branchRowFillColors
    }, {
      title: 'Summary (85% of branches at 100% target)',
      data: [
        { 'Achieved ≥100%': branchData.achieved100Count, 'Not achieved <100%': branchData.notAchieved100Count, '% Branches at 100%': pctBranches100 != null ? pctBranches100.toFixed(2) + '%' : '—', 'Weight (%)': (weight2 * 100).toFixed(2) + '%', 'Weight Scored (%)': (weightScored2 * 100).toFixed(2) + '%' }
      ],
      headerColors: { 'Achieved ≥100%': '#70AD47', 'Not achieved <100%': '#ED7D31', '% Branches at 100%': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [18, 20, 22, 12, 16]
    }];
    summaryRows.push({
      kpi: standards[1]?.name ?? 'Branch sales',
      target: targetPct85 + '%',
      achieved: pctBranches100,
      achievedDisplay: pctBranches100 != null ? pctBranches100.toFixed(2) + '%' : '—',
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
        { 'Metric': '% of target', 'Value': pctMainland65 != null ? pctMainland65.toFixed(2) + '%' : '—' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [35, 22]
    }, {
      title: 'Summary',
      data: [{ 'KPI': standards[2]?.name ?? '65% new business Mainland', 'Target': target65 + '%', 'Achieved': pctMainland65 != null ? pctMainland65.toFixed(2) + '%' : '—', 'Weight (%)': (weight3 * 100).toFixed(2) + '%', 'Weight Scored (%)': (weightScored3 * 100).toFixed(2) + '%' }],
      headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Achieved': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [50, 12, 16, 10, 14]
    }];
    summaryRows.push({
      kpi: standards[2]?.name ?? 'Mainland 65%',
      target: target65 + '%',
      achieved: pctMainland65,
      achievedDisplay: pctMainland65 != null ? pctMainland65.toFixed(2) + '%' : '—',
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
        { 'Metric': '% of target', 'Value': pctZan70 != null ? pctZan70.toFixed(2) + '%' : '—' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [35, 22]
    }, {
      title: 'Summary',
      data: [{ 'KPI': standards[3]?.name ?? '70% Zanzibar new business', 'Target': target70 + '%', 'Achieved': pctZan70 != null ? pctZan70.toFixed(2) + '%' : '—', 'Weight (%)': (weight4 * 100).toFixed(2) + '%', 'Weight Scored (%)': (weightScored4 * 100).toFixed(2) + '%' }],
      headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Achieved': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [50, 12, 16, 10, 14]
    }];
    summaryRows.push({
      kpi: standards[3]?.name ?? 'Zanzibar 70%',
      target: target70 + '%',
      achieved: pctZan70,
      achievedDisplay: pctZan70 != null ? pctZan70.toFixed(2) + '%' : '—',
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
        { 'Metric': 'Growth %', 'Value': growthPct != null ? growthPct.toFixed(2) + '%' : '—' },
        { 'Metric': 'Target (monthly ~1%)', 'Value': monthlyTargetGrowth.toFixed(2) + '%' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [35, 22]
    }, {
      title: 'Summary',
      data: [{ 'KPI': standards[4]?.name ?? 'Portfolio growth 10%', 'Target': '~1% monthly', 'Achieved': growthPct != null ? growthPct.toFixed(2) + '%' : '—', 'Weight (%)': (weight5 * 100).toFixed(2) + '%', 'Weight Scored (%)': (weightScored5 * 100).toFixed(2) + '%' }],
      headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Achieved': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [45, 14, 16, 10, 14]
    }];
    summaryRows.push({
      kpi: standards[4]?.name ?? 'Portfolio growth',
      target: '~1%',
      achieved: growthPct,
      achievedDisplay: growthPct != null ? growthPct.toFixed(2) + '%' : '—',
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
        { 'Metric': 'Current PAR >30 (%)', 'Value': Number.isFinite(par30Num) ? par30Num : '—' },
        { 'Metric': 'Previous month PAR >30 (%)', 'Value': Number.isFinite(par30PrevNum) ? par30PrevNum : '—' },
        { 'Metric': 'Improvement (pp)', 'Value': par30Improvement != null ? par30Improvement.toFixed(2) : '—' },
        { 'Metric': 'Target improvement (0.5% per month)', 'Value': targetImprovement + '%' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [35, 22]
    }, {
      title: 'Summary',
      data: [{ 'KPI': standards[5]?.name ?? 'PAR 30 below 5%', 'Current': par30Num != null && Number.isFinite(par30Num) ? par30Num.toFixed(2) + '%' : '—', 'Improvement': par30Improvement != null ? par30Improvement.toFixed(2) + '%' : '—', 'Weight (%)': (weight6 * 100).toFixed(2) + '%', 'Weight Scored (%)': (weightScored6 * 100).toFixed(2) + '%' }],
      headerColors: { 'KPI': '#4472C4', 'Current': '#70AD47', 'Improvement': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [40, 12, 14, 10, 14]
    }];
    summaryRows.push({
      kpi: standards[5]?.name ?? 'PAR 30',
      target: '0.5% improvement',
      achieved: par30Improvement,
      achievedDisplay: par30Improvement != null ? par30Improvement.toFixed(2) + '%' : '—',
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
    const weight7 = standards[6]?.weight ?? 0.02;
    const targetGrowth20 = 20;
    const weightScored7 = annualizedGrowth != null ? (Math.min(100, (annualizedGrowth / targetGrowth20) * 100) / 100) * weight7 : 0;
    const sheet7Tables = [{
      title: `Growth of active client base 20% annually — ${monthLabel}`,
      data: [
        { 'Metric': 'Active clients (current month)', 'Value': Number.isFinite(activeNum) ? activeNum : '—' },
        { 'Metric': 'Active clients (previous month)', 'Value': Number.isFinite(activePrevNum) ? activePrevNum : '—' },
        { 'Metric': 'Monthly growth (%)', 'Value': monthlyGrowthPct != null ? monthlyGrowthPct.toFixed(2) + '%' : '—' },
        { 'Metric': 'Annualized growth (%)', 'Value': annualizedGrowth != null ? annualizedGrowth.toFixed(2) + '%' : '—' }
      ],
      headerColors: { 'Metric': '#4472C4', 'Value': '#70AD47' },
      colWidths: [35, 18]
    }, {
      title: 'Summary',
      data: [{ 'KPI': standards[6]?.name ?? 'Growth of active client base 20% annually', 'Target': targetGrowth20 + '% (annualized)', 'Achieved': annualizedGrowth != null ? annualizedGrowth.toFixed(2) + '%' : '—', 'Weight (%)': (weight7 * 100).toFixed(2) + '%', 'Weight Scored (%)': (weightScored7 * 100).toFixed(2) + '%' }],
      headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Achieved': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' },
      colWidths: [45, 18, 16, 12, 16]
    }];
    summaryRows.push({
      kpi: standards[6]?.name ?? 'Growth of active client base 20% annually',
      target: targetGrowth20 + '% (annualized)',
      achieved: annualizedGrowth,
      achievedDisplay: annualizedGrowth != null ? annualizedGrowth.toFixed(2) + '%' : '—',
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
      return { 'Supervision': name, 'Target': target, 'Sales': value, '%': pct.toFixed(2) + '%', pct, hit: pct >= 100 };
    });
    const clusterRows = (branchData.clusters || []).map(b => ({
      'Cluster': b.branch,
      'Target': b.target,
      'Disbursement': b.disbursement,
      '%': b.pct.toFixed(2) + '%',
      pct: b.pct ?? 0,
      hit: (b.pct ?? 0) >= 100
    }));
    const sortedSupervisionRows = [...supervisionRows].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const sortedClusterRows = [...clusterRows].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
    const weight8 = standards[7]?.weight ?? 0.05;
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
      sheet8SupervisionData.push({ __totalRow: true, Supervision: 'Total', Target: totTarget, Sales: totSales, '%': totTarget > 0 ? ((totSales / totTarget) * 100).toFixed(2) + '%' : '—' });
    }
    const sheet8ClusterData = sortedClusterRows.map(({ Cluster, Target, Disbursement, '%': p }) => ({ Cluster, Target, Disbursement, '%': p }));
    const sheet8ClusterRowFillColors = sortedClusterRows.map(r => getColorForPct(r.pct ?? 0));
    if (sheet8ClusterData.length > 0) {
      const ct = sortedClusterRows.reduce((s, r) => s + r.Target, 0);
      const cd = sortedClusterRows.reduce((s, r) => s + r.Disbursement, 0);
      sheet8ClusterData.push({ __totalRow: true, Cluster: 'Total', Target: ct, Disbursement: cd, '%': ct > 0 ? ((cd / ct) * 100).toFixed(2) + '%' : '—' });
    }
    const sheet8Tables = [
      { title: `Supervisions (Regions) — ${monthLabel}`, data: sheet8SupervisionData.length ? sheet8SupervisionData : [{ Supervision: '—', Target: '—', Sales: '—', '%': '—' }], headerColors: { Supervision: '#1e3a5f', Target: '#c45a11', Sales: '#2d6a2d', '%': '#2d6a2d' }, colWidths: [28, 14, 14, 10], totalRowIndices: sheet8SupervisionData.length ? [sheet8SupervisionData.length - 1] : [], accountingColumns: ['Target', 'Sales'], rowFillColors: sheet8SupervisionRowFillColors },
      { title: `Clusters — ${monthLabel}`, data: sheet8ClusterData.length ? sheet8ClusterData : [{ Cluster: '—', Target: '—', Disbursement: '—', '%': '—' }], headerColors: { Cluster: '#1e3a5f', Target: '#c45a11', Disbursement: '#2d6a2d', '%': '#2d6a2d' }, colWidths: [18, 14, 16, 10], totalRowIndices: sheet8ClusterData.length ? [sheet8ClusterData.length - 1] : [], accountingColumns: ['Target', 'Disbursement'], rowFillColors: sheet8ClusterRowFillColors },
      { title: 'Summary', data: [{ 'KPI': standards[7]?.name ?? 'Ensure all Regions and Clusters hit their target', 'Regions hit': regionsHit, 'Regions total': totalRegions, 'Clusters hit': clustersHit, 'Clusters total': totalClusters, '% Hit': regionsClustersPct != null ? regionsClustersPct.toFixed(2) + '%' : '—', 'Weight (%)': (weight8 * 100).toFixed(2) + '%', 'Weight Scored (%)': (weightScored8 * 100).toFixed(2) + '%' }], headerColors: { 'KPI': '#4472C4', 'Regions hit': '#70AD47', 'Regions total': '#70AD47', 'Clusters hit': '#70AD47', 'Clusters total': '#70AD47', '% Hit': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' }, colWidths: [40, 12, 12, 12, 12, 10, 12, 16] }
    ];
    summaryRows.push({
      kpi: standards[7]?.name ?? 'Ensure all Regions and Clusters hit their target',
      target: '100% hit',
      achieved: regionsClustersPct,
      achievedDisplay: regionsClustersPct != null ? regionsClustersPct.toFixed(2) + '%' : '—',
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
      crmUsageRows.push({ 'Date': dateStr, 'Role': 'Team Leader', 'Total workforce': tlTotal, 'Logged in': tlLogged, 'Percentage logged in': tlTotal > 0 ? ((tlLogged / tlTotal) * 100).toFixed(2) + '%' : '0%' });
      crmUsageRows.push({ 'Date': dateStr, 'Role': 'Loan Officer', 'Total workforce': loTotal, 'Logged in': loLogged, 'Percentage logged in': loTotal > 0 ? ((loLogged / loTotal) * 100).toFixed(2) + '%' : '0%' });
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
        'Rejected Leads': `${rejected} (${totalLeads > 0 ? ((rejected / totalLeads) * 100).toFixed(2) : 0}%)`,
        'Not Provided Leads': `${notProvided} (${totalLeads > 0 ? ((notProvided / totalLeads) * 100).toFixed(2) : 0}%)`,
        'Consented Leads': `${consented} (${consentPct.toFixed(2)}%)`
      });
    });
    const totalWorkforce = crmUsageRows.reduce((s, r) => s + (Number(r['Total workforce']) || 0), 0);
    const totalLoggedIn = crmUsageRows.reduce((s, r) => s + (Number(r['Logged in']) || 0), 0);
    const overallUsagePct = totalWorkforce > 0 ? (totalLoggedIn / totalWorkforce) * 100 : null;
    const crmUsageTotalRow = { 'Date': 'Total', 'Role': '—', 'Total workforce': totalWorkforce, 'Logged in': totalLoggedIn, 'Percentage logged in': overallUsagePct != null ? overallUsagePct.toFixed(2) + '%' : '—' };
    const weight9 = standards[8]?.weight ?? 0.05;
    const targetUsage90 = 90;
    const weightScored9 = overallUsagePct != null ? (Math.min(100, (overallUsagePct / targetUsage90) * 100) / 100) * weight9 : 0;
    const avgConsentPct = totalLeadsSum > 0 ? (totalConsentedSum / totalLeadsSum) * 100 : null;
    const weight10 = standards[9]?.weight ?? 0.05;
    const targetConsent65 = 65;
    const weightScored10 = avgConsentPct != null ? (Math.min(100, (avgConsentPct / targetConsent65) * 100) / 100) * weight10 : 0;
    const sheet9Data = crmUsageRows.length ? [...crmUsageRows, crmUsageTotalRow] : [{ 'Date': '—', 'Role': '—', 'Total workforce': '—', 'Logged in': '—', 'Percentage logged in': '—' }];
    const sheet10TotalRow = { __totalRow: true, 'Date': 'Total', 'Total Leads': totalLeadsSum, 'Rejected Leads': '—', 'Not Provided Leads': '—', 'Consented Leads': avgConsentPct != null ? `${totalConsentedSum} (${avgConsentPct.toFixed(2)}%)` : String(totalConsentedSum) };
    const sheet10Data = crmConsentRows.length ? crmConsentRows.concat([sheet10TotalRow]) : [{ 'Date': '—', 'Total Leads': '—', 'Rejected Leads': '—', 'Not Provided Leads': '—', 'Consented Leads': '—' }];
    const sheet9Tables = [
      { title: `90% proper usage of CRM — ${monthLabel}`, data: sheet9Data, headerColors: { 'Date': '#4472C4', 'Role': '#4472C4', 'Total workforce': '#70AD47', 'Logged in': '#70AD47', 'Percentage logged in': '#70AD47' }, colWidths: [14, 14, 16, 12, 18], totalRowIndices: crmUsageRows.length ? [sheet9Data.length - 1] : [], accountingColumns: ['Total workforce', 'Logged in'] },
      { title: 'Summary', data: [{ 'KPI': standards[8]?.name ?? '90% proper usage of CRM', 'Target': targetUsage90 + '%', 'Achieved': overallUsagePct != null ? overallUsagePct.toFixed(2) + '%' : '—', 'Weight (%)': (weight9 * 100).toFixed(2) + '%', 'Weight Scored (%)': (weightScored9 * 100).toFixed(2) + '%' }], headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Achieved': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' }, colWidths: [32, 12, 14, 12, 16] }
    ];
    const sheet10Tables = [
      { title: `65% achieved of Data consent from each Cluster — ${monthLabel}`, data: sheet10Data, headerColors: { 'Date': '#4472C4', 'Total Leads': '#70AD47', 'Rejected Leads': '#ED7D31', 'Not Provided Leads': '#ED7D31', 'Consented Leads': '#70AD47' }, colWidths: [12, 14, 20, 22, 18], totalRowIndices: crmConsentRows.length ? [sheet10Data.length - 1] : [], accountingColumns: ['Total Leads'] },
      { title: 'Summary', data: [{ 'KPI': standards[9]?.name ?? '65% achieved of Data consent from each Cluster', 'Target': targetConsent65 + '%', 'Average consent': avgConsentPct != null ? avgConsentPct.toFixed(2) + '%' : '—', 'Weight (%)': (weight10 * 100).toFixed(2) + '%', 'Weight Scored (%)': (weightScored10 * 100).toFixed(2) + '%' }], headerColors: { 'KPI': '#4472C4', 'Target': '#ED7D31', 'Average consent': '#70AD47', 'Weight (%)': '#5B9BD5', 'Weight Scored (%)': '#5B9BD5' }, colWidths: [42, 12, 16, 12, 16] }
    ];
    summaryRows.push({ kpi: standards[8]?.name ?? '90% proper usage of CRM', target: targetUsage90 + '%', achieved: overallUsagePct, achievedDisplay: overallUsagePct != null ? overallUsagePct.toFixed(2) + '%' : '—', pct: overallUsagePct, weight: weight9, weightScored: weightScored9 });
    summaryRows.push({ kpi: standards[9]?.name ?? '65% achieved of Data consent from each Cluster', target: targetConsent65 + '%', achieved: avgConsentPct, achievedDisplay: avgConsentPct != null ? avgConsentPct.toFixed(2) + '%' : '—', pct: avgConsentPct, weight: weight10, weightScored: weightScored10 });

    // ----- KPI Summary (first sheet): Weight/Weight Scored as %, Achieved as value or % as appropriate, total row -----
    const totalWeight = summaryRows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
    const totalWeightScored = summaryRows.reduce((s, r) => s + (Number(r.weightScored) || 0), 0);
    const summaryTableDataWithDisplay = summaryRows.map((r) => ({
      'KPI': r.kpi,
      'Target': r.target,
      'Achieved': r.achievedDisplay !== undefined ? r.achievedDisplay : (r.achieved != null ? String(r.achieved) : '—'),
      '% Achieved': r.pct != null ? r.pct.toFixed(2) + '%' : '—',
      'Weight (%)': (Number(r.weight) * 100).toFixed(2) + '%',
      'Weight Scored (%)': r.weightScored != null ? (Number(r.weightScored) * 100).toFixed(2) + '%' : '—'
    }));
    summaryTableDataWithDisplay.push({
      __totalRow: true,
      'KPI': 'Total',
      'Target': '',
      'Achieved': '',
      '% Achieved': '',
      'Weight (%)': (totalWeight * 100).toFixed(2) + '%',
      'Weight Scored (%)': (totalWeightScored * 100).toFixed(2) + '%'
    });

    const kpiSummaryTable = {
      title: `KPI Summary — ${monthLabel}`,
      data: summaryTableDataWithDisplay,
      headerColors: { 'KPI': '#1e3a5f', 'Target': '#c45a11', 'Achieved': '#2d6a2d', '% Achieved': '#2d6a2d', 'Weight (%)': '#1a3a6e', 'Weight Scored (%)': '#1a3a6e' },
      colWidths: [50, 18, 16, 14, 12, 16],
      totalRowIndices: [summaryTableDataWithDisplay.length - 1]
    };

    const fileName = `CS_KPI_REPORT_${monthLabel.replace(/\s+/g, '_')}.xlsx`;

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
  }, [product, targets, effectiveMonthKey, latestManagementReport, previousMonthManagementReport, mtdParsedData, managementReports]);

  const handleDownloadXlsx = useCallback(async () => {
    const r = await buildKpiReportSheetsAndFile();
    if (r) await exportMultipleSheetsWithStyles(r.sheets, r.fileName, { twoDecimalPlaces: true });
  }, [buildKpiReportSheetsAndFile]);

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

  const copyMessageBody = () => {
    const html = emailBody || buildKpiReportEmailHTML(monthKeyToLabel(effectiveMonthKey), true);
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
    const defaultSubject = `CS KPI Analysis Report — ${monthLabel}`;
    const html = buildKpiReportEmailHTML(monthLabel, true);
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
    const defaultSubject = `CS KPI Analysis Report — ${monthLabel}`;
    const subject = emailSubject || defaultSubject;
    const htmlBody = emailBody || buildKpiReportEmailHTML(monthLabel, true);

    let attachmentBase64 = '';
    let attachmentName = '';
    const r = await buildKpiReportSheetsAndFile();
    if (r) {
      const result = await buildWorkbookBuffer(r.sheets, r.fileName, { twoDecimalPlaces: true });
      if (result?.buffer) {
        const binary = Array.from(result.buffer).map((b) => String.fromCharCode(b)).join('');
        attachmentBase64 = btoa(binary);
        attachmentName = result.fileName;
      }
    }

    const emailResult = await sendScoreCardEmail(recipients, subject, htmlBody, {
      mode: 'KPI',
      attachmentBase64,
      attachmentName
    });

    const status = emailResult.success ? 'success' : 'failed';
    const error = emailResult.success ? null : (emailResult.error || 'Failed to send');
    setSendProgress((prev) => prev.map((p) => ({ ...p, status, error })));
    setSending(false);
  };

  if (product !== 'CS') {
    return (
      <div className="kpi-ar-container">
        <div className="kpi-ar-header-bar">
          <h1 className="kpi-ar-title">KPI ANALYSIS REPORT</h1>
          <div className="kpi-ar-header-controls">
            <button type="button" className="kpi-ar-btn kpi-ar-btn-download" disabled title="Only CS implemented">
              <span className="kpi-ar-btn-icon">📥</span> Download xlsx
            </button>
          </div>
        </div>
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
        <div className="kpi-ar-placeholder">
          <p className="kpi-ar-message">KPI Analysis is available for CS only. Select CS above.</p>
        </div>
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

  if (targetsError || !targets) {
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
        <h1 className="kpi-ar-title">KPI ANALYSIS REPORT — CS</h1>
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
          <button
            type="button"
            className="kpi-ar-btn kpi-ar-btn-email"
            onClick={() => setShowEmailModal(true)}
            title="Send KPI report by email"
          >
            <span className="kpi-ar-btn-icon">✉</span> Send Email
          </button>
          <a
            href={CS_KPI_TARGET_FILE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="kpi-ar-btn kpi-ar-btn-view"
            title="Open uploaded KPI target file"
          >
            <span className="kpi-ar-btn-icon">📋</span> View KPI
          </a>
          <button
            type="button"
            className="kpi-ar-btn kpi-ar-btn-download"
            onClick={() => handleDownloadXlsx()}
            title="Download 7-sheet Excel (6 KPIs + Summary)"
          >
            <span className="kpi-ar-btn-icon">📥</span> Download xlsx
          </button>
        </div>
      </div>

      <div className="kpi-ar-product-toggles">
        <button
          type="button"
          className="kpi-ar-product-btn kpi-ar-product-btn--active"
          onClick={() => setProduct('CS')}
        >CS</button>
        <button type="button" className="kpi-ar-product-btn" onClick={() => setProduct('LBF')}>LBF</button>
        <button type="button" className="kpi-ar-product-btn" onClick={() => setProduct('SME')}>SME</button>
      </div>

      <div className="kpi-ar-content">
        {/* 1. KPI Summary (matches Excel first sheet) */}
        <section className="kpi-ar-section kpi-ar-section--summary">
          <h2 className="kpi-ar-section-title">KPI Summary — {monthKeyToLabel(effectiveMonthKey)}</h2>
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
                </tr>
              </thead>
              <tbody>
                {dashboardSummaryRows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.kpi}</td>
                    <td className="kpi-ar-num">{typeof r.target === 'number' ? formatTzs(r.target) : r.target}</td>
                    <td className="kpi-ar-num">{typeof r.achievedDisplay === 'number' ? formatTzs(r.achievedDisplay) : r.achievedDisplay}</td>
                    <td className="kpi-ar-num">{r.pct != null ? r.pct.toFixed(2) + '%' : '—'}</td>
                    <td className="kpi-ar-num">{(Number(r.weight) * 100).toFixed(2)}%</td>
                    <td className="kpi-ar-num">{r.weightScored != null ? (Number(r.weightScored) * 100).toFixed(2) + '%' : '—'}</td>
                  </tr>
                ))}
                {dashboardSummaryRows.length > 0 && (
                  <tr className="kpi-ar-table-total">
                    <td>Total</td>
                    <td className="kpi-ar-num" />
                    <td className="kpi-ar-num" />
                    <td className="kpi-ar-num" />
                    <td className="kpi-ar-num">{(dashboardSummaryRows.reduce((s, r) => s + (Number(r.weight) || 0), 0) * 100).toFixed(2)}%</td>
                    <td className="kpi-ar-num">{(dashboardSummaryRows.reduce((s, r) => s + (Number(r.weightScored) || 0), 0) * 100).toFixed(2)}%</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 2. Sales Target Achievement */}
        <section className="kpi-ar-section">
          <h2 className="kpi-ar-section-title">Sales Target Achievement</h2>
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
                  <td>Sales Target (Mainland + Zanzibar + Call Center)</td>
                  <td className="kpi-ar-num">{formatTzs(dashboardSummaryRows[0]?.target ?? 0)}</td>
                </tr>
                <tr>
                  <td>Sales Achieved (CS MTD)</td>
                  <td className="kpi-ar-num">{typeof dashboardSummaryRows[0]?.achievedDisplay === 'number' ? formatTzs(dashboardSummaryRows[0].achievedDisplay) : (dashboardSummaryRows[0]?.achievedDisplay ?? '—')}</td>
                </tr>
                <tr>
                  <td>% Achieved</td>
                  <td className="kpi-ar-num">{dashboardSummaryRows[0]?.pct != null ? dashboardSummaryRows[0].pct.toFixed(2) + '%' : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 3. Branch Sales Achievement (branches only; clusters appear in Regions & Clusters section) */}
        <section className="kpi-ar-section kpi-ar-section-branch-sales">
          <h2 className="kpi-ar-section-title">Branch Sales Achievement (85% at 100% target)</h2>
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
                {[...(branchSummaryData?.branches ?? [])]
                  .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))
                  .map((b, i) => (
                    <tr key={i}>
                      <td>{b.branch}</td>
                      <td className="kpi-ar-num">{formatTzs(b.target)}</td>
                      <td className="kpi-ar-num">{formatTzs(b.disbursement)}</td>
                      <td className="kpi-ar-num">{b.pct.toFixed(2)}%</td>
                    </tr>
                  ))}
                {branchSummaryData && branchSummaryData.branches.length > 0 && (
                  <tr className="kpi-ar-table-total">
                    <td>Total</td>
                    <td className="kpi-ar-num">{formatTzs(branchSummaryData.totalTarget)}</td>
                    <td className="kpi-ar-num">{formatTzs(branchSummaryData.totalDisbursement)}</td>
                    <td className="kpi-ar-num">{branchSummaryData.totalTarget > 0 ? ((branchSummaryData.totalDisbursement / branchSummaryData.totalTarget) * 100).toFixed(2) + '%' : '—'}</td>
                  </tr>
                )}
                {(!branchSummaryData || branchSummaryData.branches.length === 0) && (
                  <tr><td colSpan={4} className="kpi-ar-num">No branch data for selected month</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {branchSummaryData && (
            <p className="kpi-ar-section-note">
              Branches at ≥100%: {branchSummaryData.achieved100Count} — Below 100%: {branchSummaryData.notAchieved100Count} — % at 100%: {branchSummaryData.achieved100Count + branchSummaryData.notAchieved100Count > 0 ? ((branchSummaryData.achieved100Count / (branchSummaryData.achieved100Count + branchSummaryData.notAchieved100Count)) * 100).toFixed(2) : 0}%
            </p>
          )}
        </section>

        {/* 4. Mainland 65% new business */}
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
                <tr><td>% of target</td><td className="kpi-ar-num">{dashboardSummaryRows[2]?.pct != null ? dashboardSummaryRows[2].pct.toFixed(2) + '%' : '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 5. Zanzibar 70% new business */}
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
                <tr><td>% of target</td><td className="kpi-ar-num">{dashboardSummaryRows[3]?.pct != null ? dashboardSummaryRows[3].pct.toFixed(2) + '%' : '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 6. Portfolio growth 10% annually */}
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

        {/* 7. PAR 30 below 5% */}
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
                <tr><td>Current PAR &gt;30 (%)</td><td className="kpi-ar-num">{(() => { const v = normalizeParToPercentage(latestManagementReport?.cs?.['PAR >30'] ?? latestManagementReport?.cs?.['PAR>30']); return Number.isFinite(v) ? v.toFixed(2) + '%' : '—'; })()}</td></tr>
                <tr><td>Previous month PAR &gt;30 (%)</td><td className="kpi-ar-num">{(() => { const v = normalizeParToPercentage(previousMonthManagementReport?.cs?.['PAR >30'] ?? previousMonthManagementReport?.cs?.['PAR>30']); return Number.isFinite(v) ? v.toFixed(2) + '%' : '—'; })()}</td></tr>
                <tr><td>Improvement (pp)</td><td className="kpi-ar-num">{dashboardSummaryRows[5]?.achievedDisplay ?? '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 8. Growth of active client base 20% annually */}
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
                <tr><td>Active clients (current)</td><td className="kpi-ar-num">{latestManagementReport?.cs?.['Active clients'] ?? latestManagementReport?.cs?.['Active Clients'] ?? '—'}</td></tr>
                <tr><td>Active clients (previous month)</td><td className="kpi-ar-num">{previousMonthManagementReport?.cs?.['Active clients'] ?? previousMonthManagementReport?.cs?.['Active Clients'] ?? '—'}</td></tr>
                <tr><td>Annualized growth (%)</td><td className="kpi-ar-num">{dashboardSummaryRows[6]?.achievedDisplay ?? '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 9. Regions and Clusters hit target */}
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

        {/* 10. 90% proper usage of CRM */}
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

        {/* 11. 65% achieved of Data consent from each Cluster */}
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
      </div>

      {/* Fullscreen Email modal */}
      {showEmailModal && (
        <div
          className="kpi-ar-email-overlay"
          onClick={() => { if (!sending) { setShowEmailModal(false); setSendProgress(null); } }}
        >
          <div className="kpi-ar-email-modal" onClick={(e) => e.stopPropagation()}>
            <div className="kpi-ar-email-modal-header">
              <h3 className="kpi-ar-email-modal-title">Send KPI Analysis Report by Email</h3>
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
                  title="Copy all emails"
                >
                  {copiedList ? '✓ Copied!' : 'Copy email list'}
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
                      📎 Attachment: CS_KPI_REPORT_{effectiveMonthKey ? monthKeyToLabel(effectiveMonthKey).replace(/\s+/g, '_') : 'report'}.xlsx
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
      )}
    </div>
  );
};

export default KpiAnalysisReport;
