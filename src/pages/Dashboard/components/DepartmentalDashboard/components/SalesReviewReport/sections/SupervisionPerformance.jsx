import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts';

const PERCENTAGE_COLOR_BANDS = [
  { min: 90, color: '#7c3aed' },
  { min: 80, color: '#4f46e5' },
  { min: 70, color: '#2563eb' },
  { min: 50, color: '#16a34a' },
  { min: 30, color: '#eab308' },
  { min: 10, color: '#ea580c' },
  { min: 0, color: '#dc2626' }
];

function getColorForPercentage(pct) {
  const n = Math.min(100, Math.max(0, Number(pct) || 0));
  for (let i = 0; i < PERCENTAGE_COLOR_BANDS.length; i++) {
    if (n >= PERCENTAGE_COLOR_BANDS[i].min) return PERCENTAGE_COLOR_BANDS[i].color;
  }
  return PERCENTAGE_COLOR_BANDS[PERCENTAGE_COLOR_BANDS.length - 1].color;
}

function formatValue(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

export default function SupervisionPerformance({ supervisionData, logoSrc }) {
  if (!supervisionData?.rows?.length) return null;

  const { rows, totalTarget, totalValue, totalActiveReps = 0, totalActualReps = 0 } = supervisionData;
  const totalPct = totalTarget > 0 ? ((totalValue / totalTarget) * 100).toFixed(1) : '0';

  const chartData = rows.map((r) => ({
    name: (r.name || '').slice(0, 24),
    pct: r.percentage
  }));

  return (
    <div className="report-page report-page--supervision">
      <div className="report-supervision-header">
        <h2 className="report-supervision-title">SUPERVISION PERFORMANCE</h2>
        {logoSrc && <img src={logoSrc} alt="PCL" className="report-supervision-logo" />}
      </div>
      <div className="report-supervision-line" />

      <div className="report-supervision-split">
        <div className="report-supervision-left">
          <table className="report-supervision-table">
            <thead>
              <tr>
                <th className="report-supervision-th">Supervision</th>
                <th className="report-supervision-th report-supervision-th-right">Target</th>
                <th className="report-supervision-th report-supervision-th-right">Value</th>
                <th className="report-supervision-th report-supervision-th-right">%</th>
                <th className="report-supervision-th report-supervision-th-center">Active Reps</th>
                <th className="report-supervision-th report-supervision-th-center">Actual Reps</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.name}
                  className="report-supervision-tr"
                  style={{ backgroundColor: getColorForPercentage(r.percentage) }}
                >
                  <td className="report-supervision-td report-supervision-td-name">{r.name}</td>
                  <td className="report-supervision-td report-supervision-td-right">{formatValue(r.target)}</td>
                  <td className="report-supervision-td report-supervision-td-right">{formatValue(r.value)}</td>
                  <td className="report-supervision-td report-supervision-td-right">{r.percentage.toFixed(1)}%</td>
                  <td className="report-supervision-td report-supervision-td-center">{r.activeReps ?? 0}</td>
                  <td className="report-supervision-td report-supervision-td-center">{r.actualReps ?? 0}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="report-supervision-total-row">
                <td className="report-supervision-td report-supervision-td-name">Total</td>
                <td className="report-supervision-td report-supervision-td-right">{formatValue(totalTarget)}</td>
                <td className="report-supervision-td report-supervision-td-right">{formatValue(totalValue)}</td>
                <td className="report-supervision-td report-supervision-td-right">{totalPct}%</td>
                <td className="report-supervision-td report-supervision-td-center">{totalActiveReps}</td>
                <td className="report-supervision-td report-supervision-td-center">{totalActualReps}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="report-supervision-divider" aria-hidden="true" />
        <div className="report-supervision-right">
          <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 28)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
              <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 9 }} />
              <Bar dataKey="pct" name="% of Target" label={{ position: 'right', formatter: (v) => `${Number(v).toFixed(1)}%` }}>
                {chartData.map((entry, i) => (
                  <Cell key={entry.name} fill={getColorForPercentage(entry.pct)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="report-page-bottom-line" />
    </div>
  );
}
