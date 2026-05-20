/** Normalized keys for matching KPI rows to detail sections (LBF / SME). */

export function getLbfKpiSectionKey(kpiName) {
  const l = String(kpiName || '').toLowerCase();
  if (l.includes('actual reps required') || (l.includes('actual') && l.includes('rep') && l.includes('required'))) return 'sme_actual_reps_100';
  if (l.includes('loan officer') && l.includes('90')) return 'sme_active_lo_90';
  if (l.includes('achievement') && l.includes('monthly target')) return 'sme_monthly_100';
  if ((l.includes('login') && l.includes('usage') && l.includes('95')) || l.includes('completion of sale')) return 'sme_crm_95';
  if (l.includes('data collected') && l.includes('consent')) return 'sme_consent_65';
  if (l.includes('par 30') && l.includes('3%')) return 'sme_par3';
  if (l.includes('100% sales target')) return 'sales_100';
  if (l.includes('90% of branches')) return 'branch_90';
  if (l.includes('65%') && l.includes('new business')) return 'new_biz_65';
  if (l.includes('25%') && l.includes('reactivation')) return 'reactivation_25';
  if (l.includes('10%') && l.includes('repeat')) return 'repeat_10';
  if (l.includes('loan counts')) return 'loan_counts';
  if (l.includes('portifolio') || l.includes('portfolio')) return 'portfolio_growth';
  if (l.includes('par 30')) return 'par30';
  if (l.includes('data consent')) return 'data_consent';
  if (l.includes('active reps')) return 'active_reps';
  if (l.includes('active client base')) return 'active_clients_growth';
  if (l.includes('proper usage of crm')) return 'crm_usage';
  if (l.includes('branches') && l.includes('cluster') && l.includes('hit')) return 'branch_cluster_100';
  return 'other';
}
