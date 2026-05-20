/**
 * Fetch a single CRM report file and extract metrics from the Email sheet.
 * LBF uses different Text labels than CS — see CRMAnalysis renderLBFContent (number_consented_lead, total_count_agent, …).
 */
import * as XLSX from 'xlsx';
import { getReportFileUrl } from '../../../../../../../services/supabase';
import { extractMetrics } from '../../../../CRMdashboard/utils/crmUtils';

function toNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && !isNaN(v)) return v;
  const n = parseFloat(String(v).replace(/%|,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** Normalize Email Text key for lookup (spaces vs underscores). */
function normKey(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
}

/**
 * First non-empty metric from extractMetrics() dict using several possible Email "Text" labels.
 */
function pickMetric(metrics, aliases) {
  const byNorm = {};
  for (const [k, v] of Object.entries(metrics || {})) {
    byNorm[normKey(k)] = v;
  }
  for (const a of aliases) {
    const v = byNorm[normKey(a)];
    if (v != null && v !== '') return v;
  }
  return undefined;
}

/**
 * Normalize to the same shape used by KPI scoring: lead, accepted_lead, rejected_lead, not_provided_lead,
 * total_agent, total_agent_logged_in, count_team_leaders, logged_in_team_leaders.
 */
export function normalizeCrmMetricsForKpi(raw, department) {
  const d = String(department || 'CS').toUpperCase();

  if (d === 'SME') {
    const leadN = toNum(pickMetric(raw, ['lead', 'count_leads']));
    let accepted = toNum(pickMetric(raw, [
      'accepted_lead',
      'accepted lead',
      'accepted_leads',
      'number_accepted_lead',
      'number accepted lead'
    ]));
    if (accepted <= 0 && leadN > 0) {
      const pctAcc = toNum(pickMetric(raw, ['percentage_accepted_lead', 'percentage accepted lead']));
      if (pctAcc > 0) accepted = (pctAcc / 100) * leadN;
    }
    return {
      lead: leadN,
      accepted_lead: accepted,
      rejected_lead: toNum(pickMetric(raw, ['rejected_lead', 'rejected lead', 'rejected_leads', 'rejected leads'])),
      not_provided_lead: toNum(pickMetric(raw, [
        'not_provided_lead',
        'not provided lead',
        'not_provided_leads',
        'not provided leads'
      ])),
      total_agent: toNum(pickMetric(raw, [
        'total_count_agent',
        'total count agent',
        'total_agent',
        'total agent'
      ])),
      total_agent_logged_in: toNum(pickMetric(raw, [
        'logged_in_agents',
        'logged in agents',
        'logged_in_agent',
        'logged in agent',
        'total_agent_logged_in',
        'total agent logged in'
      ])),
      count_team_leaders: toNum(pickMetric(raw, [
        'total_count_team_leaders',
        'total count team leaders',
        'count_team_leaders',
        'count team leaders'
      ])),
      logged_in_team_leaders: toNum(pickMetric(raw, [
        'logged_in_team_leaders',
        'logged in team leaders'
      ]))
    };
  }

  if (d === 'LBF') {
    return {
      lead: toNum(pickMetric(raw, ['lead', 'count_leads'])),
      accepted_lead: toNum(pickMetric(raw, [
        'number_consented_lead',
        'number consented lead',
        'accepted_lead',
        'accepted lead'
      ])),
      rejected_lead: toNum(pickMetric(raw, ['rejected_lead', 'rejected lead'])),
      not_provided_lead: toNum(pickMetric(raw, ['not_provided_lead', 'not provided lead'])),
      total_agent: toNum(pickMetric(raw, [
        'total_count_agent',
        'total count agent',
        'total_agent',
        'total agent'
      ])),
      total_agent_logged_in: toNum(pickMetric(raw, [
        'logged_in_agent',
        'logged in agent',
        'total_agent_logged_in',
        'total agent logged in'
      ])),
      count_team_leaders: toNum(pickMetric(raw, [
        'total_count_team_leaders',
        'total count team leaders',
        'count_team_leaders',
        'count team leaders'
      ])),
      logged_in_team_leaders: toNum(pickMetric(raw, [
        'logged_in_team_leaders',
        'logged in team leaders'
      ]))
    };
  }

  // CS / SME / default
  return {
    total_agent: toNum(pickMetric(raw, ['total_agent', 'total agent'])),
    total_agent_logged_in: toNum(pickMetric(raw, ['total_agent_logged_in', 'total agent logged in'])),
    count_team_leaders: toNum(pickMetric(raw, ['count_team_leaders', 'count team leaders'])),
    logged_in_team_leaders: toNum(pickMetric(raw, ['logged_in_team_leaders', 'logged in team leaders'])),
    lead: toNum(pickMetric(raw, ['lead', 'count_leads'])),
    accepted_lead: toNum(pickMetric(raw, ['accepted_lead', 'accepted lead'])),
    rejected_lead: toNum(pickMetric(raw, ['rejected_lead', 'rejected lead'])),
    not_provided_lead: toNum(pickMetric(raw, ['not_provided_lead', 'not provided lead']))
  };
}

/**
 * @param {Object} report - Report object with fileUrl or filePath, department, and date
 * @returns {Promise<{ date: Date, metrics: Object }>}
 */
/**
 * @param {Object} report
 * @param {string} [departmentOverride] - e.g. 'LBF' when `report.department` is missing (fixes Email label set for LBF CRM files).
 */
export async function getCrmEmailMetrics(report, departmentOverride) {
  let fileUrl = report?.fileUrl || report?.file_url;
  if (!fileUrl && (report?.filePath || report?.file_path)) {
    fileUrl = await getReportFileUrl(report.filePath || report.file_path);
  }
  if (!fileUrl) return { date: report?.date, metrics: {} };

  const response = await fetch(fileUrl);
  if (!response.ok) return { date: report?.date, metrics: {} };

  const arrayBuffer = await response.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  if (!wb.SheetNames || !wb.SheetNames.includes('Email')) {
    return { date: report?.date, metrics: {} };
  }

  const emailSheet = wb.Sheets['Email'];
  const emailData = XLSX.utils.sheet_to_json(emailSheet);
  const raw = extractMetrics(emailData || []);
  const department = departmentOverride ?? report?.department ?? 'CS';
  const metrics = normalizeCrmMetricsForKpi(raw, department);

  return {
    date: report?.date ? new Date(report.date) : new Date(),
    metrics
  };
}
