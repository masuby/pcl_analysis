import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell
} from 'recharts';
import { formatLabel } from '../utils/trendDataUtils';

const DISBURSEMENT_COLOR = '#2a5298';
const LOANS_COLOR = '#22c55e';

export default function GeneralSalesTrendChart({ monthlyData }) {
  if (!monthlyData || monthlyData.length === 0) {
    return (
      <div className="sales-trend-chart-empty">
        No trend data available. Upload management reports to see the chart.
      </div>
    );
  }

  const formatTooltipDisb = (v) => (v != null ? `TZS ${formatLabel(v)}` : '—');
  const formatTooltipLoans = (v) => (v != null ? formatLabel(v) : '—');

  return (
    <div className="sales-trend-chart-wrap">
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart
          data={monthlyData}
          margin={{ top: 24, right: 56, left: 12, bottom: 24 }}
        >
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#64748b' }}
            interval={0}
            angle={0}
            textAnchor="middle"
            height={44}
          />
          <YAxis
            yAxisId="left"
            orientation="left"
            tickFormatter={formatLabel}
            tick={{ fontSize: 10, fill: '#64748b' }}
            width={42}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tickFormatter={formatLabel}
            tick={{ fontSize: 10, fill: '#22c55e' }}
            width={42}
          />
          <Tooltip
            formatter={(value, name) => [
              name === 'Disbursements This Month' ? formatTooltipDisb(value) : formatTooltipLoans(value),
              name === 'Disbursements This Month' ? 'Disbursements' : 'Number of Loans'
            ]}
            contentStyle={{
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              fontSize: 12
            }}
            labelFormatter={(label) => `Period: ${label}`}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(name) => (name === 'Disbursements This Month' ? 'Disbursements This Month' : 'Number of Loans')}
          />
          <Bar
            yAxisId="left"
            dataKey="disbursements"
            name="Disbursements This Month"
            fill={DISBURSEMENT_COLOR}
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
            label={{ position: 'top', fontSize: 11, fontWeight: 700, fill: '#1e293b', formatter: (v) => formatLabel(v) }}
          >
            {monthlyData.map((entry, index) => (
              <Cell key={`bar-${index}`} fill={DISBURSEMENT_COLOR} />
            ))}
          </Bar>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="loans"
            name="Number of Loans"
            stroke={LOANS_COLOR}
            strokeWidth={2}
            dot={{ fill: LOANS_COLOR, r: 4 }}
            activeDot={{ r: 5 }}
            label={{ position: 'top', fontSize: 11, fontWeight: 700, fill: '#166534', formatter: (v) => formatLabel(v) }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
