/**
 * LBF KPI workbook: summary sorted by % weight scored, per-KPI detail, branch and CRM tables.
 */
import { formatPercentAccounting } from './csKpiTargets';
import {
  aggregateBranchDisbursementRows,
  aggregateCrmConsentDailyRows,
  aggregateCrmUsageDailyRows
} from './kpiAppendixAggregates';

export function buildLbfKpiReportSheetsAndFile({
  nonCsSummaryRows,
  effectiveMonthKey,
  monthKeyToLabel,
  formatTzs,
  sortedBranchesByPct,
  lbfCrmDailyRows
}) {
  const monthLabel = monthKeyToLabel(effectiveMonthKey);
  const product = 'LBF';

  const colorForPct = (pct) => {
    if (!Number.isFinite(pct)) return null;
    if (pct <= 0) return '#FF6B6B';
    if (pct < 50) return '#FFA94D';
    return '#69DB7C';
  };

  const summaryRows = nonCsSummaryRows.map((r) => ({
    KPI: r.kpi,
    Target: typeof r.target === 'number' ? formatTzs(r.target) : r.target,
    Achieved: r.achievedDisplay,
    '% Achieved': r.pct != null ? formatPercentAccounting(r.pct) : '—',
    'Weight (%)': formatPercentAccounting((r.weight || 0) * 100),
    'Weight Scored (%)': formatPercentAccounting((r.weightScored || 0) * 100),
    '% Weight Scored': formatPercentAccounting(r.pctWeightScored || 0)
  }));
  const totalW = nonCsSummaryRows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const totalWs = nonCsSummaryRows.reduce((s, r) => s + (Number(r.weightScored) || 0), 0);
  const totalPctWs = totalW > 0 ? (totalWs / totalW) * 100 : 0;
  if (summaryRows.length > 0) {
    summaryRows.push({
      __totalRow: true,
      KPI: 'Total',
      Target: '',
      Achieved: '',
      '% Achieved': '',
      'Weight (%)': formatPercentAccounting(totalW * 100),
      'Weight Scored (%)': formatPercentAccounting(totalWs * 100),
      '% Weight Scored': formatPercentAccounting(totalPctWs)
    });
  }

  const summaryTable = {
    title: `KPI Summary - ${monthLabel} (sorted by % Weight Scored)`,
    data: summaryRows,
    totalRowIndices: summaryRows.length > 0 ? [summaryRows.length - 1] : [],
    rowFillColors: [
      ...nonCsSummaryRows.map((r) => colorForPct(r.pct)),
      ...(summaryRows.length > nonCsSummaryRows.length ? ['#E8EAF6'] : [])
    ]
  };

  const branches = sortedBranchesByPct || [];
  const branchTableData = branches.map((b) => ({
    Branch: b.branch,
    Target: b.target,
    'Disbursement this Month': b.disbursement,
    '% Achieved': Number.isFinite(b.pct) ? b.pct : ''
  }));
  const branchAgg = aggregateBranchDisbursementRows(branches);
  if (branchTableData.length && branchAgg && branchAgg.totalTarget > 0 && Number.isFinite(branchAgg.pct)) {
    branchTableData.push({
      __totalRow: true,
      Branch: 'Total / Average',
      Target: branchAgg.totalTarget,
      'Disbursement this Month': branchAgg.totalDisbursement,
      '% Achieved': branchAgg.pct
    });
  }

  const branchTableBlock = {
    title: `Branches — Target vs Disbursement (sorted by % achieved) — ${monthLabel}`,
    data: branchTableData.length ? branchTableData : [{ Branch: '—', Target: '—', 'Disbursement this Month': '—', '% Achieved': '—' }],
    headerColors: { Branch: '#1e3a5f', Target: '#c45a11', 'Disbursement this Month': '#2d6a2d', '% Achieved': '#2d6a2d' },
    colWidths: [28, 16, 22, 12],
    rowFillColors: [
      ...branches.map((b) => colorForPct(b.pct)),
      ...(branchTableData.length > branches.length && branchAgg ? [colorForPct(branchAgg.pct)] : [])
    ],
    totalRowIndices: branchAgg && branchTableData.length > branches.length ? [branchTableData.length - 1] : [],
    accountingColumns: ['Target', 'Disbursement this Month']
  };

  const consentRowsRaw = (lbfCrmDailyRows || []).map((r) => {
    const tl = r.totalLeads || 0;
    const share = (n) => (tl > 0 ? `${formatTzs(n)} (${formatPercentAccounting((n / tl) * 100)})` : `${formatTzs(n)} (${formatPercentAccounting(0)})`);
    return {
      Date: r.date,
      'Total Leads': tl,
      'Rejected Leads': share(r.rejected || 0),
      'Not Provided Leads': share(r.notProvided || 0),
      'Consented Leads': `${formatTzs(r.consented || 0)} (${formatPercentAccounting(tl > 0 ? ((r.consented || 0) / tl) * 100 : 0)})`
    };
  });
  const consentAgg = aggregateCrmConsentDailyRows(lbfCrmDailyRows);
  const consentRows = [...consentRowsRaw];
  const consentTotalIdx = [];
  if (consentRowsRaw.length && consentAgg) {
    consentRows.push({
      __totalRow: true,
      Date: 'Total / Average',
      'Total Leads': consentAgg.totalLeads,
      'Rejected Leads': `${formatTzs(consentAgg.rejected)} (${formatPercentAccounting(consentAgg.pctRejected)})`,
      'Not Provided Leads': `${formatTzs(consentAgg.notProvided)} (${formatPercentAccounting(consentAgg.pctNotProvided)})`,
      'Consented Leads': `${formatTzs(consentAgg.consented)} (${formatPercentAccounting(consentAgg.pctConsented)})`
    });
    consentTotalIdx.push(consentRows.length - 1);
  }

  const consentTable = {
    title: `Data consent — per CRM report — ${monthLabel}`,
    data: consentRows.length ? consentRows : [{ Date: '—', 'Total Leads': '—', 'Rejected Leads': '—', 'Not Provided Leads': '—', 'Consented Leads': '—' }],
    headerColors: { Date: '#4472C4', 'Total Leads': '#70AD47', 'Rejected Leads': '#ED7D31', 'Not Provided Leads': '#ED7D31', 'Consented Leads': '#70AD47' },
    colWidths: [12, 12, 22, 22, 22],
    totalRowIndices: consentTotalIdx,
    accountingColumns: ['Total Leads']
  };

  const usageRowsRaw = (lbfCrmDailyRows || []).map((r) => {
    const tw = r.totalWorkforce || 0;
    const li = r.loggedIn || 0;
    return {
      Date: r.date,
      'Total workforce (TL + agents)': tw,
      'Logged in workforce': li,
      '% Logged in': tw > 0 ? (li / tw) * 100 : 0
    };
  });
  const usageAgg = aggregateCrmUsageDailyRows(lbfCrmDailyRows);
  const usageRows = [...usageRowsRaw];
  const usageTotalIdx = [];
  if (usageRowsRaw.length && usageAgg) {
    usageRows.push({
      __totalRow: true,
      Date: 'Total / Average',
      'Total workforce (TL + agents)': usageAgg.totalWorkforce,
      'Logged in workforce': usageAgg.loggedIn,
      '% Logged in': usageAgg.pctLoggedIn
    });
    usageTotalIdx.push(usageRows.length - 1);
  }

  const usageTable = {
    title: `CRM usage — per CRM report — ${monthLabel}`,
    data: usageRows.length ? usageRows : [{ Date: '—', 'Total workforce (TL + agents)': '—', 'Logged in workforce': '—', '% Logged in': '—' }],
    headerColors: { Date: '#4472C4', 'Total workforce (TL + agents)': '#70AD47', 'Logged in workforce': '#70AD47', '% Logged in': '#5B9BD5' },
    colWidths: [12, 24, 20, 14],
    totalRowIndices: usageTotalIdx,
    accountingColumns: ['Total workforce (TL + agents)', 'Logged in workforce']
  };

  const buildKpiSummaryRowTable = (r) => ({
    title: `${r.kpi} — ${monthLabel}`,
    data: [{
      KPI: r.kpi,
      Target: typeof r.target === 'number' ? formatTzs(r.target) : r.target,
      Achieved: r.achievedDisplay,
      '% Achieved': r.pct != null ? formatPercentAccounting(r.pct) : '—',
      'Weight (%)': formatPercentAccounting((r.weight || 0) * 100),
      'Weight Scored (%)': formatPercentAccounting((r.weightScored || 0) * 100),
      '% Weight Scored': formatPercentAccounting(r.pctWeightScored || 0)
    }],
    headerColors: { KPI: '#1e3a5f', Target: '#c45a11', Achieved: '#2d6a2d', '% Achieved': '#2d6a2d', 'Weight (%)': '#1a3a6e', 'Weight Scored (%)': '#1a3a6e', '% Weight Scored': '#1a3a6e' },
    colWidths: [44, 14, 14, 12, 10, 14, 14],
    rowFillColors: [colorForPct(r.pct)]
  });

  const buildPortfolioCalcTable = (r) => {
    if (r.sectionKey !== 'portfolio_growth' || !r.lbfPortfolioDetail) return null;
    const d = r.lbfPortfolioDetail;
    return {
      title: `Portfolio calculation — ${monthLabel}`,
      data: [
        { Metric: 'Current month portfolio', Value: Number.isFinite(d.portfolioCur) ? formatTzs(d.portfolioCur) : '—' },
        { Metric: 'Previous month portfolio', Value: Number.isFinite(d.portfolioPrev) ? formatTzs(d.portfolioPrev) : '—' },
        { Metric: 'Monthly growth %', Value: Number.isFinite(d.monthlyGrowth) ? formatPercentAccounting(d.monthlyGrowth) : '—' },
        { Metric: 'Annualized growth % (vs 10% target)', Value: Number.isFinite(d.annualizedGrowth) ? formatPercentAccounting(d.annualizedGrowth) : '—' }
      ],
      headerColors: { Metric: '#4472C4', Value: '#70AD47' },
      colWidths: [40, 22]
    };
  };

  const buildLbfBreakdownTable = (r) => {
    const b = r.lbfBreakdown;
    if (!b?.rows?.length) return null;
    const rows = b.rows.map((x) => ({ Metric: x.metric, Value: x.value }));
    const totalIdx = [];
    if (r.pct != null && Number.isFinite(r.pct)) {
      rows.push({
        Metric: 'Overall — % Achieved (this KPI)',
        Value: formatPercentAccounting(r.pct)
      });
      totalIdx.push(rows.length - 1);
    }
    return {
      title: `${b.title} — ${monthLabel}`,
      data: rows,
      headerColors: { Metric: '#4472C4', Value: '#70AD47' },
      colWidths: [48, 36],
      totalRowIndices: totalIdx
    };
  };

  const darkSep = { darkSeparator: true };

  const allInOneTables = [summaryTable, darkSep];
  nonCsSummaryRows.forEach((r) => {
    allInOneTables.push(buildKpiSummaryRowTable(r));
    const br = buildLbfBreakdownTable(r);
    if (br) allInOneTables.push(br);
    const port = buildPortfolioCalcTable(r);
    if (port) allInOneTables.push(port);
    if (r.sectionKey === 'branch_90' || r.sectionKey === 'branch_cluster_100') {
      allInOneTables.push(branchTableBlock);
    }
    if (r.sectionKey === 'data_consent') {
      allInOneTables.push(consentTable);
    }
    if (r.sectionKey === 'crm_usage') {
      allInOneTables.push(usageTable);
    }
    allInOneTables.push(darkSep);
  });

  const sheets = [
    { name: 'All in One', tables: allInOneTables },
    { name: 'KPI Summary', tables: [summaryTable] },
    ...nonCsSummaryRows.map((r) => {
      const tables = [buildKpiSummaryRowTable(r)];
      const br = buildLbfBreakdownTable(r);
      if (br) tables.push(br);
      const port = buildPortfolioCalcTable(r);
      if (port) tables.push(port);
      if (r.sectionKey === 'branch_90' || r.sectionKey === 'branch_cluster_100') tables.push(branchTableBlock);
      if (r.sectionKey === 'data_consent') tables.push(consentTable);
      if (r.sectionKey === 'crm_usage') tables.push(usageTable);
      const safeName = (r.kpi || 'KPI').replace(/[\\/?*[\]]/g, '').slice(0, 28) || 'KPI';
      return { name: safeName, tables };
    })
  ];

  const fileName = `${product}_KPI_REPORT_${String(monthLabel).replace(/\s+/g, '_')}.xlsx`;
  return { sheets, fileName };
}
