import React from 'react';
import { segmentTrendExplanation } from '../utils/trendDataUtils';

/**
 * Renders trend narrative with dates/values/direction words in bold blue (report-data-value).
 */
export default function TrendExplanationText({ text, className = 'report-trend-explanation-text' }) {
  if (!text) return null;
  const segments = segmentTrendExplanation(text);
  return (
    <p className={className}>
      {segments.map((s, i) =>
        s.type === 'data' ? (
          <strong key={i} className="report-data-value">
            {s.value}
          </strong>
        ) : (
          <span key={i}>{s.value}</span>
        )
      )}
    </p>
  );
}
