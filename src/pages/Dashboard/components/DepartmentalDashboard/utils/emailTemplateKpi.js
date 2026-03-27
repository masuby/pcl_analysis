/**
 * HTML email template for CS Total KPI Analysis Report (nationwide, 6 KPIs).
 * Use when sending the report for view "Total".
 * @param {string} monthLabel - e.g. "Jan 2026"
 * @param {boolean} hasAttachment - whether Excel report is attached
 */
export const buildKpiReportEmailHTML = (monthLabel, hasAttachment) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CS KPI Analysis Report — ${monthLabel}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f6f9; padding: 24px 16px;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e3a5f 0%, #2a5298 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: 0.5px;">
                📊 CS KPI ANALYSIS REPORT
              </h1>
              <p style="margin: 12px 0 0; color: rgba(255,255,255,0.9); font-size: 18px; font-weight: 500;">
                Total KPI — Nationwide performance standards &amp; targets
              </p>
              ${monthLabel ? `<p style="margin: 8px 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">${monthLabel}</p>` : ''}
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 32px 40px 24px;">
              <p style="margin: 0 0 20px; color: #2d3748; font-size: 16px;">
                Dear Manager,
              </p>
              <p style="margin: 0 0 20px; color: #4a5568; font-size: 15px;">
                Please find your <strong>CS Total KPI Analysis Report</strong> for <strong>${monthLabel || 'the selected month'}</strong>. This report consolidates nationwide key performance indicators: sales target achievement (Mainland + Zanzibar + Call Center), branch sales achievement, new business targets, portfolio growth, PAR 30, active client growth, regions and clusters, CRM usage, and data consent.
              </p>
            </td>
          </tr>

          <!-- Instructions -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <div style="background: #E9EEF7; border-left: 4px solid #1e3a5f; padding: 20px 24px; border-radius: 0 8px 8px 0;">
                <h3 style="margin: 0 0 12px; color: #1e3a5f; font-size: 16px;">📋 Instructions</h3>
                <ul style="margin: 0; padding-left: 20px; color: #4a5568; font-size: 14px;">
                  <li style="margin-bottom: 8px;">Review the KPI Summary and section tables for a quick overview.</li>
                  <li style="margin-bottom: 8px;">${
                    hasAttachment
                      ? '<strong>Download the attached Excel report</strong> for the full workbook: All in One sheet plus individual KPI sheets with detailed data.'
                      : 'Access the full report in the KPI Analysis Report dashboard and use Download xlsx for the complete workbook.'
                  }</li>
                  <li style="margin-bottom: 8px;">Share feedback or questions with your team lead or the reporting team.</li>
                  <li style="margin-bottom: 0;">Use this data to track progress against nationwide performance standards and drive improvements.</li>
                </ul>
              </div>
            </td>
          </tr>

          <!-- Report sections: Total KPI (6 nationwide standards) -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <h3 style="margin: 0 0 16px; color: #2d3748; font-size: 16px;">📑 Report sections</h3>
              <p style="margin: 0 0 12px; color: #4a5568; font-size: 13px;">Total KPI report uses the following <strong>nationwide standards</strong> (6 KPIs). The sections in this report are:</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Sales Target Achievement</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Mainland + Zanzibar + Call Center target vs achieved</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Branch Sales Achievement</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">85% of branches at 100% target</td>
                </tr>
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Mainland 65% New Biz / Zanzibar 70% New Biz</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">New business targets and achieved</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Portfolio Growth &amp; PAR 30</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Portfolio growth and PAR &gt;30 below 5%</td>
                </tr>
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Active Client Growth &amp; Regions &amp; Clusters</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">20% annualized growth; regions and clusters hit target</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">CRM Usage &amp; Data Consent</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">90% CRM usage; 65% data consent from each cluster</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2a5298 100%); padding: 24px; border-radius: 8px; text-align: center;">
                <p style="margin: 0 0 8px; color: rgba(255,255,255,0.9); font-size: 14px;">
                  ${
                    hasAttachment
                      ? '📎 The complete Excel report (All in One + individual sheets) is attached to this email.'
                      : 'Open the KPI Analysis Report dashboard and use Download xlsx for the full workbook.'
                  }
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 15px; font-weight: 600;">
                  Download the report for detailed tables and analysis.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f8fafc; padding: 24px 40px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; color: #718096; font-size: 12px;">
                This is an automated report from the PCL Analysis KPI Analysis Report system (Total KPI).
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

/**
 * HTML email template for CS Cluster KPI Analysis Report (one cluster, 8 KPIs).
 * Use when sending the report for Cluster 1, Cluster 2, Cluster 3, or Zanzibar.
 * This is a separate template to avoid confusion with Total KPI.
 * @param {string} monthLabel - e.g. "Jan 2026"
 * @param {boolean} hasAttachment - whether Excel report is attached
 * @param {string} clusterName - e.g. "Cluster 2" or "Zanzibar"
 */
export const buildClusterKpiReportEmailHTML = (monthLabel, hasAttachment, clusterName) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CS Cluster KPI Report — ${clusterName} — ${monthLabel}</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f6f9; line-height: 1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f6f9; padding: 24px 16px;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e3a5f 0%, #2a5298 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: 0.5px;">
                📊 CS CLUSTER KPI REPORT
              </h1>
              <p style="margin: 12px 0 0; color: rgba(255,255,255,0.9); font-size: 18px; font-weight: 500;">
                ${clusterName} — 8 KPI standards
              </p>
              ${monthLabel ? `<p style="margin: 8px 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">${monthLabel}</p>` : ''}
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 32px 40px 24px;">
              <p style="margin: 0 0 20px; color: #2d3748; font-size: 16px;">
                Dear Manager,
              </p>
              <p style="margin: 0 0 20px; color: #4a5568; font-size: 15px;">
                Please find your <strong>CS Cluster KPI Report</strong> for <strong>${clusterName}</strong> for <strong>${monthLabel || 'the selected month'}</strong>. This report is for this cluster only and uses the <strong>8 cluster KPI standards</strong> (from the cluster target file), which are different from the nationwide Total KPI report.
              </p>
              <p style="margin: 0 0 16px; padding: 12px 16px; background: #E9EEF7; border-left: 4px solid #1e3a5f; border-radius: 0 8px 8px 0; color: #1e3a5f; font-size: 14px;">
                <strong>This report is for <em>${clusterName}</em> only.</strong> Data and attachment reflect that cluster's KPIs only.
              </p>
            </td>
          </tr>

          <!-- Instructions -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <div style="background: #E9EEF7; border-left: 4px solid #1e3a5f; padding: 20px 24px; border-radius: 0 8px 8px 0;">
                <h3 style="margin: 0 0 12px; color: #1e3a5f; font-size: 16px;">📋 Instructions</h3>
                <ul style="margin: 0; padding-left: 20px; color: #4a5568; font-size: 14px;">
                  <li style="margin-bottom: 8px;">Review the KPI Summary and the 8 cluster KPI section tables in the attachment.</li>
                  <li style="margin-bottom: 8px;">${
                    hasAttachment
                      ? 'This email has <strong>two attachments</strong>: (1) the <strong>Cluster KPI Target file</strong> (CS_KPI_CLUSTER_TARGET_NEW_FILE_2026.xlsx) and (2) the <strong>Cluster KPI Analysis report</strong> (Excel workbook: All in One + 8 KPI sheets).'
                      : 'Access the KPI Analysis Report dashboard, select ' + clusterName + ', and use Download xlsx for the cluster workbook.'
                  }</li>
                  <li style="margin-bottom: 8px;">Share feedback or questions with your team lead or the reporting team.</li>
                  <li style="margin-bottom: 0;">Use this data to track progress against this cluster's performance standards.</li>
                </ul>
              </div>
            </td>
          </tr>

          <!-- Report sections: Cluster KPI (8 standards only) -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <h3 style="margin: 0 0 16px; color: #2d3748; font-size: 16px;">📑 Report sections</h3>
              <p style="margin: 0 0 12px; color: #4a5568; font-size: 13px;">Cluster reports use the following <strong>8 KPI standards</strong> (from the cluster target file). The sections in this report are:</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">1. Achieve 100% cluster sales target</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Cluster target vs disbursement (Management report)</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">2. Regions hit new Business target at 100%</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Regions in cluster: new business target vs achieved</td>
                </tr>
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">3. 90% branches on sales target</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Branches in this cluster at 100% target</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">4. Achieve 85% recruitment</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Recruitment target vs achieved by region (RSM)</td>
                </tr>
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">5. Growth portfolio and client base by 20% annually</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Cluster portfolio growth, annualized</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">6. Maintain PAR 30 days under 5%</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">PAR &gt;30 for this cluster (Management report)</td>
                </tr>
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">7. On location completion (95% target)</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">CRM: completed vs at location for cluster</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">8. Data consent (80% target)</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">CRM: data consent % for this cluster</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2a5298 100%); padding: 24px; border-radius: 8px; text-align: center;">
                <p style="margin: 0 0 8px; color: rgba(255,255,255,0.9); font-size: 14px;">
                  ${
                    hasAttachment
                      ? '📎 Two files are attached: the Cluster KPI Target file and the Cluster KPI Analysis report (All in One + 8 KPI sheets).'
                      : 'Open the KPI Analysis Report dashboard, select ' + clusterName + ', and use Download xlsx for the cluster workbook.'
                  }
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 15px; font-weight: 600;">
                  Download the report for detailed tables and analysis.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f8fafc; padding: 24px 40px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; color: #718096; font-size: 12px;">
                This is an automated report from the PCL Analysis KPI Analysis Report system (Cluster KPI — ${clusterName}).
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
