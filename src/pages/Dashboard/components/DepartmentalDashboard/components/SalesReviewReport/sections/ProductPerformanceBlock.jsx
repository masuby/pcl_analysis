import GeneralSalesTrendChart from './GeneralSalesTrendChart';
import SalesAndPerformanceSummary from './SalesAndPerformanceSummary';
import PerformanceComparison from './PerformanceComparison';
import PerProductContribution from './PerProductContribution';
import NewBusinessPerformance from './NewBusinessPerformance';
import RepeatBusinessPerformance from './RepeatBusinessPerformance';
import SupervisionPerformance from './SupervisionPerformance';
import TrendExplanationText from './TrendExplanationText';

/**
 * Reusable block for a product section (CS, LBF, IPF, SME, etc.).
 * Renders the same flow: section title page, summary, trend chart, comparison, new/repeat business performance, (optional) product contribution, (optional) supervision performance.
 */
export default function ProductPerformanceBlock({
  section,
  summaryData,
  comparisonData,
  monthlyTrendData,
  trendExplanation,
  productContributionData,
  newBusinessComparison,
  newBusinessTrend,
  repeatBusinessComparison,
  repeatBusinessTrend,
  supervisionData,
  monthLabel,
  logoSrc
}) {
  if (!section) return null;

  const { tocNumber, title, trendTitle } = section;
  const showProductContribution = productContributionData && productContributionData.products?.length > 0;

  return (
    <>
      {/* Section title page (e.g. "2. CS PRODUCT PERFORMANCE HIGHLIGHTS") */}
      <div className="report-page report-page--content report-page--general">
        <div className="report-general-center">
          {logoSrc && <img src={logoSrc} alt="PCL" className="report-general-logo" />}
          <h2 className="report-general-title">{tocNumber}. {title}</h2>
        </div>
        <div className="report-page-bottom-line" />
      </div>

      {/* Sales and Performance Summary */}
      <SalesAndPerformanceSummary
        summaryData={summaryData}
        monthLabel={monthLabel}
        logoSrc={logoSrc}
        hideActualAgentsMonthLine={section.id?.startsWith('cs-') || section.id === 'lbf'}
      />

      {/* Sales Trend (chart + explanation) */}
      <div className="report-page report-page--trend">
        <div className="report-trend-header">
          <h2 className="report-trend-title">{trendTitle}</h2>
          {logoSrc && <img src={logoSrc} alt="PCL" className="report-trend-logo" />}
        </div>
        <div className="report-trend-line" />
        <div className="report-trend-chart-area">
          <GeneralSalesTrendChart monthlyData={monthlyTrendData} />
        </div>
        <div className="report-trend-explanation">
          <TrendExplanationText text={trendExplanation} />
        </div>
        <div className="report-page-bottom-line" />
      </div>

      {/* Performance Comparison */}
      <PerformanceComparison comparisonData={comparisonData} logoSrc={logoSrc} />

      {/* New Business Sales Performance */}
      {newBusinessComparison && (
        <NewBusinessPerformance
          comparisonData={newBusinessComparison}
          trendData={newBusinessTrend}
          logoSrc={logoSrc}
        />
      )}

      {/* Repeat Business Sales Performance */}
      {repeatBusinessComparison && (
        <RepeatBusinessPerformance
          comparisonData={repeatBusinessComparison}
          trendData={repeatBusinessTrend}
          logoSrc={logoSrc}
        />
      )}

      {/* Per Product Contribution (only if section has sub-products with data) */}
      {showProductContribution && (
        <PerProductContribution productData={productContributionData} logoSrc={logoSrc} />
      )}

      {/* Supervision Performance (LBF and CS Mainland from MTD) */}
      {supervisionData?.rows?.length > 0 && (
        <SupervisionPerformance supervisionData={supervisionData} logoSrc={logoSrc} />
      )}
    </>
  );
}
