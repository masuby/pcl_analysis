import React, { useState, useRef, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import './SalesReviewReport.css';
import { useManagementData } from '../../../ManagementDashboard/hooks/useManagementData';
import { useMTDData } from '../../../MTDdashboard/hooks/useMTDData';
import { formatTZS } from '../../../ManagementDashboard/utils/summaryUtils';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';
import { generateSalesReviewPPTX } from './utils/pptxGenerator';
import { getMonthlyTrendData, getTrendExplanation } from './utils/trendDataUtils';
import { getSummaryForMonth, getComparisonData } from './utils/summaryDataUtils';
import { getProductContributionData, getProductContributionForSection } from './utils/productContributionUtils';
import { getNewBusinessTrendData, getRepeatBusinessTrendData, getNewBusinessComparison, getRepeatBusinessComparison } from './utils/newRepeatBusinessUtils';
import { REPORT_SECTIONS } from './config/reportSectionConfig';
import { gapAnalysisAPI } from '../../../../../../services/api';
import { getActiveActualTotals } from '../GapAnalysis/utils/gapAnalysisUtils';
import { parseCrmSummaryActualAgents, buildCrmActualAgentsLookup } from './utils/crmSummaryActualAgents';
import { getCrmEmailAgentTotalForDept, getCrmEmailAgentTotalCountrywide } from './utils/crmTotalsForSalesReview';
import { sendSalesReviewEmail } from './utils/emailSalesReview';
import { buildSalesReviewEmailHTML } from './utils/emailTemplateSalesReview';
import { getReportsByDepartmentAndType, getReportFileUrl } from '../../../../../../services/reports';
import GeneralSalesTrendChart from './sections/GeneralSalesTrendChart';
import SalesAndPerformanceSummary from './sections/SalesAndPerformanceSummary';
import TrendExplanationText from './sections/TrendExplanationText';
import PerformanceComparison from './sections/PerformanceComparison';
import PerProductContribution from './sections/PerProductContribution';
import NewBusinessPerformance from './sections/NewBusinessPerformance';
import RepeatBusinessPerformance from './sections/RepeatBusinessPerformance';
import ProductPerformanceBlock from './sections/ProductPerformanceBlock';

const LOGO_SRC = '/Assets/pcl_logo2.png';
const RECIPIENTS_STORAGE_KEY = 'sales_review_email_recipients';

async function getLogoAsBase64() {
  const res = await fetch(LOGO_SRC);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Get total Active Reps from MTD: from sheet column if present, else by counting unique active reps per supervision (same as ProductSalesTracker) */
function getMTDTotalActiveReps(parsedData) {
  if (!parsedData?.groupedData) return null;
  const headers = parsedData.headers || [];
  const activeRepsKey = headers.find((h) => String(h || '').toUpperCase().includes('ACTIVE REP'));
  let total = 0;
  let usedSheet = false;
  Object.values(parsedData.groupedData).forEach((supervision) => {
    if (supervision.supervisionData) {
      const fromSheet = activeRepsKey != null
        ? Number(supervision.supervisionData[activeRepsKey] ?? supervision.supervisionData['NUMBER OF ACTIVE REPS'] ?? supervision.supervisionData['Active Reps'] ?? 0)
        : 0;
      if (fromSheet > 0) {
        total += fromSheet;
        usedSheet = true;
      }
    }
  });
  if (usedSheet && total > 0) return Math.round(total);
  total = 0;
  Object.values(parsedData.groupedData).forEach((supervision) => {
    total += countActiveRepsFromSupervision(supervision, parsedData.columnMap, parsedData.listingData);
  });
  return Math.round(total);
}

/** True when parsed MTD is for the requested calendar month (avoids useMTDData fallback to the wrong report). */
function mtdParsedMonthMatches(parsedData, yyyyMm) {
  if (!parsedData || !yyyyMm || typeof yyyyMm !== 'string') return false;
  const d = parsedData.reportDate instanceof Date ? parsedData.reportDate : new Date(parsedData.reportDate);
  if (Number.isNaN(d.getTime())) return false;
  const [y, m] = yyyyMm.split('-').map(Number);
  if (!y || !m) return false;
  return d.getFullYear() === y && d.getMonth() === m - 1;
}

/** MoM / YoY active agents: same four-way total as Management Summary (CS+LBF MTD + SME+Agrifinance management). */
function comparisonMetricActiveMtdOnly(current, previous) {
  if (current == null || previous == null) return null;
  const cur = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const pctRaw = prev !== 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;
  return {
    dir: pctRaw >= 0 ? 'increased' : 'decreased',
    pct: Math.abs(pctRaw).toFixed(2),
    currentFmt: formatTZS(cur),
    prevFmt: formatTZS(prev)
  };
}

/** Count active reps: unique sales reps that have a non-empty Term (from listing), same as ProductSalesTracker */
function countActiveRepsFromSupervision(supervision, columnMap, listingData) {
  const salesRepCol = columnMap?.salesRep ?? (listingData?.[0] && Object.keys(listingData[0]).find((k) => String(k).toUpperCase() === 'SALES REP')) ?? (listingData?.[0] && Object.keys(listingData[0]).find((k) => String(k).toUpperCase() === 'SALES REP. NAME'));
  const termCol = columnMap?.term ?? (listingData?.[0] && Object.keys(listingData[0]).find((k) => String(k).toUpperCase() === 'TERM'));
  let supSalesReps = [];
  (supervision.teamLeaders || []).forEach((tl) => {
    supSalesReps.push(...(tl.salesReps || []));
  });
  if (!supSalesReps.length || !salesRepCol) return 0;
  const withTerm = supSalesReps.filter((rep) => {
    const term = termCol ? rep[termCol] ?? rep['Term'] ?? rep['TERM'] : null;
    return term != null && String(term).trim() !== '';
  });
  const uniqueNames = new Set(
    withTerm.map((rep) => {
      const name = rep[salesRepCol] ?? rep['SALES REP'] ?? rep['SALES REP. NAME'];
      return name != null ? String(name).trim() : null;
    }).filter(Boolean)
  );
  return uniqueNames.size;
}

function extractCRMAgentCountFromWorkbook(wb) {
  if (!wb?.SheetNames?.includes('Email')) return 0;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Email, { defval: '' });
  const map = {};
  rows.forEach((r) => {
    const k = String(r.Text ?? r.text ?? '').trim().toLowerCase();
    if (k) map[k] = r.Value ?? r.value ?? '';
  });
  const keys = ['total_count_agent', 'total_agent', 'today_total_agents', 'count_agent'];
  for (const k of keys) {
    const n = Number(map[k]) || 0;
    if (n > 0) return Math.round(n);
  }
  return 0;
}

/** Build supervision performance list from MTD for table/chart: name, target, value, percentage, activeReps, sorted by % desc */
function getMTDSupervisionPerformance(parsedData) {
  if (!parsedData?.groupedData) return null;
  const headers = parsedData.headers || [];
  const valueKey = headers.find((h) => String(h || '').toUpperCase().includes('VALUE'));
  const targetKey = headers.find((h) => String(h || '').toUpperCase().includes('MONTH TARGET'));
  const activeRepsKey = headers.find((h) => String(h || '').toUpperCase().includes('ACTIVE REP'));
  const rows = [];
  let totalTarget = 0;
  let totalValue = 0;
  let totalActiveReps = 0;
  Object.values(parsedData.groupedData).forEach((sup) => {
    const name = sup.supervision || '';
    const target = Number(sup.supervisionData?.[targetKey] ?? sup.supervisionData?.['Month Target'] ?? 0) || 0;
    const value = Number(sup.supervisionData?.[valueKey] ?? sup.supervisionData?.['Value'] ?? 0) || 0;
    let activeReps = 0;
    if (activeRepsKey != null && (sup.supervisionData?.[activeRepsKey] ?? sup.supervisionData?.['NUMBER OF ACTIVE REPS'] ?? sup.supervisionData?.['Active Reps']) != null) {
      activeReps = Number(sup.supervisionData?.[activeRepsKey] ?? sup.supervisionData?.['NUMBER OF ACTIVE REPS'] ?? sup.supervisionData?.['Active Reps'] ?? 0) || 0;
    }
    if (activeReps === 0) {
      activeReps = countActiveRepsFromSupervision(sup, parsedData.columnMap, parsedData.listingData);
    }
    activeReps = Math.round(Number(activeReps) || 0);
    const percentage = target > 0 ? (value / target) * 100 : 0;
    rows.push({ name, target, value, percentage, activeReps });
    totalTarget += target;
    totalValue += value;
    totalActiveReps += activeReps;
  });
  rows.sort((a, b) => b.percentage - a.percentage);
  return { rows, totalTarget, totalValue, totalActiveReps: Math.round(totalActiveReps) };
}

/**
 * Actual Reps from CRM summary (Branch/Zone + Actual Agent); fallback to Active Reps when no CRM match.
 * If actual < active for a row, actual is raised to active.
 * Total Actual Reps column footer uses the same value as the summary paragraph
 * (`getCrmEmailAgentTotalForDept` → crmActualRepsByMonth from CRM Email sheet); if null, sum of row actuals.
 */
function augmentSupervisionWithCrmActualReps(supervisionData, crmLookup, crmEmailTotalAgents) {
  if (!supervisionData?.rows?.length) return supervisionData;
  const lookup = typeof crmLookup === 'function' ? crmLookup : null;
  const rows = supervisionData.rows.map((r) => {
    const fromCrm = lookup ? lookup(r.name) : null;
    let actual =
      fromCrm != null && Number.isFinite(fromCrm)
        ? Math.round(fromCrm)
        : Math.round(Number(r.activeReps) || 0);
    const active = Math.round(Number(r.activeReps) || 0);
    if (actual < active) actual = active;
    return { ...r, actualReps: actual };
  });
  const t = crmEmailTotalAgents;
  const totalActualReps =
    t != null && Number.isFinite(Number(t)) && Number(t) >= 0
      ? Math.round(Number(t))
      : Math.round(rows.reduce((s, row) => s + (row.actualReps ?? 0), 0));
  return { ...supervisionData, rows, totalActualReps };
}

/** Get report ID for the end-of-month MTD report (Sales Review uses that report's uploaded Gap Actual Reps template). */
function getEndOfMonthReportId(reports, selectedMonth) {
  if (!reports?.length || !selectedMonth) return null;
  const [y, m] = selectedMonth.split('-').map(Number);
  if (!y || !m) return null;
  const lastDay = new Date(y, m, 0).getDate();
  const toDate = (r) => (r.date instanceof Date ? r.date : new Date(r.date));
  const sameDay = (d, year, month, day) =>
    d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  const inMonth = (d) => d.getFullYear() === y && d.getMonth() === m - 1;
  const endOfMonth = reports.find((r) => sameDay(toDate(r), y, m, lastDay));
  if (endOfMonth) return endOfMonth.id;
  const inMonthReports = reports.filter((r) => inMonth(toDate(r)));
  if (inMonthReports.length > 0) {
    inMonthReports.sort((a, b) => toDate(b) - toDate(a));
    return inMonthReports[0].id;
  }
  return reports[0]?.id ?? null;
}

const SalesReviewReport = ({ userData }) => {
  const { parsedReports, loading, error } = useManagementData();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const mtdLBF = useMTDData('LBF', selectedMonth);
  const mtdCS = useMTDData('CS', selectedMonth);
  const mtdSME = useMTDData('SME', selectedMonth);

  const prevMonthKey = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    if (!y || !m) return null;
    if (m > 1) return `${y}-${String(m - 1).padStart(2, '0')}`;
    return `${y - 1}-12`;
  }, [selectedMonth]);

  const lastYearMonthKey = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    if (!y || !m) return null;
    return `${y - 1}-${String(m).padStart(2, '0')}`;
  }, [selectedMonth]);

  const mtdLBFPrev = useMTDData('LBF', prevMonthKey);
  const mtdCSPrev = useMTDData('CS', prevMonthKey);
  const mtdSMEPrev = useMTDData('SME', prevMonthKey);
  const mtdLBFYoY = useMTDData('LBF', lastYearMonthKey);
  const mtdCSYoY = useMTDData('CS', lastYearMonthKey);
  const mtdSMEYoY = useMTDData('SME', lastYearMonthKey);
  const [generatingPPTX, setGeneratingPPTX] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [recipients, setRecipients] = useState(() => {
    try {
      const saved = localStorage.getItem(RECIPIENTS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [newRecipient, setNewRecipient] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendProgress, setSendProgress] = useState(null); // null = not started, or [{ email, status, error? }]
  const [sendPhase, setSendPhase] = useState(''); // 'preparing' | 'sending' | ''
  const [showPreview, setShowPreview] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [copiedList, setCopiedList] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const [lbfActualRepsOverrides, setLbfActualRepsOverrides] = useState({});
  const [csActualRepsOverrides, setCsActualRepsOverrides] = useState({});
  const [smeActualRepsOverrides, setSmeActualRepsOverrides] = useState({});
  const [crmActualRepsByMonth, setCrmActualRepsByMonth] = useState({ CS: {}, LBF: {}, SME: {} });
  const [crmActualDateByMonth, setCrmActualDateByMonth] = useState({ CS: {}, LBF: {}, SME: {} });
  /** Per month: parsed CRM summary rows (Branch/Zone → Actual Agents) for supervision Actual Reps */
  const [crmSummaryByDeptMonth, setCrmSummaryByDeptMonth] = useState({ CS: {}, LBF: {}, SME: {} });
  const reportContainerRef = useRef(null);

  useEffect(() => {
    const reportId = getEndOfMonthReportId(mtdLBF.reports || [], selectedMonth);
    if (!reportId) {
      setLbfActualRepsOverrides({});
      return;
    }
    gapAnalysisAPI.getActualReps(reportId).then((res) => setLbfActualRepsOverrides(res?.data ?? {})).catch(() => setLbfActualRepsOverrides({}));
  }, [mtdLBF.reports, selectedMonth]);

  useEffect(() => {
    const reportId = getEndOfMonthReportId(mtdCS.reports || [], selectedMonth);
    if (!reportId) {
      setCsActualRepsOverrides({});
      return;
    }
    gapAnalysisAPI.getActualReps(reportId).then((res) => setCsActualRepsOverrides(res?.data ?? {})).catch(() => setCsActualRepsOverrides({}));
  }, [mtdCS.reports, selectedMonth]);

  useEffect(() => {
    const reportId = getEndOfMonthReportId(mtdSME.reports || [], selectedMonth);
    if (!reportId) {
      setSmeActualRepsOverrides({});
      return;
    }
    gapAnalysisAPI.getActualReps(reportId).then((res) => setSmeActualRepsOverrides(res?.data ?? {})).catch(() => setSmeActualRepsOverrides({}));
  }, [mtdSME.reports, selectedMonth]);

  useEffect(() => {
    let cancelled = false;
    const toMonthKey = (dateLike) => {
      const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
      if (Number.isNaN(d.getTime())) return null;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const loadCrmActuals = async () => {
      const out = { CS: {}, LBF: {}, SME: {} };
      const outDates = { CS: {}, LBF: {}, SME: {} };
      const summaryByMonth = { CS: {}, LBF: {}, SME: {} };
      for (const dept of ['CS', 'LBF', 'SME']) {
        const pattern = dept === 'CS' ? 'CS_CRM' : dept === 'LBF' ? 'LBF_CRM' : 'SME_CRM';
        const res = await getReportsByDepartmentAndType(dept, 'CRM');
        if (!res?.success) continue;
        const sorted = (res.data || [])
          .map((r) => ({ ...r, _d: r.date instanceof Date ? r.date : new Date(r.date || r.createdAt || r.created_at || '') }))
          .filter((r) => !Number.isNaN(r._d.getTime()))
          .filter((r) => String(r.fileName || r.file_name || '').includes(pattern))
          .sort((a, b) => b._d - a._d);
        const latestPerMonth = {};
        sorted.forEach((r) => {
          const key = toMonthKey(r._d);
          if (key && !latestPerMonth[key]) latestPerMonth[key] = r;
        });
        for (const [monthKey, report] of Object.entries(latestPerMonth)) {
          try {
            const url = report.fileUrl || report.file_url || ((report.filePath || report.file_path) ? await getReportFileUrl(report.filePath || report.file_path) : null);
            if (!url) continue;
            const fetched = await fetch(url);
            if (!fetched.ok) continue;
            const ab = await fetched.arrayBuffer();
            const wb = XLSX.read(ab, { type: 'array', raw: false });
            out[dept][monthKey] = extractCRMAgentCountFromWorkbook(wb);
            const summaryRows = parseCrmSummaryActualAgents(ab);
            if (summaryRows.length > 0) {
              summaryByMonth[dept][monthKey] = summaryRows;
            }
            outDates[dept][monthKey] = report._d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
          } catch {
            // ignore month if CRM file cannot be parsed
          }
        }
      }
      if (!cancelled) {
        setCrmActualRepsByMonth(out);
        setCrmActualDateByMonth(outDates);
        setCrmSummaryByDeptMonth(summaryByMonth);
      }
    };
    loadCrmActuals();
    return () => { cancelled = true; };
  }, []);

  const copyRecipientList = () => {
    if (recipients.length === 0) return;
    const list = recipients.join('\n');
    navigator.clipboard.writeText(list).then(() => {
      setCopiedList(true);
      setTimeout(() => setCopiedList(false), 2000);
    }).catch(() => {});
  };

  const copyMessageBody = () => {
    const reportDate = new Date().toISOString().split('T')[0];
    const html = emailBody || buildSalesReviewEmailHTML(monthLabel, reportDate);
    const div = document.createElement('div');
    div.innerHTML = html;
    const text = (div.innerText || div.textContent || '').trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedBody(true);
      setTimeout(() => setCopiedBody(false), 2000);
    }).catch(() => {});
  };

  const monthDate = new Date(selectedMonth + '-01');
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const monthLabelShort = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  useEffect(() => {
    try {
      localStorage.setItem(RECIPIENTS_STORAGE_KEY, JSON.stringify(recipients));
    } catch (e) {
      console.warn('Could not save recipients', e);
    }
  }, [recipients]);

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

  const generatePreview = () => {
    const reportDate = new Date().toISOString().split('T')[0];
    const subject = `MONTHLY SALES REVIEW FOR ${monthLabel.toUpperCase()}`;
    const html = buildSalesReviewEmailHTML(monthLabel, reportDate);
    setEmailSubject(subject);
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
    setSendProgress(null);
    setSendPhase('preparing');

    const reportDate = new Date().toISOString().split('T')[0];
    const subject = emailSubject || `MONTHLY SALES REVIEW FOR ${monthLabel.toUpperCase()}`;
    const htmlBody = emailBody || buildSalesReviewEmailHTML(monthLabel, reportDate);

    // Generate PPTX once and convert to base64
    let attachmentBase64 = '';
    let attachmentName = '';
    try {
      const logoBase64 = await getLogoAsBase64().catch(() => null);
      const pptxResult = await generateSalesReviewPPTX(
        { 
          countrywiseData, 
          monthlyTrendData, 
          trendExplanation, 
          summaryData, 
          comparisonData, 
          productContributionData, 
          newBusinessTrend,
          repeatBusinessTrend,
          newBusinessComparison,
          repeatBusinessComparison,
          sectionsData 
        },
        selectedMonth,
        userData,
        logoBase64,
        true // Return blob instead of downloading
      );
      // pptxgenjs write() returns a Promise that resolves to Blob
      const pptxBlob = pptxResult instanceof Blob ? pptxResult : await Promise.resolve(pptxResult);
      if (pptxBlob && pptxBlob instanceof Blob) {
        const arrayBuffer = await pptxBlob.arrayBuffer();
        const binary = Array.from(new Uint8Array(arrayBuffer))
          .map((b) => String.fromCharCode(b))
          .join('');
        attachmentBase64 = btoa(binary);
        attachmentName = `Sales_Review_${selectedMonth}.pptx`;
      }
    } catch (e) {
      console.error('Failed to generate PPTX attachment', e);
      setSendError('Failed to generate PPTX attachment: ' + (e?.message || String(e)));
      setSending(false);
      setSendPhase('');
      return;
    }

    setSendPhase('sending');
    setSendProgress(recipients.map((email) => ({ email, status: 'sending', error: null })));

    const emailResult = await sendSalesReviewEmail(recipients, subject, htmlBody, {
      attachmentBase64,
      attachmentName
    });

    const status = emailResult.success ? 'success' : 'failed';
    const error = emailResult.success ? null : (emailResult.error || 'Failed to send');
    setSendProgress((prev) => prev && prev.map((p) => ({ ...p, status, error })));
    setSending(false);
    setSendPhase('');
  };

  const countrywiseData = useMemo(() => {
    if (!parsedReports || parsedReports.length === 0) return [];
    return parsedReports
      .filter((r) => r.countrywise && Object.keys(r.countrywise).length > 0)
      .map((r) => ({
        fileName: r.fileName || 'Unknown',
        date: r.date ? (r.date instanceof Date ? r.date : new Date(r.date)) : new Date(),
        ...r.countrywise
      }));
  }, [parsedReports]);

  const lbfMTDTotalActiveReps = useMemo(() => {
    if (!mtdParsedMonthMatches(mtdLBF.parsedData, selectedMonth)) return null;
    return getMTDTotalActiveReps(mtdLBF.parsedData);
  }, [mtdLBF.parsedData, selectedMonth]);
  const csMTDTotalActiveReps = useMemo(() => {
    if (!mtdParsedMonthMatches(mtdCS.parsedData, selectedMonth)) return null;
    return getMTDTotalActiveReps(mtdCS.parsedData);
  }, [mtdCS.parsedData, selectedMonth]);
  const smeMTDTotalActiveReps = useMemo(() => {
    if (!mtdParsedMonthMatches(mtdSME.parsedData, selectedMonth)) return null;
    return getMTDTotalActiveReps(mtdSME.parsedData);
  }, [mtdSME.parsedData, selectedMonth]);

  const lbfMTDPrevTotalActiveReps = useMemo(() => {
    if (!prevMonthKey || !mtdParsedMonthMatches(mtdLBFPrev.parsedData, prevMonthKey)) return null;
    return getMTDTotalActiveReps(mtdLBFPrev.parsedData);
  }, [mtdLBFPrev.parsedData, prevMonthKey]);
  const csMTDPrevTotalActiveReps = useMemo(() => {
    if (!prevMonthKey || !mtdParsedMonthMatches(mtdCSPrev.parsedData, prevMonthKey)) return null;
    return getMTDTotalActiveReps(mtdCSPrev.parsedData);
  }, [mtdCSPrev.parsedData, prevMonthKey]);
  const smeMTDPrevTotalActiveReps = useMemo(() => {
    if (!prevMonthKey || !mtdParsedMonthMatches(mtdSMEPrev.parsedData, prevMonthKey)) return null;
    return getMTDTotalActiveReps(mtdSMEPrev.parsedData);
  }, [mtdSMEPrev.parsedData, prevMonthKey]);
  const lbfMTDYoYTotalActiveReps = useMemo(() => {
    if (!lastYearMonthKey || !mtdParsedMonthMatches(mtdLBFYoY.parsedData, lastYearMonthKey)) return null;
    return getMTDTotalActiveReps(mtdLBFYoY.parsedData);
  }, [mtdLBFYoY.parsedData, lastYearMonthKey]);
  const csMTDYoYTotalActiveReps = useMemo(() => {
    if (!lastYearMonthKey || !mtdParsedMonthMatches(mtdCSYoY.parsedData, lastYearMonthKey)) return null;
    return getMTDTotalActiveReps(mtdCSYoY.parsedData);
  }, [mtdCSYoY.parsedData, lastYearMonthKey]);
  const smeMTDYoYTotalActiveReps = useMemo(() => {
    if (!lastYearMonthKey || !mtdParsedMonthMatches(mtdSMEYoY.parsedData, lastYearMonthKey)) return null;
    return getMTDTotalActiveReps(mtdSMEYoY.parsedData);
  }, [mtdSMEYoY.parsedData, lastYearMonthKey]);
  const lbfSupervisionDataRaw = useMemo(() => getMTDSupervisionPerformance(mtdLBF.parsedData), [mtdLBF.parsedData]);
  const csSupervisionDataRaw = useMemo(() => getMTDSupervisionPerformance(mtdCS.parsedData), [mtdCS.parsedData]);
  const smeSupervisionDataRaw = useMemo(() => getMTDSupervisionPerformance(mtdSME.parsedData), [mtdSME.parsedData]);
  const lbfCrmActualLookup = useMemo(
    () => buildCrmActualAgentsLookup(crmSummaryByDeptMonth.LBF?.[selectedMonth] || []),
    [crmSummaryByDeptMonth.LBF, selectedMonth]
  );
  const csCrmActualLookup = useMemo(
    () => buildCrmActualAgentsLookup(crmSummaryByDeptMonth.CS?.[selectedMonth] || []),
    [crmSummaryByDeptMonth.CS, selectedMonth]
  );
  const smeCrmActualLookup = useMemo(
    () => buildCrmActualAgentsLookup(crmSummaryByDeptMonth.SME?.[selectedMonth] || []),
    [crmSummaryByDeptMonth.SME, selectedMonth]
  );

  const lbfSupervisionData = useMemo(
    () =>
      augmentSupervisionWithCrmActualReps(
        lbfSupervisionDataRaw,
        lbfCrmActualLookup,
        getCrmEmailAgentTotalForDept(crmActualRepsByMonth, 'LBF', selectedMonth)
      ),
    [lbfSupervisionDataRaw, lbfCrmActualLookup, crmActualRepsByMonth, selectedMonth]
  );
  const csSupervisionData = useMemo(
    () =>
      augmentSupervisionWithCrmActualReps(
        csSupervisionDataRaw,
        csCrmActualLookup,
        getCrmEmailAgentTotalForDept(crmActualRepsByMonth, 'CS', selectedMonth)
      ),
    [csSupervisionDataRaw, csCrmActualLookup, crmActualRepsByMonth, selectedMonth]
  );
  const smeSupervisionData = useMemo(
    () =>
      augmentSupervisionWithCrmActualReps(
        smeSupervisionDataRaw,
        smeCrmActualLookup,
        getCrmEmailAgentTotalForDept(crmActualRepsByMonth, 'SME', selectedMonth)
      ),
    [smeSupervisionDataRaw, smeCrmActualLookup, crmActualRepsByMonth, selectedMonth]
  );

  const lbfActiveActualTotals = useMemo(
    () => (mtdLBF.parsedData ? getActiveActualTotals(mtdLBF.parsedData, 'LBF', lbfActualRepsOverrides) : null),
    [mtdLBF.parsedData, lbfActualRepsOverrides]
  );
  const csActiveActualTotals = useMemo(
    () => (mtdCS.parsedData ? getActiveActualTotals(mtdCS.parsedData, 'CS', csActualRepsOverrides) : null),
    [mtdCS.parsedData, csActualRepsOverrides]
  );
  const smeActiveActualTotals = useMemo(
    () => (mtdSME.parsedData ? getActiveActualTotals(mtdSME.parsedData, 'SME', smeActualRepsOverrides) : null),
    [mtdSME.parsedData, smeActualRepsOverrides]
  );

  const monthlyTrendData = useMemo(() => getMonthlyTrendData(countrywiseData), [countrywiseData]);
  const trendExplanation = useMemo(() => getTrendExplanation(monthlyTrendData), [monthlyTrendData]);
  const summaryData = useMemo(() => {
    const base = getSummaryForMonth(countrywiseData, selectedMonth);
    const crmTotal = getCrmEmailAgentTotalCountrywide(crmActualRepsByMonth, selectedMonth);
    const activeTotal =
      csMTDTotalActiveReps != null &&
      lbfMTDTotalActiveReps != null &&
      smeMTDTotalActiveReps != null
        ? Math.round(csMTDTotalActiveReps + lbfMTDTotalActiveReps + smeMTDTotalActiveReps)
        : null;
    return {
      ...base,
      activeReps: activeTotal,
      activeRepsFormatted: activeTotal != null ? formatTZS(activeTotal) : null,
      crmActualRepsTotal: crmTotal,
      crmActualRepsDate: base.monthLabel
    };
  }, [
    countrywiseData,
    selectedMonth,
    crmActualRepsByMonth,
    csMTDTotalActiveReps,
    lbfMTDTotalActiveReps,
    smeMTDTotalActiveReps
  ]);
  const comparisonData = useMemo(() => {
    const base = getComparisonData(countrywiseData, selectedMonth);
    if (!base) return base;
    const curSum =
      csMTDTotalActiveReps != null &&
      lbfMTDTotalActiveReps != null &&
      smeMTDTotalActiveReps != null
        ? Math.round(csMTDTotalActiveReps + lbfMTDTotalActiveReps + smeMTDTotalActiveReps)
        : null;
    const prevMoMSum =
      prevMonthKey &&
      csMTDPrevTotalActiveReps != null &&
      lbfMTDPrevTotalActiveReps != null &&
      smeMTDPrevTotalActiveReps != null
        ? Math.round(csMTDPrevTotalActiveReps + lbfMTDPrevTotalActiveReps + smeMTDPrevTotalActiveReps)
        : null;
    const yoySum =
      lastYearMonthKey &&
      csMTDYoYTotalActiveReps != null &&
      lbfMTDYoYTotalActiveReps != null &&
      smeMTDYoYTotalActiveReps != null
        ? Math.round(csMTDYoYTotalActiveReps + lbfMTDYoYTotalActiveReps + smeMTDYoYTotalActiveReps)
        : null;
    const applyMoM = (block) => {
      if (!block) return block;
      return { ...block, activeReps: comparisonMetricActiveMtdOnly(curSum, prevMoMSum) };
    };
    const applyYoY = (block) => {
      if (!block) return block;
      return { ...block, activeReps: comparisonMetricActiveMtdOnly(curSum, yoySum) };
    };
    return {
      ...base,
      lastMonth: applyMoM(base.lastMonth),
      lastYear: applyYoY(base.lastYear)
    };
  }, [
    countrywiseData,
    selectedMonth,
    csMTDTotalActiveReps,
    lbfMTDTotalActiveReps,
    smeMTDTotalActiveReps,
    csMTDPrevTotalActiveReps,
    lbfMTDPrevTotalActiveReps,
    smeMTDPrevTotalActiveReps,
    csMTDYoYTotalActiveReps,
    lbfMTDYoYTotalActiveReps,
    smeMTDYoYTotalActiveReps,
    prevMonthKey,
    lastYearMonthKey
  ]);
  const productContributionData = useMemo(() => getProductContributionData(parsedReports, selectedMonth), [parsedReports, selectedMonth]);
  
  // New and Repeat Business performance for countrywide
  const newBusinessTrend = useMemo(() => getNewBusinessTrendData(countrywiseData), [countrywiseData]);
  const repeatBusinessTrend = useMemo(() => getRepeatBusinessTrendData(countrywiseData), [countrywiseData]);
  const newBusinessComparison = useMemo(() => getNewBusinessComparison(countrywiseData, selectedMonth), [countrywiseData, selectedMonth]);
  const repeatBusinessComparison = useMemo(() => getRepeatBusinessComparison(countrywiseData, selectedMonth), [countrywiseData, selectedMonth]);

  const sectionsData = useMemo(() => {
    return REPORT_SECTIONS.map((section) => {
      const sectionData = section.getData(parsedReports);
      const monthlyTrend = getMonthlyTrendData(sectionData);
      let summaryData = getSummaryForMonth(sectionData, selectedMonth);
      let sectionComparisonData = getComparisonData(sectionData, selectedMonth);
      const isLBF = section.id === 'lbf';
      const isCSMainland = section.id === 'cs-mainland';
      const isSME = section.id === 'sme';
      const mtdActiveForSection = isLBF ? lbfMTDTotalActiveReps : isCSMainland ? csMTDTotalActiveReps : isSME ? smeMTDTotalActiveReps : null;
      const crmDept = isLBF ? 'LBF' : isCSMainland ? 'CS' : isSME ? 'SME' : null;
      const crmActualForSection = crmDept ? getCrmEmailAgentTotalForDept(crmActualRepsByMonth, crmDept, selectedMonth) : null;
      const crmActualDateForSection = crmDept ? (crmActualDateByMonth?.[crmDept]?.[selectedMonth] || null) : null;
      // LBF section: use MTD total Active Reps and Active/Actual summary lines
      if (isLBF && lbfMTDTotalActiveReps != null) {
        summaryData = {
          ...summaryData,
          activeReps: lbfMTDTotalActiveReps,
          activeRepsFormatted: formatTZS(lbfMTDTotalActiveReps)
        };
        if (lbfActiveActualTotals) {
          const { activeTarget, activeAchieved, actualTarget, actualAchieved } = lbfActiveActualTotals;
          const activePct = activeTarget > 0 ? ((activeAchieved / activeTarget) * 100).toFixed(1) : '0';
          const actualPct = actualTarget > 0 ? ((actualAchieved / actualTarget) * 100).toFixed(1) : '0';
          summaryData = {
            ...summaryData,
            activeTarget,
            activeAchieved,
            actualTarget,
            actualAchieved,
            activePct,
            actualPct
          };
        }
      }
      // CS Mainland: add Active/Actual summary lines when we have MTD totals
      if (isCSMainland && csActiveActualTotals) {
        const { activeTarget, activeAchieved, actualTarget, actualAchieved } = csActiveActualTotals;
        const activePct = activeTarget > 0 ? ((activeAchieved / activeTarget) * 100).toFixed(1) : '0';
        const actualPct = actualTarget > 0 ? ((actualAchieved / actualTarget) * 100).toFixed(1) : '0';
        summaryData = {
          ...summaryData,
          activeTarget,
          activeAchieved,
          actualTarget,
          actualAchieved,
          activePct,
          actualPct
        };
      }
      if (isCSMainland && csMTDTotalActiveReps != null) {
        summaryData = {
          ...summaryData,
          activeReps: csMTDTotalActiveReps,
          activeRepsFormatted: formatTZS(csMTDTotalActiveReps)
        };
      }
      // SME section: use MTD total Active Reps and Active/Actual summary lines (same as LBF/CS Mainland)
      if (isSME && smeMTDTotalActiveReps != null) {
        summaryData = {
          ...summaryData,
          activeReps: smeMTDTotalActiveReps,
          activeRepsFormatted: formatTZS(smeMTDTotalActiveReps)
        };
        if (smeActiveActualTotals) {
          const { activeTarget, activeAchieved, actualTarget, actualAchieved } = smeActiveActualTotals;
          const activePct = activeTarget > 0 ? ((activeAchieved / activeTarget) * 100).toFixed(1) : '0';
          const actualPct = actualTarget > 0 ? ((actualAchieved / actualTarget) * 100).toFixed(1) : '0';
          summaryData = {
            ...summaryData,
            activeTarget,
            activeAchieved,
            actualTarget,
            actualAchieved,
            activePct,
            actualPct
          };
        }
      }
      if (crmActualForSection != null && crmDept) {
        summaryData = {
          ...summaryData,
          crmActualRepsTotal: crmActualForSection,
          crmActualRepsDate: crmActualDateForSection || summaryData.monthLabel
        };
      }
      if (sectionComparisonData) {
        const prevMoM =
          isLBF ? lbfMTDPrevTotalActiveReps : isCSMainland ? csMTDPrevTotalActiveReps : isSME ? smeMTDPrevTotalActiveReps : null;
        const prevYoY =
          isLBF ? lbfMTDYoYTotalActiveReps : isCSMainland ? csMTDYoYTotalActiveReps : isSME ? smeMTDYoYTotalActiveReps : null;
        const patchMoM = (block) => {
          if (!block) return block;
          if (mtdActiveForSection == null || !Number.isFinite(Number(mtdActiveForSection))) {
            return { ...block, activeReps: null };
          }
          return {
            ...block,
            activeReps: comparisonMetricActiveMtdOnly(mtdActiveForSection, prevMoM)
          };
        };
        const patchYoY = (block) => {
          if (!block) return block;
          if (mtdActiveForSection == null || !Number.isFinite(Number(mtdActiveForSection))) {
            return { ...block, activeReps: null };
          }
          return {
            ...block,
            activeReps: comparisonMetricActiveMtdOnly(mtdActiveForSection, prevYoY)
          };
        };
        sectionComparisonData = {
          ...sectionComparisonData,
          lastMonth: patchMoM(sectionComparisonData.lastMonth),
          lastYear: patchYoY(sectionComparisonData.lastYear)
        };
      }
      return {
        section,
        sectionData,
        summaryData,
        comparisonData: sectionComparisonData,
        monthlyTrendData: monthlyTrend,
        trendExplanation: getTrendExplanation(monthlyTrend),
        productContributionData: getProductContributionForSection(parsedReports, selectedMonth, section),
        newBusinessTrend: getNewBusinessTrendData(sectionData),
        repeatBusinessTrend: getRepeatBusinessTrendData(sectionData),
        newBusinessComparison: getNewBusinessComparison(sectionData, selectedMonth),
        repeatBusinessComparison: getRepeatBusinessComparison(sectionData, selectedMonth),
        supervisionData: isLBF ? lbfSupervisionData : isCSMainland ? csSupervisionData : isSME ? smeSupervisionData : null
      };
    });
  }, [
    parsedReports,
    selectedMonth,
    lbfMTDTotalActiveReps,
    csMTDTotalActiveReps,
    lbfMTDPrevTotalActiveReps,
    csMTDPrevTotalActiveReps,
    smeMTDPrevTotalActiveReps,
    lbfMTDYoYTotalActiveReps,
    csMTDYoYTotalActiveReps,
    smeMTDYoYTotalActiveReps,
    lbfSupervisionData,
    csSupervisionData,
    smeSupervisionData,
    lbfActiveActualTotals,
    csActiveActualTotals,
    smeMTDTotalActiveReps,
    smeActiveActualTotals,
    crmActualRepsByMonth,
    crmActualDateByMonth
  ]);

  const handleDownloadPPTX = async () => {
    setGeneratingPPTX(true);
    try {
      const logoBase64 = await getLogoAsBase64().catch(() => null);
      await generateSalesReviewPPTX(
        { 
          countrywiseData, 
          monthlyTrendData, 
          trendExplanation, 
          summaryData, 
          comparisonData, 
          productContributionData, 
          newBusinessTrend,
          repeatBusinessTrend,
          newBusinessComparison,
          repeatBusinessComparison,
          sectionsData 
        },
        selectedMonth,
        userData,
        logoBase64
      );
    } catch (err) {
      console.error(err);
      alert('Failed to generate PowerPoint.');
    } finally {
      setGeneratingPPTX(false);
    }
  };

  if (loading) {
    return (
      <div className="sales-review-loading">
        <LoadingSpinner size="large" />
        <p>Loading management data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sales-review-error">
        <div className="error-icon">⚠️</div>
        <h3>Error Loading Data</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="sales-review-container">
      <div className="sales-review-header-bar">
        <h1 className="sales-review-header-title">MONTHLY SALES REVIEW FOR {monthLabel.toUpperCase()}</h1>
        <div className="sales-review-header-controls">
          <input
            type="month"
            className="sales-review-date-input"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          />
          <button
            type="button"
            className="sales-review-download-btn sales-review-download-btn--email"
            onClick={() => setShowEmailModal(true)}
            disabled={loading}
            title="Send report by email"
          >
            <span className="sales-review-btn-icon">✉</span>
            <span className="sales-review-btn-label">Send Email</span>
          </button>
          <button
            type="button"
            className="sales-review-download-btn sales-review-download-btn--pptx"
            onClick={handleDownloadPPTX}
            disabled={generatingPPTX}
            title="Download PowerPoint"
          >
            {generatingPPTX ? (
              <span className="sales-review-btn-spinner" aria-hidden>⏳</span>
            ) : (
              <svg className="sales-review-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
            <span className="sales-review-btn-label">PPTX</span>
          </button>
        </div>
      </div>
      <div className="sales-review-header-line" aria-hidden="true" />

      <div className="sales-review-preview-wrapper">
        <div className="sales-review-preview-inner" ref={reportContainerRef}>
          {/* Page 1: Cover - white, logo (blue), blue line, blue text */}
          <div className="report-page report-page--cover">
            <div className="report-cover-logo-wrap">
              <img src={LOGO_SRC} alt="PCL" className="report-cover-logo" />
            </div>
            <div className="report-cover-line" />
            <div className="report-cover-title-wrap">
              <h2 className="report-cover-title">SALES REVIEW</h2>
              <p className="report-cover-subtitle">
                <strong className="report-data-value">{monthLabel}</strong>
              </p>
            </div>
            <div className="report-page-bottom-line" />
          </div>

          {/* Page 2: Table of Contents */}
          <div className="report-page report-page--toc">
            <div className="report-toc-header">
              <h2 className="report-toc-title">Table of Contents</h2>
              <img src={LOGO_SRC} alt="PCL" className="report-toc-logo" />
            </div>
            <div className="report-toc-line" />
            <ol className="report-toc-list">
              <li>GENERAL PERFORMANCE HIGHLIGHTS</li>
              <li>
                CS PRODUCT PERFORMANCE HIGHLIGHTS
                <ol type="i" className="report-toc-sublist">
                  <li>CS MAINLAND PERFORMANCE HIGHLIGHTS</li>
                  <li>CS ZANZIBAR PERFORMANCE HIGHLIGHTS</li>
                </ol>
              </li>
              <li>
                LBF PRODUCT PERFORMANCE HIGHLIGHTS
                <ol type="i" className="report-toc-sublist">
                  <li>IPF PRODUCT PERFORMANCE HIGHLIGHTS</li>
                  <li>QUICK CASH PERFORMANCE HIGHLIGHTS</li>
                  <li>MIF (SHORT TERM & LONG TERM) PERFORMANCE HIGHLIGHTS</li>
                  <li>MIF CUSTOMS PERFORMANCE HIGHLIGHTS</li>
                  <li>YARD FINANCE PERFORMANCE HIGHLIGHTS</li>
                </ol>
              </li>
              <li>SME PERFORMANCE HIGHLIGHTS</li>
              <li>AGRIFINANCE PERFORMANCE HIGHLIGHT</li>
            </ol>
            <div className="report-page-bottom-line" />
          </div>

          {/* Page 3: General Performance Highlights - centered title, large logo only */}
          <div className="report-page report-page--content report-page--general">
            <div className="report-general-center">
              <img src={LOGO_SRC} alt="PCL" className="report-general-logo" />
              <h2 className="report-general-title">1. GENERAL PERFORMANCE HIGHLIGHTS</h2>
            </div>
            <div className="report-page-bottom-line" />
          </div>

          {/* Page 4: General Sales Trend - header, chart, explanation */}
          <div className="report-page report-page--trend">
            <div className="report-trend-header">
              <h2 className="report-trend-title">GENERAL SALES TREND</h2>
              <img src={LOGO_SRC} alt="PCL" className="report-trend-logo" />
            </div>
            <div className="report-trend-line" />
            <div className="report-trend-chart-area">
              <GeneralSalesTrendChart monthlyData={monthlyTrendData} />
            </div>
            <div className="report-trend-explanation">
              <TrendExplanationText text={trendExplanation} />
            </div>
            <div className="report-page-bottom-line" />
          </div>

          {/* Page 5: Sales and Performance Summary */}
          <SalesAndPerformanceSummary
            summaryData={summaryData}
            monthLabel={monthLabel}
            logoSrc={LOGO_SRC}
          />

          {/* Page 6: Performance Comparison */}
          <PerformanceComparison comparisonData={comparisonData} logoSrc={LOGO_SRC} />

          {/* Page 7: New Business Sales Performance */}
          <NewBusinessPerformance
            comparisonData={newBusinessComparison}
            trendData={newBusinessTrend}
            logoSrc={LOGO_SRC}
          />

          {/* Page 8: Repeat Business Sales Performance */}
          <RepeatBusinessPerformance
            comparisonData={repeatBusinessComparison}
            trendData={repeatBusinessTrend}
            logoSrc={LOGO_SRC}
          />

          {/* Page 9: Per Product Contribution */}
          <PerProductContribution productData={productContributionData} logoSrc={LOGO_SRC} />

          {/* Product sections (CS, LBF, IPF, SME, AgriFinance, etc.) - same flow per section */}
          {sectionsData.map(({ section, summaryData: sSummary, comparisonData: sComparison, monthlyTrendData: sTrend, trendExplanation: sExplanation, productContributionData: sProduct, newBusinessTrend: sNewTrend, repeatBusinessTrend: sRepeatTrend, newBusinessComparison: sNewComp, repeatBusinessComparison: sRepeatComp, supervisionData: sSupervision }) => (
            <ProductPerformanceBlock
              key={section.id}
              section={section}
              summaryData={sSummary}
              comparisonData={sComparison}
              monthlyTrendData={sTrend}
              trendExplanation={sExplanation}
              productContributionData={sProduct}
              newBusinessComparison={sNewComp}
              newBusinessTrend={sNewTrend}
              repeatBusinessComparison={sRepeatComp}
              repeatBusinessTrend={sRepeatTrend}
              supervisionData={sSupervision}
              monthLabel={monthLabel}
              logoSrc={LOGO_SRC}
            />
          ))}

          {/* Thank you page */}
          <div className="report-page report-page--thank-you">
            <div className="report-thank-you-content">
              <div className="report-thank-you-line" />
              <h2 className="report-thank-you-title">Thank You</h2>
              <p className="report-thank-you-subtitle">Thank you for your attention.</p>
              <div className="report-thank-you-line report-thank-you-line-bottom" />
              {LOGO_SRC && <img src={LOGO_SRC} alt="PCL" className="report-thank-you-logo" />}
            </div>
            <div className="report-page-bottom-line" />
          </div>
        </div>
      </div>

      {/* Email modal */}
      {showEmailModal && (
        <div className="sales-review-modal-overlay" onClick={() => { if (!sending) { setShowEmailModal(false); setSendProgress(null); } }}>
          <div className="sales-review-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="sales-review-modal-header">
              <h3 className="sales-review-modal-title">Send Monthly Sales Review by Email</h3>
              <button
                className="sales-review-modal-close"
                onClick={() => { if (!sending) { setShowEmailModal(false); setShowPreview(false); setSendProgress(null); } }}
                disabled={sending}
              >
                ✕
              </button>
            </div>

            {/* Progress popup: sticky banner when sending or when result is shown */}
            {(sending || (sendProgress && sendProgress.length > 0)) && (
              <div className="sales-review-progress-popup">
                {sendPhase === 'preparing' && (
                  <div className="sales-review-progress-popup-inner sales-review-progress-popup--preparing">
                    <span className="sales-review-send-progress-spinner" aria-hidden>⏳</span>
                    <span>Preparing attachment…</span>
                  </div>
                )}
                {sendProgress && sendProgress.length > 0 && (sendPhase === 'sending' || !sending) && (
                  <div className="sales-review-progress-popup-inner">
                    <h4 className="sales-review-send-progress-title">
                      {sending ? 'Sending email to all recipients…' : 'Send result'}
                    </h4>
                    <ul className="sales-review-send-progress-list">
                      {sendProgress.map(({ email, status, error }) => (
                        <li key={email} className={`sales-review-send-progress-item sales-review-send-progress-item--${status}`}>
                          <span className="sales-review-send-progress-email">{email}</span>
                          <span className="sales-review-send-progress-status">
                            {status === 'sending' && <span className="sales-review-send-progress-spinner" aria-hidden>⏳</span>}
                            {status === 'success' && <span className="sales-review-send-progress-ok" title="Received">✓</span>}
                            {status === 'failed' && <span className="sales-review-send-progress-fail" title={error || 'Failed'}>✗</span>}
                          </span>
                          {status === 'failed' && error && (
                            <span className="sales-review-send-progress-error">{error}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="sales-review-modal-body">
              {/* Recipients input */}
              <div className="sales-review-input-group">
                <label>Add Recipients:</label>
                <div className="sales-review-input-row">
                  <input
                    type="email"
                    placeholder="Enter email address"
                    value={newRecipient}
                    onChange={(e) => setNewRecipient(e.target.value)}
                    onKeyPress={(e) => { if (e.key === 'Enter') addRecipient(); }}
                    disabled={sending}
                  />
                  <button
                    className="sales-review-add-btn"
                    onClick={addRecipient}
                    disabled={sending}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Copy actions: list + message (always show so message can be copied without recipients) */}
              <div className="sales-review-recipient-list-actions">
                <button
                  type="button"
                  className="sales-review-copy-list-btn"
                  onClick={copyRecipientList}
                  disabled={sending || recipients.length === 0}
                  title="Copy all emails (one per line) to paste manually"
                >
                  {copiedList ? '✓ Copied!' : 'Copy email list'}
                </button>
                <button
                  type="button"
                  className="sales-review-copy-list-btn sales-review-copy-body-btn"
                  onClick={copyMessageBody}
                  disabled={sending}
                  title="Copy email message (plain text) to paste into your email"
                >
                  {copiedBody ? '✓ Copied!' : 'Copy message'}
                </button>
              </div>

              {/* Recipients list */}
              {recipients.length > 0 && (
                <ul className="sales-review-recipient-list">
                    {recipients.map((email) => (
                      <li key={email} className="sales-review-recipient-item">
                        <span className="sales-review-recipient-email">{email}</span>
                        <button
                          className="sales-review-recipient-remove"
                          onClick={() => removeRecipient(email)}
                          disabled={sending}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
              )}

              {/* Email Preview Section */}
              <div className="sales-review-preview-section">
                <button
                  className="sales-review-preview-toggle"
                  onClick={generatePreview}
                  disabled={sending}
                >
                  {showPreview ? '▼ Hide Email Preview' : '▶ Preview Email'}
                </button>
                {showPreview && (
                  <div className="sales-review-preview-content">
                    <div className="sales-review-preview-field">
                      <label>Subject:</label>
                      <input
                        type="text"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        disabled={sending}
                      />
                    </div>
                    <div className="sales-review-preview-field">
                      <label>Email Body:</label>
                      <div
                        className="sales-review-preview-html"
                        dangerouslySetInnerHTML={{ __html: emailBody }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Error display */}
              {sendError && (
                <div className="sales-review-error-msg">{sendError}</div>
              )}
            </div>

            <div className="sales-review-modal-footer">
              <button
                className="sales-review-modal-cancel"
                onClick={() => { if (!sending) { setShowEmailModal(false); setShowPreview(false); setSendProgress(null); } }}
                disabled={sending}
              >
                {sendProgress && !sending ? 'Close' : 'Cancel'}
              </button>
              <button
                className="sales-review-modal-send"
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

export default SalesReviewReport;
