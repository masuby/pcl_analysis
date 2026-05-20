import React, { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const COLOR_DARK_BLUE = '#0B2A6B';
const COLOR_GOLD = '#D4A017';
const COLOR_GREEN = '#15803D';
const COLOR_RED = '#B91C1C';

const formatCount = (v) => Number(v || 0).toLocaleString('en-US');
const formatCurrency = (v) =>
  'TZS ' +
  Number(v || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
const formatPct = (v) => `${(Number(v || 0) * 100).toFixed(2)}%`;
const formatPctChange = (v) => {
  if (v == null || !isFinite(v)) return '—';
  const n = Number(v) * 100;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
};
const formatCompact = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
};

const computePctChange = (pctArray) => {
  const out = [];
  for (let i = 0; i < pctArray.length; i++) {
    if (i === 0) { out.push(null); continue; }
    const prev = Number(pctArray[i - 1]);
    const cur = Number(pctArray[i]);
    if (!isFinite(prev) || prev === 0) { out.push(null); continue; }
    out.push((cur - prev) / prev);
  }
  return out;
};

/**
 * @param {Array<{ name: string, values: number[], total: number }>} sourceRows
 *        One per institution (including Cash Deposit first) for this metric.
 */
const Table = ({
  title,
  palette,
  monthly,
  sourceRows,
  overallSettledLabel,
  overallSettled,
  overallIssuedLabel,
  overallIssued,
  valueFormatter = formatCount,
}) => {
  // % Settled per month
  const pctValues = monthly.map((m, i) => {
    const b = Number(overallIssued[i]) || 0;
    const a = Number(overallSettled[i]) || 0;
    return b > 0 ? a / b : 0;
  });
  const pctTotal = (() => {
    const totA = overallSettled.reduce((a, b) => a + (Number(b) || 0), 0);
    const totB = overallIssued.reduce((a, b) => a + (Number(b) || 0), 0);
    return totB > 0 ? totA / totB : 0;
  })();
  const pctChangeValues = computePctChange(pctValues);

  const settledTotal = overallSettled.reduce((a, b) => a + (Number(b) || 0), 0);
  const issuedTotal = overallIssued.reduce((a, b) => a + (Number(b) || 0), 0);

  return (
    <div className="set-table-wrapper" style={{ '--set-accent': palette.accent, '--set-soft': palette.soft }}>
      <div className="set-table-title" style={{ background: palette.primary }}>
        {title}
      </div>
      <div className="set-table-scroll">
        <table className="set-table">
          <thead>
            <tr>
              <th className="set-table-metric">Metric</th>
              {monthly.map((m) => (
                <th key={m.monthKey}>{m.monthLabel}</th>
              ))}
              <th className="set-table-total-col">Total</th>
            </tr>
          </thead>
          <tbody>
            {sourceRows && sourceRows.length > 0 && (
              <tr className="set-row-section">
                <td colSpan={monthly.length + 2}>Source of repayment</td>
              </tr>
            )}
            {sourceRows.map((src) => (
              <tr key={src.name} className="set-row-source">
                <td className="set-table-metric">{src.name}</td>
                {src.values.map((v, i) => (
                  <td key={monthly[i].monthKey}>{valueFormatter(v)}</td>
                ))}
                <td className="set-table-total-col">{valueFormatter(src.total)}</td>
              </tr>
            ))}

            <tr className="set-row-a">
              <td className="set-table-metric">{overallSettledLabel}</td>
              {overallSettled.map((v, i) => (
                <td key={monthly[i].monthKey}>{valueFormatter(v)}</td>
              ))}
              <td className="set-table-total-col">{valueFormatter(settledTotal)}</td>
            </tr>
            <tr className="set-row-b">
              <td className="set-table-metric">{overallIssuedLabel}</td>
              {overallIssued.map((v, i) => (
                <td key={monthly[i].monthKey}>{valueFormatter(v)}</td>
              ))}
              <td className="set-table-total-col">{valueFormatter(issuedTotal)}</td>
            </tr>

            <tr className="set-row-pct">
              <td className="set-table-metric">% Settled</td>
              {pctValues.map((p, i) => (
                <td key={monthly[i].monthKey}>{formatPct(p)}</td>
              ))}
              <td className="set-table-total-col">{formatPct(pctTotal)}</td>
            </tr>

            <tr className="set-row-change">
              <td className="set-table-metric">% Change (MoM)</td>
              {pctChangeValues.map((v, i) => {
                if (v == null) return <td key={monthly[i].monthKey} className="set-change-na">—</td>;
                const color = v > 0 ? COLOR_GREEN : v < 0 ? COLOR_RED : 'inherit';
                const bg = v > 0 ? 'rgba(21,128,61,0.10)' : v < 0 ? 'rgba(185,28,28,0.10)' : 'transparent';
                return (
                  <td key={monthly[i].monthKey} style={{ color, background: bg, fontWeight: 600 }}>
                    {formatPctChange(v)}
                  </td>
                );
              })}
              <td className="set-table-total-col set-change-na">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

const Chart = ({ title, monthly, keyA, keyB, labelA, labelB, isCurrency = false }) => {
  const data = useMemo(
    () =>
      monthly.map((m) => ({
        month: m.monthLabel,
        [labelA]: Number(m[keyA]) || 0,
        [labelB]: Number(m[keyB]) || 0,
      })),
    [monthly, keyA, keyB, labelA, labelB]
  );

  return (
    <div className="set-chart-wrapper">
      <div className="set-chart-title">{title}</div>
      <div className="set-chart-body">
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={data} margin={{ top: 20, right: 24, bottom: 24, left: 8 }}>
            <CartesianGrid stroke="var(--set-grid)" strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fill: 'var(--set-axis-text)', fontSize: 12 }} />
            <YAxis
              tick={{ fill: 'var(--set-axis-text)', fontSize: 12 }}
              tickFormatter={isCurrency ? formatCompact : formatCount}
              width={isCurrency ? 70 : 56}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--set-tooltip-bg)',
                border: '1px solid var(--set-tooltip-border)',
                color: 'var(--set-tooltip-text)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value) => (isCurrency ? formatCurrency(value) : formatCount(value))}
            />
            <Legend wrapperStyle={{ paddingTop: 8 }} />
            <Bar dataKey={labelA} fill={COLOR_DARK_BLUE} radius={[4, 4, 0, 0]} barSize={22} />
            <Bar dataKey={labelB} fill={COLOR_GOLD} radius={[4, 4, 0, 0]} barSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const PALETTES = {
  Total: { primary: '#1F2937', accent: '#0B2A6B', soft: 'rgba(11,42,107,0.08)' },
  CS: { primary: '#1E3A8A', accent: '#2563EB', soft: 'rgba(37,99,235,0.08)' },
  LBF: { primary: '#14532D', accent: '#16A34A', soft: 'rgba(22,163,74,0.08)' },
  SME: { primary: '#581C87', accent: '#A855F7', soft: 'rgba(168,85,247,0.08)' },
  Agrifinance: { primary: '#78350F', accent: '#D97706', soft: 'rgba(217,119,6,0.1)' },
};

const labelForProduct = (product) => (product === 'Total' ? 'Overall' : product);

const ProductSettlementView = ({ product, data }) => {
  if (!data || !data.monthly?.length) {
    return (
      <div className="set-empty-card">
        <div className="set-empty-icon">📉</div>
        <p>No transactions matched this product for the uploaded file.</p>
      </div>
    );
  }

  const palette = PALETTES[product] || PALETTES.Total;
  const productLabel = labelForProduct(product);
  const sources = data.sources || [];

  // Pre-compute per-metric arrays the new Table component expects
  const settledLoansMonthly = data.monthly.map((m) => m.settledLoans);
  const issuedLoansMonthly = data.monthly.map((m) => m.issuedLoans);
  const settledBalanceMonthly = data.monthly.map((m) => m.settledBalance);
  const totalDisbursedMonthly = data.monthly.map((m) => m.totalDisbursed);

  const sourceCountRows = sources.map((s) => ({
    name: s.name,
    values: s.countPerMonth,
    total: s.totalCount,
  }));
  const sourceBalanceRows = sources.map((s) => ({
    name: s.name,
    values: s.balancePerMonth,
    total: s.totalBalance,
  }));

  return (
    <div className="set-product-view">
      <div className="set-product-heading" style={{ background: palette.primary }}>
        <div className="set-product-heading-title">{productLabel.toUpperCase()} SETTLEMENTS</div>
        <div className="set-product-heading-subtitle">
          {data.monthly.length} month{data.monthly.length === 1 ? '' : 's'} · Dark blue: Settlements · Gold: Issued / Disbursed
        </div>
      </div>

      <Table
        title="Overall Settled Loans vs Overall Loans Issued"
        palette={palette}
        monthly={data.monthly}
        sourceRows={sourceCountRows}
        overallSettledLabel={`${productLabel} Settled Loans`}
        overallSettled={settledLoansMonthly}
        overallIssuedLabel={`${productLabel} Loans Issued`}
        overallIssued={issuedLoansMonthly}
      />
      <Chart
        title="Settled Loans vs Loans Issued (monthly)"
        monthly={data.monthly}
        keyA="settledLoans"
        keyB="issuedLoans"
        labelA={`${productLabel} Settled Loans`}
        labelB={`${productLabel} Loans Issued`}
      />

      <Table
        title="Overall Settlement Balance vs Overall Total Disbursed"
        palette={palette}
        monthly={data.monthly}
        sourceRows={sourceBalanceRows}
        overallSettledLabel={`${productLabel} Settlement Balance`}
        overallSettled={settledBalanceMonthly}
        overallIssuedLabel={`${productLabel} Total Disbursed`}
        overallIssued={totalDisbursedMonthly}
        valueFormatter={formatCurrency}
      />
      <Chart
        title="Settlement Balance vs Total Disbursed (monthly)"
        monthly={data.monthly}
        keyA="settledBalance"
        keyB="totalDisbursed"
        labelA={`${productLabel} Settlement Balance`}
        labelB={`${productLabel} Total Disbursed`}
        isCurrency
      />
    </div>
  );
};

export default ProductSettlementView;
