/**
 * Cluster KPI 7: Ensure 95% on location completion of plans.
 * CS CRM reports (month): agent_activity sheet; Product=CS, Zone for cluster regions (Zanzibar zone = Zanzibar cluster).
 * Status=COMPLETED, Target_Met=AT_LOCATION; % completed at location in cluster.
 */
import { formatTzs, formatPercentAccounting } from '../utils/csKpiTargets';
import './clusterKpiStyles.css';

const TARGET_PCT = 95;

function gradeFromPct(pct) {
  if (pct == null || Number.isNaN(pct)) return { label: 'N/A', className: 'na' };
  if (pct >= 95) return { label: 'Achieved', className: 'excellent' };
  if (pct >= 85) return { label: 'Good', className: 'good' };
  if (pct >= 70) return { label: 'Fair', className: 'fair' };
  return { label: 'Below target', className: 'weak' };
}

export default function ClusterKpi07OnLocationCompletion({
  cluster,
  monthLabel,
  completedAtLocation = 0,
  totalCompleted = 0,
  byZone = [],
  weightPct = 6,
  loading = false,
  onLocationTable = []
}) {
  const pct = totalCompleted > 0 ? (completedAtLocation / totalCompleted) * 100 : null;
  const grade = gradeFromPct(pct);
  const locSumCompleted = onLocationTable.reduce((s, row) => s + (Number(row.completed) || 0), 0);
  const locSumAtLoc = onLocationTable.reduce((s, row) => s + (Number(row.atLocation) || 0), 0);
  const pctLocBlended = locSumCompleted > 0 ? (locSumAtLoc / locSumCompleted) * 100 : null;

  if (loading) {
    return (
      <section className="ckpi-section">
        <h2 className="ckpi-section-title">7. Ensure 95% on location completion of plans</h2>
        <div className="ckpi-section-body"><p className="ckpi-note">Loading CRM reports…</p></div>
      </section>
    );
  }

  return (
    <section className="ckpi-section">
      <h2 className="ckpi-section-title">7. Ensure 95% on location completion of plans — {cluster} (target: {TARGET_PCT}%)</h2>
      <div className="ckpi-section-body">
        {onLocationTable.length > 0 && (
          <table className="ckpi-table">
            <thead>
              <tr>
                <th>Report Date</th>
                <th className="ckpi-num">Completed</th>
                <th className="ckpi-num">At location</th>
                <th className="ckpi-num">% At location</th>
              </tr>
            </thead>
            <tbody>
              {onLocationTable.map((row, i) => (
                <tr key={i}>
                  <td>{row.reportDate}</td>
                  <td className="ckpi-num">{formatTzs(row.completed)}</td>
                  <td className="ckpi-num">{formatTzs(row.atLocation)}</td>
                  <td className="ckpi-num">{formatPercentAccounting(row.pctAtLocation)}</td>
                </tr>
              ))}
              {onLocationTable.length > 0 ? (
                <tr style={{ fontWeight: 600 }}>
                  <td>Total / Average</td>
                  <td className="ckpi-num">{formatTzs(locSumCompleted)}</td>
                  <td className="ckpi-num">{formatTzs(locSumAtLoc)}</td>
                  <td className="ckpi-num">{formatPercentAccounting(pctLocBlended)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
        {byZone.length > 0 && (
          <table className="ckpi-table">
            <thead>
              <tr>
                <th>Zone</th>
                <th className="ckpi-num">Completed at location</th>
                <th className="ckpi-num">Total completed</th>
                <th className="ckpi-num">%</th>
              </tr>
            </thead>
            <tbody>
              {byZone.map((z, i) => (
                <tr key={i}>
                  <td>{z.zone}</td>
                  <td className="ckpi-num">{formatTzs(z.atLocation)}</td>
                  <td className="ckpi-num">{formatTzs(z.total)}</td>
                  <td className="ckpi-num">{z.total > 0 ? formatPercentAccounting((z.atLocation / z.total) * 100) : '—'}</td>
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
              <td>Completed at location (cluster)</td>
              <td className="ckpi-num">{formatTzs(completedAtLocation)}</td>
            </tr>
            <tr>
              <td>Total completed (cluster)</td>
              <td className="ckpi-num">{formatTzs(totalCompleted)}</td>
            </tr>
            <tr>
              <td>% at location</td>
              <td className="ckpi-num">{formatPercentAccounting(pct)}</td>
            </tr>
            <tr>
              <td>Grade</td>
              <td><span className={`ckpi-grade ${grade.className}`}>{grade.label}</span></td>
            </tr>
          </tbody>
        </table>
        <p className="ckpi-note">Source: CS CRM reports ({monthLabel}), agent_activity sheet: Product=CS only, Zone=zones within this cluster only; then Status=COMPLETED, Target_Met=AT_LOCATION. Weight: {formatPercentAccounting(weightPct)}.</p>
      </div>
    </section>
  );
}
