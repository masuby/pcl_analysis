import { emailAPI } from '../../../../../../../services/api';

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const n = (v) => Number(v || 0).toLocaleString('en-US');

export const buildTemporaryReportEmailHTML = (dateLabel, uiRows = [], uiTotals = {}) => {
  const acceptedTotal = Number(uiTotals?.CS?.accepted || 0) + Number(uiTotals?.LBF?.accepted || 0) + Number(uiTotals?.SME?.accepted || 0);
  const notProvidedTotal = Number(uiTotals?.CS?.notProvided || 0) + Number(uiTotals?.LBF?.notProvided || 0) + Number(uiTotals?.SME?.notProvided || 0);
  const rejectedTotal = Number(uiTotals?.CS?.rejected || 0) + Number(uiTotals?.LBF?.rejected || 0) + Number(uiTotals?.SME?.rejected || 0);
  const allLeadsTotal = acceptedTotal + notProvidedTotal + rejectedTotal;

  const categoryRows = [
    { category: 'Accepted', total: acceptedTotal, bg: '#DBEAFE' },
    { category: 'Not Provided', total: notProvidedTotal, bg: '#FEF3C7' },
    { category: 'Rejected', total: rejectedTotal, bg: '#FEE2E2' },
    { category: 'All Leads', total: allLeadsTotal, bg: '#E2E8F0', strong: true },
  ].map((row) => `
    <tr style="${row.strong ? 'font-weight:700;' : ''}">
      <td style="border:1px solid #cbd5e1;padding:10px;text-align:left;background:${row.bg};">${esc(row.category)}</td>
      <td style="border:1px solid #cbd5e1;padding:10px;text-align:right;background:${row.bg};">${n(row.total)}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef2f8;font-family:Segoe UI,Tahoma,sans-serif;">
    <div style="max-width:760px;margin:24px auto;background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:24px;">
      <div style="background:linear-gradient(135deg,#1A237E,#283593);color:#fff;border-radius:6px;padding:16px 20px;margin-bottom:16px;">
        <h2 style="margin:0 0 4px 0;">TEMPORARY CRM REPORT</h2>
        <p style="margin:0;font-size:13px;">${esc(dateLabel)}</p>
      </div>
      <p style="margin:0 0 12px 0;color:#334155;">Please find the consolidated category totals below. The full workbook is attached.</p>
      <table style="width:100%;max-width:460px;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr>
            <th style="border:1px solid #cbd5e1;background:#0f172a;color:#fff;padding:10px;text-align:left;">Category</th>
            <th style="border:1px solid #cbd5e1;background:#0f172a;color:#fff;padding:10px;text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${categoryRows}
        </tbody>
      </table>
    </div>
  </body>
</html>`;
};

export const sendTemporaryReportEmail = async (recipients, subject, htmlBody = '', options = {}) => {
  if (!recipients || recipients.length === 0) {
    return { success: false, error: 'No recipients specified' };
  }

  try {
    const result = await emailAPI.sendScoreCard({
      recipients,
      subject,
      htmlBody,
      mode: 'TEMPORARY',
      attachmentBase64: options.attachmentBase64 || '',
      attachmentName: options.attachmentName || '',
    });
    if (result.success) return { success: true };
    return { success: false, error: result.error || 'Failed to send email' };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
};

