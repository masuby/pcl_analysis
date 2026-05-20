/**
 * Totals / blended metrics for CRM appendix and branch tables (LBF/SME KPI report).
 */

export function aggregateCrmConsentDailyRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  let totalLeads = 0;
  let rejected = 0;
  let notProvided = 0;
  let consented = 0;
  for (const r of list) {
    totalLeads += r.totalLeads || 0;
    rejected += r.rejected || 0;
    notProvided += r.notProvided || 0;
    consented += r.consented || 0;
  }
  const pctConsented = totalLeads > 0 ? (consented / totalLeads) * 100 : 0;
  const pctRejected = totalLeads > 0 ? (rejected / totalLeads) * 100 : 0;
  const pctNotProvided = totalLeads > 0 ? (notProvided / totalLeads) * 100 : 0;
  return {
    totalLeads,
    rejected,
    notProvided,
    consented,
    pctConsented,
    pctRejected,
    pctNotProvided
  };
}

export function aggregateCrmUsageDailyRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  let totalWorkforce = 0;
  let loggedIn = 0;
  for (const r of list) {
    totalWorkforce += r.totalWorkforce || 0;
    loggedIn += r.loggedIn || 0;
  }
  const pctLoggedIn = totalWorkforce > 0 ? (loggedIn / totalWorkforce) * 100 : 0;
  return { totalWorkforce, loggedIn, pctLoggedIn };
}

export function aggregateBranchDisbursementRows(branches) {
  const bs = Array.isArray(branches) ? branches : [];
  if (!bs.length) return null;
  let totalTarget = 0;
  let totalDisbursement = 0;
  for (const b of bs) {
    totalTarget += Number(b.target) || 0;
    totalDisbursement += Number(b.disbursement) || 0;
  }
  const pct = totalTarget > 0 ? (totalDisbursement / totalTarget) * 100 : NaN;
  return { totalTarget, totalDisbursement, pct };
}
