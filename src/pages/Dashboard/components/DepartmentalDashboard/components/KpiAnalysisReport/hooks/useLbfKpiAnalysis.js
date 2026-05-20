import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMTDData } from '../../../../MTDdashboard/hooks/useMTDData';
import { useCRMData } from '../../../../CRMdashboard/hooks/useCRMData';
import { getReportFileUrl } from '../../../../../../../services/supabase';
import { parseManagementReportLbfBranches } from '../utils/parseManagementReportLbfBranches';
import { buildNonCsSummaryRows } from '../utils/nonCsKpiRowBuilder';
import { buildLbfKpiReportSheetsAndFile } from '../utils/lbfKpiExcelExport';
import { getCrmEmailMetrics } from '../utils/crmMetricsFromReport';

/**
 * LBF KPI analysis: MTD/CRM/management branch parsing, daily CRM rollup, sorted summary, rich Excel.
 */
export function useLbfKpiAnalysis({
  targets,
  effectiveMonthKey,
  latestManagementReport,
  previousMonthManagementReport,
  toMonthKey,
  monthKeyToLabel,
  normalizeParToPercentage,
  formatTzs
}) {
  const [lbfBranchSummaryData, setLbfBranchSummaryData] = useState(null);
  const [lbfCrmDailyRows, setLbfCrmDailyRows] = useState([]);

  const { parsedData: mtdParsedDataLBF } = useMTDData('LBF', effectiveMonthKey || undefined);
  const { reports: crmReportsLBF } = useCRMData('LBF');

  const crmDateForMonthLBF = useMemo(() => {
    if (!crmReportsLBF?.length || !effectiveMonthKey) return null;
    const inMonth = crmReportsLBF.filter((r) => toMonthKey(r.date) === effectiveMonthKey);
    return inMonth[0]?.date ?? null;
  }, [crmReportsLBF, effectiveMonthKey, toMonthKey]);

  const { parsedData: crmParsedDataForMonthLBF } = useCRMData('LBF', crmDateForMonthLBF ?? undefined);

  const crmReportsInMonthLBF = useMemo(() => {
    if (!crmReportsLBF?.length || !effectiveMonthKey) return [];
    return crmReportsLBF
      .filter((r) => toMonthKey(r.date) === effectiveMonthKey)
      .sort((a, b) => new Date(a.date || a.createdAt) - new Date(b.date || b.createdAt));
  }, [crmReportsLBF, effectiveMonthKey, toMonthKey]);

  useEffect(() => {
    if (!latestManagementReport) {
      setLbfBranchSummaryData(null);
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
          if (!cancelled) setLbfBranchSummaryData(null);
          return;
        }
        const data = await parseManagementReportLbfBranches(fileUrl);
        if (!cancelled) setLbfBranchSummaryData(data);
      } catch {
        if (!cancelled) setLbfBranchSummaryData(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latestManagementReport?.id, latestManagementReport]);

  useEffect(() => {
    if (!crmReportsInMonthLBF.length) {
      setLbfCrmDailyRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const out = [];
      for (const report of crmReportsInMonthLBF) {
        if (cancelled) return;
        try {
          const { metrics, date } = await getCrmEmailMetrics(report, 'LBF');
          const dStr = date ? new Date(date).toISOString().slice(0, 10) : '—';
          out.push({
            date: dStr,
            totalLeads: metrics.lead ?? 0,
            rejected: metrics.rejected_lead ?? 0,
            notProvided: metrics.not_provided_lead ?? 0,
            consented: metrics.accepted_lead ?? 0,
            totalWorkforce: (metrics.count_team_leaders || 0) + (metrics.total_agent || 0),
            loggedIn: (metrics.logged_in_team_leaders || 0) + (metrics.total_agent_logged_in || 0)
          });
        } catch {
          // skip bad file
        }
      }
      if (!cancelled) setLbfCrmDailyRows(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [crmReportsInMonthLBF]);

  const { lbfAggregatedConsentPct, lbfAggregatedUsagePct } = useMemo(() => {
    let tl = 0;
    let tc = 0;
    let twf = 0;
    let tlog = 0;
    for (const r of lbfCrmDailyRows) {
      tl += r.totalLeads || 0;
      tc += r.consented || 0;
      twf += r.totalWorkforce || 0;
      tlog += r.loggedIn || 0;
    }
    return {
      lbfAggregatedConsentPct: tl > 0 ? (tc / tl) * 100 : null,
      lbfAggregatedUsagePct: twf > 0 ? (tlog / twf) * 100 : null
    };
  }, [lbfCrmDailyRows]);

  const sortedBranchesByPct = useMemo(() => {
    if (!lbfBranchSummaryData?.branches?.length) return [];
    return [...lbfBranchSummaryData.branches].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  }, [lbfBranchSummaryData]);

  const nonCsSummaryRows = useMemo(() => {
    const rows = buildNonCsSummaryRows({
      product: 'LBF',
      targets,
      effectiveMonthKey,
      latestManagementReport,
      previousMonthManagementReport,
      crmParsed: crmParsedDataForMonthLBF,
      mtdParsed: mtdParsedDataLBF,
      branchSummaryData: lbfBranchSummaryData,
      normalizeParToPercentage,
      formatTzs,
      lbfAggregatedConsentPct,
      lbfAggregatedUsagePct
    });
    return [...rows].sort((a, b) => (b.pctWeightScored ?? 0) - (a.pctWeightScored ?? 0));
  }, [targets, effectiveMonthKey, latestManagementReport, previousMonthManagementReport, crmParsedDataForMonthLBF, mtdParsedDataLBF, lbfBranchSummaryData, normalizeParToPercentage, formatTzs, lbfAggregatedConsentPct, lbfAggregatedUsagePct]);

  const buildNonCsReportSheetsAndFile = useCallback(
    () => buildLbfKpiReportSheetsAndFile({
      nonCsSummaryRows,
      effectiveMonthKey,
      monthKeyToLabel,
      formatTzs,
      sortedBranchesByPct,
      lbfCrmDailyRows
    }),
    [nonCsSummaryRows, effectiveMonthKey, monthKeyToLabel, formatTzs, sortedBranchesByPct, lbfCrmDailyRows]
  );

  return {
    nonCsSummaryRows,
    buildNonCsReportSheetsAndFile,
    lbfBranchSummaryData,
    lbfCrmDailyRows,
    sortedBranchesByPct
  };
}
