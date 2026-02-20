/**
 * HTML email template for HOD Score Card Report
 * Beautiful, detailed email for managers with instructions and highlights
 * @param {string} mode - 'WEEKLY' or 'MONTHLY'
 * @param {string} dateRangeStr - "From 26th January to 31st January 2026"
 * @param {boolean} hasAttachment - whether Excel is attached
 */
export const buildScoreCardEmailHTML = (mode, dateRangeStr, hasAttachment) => {
  const reportType = mode === 'WEEKLY' ? 'Weekly' : 'Monthly';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HOD Score Card ${reportType} Report</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f6f9; padding: 24px 16px;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #2a5298 0%, #1e3c72 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: 0.5px;">
                📊 HOD SCORE CARD
              </h1>
              <p style="margin: 12px 0 0; color: rgba(255,255,255,0.9); font-size: 18px; font-weight: 500;">
                ${reportType} Report
              </p>
              ${dateRangeStr ? `<p style="margin: 8px 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">${dateRangeStr}</p>` : ''}
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 32px 40px 24px;">
              <p style="margin: 0 0 20px; color: #2d3748; font-size: 16px;">
                Dear Manager,
              </p>
              <p style="margin: 0 0 20px; color: #4a5568; font-size: 15px;">
                Please find your <strong>HOD Score Card ${reportType} Report</strong> for review. This report consolidates key performance metrics across Management Summary, Sales &amp; Compliance, Production, Leads &amp; Marketing, Product Sales (MTD), and Call Center Performance.
              </p>
            </td>
          </tr>

          <!-- Instructions -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <div style="background: #E9EEF7; border-left: 4px solid #2a5298; padding: 20px 24px; border-radius: 0 8px 8px 0;">
                <h3 style="margin: 0 0 12px; color: #2a5298; font-size: 16px;">📋 Instructions</h3>
                <ul style="margin: 0; padding-left: 20px; color: #4a5568; font-size: 14px;">
                  <li style="margin-bottom: 8px;">Review the summary data in this email for a quick overview.</li>
                  <li style="margin-bottom: 8px;">${
                    hasAttachment
                      ? '<strong>Download the attached Excel report</strong> for detailed insights, full tables, charts, and deeper analysis.'
                      : 'Access the full report in the HOD Score Card dashboard for detailed insights and deeper analysis.'
                  }</li>
                  <li style="margin-bottom: 8px;">Share feedback or questions with your team lead or the reporting team.</li>
                  <li style="margin-bottom: 0;">Use this data to track progress, identify trends, and drive performance improvements.</li>
                </ul>
              </div>
            </td>
          </tr>

          <!-- Report sections overview -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <h3 style="margin: 0 0 16px; color: #2d3748; font-size: 16px;">📑 Report Sections</h3>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Management Summary</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Clients (active, inactive, total) and Sales (target, disbursement, % achieved, no. loans, active reps) for CS, LBF, SME, Agrifinance — latest week snapshot</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Sales &amp; Compliance Summary</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Target, disbursement, portfolio, CRM, Call Center metrics</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Production Sales Tracker</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Production and sales performance</td>
                </tr>
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Leads &amp; Marketing Tracker</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Leads, prospects, agent activity</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Product Sales Tracker (MTD)</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Supervision, team leaders, % achieved, active reps</td>
                </tr>
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Call Center Performance</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Total calls, success rates, agent performance, % calls reached</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background: linear-gradient(135deg, #2a5298 0%, #1e3c72 100%); padding: 24px; border-radius: 8px; text-align: center;">
                <p style="margin: 0 0 8px; color: rgba(255,255,255,0.9); font-size: 14px;">
                  ${
                    hasAttachment
                      ? '📎 The complete Excel report is attached to this email.'
                      : 'Access the full report in the HOD Score Card dashboard.'
                  }
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 15px; font-weight: 600;">
                  Download the report for deeper insight and detailed analysis.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f8fafc; padding: 24px 40px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; color: #718096; font-size: 12px;">
                This is an automated report from the PCL Analysis HOD Score Card system.
              </p>
              <p style="margin: 8px 0 0; color: #a0aec0; font-size: 11px;">
                For questions or feedback, please reply to this email or contact your administrator.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
