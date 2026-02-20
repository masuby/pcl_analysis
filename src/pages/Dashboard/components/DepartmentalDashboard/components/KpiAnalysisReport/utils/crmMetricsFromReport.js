/**
 * Fetch a single CRM report file and extract metrics from the Email sheet.
 * Used by KPI report for "CRM usage" and "Data consent" sheets.
 */
import * as XLSX from 'xlsx';
import { getReportFileUrl } from '../../../../../../../services/supabase';
import { extractMetrics } from '../../../../CRMdashboard/utils/crmUtils';

/**
 * @param {Object} report - Report object with fileUrl or filePath, and date
 * @returns {Promise<{ date: Date, metrics: Object }>} metrics include total_agent, total_agent_logged_in, count_team_leaders, logged_in_team_leaders, lead, accepted_lead, rejected_lead, not_provided_lead, etc.
 */
export async function getCrmEmailMetrics(report) {
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
  const metrics = extractMetrics(emailData || []);

  const toNum = (v) => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number' && !isNaN(v)) return v;
    const n = parseFloat(String(v).replace(/%|,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  };

  return {
    date: report?.date ? new Date(report.date) : new Date(),
    metrics: {
      total_agent: toNum(metrics.total_agent ?? metrics['total agent']),
      total_agent_logged_in: toNum(metrics.total_agent_logged_in ?? metrics['total agent logged in']),
      count_team_leaders: toNum(metrics.count_team_leaders ?? metrics['count team leaders']),
      logged_in_team_leaders: toNum(metrics.logged_in_team_leaders ?? metrics['logged in team leaders']),
      lead: toNum(metrics.lead ?? metrics.count_leads ?? metrics['lead']),
      accepted_lead: toNum(metrics.accepted_lead ?? metrics['accepted lead']),
      rejected_lead: toNum(metrics.rejected_lead ?? metrics['rejected lead']),
      not_provided_lead: toNum(metrics.not_provided_lead ?? metrics['not provided lead'])
    }
  };
}
