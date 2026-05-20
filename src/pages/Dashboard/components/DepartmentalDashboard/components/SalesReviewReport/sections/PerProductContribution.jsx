import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

export default function PerProductContribution({ productData, logoSrc }) {
  if (!productData) return null;

  const { monthLabel, products, productsRanked, totalFormatted } = productData;
  const pieData = products.filter((p) => p.value > 0);
  const tableRows = productsRanked && productsRanked.length > 0 ? productsRanked : products.map((p, i) => ({ ...p, rank: i + 1 }));

  return (
    <div className="report-page report-page--product-contribution">
      <div className="report-product-header">
        <h2 className="report-product-title">PER PRODUCT CONTRIBUTION</h2>
        {logoSrc && <img src={logoSrc} alt="PCL" className="report-product-logo" />}
      </div>
      <div className="report-product-line" />

      <p className="report-product-subtitle">
        Contribution to total sales (Disbursements This Month) — {monthLabel}. Total:{' '}
        <strong className="report-data-value">{totalFormatted} TZS</strong>
      </p>
      <div className="report-product-split">
        <div className="report-product-left">
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="45%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={1}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [v?.toLocaleString?.() ?? v, '']} />
                  <Legend layout="horizontal" align="center" verticalAlign="bottom" wrapperStyle={{ paddingTop: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </>
          ) : (
            <div className="report-product-pie-empty">No product data for this month.</div>
          )}
        </div>
        <div className="report-product-divider-vertical" aria-hidden="true" />
        <div className="report-product-right">
          <table className="report-product-table">
            <thead>
              <tr>
                <th className="report-product-th">Rank</th>
                <th className="report-product-th">Product</th>
                <th className="report-product-th">Amount (TZS)</th>
                <th className="report-product-th">%</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((p) => (
                <tr key={p.name} className="report-product-tr">
                  <td className="report-product-td report-product-td-rank">{p.rank}</td>
                  <td className="report-product-td report-product-td-name">
                    <span className="report-product-dot" style={{ backgroundColor: p.color }} aria-hidden="true" />
                    {p.name}
                  </td>
                  <td className="report-product-td report-product-td-amount">{p.valueFormatted}</td>
                  <td className="report-product-td report-product-td-pct">{p.percentage}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="report-page-bottom-line" />
    </div>
  );
}
