const MAX_TREND_MONTHS = 15;

/**
 * Get latest data point per month from countrywise-style rows (each has date + metrics).
 * Returns at most 15 months (newest first), each with the latest record for that month.
 * @param {Array<{ date: Date|string, [key: string]: any }>} countrywiseData
 * @returns {Array<{ monthKey: string, label: string, date: Date, disbursements: number, loans: number }>}
 */
export function getMonthlyTrendData(countrywiseData) {
  if (!countrywiseData || countrywiseData.length === 0) return [];

  const byMonth = {};
  countrywiseData.forEach(row => {
    const d = row.date instanceof Date ? row.date : new Date(row.date);
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const existing = byMonth[monthKey];
    if (!existing || d > (existing.date instanceof Date ? existing.date : new Date(existing.date))) {
      byMonth[monthKey] = {
        monthKey,
        date: d,
        label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        disbursements: Number(row['Disbursements This Month']) || 0,
        loans: Number(row['Number of loans'] || row['Number of Loans']) || 0
      };
    }
  });

  const sorted = Object.values(byMonth).sort((a, b) => {
    const tA = a.date instanceof Date ? a.date : new Date(a.date);
    const tB = b.date instanceof Date ? b.date : new Date(b.date);
    return tA - tB;
  });

  return sorted.slice(-MAX_TREND_MONTHS);
}

/**
 * Format value for chart labels: B, M, or K.
 */
export function formatLabel(value) {
  if (value == null || isNaN(value)) return '0';
  const n = Number(value);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

/**
 * Generate trend explanation text from monthly data.
 * e.g. "Trend: From Oct 2022, the highest sales were achieved in Jan 2025, it drastically dropped in Feb 2025..."
 */
function formatMonthYear(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function getTrendExplanation(monthlyData) {
  if (!monthlyData || monthlyData.length < 2) {
    return 'Insufficient data to describe trend.';
  }

  const first = monthlyData[0];
  const last = monthlyData[monthlyData.length - 1];
  const firstLabel = formatMonthYear(first.date);
  const lastLabel = formatMonthYear(last.date);

  let maxPoint = first;
  let minPoint = first;
  monthlyData.forEach(p => {
    if (p.disbursements > maxPoint.disbursements) maxPoint = p;
    if (p.disbursements < minPoint.disbursements) minPoint = p;
  });

  const maxLabel = formatMonthYear(maxPoint.date);
  const minLabel = formatMonthYear(minPoint.date);
  const maxVal = formatLabel(maxPoint.disbursements);
  const minVal = formatLabel(minPoint.disbursements);

  const parts = [];
  if (maxPoint === minPoint) {
    parts.push(`Trend: From ${firstLabel}, disbursements in the period were ${maxVal} (${maxLabel}).`);
    return parts.join(' ');
  }

  parts.push(`Trend: From ${firstLabel}, the highest sales were achieved in ${maxLabel} (${maxVal}), while the lowest was in ${minLabel} (${minVal}).`);

  if (last.disbursements >= maxPoint.disbursements) {
    parts.push(`Sales have recovered and reached a peak again in ${lastLabel}.`);
    return parts.join(' ');
  }

  if (minPoint.disbursements < maxPoint.disbursements && minPoint !== maxPoint) {
    parts.push(`It drastically dropped in ${minLabel}.`);
  }

  if (last.disbursements > minPoint.disbursements && last.disbursements < maxPoint.disbursements) {
    parts.push(`Later on it has experienced an upward movement but has not fully recovered to its highest sales that were achieved in ${maxLabel}.`);
  } else if (last.disbursements <= minPoint.disbursements) {
    parts.push(`Sales have remained low through ${lastLabel}.`);
  } else {
    parts.push(`By ${lastLabel}, sales have shown movement relative to the period.`);
  }

  return parts.join(' ');
}
