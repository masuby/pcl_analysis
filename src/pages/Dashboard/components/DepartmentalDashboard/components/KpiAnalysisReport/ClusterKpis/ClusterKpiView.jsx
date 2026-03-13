/**
 * Renders all 8 Cluster KPI detail sections when a cluster is selected.
 * Receives data from parent (KpiAnalysisReport) and passes to each KPI component.
 */
import React from 'react';
import {
  ClusterKpi01SalesTarget,
  ClusterKpi02RegionsNewBusiness,
  ClusterKpi03BranchesOnTarget,
  ClusterKpi04Recruitment,
  ClusterKpi05PortfolioGrowth,
  ClusterKpi06Par30,
  ClusterKpi07OnLocationCompletion,
  ClusterKpi08DataConsent,
  getBranchesForCluster
} from './index';

function normalizeParToPercentage(val) {
  if (val == null || val === '') return NaN;
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  if (!Number.isFinite(n)) return NaN;
  if (n > 0 && n < 1) return n * 100;
  return n;
}

export default function ClusterKpiView({
  cluster,
  monthLabel,
  effectiveMonthKey,
  clusterTarget = 0,
  countrySheetDisbursement = null,
  countrySheetClusterPortfolio = null,
  countrySheetClusterPortfolioPrevious = null,
  countrySheetClusterPar30 = null,
  mtdGroupedData = null,
  branchesByCluster = null,
  filteredBranchSummaryData = null,
  latestManagementReport = null,
  previousMonthManagementReport = null,
  clusterTargets = null,
  loading = false,
  regionsNewBizTable = [],
  recruitmentTable = [],
  crmClusterAggregated = null,
  onLocationTable = [],
  consentTable = []
}) {
  const branchNamesInCluster = getBranchesForCluster(cluster) || [];

  const branchesForKpi3 = filteredBranchSummaryData?.branches ?? [];

  const portfolioCurrent = countrySheetClusterPortfolio ?? latestManagementReport?.cs?.['Portfolio'] ?? latestManagementReport?.cs?.['Total Portfolio'] ?? latestManagementReport?.cs?.['Principle Balance'] ?? null;
  const portfolioPrev = countrySheetClusterPortfolioPrevious ?? previousMonthManagementReport?.cs?.['Portfolio'] ?? previousMonthManagementReport?.cs?.['Total Portfolio'] ?? previousMonthManagementReport?.cs?.['Principle Balance'] ?? null;

  const par30Val = countrySheetClusterPar30 ?? latestManagementReport?.cs?.['PAR >30'] ?? latestManagementReport?.cs?.['PAR>30'] ?? null;
  const par30Pct = normalizeParToPercentage(par30Val);

  return (
    <div className="ckpi-view">
      <ClusterKpi01SalesTarget
        cluster={cluster}
        monthLabel={monthLabel}
        clusterTarget={clusterTarget}
        disbursement={countrySheetDisbursement}
        loading={loading}
      />
      <ClusterKpi02RegionsNewBusiness
        cluster={cluster}
        monthLabel={monthLabel}
        regionsNewBizTable={regionsNewBizTable}
        loading={loading}
      />
      <ClusterKpi03BranchesOnTarget
        cluster={cluster}
        monthLabel={monthLabel}
        branches={branchesForKpi3}
        weightPct={10}
        loading={loading}
      />
      <ClusterKpi04Recruitment
        cluster={cluster}
        monthLabel={monthLabel}
        recruitmentTable={recruitmentTable}
        weightPct={7}
        loading={loading}
      />
      <ClusterKpi05PortfolioGrowth
        cluster={cluster}
        monthLabel={monthLabel}
        portfolioCurrent={portfolioCurrent}
        portfolioPrevious={portfolioPrev}
        loading={loading}
      />
      <ClusterKpi06Par30
        cluster={cluster}
        monthLabel={monthLabel}
        par30Pct={Number.isFinite(par30Pct) ? par30Pct : null}
        loading={loading}
      />
      <ClusterKpi07OnLocationCompletion
        cluster={cluster}
        monthLabel={monthLabel}
        completedAtLocation={crmClusterAggregated?.atLocation ?? 0}
        totalCompleted={crmClusterAggregated?.completed ?? 0}
        byZone={[]}
        weightPct={6}
        loading={loading}
        onLocationTable={onLocationTable}
      />
      <ClusterKpi08DataConsent
        cluster={cluster}
        monthLabel={monthLabel}
        acceptedCount={crmClusterAggregated?.accepted ?? 0}
        totalConsent={crmClusterAggregated?.total ?? 0}
        byZone={[]}
        weightPct={5}
        loading={loading}
        consentTable={consentTable}
      />
    </div>
  );
}
