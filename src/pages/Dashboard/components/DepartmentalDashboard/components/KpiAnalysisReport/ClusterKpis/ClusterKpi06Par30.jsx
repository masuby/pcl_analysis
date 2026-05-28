/**
 * Cluster KPI 6: Maintain PAR 30 days under 5% for the cluster.
 * Management report: PAR >30 per cluster; check if under 5%, grade and analysis.
 */
import { formatPercentAccounting } from '../utils/csKpiTargets';
import './clusterKpiStyles.css';

const PAR_TARGET_PCT = 5;

function gradeFromPar(parPct) {
  if (parPct == null || Number.isNaN(parPct)) return { label: 'N/A', className: 'na' };
  if (parPct <= 3) return { label: 'Excellent', className: 'excellent' };
  if (parPct <= 5) return { label: 'On target', className: 'good' };
  if (parPct <= 7) return { label: 'Fair', className: 'fair' };
  if (parPct <= 10) return { label: 'Weak', className: 'weak' };
  return { label: 'Above 5%', className: 'fail' };
}

export default function ClusterKpi06Par30({
  cluster,
  monthLabel,
  par30Pct = null,
  loading = false
}) {
  const num = par30Pct != null ? (typeof par30Pct === 'number' ? par30Pct : parseFloat(par30Pct)) : NaN;
  const display = Number.isFinite(num) ? formatPercentAccounting(num) : '—';
  const grade = gradeFromPar(Number.isFinite(num) ? num : null);

  if (loading) {
    return (
      <section className="ckpi-section">
        <h2 className="ckpi-section-title">6. Maintain PAR 30 days under 5% for the cluster</h2>
        <div className="ckpi-section-body"><p className="ckpi-note">Loading…</p></div>
      </section>
    );
  }

  return (
    <section className="ckpi-section">
      <h2 className="ckpi-section-title">6. Maintain PAR 30 days under 5% for the cluster — {cluster}</h2>
      <div className="ckpi-section-body">
        <table className="ckpi-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th className="ckpi-num">Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>PAR &gt;30 ({monthLabel})</td>
              <td className="ckpi-num">{display}</td>
            </tr>
            <tr>
              <td>Target</td>
              <td className="ckpi-num">≤ {PAR_TARGET_PCT}%</td>
            </tr>
            <tr>
              <td>Grade</td>
              <td><span className={`ckpi-grade ${grade.className}`}>{grade.label}</span></td>
            </tr>
          </tbody>
        </table>
        <p className="ckpi-note">Source: Management report PAR &gt;30 for cluster.</p>
      </div>
    </section>
  );
}
