import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMTDData } from '../../../../MTDdashboard/hooks/useMTDData';
import { useCRMData } from '../../../../CRMdashboard/hooks/useCRMData';
import { buildNonCsSummaryRows } from '../utils/nonCsKpiRowBuilder';
import { buildNonCsReportSheetsAndFile as buildNonCsSheets } from '../utils/nonCsKpiExcelExport';
import { getCrmEmailMetrics } from '../utils/crmMetricsFromReport';

/**
 * SME KPI analysis: MTD + CRM (Email sheet metrics), monthly CRM rollup for consent/usage like LBF.
 */
export function useSmeKpiAnalysis({
  targets,
  effectiveMonthKey,
  latestManagementReport,
  previousMonthManagementReport,
  toMonthKey,
  monthKeyToLabel,
  normalizeParToPercentage,
  formatTzs
}) {
  const [smeCrmDailyRows, setSmeCrmDailyRows] = useState([]);

  const { parsedData: mtdParsedDataSME } = useMTDData('SME', effectiveMonthKey || undefined);
  const { reports: crmReportsSME } = useCRMData('SME');

  const crmDateForMonthSME = useMemo(() => {
    if (!crmReportsSME?.length || !effectiveMonthKey) return null;
    const inMonth = crmReportsSME.filter((r) => toMonthKey(r.date) === effectiveMonthKey);
    if (!inMonth.length) return null;
    const sorted = [...inMonth].sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
    return sorted[0]?.date ?? null;
  }, [crmReportsSME, effectiveMonthKey, toMonthKey]);

  const { parsedData: crmParsedDataForMonthSME } = useCRMData('SME', crmDateForMonthSME ?? undefined);

  const crmReportsInMonthSME = useMemo(() => {
    if (!crmReportsSME?.length || !effectiveMonthKey) return [];
    return crmReportsSME
      .filter((r) => toMonthKey(r.date) === effectiveMonthKey)
      .sort((a, b) => new Date(a.date || a.createdAt) - new Date(b.date || b.createdAt));
  }, [crmReportsSME, effectiveMonthKey, toMonthKey]);

  useEffect(() => {
    if (!crmReportsInMonthSME.length) {
      setSmeCrmDailyRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const out = [];
      for (const report of crmReportsInMonthSME) {
        if (cancelled) return;
        try {
          const { metrics, date } = await getCrmEmailMetrics(report, 'SME');
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
      if (!cancelled) setSmeCrmDailyRows(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [crmReportsInMonthSME]);

  const { aggregatedCrmConsentPct, aggregatedCrmUsagePct } = useMemo(() => {
    let tl = 0;
    let tc = 0;
    let twf = 0;
    let tlog = 0;
    for (const r of smeCrmDailyRows) {
      tl += r.totalLeads || 0;
      tc += r.consented || 0;
      twf += r.totalWorkforce || 0;
      tlog += r.loggedIn || 0;
    }
    return {
      aggregatedCrmConsentPct: tl > 0 ? (tc / tl) * 100 : null,
      aggregatedCrmUsagePct: twf > 0 ? (tlog / twf) * 100 : null
    };
  }, [smeCrmDailyRows]);

  const nonCsSummaryRows = useMemo(() => {
    const rows = buildNonCsSummaryRows({
      product: 'SME',
      targets,
      effectiveMonthKey,
      latestManagementReport,
      previousMonthManagementReport,
      crmParsed: crmParsedDataForMonthSME,
      mtdParsed: mtdParsedDataSME,
      branchSummaryData: null,
      normalizeParToPercentage,
      formatTzs,
      aggregatedCrmConsentPct,
      aggregatedCrmUsagePct
    });
    return [...rows].sort((a, b) => (b.pctWeightScored ?? 0) - (a.pctWeightScored ?? 0));
  }, [targets, effectiveMonthKey, latestManagementReport, previousMonthManagementReport, crmParsedDataForMonthSME, mtdParsedDataSME, normalizeParToPercentage, formatTzs, aggregatedCrmConsentPct, aggregatedCrmUsagePct]);

  const buildNonCsReportSheetsAndFile = useCallback(
    () => buildNonCsSheets({
      product: 'SME',
      nonCsSummaryRows,
      effectiveMonthKey,
      monthKeyToLabel,
      formatTzs,
      crmDailyRows: smeCrmDailyRows
    }),
    [nonCsSummaryRows, effectiveMonthKey, monthKeyToLabel, formatTzs, smeCrmDailyRows]
  );

  return {
    nonCsSummaryRows,
    buildNonCsReportSheetsAndFile,
    lbfBranchSummaryData: null,
    lbfCrmDailyRows: smeCrmDailyRows,
    sortedBranchesByPct: []
  };
}
