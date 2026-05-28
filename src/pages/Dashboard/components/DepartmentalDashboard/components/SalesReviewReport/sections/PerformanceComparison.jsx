
/**
 * Renders one comparison bullet: "The total amount disbursed has increased by 2.44% (5.04 billion TZS vs 4.92 billion TZS)."
 * Values (pct, current, previous) are blue and bold.
 */
function ComparisonBullet({ prefix, dir, pct, currentFmt, prevFmt, suffix = '.' }) {
  return (
    <li className="report-comparison-bullet">
      {prefix} <strong className="report-data-value">{dir}</strong> by <strong className="report-data-value">{pct}%</strong> (<strong className="report-data-value">{currentFmt}</strong> vs <strong className="report-data-value">{prevFmt}</strong>){suffix}
    </li>
  );
}

const BULLET_LABELS = {
  disbursements: 'The total amount disbursed has',
  newBusiness: 'The amount disbursed for new business has',
  numberOfLoans: 'The total loan counts have',
  averageLoanSize: 'The average loan size has',
  portfolio: 'The total Outstanding Balance (portfolio) has',
  activeReps: 'The number of Active agents has'
};

export default function PerformanceComparison({ comparisonData, logoSrc }) {
  if (!comparisonData) return null;

  const { lastMonthLabel, lastYearLabel, lastMonth, lastYear } = comparisonData;
  const toBullets = (data) => ([
    [BULLET_LABELS.disbursements, data.disbursements],
    [BULLET_LABELS.newBusiness, data.newBusiness],
    [BULLET_LABELS.numberOfLoans, data.numberOfLoans],
    [BULLET_LABELS.averageLoanSize, data.averageLoanSize],
    [BULLET_LABELS.portfolio, data.portfolio],
    [BULLET_LABELS.activeReps, data.activeReps]
  ]).filter(([, metric]) => metric && metric.currentFmt != null && metric.prevFmt != null);

  return (
    <div className="report-page report-page--comparison">
      <div className="report-comparison-header">
        <h2 className="report-comparison-title">PERFORMANCE COMPARISON</h2>
        {logoSrc && <img src={logoSrc} alt="PCL" className="report-comparison-logo" />}
      </div>
      <div className="report-comparison-line" />

      <section className="report-comparison-section">
        <h3 className="report-comparison-section-title">Comparison to Last Month ({lastMonthLabel})</h3>
        <ul className="report-comparison-list">
          {lastMonth ? (
            <>
              {toBullets(lastMonth).map(([prefix, metric]) => (
                <ComparisonBullet key={prefix} prefix={prefix} {...metric} />
              ))}
            </>
          ) : (
            <li className="report-comparison-bullet">No data available for last month.</li>
          )}
        </ul>
      </section>

      <div className="report-comparison-line" />

      <section className="report-comparison-section">
        <h3 className="report-comparison-section-title">Comparison to Last Year ({lastYearLabel})</h3>
        <ul className="report-comparison-list">
          {lastYear ? (
            <>
              {toBullets(lastYear).map(([prefix, metric]) => (
                <ComparisonBullet key={prefix} prefix={prefix} {...metric} />
              ))}
            </>
          ) : (
            <li className="report-comparison-bullet">No data available for same month last year.</li>
          )}
        </ul>
      </section>

      <div className="report-page-bottom-line" />
    </div>
  );
}
