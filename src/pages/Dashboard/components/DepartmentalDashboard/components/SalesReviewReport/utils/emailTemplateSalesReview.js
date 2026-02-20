/**
 * HTML email template for Monthly Sales Review Report
 * Beautiful, detailed email for managers with report highlights
 */
export const buildSalesReviewEmailHTML = (monthLabel, reportDate) => {
  const dateStr = reportDate || new Date().toISOString().split('T')[0];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Monthly Sales Review Report - ${monthLabel}</title>
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
                📊 MONTHLY SALES REVIEW
              </h1>
              <p style="margin: 12px 0 0; color: rgba(255,255,255,0.9); font-size: 18px; font-weight: 500;">
                ${monthLabel}
              </p>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">
                ${dateStr}
              </p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 32px 40px 24px;">
              <p style="margin: 0 0 20px; color: #2d3748; font-size: 16px;">
                Dear Manager,
              </p>
              <p style="margin: 0 0 20px; color: #4a5568; font-size: 15px;">
                Please find the <strong>Monthly Sales Review Report</strong> for <strong>${monthLabel}</strong>. This comprehensive report provides detailed insights into sales performance across all products, including trends, comparisons, and key metrics.
              </p>
            </td>
          </tr>

          <!-- Instructions -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <div style="background: #E9EEF7; border-left: 4px solid #2a5298; padding: 20px 24px; border-radius: 0 8px 8px 0;">
                <h3 style="margin: 0 0 12px; color: #2a5298; font-size: 16px;">📋 Instructions</h3>
                <ul style="margin: 0; padding-left: 20px; color: #4a5568; font-size: 14px;">
                  <li style="margin-bottom: 8px;">Review the executive summary in this email for a quick overview of sales performance.</li>
                  <li style="margin-bottom: 8px;"><strong>Download the attached PowerPoint presentation</strong> for detailed analysis, trends, charts, and product-specific insights.</li>
                  <li style="margin-bottom: 8px;">Share this report with relevant stakeholders for review and strategic planning.</li>
                  <li style="margin-bottom: 0;">Use the insights to identify opportunities, address challenges, and drive sales growth.</li>
                </ul>
              </div>
            </td>
          </tr>

          <!-- Report sections overview -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <h3 style="margin: 0 0 16px; color: #2d3748; font-size: 16px;">📑 Report Contents</h3>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">General Performance Highlights</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Overall sales trends, summary, and comparison</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">New &amp; Repeat Business</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Performance analysis for new and repeat business</td>
                </tr>
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Product Performance</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">CS, LBF, IPF, MIF, SME, AgriFinance breakdown</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Per Product Contribution</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Branch-level and product-specific contribution analysis</td>
                </tr>
                <tr style="background: #f8fafc;">
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #2d3748; font-size: 14px; font-weight: 600;">Trends &amp; Insights</td>
                  <td style="padding: 12px 16px; border: 1px solid #e2e8f0; color: #4a5568; font-size: 13px;">Monthly trends, explanations, and key insights</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Key Highlights -->
          <tr>
            <td style="padding: 0 40px 24px;">
              <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 20px 24px; border-radius: 0 8px 8px 0;">
                <h3 style="margin: 0 0 12px; color: #f59e0b; font-size: 16px;">💡 Key Report Features</h3>
                <ul style="margin: 0; padding-left: 20px; color: #4a5568; font-size: 14px;">
                  <li style="margin-bottom: 8px;"><strong>Visual charts and graphs</strong> for easy understanding of trends and performance</li>
                  <li style="margin-bottom: 8px;"><strong>Month-over-month and year-over-year comparisons</strong> to track progress</li>
                  <li style="margin-bottom: 8px;"><strong>Product-specific analysis</strong> for each major product line and branch</li>
                  <li style="margin-bottom: 0;"><strong>Executive summary</strong> with key insights and actionable recommendations</li>
                </ul>
              </div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <div style="background: linear-gradient(135deg, #2a5298 0%, #1e3c72 100%); padding: 24px; border-radius: 8px; text-align: center;">
                <p style="margin: 0 0 8px; color: rgba(255,255,255,0.9); font-size: 14px;">
                  📎 The complete PowerPoint presentation is attached to this email.
                </p>
                <p style="margin: 0; color: #ffffff; font-size: 15px; font-weight: 600;">
                  Open the PPTX file for comprehensive analysis and detailed insights.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background: #f8fafc; padding: 24px 40px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; color: #718096; font-size: 12px;">
                This is an automated monthly report from the PCL Analysis system.
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
