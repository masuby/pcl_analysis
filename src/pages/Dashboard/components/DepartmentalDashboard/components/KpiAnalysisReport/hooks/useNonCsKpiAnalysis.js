import { useLbfKpiAnalysis } from './useLbfKpiAnalysis';
import { useSmeKpiAnalysis } from './useSmeKpiAnalysis';

const EMPTY_NON_CS = {
  nonCsSummaryRows: [],
  buildNonCsReportSheetsAndFile: () => null,
  lbfBranchSummaryData: null,
  lbfCrmDailyRows: [],
  sortedBranchesByPct: []
};

/**
 * Routes LBF vs SME KPI hooks. Both child hooks run unconditionally (stable hook order);
 * only the active product’s results are returned to the UI.
 */
export function useNonCsKpiAnalysis({
  product,
  targets,
  effectiveMonthKey,
  latestManagementReport,
  previousMonthManagementReport,
  toMonthKey,
  monthKeyToLabel,
  normalizeParToPercentage,
  formatTzs
}) {
  const lbf = useLbfKpiAnalysis({
    targets,
    effectiveMonthKey,
    latestManagementReport,
    previousMonthManagementReport,
    toMonthKey,
    monthKeyToLabel,
    normalizeParToPercentage,
    formatTzs
  });

  const sme = useSmeKpiAnalysis({
    targets,
    effectiveMonthKey,
    latestManagementReport,
    previousMonthManagementReport,
    toMonthKey,
    monthKeyToLabel,
    normalizeParToPercentage,
    formatTzs
  });

  if (product === 'LBF') return lbf;
  if (product === 'SME') return sme;
  return EMPTY_NON_CS;
}
