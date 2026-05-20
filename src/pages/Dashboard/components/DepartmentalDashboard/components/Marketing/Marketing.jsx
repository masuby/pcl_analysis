import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';
import './Marketing.css';
import { parseDigitalSalesExcel } from './utils/parseDigitalSalesExcel';
import { buildMarketingEmailHTML, buildMarketingEmailHTMLTotal } from './utils/emailTemplateMarketing';
import {
  downloadMarketingExcel,
  downloadMarketingExcelTotal,
  buildMarketingExcelBuffer,
  buildTotalExcelBuffer,
} from './utils/exportMarketing';
import { sendScoreCardEmail } from '../../utils/emailScoreCard';
import { marketingAPI } from '../../../../../../services/api';

const RECIPIENTS_KEY = 'marketing_ds_recipients';
const PRODUCT_COLORS = { CS: '#2a5298', LBF: '#e67e22', SME: '#27ae60' };
const PRODUCT_LABELS = {
  CS:  'Civil Servant',
  LBF: 'Log Book Finance',
  SME: 'Small & Medium Enterprise',
};

/* ─── formatters ─── */
const fmtVal = (v) => {
  if (!v && v !== 0) return '0';
  const n = Number(v);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
};
const fmtNum  = (v) => (!v && v !== 0 ? '0' : Number(v).toLocaleString());
const fmtPct  = (v) => (v == null ? '0%' : `${Number(v).toFixed(1)}%`);
const sumArr  = (arr) => (arr || []).reduce((s, v) => s + (v || 0), 0);
const avgArr  = (arr) => {
  const nz = (arr || []).filter((v) => v > 0);
  return nz.length ? nz.reduce((s, v) => s + v, 0) / nz.length : 0;
};
const achClass = (p) => {
  if (p >= 100) return 'mka-ach--great';
  if (p >= 80)  return 'mka-ach--good';
  if (p >= 60)  return 'mka-ach--warn';
  return 'mka-ach--poor';
};

/* ─── small shared components ─── */
const KpiCard = ({ icon, label, value, sub, color }) => (
  <div className="mka-kpi-card" style={{ borderTopColor: color }}>
    <div className="mka-kpi-icon" style={{ color }}>{icon}</div>
    <div className="mka-kpi-body">
      <div className="mka-kpi-label">{label}</div>
      <div className="mka-kpi-value" style={{ color }}>{value}</div>
      {sub && <div className="mka-kpi-sub">{sub}</div>}
    </div>
  </div>
);

const SalesTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="mka-tooltip">
      <p className="mka-tooltip-label">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || '#fff' }} className="mka-tooltip-item">
          {p.name}: <strong>{fmtVal(p.value)}</strong>
        </p>
      ))}
    </div>
  );
};

const PctTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="mka-tooltip">
      <p className="mka-tooltip-label">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || '#fff' }} className="mka-tooltip-item">
          {p.name}: <strong>{fmtPct(p.value)}</strong>
        </p>
      ))}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════
   ALL PRODUCTS TAB
══════════════════════════════════════════════════════════ */
const AllTab = ({ yearData, compareData }) => {
  const { monthLabels, segCS, segLBF, segSME, target, actual, achievement, year } = yearData;

  const totalCS     = sumArr(segCS);
  const totalLBF    = sumArr(segLBF);
  const totalSME    = sumArr(segSME);
  const totalGrand  = totalCS + totalLBF + totalSME;
  const totalTarget = sumArr(target);
  const totalActual = sumArr(actual);
  const overallAch  = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;

  const prevTotalActual = compareData ? sumArr(compareData.actual) : 0;
  const yoyChange       = prevTotalActual > 0 ? ((totalActual - prevTotalActual) / prevTotalActual) * 100 : null;

  const barData = monthLabels.map((m, i) => ({
    month:                    m,
    'Civil Servant':          segCS[i]  || 0,
    'Log Book Finance':       segLBF[i] || 0,
    'SME':                    segSME[i] || 0,
    Target:                   target[i] || 0,
  }));

  const donutData = [
    { name: 'Civil Servant',    value: totalCS,  color: '#2a5298' },
    { name: 'Log Book Finance', value: totalLBF, color: '#e67e22' },
    { name: 'SME',              value: totalSME, color: '#27ae60' },
  ].filter((d) => d.value > 0);

  const achData = monthLabels.map((m, i) => ({
    month: m,
    'Achievement %': achievement[i] || 0,
  }));

  return (
    <div className="mka-tab-content">
      <div className="mka-kpi-row">
        <KpiCard icon="💰" label="Total Actual Sales" value={fmtVal(totalActual)}
          sub={`Target: ${fmtVal(totalTarget)}`} color="#2a5298" />
        <KpiCard
          icon={overallAch >= 100 ? '🏆' : '📊'} label="Overall Achievement"
          value={`${overallAch}%`}
          sub={overallAch >= 100 ? 'Target exceeded!' : `Gap: ${fmtVal(totalTarget - totalActual)}`}
          color={overallAch >= 100 ? '#27ae60' : overallAch >= 80 ? '#e67e22' : '#e53e3e'}
        />
        <KpiCard icon="🔵" label="Civil Servant Sales" value={fmtVal(totalCS)}
          sub={`${totalGrand > 0 ? Math.round((totalCS / totalGrand) * 100) : 0}% of total`} color="#2a5298" />
        <KpiCard icon="🟠" label="Log Book Finance Sales" value={fmtVal(totalLBF)}
          sub={`${totalGrand > 0 ? Math.round((totalLBF / totalGrand) * 100) : 0}% of total`} color="#e67e22" />
        <KpiCard icon="🟢" label="SME Sales" value={fmtVal(totalSME)}
          sub={`${totalGrand > 0 ? Math.round((totalSME / totalGrand) * 100) : 0}% of total`} color="#27ae60" />
        {yoyChange !== null && (
          <KpiCard icon={yoyChange >= 0 ? '📈' : '📉'} label={`vs ${compareData.year}`}
            value={`${yoyChange >= 0 ? '+' : ''}${yoyChange.toFixed(1)}%`}
            sub="Year-over-Year" color={yoyChange >= 0 ? '#27ae60' : '#e53e3e'} />
        )}
      </div>

      <div className="mka-charts-row mka-charts-row--2col">
        <div className="mka-chart-card">
          <div className="mka-chart-card-header">
            <h4 className="mka-chart-title">Monthly Sales by Product — {year}</h4>
          </div>
          <div className="mka-chart-body">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tickFormatter={fmtVal} tick={{ fontSize: 10, fill: '#64748b' }} width={55} />
                <Tooltip content={<SalesTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Civil Servant"    stackId="a" fill="#2a5298" />
                <Bar dataKey="Log Book Finance" stackId="a" fill="#e67e22" />
                <Bar dataKey="SME"              stackId="a" fill="#27ae60" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Target" fill="transparent" stroke="#e53e3e" strokeWidth={2} strokeDasharray="4 2" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="mka-chart-card">
          <div className="mka-chart-card-header">
            <h4 className="mka-chart-title">Product Mix (YTD)</h4>
          </div>
          <div className="mka-chart-body">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="48%"
                  innerRadius={65} outerRadius={100}
                  dataKey="value" nameKey="name" paddingAngle={3}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}>
                  {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v) => fmtVal(v)} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mka-chart-card mka-chart-card--full">
        <div className="mka-chart-card-header">
          <h4 className="mka-chart-title">Monthly Achievement % vs Target (100%)</h4>
        </div>
        <div className="mka-chart-body">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={achData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
              <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: '#64748b' }} domain={[0, 'auto']} />
              <Tooltip formatter={(v) => `${v}%`} />
              <Bar dataKey="Achievement %" radius={[4, 4, 0, 0]}>
                {achData.map((d, i) => (
                  <Cell key={i} fill={d['Achievement %'] >= 100 ? '#27ae60' : d['Achievement %'] >= 80 ? '#e67e22' : '#e53e3e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mka-table-section">
        <div className="mka-table-header">
          <h4 className="mka-table-title">Monthly Summary — {year}</h4>
          <span className="mka-table-hint">Civil Servant + Log Book Finance + SME (current & historical pipelines combined)</span>
        </div>
        <div className="mka-table-wrap">
          <table className="mka-table">
            <thead>
              <tr>
                <th className="mka-th-name">Month</th>
                <th className="mka-th-num mka-th-cs">Civil Servant</th>
                <th className="mka-th-num mka-th-lbf">Log Book Finance</th>
                <th className="mka-th-num mka-th-sme">SME</th>
                <th className="mka-th-num">Grand Total</th>
                <th className="mka-th-num">Target</th>
                <th className="mka-th-num">Achievement</th>
              </tr>
            </thead>
            <tbody>
              {monthLabels.map((m, i) => {
                const grand = (segCS[i] || 0) + (segLBF[i] || 0) + (segSME[i] || 0);
                const ach   = achievement[i] || 0;
                return (
                  <tr key={m} className="mka-cluster-row">
                    <td className="mka-td-name"><strong>{m}</strong></td>
                    <td className="mka-td-num">{fmtVal(segCS[i]  || 0)}</td>
                    <td className="mka-td-num">{fmtVal(segLBF[i] || 0)}</td>
                    <td className="mka-td-num">{fmtVal(segSME[i] || 0)}</td>
                    <td className="mka-td-num"><strong>{fmtVal(grand)}</strong></td>
                    <td className="mka-td-num">{fmtVal(target[i] || 0)}</td>
                    <td className="mka-td-num">
                      <span className={`mka-ach-badge ${achClass(ach)}`}>{ach}%</span>
                    </td>
                  </tr>
                );
              })}
              <tr className="mka-totals-row">
                <td className="mka-td-name"><strong>TOTAL</strong></td>
                <td className="mka-td-num"><strong>{fmtVal(totalCS)}</strong></td>
                <td className="mka-td-num"><strong>{fmtVal(totalLBF)}</strong></td>
                <td className="mka-td-num"><strong>{fmtVal(totalSME)}</strong></td>
                <td className="mka-td-num"><strong>{fmtVal(totalGrand)}</strong></td>
                <td className="mka-td-num"><strong>{fmtVal(totalTarget)}</strong></td>
                <td className="mka-td-num">
                  <span className={`mka-ach-badge ${achClass(overallAch)}`}><strong>{overallAch}%</strong></span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════
   SINGLE PRODUCT TAB (CS / LBF / SME)
══════════════════════════════════════════════════════════ */
const PRODUCT_CONFIG = {
  CS:  { seg: 'segCS',  current: 'cs',  label: 'Civil Servant',            color: '#2a5298' },
  LBF: { seg: 'segLBF', current: 'lbf', label: 'Log Book Finance',         color: '#e67e22' },
  SME: { seg: 'segSME', current: 'sme', label: 'Small & Medium Enterprise', color: '#27ae60' },
};

const ProductTab = ({ product, yearData, compareData }) => {
  const cfg  = PRODUCT_CONFIG[product];
  const { monthLabels, year } = yearData;
  const seg  = yearData[cfg.seg]     || [];
  const curr = yearData[cfg.current] || {};

  const totalSales     = sumArr(seg);
  const totalLeads     = sumArr(curr.totalLeads);
  const totalContacted = sumArr(curr.leadsContacted);
  const totalViable    = sumArr(curr.viableLeads);
  const totalConverted = sumArr(curr.convertedLeads);
  const avgRate        = avgArr(curr.conversionRate);
  const avgLoan        = avgArr(curr.avgLoanSize);

  const prevSeg        = compareData ? compareData[cfg.seg] : null;
  const prevTotalSales = prevSeg ? sumArr(prevSeg) : 0;
  const yoyChange      = prevTotalSales > 0 ? ((totalSales - prevTotalSales) / prevTotalSales) * 100 : null;

  const salesData = monthLabels.map((m, i) => ({
    month: m,
    Sales: seg[i] || 0,
    ...(prevSeg ? { [`${compareData.year}`]: prevSeg[i] || 0 } : {}),
  }));

  const hasFunnel = (curr.totalLeads || []).some((v) => v > 0);

  const funnelItems = [
    { name: 'Total Leads',  value: totalLeads,     pct: 100 },
    { name: 'Contacted',    value: totalContacted,  pct: totalLeads > 0 ? Math.round((totalContacted / totalLeads) * 100) : 0 },
    { name: 'Viable Leads', value: totalViable,     pct: totalLeads > 0 ? Math.round((totalViable / totalLeads) * 100) : 0 },
    { name: 'Converted',    value: totalConverted,  pct: totalLeads > 0 ? Math.round((totalConverted / totalLeads) * 100) : 0 },
  ];

  return (
    <div className="mka-tab-content">
      <div className="mka-product-bar" style={{ borderLeftColor: cfg.color }}>
        <span className="mka-product-bar-name" style={{ color: cfg.color }}>{product}</span>
        <span className="mka-product-bar-label">{cfg.label}</span>
        {yoyChange !== null && (
          <span className={`mka-product-yoy ${yoyChange >= 0 ? 'mka-yoy-pos' : 'mka-yoy-neg'}`}>
            {yoyChange >= 0 ? '▲' : '▼'} {Math.abs(yoyChange).toFixed(1)}% vs {compareData.year}
          </span>
        )}
      </div>

      <div className="mka-kpi-row">
        <KpiCard icon="💰" label="Total Sales (YTD)" value={fmtVal(totalSales)} sub={cfg.label} color={cfg.color} />
        {hasFunnel && <>
          <KpiCard icon="👥" label="Total Leads" value={fmtNum(totalLeads)} sub="Current pipeline" color={cfg.color} />
          <KpiCard icon="📞" label="Contacted"   value={fmtNum(totalContacted)}
            sub={`${totalLeads > 0 ? Math.round((totalContacted / totalLeads) * 100) : 0}% of leads`} color={cfg.color} />
          <KpiCard icon="✅" label="Converted"   value={fmtNum(totalConverted)}
            sub={`Avg conv. rate: ${avgRate.toFixed(2)}%`} color={cfg.color} />
          <KpiCard icon="🏷️" label="Avg Loan Size" value={fmtVal(avgLoan)} sub="Current pipeline avg" color={cfg.color} />
        </>}
        {yoyChange !== null && (
          <KpiCard icon={yoyChange >= 0 ? '📈' : '📉'} label={`vs ${compareData.year}`}
            value={`${yoyChange >= 0 ? '+' : ''}${yoyChange.toFixed(1)}%`}
            sub="Year-over-Year sales" color={yoyChange >= 0 ? '#27ae60' : '#e53e3e'} />
        )}
      </div>

      <div className={`mka-charts-row ${hasFunnel ? 'mka-charts-row--2col' : ''}`}>
        <div className="mka-chart-card">
          <div className="mka-chart-card-header">
            <h4 className="mka-chart-title">{product} Monthly Sales — {year}</h4>
          </div>
          <div className="mka-chart-body">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={salesData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tickFormatter={fmtVal} tick={{ fontSize: 10, fill: '#64748b' }} width={55} />
                <Tooltip content={<SalesTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Sales" fill={cfg.color} radius={[4, 4, 0, 0]} />
                {prevSeg && <Bar dataKey={`${compareData.year}`} fill="#94a3b8" radius={[4, 4, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {hasFunnel && (
          <div className="mka-chart-card">
            <div className="mka-chart-card-header">
              <h4 className="mka-chart-title">Lead Funnel (YTD Totals)</h4>
            </div>
            <div className="mka-funnel-body">
              {funnelItems.map((f, i) => (
                <div key={f.name} className="mka-funnel-item">
                  <div className="mka-funnel-label-row">
                    <span className="mka-funnel-name">{f.name}</span>
                    <span className="mka-funnel-count">{fmtNum(f.value)}</span>
                  </div>
                  <div className="mka-funnel-track">
                    <div className="mka-funnel-fill" style={{
                      width: `${f.pct}%`,
                      background: cfg.color,
                      opacity: Math.max(0.35, 1 - i * 0.18),
                    }} />
                  </div>
                  <span className="mka-funnel-pct">{f.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {hasFunnel ? (
        <div className="mka-table-section">
          <div className="mka-table-header">
            <h4 className="mka-table-title">{product} Monthly Pipeline Detail — {year}</h4>
            <span className="mka-table-hint">Current pipeline metrics</span>
          </div>
          <div className="mka-table-wrap">
            <table className="mka-table">
              <thead>
                <tr>
                  <th className="mka-th-name">Month</th>
                  <th className="mka-th-num">Leads</th>
                  <th className="mka-th-num">Contacted</th>
                  <th className="mka-th-num">Viable</th>
                  <th className="mka-th-num">Converted</th>
                  <th className="mka-th-num">Conv. Rate</th>
                  <th className="mka-th-num">Avg Loan</th>
                  <th className="mka-th-num">Total Sales</th>
                </tr>
              </thead>
              <tbody>
                {monthLabels.map((m, i) => (
                  <tr key={m} className="mka-cluster-row">
                    <td className="mka-td-name"><strong>{m}</strong></td>
                    <td className="mka-td-num">{fmtNum(curr.totalLeads?.[i]     || 0)}</td>
                    <td className="mka-td-num">{fmtNum(curr.leadsContacted?.[i] || 0)}</td>
                    <td className="mka-td-num">{fmtNum(curr.viableLeads?.[i]   || 0)}</td>
                    <td className="mka-td-num">{fmtNum(curr.convertedLeads?.[i] || 0)}</td>
                    <td className="mka-td-num">
                      <span className={`mka-ach-badge ${achClass(curr.conversionRate?.[i] || 0)}`}>
                        {(curr.conversionRate?.[i] || 0).toFixed(2)}%
                      </span>
                    </td>
                    <td className="mka-td-num">{fmtVal(curr.avgLoanSize?.[i] || 0)}</td>
                    <td className="mka-td-num"><strong style={{ color: cfg.color }}>{fmtVal(seg[i] || 0)}</strong></td>
                  </tr>
                ))}
                <tr className="mka-totals-row">
                  <td className="mka-td-name"><strong>TOTAL / AVG</strong></td>
                  <td className="mka-td-num"><strong>{fmtNum(totalLeads)}</strong></td>
                  <td className="mka-td-num"><strong>{fmtNum(totalContacted)}</strong></td>
                  <td className="mka-td-num"><strong>{fmtNum(totalViable)}</strong></td>
                  <td className="mka-td-num"><strong>{fmtNum(totalConverted)}</strong></td>
                  <td className="mka-td-num"><strong>{avgRate.toFixed(2)}%</strong></td>
                  <td className="mka-td-num"><strong>{fmtVal(avgLoan)}</strong></td>
                  <td className="mka-td-num"><strong>{fmtVal(totalSales)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="mka-table-section">
          <div className="mka-table-header">
            <h4 className="mka-table-title">{product} Monthly Sales — {year}</h4>
          </div>
          <div className="mka-table-wrap">
            <table className="mka-table">
              <thead>
                <tr>
                  <th className="mka-th-name">Month</th>
                  <th className="mka-th-num">Sales</th>
                  {prevSeg && <th className="mka-th-num">{compareData.year}</th>}
                  {prevSeg && <th className="mka-th-num">YoY Change</th>}
                </tr>
              </thead>
              <tbody>
                {monthLabels.map((m, i) => {
                  const prev = prevSeg ? (prevSeg[i] || 0) : null;
                  const chg  = prev > 0 ? (((seg[i] || 0) - prev) / prev) * 100 : null;
                  return (
                    <tr key={m} className="mka-cluster-row">
                      <td className="mka-td-name"><strong>{m}</strong></td>
                      <td className="mka-td-num"><strong style={{ color: cfg.color }}>{fmtVal(seg[i] || 0)}</strong></td>
                      {prevSeg && <td className="mka-td-num">{fmtVal(prev)}</td>}
                      {prevSeg && (
                        <td className="mka-td-num">
                          {chg != null
                            ? <span className={chg >= 0 ? 'mka-yoy-pos' : 'mka-yoy-neg'}>{chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(1)}%</span>
                            : '-'}
                        </td>
                      )}
                    </tr>
                  );
                })}
                <tr className="mka-totals-row">
                  <td className="mka-td-name"><strong>TOTAL</strong></td>
                  <td className="mka-td-num"><strong>{fmtVal(totalSales)}</strong></td>
                  {prevSeg && <td className="mka-td-num"><strong>{fmtVal(prevTotalSales)}</strong></td>}
                  {prevSeg && (
                    <td className="mka-td-num">
                      {yoyChange != null
                        ? <span className={yoyChange >= 0 ? 'mka-yoy-pos' : 'mka-yoy-neg'}>{yoyChange >= 0 ? '▲' : '▼'} {Math.abs(yoyChange).toFixed(1)}%</span>
                        : '-'}
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════
   TOTAL REPORT TAB  — combines ALL stored years
══════════════════════════════════════════════════════════ */
const TotalTab = ({ allYearsData }) => {
  const years = Object.keys(allYearsData).map(Number).sort((a, b) => a - b);

  // Per-year aggregates for the YoY comparison table
  const yearRows = years.map((y) => {
    const d = allYearsData[y];
    return {
      year:     y,
      cs:       sumArr(d.segCS),
      lbf:      sumArr(d.segLBF),
      sme:      sumArr(d.segSME),
      grand:    sumArr(d.segCS) + sumArr(d.segLBF) + sumArr(d.segSME),
      target:   sumArr(d.target),
      actual:   sumArr(d.actual),
      ach:      sumArr(d.target) > 0
        ? Math.round((sumArr(d.actual) / sumArr(d.target)) * 100) : 0,
    };
  });

  const grandTotalCS    = yearRows.reduce((s, r) => s + r.cs,   0);
  const grandTotalLBF   = yearRows.reduce((s, r) => s + r.lbf,  0);
  const grandTotalSME   = yearRows.reduce((s, r) => s + r.sme,  0);
  const grandTotal      = grandTotalCS + grandTotalLBF + grandTotalSME;
  const grandTarget     = yearRows.reduce((s, r) => s + r.target, 0);
  const grandActual     = yearRows.reduce((s, r) => s + r.actual, 0);
  const grandAch        = grandTarget > 0 ? Math.round((grandActual / grandTarget) * 100) : 0;

  // YoY bar chart data
  const yoyData = yearRows.map((r) => ({
    year:                       String(r.year),
    'Civil Servant':            r.cs,
    'Log Book Finance':         r.lbf,
    'SME':                      r.sme,
    Target:                     r.target,
  }));

  // Product mix across all years
  const mixData = [
    { name: 'Civil Servant',    value: grandTotalCS,  color: '#2a5298' },
    { name: 'Log Book Finance', value: grandTotalLBF, color: '#e67e22' },
    { name: 'SME',              value: grandTotalSME, color: '#27ae60' },
  ].filter((d) => d.value > 0);

  // Achievement line across years
  const achLineData = yearRows.map((r) => ({ year: String(r.year), 'Achievement %': r.ach }));

  return (
    <div className="mka-tab-content">
      <div className="mka-total-badge">
        <span className="mka-total-badge-icon">📊</span>
        <span className="mka-total-badge-text">Combined report across {years.length} year{years.length !== 1 ? 's' : ''}: {years.join(', ')}</span>
      </div>

      <div className="mka-kpi-row">
        <KpiCard icon="💰" label="Grand Total (All Years)" value={fmtVal(grandActual)}
          sub={`Target: ${fmtVal(grandTarget)}`} color="#2a5298" />
        <KpiCard icon={grandAch >= 100 ? '🏆' : '📊'} label="Combined Achievement"
          value={`${grandAch}%`}
          sub={grandAch >= 100 ? 'All targets met!' : `Gap: ${fmtVal(grandTarget - grandActual)}`}
          color={grandAch >= 100 ? '#27ae60' : grandAch >= 80 ? '#e67e22' : '#e53e3e'} />
        <KpiCard icon="🔵" label="Civil Servant (All Years)" value={fmtVal(grandTotalCS)}
          sub={`${grandTotal > 0 ? Math.round((grandTotalCS / grandTotal) * 100) : 0}% of total`} color="#2a5298" />
        <KpiCard icon="🟠" label="Log Book Finance (All Years)" value={fmtVal(grandTotalLBF)}
          sub={`${grandTotal > 0 ? Math.round((grandTotalLBF / grandTotal) * 100) : 0}% of total`} color="#e67e22" />
        <KpiCard icon="🟢" label="SME (All Years)" value={fmtVal(grandTotalSME)}
          sub={`${grandTotal > 0 ? Math.round((grandTotalSME / grandTotal) * 100) : 0}% of total`} color="#27ae60" />
      </div>

      <div className="mka-charts-row mka-charts-row--2col">
        <div className="mka-chart-card">
          <div className="mka-chart-card-header">
            <h4 className="mka-chart-title">Year-over-Year Sales by Product</h4>
          </div>
          <div className="mka-chart-body">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={yoyData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis tickFormatter={fmtVal} tick={{ fontSize: 10, fill: '#64748b' }} width={55} />
                <Tooltip content={<SalesTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Civil Servant"    fill="#2a5298" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Log Book Finance" fill="#e67e22" radius={[0, 0, 0, 0]} />
                <Bar dataKey="SME"              fill="#27ae60" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Target" fill="transparent" stroke="#e53e3e" strokeWidth={2} strokeDasharray="4 2" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="mka-chart-card">
          <div className="mka-chart-card-header">
            <h4 className="mka-chart-title">Product Mix (All Years Combined)</h4>
          </div>
          <div className="mka-chart-body">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={mixData} cx="50%" cy="48%"
                  innerRadius={65} outerRadius={100}
                  dataKey="value" nameKey="name" paddingAngle={3}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}>
                  {mixData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v) => fmtVal(v)} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {years.length > 1 && (
        <div className="mka-chart-card mka-chart-card--full">
          <div className="mka-chart-card-header">
            <h4 className="mka-chart-title">Achievement % by Year</h4>
          </div>
          <div className="mka-chart-body">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={achLineData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="year" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: '#64748b' }} domain={[0, 'auto']} />
                <Tooltip formatter={(v) => `${v}%`} />
                <Line type="monotone" dataKey="Achievement %" stroke="#2a5298" strokeWidth={2}
                  dot={{ r: 5, fill: '#2a5298' }} activeDot={{ r: 7 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="mka-table-section">
        <div className="mka-table-header">
          <h4 className="mka-table-title">Year-by-Year Performance Summary</h4>
          <span className="mka-table-hint">Civil Servant + Log Book Finance + SME per year</span>
        </div>
        <div className="mka-table-wrap">
          <table className="mka-table">
            <thead>
              <tr>
                <th className="mka-th-name">Year</th>
                <th className="mka-th-num mka-th-cs">Civil Servant</th>
                <th className="mka-th-num mka-th-lbf">Log Book Finance</th>
                <th className="mka-th-num mka-th-sme">SME</th>
                <th className="mka-th-num">Grand Total</th>
                <th className="mka-th-num">Target</th>
                <th className="mka-th-num">Achievement</th>
                <th className="mka-th-num">YoY Growth</th>
              </tr>
            </thead>
            <tbody>
              {yearRows.map((r, idx) => {
                const prevGrand = idx > 0 ? yearRows[idx - 1].grand : null;
                const yoy       = prevGrand > 0 ? ((r.grand - prevGrand) / prevGrand) * 100 : null;
                return (
                  <tr key={r.year} className="mka-cluster-row">
                    <td className="mka-td-name"><strong>{r.year}</strong></td>
                    <td className="mka-td-num">{fmtVal(r.cs)}</td>
                    <td className="mka-td-num">{fmtVal(r.lbf)}</td>
                    <td className="mka-td-num">{fmtVal(r.sme)}</td>
                    <td className="mka-td-num"><strong>{fmtVal(r.grand)}</strong></td>
                    <td className="mka-td-num">{fmtVal(r.target)}</td>
                    <td className="mka-td-num">
                      <span className={`mka-ach-badge ${achClass(r.ach)}`}>{r.ach}%</span>
                    </td>
                    <td className="mka-td-num">
                      {yoy != null
                        ? <span className={yoy >= 0 ? 'mka-yoy-pos' : 'mka-yoy-neg'}>{yoy >= 0 ? '▲' : '▼'} {Math.abs(yoy).toFixed(1)}%</span>
                        : <span className="mka-yoy-base">—</span>}
                    </td>
                  </tr>
                );
              })}
              <tr className="mka-totals-row">
                <td className="mka-td-name"><strong>ALL YEARS</strong></td>
                <td className="mka-td-num"><strong>{fmtVal(grandTotalCS)}</strong></td>
                <td className="mka-td-num"><strong>{fmtVal(grandTotalLBF)}</strong></td>
                <td className="mka-td-num"><strong>{fmtVal(grandTotalSME)}</strong></td>
                <td className="mka-td-num"><strong>{fmtVal(grandTotal)}</strong></td>
                <td className="mka-td-num"><strong>{fmtVal(grandTarget)}</strong></td>
                <td className="mka-td-num">
                  <span className={`mka-ach-badge ${achClass(grandAch)}`}><strong>{grandAch}%</strong></span>
                </td>
                <td className="mka-td-num">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════
   EMAIL MODAL
══════════════════════════════════════════════════════════ */
const bufferToBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let b = '';
  for (let i = 0; i < bytes.byteLength; i++) b += String.fromCharCode(bytes[i]);
  return btoa(b);
};

const EmailModal = ({ yearData, compareData, allYearsData, isTotal, onClose, sending, setSending }) => {
  const [recipients, setRecipients] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECIPIENTS_KEY) || '[]'); } catch { return []; }
  });
  const [newEmail,    setNewEmail]    = useState('');
  const [pasteBox,    setPasteBox]    = useState('');
  const [error,       setError]       = useState('');
  const [progress,    setProgress]    = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [subject,     setSubject]     = useState('');
  const [htmlBody,    setHtmlBody]    = useState('');
  const [copiedList,  setCopiedList]  = useState(false);

  useEffect(() => {
    try { localStorage.setItem(RECIPIENTS_KEY, JSON.stringify(recipients)); } catch { /* ignore */ }
  }, [recipients]);

  const emailLike   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const parseEmails = (t) =>
    [...new Set(t.split(/\s*[\n,;\t]\s*/).map((s) => s.trim().toLowerCase()).filter((s) => emailLike.test(s)))];

  const addOne = () => {
    const e = newEmail.trim().toLowerCase();
    if (!e || !emailLike.test(e)) { setError('Enter a valid email.'); return; }
    if (recipients.includes(e))   { setError('Already added.'); return; }
    setRecipients((p) => [...p, e]); setNewEmail(''); setError('');
  };
  const addPasted = () => {
    const toAdd = parseEmails(pasteBox).filter((e) => !recipients.includes(e));
    if (!toAdd.length) { setError('No new valid emails found.'); return; }
    setRecipients((p) => [...p, ...toAdd]); setPasteBox(''); setError('');
  };
  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      const toAdd = parseEmails(t).filter((e) => !recipients.includes(e));
      if (!toAdd.length) { setError('No new emails in clipboard.'); return; }
      setRecipients((p) => [...p, ...toAdd]); setError('');
    } catch { setError('Clipboard access denied. Use the paste box.'); }
  };
  const copyList = () => {
    if (!recipients.length) return;
    navigator.clipboard.writeText(recipients.join('\n'))
      .then(() => { setCopiedList(true); setTimeout(() => setCopiedList(false), 2000); })
      .catch(() => {});
  };

  const generatePreview = () => {
    if (isTotal) {
      const years = Object.keys(allYearsData).map(Number).sort((a, b) => a - b);
      const sub   = `DIGITAL SALES COMBINED REPORT — ${years.join(' & ')}`;
      const html  = buildMarketingEmailHTMLTotal(allYearsData);
      setSubject(sub); setHtmlBody(html); setShowPreview(true);
    } else {
      const y   = yearData?.year || new Date().getFullYear();
      const sub = `DIGITAL SALES MARKETING ANALYSIS — ${y}`;
      const html = buildMarketingEmailHTML({ yearData, compareData });
      setSubject(sub); setHtmlBody(html); setShowPreview(true);
    }
  };

  const send = async () => {
    if (!recipients.length) { setError('Add at least one recipient.'); return; }
    setSending(true); setError('');
    setProgress(recipients.map((e) => ({ email: e, status: 'sending', error: null })));

    let sub, html, attachmentBase64, attachmentName;
    if (isTotal) {
      const years = Object.keys(allYearsData).map(Number).sort((a, b) => a - b);
      sub  = subject || `DIGITAL SALES COMBINED REPORT — ${years.join(' & ')}`;
      html = htmlBody || buildMarketingEmailHTMLTotal(allYearsData);
      try {
        const res = await buildTotalExcelBuffer(allYearsData);
        if (res?.buffer) { attachmentBase64 = bufferToBase64(res.buffer); attachmentName = res.fileName; }
      } catch { /* send without attachment if build fails */ }
    } else {
      const y = yearData?.year || new Date().getFullYear();
      sub  = subject || `DIGITAL SALES MARKETING ANALYSIS — ${y}`;
      html = htmlBody || buildMarketingEmailHTML({ yearData, compareData });
      try {
        const res = await buildMarketingExcelBuffer(yearData, compareData);
        if (res?.buffer) { attachmentBase64 = bufferToBase64(res.buffer); attachmentName = res.fileName; }
      } catch { /* send without attachment if build fails */ }
    }

    const result = await sendScoreCardEmail(recipients, sub, html, {
      mode: 'MONTHLY',
      attachmentBase64: attachmentBase64 || '',
      attachmentName:   attachmentName   || '',
    });
    const st  = result.success ? 'success' : 'failed';
    const err = result.success ? null : (result.error || 'Failed to send');
    setProgress((p) => p.map((r) => ({ ...r, status: st, error: err })));
    setSending(false);
  };

  return (
    <div className="mka-modal-overlay" onClick={() => { if (!sending) onClose(); }}>
      <div className={`mka-modal ${showPreview ? 'mka-modal--wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="mka-modal-header">
          <h3 className="mka-modal-title">{isTotal ? 'Send Combined Report by Email' : 'Send Digital Sales Analysis by Email'}</h3>
          <button className="mka-modal-close" onClick={() => { if (!sending) onClose(); }}>×</button>
        </div>

        {progress?.length > 0 && (
          <div className="mka-progress-popup">
            <h4 className="mka-progress-title">{sending ? 'Sending…' : 'Result'}</h4>
            <ul className="mka-progress-list">
              {progress.map(({ email, status, error: e }) => (
                <li key={email} className={`mka-progress-item mka-progress-item--${status}`}>
                  <span className="mka-progress-email">{email}</span>
                  <span className="mka-progress-status">
                    {status === 'sending' && '⏳'}
                    {status === 'success' && <span className="mka-progress-ok">✓</span>}
                    {status === 'failed'  && <span className="mka-progress-fail" title={e}>✗</span>}
                  </span>
                  {status === 'failed' && e && <span className="mka-progress-err">{e}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mka-modal-body">
          {isTotal && (
            <p className="mka-modal-hint" style={{ color: '#2a5298', marginBottom: '0.75rem' }}>
              📊 Combined report ({Object.keys(allYearsData).sort().join(' + ')}) — Excel attachment included automatically
            </p>
          )}
          {!isTotal && (
            <p className="mka-modal-hint" style={{ color: '#4a5568', marginBottom: '0.75rem' }}>
              📎 Excel report for {yearData?.year}{compareData ? ` vs ${compareData.year}` : ''} will be attached automatically
            </p>
          )}
          <p className="mka-modal-hint">Recipients (saved locally):</p>
          <div className="mka-recipient-row">
            <input type="email" placeholder="email@example.com" value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addOne()}
              className="mka-recipient-input" />
            <button className="mka-btn-add" onClick={addOne}>Add</button>
            <button className="mka-btn-paste" onClick={pasteFromClipboard} disabled={sending}>Paste</button>
          </div>
          <div className="mka-paste-box-wrap">
            <textarea className="mka-paste-box" rows={3}
              placeholder="Paste many emails (one per line or comma-separated)"
              value={pasteBox} onChange={(e) => setPasteBox(e.target.value)} />
            <button className="mka-btn-sm" onClick={addPasted}>Add pasted</button>
          </div>
          <div className="mka-recipient-actions">
            <button className="mka-btn-sm" onClick={copyList} disabled={!recipients.length}>
              {copiedList ? '✓ Copied!' : 'Copy list'}
            </button>
          </div>
          <ul className="mka-recipient-list">
            {recipients.map((e) => (
              <li key={e} className="mka-recipient-item">
                <span>{e}</span>
                <button className="mka-btn-remove" onClick={() => setRecipients((p) => p.filter((r) => r !== e))}>Remove</button>
              </li>
            ))}
          </ul>
          {!recipients.length && <p className="mka-modal-empty">No recipients yet.</p>}
          <div className="mka-preview-section">
            <button className="mka-preview-toggle"
              onClick={() => showPreview ? setShowPreview(false) : generatePreview()}>
              {showPreview ? '▼ Hide Preview' : '▶ Preview Email'}
            </button>
            {showPreview && (
              <div className="mka-preview-container">
                <div className="mka-preview-subject-row">
                  <label>Subject:</label>
                  <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className="mka-subject-input" />
                </div>
                <div className="mka-preview-body">
                  <label>Body:</label>
                  <div className="mka-preview-html" dangerouslySetInnerHTML={{ __html: htmlBody }} />
                </div>
              </div>
            )}
          </div>
          {error && <p className="mka-modal-error">{error}</p>}
        </div>

        <div className="mka-modal-footer">
          <button className="mka-modal-cancel" onClick={() => { if (!sending) onClose(); }}>
            {progress && !sending ? 'Close' : 'Cancel'}
          </button>
          <button className="mka-modal-send" onClick={send} disabled={sending || !recipients.length}>
            {sending ? 'Sending…' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════ */
const Marketing = () => {
  /* ── server-side state ── */
  const [storedFiles,   setStoredFiles]   = useState([]);    // records from backend
  const [loadingFiles,  setLoadingFiles]  = useState(true);  // initial fetch
  const [fetchError,    setFetchError]    = useState(null);

  /* ── upload state ── */
  const [uploading,   setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [isDragging,  setIsDragging]  = useState(false);
  const fileInputRef = useRef(null);

  /* ── view state ── */
  const [activeYear, setActiveYear]   = useState(null);
  const [activeTab,  setActiveTab]    = useState('ALL');
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailSending,   setEmailSending]   = useState(false);
  const [downloading,    setDownloading]    = useState(false);

  /* ── derived data ── */
  // Build a { year: parsedData } map from stored backend records
  const allYearsData = useMemo(() => {
    const map = {};
    for (const f of storedFiles) {
      if (f.parsedData) map[f.year] = { ...f.parsedData, year: f.year };
    }
    return map;
  }, [storedFiles]);

  const years       = useMemo(() => Object.keys(allYearsData).map(Number).sort((a, b) => b - a), [allYearsData]);
  const yearData    = activeYear ? allYearsData[activeYear] : null;
  const compareYear = years.find((y) => y !== activeYear);
  const compareData = compareYear ? allYearsData[compareYear] : null;
  const hasData     = years.length > 0;

  /* ── auto-select most recent year ── */
  useEffect(() => {
    if (years.length && (!activeYear || !allYearsData[activeYear])) {
      setActiveYear(years[0]);
    }
  }, [years]);

  /* ── fetch stored files on mount ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const files = await marketingAPI.getFiles();
        if (!cancelled) setStoredFiles(files || []);
      } catch (e) {
        if (!cancelled) setFetchError(e.message);
      } finally {
        if (!cancelled) setLoadingFiles(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── file upload handler ── */
  const handleFiles = useCallback(async (rawFiles) => {
    if (!rawFiles?.length) return;
    setUploading(true); setUploadError(null);
    let hadError = null;

    for (const file of Array.from(rawFiles)) {
      if (!file.name.match(/\.(xlsx|xls)$/i)) {
        hadError = `${file.name}: not an Excel file.`;
        continue;
      }
      // 1. Parse client-side
      const result = await parseDigitalSalesExcel(file);
      if (result.parseError) { hadError = result.parseError; continue; }

      // 2. Upload each year found in the workbook
      for (const [yearStr, yearParsed] of Object.entries(result.years)) {
        const year = Number(yearStr);
        try {
          const response = await marketingAPI.uploadFile(file, year, yearParsed);
          if (response.success && response.data) {
            setStoredFiles((prev) => {
              // Replace existing record for this year, or add new
              const without = prev.filter((f) => f.year !== year);
              return [response.data, ...without].sort((a, b) => b.year - a.year);
            });
            setActiveYear(year);
          }
        } catch (e) {
          hadError = `Year ${year}: ${e.message}`;
        }
      }
    }

    if (hadError) setUploadError(hadError);
    setUploading(false);
  }, []);

  const onDrop     = useCallback((e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }, [handleFiles]);
  const onDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);

  /* ── delete a year ── */
  const handleDelete = async (year) => {
    if (!window.confirm(`Remove the ${year} Digital Sales file? This cannot be undone.`)) return;
    try {
      await marketingAPI.deleteFile(year);
      setStoredFiles((prev) => prev.filter((f) => f.year !== year));
      if (activeYear === year) {
        const remaining = years.filter((y) => y !== year);
        setActiveYear(remaining[0] || null);
        if (activeTab !== 'TOTAL') setActiveTab('ALL');
      }
    } catch (e) {
      setUploadError(`Failed to remove ${year}: ${e.message}`);
    }
  };

  /* ── download original Excel ── */
  const handleDownloadOriginal = (year) => {
    const token = localStorage.getItem('pcl_token');
    const url   = marketingAPI.downloadUrl(year);
    const a     = document.createElement('a');
    a.href      = url + `?token=${token}`;
    // Use fetch+blob for auth header
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const burl = URL.createObjectURL(blob);
        const link  = document.createElement('a');
        link.href    = burl;
        link.download = `DIGITAL_SALES_${year}.xlsx`;
        link.click();
        URL.revokeObjectURL(burl);
      })
      .catch((e) => setUploadError(`Download failed: ${e.message}`));
  };

  /* ── export Excel report (single year) ── */
  const handleDownloadReport = async () => {
    if (!yearData) return;
    setDownloading(true);
    try { await downloadMarketingExcel(yearData, compareData); }
    finally { setDownloading(false); }
  };

  /* ── export combined Excel report (all years) ── */
  const handleDownloadTotal = async () => {
    if (!years.length) return;
    setDownloading(true);
    try { await downloadMarketingExcelTotal(allYearsData); }
    finally { setDownloading(false); }
  };

  const TAB_ITEMS = ['ALL', 'CS', 'LBF', 'SME', ...(years.length > 1 ? ['TOTAL'] : [])];

  return (
    <div className="mka-root">

      {/* ── Header ── */}
      <div className="mka-header">
        <div className="mka-header-left">
          <h2 className="mka-title">DIGITAL SALES MARKETING ANALYSIS</h2>
          <span className="mka-subtitle">Civil Servant · Log Book Finance · SME — files stored on server, no re-upload needed</span>
        </div>
        {hasData && (
          <div className="mka-product-tabs">
            {TAB_ITEMS.map((t) => (
              <button key={t}
                className={`mka-product-tab ${activeTab === t ? 'mka-product-tab--active' : ''}`}
                style={activeTab === t && PRODUCT_COLORS[t] ? { background: PRODUCT_COLORS[t], borderColor: PRODUCT_COLORS[t] } : {}}
                onClick={() => setActiveTab(t)}>
                {t === 'TOTAL' ? '📊 TOTAL' : (PRODUCT_LABELS[t] ?? t)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Stored files panel ── */}
      {loadingFiles ? (
        <div className="mka-loading">
          <div className="mka-loading-spinner"><div className="mka-spinner" /><span>Loading stored files…</span></div>
        </div>
      ) : (
        <>
          {/* Stored files list */}
          {storedFiles.length > 0 && (
            <div className="mka-stored-files">
              <div className="mka-stored-files-title">📁 Stored Files</div>
              <div className="mka-stored-files-list">
                {storedFiles.map((f) => (
                  <div key={f.id} className={`mka-stored-file-card ${activeYear === f.year ? 'mka-stored-file-card--active' : ''}`}
                    onClick={() => { setActiveYear(f.year); if (activeTab === 'TOTAL') setActiveTab('ALL'); }}>
                    <div className="mka-stored-file-year">{f.year}</div>
                    <div className="mka-stored-file-name" title={f.fileName}>{f.fileName}</div>
                    <div className="mka-stored-file-size">{(f.fileSize / 1024).toFixed(0)} KB</div>
                    <div className="mka-stored-file-actions">
                      <button className="mka-file-action-btn mka-file-action-btn--dl"
                        title="Download original file"
                        onClick={(e) => { e.stopPropagation(); handleDownloadOriginal(f.year); }}>
                        ⬇
                      </button>
                      <label className="mka-file-action-btn mka-file-action-btn--replace"
                        title="Replace file for this year"
                        onClick={(e) => e.stopPropagation()}>
                        🔄
                        <input type="file" accept=".xlsx,.xls" hidden
                          onChange={(e) => handleFiles(e.target.files)} />
                      </label>
                      <button className="mka-file-action-btn mka-file-action-btn--del"
                        title="Remove this file"
                        onClick={(e) => { e.stopPropagation(); handleDelete(f.year); }}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upload zone */}
          <div
            className={`mka-upload-zone ${isDragging ? 'mka-upload-zone--drag' : ''} ${hasData ? 'mka-upload-zone--compact' : ''}`}
            onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" multiple hidden
              onChange={(e) => handleFiles(e.target.files)} />
            {uploading ? (
              <div className="mka-upload-loading">
                <div className="mka-spinner" />
                <span>Parsing &amp; uploading to server…</span>
              </div>
            ) : (
              <>
                {!hasData && <div className="mka-upload-zone-icon">📊</div>}
                <div className="mka-upload-zone-text">
                  {hasData ? 'Upload additional file or click to replace' : 'Drop DIGITAL SALES Excel files here, or click to browse'}
                </div>
                {!hasData && (
                  <div className="mka-upload-zone-hint">
                    Supports .xlsx — files are saved to the server (no re-upload needed) · 2026 file auto-includes 2025 data
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── Year tabs (when multiple years stored) ── */}
      {years.length > 1 && activeTab !== 'TOTAL' && (
        <div className="mka-year-tabs">
          <span className="mka-year-tabs-label">Viewing year:</span>
          {years.map((y) => (
            <button key={y}
              className={`mka-year-tab ${activeYear === y ? 'mka-year-tab--active' : ''}`}
              onClick={() => setActiveYear(y)}>
              {y}
            </button>
          ))}
          {compareData && (
            <span className="mka-year-compare-hint">Comparing with {compareYear}</span>
          )}
        </div>
      )}

      {/* ── Errors ── */}
      {(uploadError || fetchError) && (
        <div className="mka-error">⚠ {uploadError || fetchError}</div>
      )}

      {/* ── Empty state ── */}
      {!hasData && !loadingFiles && (
        <div className="mka-empty">
          <div className="mka-empty-icon">📂</div>
          <h3 className="mka-empty-title">No Digital Sales Data</h3>
          <p className="mka-empty-desc">
            Upload a <strong>DIGITAL SALES</strong> Excel file above.<br />
            Files are stored on the server — you only upload once.<br />
            Uploading the 2026 file will automatically include 2025 comparison data.
          </p>
        </div>
      )}

      {/* ── Content ── */}
      {hasData && activeTab === 'TOTAL' && <TotalTab allYearsData={allYearsData} />}
      {hasData && activeTab === 'ALL'   && yearData && <AllTab     yearData={yearData} compareData={compareData} />}
      {hasData && activeTab !== 'ALL'   && activeTab !== 'TOTAL' && yearData && (
        <ProductTab product={activeTab} yearData={yearData} compareData={compareData} />
      )}

      {/* ── Footer actions — TOTAL tab ── */}
      {hasData && activeTab === 'TOTAL' && (
        <div className="mka-footer">
          <button className="mka-email-btn" onClick={() => setShowEmailModal(true)}>✉ Send Combined Email</button>
          <button className="mka-download-btn" onClick={handleDownloadTotal} disabled={downloading}>
            📥 {downloading ? 'Generating…' : `Download Combined Report (${years.join(' + ')})`}
          </button>
        </div>
      )}

      {/* ── Footer actions — single year tabs ── */}
      {hasData && activeTab !== 'TOTAL' && yearData && (
        <div className="mka-footer">
          <button className="mka-email-btn" onClick={() => setShowEmailModal(true)}>✉ Send Email</button>
          <button className="mka-download-btn" onClick={handleDownloadReport} disabled={downloading}>
            📥 {downloading ? 'Generating…' : `Download Report (${activeYear}${compareData ? ` vs ${compareYear}` : ''})`}
          </button>
        </div>
      )}

      {/* ── Email modal ── */}
      {showEmailModal && (
        <EmailModal
          yearData={activeTab === 'TOTAL' ? null : yearData}
          compareData={activeTab === 'TOTAL' ? null : compareData}
          allYearsData={activeTab === 'TOTAL' ? allYearsData : null}
          isTotal={activeTab === 'TOTAL'}
          onClose={() => setShowEmailModal(false)}
          sending={emailSending}
          setSending={setEmailSending}
        />
      )}
    </div>
  );
};

export default Marketing;
