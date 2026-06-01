/** HTML email body for the Social Media Analysis report. */
export function buildSocialMediaEmailHTML(d) {
  const generated = new Date().toLocaleString('en-GB');
  const fmt = (n) => Math.round(n ?? 0).toLocaleString();
  const pct = (r) => `${Math.round((r ?? 0) * 100)}%`;

  const platformRows = Object.entries(d.byPlatform)
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, 8)
    .map(([name, agg], i) => {
      const bg = i % 2 === 0 ? '#f8fafc' : '#ffffff';
      const qPct = agg.total > 0 ? agg.quality / agg.total : 0;
      const cPct = agg.total > 0 ? agg.converted / agg.total : 0;
      return `
        <tr style="background:${bg};">
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;font-weight:600;color:#1f3864;">${name}</td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;">${fmt(agg.total)}</td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;color:#166534;">${fmt(agg.quality)}</td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:700;color:${qPct >= 0.30 ? '#166534' : '#92400e'};">${pct(qPct)}</td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;color:#7c3aed;font-weight:600;">${fmt(agg.converted)}</td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:700;color:${cPct >= 0.10 ? '#166534' : '#92400e'};">${pct(cPct)}</td>
        </tr>`;
    }).join('');

  // Per-product loan amount table (New / Repeat / Total)
  const PRODUCTS_ORDER = ['CS', 'LBF', 'SME', 'OTHERS'];
  const loanRows = PRODUCTS_ORDER
    .filter((p) => d.byProduct?.[p])
    .map((p, i) => {
      const a  = d.byProduct[p];
      const bg = i % 2 === 0 ? '#f8fafc' : '#ffffff';
      return `
        <tr style="background:${bg};">
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#1f3864;">${p}</td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;color:#1e40af;">
            <strong>${fmt(a.newLoanAmount)}</strong>
            <span style="color:#6b7280;font-weight:500;"> (${fmt(a.newSales)})</span>
          </td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;color:#92400e;">
            <strong>${fmt(a.repeatLoanAmount)}</strong>
            <span style="color:#6b7280;font-weight:500;"> (${fmt(a.repeatSales)})</span>
          </td>
          <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:700;color:#7c3aed;">${fmt(a.loanAmount)}</td>
        </tr>`;
    }).join('');

  const topAgentRows = d.byAgent.slice(0, 5).map((a, i) => {
    const bg = i % 2 === 0 ? '#f8fafc' : '#ffffff';
    return `
      <tr style="background:${bg};">
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:right;">${i + 1}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:12px;font-weight:600;color:#1f3864;">${a.agent}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:12px;text-align:center;color:#6b7280;">${a.source}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:12px;text-align:right;font-weight:600;">${fmt(a.total)}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:12px;text-align:right;color:#166534;">${fmt(a.quality)}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-size:12px;text-align:right;color:#7c3aed;font-weight:700;">${fmt(a.converted)}</td>
      </tr>`;
  }).join('');

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
  <title>Social Media Analysis Report</title>
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
              📊 SOCIAL MEDIA ANALYSIS REPORT
            </h1>
            <p style="margin:10px 0 0;color:rgba(255,255,255,0.9);font-size:16px;font-weight:500;">${d.monthLabel}</p>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.7);font-size:12px;">Generated: ${generated}</p>
          </td>
        </tr>

        <!-- Intro -->
        <tr>
          <td style="padding:28px 40px 0;">
            <p style="margin:0 0 6px;font-size:14px;color:#374151;">Dear Manager,</p>
            <p style="margin:0 0 18px;font-size:13px;color:#4b5563;line-height:1.7;">
              Please find the <strong>Social Media Analysis</strong> for <strong>${d.monthLabel}</strong>,
              pulled live from the LBF/SME and CS call-centre Google Sheets and rolled up into the standard
              Call Centre report format (Data · Agent Performance · Dispositions).
            </p>
          </td>
        </tr>

        <!-- Metrics grid -->
        <tr>
          <td style="padding:8px 32px 12px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                ${metricCard('Total Leads',  fmt(d.total),       '#1f3864')}
                ${metricCard('Quality',      fmt(d.quality),     '#166534')}
                ${metricCard('% Quality',    pct(d.qualityRate), d.qualityRate >= 0.30 ? '#166534' : '#92400e')}
                ${metricCard('Converted',    fmt(d.converted),   '#7c3aed')}
                ${metricCard('Conv Rate',    pct(d.convRate),    d.convRate >= 0.10 ? '#166534' : '#92400e')}
                ${metricCard('Agents',       fmt(d.agentCount),  '#1f3864')}
              </tr>
            </table>
          </td>
        </tr>

        <!-- Platform breakdown -->
        <tr>
          <td style="padding:18px 32px 8px;">
            <h3 style="margin:0 0 12px;color:#1f3864;font-size:15px;font-weight:700;">By Platform (top 8)</h3>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
              <tr style="background:#1f3864;">
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;">PLATFORM</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;text-align:right;">TOTAL</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;text-align:right;">QUALITY</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;text-align:right;">% QUAL</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;text-align:right;">CONVERTED</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;text-align:right;">CONV %</td>
              </tr>
              ${platformRows}
            </table>
          </td>
        </tr>

        <!-- Loan amount by product -->
        <tr>
          <td style="padding:14px 32px 8px;">
            <h3 style="margin:0 0 4px;color:#1f3864;font-size:15px;font-weight:700;">
              Loan Amount by Product
              <span style="font-size:11px;color:#9ca3af;font-weight:500;margin-left:6px;">amount (count of sales)</span>
            </h3>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:8px;">
              <tr style="background:#1f3864;">
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;">PRODUCT</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;text-align:right;">NEW</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;text-align:right;">REPEAT</td>
                <td style="padding:10px 14px;color:#fff;font-size:12px;font-weight:700;text-align:right;">TOTAL LOAN AMOUNT</td>
              </tr>
              ${loanRows}
              <tr style="background:#eef2ff;">
                <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;font-weight:700;color:#1f3864;">TOTAL</td>
                <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;color:#1e40af;font-weight:700;">
                  ${fmt(d.newLoanAmount)} <span style="color:#6b7280;font-weight:500;">(${fmt(d.newSales)})</span>
                </td>
                <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;color:#92400e;font-weight:700;">
                  ${fmt(d.repeatLoanAmount)} <span style="color:#6b7280;font-weight:500;">(${fmt(d.repeatSales)})</span>
                </td>
                <td style="padding:10px 14px;border:1px solid #e5e7eb;font-size:13px;text-align:right;color:#7c3aed;font-weight:700;">
                  ${fmt(d.loanAmount)}
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Top agents -->
        <tr>
          <td style="padding:14px 32px 24px;">
            <h3 style="margin:0 0 12px;color:#1f3864;font-size:15px;font-weight:700;">Top Agents</h3>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
              <tr style="background:#1f3864;">
                <td style="padding:8px 12px;color:#fff;font-size:11px;font-weight:700;text-align:right;">#</td>
                <td style="padding:8px 12px;color:#fff;font-size:11px;font-weight:700;">AGENT</td>
                <td style="padding:8px 12px;color:#fff;font-size:11px;font-weight:700;text-align:center;">SOURCE</td>
                <td style="padding:8px 12px;color:#fff;font-size:11px;font-weight:700;text-align:right;">CALLS</td>
                <td style="padding:8px 12px;color:#fff;font-size:11px;font-weight:700;text-align:right;">QUAL</td>
                <td style="padding:8px 12px;color:#fff;font-size:11px;font-weight:700;text-align:right;">CONV</td>
              </tr>
              ${topAgentRows}
            </table>
          </td>
        </tr>

        <!-- Attachment note -->
        <tr>
          <td style="padding:0 32px 28px;">
            <div style="background:linear-gradient(135deg,#1f3864,#2e74b5);border-radius:8px;padding:20px 24px;text-align:center;">
              <p style="margin:0 0 6px;color:rgba(255,255,255,0.9);font-size:13px;">
                📎 Full Excel report is attached.
              </p>
              <p style="margin:0;color:#fff;font-size:14px;font-weight:600;">
                Sheets: Data · Agent Performance · Dispositions
              </p>
            </div>
          </td>
        </tr>

        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e5e7eb;text-align:center;">
            <p style="margin:0;color:#9ca3af;font-size:11px;">
              Generated automatically by PCL Analysis — Social Media module.
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
