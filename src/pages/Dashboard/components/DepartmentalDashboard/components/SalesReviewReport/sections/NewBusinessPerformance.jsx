import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Label, Tooltip } from 'recharts';

const PRIMARY_BLUE = '#2a5298';
const ACCENT_BLUE = '#4a90e2';

export default function NewBusinessPerformance({ comparisonData, trendData, logoSrc }) {
  if (!comparisonData) return null;

  const { monthLabel, lastMonthChange, lastMonthLabel, lastYearChange, lastYearLabel } = comparisonData;

  // Format explanation text
  const lmText = lastMonthChange
    ? `${lastMonthChange.dir} by ${lastMonthChange.pct}%`
    : 'N/A';
  const lyText = lastYearChange
    ? `${lastYearChange.dir} by ${lastYearChange.pct}%`
    : 'N/A';

  const explanation = `The total amount disbursed for new business for the month of ${monthLabel} has ${lmText} in comparison to ${lastMonthLabel || 'the previous month'}, and ${lyText} in comparison to ${lastYearLabel || 'the same month last year'}.`;

  return (
    <div className="report-page">
      <div className="report-header">
        <h2 className="report-title">NEW BUSINESS SALES PERFORMANCE</h2>
        {logoSrc && <img src={logoSrc} alt="Logo" className="report-logo" />}
      </div>

      <div className="report-content">
        <p style={{ fontSize: '1rem', lineHeight: '1.6', color: '#1e293b', marginBottom: '1.5rem' }}>
          {explanation}
        </p>

        {trendData && trendData.length > 0 && (
          <div style={{ width: '100%', height: '320px', marginTop: '1rem' }}>
            <ResponsiveContainer>
              <LineChart data={trendData} margin={{ top: 30, right: 30, left: 60, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.25} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={(val) => (val / 1e9).toFixed(1) + 'B'}
                  width={60}
                >
                  <Label value="Amount (TZS)" angle={-90} position="insideLeft" style={{ fontSize: 12, fill: '#1e293b' }} />
                </YAxis>
                <Tooltip
                  formatter={(val) => [(val / 1e9).toFixed(2) + ' Billion TZS', 'New Business']}
                  contentStyle={{ fontSize: 12, background: '#fff', border: '1px solid #e2e8f0' }}
                />
                <Line
                  type="monotone"
                  dataKey="newBusiness"
                  stroke={PRIMARY_BLUE}
                  strokeWidth={3}
                  dot={{ r: 4, fill: ACCENT_BLUE }}
                  activeDot={{ r: 6 }}
                  label={{
                    position: 'top',
                    formatter: (val) => (val / 1e6).toFixed(0) + 'M',
                    fontSize: 11,
                    fontWeight: 700,
                    fill: PRIMARY_BLUE
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
