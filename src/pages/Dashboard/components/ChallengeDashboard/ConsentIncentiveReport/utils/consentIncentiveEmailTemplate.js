/**
 * HTML email template for Consent Incentive Report.
 * @param {Object} summary  — from processConsentIncentiveReport
 * @returns {string} full HTML string
 */
export function buildConsentIncentiveEmailHTML(summary) {
  const {
    totalAgents, totalVerified, totalConverted, totalPayout, teamAwardTotal,
    byProduct, topPerformers, period, product,
  } = summary;

  const generated = new Date().toLocaleString('en-GB');
  const fmt = (n) => Math.round(n ?? 0).toLocaleString();

  const PRODUCT_LABELS = {
    CS:  'CS — Civil Servant',
    LBF: 'LBF — Log Book Finance',
    SME: 'SME — Small & Medium Enterprise',
  };

  // For a product-scoped report, surface the product alongside the period.
  const periodDisplay = product ? `${PRODUCT_LABELS[product] ?? product} · ${period}` : period;

  const productRows = ['CS', 'LBF', 'SME']
    .filter((p) => byProduct[p])
    .map((p, i) => {
      const b  = byProduct[p];
      const bg = i % 2 === 0 ? '#f8fafc' : '#ffffff';
      const tp = topPerformers?.[p];
      return `
        <tr style="background:${bg};">
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#1f3864;">${PRODUCT_LABELS[p] ?? p}</td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;">${b.agents}</td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;color:#166534;font-weight:600;">${fmt(b.verified)}</td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;color:#92400e;">${fmt(b.converted)}</td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:700;color:#1f3864;">${fmt(b.totalPayout)}</td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;color:#374151;">${tp ? tp.name : '—'}</td>
        </tr>`;
    })
    .join('');

  const metricCard = (label, value, color = '#1f3864') => `
    <td style="width:16.6%;padding:0 6px;">
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:16px 12px;text-align:center;">
        <div style="font-size:22px;font-weight:700;color:${color};margin-bottom:4px;">${value}</div>
        <div style="font-size:11px;color:#6b7280;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
      </div>
    </td>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Consent Incentive Report</title>
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f4f6f9;line-height:1.6;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f9;padding:24px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="640" cellspacing="0" cellpadding="0"
             style="max-width:640px;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.08);overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1f3864 0%,#2e74b5 100%);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;letter-spacing:0.5px;">
              🎯 CONSENT INCENTIVE REPORT${product ? ` — ${product}` : ''}
            </h1>
            ${periodDisplay ? `<p style="margin:10px 0 0;color:rgba(255,255,255,0.9);font-size:16px;font-weight:500;">${periodDisplay}</p>` : ''}
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.7);font-size:12px;">Generated: ${generated}</p>
          </td>
        </tr>

        <!-- Intro / Instructions -->
        <tr>
          <td style="padding:28px 40px 0;">
            <p style="margin:0 0 6px;font-size:14px;color:#374151;">Dear Manager,</p>
            <p style="margin:0 0 18px;font-size:13px;color:#4b5563;line-height:1.7;">
              Please find the <strong>Consent Incentive Report${product ? ` (${product} only)` : ''}</strong> for the period <strong>${period}</strong>.
              This report calculates individual agent payouts based on verified and converted consents,
              identifies top performers per product, and highlights teams that have reached the
              drink-up award threshold.
            </p>

            <!-- Instructions -->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                   style="background:#f0f7ff;border-radius:8px;margin-bottom:18px;">
              <tr>
                <td style="padding:14px 18px;">
                  <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#1e3a5f;">📋 Instructions</p>
                  <ul style="margin:0;padding-left:18px;font-size:12px;color:#374151;line-height:1.9;">
                    <li>Review the summary metrics and product breakdown below for a quick incentive overview.</li>
                    <li>Download the attached Excel report for the full agent payout list, top performers, and team awards.</li>
                    <li>Process payouts through payroll for agents with verified or converted consents.</li>
                    <li>Share feedback or flag discrepancies with the reporting team.</li>
                  </ul>
                </td>
              </tr>
            </table>

            <!-- Report sections -->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
                   style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:4px;">
              <tr>
                <td style="padding:14px 18px 10px;">
                  <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1e3a5f;">📑 Report Sections (Excel Attachment)</p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr style="background:#e8f0fe;">
                      <td style="padding:7px 12px;font-size:11px;font-weight:700;color:#1f3864;width:36%;border-bottom:1px solid #e5e7eb;">SHEET</td>
                      <td style="padding:7px 12px;font-size:11px;font-weight:700;color:#1f3864;border-bottom:1px solid #e5e7eb;">CONTENTS</td>
                    </tr>
                    <tr style="background:#ffffff;">
                      <td style="padding:7px 12px;font-size:12px;font-weight:600;color:#1f3864;border-bottom:1px solid #f3f4f6;">Summary</td>
                      <td style="padding:7px 12px;font-size:12px;color:#4b5563;border-bottom:1px solid #f3f4f6;">Overall totals — agents, verified, converted consents and total payout per product</td>
                    </tr>
                    <tr style="background:#f8fafc;">
                      <td style="padding:7px 12px;font-size:12px;font-weight:600;color:#1f3864;border-bottom:1px solid #f3f4f6;">All Agents</td>
                      <td style="padding:7px 12px;font-size:12px;color:#4b5563;border-bottom:1px solid #f3f4f6;">Full agent list with verified, converted counts, base payout, and total payout — sorted by total payout</td>
                    </tr>
                    <tr style="background:#ffffff;">
                      <td style="padding:7px 12px;font-size:12px;font-weight:600;color:#166534;border-bottom:1px solid #f3f4f6;">Top Performers</td>
                      <td style="padding:7px 12px;font-size:12px;color:#4b5563;border-bottom:1px solid #f3f4f6;">Top agent per product (most verified consents) with bonus breakdown</td>
                    </tr>
                    <tr style="background:#f8fafc;">
                      <td style="padding:7px 12px;font-size:12px;font-weight:600;color:#92400e;border-bottom:1px solid #f3f4f6;">Team Awards</td>
                      <td style="padding:7px 12px;font-size:12px;color:#4b5563;border-bottom:1px solid #f3f4f6;">Teams that reached ≥ 150 verified consents and qualify for TZS 200,000 drink-up award</td>
                    </tr>
                    <tr style="background:#ffffff;">
                      <td style="padding:7px 12px;font-size:12px;font-weight:600;color:#374151;">Criteria</td>
                      <td style="padding:7px 12px;font-size:12px;color:#4b5563;">2026 incentive rates and thresholds for agents (CS / LBF / SME) and teams</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Metrics grid -->
        <tr>
          <td style="padding:24px 32px 12px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                ${metricCard('Total Agents',     totalAgents,                 '#1f3864')}
                ${metricCard('Verified',          fmt(totalVerified),          '#166534')}
                ${metricCard('Converted',         fmt(totalConverted),         '#92400e')}
                ${metricCard('Agent Payout (TZS)',fmt(totalPayout),            '#1f3864')}
                ${metricCard('Team Awards (TZS)', fmt(teamAwardTotal ?? 0),    '#7c3aed')}
                ${metricCard('Grand Total (TZS)', fmt((totalPayout ?? 0) + (teamAwardTotal ?? 0)), '#166534')}
              </tr>
            </table>
          </td>
        </tr>

        <!-- Product breakdown -->
        <tr>
          <td style="padding:12px 32px 24px;">
            <h3 style="margin:0 0 12px;color:#1f3864;font-size:15px;font-weight:700;">Product Breakdown</h3>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
              <tr style="background:#1f3864;">
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;">PRODUCT</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;text-align:right;">AGENTS</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;text-align:right;">VERIFIED</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;text-align:right;">CONVERTED</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;text-align:right;">TOTAL PAYOUT (TZS)</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;">TOP PERFORMER</td>
              </tr>
              ${productRows}
            </table>
          </td>
        </tr>

        <!-- Attachment note -->
        <tr>
          <td style="padding:0 32px 28px;">
            <div style="background:linear-gradient(135deg,#1f3864,#2e74b5);border-radius:8px;padding:20px 24px;text-align:center;">
              <p style="margin:0 0 6px;color:rgba(255,255,255,0.9);font-size:13px;">
                📎 The complete Excel report is attached to this email.
              </p>
              <p style="margin:0;color:#fff;font-size:14px;font-weight:600;">
                Sheets: Procedure · Summary · All Agents · Top Performers · Team Awards · Criteria
              </p>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
            <p style="margin:0;color:#9ca3af;font-size:11px;">
              This is an automated report from the PCL Analysis — Consent Incentive system.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
