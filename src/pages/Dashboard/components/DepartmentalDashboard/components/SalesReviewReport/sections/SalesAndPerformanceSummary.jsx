import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

const PRIMARY_BLUE = '#2a5298';
const NEW_BUSINESS_COLOR = '#1e3a6f'; // dark blue
const REPEAT_BUSINESS_COLOR = '#d4af37'; // gold

export default function SalesAndPerformanceSummary({
  summaryData,
  monthLabel,
  logoSrc,
  /** When true, omit the Gap/MTD "Actual Agents for the Month … % of target" line (CS main + LBF main use CRM line only). */
  hideActualAgentsMonthLine = false
}) {
  if (!summaryData) return null;

  const {
    disbursementsFormatted,
    targetFormatted,
    targetPct,
    newBusinessFormatted,
    repeatBusinessFormatted,
    newPct,
    repeatPct,
    numberOfLoansFormatted,
    averageLoanSizeFormatted,
    activeRepsFormatted,
    activeTarget,
    activeAchieved,
    activePct,
    actualTarget,
    actualAchieved,
    actualPct,
    crmActualRepsTotal,
    crmActualRepsDate,
    newBusiness,
    repeatBusiness
  } = summaryData;
  const hasActiveSummary = activeTarget != null;
  const hasActiveActualSummary = activeTarget != null && actualTarget != null;

  const label = summaryData.monthLabel || monthLabel;
  const pieData = [
    { name: 'New Business', value: newBusiness || 0, color: NEW_BUSINESS_COLOR },
    { name: 'Repeat Business', value: repeatBusiness || 0, color: REPEAT_BUSINESS_COLOR }
  ].filter((d) => d.value > 0);

  const hasPieData = pieData.length > 0;

  return (
    <div className="report-page report-page--summary">
      <div className="report-summary-header">
        <h2 className="report-summary-title">SALES AND PERFORMANCE SUMMARY</h2>
        {logoSrc && (
          <img src={logoSrc} alt="PCL" className="report-summary-logo" />
        )}
      </div>
      <div className="report-summary-line" />

      <p className="report-summary-para">
        The total amount disbursed in the month of <strong>{label}</strong> is{' '}
        <strong>{disbursementsFormatted} TZS</strong>, having achieved <strong>{targetPct}%</strong> of the total target{' '}
        <strong>{targetFormatted} TZS</strong>.
      </p>
      <div className="report-summary-line" />

      <div className="report-summary-split">
        <div className="report-summary-split-left">
          <p className="report-summary-para">
            Of the total amount disbursed in the month of <strong>{label}</strong>,{' '}
            <strong>{newBusinessFormatted} TZS ({newPct}%)</strong> came from new business and{' '}
            <strong>{repeatBusinessFormatted} TZS ({repeatPct}%)</strong> came from repeat business.
          </p>
        </div>
        <div className="report-summary-divider-vertical" aria-hidden="true" />
        <div className="report-summary-split-right">
          {hasPieData ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [v?.toLocaleString?.() ?? v, '']} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="report-summary-pie-empty">No new/repeat data for this month.</div>
          )}
        </div>
      </div>
      <div className="report-summary-line" />

      <p className="report-summary-para">
        The total loan counts for the month of <strong>{label}</strong> is{' '}
        <strong>{numberOfLoansFormatted}</strong>, making the average loan size be{' '}
        <strong>{averageLoanSizeFormatted} TZS</strong>.
      </p>
      <div className="report-summary-line" />

      {hasActiveActualSummary ? (
        <>
          <p className="report-summary-para">
            The total Number of Active Agents for the Month of <strong>{label}</strong> stands at{' '}
            <strong>{activeAchieved ?? activeRepsFormatted}</strong>, having achieved <strong>{activePct}%</strong> of the total Active Agent target ({' '}
            <strong>{activeTarget}</strong>).
          </p>
          {!hideActualAgentsMonthLine && (
            <>
              <div className="report-summary-line" />
              <p className="report-summary-para">
                The total Number of Actual Agents for the Month of <strong>{label}</strong> stands at{' '}
                <strong>{actualAchieved ?? 0}</strong>, having achieved <strong>{actualPct}%</strong> of the total Actual Agent target ({' '}
                <strong>{actualTarget}</strong>).
              </p>
            </>
          )}
          {crmActualRepsTotal != null && (
            <>
              <div className="report-summary-line" />
              <p className="report-summary-para">
                The total Number of Actual reps from CRM up to <strong>{crmActualRepsDate || label}</strong> stands at{' '}
                <strong>{crmActualRepsTotal}</strong>.
              </p>
            </>
          )}
        </>
      ) : hasActiveSummary ? (
        <>
          <p className="report-summary-para">
            The total Number of Active Agents for the Month of <strong>{label}</strong> stands at{' '}
            <strong>{activeAchieved ?? activeRepsFormatted}</strong>, having achieved <strong>{activePct}%</strong> of the total Active Agent target ({' '}
            <strong>{activeTarget}</strong>).
          </p>
          {crmActualRepsTotal != null && (
            <>
              <div className="report-summary-line" />
              <p className="report-summary-para">
                The total Number of Actual reps from CRM up to <strong>{crmActualRepsDate || label}</strong> stands at{' '}
                <strong>{crmActualRepsTotal}</strong>.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          {activeRepsFormatted != null && (
            <p className="report-summary-para">
              The total number of Active agents for the month of <strong>{label}</strong> stands at{' '}
              <strong>{activeRepsFormatted}</strong>.
            </p>
          )}
          {crmActualRepsTotal != null && (
            <>
              <div className="report-summary-line" />
              <p className="report-summary-para">
                The total Number of Actual reps from CRM up to <strong>{crmActualRepsDate || label}</strong> stands at{' '}
                <strong>{crmActualRepsTotal}</strong>.
              </p>
            </>
          )}
        </>
      )}

      <div className="report-page-bottom-line" />
    </div>
  );
}
