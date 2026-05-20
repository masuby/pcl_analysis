import { extractMetrics } from '../../../../CRMdashboard/utils/crmUtils';
import { getMTDTotalsManagementStyle } from '../../SalesReviewReport/utils/summaryDataUtils';
import { getLbfKpiSectionKey } from './lbfKpiSectionKeys';
import { normalizeCrmMetricsForKpi } from './crmMetricsFromReport';

/**
 * Shared row builder for LBF/SME generic KPI target workbooks (KPI + TARGET sheets).
 * Pass `lbfAggregatedConsentPct` / `lbfAggregatedUsagePct` (LBF) or `aggregatedCrmConsentPct` / `aggregatedCrmUsagePct` (LBF/SME) when daily CRM rollup is available.
 */
export function buildNonCsSummaryRows({
  product,
  targets,
  effectiveMonthKey,
  latestManagementReport,
  previousMonthManagementReport,
  crmParsed,
  mtdParsed,
  branchSummaryData,
  normalizeParToPercentage,
  formatTzs,
  lbfAggregatedConsentPct,
  lbfAggregatedUsagePct,
  aggregatedCrmConsentPct,
  aggregatedCrmUsagePct
}) {
  if (!targets) return [];
  const standards = targets?.performanceStandards || [];
  const byMonth = targets?.targetsByMonth || {};
  const monthOnlyKey = effectiveMonthKey ? `0000-${effectiveMonthKey.split('-')[1]}` : null;
  const monthRow = (effectiveMonthKey && byMonth[effectiveMonthKey])
    || (monthOnlyKey && byMonth[monthOnlyKey])
    || byMonth[Object.keys(byMonth).sort((a, b) => b.localeCompare(a))[0]]
    || {};
  const cur = latestManagementReport?.[product.toLowerCase()] || {};
  const prev = previousMonthManagementReport?.[product.toLowerCase()] || {};
  const mtdTotals = getMTDTotalsManagementStyle(mtdParsed);

  const num = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (v == null || v === '') return NaN;
    const n = parseFloat(String(v).replace(/,/g, '').replace(/%/g, ''));
    return Number.isFinite(n) ? n : NaN;
  };
  const pick = (obj, keys) => {
    for (const k of keys) {
      const n = num(obj?.[k]);
      if (Number.isFinite(n)) return n;
    }
    return NaN;
  };

  // LBF Country sheet: "Reactivation" column (management report `lbf` aggregate)
  const reactivationKeys = product === 'LBF'
    ? ['Reactivation', 'Reactivation Business', 'Reactivated business', 'Reactivated Business']
    : ['Reactivation Business', 'Reactivated business', 'Reactivated Business', 'Reactivation'];

  const salesTarget = pick(monthRow, ['Total budget for 2026', 'TOTAL', 'Total Target', 'Total']);
  const actualLoanOfficerTarget = pick(monthRow, ['ACTUAL LOAN OFFICER', 'Actual Loan Officer', 'ACTUAL LOAN OFFICERS']);
  const salesAchieved = Number.isFinite(num(mtdTotals?.disbursement))
    ? num(mtdTotals?.disbursement)
    : pick(cur, ['Disbursements This Month', 'Disbursement this Month', 'Disbursement This Month']);
  const newBusiness = pick(cur, ['New Business', 'New business']);
  const reactivation = pick(cur, reactivationKeys);
  const repeatBusiness = pick(cur, ['Repeat Business', 'Repeat business']);
  const explicitLoanCountTarget = pick(monthRow, ['LOAN COUNTS', 'Loan counts']);
  const avgLoanSize = pick(monthRow, ['Avrg Loan size 5Mil', 'Avrg Loan size', 'Average Loan size']);
  const loanCountTarget = Number.isFinite(explicitLoanCountTarget)
    ? explicitLoanCountTarget
    : (Number.isFinite(salesTarget) && Number.isFinite(avgLoanSize) && avgLoanSize > 0 ? (salesTarget / avgLoanSize) : NaN);
  const loanCountAchieved = Number.isFinite(num(mtdTotals?.noLoans))
    ? num(mtdTotals?.noLoans)
    : pick(cur, ['Number of loans', 'Number of Loans']);
  const portfolioCur = pick(cur, ['Portfolio', 'Total Portfolio', 'Principle Balance']);
  const portfolioPrev = pick(prev, ['Portfolio', 'Total Portfolio', 'Principle Balance']);
  const monthlyGrowth = Number.isFinite(portfolioPrev) && portfolioPrev > 0 && Number.isFinite(portfolioCur)
    ? ((portfolioCur - portfolioPrev) / portfolioPrev) * 100
    : NaN;
  const annualizedGrowth = Number.isFinite(monthlyGrowth) ? monthlyGrowth * 12 : NaN;
  const lbfMainRow = product === 'LBF'
    ? (latestManagementReport?.lbfBranches?.LBF ?? latestManagementReport?.lbfBranches?.['LBF'])
    : null;
  const lbfMainRowPrev = product === 'LBF'
    ? (previousMonthManagementReport?.lbfBranches?.LBF ?? previousMonthManagementReport?.lbfBranches?.['LBF'])
    : null;
  const parCur = product === 'LBF' && lbfMainRow && typeof lbfMainRow === 'object'
    ? normalizeParToPercentage(lbfMainRow['PAR >30'] ?? lbfMainRow['PAR>30'])
    : normalizeParToPercentage(cur?.['PAR >30'] ?? cur?.['PAR>30']);
  const parPrev = product === 'LBF' && lbfMainRowPrev && typeof lbfMainRowPrev === 'object'
    ? normalizeParToPercentage(lbfMainRowPrev['PAR >30'] ?? lbfMainRowPrev['PAR>30'])
    : normalizeParToPercentage(prev?.['PAR >30'] ?? prev?.['PAR>30']);
  const parImprovement = Number.isFinite(parPrev) && Number.isFinite(parCur) ? (parPrev - parCur) : NaN;
  const activeTarget = pick(monthRow, ['ACTIVE REPS', 'ACTIVE']);
  const activeAchieved = Number.isFinite(num(mtdTotals?.activeReps)) ? num(mtdTotals?.activeReps) : pick(cur, ['Active Reps', 'Active reps']);
  const activeClientsCur = pick(cur, ['Active clients', 'Active Clients']);
  const activeClientsPrev = pick(prev, ['Active clients', 'Active Clients']);
  const activeClientsGrowth = Number.isFinite(activeClientsPrev) && activeClientsPrev > 0 && Number.isFinite(activeClientsCur)
    ? ((activeClientsCur - activeClientsPrev) / activeClientsPrev) * 100 * 12
    : NaN;
  const branch90 = branchSummaryData
    ? (((branchSummaryData.branches || []).filter((b) => (b.pct || 0) >= 90).length / Math.max(1, (branchSummaryData.branches || []).length)) * 100)
    : NaN;
  const branch100 = branchSummaryData
    ? (((branchSummaryData.branches || []).filter((b) => (b.pct || 0) >= 100).length / Math.max(1, (branchSummaryData.branches || []).length)) * 100)
    : NaN;
  const crmRaw = crmParsed?.emailData ? extractMetrics(crmParsed.emailData) : {};
  const cm = normalizeCrmMetricsForKpi(crmRaw, product);
  const toN = (v) => (Number.isFinite(num(v)) ? num(v) : 0);
  /** SME CRM Email sheet: total agents (`total_count_agent` / `total_agent`), same as CRMSME headline. */
  const useSmeCrmAgents =
    product === 'SME'
    && crmParsed
    && Array.isArray(crmParsed.emailData)
    && crmParsed.emailData.length > 0;
  const crmTotalAgentsSme = useSmeCrmAgents ? toN(cm.total_agent) : NaN;
  /** Achieving 100% actual reps: CRM total reps ÷ KPI TARGET “ACTUAL LOAN OFFICER”. */
  const smeCrmVsActualLoPct =
    useSmeCrmAgents
    && Number.isFinite(crmTotalAgentsSme)
    && Number.isFinite(actualLoanOfficerTarget)
    && actualLoanOfficerTarget > 0
      ? (crmTotalAgentsSme / actualLoanOfficerTarget) * 100
      : NaN;
  /** Maintain ≥90% active vs actual LO: Management Active Reps ÷ CRM total reps × 100. */
  const smeMgmtActiveOverCrmPct =
    useSmeCrmAgents
    && Number.isFinite(crmTotalAgentsSme)
    && crmTotalAgentsSme > 0
    && Number.isFinite(activeAchieved)
      ? (activeAchieved / crmTotalAgentsSme) * 100
      : NaN;
  const totalLeads = toN(cm.lead);
  const acceptedLeads = toN(cm.accepted_lead);
  const consentPctSingle = totalLeads > 0 ? (acceptedLeads / totalLeads) * 100 : NaN;
  const consentRollup = aggregatedCrmConsentPct ?? lbfAggregatedConsentPct;
  const usageRollup = aggregatedCrmUsagePct ?? lbfAggregatedUsagePct;
  const consentPct = (product === 'LBF' || product === 'SME') && consentRollup != null && Number.isFinite(consentRollup)
    ? consentRollup
    : consentPctSingle;
  const wf = toN(cm.count_team_leaders) + toN(cm.total_agent);
  const logged = toN(cm.logged_in_team_leaders) + toN(cm.total_agent_logged_in);
  const crmUsagePctSingle = wf > 0 ? (logged / wf) * 100 : NaN;
  const crmUsagePct = (product === 'LBF' || product === 'SME') && usageRollup != null && Number.isFinite(usageRollup)
    ? usageRollup
    : crmUsagePctSingle;

  return standards.map((s) => {
    const name = String(s?.name || '');
    const l = name.toLowerCase();
    const weight = Number(s?.weight) || 0;
    let target = '—';
    let achieved = NaN;
    let pct = NaN;
    let achievedDisplayOverride = null;
    let wScoredOverride = null;
    let lbfPortfolioDetail = null;
    let smeBreakdown = null;
    /** LBF: Metric/value breakdown for web + Excel (management + formula), same idea as SME. */
    let lbfBreakdown = null;
    const sectionKey = getLbfKpiSectionKey(name);

    const momClientsPct =
      Number.isFinite(activeClientsPrev) && activeClientsPrev > 0 && Number.isFinite(activeClientsCur)
        ? ((activeClientsCur - activeClientsPrev) / activeClientsPrev) * 100
        : NaN;

    if (product === 'SME' && l.includes('actual') && l.includes('rep') && l.includes('required')) {
      target = '100% (CRM reps vs ACTUAL LOAN OFFICER)';
      achieved = smeCrmVsActualLoPct;
      pct = smeCrmVsActualLoPct;
      wScoredOverride = Number.isFinite(smeCrmVsActualLoPct) ? (Math.min(100, smeCrmVsActualLoPct) / 100) * weight : 0;
      achievedDisplayOverride = Number.isFinite(smeCrmVsActualLoPct)
        ? `${smeCrmVsActualLoPct.toFixed(2)}% (${formatTzs(crmTotalAgentsSme)} CRM reps ÷ ${formatTzs(actualLoanOfficerTarget)} ACTUAL LO)`
        : '—';
      smeBreakdown = {
        title: 'CRM total reps vs KPI ACTUAL LOAN OFFICER',
        rows: [
          { metric: 'CRM total reps (Email sheet — latest report in month)', value: useSmeCrmAgents ? formatTzs(crmTotalAgentsSme) : '— (no CRM data)' },
          { metric: 'ACTUAL LOAN OFFICER (from KPI TARGET sheet)', value: Number.isFinite(actualLoanOfficerTarget) ? formatTzs(actualLoanOfficerTarget) : '—' },
          {
            metric: 'Calculation',
            value: Number.isFinite(smeCrmVsActualLoPct)
              ? `${formatTzs(crmTotalAgentsSme)} ÷ ${formatTzs(actualLoanOfficerTarget)} × 100 = ${smeCrmVsActualLoPct.toFixed(2)}%`
              : '—'
          },
          { metric: 'Score vs 100% target', value: Number.isFinite(smeCrmVsActualLoPct) ? `${Math.min(100, smeCrmVsActualLoPct).toFixed(2)}% (capped at 100%)` : '—' }
        ]
      };
    } else if (product === 'SME' && l.includes('loan officer') && l.includes('90')) {
      target = '≥90% (mgmt Active Reps ÷ CRM total reps)';
      achieved = smeMgmtActiveOverCrmPct;
      pct = smeMgmtActiveOverCrmPct;
      wScoredOverride = Number.isFinite(smeMgmtActiveOverCrmPct)
        ? (Math.min(100, (smeMgmtActiveOverCrmPct / 90) * 100) / 100) * weight
        : 0;
      achievedDisplayOverride = Number.isFinite(smeMgmtActiveOverCrmPct)
        ? `${smeMgmtActiveOverCrmPct.toFixed(2)}% (${formatTzs(activeAchieved)} mgmt Active Reps ÷ ${formatTzs(crmTotalAgentsSme)} CRM reps; target ≥90%)`
        : '—';
      smeBreakdown = {
        title: 'Management Active Reps vs CRM total reps',
        rows: [
          { metric: 'Management Active Reps', value: Number.isFinite(activeAchieved) ? formatTzs(activeAchieved) : '—' },
          { metric: 'CRM total reps (Email sheet — latest in month)', value: useSmeCrmAgents ? formatTzs(crmTotalAgentsSme) : '— (no CRM data)' },
          {
            metric: 'Calculation',
            value: Number.isFinite(smeMgmtActiveOverCrmPct)
              ? `${formatTzs(activeAchieved)} ÷ ${formatTzs(crmTotalAgentsSme)} × 100 = ${smeMgmtActiveOverCrmPct.toFixed(2)}%`
              : '—'
          },
          { metric: 'Target', value: '≥ 90%' },
          {
            metric: 'Weighted score basis',
            value: Number.isFinite(smeMgmtActiveOverCrmPct)
              ? `min(100, (${smeMgmtActiveOverCrmPct.toFixed(2)} ÷ 90) × 100)% of KPI weight`
              : '—'
          }
        ]
      };
    } else if ((l.includes('100%') && l.includes('sales target')) || (product === 'SME' && l.includes('achievement') && l.includes('monthly target'))) {
      target = salesTarget;
      achieved = salesAchieved;
      pct = Number.isFinite(achieved) && Number.isFinite(salesTarget) && salesTarget > 0 ? (achieved / salesTarget) * 100 : NaN;
      if (product === 'LBF' && l.includes('sales target')) {
        lbfBreakdown = {
          title: 'Sales vs budget target (management / MTD)',
          rows: [
            { metric: 'Disbursement achieved (MTD totals if present, else management)', value: Number.isFinite(salesAchieved) ? formatTzs(salesAchieved) : '—' },
            { metric: 'Sales target (KPI TARGET sheet)', value: Number.isFinite(salesTarget) ? formatTzs(salesTarget) : '—' },
            {
              metric: 'Calculation (% achieved)',
              value: Number.isFinite(pct) ? `${formatTzs(salesAchieved)} ÷ ${formatTzs(salesTarget)} × 100 = ${pct.toFixed(2)}%` : '—'
            },
            { metric: 'Weighted score', value: Number.isFinite(pct) ? `min(100%, ${pct.toFixed(2)}%) of KPI weight` : '—' }
          ]
        };
      }
    } else if (l.includes('90% of branches')) {
      target = '90%';
      achieved = branch90;
      pct = branch90;
      if (product === 'LBF' && branchSummaryData) {
        const bs = branchSummaryData.branches || [];
        const ge90 = bs.filter((b) => (b.pct || 0) >= 90).length;
        const n = Math.max(1, bs.length);
        lbfBreakdown = {
          title: 'Branches at ≥90% of disbursement vs target',
          rows: [
            { metric: 'Branches at ≥90%', value: String(ge90) },
            { metric: 'Total branches', value: String(bs.length) },
            {
              metric: 'Calculation',
              value: Number.isFinite(branch90) ? `${ge90} ÷ ${n} × 100 = ${branch90.toFixed(2)}%` : '—'
            }
          ]
        };
      }
    } else if (l.includes('65%') && l.includes('new business')) {
      target = Number.isFinite(salesTarget) ? salesTarget * 0.65 : NaN;
      achieved = newBusiness;
      pct = Number.isFinite(achieved) && Number.isFinite(target) && target > 0 ? (achieved / target) * 100 : NaN;
      if (product === 'LBF') {
        lbfBreakdown = {
          title: 'New business vs 65% of sales target',
          rows: [
            { metric: 'Sales target (KPI TARGET)', value: Number.isFinite(salesTarget) ? formatTzs(salesTarget) : '—' },
            { metric: '65% new-business target', value: Number.isFinite(target) ? formatTzs(target) : '—' },
            { metric: 'New business (management report)', value: Number.isFinite(newBusiness) ? formatTzs(newBusiness) : '—' },
            {
              metric: 'Calculation',
              value: Number.isFinite(pct) ? `${formatTzs(newBusiness)} ÷ ${formatTzs(target)} × 100 = ${pct.toFixed(2)}%` : '—'
            }
          ]
        };
      }
    } else if (l.includes('25%') && l.includes('reactivation')) {
      target = Number.isFinite(salesTarget) ? salesTarget * 0.25 : NaN;
      achieved = reactivation;
      pct = Number.isFinite(achieved) && Number.isFinite(target) && target > 0 ? (achieved / target) * 100 : NaN;
      if (product === 'LBF') {
        lbfBreakdown = {
          title: 'Reactivation vs 25% of sales target',
          rows: [
            { metric: 'Sales target (KPI TARGET)', value: Number.isFinite(salesTarget) ? formatTzs(salesTarget) : '—' },
            { metric: '25% reactivation target', value: Number.isFinite(target) ? formatTzs(target) : '—' },
            { metric: 'Reactivation (management report)', value: Number.isFinite(reactivation) ? formatTzs(reactivation) : '—' },
            {
              metric: 'Calculation',
              value: Number.isFinite(pct) ? `${formatTzs(reactivation)} ÷ ${formatTzs(target)} × 100 = ${pct.toFixed(2)}%` : '—'
            }
          ]
        };
      }
    } else if (l.includes('10%') && l.includes('repeat')) {
      target = Number.isFinite(salesTarget) ? salesTarget * 0.10 : NaN;
      achieved = repeatBusiness;
      pct = Number.isFinite(achieved) && Number.isFinite(target) && target > 0 ? (achieved / target) * 100 : NaN;
      if (product === 'LBF') {
        lbfBreakdown = {
          title: 'Repeat business vs 10% of sales target',
          rows: [
            { metric: 'Sales target (KPI TARGET)', value: Number.isFinite(salesTarget) ? formatTzs(salesTarget) : '—' },
            { metric: '10% repeat-business target', value: Number.isFinite(target) ? formatTzs(target) : '—' },
            { metric: 'Repeat business (management report)', value: Number.isFinite(repeatBusiness) ? formatTzs(repeatBusiness) : '—' },
            {
              metric: 'Calculation',
              value: Number.isFinite(pct) ? `${formatTzs(repeatBusiness)} ÷ ${formatTzs(target)} × 100 = ${pct.toFixed(2)}%` : '—'
            }
          ]
        };
      }
    } else if (l.includes('loan counts')) {
      target = loanCountTarget;
      achieved = loanCountAchieved;
      pct = Number.isFinite(achieved) && Number.isFinite(target) && target > 0 ? (achieved / target) * 100 : NaN;
      if (product === 'LBF') {
        lbfBreakdown = {
          title: 'Loan counts vs target',
          rows: [
            {
              metric: 'Loan count target',
              value: Number.isFinite(loanCountTarget)
                ? formatTzs(loanCountTarget)
                : '— (from TARGET sheet or sales ÷ avg loan size)'
            },
            {
              metric: 'Loans achieved (MTD or management)',
              value: Number.isFinite(loanCountAchieved) ? formatTzs(loanCountAchieved) : '—'
            },
            {
              metric: 'Calculation',
              value: Number.isFinite(pct) ? `${formatTzs(loanCountAchieved)} ÷ ${formatTzs(loanCountTarget)} × 100 = ${pct.toFixed(2)}%` : '—'
            }
          ]
        };
      }
    } else if (l.includes('portifolio') || l.includes('portfolio')) {
      target = '10% annual';
      achieved = annualizedGrowth;
      pct = Number.isFinite(annualizedGrowth) ? Math.min(100, (annualizedGrowth / 10) * 100) : NaN;
      if (product === 'LBF') {
        lbfPortfolioDetail = {
          portfolioCur,
          portfolioPrev,
          monthlyGrowth,
          annualizedGrowth
        };
        achievedDisplayOverride = Number.isFinite(annualizedGrowth)
          ? `${annualizedGrowth.toFixed(2)}% ann. (target 10%)`
          : '—';
      } else {
        achievedDisplayOverride = Number.isFinite(annualizedGrowth) ? `${annualizedGrowth.toFixed(2)}%` : '—';
      }
    } else if (l.includes('par 30')) {
      if (product === 'LBF') {
        target = '≤ 5% PAR >30';
        achieved = parCur;
        const pass = Number.isFinite(parCur) && parCur < 5;
        pct = pass ? 100 : 0;
        wScoredOverride = pass ? weight : 0;
        achievedDisplayOverride = Number.isFinite(parCur)
          ? `${parCur.toFixed(2)}% ${pass ? '(PASS)' : '(FAIL — not below 5%)'}`
          : '—';
        lbfBreakdown = {
          title: 'PAR >30 (LBF country row — management)',
          rows: [
            { metric: 'PAR >30 current period', value: Number.isFinite(parCur) ? `${parCur.toFixed(2)}%` : '—' },
            { metric: 'PAR >30 prior period', value: Number.isFinite(parPrev) ? `${parPrev.toFixed(2)}%` : '—' },
            { metric: 'Target', value: 'Strictly below 5%' },
            { metric: 'Result', value: Number.isFinite(parCur) ? (pass ? 'PASS — full KPI weight' : 'FAIL — 0% KPI weight') : '—' }
          ]
        };
      } else if (product === 'SME') {
        target = '≤ 3% PAR >30';
        achieved = parCur;
        const pass = Number.isFinite(parCur) && parCur <= 3;
        pct = pass ? 100 : 0;
        wScoredOverride = pass ? weight : 0;
        achievedDisplayOverride = Number.isFinite(parCur)
          ? `${parCur.toFixed(2)}% ${pass ? '(PASS)' : '(FAIL — above 3%)'}`
          : '—';
      } else {
        target = '0.5% improvement';
        achieved = parImprovement;
        pct = Number.isFinite(parImprovement) ? (parImprovement / 0.5) * 100 : NaN;
      }
    } else if (l.includes('data consent') || (product === 'SME' && l.includes('data collected') && l.includes('consent'))) {
      target = '65%';
      achieved = consentPct;
      pct = consentPct;
      if (product === 'LBF') {
        const rollupConsent = lbfAggregatedConsentPct != null && Number.isFinite(lbfAggregatedConsentPct);
        const rollupNote = rollupConsent
          ? 'Σ consented leads ÷ Σ total leads across all LBF CRM Email reports in month'
          : 'Single CRM Email report';
        lbfBreakdown = {
          title: 'Data consent % (CRM)',
          rows: [
            { metric: 'Consent % used in KPI', value: Number.isFinite(consentPct) ? `${consentPct.toFixed(2)}%` : '—' },
            { metric: 'Source', value: rollupNote },
            { metric: 'Target', value: '65%' },
            {
              metric: 'Weighted score vs 65%',
              value: Number.isFinite(consentPct) ? `min(100, (${consentPct.toFixed(2)} ÷ 65) × 100)% of KPI weight` : '—'
            }
          ]
        };
      }
    } else if (l.includes('active reps')) {
      target = activeTarget;
      achieved = activeAchieved;
      pct = Number.isFinite(achieved) && Number.isFinite(target) && target > 0 ? (achieved / target) * 100 : NaN;
      if (product === 'LBF') {
        lbfBreakdown = {
          title: 'Active reps vs TARGET sheet',
          rows: [
            { metric: 'Active Reps (management report)', value: Number.isFinite(activeAchieved) ? formatTzs(activeAchieved) : '—' },
            { metric: 'ACTIVE / ACTIVE REPS target (KPI TARGET)', value: Number.isFinite(activeTarget) ? formatTzs(activeTarget) : '—' },
            {
              metric: 'Calculation',
              value: Number.isFinite(pct) ? `${formatTzs(activeAchieved)} ÷ ${formatTzs(activeTarget)} × 100 = ${pct.toFixed(2)}%` : '—'
            }
          ]
        };
      }
    } else if (l.includes('active client base')) {
      target = '20% annual';
      achieved = activeClientsGrowth;
      pct = activeClientsGrowth;
      if (product === 'LBF') {
        lbfBreakdown = {
          title: 'Active client base — annualized growth (management)',
          rows: [
            { metric: 'Active clients — current month ("Active clients", management)', value: Number.isFinite(activeClientsCur) ? formatTzs(activeClientsCur) : '—' },
            { metric: 'Active clients — previous month (management)', value: Number.isFinite(activeClientsPrev) ? formatTzs(activeClientsPrev) : '—' },
            {
              metric: 'Month-on-month growth %',
              value: Number.isFinite(momClientsPct) ? `${momClientsPct.toFixed(2)}%` : '—'
            },
            {
              metric: 'Annualized growth % (MoM × 12, simple scale)',
              value: Number.isFinite(activeClientsGrowth) ? `${activeClientsGrowth.toFixed(2)}%` : '—'
            },
            { metric: 'KPI target', value: '20% annual' },
            {
              metric: 'Calculation',
              value: Number.isFinite(momClientsPct) && Number.isFinite(activeClientsGrowth)
                ? `((${formatTzs(activeClientsCur)} − ${formatTzs(activeClientsPrev)}) ÷ ${formatTzs(activeClientsPrev)}) × 100 × 12 = ${activeClientsGrowth.toFixed(2)}%`
                : '—'
            }
          ]
        };
      }
    } else if (l.includes('proper usage of crm') || (product === 'SME' && l.includes('login') && l.includes('usage'))) {
      if (product === 'SME') {
        target = '95%';
        achieved = crmUsagePct;
        pct = crmUsagePct;
        wScoredOverride = Number.isFinite(crmUsagePct) ? (Math.min(100, (crmUsagePct / 95) * 100) / 100) * weight : 0;
        achievedDisplayOverride = Number.isFinite(crmUsagePct) ? `${crmUsagePct.toFixed(2)}%` : '—';
      } else {
        target = '90%';
        achieved = crmUsagePct;
        pct = crmUsagePct;
        const rollupUsage = lbfAggregatedUsagePct != null && Number.isFinite(lbfAggregatedUsagePct);
        const rollupNote = rollupUsage
          ? 'Σ logged-in workforce ÷ Σ total workforce (TL + agents) across CRM Email reports in month'
          : 'Latest CRM Email report — workforce counts below match this %';
        lbfBreakdown = rollupUsage
          ? {
            title: 'CRM login usage (month rollup)',
            rows: [
              { metric: '% Logged in (used in KPI)', value: Number.isFinite(crmUsagePct) ? `${crmUsagePct.toFixed(2)}%` : '—' },
              { metric: 'Calculation basis', value: rollupNote },
              { metric: 'Target', value: '90%' },
              {
                metric: 'Weighted score vs 90%',
                value: Number.isFinite(crmUsagePct) ? `min(100, (${crmUsagePct.toFixed(2)} ÷ 90) × 100)% of KPI weight` : '—'
              },
              { metric: 'Detail rows', value: 'See “CRM usage — workforce per report” table below for daily breakdown.' }
            ]
          }
          : {
            title: 'CRM login usage (workforce = TL + agents)',
            rows: [
              { metric: 'Total workforce', value: Number.isFinite(wf) ? formatTzs(wf) : '—' },
              { metric: 'Logged in workforce', value: Number.isFinite(logged) ? formatTzs(logged) : '—' },
              {
                metric: 'Calculation',
                value: Number.isFinite(crmUsagePct) && wf > 0 ? `${formatTzs(logged)} ÷ ${formatTzs(wf)} × 100 = ${crmUsagePct.toFixed(2)}%` : '—'
              },
              { metric: 'Target', value: '90%' },
              {
                metric: 'Weighted score vs 90%',
                value: Number.isFinite(crmUsagePct) ? `min(100, (${crmUsagePct.toFixed(2)} ÷ 90) × 100)% of KPI weight` : '—'
              }
            ]
          };
      }
    } else if (l.includes('branches') && l.includes('cluster') && l.includes('hit')) {
      target = '100%';
      achieved = branch100;
      pct = branch100;
      if (product === 'LBF' && branchSummaryData) {
        const bs = branchSummaryData.branches || [];
        const eq100 = bs.filter((b) => (b.pct || 0) >= 100).length;
        const n = Math.max(1, bs.length);
        lbfBreakdown = {
          title: 'Branches at 100% of disbursement target',
          rows: [
            { metric: 'Branches at ≥100%', value: String(eq100) },
            { metric: 'Total branches', value: String(bs.length) },
            {
              metric: 'Calculation',
              value: Number.isFinite(branch100) ? `${eq100} ÷ ${n} × 100 = ${branch100.toFixed(2)}%` : '—'
            }
          ]
        };
      }
    }

    let wScored = wScoredOverride != null
      ? wScoredOverride
      : (Number.isFinite(pct) ? (Math.min(100, Math.max(0, pct)) / 100) * weight : 0);

    if (product === 'LBF' && l.includes('data consent') && Number.isFinite(pct)) {
      wScored = (Math.min(100, (pct / 65) * 100) / 100) * weight;
    }
    if (product === 'SME' && (l.includes('data consent') || (l.includes('data collected') && l.includes('consent'))) && Number.isFinite(pct)) {
      wScored = (Math.min(100, (pct / 65) * 100) / 100) * weight;
    }
    if (product === 'LBF' && l.includes('proper usage of crm') && Number.isFinite(pct)) {
      wScored = (Math.min(100, (pct / 90) * 100) / 100) * weight;
    }

    const achievedDisplay = achievedDisplayOverride != null
      ? achievedDisplayOverride
      : (Number.isFinite(achieved) ? (typeof target === 'string' && target.includes('%') ? `${achieved.toFixed(2)}%` : formatTzs(achieved)) : '—');

    return {
      kpi: name,
      target,
      achieved,
      achievedDisplay,
      pct: Number.isFinite(pct) ? pct : null,
      weight,
      weightScored: wScored,
      pctWeightScored: weight > 0 ? (wScored / weight) * 100 : 0,
      sectionKey,
      lbfPortfolioDetail: product === 'LBF' ? lbfPortfolioDetail : undefined,
      lbfBreakdown: product === 'LBF' ? lbfBreakdown : undefined,
      smeBreakdown: product === 'SME' ? smeBreakdown : undefined
    };
  });
}
