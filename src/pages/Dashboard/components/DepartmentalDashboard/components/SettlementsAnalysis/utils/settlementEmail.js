import { emailAPI } from '../../../../../../../services/api';

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const n = (v) => Number(v || 0).toLocaleString('en-US');
const nCurrency = (v) =>
  Number(v || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

const renderHtmlBarComparison = ({ title, monthly, keyA, keyB, labelA, labelB, formatter = n }) => {
  const maxVal = Math.max(
    1,
    ...monthly.map((m) => Number(m[keyA] || 0)),
    ...monthly.map((m) => Number(m[keyB] || 0))
  );

  const rows = monthly
    .map((m) => {
      const a = Number(m[keyA] || 0);
      const b = Number(m[keyB] || 0);
      const aPct = Math.max(1, Math.round((a / maxVal) * 100));
      const bPct = Math.max(1, Math.round((b / maxVal) * 100));
      return `
<tr>
  <td style="border:1px solid #d6deeb;padding:8px 10px;font-size:12px;font-weight:600;color:#334155;white-space:nowrap;">${esc(m.monthLabel)}</td>
  <td style="border:1px solid #d6deeb;padding:8px 10px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="width:82px;font-size:11px;color:#0B2A6B;font-weight:700;white-space:nowrap;padding:0 8px 6px 0;">${esc(labelA)}</td>
        <td style="padding:0 8px 6px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:#e5e7eb;height:12px;">
            <tr>
              <td style="width:${aPct}%;background:#0B2A6B;font-size:0;line-height:0;">&nbsp;</td>
              <td style="font-size:0;line-height:0;">&nbsp;</td>
            </tr>
          </table>
        </td>
        <td style="width:120px;text-align:right;font-size:11px;font-weight:700;color:#0B2A6B;white-space:nowrap;padding:0 0 6px 0;">${formatter(a)}</td>
      </tr>
      <tr>
        <td style="width:82px;font-size:11px;color:#7a5a05;font-weight:700;white-space:nowrap;padding:0 8px 0 0;">${esc(labelB)}</td>
        <td style="padding:0 8px 0 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;background:#e5e7eb;height:12px;">
            <tr>
              <td style="width:${bPct}%;background:#D4A017;font-size:0;line-height:0;">&nbsp;</td>
              <td style="font-size:0;line-height:0;">&nbsp;</td>
            </tr>
          </table>
        </td>
        <td style="width:120px;text-align:right;font-size:11px;font-weight:700;color:#7a5a05;white-space:nowrap;padding:0;">${formatter(b)}</td>
      </tr>
    </table>
  </td>
</tr>`;
    })
    .join('');

  return `
<div style="margin-top:14px;border:1px solid #d6deeb;border-radius:10px;overflow:hidden;">
  <div style="background:#0B2A6B;color:#fff;font-size:13px;font-weight:700;padding:10px 14px;">${esc(title)}</div>
  <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
    <thead>
      <tr>
        <th style="width:120px;border:1px solid #d6deeb;padding:8px 10px;background:#f8fafc;text-align:left;color:#334155;">Month</th>
        <th style="border:1px solid #d6deeb;padding:8px 10px;background:#f8fafc;text-align:left;color:#0B2A6B;">Comparison</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
};

export const buildSettlementEmailHTML = (label, report) => {
  if (!report) return '';
  const summary = report.perProduct?.Total;
  if (!summary) return '';

  const headerCells = summary.monthly
    .map((m) => `<th style="border:1px solid #cbd5e1;padding:8px;background:#0B2A6B;color:#fff;text-align:center;">${esc(m.monthLabel)}</th>`)
    .join('');

  const settledRow = summary.monthly
    .map((m) => `<td style="border:1px solid #cbd5e1;padding:7px;text-align:right;background:#EFF4FB;font-size:10px;white-space:nowrap;">${n(m.settledLoans)}</td>`)
    .join('');
  const issuedRow = summary.monthly
    .map((m) => `<td style="border:1px solid #cbd5e1;padding:7px;text-align:right;background:#FCF4D4;font-size:10px;white-space:nowrap;">${n(m.issuedLoans)}</td>`)
    .join('');

  const balRow = summary.monthly
    .map((m) => `<td style="border:1px solid #cbd5e1;padding:7px;text-align:right;background:#EFF4FB;font-size:9px;white-space:nowrap;">${nCurrency(m.settledBalance)}</td>`)
    .join('');
  const disbRow = summary.monthly
    .map((m) => `<td style="border:1px solid #cbd5e1;padding:7px;text-align:right;background:#FCF4D4;font-size:9px;white-space:nowrap;">${nCurrency(m.totalDisbursed)}</td>`)
    .join('');

  const totals = summary.totals;
  const months = summary.monthly.map((m) => m.monthLabel);
  const settledLoansSeries = summary.monthly.map((m) => Number(m.settledLoans || 0));
  const issuedLoansSeries = summary.monthly.map((m) => Number(m.issuedLoans || 0));
  const settledBalanceSeries = summary.monthly.map((m) => Number(m.settledBalance || 0));
  const disbursedSeries = summary.monthly.map((m) => Number(m.totalDisbursed || 0));

  const tableChart1 = renderHtmlBarComparison({
    title: 'Settled Loans vs Loans Issued (monthly)',
    monthly: summary.monthly,
    keyA: 'settledLoans',
    keyB: 'issuedLoans',
    labelA: 'Settled Loans',
    labelB: 'Loans Issued',
    formatter: n,
  });
  const tableChart2 = renderHtmlBarComparison({
    title: 'Overall Settlement Balance vs Overall Total Disbursed',
    monthly: summary.monthly,
    keyA: 'settledBalance',
    keyB: 'totalDisbursed',
    labelA: 'Settlement Balance',
    labelB: 'Total Disbursed',
    formatter: nCurrency,
  });

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef2f8;font-family:Segoe UI,Tahoma,sans-serif;">
    <div style="max-width:960px;margin:24px auto;background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:22px;">
      <div style="background:linear-gradient(135deg,#0B2A6B 0%,#1E3A8A 55%,#2563EB 100%);color:#fff;border-radius:12px;padding:18px 20px;margin-bottom:16px;text-align:center;box-shadow:0 8px 20px rgba(11,42,107,0.22);">
        <h2 style="margin:0 0 6px 0;letter-spacing:0.4px;">SETTLEMENTS ANALYSIS</h2>
        <p style="margin:0;font-size:13px;opacity:0.95;">${esc(label || '')}</p>
      </div>
      <p style="margin:0 0 10px 0;color:#0F172A;font-size:14px;"><strong>Dear Manager,</strong></p>
      <p style="margin:0 0 14px 0;color:#334155;line-height:1.5;">
        Please find below a concise monthly settlements snapshot across all products, highlighting key trends in settled volume and value versus issuance and disbursement. The full detailed workbook is attached.
      </p>

      <h3 style="color:#0B2A6B;margin:18px 0 8px;">Overall Settled Loans vs Overall Loans Issued</h3>
      <div style="overflow-x:auto;overflow-y:hidden;max-width:100%;border:1px solid #cbd5e1;border-radius:8px;">
        <table style="width:100%;min-width:1000px;border-collapse:collapse;font-size:11px;table-layout:fixed;">
          <thead><tr><th style="width:180px;border:1px solid #cbd5e1;padding:8px;background:#0B2A6B;color:#fff;text-align:left;">Metric</th>${headerCells}<th style="width:120px;border:1px solid #cbd5e1;padding:8px;background:#0B2A6B;color:#fff;">Total</th></tr></thead>
          <tbody>
            <tr><td style="border:1px solid #cbd5e1;padding:7px;font-weight:700;background:#E8EDF6;">Overall Settled Loans</td>${settledRow}<td style="border:1px solid #cbd5e1;padding:7px;text-align:right;background:#E8EDF6;font-weight:700;font-size:10px;">${n(totals.settledLoans)}</td></tr>
            <tr><td style="border:1px solid #cbd5e1;padding:7px;font-weight:700;background:#FCF4D4;">Overall Loans Issued</td>${issuedRow}<td style="border:1px solid #cbd5e1;padding:7px;text-align:right;background:#FCF4D4;font-weight:700;font-size:10px;">${n(totals.issuedLoans)}</td></tr>
          </tbody>
        </table>
      </div>
      ${tableChart1}

      <h3 style="color:#0B2A6B;margin:24px 0 8px;">Overall Settlement Balance vs Overall Total Disbursed</h3>
      <div style="overflow-x:auto;overflow-y:hidden;max-width:100%;border:1px solid #cbd5e1;border-radius:8px;">
        <table style="width:100%;min-width:1500px;border-collapse:collapse;font-size:10px;table-layout:fixed;">
          <thead><tr><th style="width:220px;border:1px solid #cbd5e1;padding:8px;background:#0B2A6B;color:#fff;text-align:left;">Metric</th>${headerCells}<th style="width:150px;border:1px solid #cbd5e1;padding:8px;background:#0B2A6B;color:#fff;">Total</th></tr></thead>
          <tbody>
            <tr><td style="border:1px solid #cbd5e1;padding:7px;font-weight:700;background:#E8EDF6;white-space:nowrap;">Overall Settlement Balance</td>${balRow}<td style="border:1px solid #cbd5e1;padding:7px;text-align:right;background:#E8EDF6;font-weight:700;white-space:nowrap;font-size:9px;">${nCurrency(totals.settledBalance)}</td></tr>
            <tr><td style="border:1px solid #cbd5e1;padding:7px;font-weight:700;background:#FCF4D4;white-space:nowrap;">Overall Total Disbursed</td>${disbRow}<td style="border:1px solid #cbd5e1;padding:7px;text-align:right;background:#FCF4D4;font-weight:700;white-space:nowrap;font-size:9px;">${nCurrency(totals.totalDisbursed)}</td></tr>
          </tbody>
        </table>
      </div>
      ${tableChart2}
    </div>
  </body>
</html>`;
};

export const sendSettlementEmail = async (recipients, subject, htmlBody = '', options = {}) => {
  if (!recipients || recipients.length === 0) {
    return { success: false, error: 'No recipients specified' };
  }
  try {
    const result = await emailAPI.sendScoreCard({
      recipients,
      subject,
      htmlBody,
      mode: 'SETTLEMENTS',
      attachmentBase64: options.attachmentBase64 || '',
      attachmentName: options.attachmentName || '',
    });
    if (result.success) return { success: true };
    return { success: false, error: result.error || 'Failed to send email' };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
};
