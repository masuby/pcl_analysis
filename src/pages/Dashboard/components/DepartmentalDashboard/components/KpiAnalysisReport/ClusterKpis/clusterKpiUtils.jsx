/**
 * Shared helpers for Cluster KPI components (row colours, calculation labels).
 */
import React from 'react';

/** 6-tier colour for % (matches Summary table KPI): violet best → red poorest. */
export function getColorForPct(pct) {
  if (pct >= 100) return '#8B5CF6';
  if (pct >= 75) return '#2563EB';
  if (pct >= 50) return '#22C55E';
  if (pct >= 25) return '#EAB308';
  if (pct > 10) return '#F97316';
  return '#EF4444';
}

/** One-to-two row table for "How this KPI summary is calculated". */
export function CalcTable({ rows }) {
  if (!rows?.length) return null;
  return (
    <table className="ckpi-table ckpi-calc-table">
      <thead>
        <tr>
          <th>How this KPI is calculated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((text, i) => (
          <tr key={i}>
            <td className="ckpi-calc-cell">{text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Pick a display label for the active KPI target file.
 * Used so cluster KPI sections can say "Source: <uploaded file name>".
 */
export function getEffectiveKpiTargetFileLabel(uploadedName, fallbackName) {
  const v = String(uploadedName || '').trim();
  return v ? v : fallbackName;
}
