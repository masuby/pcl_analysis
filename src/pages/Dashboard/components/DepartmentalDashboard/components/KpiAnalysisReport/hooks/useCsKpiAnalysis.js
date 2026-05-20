import { useMemo } from 'react';
import { ZONES_BY_CLUSTER_CS } from '../ClusterKpis/constants';
import { buildRSMData, buildRSMDataFromBranches } from '../../GapAnalysis/utils/gapAnalysisUtils';
import { aggregateCrmForCluster } from '../utils/parseCrmClusterSheets';
import { extractMetrics } from '../../../../CRMdashboard/utils/crmUtils';
import { getWeightForKpiKey } from '../utils/csKpiTargets';

export function useCsKpiAnalysis({
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
  formatPercentAccounting,
}) {
  const filteredBranchSummaryData = useMemo(() => {
    if (!branchSummaryData) return null;
    if (csView === 'Total' || !branchToClusterMap) return branchSummaryData;
    const branchesInView = branchesByCluster?.[csView] || [];
    const set = new Set(branchesInView);
    const branches = (branchSummaryData.branches || []).filter((b) => set.has(b.branch));
    const clusters = (branchSummaryData.clusters || []).filter((c) => c.branch === csView);
    let totalTarget = 0;
    let totalDisbursement = 0;
    let achieved100Count = 0;
    let notAchieved100Count = 0;
    branches.forEach((b) => {
      totalTarget += b.target || 0;
      totalDisbursement += b.disbursement || 0;
      if ((b.pct ?? 0) >= 100) achieved100Count += 1;
      else notAchieved100Count += 1;
    });
    return { branches, clusters, totalTarget, totalDisbursement, achieved100Count, notAchieved100Count };
  }, [branchSummaryData, csView, branchToClusterMap, branchesByCluster]);

  const mtdSalesAchievedForView = useMemo(() => {
    const raw = mtdParsedData?.grandTotalRow?.VALUE ?? mtdParsedData?.grandTotalRow?.value;
    const fullTotal = typeof raw === 'number' ? raw : (raw != null ? parseFloat(raw) : NaN);
    if (csView === 'Total' || !branchesByCluster || !mtdParsedData?.groupedData) return fullTotal;
    const branchesInView = new Set(branchesByCluster[csView] || []);
    if (branchesInView.size === 0) return fullTotal;
    let sum = 0;
    for (const [, group] of Object.entries(mtdParsedData.groupedData)) {
      for (const tl of group.teamLeaders || []) {
        const name = (tl.name || '').trim();
        if (branchesInView.has(name)) {
          const d = tl.data || {};
          sum += Number(d.VALUE ?? d.Value ?? 0) || 0;
        }
      }
    }
    return Number.isFinite(sum) ? sum : fullTotal;
  }, [mtdParsedData, csView, branchesByCluster]);

  const effectiveTargetsForKpi = useMemo(() => {
    if (!targets || !effectiveMonthKey) return null;
    const isCluster = csView !== 'Total' && (csView === 'Cluster 1' || csView === 'Cluster 2' || csView === 'Cluster 3' || csView === 'Zanzibar');
    if (isCluster) {
      if (clusterTargetsMissing || !clusterTargets?.clusters?.[csView]) return null;
    }
    if (isCluster && clusterTargets?.clusters?.[csView]) {
      const clusterRow = clusterTargets.clusters[csView][effectiveMonthKey];
      return {
        performanceStandards: clusterTargets.performanceStandards?.length ? clusterTargets.performanceStandards : targets.performanceStandards,
        salesTarget: clusterRow?.total ?? 0,
      };
    }
    const mainT = (targets.mainland || {})[effectiveMonthKey];
    const zanT = (targets.zanzibar || {})[effectiveMonthKey];
    const ccT = (targets.callCenter || {})[effectiveMonthKey];
    return {
      performanceStandards: targets.performanceStandards || [],
      salesTarget: (mainT?.total ?? 0) + (zanT?.total ?? 0) + (ccT ?? 0),
    };
  }, [targets, clusterTargets, clusterTargetsMissing, csView, effectiveMonthKey]);

  const countrySheetClusterDisbursement = useMemo(() => {
    if (csView === 'Total' || !branchSummaryData?.clusters?.length) return null;
    const row = branchSummaryData.clusters.find((c) => c.branch === csView || (csView === 'Zanzibar' && (c.branch === 'ZANZIBAR' || c.branch === 'Zanzibar')));
    return row?.disbursement ?? null;
  }, [csView, branchSummaryData?.clusters]);
  const countrySheetClusterPortfolio = useMemo(() => {
    if (csView === 'Total' || !branchSummaryData?.clusters?.length) return null;
    const row = branchSummaryData.clusters.find((c) => c.branch === csView || (csView === 'Zanzibar' && (c.branch === 'ZANZIBAR' || c.branch === 'Zanzibar')));
    return row?.portfolio ?? null;
  }, [csView, branchSummaryData?.clusters]);
  const countrySheetClusterPar30 = useMemo(() => {
    if (csView === 'Total' || !branchSummaryData?.clusters?.length) return null;
    const row = branchSummaryData.clusters.find((c) => c.branch === csView || (csView === 'Zanzibar' && (c.branch === 'ZANZIBAR' || c.branch === 'Zanzibar')));
    return row?.par30 ?? null;
  }, [csView, branchSummaryData?.clusters]);
  const countrySheetClusterPortfolioPrevious = useMemo(() => {
    if (csView === 'Total' || !branchSummaryDataPrevious?.clusters?.length) return null;
    const row = branchSummaryDataPrevious.clusters.find((c) => c.branch === csView || (csView === 'Zanzibar' && (c.branch === 'ZANZIBAR' || c.branch === 'Zanzibar')));
    return row?.portfolio ?? null;
  }, [csView, branchSummaryDataPrevious?.clusters]);

  const gapActualRepsOverrides = useMemo(() => {
    const reportId = mtdParsedData?.reportId;
    if (!reportId || product !== 'CS') return {};
    let local = {};
    try {
      const key = `gap_analysis_actual_${reportId}_CS`;
      const raw = localStorage.getItem(key);
      local = raw ? JSON.parse(raw) : {};
    } catch {
      local = {};
    }
    return { ...local, ...gapActualRepsFromServer };
  }, [mtdParsedData?.reportId, product, gapActualRepsFromServer]);

  const normalizeZoneForMatch = (s) =>
    String(s ?? '').trim().toLowerCase().replace(/\s+(zone|region)\s*$/i, '').replace(/\s+/g, ' ').trim();

  const rsmDataForCluster = useMemo(() => {
    if (product !== 'CS' || csView === 'Total' || !mtdParsedData?.groupedData) return [];
    const zonesInCluster = ZONES_BY_CLUSTER_CS[csView] || [];
    const zoneSet = new Set(zonesInCluster.map((z) => String(z).trim()));
    const zoneNormSet = new Set(zonesInCluster.map((z) => normalizeZoneForMatch(z)));
    const full = buildRSMData(mtdParsedData, 'CS', gapActualRepsOverrides);
    const byZone = full.filter((item) => {
      const sup = String(item.supervision || '').trim();
      if (zoneSet.has(sup) || zoneSet.has(sup.toUpperCase())) return true;
      if (csView === 'Zanzibar' && sup.toUpperCase().includes('ZANZIBAR')) return true;
      if (zoneNormSet.has(normalizeZoneForMatch(sup))) return true;
      return false;
    });
    if (byZone.length > 0) return byZone;
    const branchesInCluster = branchesByCluster?.[csView] || [];
    if (!branchesInCluster.length) return [];
    return buildRSMDataFromBranches(mtdParsedData, 'CS', branchesInCluster, gapActualRepsOverrides);
  }, [product, csView, mtdParsedData, gapActualRepsOverrides, branchesByCluster]);

  const crmClusterAggregated = useMemo(() => {
    if (csView === 'Total') return null;
    const clusterZones = ZONES_BY_CLUSTER_CS[csView];
    if (!clusterZones?.length) return null;
    if (crmReportsInMonthData?.length > 0) {
      return crmReportsInMonthData.reduce(
        (acc, r) => ({
          completed: acc.completed + (r.completed ?? 0),
          atLocation: acc.atLocation + (r.atLocation ?? 0),
          accepted: acc.accepted + (r.accepted ?? 0),
          total: acc.total + (r.totalLead ?? 0),
        }),
        { completed: 0, atLocation: 0, accepted: 0, total: 0 }
      );
    }
    if (!crmClusterSheetsData) return null;
    return aggregateCrmForCluster(crmClusterSheetsData.agentActivity, crmClusterSheetsData.leadReport, clusterZones);
  }, [crmClusterSheetsData, csView, crmReportsInMonthData]);

  const onLocationTable = useMemo(
    () => (crmReportsInMonthData?.length ? crmReportsInMonthData.map((r) => ({
      reportDate: r.reportDate,
      completed: r.completed,
      atLocation: r.atLocation,
      pctAtLocation: r.completed > 0 ? (r.atLocation / r.completed) * 100 : null,
    })) : []),
    [crmReportsInMonthData]
  );

  const consentTable = useMemo(
    () => (crmReportsInMonthData?.length ? crmReportsInMonthData.map((r) => ({
      reportDate: r.reportDate,
      totalLead: r.totalLead,
      accepted: r.accepted,
      pctConsented: r.totalLead > 0 ? (r.accepted / r.totalLead) * 100 : null,
    })) : []),
    [crmReportsInMonthData]
  );

  const clusterKpiTables = useMemo(() => {
    if (!rsmDataForCluster.length) return { regionsNewBiz: [], recruitment: [] };
    const regionsNewBiz = [];
    const recruitment = [];
    for (const { supervision, rows } of rsmDataForCluster) {
      const newLoansRow = rows.find((r) => r.rowLabel === 'New Loans');
      if (newLoansRow) {
        const target = Number(newLoansRow.Target) || 0;
        const achieved = Number(newLoansRow.Achieved) ?? 0;
        regionsNewBiz.push({ region: supervision, target, achieved, pct: target > 0 ? (achieved / target) * 100 : 0 });
      }
      const actualRow = rows.find((r) => r.rowLabel === 'Actual Reps');
      if (actualRow) {
        const target = Number(actualRow.Target) || 0;
        const achieved = actualRow.Achieved != null && actualRow.Achieved !== '' ? Number(actualRow.Achieved) : 0;
        recruitment.push({ region: supervision, target, achieved, pct: target > 0 ? (achieved / target) * 100 : 0 });
      }
    }
    return { regionsNewBiz, recruitment };
  }, [rsmDataForCluster]);

  const clusterDashboardRows = useMemo(() => {
    if (csView === 'Total' || !clusterTargets?.performanceStandards?.length || !effectiveTargetsForKpi || !effectiveMonthKey) return null;
    const isCluster = csView === 'Cluster 1' || csView === 'Cluster 2' || csView === 'Cluster 3' || csView === 'Zanzibar';
    if (!isCluster || !clusterTargets.clusters?.[csView]) return null;
    const standards = clusterTargets.performanceStandards;
    const salesTarget = effectiveTargetsForKpi.salesTarget;
    const salesAchievedNum = typeof countrySheetClusterDisbursement === 'number' ? countrySheetClusterDisbursement : (countrySheetClusterDisbursement != null ? parseFloat(countrySheetClusterDisbursement) : NaN);
    const pctSales = Number.isFinite(salesAchievedNum) && salesTarget > 0 ? (salesAchievedNum / salesTarget) * 100 : null;
    const totalBranches = (filteredBranchSummaryData?.achieved100Count ?? 0) + (filteredBranchSummaryData?.notAchieved100Count ?? 0);
    const pctBranches100 = totalBranches > 0 ? ((filteredBranchSummaryData?.achieved100Count ?? 0) / totalBranches) * 100 : null;

    let regionsInClusterHit = 0;
    let regionsInClusterTotal = 0;
    if (rsmDataForCluster.length > 0) {
      for (const { rows } of rsmDataForCluster) {
        const newLoansRow = rows.find((r) => r.rowLabel === 'New Loans');
        if (!newLoansRow) continue;
        const target = Number(newLoansRow.Target) || 0;
        const achieved = Number(newLoansRow.Achieved) ?? 0;
        regionsInClusterTotal += 1;
        if (target > 0 && achieved >= target) regionsInClusterHit += 1;
      }
    }
    const pctRegionsNewBiz100 = regionsInClusterTotal > 0 ? (regionsInClusterHit / regionsInClusterTotal) * 100 : null;

    let actualRepsTargetSum = 0;
    let actualRepsAchievedSum = 0;
    if (rsmDataForCluster.length > 0) {
      for (const { rows } of rsmDataForCluster) {
        const actualRow = rows.find((r) => r.rowLabel === 'Actual Reps');
        if (!actualRow) continue;
        actualRepsTargetSum += Number(actualRow.Target) || 0;
        actualRepsAchievedSum += actualRow.Achieved != null && actualRow.Achieved !== '' ? Number(actualRow.Achieved) : 0;
      }
    }
    const pctRecruitment = actualRepsTargetSum > 0 ? (actualRepsAchievedSum / actualRepsTargetSum) * 100 : null;

    const portfolioCurrent = countrySheetClusterPortfolio ?? latestManagementReport?.cs?.['Portfolio'] ?? latestManagementReport?.cs?.['Total Portfolio'] ?? latestManagementReport?.cs?.['Principle Balance'] ?? null;
    const portfolioNum = typeof portfolioCurrent === 'number' ? portfolioCurrent : (portfolioCurrent != null ? parseFloat(portfolioCurrent) : NaN);
    const portfolioPrev = countrySheetClusterPortfolioPrevious ?? previousMonthManagementReport?.cs?.['Portfolio'] ?? previousMonthManagementReport?.cs?.['Total Portfolio'] ?? previousMonthManagementReport?.cs?.['Principle Balance'] ?? null;
    const portfolioPrevNum = typeof portfolioPrev === 'number' ? portfolioPrev : (portfolioPrev != null ? parseFloat(portfolioPrev) : NaN);
    const growthPct = Number.isFinite(portfolioPrevNum) && portfolioPrevNum > 0 && Number.isFinite(portfolioNum) ? ((portfolioNum - portfolioPrevNum) / portfolioPrevNum) * 100 : null;
    const annualizedGrowth = growthPct != null ? growthPct * 12 : null;
    const par30Num = normalizeParToPercentage(countrySheetClusterPar30 ?? latestManagementReport?.cs?.['PAR >30'] ?? latestManagementReport?.cs?.['PAR>30'] ?? null);

    const onLocationPct = crmClusterAggregated?.completed > 0 ? (crmClusterAggregated.atLocation / crmClusterAggregated.completed) * 100 : null;
    const dataConsentPct = crmClusterAggregated?.total > 0 ? (crmClusterAggregated.accepted / crmClusterAggregated.total) * 100 : null;
    const lower = (s) => String(s || '').toLowerCase();
    const match = (name, phrases) => phrases.every((p) => lower(name).includes(lower(p)));
    const rows = [];
    for (const std of standards) {
      const name = std?.name ?? '';
      const w = Number(std?.weight) ?? 0;
      if (!name) continue;
      if (match(name, ['100%', 'overall cluster', 'sales target']) || match(name, ['cluster', 'sales target'])) {
        rows.push({ kpi: name, target: salesTarget, achievedDisplay: Number.isFinite(salesAchievedNum) ? formatTzs(salesAchievedNum) : '—', pct: pctSales, weight: w, weightScored: pctSales != null ? (Math.min(100, pctSales) / 100) * w : 0 });
      } else if (match(name, ['regions', 'new business', '100%']) || match(name, ['regions hit', 'new business'])) {
        rows.push({ kpi: name, target: '100%', achievedDisplay: pctRegionsNewBiz100 != null ? formatPercentAccounting(pctRegionsNewBiz100) : '—', pct: pctRegionsNewBiz100, weight: w, weightScored: pctRegionsNewBiz100 != null ? (Math.min(100, pctRegionsNewBiz100) / 100) * w : 0 });
      } else if (match(name, ['90%', 'branches']) || match(name, ['branches', 'sales target'])) {
        rows.push({ kpi: name, target: '90%', achievedDisplay: pctBranches100 != null ? formatPercentAccounting(pctBranches100) : '—', pct: pctBranches100, weight: w, weightScored: pctBranches100 != null ? (Math.min(100, (pctBranches100 / 90) * 100) / 100) * w : 0 });
      } else if (match(name, ['85%', 'recruitment']) || match(name, ['recruitment', 'sales agents'])) {
        rows.push({ kpi: name, target: '85%', achievedDisplay: pctRecruitment != null ? formatPercentAccounting(pctRecruitment) : '—', pct: pctRecruitment, weight: w, weightScored: pctRecruitment != null ? (Math.min(100, (pctRecruitment / 85) * 100) / 100) * w : 0 });
      } else if (match(name, ['growth', 'portfolio', '20%']) || match(name, ['portfolio', 'client base', '20%'])) {
        rows.push({ kpi: name, target: '20% (annualized)', achievedDisplay: annualizedGrowth != null ? formatPercentAccounting(annualizedGrowth) : '—', pct: annualizedGrowth, weight: w, weightScored: annualizedGrowth != null ? (Math.min(100, (annualizedGrowth / 20) * 100) / 100) * w : 0 });
      } else if (match(name, ['par', '30', '5%']) || match(name, ['maintain par'])) {
        const par30Under5 = Number.isFinite(par30Num) && par30Num < 5;
        rows.push({ kpi: name, target: '≤ 5%', achievedDisplay: Number.isFinite(par30Num) ? formatPercentAccounting(par30Num) : '—', pct: Number.isFinite(par30Num) ? par30Num : null, weight: w, weightScored: par30Under5 ? w : 0 });
      } else if (match(name, ['95%', 'location', 'completion']) || match(name, ['on location', 'plans'])) {
        rows.push({ kpi: name, target: '95%', achievedDisplay: onLocationPct != null ? formatPercentAccounting(onLocationPct) : '—', pct: onLocationPct, weight: w, weightScored: onLocationPct != null ? (Math.min(100, (onLocationPct / 95) * 100) / 100) * w : 0 });
      } else if (match(name, ['80%', 'data consent']) || match(name, ['data consent', 'region'])) {
        rows.push({ kpi: name, target: '80%', achievedDisplay: dataConsentPct != null ? formatPercentAccounting(dataConsentPct) : '—', pct: dataConsentPct, weight: w, weightScored: dataConsentPct != null ? (Math.min(100, (dataConsentPct / 80) * 100) / 100) * w : 0 });
      } else {
        rows.push({ kpi: name, target: '—', achievedDisplay: '—', pct: null, weight: w, weightScored: 0 });
      }
    }
    return rows.map((r) => ({ ...r, pctWeightScored: (Number(r.weight) || 0) > 0 ? ((Number(r.weightScored) || 0) / Number(r.weight)) * 100 : 0 }))
      .sort((a, b) => (b.pctWeightScored ?? 0) - (a.pctWeightScored ?? 0));
  }, [csView, clusterTargets, effectiveTargetsForKpi, effectiveMonthKey, countrySheetClusterDisbursement, countrySheetClusterPortfolio, countrySheetClusterPortfolioPrevious, countrySheetClusterPar30, filteredBranchSummaryData, rsmDataForCluster, crmClusterAggregated, latestManagementReport, previousMonthManagementReport, normalizeParToPercentage, formatTzs, formatPercentAccounting]);

  const dashboardSummaryRows = useMemo(() => {
    if (clusterDashboardRows) return clusterDashboardRows;
    if (!targets || !effectiveMonthKey) return [];
    const effective = effectiveTargetsForKpi;
    if (!effective) return [];
    const standards = effective.performanceStandards || [];
    const salesTarget = effective.salesTarget;
    const mainT = (targets.mainland || {})[effectiveMonthKey];
    const zanT = (targets.zanzibar || {})[effectiveMonthKey];
    const salesAchieved = typeof mtdSalesAchievedForView === 'number' ? mtdSalesAchievedForView : (mtdSalesAchievedForView != null ? parseFloat(mtdSalesAchievedForView) : NaN);
    const pctSales = Number.isFinite(salesAchieved) && salesTarget > 0 ? (salesAchieved / salesTarget) * 100 : null;
    const w1 = standards[0]?.weight ?? 0.1;
    const ws1 = pctSales != null ? (Math.min(100, pctSales) / 100) * w1 : 0;
    const totalBranches = (filteredBranchSummaryData?.achieved100Count ?? 0) + (filteredBranchSummaryData?.notAchieved100Count ?? 0);
    const pctBranches100 = totalBranches > 0 ? ((filteredBranchSummaryData?.achieved100Count ?? 0) / totalBranches) * 100 : null;
    const w2 = standards[1]?.weight ?? 0.1;
    const ws2 = pctBranches100 != null ? (Math.min(100, (pctBranches100 / 85) * 100) / 100) * w2 : 0;
    const newBizMainlandTarget = mainT?.newBusiness ?? null;
    const newBizMainlandNum = Number(latestManagementReport?.cs?.['New Business'] ?? latestManagementReport?.cs?.['New business']);
    const pctMainland65 = newBizMainlandTarget > 0 && Number.isFinite(newBizMainlandNum) ? (newBizMainlandNum / newBizMainlandTarget) * 100 : null;
    const w3 = standards[2]?.weight ?? 0.15;
    const ws3 = pctMainland65 != null ? (Math.min(100, (pctMainland65 / 65) * 100) / 100) * w3 : 0;
    const newBizZanTarget = zanT?.newBusiness ?? null;
    const newBizZanNum = Number(latestManagementReport?.zanzibar?.['New Business'] ?? latestManagementReport?.zanzibar?.['New business']);
    const pctZan70 = newBizZanTarget > 0 && Number.isFinite(newBizZanNum) ? (newBizZanNum / newBizZanTarget) * 100 : null;
    const w4 = standards[3]?.weight ?? 0.05;
    const ws4 = pctZan70 != null ? (Math.min(100, (pctZan70 / 70) * 100) / 100) * w4 : 0;
    const portfolioNum = Number(latestManagementReport?.cs?.['Portfolio'] ?? latestManagementReport?.cs?.['Total Portfolio'] ?? latestManagementReport?.cs?.['Principle Balance']);
    const portfolioPrevNum = Number(previousMonthManagementReport?.cs?.['Portfolio'] ?? previousMonthManagementReport?.cs?.['Total Portfolio'] ?? previousMonthManagementReport?.cs?.['Principle Balance']);
    const growthPct = Number.isFinite(portfolioPrevNum) && portfolioPrevNum > 0 && Number.isFinite(portfolioNum) ? ((portfolioNum - portfolioPrevNum) / portfolioPrevNum) * 100 : null;
    const w5 = standards[4]?.weight ?? 0.05;
    const ws5 = growthPct != null ? (Math.min(100, (growthPct / (10 / 12)) * 100) / 100) * w5 : 0;
    const par30Num = normalizeParToPercentage(latestManagementReport?.cs?.['PAR >30'] ?? latestManagementReport?.cs?.['PAR>30'] ?? null);
    const par30PrevNum = normalizeParToPercentage(previousMonthManagementReport?.cs?.['PAR >30'] ?? previousMonthManagementReport?.cs?.['PAR>30'] ?? null);
    const par30Improvement = Number.isFinite(par30PrevNum) && Number.isFinite(par30Num) ? par30PrevNum - par30Num : null;
    const w6 = standards[5]?.weight ?? 0.05;
    const ws6 = par30Improvement != null ? Math.max(0, Math.min(1, par30Improvement / 0.5)) * w6 : 0;

    const toNumVal = (v) => (typeof v === 'number' && !isNaN(v)) ? v : (v != null ? parseFloat(v) : NaN);
    const activeNumCur = toNumVal(latestManagementReport?.cs?.['Active clients'] ?? latestManagementReport?.cs?.['Active Clients']);
    const activeNumPrev = toNumVal(previousMonthManagementReport?.cs?.['Active clients'] ?? previousMonthManagementReport?.cs?.['Active Clients']);
    const monthlyGrowth = Number.isFinite(activeNumPrev) && activeNumPrev > 0 && Number.isFinite(activeNumCur) ? ((activeNumCur - activeNumPrev) / activeNumPrev) * 100 : null;
    const annualizedGrowth = monthlyGrowth != null ? monthlyGrowth * 12 : null;
    const w7 = getWeightForKpiKey(standards, 'growth') || 0.02;
    const ws7 = annualizedGrowth != null ? (Math.min(100, (annualizedGrowth / 20) * 100) / 100) * w7 : 0;

    const supervisionsList = mtdParsedData?.groupedData ? Object.entries(mtdParsedData.groupedData) : [];
    const getTarget = (d) => Number(d?.['MONTH TARGET'] ?? d?.['Month Target'] ?? d?.Target ?? 0) || 0;
    const getVal = (d) => Number(d?.VALUE ?? d?.Value ?? 0) || 0;
    const regionsHit = supervisionsList.filter(([, g]) => { const d = g.supervisionData || {}; const t = getTarget(d); const v = getVal(d); return t > 0 && v >= t; }).length;
    const clusterBranches = filteredBranchSummaryData?.clusters ?? [];
    const clustersHit = clusterBranches.filter((b) => (b.pct ?? 0) >= 100).length;
    const totalR = supervisionsList.length;
    const totalC = clusterBranches.length;
    const regionsClustersPct = (totalR + totalC) > 0 ? ((regionsHit + clustersHit) / (totalR + totalC)) * 100 : null;
    const w8 = getWeightForKpiKey(standards, 'regions_clusters') || 0.05;
    const ws8 = regionsClustersPct != null ? (Math.min(100, regionsClustersPct) / 100) * w8 : 0;

    const crmForMonth = crmParsedDataForMonth && toMonthKey(crmParsedDataForMonth.reportDate) === effectiveMonthKey ? crmParsedDataForMonth : null;
    const crmMetrics = crmForMonth?.emailData ? extractMetrics(crmForMonth.emailData) : {};
    const toN = (v) => (typeof v === 'number' && !isNaN(v)) ? v : (v != null ? parseFloat(String(v).replace(/%|,/g, '')) : 0);
    const totalWorkforce = toN(crmMetrics.count_team_leaders ?? crmMetrics['count team leaders']) + toN(crmMetrics.total_agent ?? crmMetrics['total agent']);
    const totalLogged = toN(crmMetrics.logged_in_team_leaders ?? crmMetrics['logged in team leaders']) + toN(crmMetrics.total_agent_logged_in ?? crmMetrics['total agent logged in']);
    const overallUsagePct = totalWorkforce > 0 ? (totalLogged / totalWorkforce) * 100 : null;
    const w9 = getWeightForKpiKey(standards, 'crm') || 0.05;
    const ws9 = overallUsagePct != null ? (Math.min(100, (overallUsagePct / 90) * 100) / 100) * w9 : 0;
    const totalLeads = toN(crmMetrics.lead ?? crmMetrics.count_leads ?? crmMetrics['lead']);
    const consented = toN(crmMetrics.accepted_lead ?? crmMetrics['accepted lead']);
    const avgConsentPct = totalLeads > 0 ? (consented / totalLeads) * 100 : null;
    const w10 = getWeightForKpiKey(standards, 'data_consent') || 0.05;
    const ws10 = avgConsentPct != null ? (Math.min(100, (avgConsentPct / 65) * 100) / 100) * w10 : 0;

    const rows = [
      { kpi: standards[0]?.name ?? 'Sales target', target: salesTarget, achievedDisplay: Number.isFinite(salesAchieved) ? formatTzs(salesAchieved) : '—', pct: pctSales, weight: w1, weightScored: ws1 },
      { kpi: standards[1]?.name ?? 'Branch sales', target: '85%', achievedDisplay: pctBranches100 != null ? formatPercentAccounting(pctBranches100) : '—', pct: pctBranches100, weight: w2, weightScored: ws2 },
      { kpi: standards[2]?.name ?? 'Mainland 65%', target: '65%', achievedDisplay: pctMainland65 != null ? formatPercentAccounting(pctMainland65) : '—', pct: pctMainland65, weight: w3, weightScored: ws3 },
      { kpi: standards[3]?.name ?? 'Zanzibar 70%', target: '70%', achievedDisplay: pctZan70 != null ? formatPercentAccounting(pctZan70) : '—', pct: pctZan70, weight: w4, weightScored: ws4 },
      { kpi: standards[4]?.name ?? 'Portfolio growth', target: '~1%', achievedDisplay: growthPct != null ? formatPercentAccounting(growthPct) : '—', pct: growthPct, weight: w5, weightScored: ws5 },
      { kpi: standards[5]?.name ?? 'PAR 30', target: '0.5% improvement', achievedDisplay: par30Improvement != null ? formatPercentAccounting(par30Improvement) : '—', pct: null, weight: w6, weightScored: ws6 },
      { kpi: 'Growth of active client base 20% annually', target: '20% (annualized)', achievedDisplay: annualizedGrowth != null ? formatPercentAccounting(annualizedGrowth) : '—', pct: annualizedGrowth, weight: w7, weightScored: ws7 },
      { kpi: 'Ensure all Regions and Clusters hit their target', target: '100% hit', achievedDisplay: regionsClustersPct != null ? formatPercentAccounting(regionsClustersPct) : '—', pct: regionsClustersPct, weight: w8, weightScored: ws8 },
      { kpi: '90% proper usage of CRM', target: '90%', achievedDisplay: overallUsagePct != null ? formatPercentAccounting(overallUsagePct) : '—', pct: overallUsagePct, weight: w9, weightScored: ws9 },
      { kpi: '65% achieved of Data consent from each Cluster', target: '65%', achievedDisplay: avgConsentPct != null ? formatPercentAccounting(avgConsentPct) : '—', pct: avgConsentPct, weight: w10, weightScored: ws10 },
    ];
    return rows.map((r) => ({ ...r, pctWeightScored: (Number(r.weight) || 0) > 0 ? ((Number(r.weightScored) || 0) / Number(r.weight)) * 100 : 0 }))
      .sort((a, b) => (b.pctWeightScored ?? 0) - (a.pctWeightScored ?? 0));
  }, [clusterDashboardRows, targets, effectiveTargetsForKpi, effectiveMonthKey, latestManagementReport, previousMonthManagementReport, mtdParsedData, mtdSalesAchievedForView, filteredBranchSummaryData, crmParsedDataForMonth, toMonthKey, normalizeParToPercentage, formatTzs, formatPercentAccounting]);

  return {
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
    dashboardSummaryRows,
  };
}
