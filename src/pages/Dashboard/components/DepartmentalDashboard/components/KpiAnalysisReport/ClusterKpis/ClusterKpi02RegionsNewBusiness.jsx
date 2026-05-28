/**
 * Cluster KPI 2: Ensure all regions hit their new Business target at 100%.
 * Data from Gap Analysis RSM: New Loans Target vs Achieved per region in cluster.
 */
import { getBranchesForCluster } from './constants';
import { formatTzs, formatPercentAccounting } from '../utils/csKpiTargets';
import './clusterKpiStyles.css';

function gradeFromPct(pct) {
  if (pct == null || Number.isNaN(pct)) return { label: 'N/A', className: 'na' };
  if (pct >= 100) return { label: 'Achieved', className: 'excellent' };
  if (pct >= 90) return { label: 'Good', className: 'good' };
  if (pct >= 75) return { label: 'Fair', className: 'fair' };
  if (pct >= 50) return { label: 'Weak', className: 'weak' };
  return { label: 'Below target', className: 'poor' };
}

export default function ClusterKpi02RegionsNewBusiness({
  cluster,
  monthLabel,
  regionsNewBizTable = [],
  loading = false
}) {
  const totalRegions = regionsNewBizTable.length;
  const hitCount = regionsNewBizTable.filter((r) => r.target > 0 && r.achieved >= r.target).length;
  const pct = totalRegions > 0 ? (hitCount / totalRegions) * 100 : null;
  const grade = gradeFromPct(pct);
  const sumTarget = regionsNewBizTable.reduce((s, r) => s + (Number(r.target) || 0), 0);
  const sumAchieved = regionsNewBizTable.reduce((s, r) => s + (Number(r.achieved) || 0), 0);
  const pctWeighted = sumTarget > 0 ? (sumAchieved / sumTarget) * 100 : null;

  if (loading) {
    return (
      <section className="ckpi-section">
        <h2 className="ckpi-section-title">2. Ensure all regions hit their new Business target at 100%</h2>
        <div className="ckpi-section-body">
          <p className="ckpi-note">Loading RSM data…</p>
        </div>
      </section>
    );
  }

  const branchNamesInCluster = getBranchesForCluster(cluster);

  return (
    <section className="ckpi-section">
      <h2 className="ckpi-section-title">2. Ensure all regions hit their new Business target at 100% — {cluster}</h2>
      <div className="ckpi-section-body">
        <p className="ckpi-note">New business target per region (from Gap Analysis RSM — New Loans).</p>
        <table className="ckpi-table">
          <thead>
            <tr>
              <th>Region</th>
              <th className="ckpi-num">New Business Target</th>
              <th className="ckpi-num">Achieved</th>
              <th className="ckpi-num">%</th>
              <th>Hit target</th>
            </tr>
          </thead>
          <tbody>
            {regionsNewBizTable.map((r, i) => (
              <tr key={i}>
                <td>{r.region}</td>
                <td className="ckpi-num">{formatTzs(r.target)}</td>
                <td className="ckpi-num">{formatTzs(r.achieved)}</td>
                <td className="ckpi-num">{formatPercentAccounting(r.pct)}</td>
                <td>{r.target > 0 && r.achieved >= r.target ? <span className="ckpi-grade excellent">Yes</span> : <span className="ckpi-grade fail">No</span>}</td>
              </tr>
            ))}
            {regionsNewBizTable.length > 0 ? (
              <tr style={{ fontWeight: 600 }}>
                <td>Total / Average</td>
                <td className="ckpi-num">{formatTzs(sumTarget)}</td>
                <td className="ckpi-num">{formatTzs(sumAchieved)}</td>
                <td className="ckpi-num">{formatPercentAccounting(pctWeighted)}</td>
                <td>—</td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <p className="ckpi-note">
          Regions in cluster: {branchNamesInCluster.join(', ')}. Summary: {formatTzs(hitCount)} of {formatTzs(totalRegions)} regions hit target = {formatPercentAccounting(pct)}.
        </p>
        <p className="ckpi-note">
          Grade: <span className={`ckpi-grade ${grade.className}`}>{grade.label}</span>
        </p>
      </div>
    </section>
  );
}
