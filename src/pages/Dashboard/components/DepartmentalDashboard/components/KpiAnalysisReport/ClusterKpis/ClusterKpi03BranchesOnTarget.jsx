/**
 * Cluster KPI 3: 90% of branches to be on sales target.
 * Uses branches from Zone and cluster.xlsx in the respective cluster;
 * Target vs Disbursement this month from Management report (branch-level).
 */
import { formatTzs, formatPercentAccounting } from '../utils/csKpiTargets';
import { getColorForPct } from './clusterKpiUtils';
import './clusterKpiStyles.css';

const TARGET_PCT = 90;

function gradeFromPct(pct) {
  if (pct == null || Number.isNaN(pct)) return { label: 'N/A', className: 'na' };
  if (pct >= 90) return { label: 'Achieved', className: 'excellent' };
  if (pct >= 75) return { label: 'Good', className: 'good' };
  if (pct >= 50) return { label: 'Fair', className: 'fair' };
  return { label: 'Below target', className: 'weak' };
}

export default function ClusterKpi03BranchesOnTarget({
  cluster,
  monthLabel,
  branches = [],
  weightPct = 10,
  loading = false
}) {
  const totalBranches = branches.length;
  const atOrAbove100 = branches.filter((b) => (b.pct ?? 0) >= 100).length;
  const pctBranchesOnTarget = totalBranches > 0 ? (atOrAbove100 / totalBranches) * 100 : null;
  const grade = gradeFromPct(pctBranchesOnTarget);
  const totalTargetSum = branches.reduce((s, b) => s + (Number(b.target) || 0), 0);
  const totalDisbursementSum = branches.reduce((s, b) => s + (Number(b.disbursement) || 0), 0);
  const pctBlended = totalTargetSum > 0 ? (totalDisbursementSum / totalTargetSum) * 100 : null;

  if (loading) {
    return (
      <section className="ckpi-section">
        <h2 className="ckpi-section-title">3. 90% of branches to be on sales target</h2>
        <div className="ckpi-section-body"><p className="ckpi-note">Loading…</p></div>
      </section>
    );
  }

  return (
    <section className="ckpi-section">
      <h2 className="ckpi-section-title">3. 90% of branches to be on sales target — {cluster} (target: {TARGET_PCT}%)</h2>
      <div className="ckpi-section-body">
        <table className="ckpi-table">
          <thead>
            <tr>
              <th>Branch</th>
              <th className="ckpi-num">Target</th>
              <th className="ckpi-num">Disbursement this month</th>
              <th className="ckpi-num">%</th>
              <th>≥100%</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b, i) => (
              <tr key={i} style={{ backgroundColor: getColorForPct(b.pct ?? 0) }}>
                <td>{b.branch}</td>
                <td className="ckpi-num">{formatTzs(b.target)}</td>
                <td className="ckpi-num">{formatTzs(b.disbursement)}</td>
                <td className="ckpi-num">{formatPercentAccounting(b.pct)}</td>
                <td>{(b.pct ?? 0) >= 100 ? <span className="ckpi-grade excellent">Yes</span> : <span className="ckpi-grade fail">No</span>}</td>
              </tr>
            ))}
            {branches.length > 0 ? (
              <tr style={{ fontWeight: 600 }}>
                <td>Total / Average</td>
                <td className="ckpi-num">{formatTzs(totalTargetSum)}</td>
                <td className="ckpi-num">{formatTzs(totalDisbursementSum)}</td>
                <td className="ckpi-num">{formatPercentAccounting(pctBlended)}</td>
                <td>—</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="ckpi-note">
          Branches at ≥100%: {formatTzs(atOrAbove100)} of {formatTzs(totalBranches)} = {formatPercentAccounting(pctBranchesOnTarget)} (target {TARGET_PCT}%). Weight: {formatPercentAccounting(weightPct)}.
        </p>
        <p className="ckpi-note">Grade: <span className={`ckpi-grade ${grade.className}`}>{grade.label}</span></p>
      </div>
    </section>
  );
}
