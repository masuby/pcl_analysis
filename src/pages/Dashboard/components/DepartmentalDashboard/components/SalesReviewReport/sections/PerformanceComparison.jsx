import React from 'react';

/**
 * Renders one comparison bullet: "The total amount disbursed has increased by 2.44% (5.04 billion TZS vs 4.92 billion TZS)."
 * Values (pct, current, previous) are blue and bold.
 */
function ComparisonBullet({ prefix, dir, pct, currentFmt, prevFmt, suffix = '.' }) {
  return (
    <li className="report-comparison-bullet">
      {prefix} <strong className="report-comparison-value">{dir}</strong> by <strong className="report-comparison-value">{pct}%</strong> (<strong className="report-comparison-value">{currentFmt}</strong> vs <strong className="report-comparison-value">{prevFmt}</strong>){suffix}
    </li>
  );
}

const BULLET_LABELS = {
  disbursements: 'The total amount disbursed has',
  newBusiness: 'The amount disbursed for new business has',
  numberOfLoans: 'The total loan counts have',
  averageLoanSize: 'The average loan size has',
  activeReps: 'The number of Active agents has'
};

export default function PerformanceComparison({ comparisonData, logoSrc }) {
  if (!comparisonData) return null;

  const { lastMonthLabel, lastYearLabel, lastMonth, lastYear } = comparisonData;

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
              <ComparisonBullet prefix={BULLET_LABELS.disbursements} {...lastMonth.disbursements} />
              <ComparisonBullet prefix={BULLET_LABELS.newBusiness} {...lastMonth.newBusiness} />
              <ComparisonBullet prefix={BULLET_LABELS.numberOfLoans} {...lastMonth.numberOfLoans} />
              <ComparisonBullet prefix={BULLET_LABELS.averageLoanSize} {...lastMonth.averageLoanSize} suffix="." />
              <ComparisonBullet prefix={BULLET_LABELS.activeReps} {...lastMonth.activeReps} />
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
              <ComparisonBullet prefix={BULLET_LABELS.disbursements} {...lastYear.disbursements} />
              <ComparisonBullet prefix={BULLET_LABELS.newBusiness} {...lastYear.newBusiness} />
              <ComparisonBullet prefix={BULLET_LABELS.numberOfLoans} {...lastYear.numberOfLoans} />
              <ComparisonBullet prefix={BULLET_LABELS.averageLoanSize} {...lastYear.averageLoanSize} suffix="." />
              <ComparisonBullet prefix={BULLET_LABELS.activeReps} {...lastYear.activeReps} />
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
