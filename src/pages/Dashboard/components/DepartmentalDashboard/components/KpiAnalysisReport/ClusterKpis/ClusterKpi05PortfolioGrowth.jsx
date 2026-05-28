/**
 * Cluster KPI 5: Growth portfolio and client base by 20% Annually.
 * Management report: Portfolio column per cluster; current vs previous month, change annualized.
 */
import { formatTzs, formatPercentAccounting } from '../utils/csKpiTargets';
import './clusterKpiStyles.css';

const TARGET_ANNUAL_PCT = 20;

function gradeFromAnnualPct(pct) {
  if (pct == null || Number.isNaN(pct)) return { label: 'N/A', className: 'na' };
  if (pct >= 20) return { label: 'Achieved', className: 'excellent' };
  if (pct >= 15) return { label: 'Good', className: 'good' };
  if (pct >= 10) return { label: 'Fair', className: 'fair' };
  return { label: 'Below target', className: 'weak' };
}

export default function ClusterKpi05PortfolioGrowth({
  cluster,
  monthLabel,
  portfolioCurrent = null,
  portfolioPrevious = null,
  loading = false
}) {
  const cur = typeof portfolioCurrent === 'number' ? portfolioCurrent : (portfolioCurrent != null ? parseFloat(portfolioCurrent) : NaN);
  const prev = typeof portfolioPrevious === 'number' ? portfolioPrevious : (portfolioPrevious != null ? parseFloat(portfolioPrevious) : NaN);
  const growthPct = Number.isFinite(prev) && prev > 0 && Number.isFinite(cur) ? ((cur - prev) / prev) * 100 : null;
  const annualized = growthPct != null ? growthPct * 12 : null;
  const grade = gradeFromAnnualPct(annualized);

  if (loading) {
    return (
      <section className="ckpi-section">
        <h2 className="ckpi-section-title">5. Growth portfolio and client base by 20% Annually</h2>
        <div className="ckpi-section-body"><p className="ckpi-note">Loading…</p></div>
      </section>
    );
  }

  return (
    <section className="ckpi-section">
      <h2 className="ckpi-section-title">5. Growth portfolio and client base by 20% Annually — {cluster}</h2>
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
              <td>Portfolio ({monthLabel})</td>
              <td className="ckpi-num">{Number.isFinite(cur) ? formatTzs(cur) : '—'}</td>
            </tr>
            <tr>
              <td>Portfolio (previous month)</td>
              <td className="ckpi-num">{Number.isFinite(prev) ? formatTzs(prev) : '—'}</td>
            </tr>
            <tr>
              <td>Monthly growth %</td>
              <td className="ckpi-num">{growthPct != null ? formatPercentAccounting(growthPct) : '—'}</td>
            </tr>
            <tr>
              <td>Annualized growth %</td>
              <td className="ckpi-num">{annualized != null ? formatPercentAccounting(annualized) : '—'}</td>
            </tr>
            <tr>
              <td>Grade</td>
              <td><span className={`ckpi-grade ${grade.className}`}>{grade.label}</span></td>
            </tr>
          </tbody>
        </table>
        <p className="ckpi-note">Source: Management report Portfolio column for cluster. Target: {TARGET_ANNUAL_PCT}% annualized.</p>
      </div>
    </section>
  );
}
