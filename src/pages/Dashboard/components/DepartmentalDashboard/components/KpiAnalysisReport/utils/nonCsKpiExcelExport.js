/**
 * Excel workbook structure for generic (LBF/SME) KPI reports — shared until product-specific layouts diverge.
 */
import { formatPercentAccounting } from './csKpiTargets';
import { aggregateCrmConsentDailyRows, aggregateCrmUsageDailyRows } from './kpiAppendixAggregates';

export function buildNonCsReportSheetsAndFile({
  product,
  nonCsSummaryRows,
  effectiveMonthKey,
  monthKeyToLabel,
  formatTzs,
  /** SME (optional): daily CRM rows for consent / usage appendix */
  crmDailyRows
}) {
  const monthLabel = monthKeyToLabel(effectiveMonthKey);

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
    title: `KPI Summary - ${monthLabel}`,
    data: summaryRows,
    totalRowIndices: summaryRows.length > 0 ? [summaryRows.length - 1] : [],
    rowFillColors: [
      ...nonCsSummaryRows.map((r) => colorForPct(r.pct)),
      ...(summaryRows.length > nonCsSummaryRows.length ? ['#E8EAF6'] : [])
    ]
  };

  const sectionNameForKpi = (kpi) => {
    const l = String(kpi || '').toLowerCase();
    if (product === 'SME') {
      if (l.includes('achievement') && l.includes('monthly target')) return 'Monthly target 100pct';
      if (l.includes('loan count')) return 'Loan counts';
      if (l.includes('par 30')) return 'PAR 30 at 3pct';
      if (l.includes('data collected') && l.includes('consent')) return 'Data consent 65pct';
      if (l.includes('login') && l.includes('usage')) return 'CRM login usage 95pct';
      if (l.includes('actual') && l.includes('rep') && l.includes('required')) return 'Actual reps 100pct';
      if (l.includes('loan officer') && l.includes('90')) return 'Active vs LO 90pct';
    }
    if (l.includes('sales target')) return 'Sales Target Achieve';
    if (l.includes('branches') && l.includes('sales target')) return 'Branch Sales Achieve';
    if (l.includes('new business')) return 'Mainland 65% New Biz';
    if (l.includes('reactivation')) return 'Reactivation 25%';
    if (l.includes('repeat business')) return 'Repeat Business 10%';
    if (l.includes('loan counts')) return 'Loan Counts';
    if (l.includes('portfolio') || l.includes('portifolio')) return 'Portfolio Growth';
    if (l.includes('par 30')) return 'PAR 30 Below 5%';
    if (l.includes('active client base')) return 'Growth of active client base 20';
    if (l.includes('regions') || l.includes('cluster')) return 'Ensure all Regions and Clusters';
    if (l.includes('proper usage of crm') || l.includes('login')) return '90% proper usage of CRM';
    if (l.includes('data consent')) return '65% achieved of Data consent fr';
    return (String(kpi || 'KPI').slice(0, 28) || 'KPI Detail');
  };

  const consentRowsRaw = (crmDailyRows || []).map((r) => {
    const tl = r.totalLeads || 0;
    const share = (n) =>
      tl > 0 ? `${formatTzs(n)} (${formatPercentAccounting((n / tl) * 100)})` : `${formatTzs(n)} (${formatPercentAccounting(0)})`;
    return {
      Date: r.date,
      'Total Leads': tl,
      'Rejected Leads': share(r.rejected || 0),
      'Not Provided Leads': share(r.notProvided || 0),
      'Consented Leads': `${formatTzs(r.consented || 0)} (${formatPercentAccounting(tl > 0 ? ((r.consented || 0) / tl) * 100 : 0)})`
    };
  });

  const consentAgg = aggregateCrmConsentDailyRows(crmDailyRows);
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

  const consentCrmTable = {
    title: `Data consent — per CRM report — ${monthLabel}`,
    data: consentRows.length ? consentRows : [{ Date: '—', 'Total Leads': '—', 'Rejected Leads': '—', 'Not Provided Leads': '—', 'Consented Leads': '—' }],
    headerColors: { Date: '#4472C4', 'Total Leads': '#70AD47', 'Rejected Leads': '#ED7D31', 'Not Provided Leads': '#ED7D31', 'Consented Leads': '#70AD47' },
    colWidths: [12, 12, 22, 22, 22],
    totalRowIndices: consentTotalIdx,
    accountingColumns: ['Total Leads']
  };

  const usageRowsRaw = (crmDailyRows || []).map((r) => {
    const tw = r.totalWorkforce || 0;
    const li = r.loggedIn || 0;
    return {
      Date: r.date,
      'Total workforce (TL + agents)': tw,
      'Logged in workforce': li,
      '% Logged in': tw > 0 ? (li / tw) * 100 : 0
    };
  });

  const usageAgg = aggregateCrmUsageDailyRows(crmDailyRows);
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

  const usageCrmTable = {
    title: `CRM login usage — daily CRM reports — ${monthLabel}`,
    data: usageRows.length ? usageRows : [{ Date: '—', 'Total workforce (TL + agents)': '—', 'Logged in workforce': '—', '% Logged in': '—' }],
    headerColors: { Date: '#4472C4', 'Total workforce (TL + agents)': '#70AD47', 'Logged in workforce': '#70AD47', '% Logged in': '#5B9BD5' },
    colWidths: [12, 24, 20, 14],
    totalRowIndices: usageTotalIdx,
    accountingColumns: ['Total workforce (TL + agents)', 'Logged in workforce']
  };

  const buildKpiRowTable = (row) => {
    const sheetTitle = sectionNameForKpi(row.kpi);
    return {
      title: `${sheetTitle} — ${monthLabel}`,
      data: [{
        KPI: row.kpi,
        Target: typeof row.target === 'number' ? formatTzs(row.target) : row.target,
        Achieved: row.achievedDisplay,
        '% Achieved': row.pct != null ? formatPercentAccounting(row.pct) : '—',
        'Weight (%)': formatPercentAccounting((row.weight || 0) * 100),
        'Weight Scored (%)': formatPercentAccounting((row.weightScored || 0) * 100),
        '% Weight Scored': formatPercentAccounting(row.pctWeightScored || 0)
      }],
      rowFillColors: [colorForPct(row.pct)]
    };
  };

  const buildSmeBreakdownTable = (row) => {
    const b = row.smeBreakdown;
    if (!b?.rows?.length) return null;
    const rows = b.rows.map((x) => ({ Metric: x.metric, Value: x.value }));
    if (row.pct != null && Number.isFinite(row.pct)) {
      rows.push({
        Metric: 'Overall — % Achieved (this KPI)',
        Value: formatPercentAccounting(row.pct)
      });
    }
    const totalIdx = rows.length > b.rows.length ? [rows.length - 1] : [];
    return {
      title: `${b.title} — ${monthLabel}`,
      data: rows,
      headerColors: { Metric: '#4472C4', Value: '#70AD47' },
      colWidths: [48, 28],
      totalRowIndices: totalIdx
    };
  };

  const darkSep = { darkSeparator: true };

  const allInOneTables = [summaryTable, darkSep];
  nonCsSummaryRows.forEach((row) => {
    allInOneTables.push(buildKpiRowTable(row));
    const br = buildSmeBreakdownTable(row);
    if (br) allInOneTables.push(br);
    if (product === 'SME' && row.sectionKey === 'sme_consent_65' && (crmDailyRows || []).length) {
      allInOneTables.push(consentCrmTable);
    }
    if (product === 'SME' && row.sectionKey === 'sme_crm_95' && (crmDailyRows || []).length) {
      allInOneTables.push(usageCrmTable);
    }
    allInOneTables.push(darkSep);
  });

  const seenTabNames = new Set(['All in One', 'KPI Summary']);
  const safeSheetTabName = (base) => {
    let n = String(base || 'KPI').replace(/[\\/?*[\]]/g, '').slice(0, 31) || 'KPI';
    let candidate = n;
    let i = 0;
    while (seenTabNames.has(candidate)) {
      i += 1;
      const suffix = `_${i}`;
      candidate = `${n.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    }
    seenTabNames.add(candidate);
    return candidate;
  };

  const detailSheets = nonCsSummaryRows.map((row) => {
    const tables = [buildKpiRowTable(row)];
    const br = buildSmeBreakdownTable(row);
    if (br) tables.push(br);
    if (product === 'SME' && row.sectionKey === 'sme_consent_65' && (crmDailyRows || []).length) {
      tables.push(consentCrmTable);
    }
    if (product === 'SME' && row.sectionKey === 'sme_crm_95' && (crmDailyRows || []).length) {
      tables.push(usageCrmTable);
    }
    const tabName = safeSheetTabName(sectionNameForKpi(row.kpi));
    return { name: tabName, tables };
  });

  const sheets = [
    { name: 'All in One', tables: allInOneTables },
    { name: 'KPI Summary', tables: [summaryTable] },
    ...detailSheets
  ];
  const fileName = `${product}_KPI_REPORT_${String(monthLabel).replace(/\s+/g, '_')}.xlsx`;
  return { sheets, fileName };
}
