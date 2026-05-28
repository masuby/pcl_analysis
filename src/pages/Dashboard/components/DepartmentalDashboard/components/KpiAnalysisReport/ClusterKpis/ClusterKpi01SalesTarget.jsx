/**
 * Cluster KPI 1: Achieve 100% of overall cluster sales target.
 * Uses Management report Country sheet: Disbursement in the respective month (last report)
 * vs Cluster target from CS_KPI_CLUSTER_TARGET_NEW_FILE_2026.xlsx.
 */
import { formatTzs, formatPercentAccounting } from '../utils/csKpiTargets';
import { getEffectiveKpiTargetFileLabel } from './clusterKpiUtils';
import './clusterKpiStyles.css';

function gradeFromPct(pct) {
  if (pct == null || Number.isNaN(pct)) return { label: 'N/A', className: 'na' };
  if (pct >= 100) return { label: 'Achieved', className: 'excellent' };
  if (pct >= 90) return { label: 'Good', className: 'good' };
  if (pct >= 75) return { label: 'Fair', className: 'fair' };
  if (pct >= 50) return { label: 'Weak', className: 'weak' };
  if (pct >= 25) return { label: 'Poor', className: 'poor' };
  return { label: 'Below target', className: 'fail' };
}

export default function ClusterKpi01SalesTarget({
  cluster,
  monthLabel,
  clusterTarget = 0,
  disbursement = null,
  clusterTargetFileName = '',
  loading = false
}) {
  const disbursementNum = typeof disbursement === 'number' ? disbursement : (disbursement != null ? parseFloat(disbursement) : NaN);
  const pct = Number.isFinite(disbursementNum) && clusterTarget > 0
    ? (disbursementNum / clusterTarget) * 100
    : null;
  const grade = gradeFromPct(pct);
  const clusterTargetFileLabel = getEffectiveKpiTargetFileLabel(
    clusterTargetFileName,
    'CS_KPI_CLUSTER_TARGET_NEW_FILE_2026.xlsx'
  );

  if (loading) {
    return (
      <section className="ckpi-section">
        <h2 className="ckpi-section-title">1. Achieve 100% of overall cluster sales target</h2>
        <div className="ckpi-section-body">
          <p className="ckpi-note">Loading management report…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="ckpi-section">
      <h2 className="ckpi-section-title">1. Achieve 100% of overall cluster sales target — {cluster}</h2>
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
              <td>Cluster target ({monthLabel})</td>
              <td className="ckpi-num">{formatTzs(clusterTarget)}</td>
            </tr>
            <tr>
              <td>Disbursement this month (Management report – Country sheet)</td>
              <td className="ckpi-num">{Number.isFinite(disbursementNum) ? formatTzs(disbursementNum) : '—'}</td>
            </tr>
            <tr>
              <td>% achieved</td>
              <td className="ckpi-num">{formatPercentAccounting(pct)}</td>
            </tr>
            <tr>
              <td>Grade</td>
              <td><span className={`ckpi-grade ${grade.className}`}>{grade.label}</span></td>
            </tr>
          </tbody>
        </table>
        <p className="ckpi-note">
          Source: Last management report in selected month; Country sheet cluster row. Target from {clusterTargetFileLabel} ({cluster} sheet).
        </p>
      </div>
    </section>
  );
}
