/**
 * HTML email templates for Gap Analysis: Managers, Team Leader / RSM
 */

/** Accounting format: numbers with comma separators for readability */
const fmtNum = (n) =>
  n != null && Number.isFinite(n)
    ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : '-';
const fmtPct = (n) => (n != null && Number.isFinite(n) ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%' : '-');

const columnsForProduct = (product) =>
  product === 'CS'
    ? ['rowLabel', 'Target', 'Achieved', 'Remaining', '% Achived', '% Unachived', 'Grade', 'Comment']
    : ['rowLabel', 'Target', 'Achieved', 'Remaining', '% Achived', '% Unachived', 'Grade', 'Comment'];

/** Row to display values (row may have Grade and Comment from caller) */
const rowToCells = (row, columns) =>
  columns.map((col) => {
    if (col === 'rowLabel') return row.rowLabel ?? '';
    const v = row[col];
    if (col === 'Comment') return v ?? '';
    if (col === 'Grade') return v ?? '';
    if (typeof v === 'number' && (col === '% Achived' || col === '% Unachived')) return fmtPct(v);
    if (typeof v === 'number') return fmtNum(v);
    return v ?? '';
  });

const defaultGradeColors = { A: '#7B1FA2', B: '#1976D2', C: '#388E3C', D: '#F57C00', E: '#C62828' };
const defaultCommentColors = { EXCELLENT: '#388E3C', STANDARD: '#1976D2', 'BELOW STANDARD': '#F57C00', 'NOT ACCEPTABLE': '#C62828' };

/** Build HTML table from gap rows with colored Grade and Comment cells */
export const gapTableHTMLWithColors = (rows, columns, gradeColors = defaultGradeColors, commentColors = defaultCommentColors) => {
  if (!rows?.length) return '<p>No data</p>';
  const headers = columns.filter((c) => c !== 'rowLabel');
  let html = '<table style="border-collapse: collapse; width: 100%; margin: 12px 0;">';
  html += '<thead><tr style="background: #1A237E; color: #fff;">';
  html += '<th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Metric</th>';
  headers.forEach((h) => {
    html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: right;">${h}</th>`;
  });
  html += '</tr></thead><tbody>';
  rows.forEach((row, i) => {
    const cells = rowToCells(row, columns);
    const bg = i % 2 === 0 ? '#fff' : '#f8fafc';
    html += `<tr style="background: ${bg};">`;
    html += `<td style="border: 1px solid #ddd; padding: 8px; font-weight: 500;">${escapeHtml(row.rowLabel || '')}</td>`;
    headers.forEach((h, idx) => {
      const val = cells[columns.indexOf(h)];
      const isGrade = h === 'Grade';
      const isComment = h === 'Comment';
      const cellBg = isGrade && gradeColors[String(val).trim()]
        ? gradeColors[String(val).trim()]
        : isComment && commentColors[String(val).toUpperCase().trim()]
          ? commentColors[String(val).toUpperCase().trim()]
          : '';
      const style = `border: 1px solid #ddd; padding: 8px; text-align: right;${cellBg ? ` background: ${cellBg}; color: #fff; font-weight: 600;` : ''}`;
      html += `<td style="${style}">${escapeHtml(String(val ?? ''))}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
};

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Blue header block: product label + date of report, centered, white text */
const emailHeaderBlock = (product, dateOfReport) => `
  <div style="background: #1A237E; color: #fff; text-align: center; padding: 20px 16px; margin: 0 0 24px 0; border-radius: 4px;">
    <h1 style="margin: 0 0 6px 0; font-size: 22px; color: #fff; letter-spacing: 0.02em; font-weight: 700;">${escapeHtml(String(product).toUpperCase())} GAP ANALYSIS</h1>
    <p style="margin: 0; font-size: 14px; color: rgba(255,255,255,0.95);">${escapeHtml(dateOfReport)}</p>
  </div>`;

/** Managers email: full width, blue header, Dear Managers, message, blue instruction box, RSM total table */
export const buildManagersGapEmailHTML = (dateLabel, product, rsmGrandTotalRows, gradeColors = defaultGradeColors, commentColors = defaultCommentColors) => {
  const cols = columnsForProduct(product);
  const tableHtml = gapTableHTMLWithColors(rsmGrandTotalRows, cols, gradeColors, commentColors);

  const message = `
    <p style="margin: 0 0 16px; color: #334155; line-height: 1.6;">
      This is the <strong>Gap Analysis Report</strong> for <strong>${escapeHtml(dateLabel)}</strong> (${escapeHtml(product)}). 
      It compares targets vs achieved figures and shows % Achived, Grade, and Comment for each metric.
    </p>`;

  const instructionBox = `
    <div style="margin: 20px 0; padding: 16px; border: 2px solid #1A237E; border-radius: 8px; background: #E8EAF6;">
      <p style="margin: 0 0 8px; font-weight: 600; color: #1A237E;">How to use this report</p>
      <ul style="margin: 0; padding-left: 20px; color: #334155; line-height: 1.6;">
        <li>Review the <strong>Total of all supervisions</strong> table below for the overall picture.</li>
        <li>The full Excel attachment contains Branch (Team Leader) and RSM sheets with all details.</li>
        <li>We are also sending each Team Leader and each RSM a personal email with their own subsection and attachment.</li>
      </ul>
    </div>`;

  const note = `
    <p style="margin-top: 20px; padding: 12px; background: #E8EAF6; border-radius: 8px; color: #1A237E; font-size: 14px;">
      <strong>Note:</strong> Each Team Leader and each RSM will receive a separate email with their own gap summary and a personalised Excel attachment (only their subsection). They are asked to use the report and to submit any challenge or amendment if they see something wrong.
    </p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f4f6f9;">
  <div style="width: 100%; max-width: 100%; padding: 24px; box-sizing: border-box;">
    <div style="max-width: 1200px; margin: 0 auto; background: #fff; padding: 32px; box-sizing: border-box;">
      ${emailHeaderBlock(product, dateLabel)}
      <p style="margin: 0 0 16px;">Dear <strong>Managers</strong>,</p>
      ${message}
      ${instructionBox}
      <p style="margin: 16px 0 8px; font-weight: 600; color: #1e293b;">Total of all supervisions (RSM)</p>
      ${tableHtml}
      <p style="margin-top: 16px; color: #64748b; font-size: 14px;">Please find the full Gap Analysis Excel file attached.</p>
      ${note}
      <p style="margin-top: 24px; color: #718096; font-size: 12px;">PCL Analysis – Gap Analysis</p>
    </div>
  </div>
</body>
</html>`;
};

/** Legacy full report (kept for any other use) */
export const buildGapAnalysisReportEmailHTML = (dateLabel, product, branchData, rsmData) => {
  const cols = columnsForProduct(product);
  let body = '';
  body += '<h3 style="color: #2a5298;">BRANCH (Team Leaders)</h3>';
  branchData.forEach((item) => {
    body += `<h4 style="margin-top: 16px;">${escapeHtml(item.teamLeaderName)}</h4>`;
    body += `<p style="color: #666; margin: 0 0 8px;">Supervision: ${escapeHtml(item.supervision)}</p>`;
    body += gapTableHTMLWithColors(item.rows, cols);
  });
  body += '<h3 style="color: #2a5298; margin-top: 24px;">RSM (Supervisions)</h3>';
  rsmData.forEach((item) => {
    body += `<h4 style="margin-top: 16px;">${escapeHtml(item.supervision)}</h4>`;
    body += gapTableHTMLWithColors(item.rows, cols);
  });
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin: 0; padding: 24px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f4f6f9;">
  <div style="max-width: 700px; margin: 0 auto; background: #fff; padding: 32px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">
    <h1 style="margin: 0 0 8px; color: #2a5298;">GAP ANALYSIS REPORT</h1>
    <p style="margin: 0 0 24px; color: #666;">${dateLabel} – ${product}</p>
    ${body}
    <p style="margin-top: 24px; color: #718096; font-size: 12px;">This is an automated report from the PCL Analysis system.</p>
  </div>
</body>
</html>`;
};

/** Email to a single team leader or RSM: full width, blue header, greeting, message, blue instruction box, table, CTA */
export const buildTeamLeaderGapEmailHTML = (teamLeaderName, supervision, product, rows, dateLabel, commentPoorPerformance, responseUrl = '', options = {}) => {
  const cols = columnsForProduct(product);
  const gradeColors = options.gradeColors || defaultGradeColors;
  const commentColors = options.commentColors || defaultCommentColors;
  const tableHtml = gapTableHTMLWithColors(rows, cols, gradeColors, commentColors);
  const isRSM = options.isRSM === true;

  const greeting = `<p style="margin: 0 0 16px;">Dear <strong>${escapeHtml(teamLeaderName)}</strong>,</p>
    <p style="margin: 0 0 8px;">Supervision: <strong>${escapeHtml(supervision)}</strong></p>`;

  const message = `
    <p style="margin: 0 0 16px; color: #334155; line-height: 1.6;">
      Please find below your <strong>Gap Analysis summary</strong> for <strong>${escapeHtml(dateLabel)}</strong> (${escapeHtml(product)}).
      Your personalised Excel file (only your subsection) is attached.
    </p>`;

  const instructionBox = `
    <div style="margin: 20px 0; padding: 16px; border: 2px solid #1A237E; border-radius: 8px; background: #E8EAF6;">
      <p style="margin: 0 0 8px; font-weight: 600; color: #1A237E;">What to do</p>
      <ul style="margin: 0; padding-left: 20px; color: #334155; line-height: 1.6;">
        <li>Review your gap table below and the attached Excel.</li>
        <li>If you see anything wrong in the report (e.g. data, figures, or names), please <strong>click the button below</strong> to submit a <strong>Challenge or Amendment</strong>. We will review and update the report where needed.</li>
      </ul>
    </div>`;

  let ctaBlock = '';
  if (responseUrl) {
    ctaBlock = `
    <p style="margin: 8px 0 16px;">
      <a href="${responseUrl}" style="display: inline-block; padding: 14px 28px; background: #1A237E; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Report a challenge or amendment</a>
    </p>
    <p style="margin: 0 0 16px; color: #718096; font-size: 14px;">Use this button to tell us if anything in the report is incorrect or needs to be updated. Do not reply to this email.</p>`;
  } else {
    ctaBlock = '<p style="margin: 16px 0 0; color: #64748b; font-size: 14px;">If you need to report a challenge or amendment, please contact your manager.</p>';
  }

  let extraMessage = '';
  if (commentPoorPerformance && !isRSM) {
    extraMessage = '<p style="color: #b45309; font-weight: 600; margin: 0 0 16px;">Your current figures are below target. Please increase effort where possible.</p>';
  }

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f4f6f9;">
  <div style="width: 100%; max-width: 100%; padding: 24px; box-sizing: border-box;">
    <div style="max-width: 1200px; margin: 0 auto; background: #fff; padding: 32px; box-sizing: border-box;">
      ${emailHeaderBlock(product, dateLabel)}
      ${greeting}
      ${message}
      ${extraMessage}
      ${instructionBox}
      <p style="margin: 16px 0 8px; font-weight: 600;">Your gap table</p>
      ${tableHtml}
      ${ctaBlock}
      <p style="margin-top: 24px; color: #718096; font-size: 12px;">PCL Analysis – Gap Analysis</p>
    </div>
  </div>
</body>
</html>`;
};

/** Detect if comment indicates poor performance (for dynamic message in TL email) */
export const isPoorPerformanceComment = (comment) => {
  if (!comment || typeof comment !== 'string') return false;
  const u = comment.toUpperCase();
  return u.includes('BELOW') || u.includes('POOR') || u.includes('LOW') || u.includes('INCREASE');
};
