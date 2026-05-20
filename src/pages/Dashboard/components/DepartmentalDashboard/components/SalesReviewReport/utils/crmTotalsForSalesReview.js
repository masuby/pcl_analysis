/**
 * CRM "Actual reps from CRM" totals for Sales Review — single source of truth.
 *
 * Values come from the CRM upload workbook **Email** sheet (see `extractCRMAgentCountFromWorkbook`
 * in SalesReviewReport.jsx `loadCrmActuals`), stored in `crmActualRepsByMonth[dept][YYYY-MM]`.
 * That is the same number shown in:
 * "The total Number of Actual reps from CRM up to {date} stands at {X}."
 */

/**
 * @param {{ CS?: Record<string, number>, LBF?: Record<string, number>, SME?: Record<string, number> } | null} crmActualRepsByMonth
 * @param {'CS'|'LBF'|'SME'} dept
 * @param {string} selectedMonth YYYY-MM
 * @returns {number | null} Rounded total, or null if not loaded for that month
 */
export function getCrmEmailAgentTotalForDept(crmActualRepsByMonth, dept, selectedMonth) {
  const raw = crmActualRepsByMonth?.[dept]?.[selectedMonth];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Countrywide summary: sum of CS + LBF + SME Email-sheet agent totals (same construction as SalesReviewReport summaryData.crmActualRepsTotal).
 */
export function getCrmEmailAgentTotalCountrywide(crmActualRepsByMonth, selectedMonth) {
  return ['CS', 'LBF', 'SME'].reduce((sum, dept) => {
    const v = getCrmEmailAgentTotalForDept(crmActualRepsByMonth, dept, selectedMonth);
    return sum + (v ?? 0);
  }, 0);
}
