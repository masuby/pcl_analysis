/**
 * Cluster KPI 8: 80% achieved of Data consent from each Region.
 * CS CRM reports: Lead_Report sheet; Product=CS, Zone for cluster; Consent_Status=ACCEPTED percentage.
 */
import React from 'react';
import './clusterKpiStyles.css';

const TARGET_PCT = 80;

function gradeFromPct(pct) {
  if (pct == null || Number.isNaN(pct)) return { label: 'N/A', className: 'na' };
  if (pct >= 80) return { label: 'Achieved', className: 'excellent' };
  if (pct >= 65) return { label: 'Good', className: 'good' };
  if (pct >= 50) return { label: 'Fair', className: 'fair' };
  return { label: 'Below target', className: 'weak' };
}

export default function ClusterKpi08DataConsent({
  cluster,
  monthLabel,
  acceptedCount = 0,
  totalConsent = 0,
  byZone = [],
  weightPct = 5,
  loading = false,
  consentTable = []
}) {
  const pct = totalConsent > 0 ? (acceptedCount / totalConsent) * 100 : null;
  const grade = gradeFromPct(pct);

  if (loading) {
    return (
      <section className="ckpi-section">
        <h2 className="ckpi-section-title">8. 80% achieved of Data consent from each Region</h2>
        <div className="ckpi-section-body"><p className="ckpi-note">Loading CRM reports…</p></div>
      </section>
    );
  }

  return (
    <section className="ckpi-section">
      <h2 className="ckpi-section-title">8. 80% achieved of Data consent from each Region — {cluster} (target: {TARGET_PCT}%)</h2>
      <div className="ckpi-section-body">
        {consentTable.length > 0 && (
          <table className="ckpi-table">
            <thead>
              <tr>
                <th>Report Date</th>
                <th className="ckpi-num">Total lead</th>
                <th className="ckpi-num">Total consent (Accepted)</th>
                <th className="ckpi-num">% consented</th>
              </tr>
            </thead>
            <tbody>
              {consentTable.map((row, i) => (
                <tr key={i}>
                  <td>{row.reportDate}</td>
                  <td className="ckpi-num">{row.totalLead}</td>
                  <td className="ckpi-num">{row.accepted}</td>
                  <td className="ckpi-num">{row.pctConsented != null ? row.pctConsented.toFixed(2) + '%' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {byZone.length > 0 && (
          <table className="ckpi-table">
            <thead>
              <tr>
                <th>Zone</th>
                <th className="ckpi-num">Accepted</th>
                <th className="ckpi-num">Total</th>
                <th className="ckpi-num">%</th>
              </tr>
            </thead>
            <tbody>
              {byZone.map((z, i) => (
                <tr key={i}>
                  <td>{z.zone}</td>
                  <td className="ckpi-num">{z.accepted}</td>
                  <td className="ckpi-num">{z.total}</td>
                  <td className="ckpi-num">{z.total > 0 ? ((z.accepted / z.total) * 100).toFixed(2) + '%' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <table className="ckpi-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th className="ckpi-num">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Total lead (cluster, all reports in month)</td>
              <td className="ckpi-num">{totalConsent}</td>
            </tr>
            <tr>
              <td>Total consent (Accepted) (cluster)</td>
              <td className="ckpi-num">{acceptedCount}</td>
            </tr>
            <tr>
              <td>% accepted</td>
              <td className="ckpi-num">{pct != null ? pct.toFixed(2) + '%' : '—'}</td>
            </tr>
            <tr>
              <td>Grade</td>
              <td><span className={`ckpi-grade ${grade.className}`}>{grade.label}</span></td>
            </tr>
          </tbody>
        </table>
        <p className="ckpi-note">Source: CS CRM reports ({monthLabel}), Lead_Report sheet: Product=CS only, Zone=zones within this cluster only; then Consent_Status=ACCEPTED. Weight: {weightPct}%.</p>
      </div>
    </section>
  );
}
