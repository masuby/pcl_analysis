/**
 * Cluster KPI 4: Achieve 85% recruitment of sales agents.
 * Uses Gap Analysis: Achieved Sales Reps vs Target per region in cluster; show all region data, sum to cluster, then analysis.
 */
import React from 'react';
import { formatTzs, formatPercentAccounting } from '../utils/csKpiTargets';
import './clusterKpiStyles.css';

const TARGET_PCT = 85;

function gradeFromPct(pct) {
  if (pct >= 85) return { label: 'Achieved', className: 'excellent' };
  if (pct >= 70) return { label: 'Good', className: 'good' };
  if (pct >= 50) return { label: 'Fair', className: 'fair' };
  return { label: 'Below target', className: 'weak' };
}

export default function ClusterKpi04Recruitment({
  cluster,
  monthLabel,
  recruitmentTable = [],
  weightPct = 7,
  loading = false
}) {
  const clusterTotalTarget = recruitmentTable.reduce((s, r) => s + (Number(r.target) || 0), 0);
  const clusterTotalAchieved = recruitmentTable.reduce((s, r) => s + (Number(r.achieved) || 0), 0);
  const pct = clusterTotalTarget > 0 ? (clusterTotalAchieved / clusterTotalTarget) * 100 : null;
  const grade = gradeFromPct(pct);

  if (loading) {
    return (
      <section className="ckpi-section">
        <h2 className="ckpi-section-title">4. Achieve 85% recruitment of sales agents</h2>
        <div className="ckpi-section-body"><p className="ckpi-note">Loading Gap Analysis RSM…</p></div>
      </section>
    );
  }

  return (
    <section className="ckpi-section">
      <h2 className="ckpi-section-title">4. Achieve 85% recruitment of sales agents — {cluster} (target: {TARGET_PCT}%)</h2>
      <div className="ckpi-section-body">
        <table className="ckpi-table">
          <thead>
            <tr>
              <th>Region</th>
              <th className="ckpi-num">Target</th>
              <th className="ckpi-num">Achieved</th>
              <th className="ckpi-num">%</th>
            </tr>
          </thead>
          <tbody>
            {recruitmentTable.map((r, i) => (
              <tr key={i}>
                <td>{r.region}</td>
                <td className="ckpi-num">{formatTzs(r.target)}</td>
                <td className="ckpi-num">{formatTzs(r.achieved)}</td>
                <td className="ckpi-num">{formatPercentAccounting(r.pct)}</td>
              </tr>
            ))}
            {recruitmentTable.length > 0 && (
              <tr style={{ fontWeight: 600 }}>
                <td>Cluster total</td>
                <td className="ckpi-num">{formatTzs(clusterTotalTarget)}</td>
                <td className="ckpi-num">{formatTzs(clusterTotalAchieved)}</td>
                <td className="ckpi-num">{formatPercentAccounting(pct)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="ckpi-note">
          Source: Gap Analysis RSM. Actual Sales Reps Attained vs Target per region in cluster; summed to cluster. Target: {TARGET_PCT}%. Weight: {formatPercentAccounting(weightPct)}.
        </p>
        <p className="ckpi-note">Grade: <span className={`ckpi-grade ${grade.className}`}>{grade.label}</span></p>
      </div>
    </section>
  );
}
