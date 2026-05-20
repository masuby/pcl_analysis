const pct = (v) => (v == null ? '-' : `${Number(v).toFixed(1)}%`);

const fmt = (v) => {
  if (!v && v !== 0) return '0';
  const n = Number(v);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
};

const sumArr = (arr) => (arr || []).reduce((s, v) => s + (v || 0), 0);

const achColor = (p) => {
  if (p >= 100) return '#276749';
  if (p >= 80)  return '#c05621';
  return '#c53030';
};
const achBg = (p) => {
  if (p >= 100) return '#f0fff4';
  if (p >= 80)  return '#fffaf0';
  return '#fff5f5';
};

const productRow = ({ name, color, value, totalGrand, idx }) => {
  const pct    = totalGrand > 0 ? Math.round((value / totalGrand) * 100) : 0;
  const bg     = idx % 2 === 0 ? '#fff' : '#f8fafc';
  return `
  <tr style="background:${bg};">
    <td style="padding:10px 14px;border:1px solid #e2e8f0;">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:8px;vertical-align:middle;"></span>
      <strong style="font-size:13px;color:#2d3748;">${name}</strong>
    </td>
    <td style="padding:10px 14px;border:1px solid #e2e8f0;text-align:right;font-size:13px;color:#2d3748;font-weight:700;">${fmt(value)}</td>
    <td style="padding:10px 14px;border:1px solid #e2e8f0;text-align:right;font-size:13px;color:#718096;">${pct}%</td>
  </tr>`;
};

const monthRow = ({ label, cs, lbf, sme, grand, tgt, ach, idx }) => {
  const bg = idx % 2 === 0 ? '#fff' : '#f8fafc';
  return `
  <tr style="background:${bg};">
    <td style="padding:8px 12px;border:1px solid #e2e8f0;font-size:12px;font-weight:600;color:#4a5568;">${label}</td>
    <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-size:12px;color:#2a5298;font-weight:600;">${fmt(cs)}</td>
    <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-size:12px;color:#c05621;font-weight:600;">${fmt(lbf)}</td>
    <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-size:12px;color:#276749;font-weight:600;">${fmt(sme)}</td>
    <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-size:12px;font-weight:700;color:#2d3748;">${fmt(grand)}</td>
    <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-size:12px;color:#4a5568;">${fmt(tgt)}</td>
    <td style="padding:8px 12px;border:1px solid #e2e8f0;text-align:right;font-size:12px;font-weight:800;color:${achColor(ach)};background:${achBg(ach)};">${ach}%</td>
  </tr>`;
};

/* ════════════════════════════════════════════════════════
   COMBINED / TOTAL EMAIL  (multiple years)
════════════════════════════════════════════════════════ */
export const buildMarketingEmailHTMLTotal = (allYearsData) => {
  const years = Object.keys(allYearsData).map(Number).sort((a, b) => a - b);
  if (!years.length) return '<p>No data available.</p>';

  const yearRows = years.map((y, idx) => {
    const d     = allYearsData[y];
    const cs    = sumArr(d.segCS);
    const lbf   = sumArr(d.segLBF);
    const sme   = sumArr(d.segSME);
    const grand = cs + lbf + sme;
    const tgt   = sumArr(d.target);
    const act   = sumArr(d.actual);
    const ach   = tgt > 0 ? Math.round((act / tgt) * 100) : 0;
    const prevY = idx > 0 ? years[idx - 1] : null;
    const prevGrand = prevY
      ? sumArr(allYearsData[prevY].segCS) + sumArr(allYearsData[prevY].segLBF) + sumArr(allYearsData[prevY].segSME)
      : null;
    const yoy = prevGrand > 0 ? (((grand - prevGrand) / prevGrand) * 100) : null;
    return { y, cs, lbf, sme, grand, tgt, act, ach, yoy };
  });

  const grandCS    = yearRows.reduce((s, r) => s + r.cs,  0);
  const grandLBF   = yearRows.reduce((s, r) => s + r.lbf, 0);
  const grandSME   = yearRows.reduce((s, r) => s + r.sme, 0);
  const grandTotal = grandCS + grandLBF + grandSME;
  const grandTarget = yearRows.reduce((s, r) => s + r.tgt, 0);
  const grandActual = yearRows.reduce((s, r) => s + r.act, 0);
  const grandAch    = grandTarget > 0 ? Math.round((grandActual / grandTarget) * 100) : 0;

  const yearTableRows = yearRows.map((r, i) => {
    const bg = i % 2 === 0 ? '#fff' : '#f8fafc';
    return `
    <tr style="background:${bg};">
      <td style="padding:9px 12px;border:1px solid #e2e8f0;font-weight:700;color:#1e3a5f;">${r.y}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0;text-align:right;color:#2a5298;font-weight:600;">${fmt(r.cs)}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0;text-align:right;color:#c05621;font-weight:600;">${fmt(r.lbf)}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0;text-align:right;color:#276749;font-weight:600;">${fmt(r.sme)}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0;text-align:right;font-weight:800;color:#2d3748;">${fmt(r.grand)}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0;text-align:right;color:#4a5568;">${fmt(r.tgt)}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0;text-align:right;font-weight:800;color:${achColor(r.ach)};background:${achBg(r.ach)};">${r.ach}%</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0;text-align:right;font-weight:700;color:${r.yoy == null ? '#94a3b8' : r.yoy >= 0 ? '#276749' : '#c53030'};">
        ${r.yoy == null ? '—' : (r.yoy >= 0 ? '▲' : '▼') + ' ' + Math.abs(r.yoy).toFixed(1) + '%'}
      </td>
    </tr>`;
  }).join('');

  const products = [
    { name: 'Civil Servant',            color: '#2a5298', value: grandCS  },
    { name: 'Log Book Finance',         color: '#e67e22', value: grandLBF },
    { name: 'SME',                      color: '#27ae60', value: grandSME },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Digital Sales Combined Report — ${years.join(' & ')}</title>
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f0f4f8;line-height:1.6;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0f4f8;padding:28px 16px;">
<tr><td align="center">
<table role="presentation" width="660" cellspacing="0" cellpadding="0"
  style="max-width:660px;background:#fff;border-radius:16px;box-shadow:0 6px 32px rgba(0,0,0,0.10);overflow:hidden;">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#1a3a6c 0%,#2a5298 50%,#3a63b3 100%);padding:36px 44px;text-align:center;">
      <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;margin-bottom:12px;">&#128202;</div>
      <h1 style="margin:0;color:#fff;font-size:22px;font-weight:800;letter-spacing:0.5px;">DIGITAL SALES — COMBINED REPORT</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:15px;font-weight:600;">${years.join(' &amp; ')} &mdash; Civil Servant &middot; Log Book Finance &middot; SME</p>
    </td>
  </tr>

  <!-- Grand KPI banner -->
  <tr>
    <td style="padding:24px 44px 0;">
      <div style="background:linear-gradient(135deg,#e6f0ff,#f0f8e6);border-radius:12px;padding:20px 24px;border:1px solid #d1e3ff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td>
              <p style="margin:0;font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Combined Achievement (${years.join(' + ')})</p>
              <p style="margin:4px 0 0;font-size:40px;font-weight:900;color:${achColor(grandAch)};">${grandAch}%</p>
              <p style="margin:4px 0 0;font-size:13px;color:#4a5568;">
                Actual: <strong>${fmt(grandActual)}</strong> &nbsp;|&nbsp;
                Target: <strong>${fmt(grandTarget)}</strong> &nbsp;|&nbsp;
                Gap: <strong style="color:${grandActual >= grandTarget ? '#276749' : '#c53030'};">${fmt(Math.abs(grandTarget - grandActual))}</strong>
              </p>
            </td>
            <td style="text-align:right;width:140px;">
              <p style="margin:0;font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;">${years.length} Years</p>
              <p style="margin:4px 0 0;font-size:28px;font-weight:900;color:#2a5298;">${fmt(grandTotal)}</p>
              <p style="margin:4px 0 0;font-size:12px;color:#718096;">Grand Total Sales</p>
            </td>
          </tr>
        </table>
      </div>
    </td>
  </tr>

  <!-- Product KPI mini-cards -->
  <tr>
    <td style="padding:16px 44px 0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td width="33%" style="padding-right:6px;">
            <div style="background:#f0f8ff;border-radius:10px;padding:12px 14px;text-align:center;border:1px solid #bfdbfe;border-top:4px solid #2a5298;">
              <p style="margin:0;font-size:10px;color:#1e40af;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;">Civil Servant</p>
              <p style="margin:5px 0 0;font-size:20px;font-weight:900;color:#2a5298;">${fmt(grandCS)}</p>
              <p style="margin:2px 0 0;font-size:11px;color:#718096;">${grandTotal > 0 ? Math.round((grandCS/grandTotal)*100) : 0}% of total</p>
            </div>
          </td>
          <td width="33%" style="padding-right:6px;">
            <div style="background:#fffaf0;border-radius:10px;padding:12px 14px;text-align:center;border:1px solid #fbd38d;border-top:4px solid #e67e22;">
              <p style="margin:0;font-size:10px;color:#c05621;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;">Log Book Finance</p>
              <p style="margin:5px 0 0;font-size:20px;font-weight:900;color:#e67e22;">${fmt(grandLBF)}</p>
              <p style="margin:2px 0 0;font-size:11px;color:#718096;">${grandTotal > 0 ? Math.round((grandLBF/grandTotal)*100) : 0}% of total</p>
            </div>
          </td>
          <td width="33%">
            <div style="background:#f0fff4;border-radius:10px;padding:12px 14px;text-align:center;border:1px solid #9ae6b4;border-top:4px solid #27ae60;">
              <p style="margin:0;font-size:10px;color:#276749;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;">SME</p>
              <p style="margin:5px 0 0;font-size:20px;font-weight:900;color:#27ae60;">${fmt(grandSME)}</p>
              <p style="margin:2px 0 0;font-size:11px;color:#718096;">${grandTotal > 0 ? Math.round((grandSME/grandTotal)*100) : 0}% of total</p>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Year-by-Year Table -->
  <tr>
    <td style="padding:22px 44px 0;">
      <h3 style="margin:0 0 12px;color:#1e3a5f;font-size:14px;font-weight:700;border-left:4px solid #2a5298;padding-left:10px;">Year-by-Year Performance</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
        style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:12px;">
        <thead>
          <tr style="background:linear-gradient(135deg,#2a5298,#1e3c72);">
            <th style="padding:9px 12px;text-align:left;color:#fff;font-size:11px;font-weight:700;">Year</th>
            <th style="padding:9px 12px;text-align:right;color:#90cdf4;font-size:11px;font-weight:700;">Civil Servant</th>
            <th style="padding:9px 12px;text-align:right;color:#fbd38d;font-size:11px;font-weight:700;">LBF</th>
            <th style="padding:9px 12px;text-align:right;color:#9ae6b4;font-size:11px;font-weight:700;">SME</th>
            <th style="padding:9px 12px;text-align:right;color:#fff;font-size:11px;font-weight:700;">Grand Total</th>
            <th style="padding:9px 12px;text-align:right;color:#fff;font-size:11px;font-weight:700;">Target</th>
            <th style="padding:9px 12px;text-align:right;color:#ffd700;font-size:11px;font-weight:700;">Ach%</th>
            <th style="padding:9px 12px;text-align:right;color:#9ae6b4;font-size:11px;font-weight:700;">YoY</th>
          </tr>
        </thead>
        <tbody>
          ${yearTableRows}
          <tr style="background:#1e3c72;">
            <td style="padding:10px 12px;font-weight:800;color:#fff;border:1px solid #2a5298;">ALL YEARS</td>
            <td style="padding:10px 12px;text-align:right;font-weight:800;color:#90cdf4;border:1px solid #2a5298;">${fmt(grandCS)}</td>
            <td style="padding:10px 12px;text-align:right;font-weight:800;color:#fbd38d;border:1px solid #2a5298;">${fmt(grandLBF)}</td>
            <td style="padding:10px 12px;text-align:right;font-weight:800;color:#9ae6b4;border:1px solid #2a5298;">${fmt(grandSME)}</td>
            <td style="padding:10px 12px;text-align:right;font-weight:800;color:#ffd700;border:1px solid #2a5298;">${fmt(grandTotal)}</td>
            <td style="padding:10px 12px;text-align:right;font-weight:800;color:#fff;border:1px solid #2a5298;">${fmt(grandTarget)}</td>
            <td style="padding:10px 12px;text-align:right;font-weight:900;color:${achColor(grandAch)};background:${achBg(grandAch)};border:1px solid #2a5298;">${grandAch}%</td>
            <td style="padding:10px 12px;text-align:right;color:#94a3b8;border:1px solid #2a5298;">—</td>
          </tr>
        </tbody>
      </table>
    </td>
  </tr>

  <!-- Product Totals -->
  <tr>
    <td style="padding:22px 44px 0;">
      <h3 style="margin:0 0 12px;color:#1e3a5f;font-size:14px;font-weight:700;border-left:4px solid #27ae60;padding-left:10px;">Product Mix — All Years Combined</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
        style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:linear-gradient(135deg,#2a5298,#1e3c72);">
            <th style="padding:10px 14px;text-align:left;color:#fff;font-size:12px;font-weight:700;">Product</th>
            <th style="padding:10px 14px;text-align:right;color:#fff;font-size:12px;font-weight:700;">Total Sales</th>
            <th style="padding:10px 14px;text-align:right;color:#fff;font-size:12px;font-weight:700;">% of Total</th>
          </tr>
        </thead>
        <tbody>
          ${products.map((p, i) => productRow({ ...p, totalGrand: grandTotal, idx: i })).join('')}
          <tr style="background:#1e3c72;">
            <td style="padding:10px 14px;font-weight:800;color:#fff;border:1px solid #2a5298;">GRAND TOTAL</td>
            <td style="padding:10px 14px;text-align:right;font-weight:800;color:#ffd700;border:1px solid #2a5298;">${fmt(grandTotal)}</td>
            <td style="padding:10px 14px;text-align:right;font-weight:800;color:#fff;border:1px solid #2a5298;">100%</td>
          </tr>
        </tbody>
      </table>
    </td>
  </tr>

  <!-- Message -->
  <tr>
    <td style="padding:22px 44px 0;">
      <div style="background:#f0f4ff;border-left:4px solid #2a5298;padding:16px 20px;border-radius:0 10px 10px 0;">
        <p style="margin:0 0 6px;color:#1e3a5f;font-size:13px;font-weight:700;">Dear Team,</p>
        <p style="margin:0;color:#4a5568;font-size:13px;line-height:1.7;">
          Please find attached the Combined Digital Sales Analysis covering <strong>${years.join(' and ')}</strong>.
          The report includes a year-over-year summary, per-year overviews, and individual product breakdowns
          (Civil Servant, Log Book Finance, and SME). Full interactive charts are available on the dashboard.
        </p>
      </div>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#f8fafc;padding:18px 44px;margin-top:24px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="margin:0;color:#718096;font-size:11px;">Digital Sales Marketing Analysis &middot; PCL Analysis System</p>
      <p style="margin:5px 0 0;color:#a0aec0;font-size:10px;">For questions, contact your reporting administrator.</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
};

export const buildMarketingEmailHTML = ({ yearData, compareData }) => {
  if (!yearData) return '<p>No data available.</p>';

  const { year, monthLabels, segCS, segLBF, segSME, target, actual, achievement } = yearData;
  const totalCS     = sumArr(segCS);
  const totalLBF    = sumArr(segLBF);
  const totalSME    = sumArr(segSME);
  const totalGrand  = totalCS + totalLBF + totalSME;
  const totalTarget = sumArr(target);
  const totalActual = sumArr(actual);
  const overallAch  = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;

  const prevTotalActual = compareData ? sumArr(compareData.actual) : 0;
  const yoyChange       = prevTotalActual > 0
    ? (((totalActual - prevTotalActual) / prevTotalActual) * 100)
    : null;

  const products = [
    { name: 'CS — Civil Servant',            color: '#2a5298', value: totalCS  },
    { name: 'LBF — Log Book Finance',         color: '#e67e22', value: totalLBF },
    { name: 'SME — Small & Medium Enterprise', color: '#27ae60', value: totalSME },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Digital Sales Marketing Analysis ${year}</title>
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f0f4f8;line-height:1.6;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0f4f8;padding:28px 16px;">
<tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0"
  style="max-width:640px;background:#fff;border-radius:16px;box-shadow:0 6px 32px rgba(0,0,0,0.10);overflow:hidden;">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#1a3a6c 0%,#2a5298 50%,#3a63b3 100%);padding:36px 44px;text-align:center;">
      <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;margin-bottom:12px;">&#128200;</div>
      <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;letter-spacing:0.5px;">DIGITAL SALES MARKETING ANALYSIS</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:16px;font-weight:600;">Civil Servant &middot; Log Book Finance &middot; SME &mdash; ${year}</p>
    </td>
  </tr>

  <!-- Overall Banner -->
  <tr>
    <td style="padding:24px 44px 0;">
      <div style="background:linear-gradient(135deg,#e6f0ff,#f0f8e6);border-radius:12px;padding:20px 24px;border:1px solid #d1e3ff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td>
              <p style="margin:0;font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">Overall Achievement ${year}</p>
              <p style="margin:4px 0 0;font-size:40px;font-weight:900;color:${achColor(overallAch)};">${overallAch}%</p>
              <p style="margin:4px 0 0;font-size:13px;color:#4a5568;">
                Actual: <strong>${fmt(totalActual)}</strong> &nbsp;|&nbsp; Target: <strong>${fmt(totalTarget)}</strong>
                &nbsp;|&nbsp; Gap: <strong style="color:${totalActual >= totalTarget ? '#276749' : '#c53030'};">${fmt(Math.abs(totalTarget - totalActual))}</strong>
              </p>
            </td>
            ${yoyChange !== null ? `
            <td style="text-align:right;width:160px;">
              <p style="margin:0;font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;">vs ${compareData.year}</p>
              <p style="margin:4px 0 0;font-size:30px;font-weight:900;color:${yoyChange >= 0 ? '#276749' : '#c53030'};">${yoyChange >= 0 ? '+' : ''}${yoyChange.toFixed(1)}%</p>
              <p style="margin:4px 0 0;font-size:12px;color:#718096;">Year-over-Year</p>
            </td>` : ''}
          </tr>
        </table>
      </div>
    </td>
  </tr>

  <!-- KPI mini-cards -->
  <tr>
    <td style="padding:16px 44px 0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td width="33%" style="padding-right:6px;">
            <div style="background:#f0f8ff;border-radius:10px;padding:12px 14px;text-align:center;border-top:4px solid #2a5298;border:1px solid #bfdbfe;border-top:4px solid #2a5298;">
              <p style="margin:0;font-size:10px;color:#1e40af;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;">CS Sales</p>
              <p style="margin:5px 0 0;font-size:20px;font-weight:900;color:#2a5298;">${fmt(totalCS)}</p>
              <p style="margin:2px 0 0;font-size:11px;color:#718096;">${totalGrand > 0 ? Math.round((totalCS/totalGrand)*100) : 0}% of total</p>
            </div>
          </td>
          <td width="33%" style="padding-right:6px;">
            <div style="background:#fffaf0;border-radius:10px;padding:12px 14px;text-align:center;border:1px solid #fbd38d;border-top:4px solid #e67e22;">
              <p style="margin:0;font-size:10px;color:#c05621;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;">LBF Sales</p>
              <p style="margin:5px 0 0;font-size:20px;font-weight:900;color:#e67e22;">${fmt(totalLBF)}</p>
              <p style="margin:2px 0 0;font-size:11px;color:#718096;">${totalGrand > 0 ? Math.round((totalLBF/totalGrand)*100) : 0}% of total</p>
            </div>
          </td>
          <td width="33%">
            <div style="background:#f0fff4;border-radius:10px;padding:12px 14px;text-align:center;border:1px solid #9ae6b4;border-top:4px solid #27ae60;">
              <p style="margin:0;font-size:10px;color:#276749;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;">SME Sales</p>
              <p style="margin:5px 0 0;font-size:20px;font-weight:900;color:#27ae60;">${fmt(totalSME)}</p>
              <p style="margin:2px 0 0;font-size:11px;color:#718096;">${totalGrand > 0 ? Math.round((totalSME/totalGrand)*100) : 0}% of total</p>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Product Breakdown Table -->
  <tr>
    <td style="padding:22px 44px 0;">
      <h3 style="margin:0 0 12px;color:#1e3a5f;font-size:14px;font-weight:700;border-left:4px solid #2a5298;padding-left:10px;">Product Sales Breakdown (YTD)</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
        style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:linear-gradient(135deg,#2a5298,#1e3c72);">
            <th style="padding:10px 14px;text-align:left;color:#fff;font-size:12px;font-weight:700;">Product</th>
            <th style="padding:10px 14px;text-align:right;color:#fff;font-size:12px;font-weight:700;">Total Sales</th>
            <th style="padding:10px 14px;text-align:right;color:#fff;font-size:12px;font-weight:700;">% of Total</th>
          </tr>
        </thead>
        <tbody>
          ${products.map((p, i) => productRow({ ...p, totalGrand, idx: i })).join('')}
          <tr style="background:#1e3c72;">
            <td style="padding:10px 14px;font-weight:800;color:#fff;font-size:13px;border:1px solid #2a5298;">GRAND TOTAL</td>
            <td style="padding:10px 14px;text-align:right;font-weight:800;color:#ffd700;font-size:13px;border:1px solid #2a5298;">${fmt(totalGrand)}</td>
            <td style="padding:10px 14px;text-align:right;font-weight:800;color:#fff;font-size:13px;border:1px solid #2a5298;">100%</td>
          </tr>
        </tbody>
      </table>
    </td>
  </tr>

  <!-- Monthly Overview Table -->
  <tr>
    <td style="padding:22px 44px 0;">
      <h3 style="margin:0 0 12px;color:#1e3a5f;font-size:14px;font-weight:700;border-left:4px solid #27ae60;padding-left:10px;">Monthly Performance Overview</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"
        style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:12px;">
        <thead>
          <tr style="background:linear-gradient(135deg,#2a5298,#1e3c72);">
            <th style="padding:8px 12px;text-align:left;color:#fff;font-size:11px;font-weight:700;">Month</th>
            <th style="padding:8px 12px;text-align:right;color:#90cdf4;font-size:11px;font-weight:700;">CS</th>
            <th style="padding:8px 12px;text-align:right;color:#fbd38d;font-size:11px;font-weight:700;">LBF</th>
            <th style="padding:8px 12px;text-align:right;color:#9ae6b4;font-size:11px;font-weight:700;">SME</th>
            <th style="padding:8px 12px;text-align:right;color:#fff;font-size:11px;font-weight:700;">Grand</th>
            <th style="padding:8px 12px;text-align:right;color:#fff;font-size:11px;font-weight:700;">Target</th>
            <th style="padding:8px 12px;text-align:right;color:#ffd700;font-size:11px;font-weight:700;">Ach%</th>
          </tr>
        </thead>
        <tbody>
          ${monthLabels.map((label, i) => {
            const grand = (segCS[i]||0) + (segLBF[i]||0) + (segSME[i]||0);
            return monthRow({ label, cs: segCS[i]||0, lbf: segLBF[i]||0, sme: segSME[i]||0, grand, tgt: target[i]||0, ach: achievement[i]||0, idx: i });
          }).join('')}
          <tr style="background:#1e3c72;">
            <td style="padding:9px 12px;font-weight:800;color:#fff;border:1px solid #2a5298;font-size:12px;">TOTAL</td>
            <td style="padding:9px 12px;text-align:right;font-weight:800;color:#90cdf4;border:1px solid #2a5298;font-size:12px;">${fmt(totalCS)}</td>
            <td style="padding:9px 12px;text-align:right;font-weight:800;color:#fbd38d;border:1px solid #2a5298;font-size:12px;">${fmt(totalLBF)}</td>
            <td style="padding:9px 12px;text-align:right;font-weight:800;color:#9ae6b4;border:1px solid #2a5298;font-size:12px;">${fmt(totalSME)}</td>
            <td style="padding:9px 12px;text-align:right;font-weight:800;color:#ffd700;border:1px solid #2a5298;font-size:12px;">${fmt(totalGrand)}</td>
            <td style="padding:9px 12px;text-align:right;font-weight:800;color:#fff;border:1px solid #2a5298;font-size:12px;">${fmt(totalTarget)}</td>
            <td style="padding:9px 12px;text-align:right;font-weight:900;color:${achColor(overallAch)};background:${achBg(overallAch)};border:1px solid #2a5298;font-size:13px;">${overallAch}%</td>
          </tr>
        </tbody>
      </table>
    </td>
  </tr>

  <!-- Message -->
  <tr>
    <td style="padding:22px 44px 0;">
      <div style="background:#f0f4ff;border-left:4px solid #2a5298;padding:16px 20px;border-radius:0 10px 10px 0;">
        <p style="margin:0 0 6px;color:#1e3a5f;font-size:13px;font-weight:700;">Dear Team,</p>
        <p style="margin:0;color:#4a5568;font-size:13px;line-height:1.7;">
          Please find attached the Digital Sales Marketing Analysis for <strong>${year}</strong>.
          Review the CS, LBF, and SME performance trends, track achievement against targets, and identify growth opportunities.
          The full interactive report with detailed charts and pipeline metrics is available on the dashboard.
        </p>
      </div>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#f8fafc;padding:18px 44px;margin-top:24px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="margin:0;color:#718096;font-size:11px;">Digital Sales Marketing Analysis &middot; PCL Analysis System</p>
      <p style="margin:5px 0 0;color:#a0aec0;font-size:10px;">For questions, contact your reporting administrator.</p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
};
