/**
 * Performance comparison slide: tight vertical rhythm so 6+6 bullets fit above the footer (~5.5").
 * Used by pptxGenerator (countrywide) and pptxSectionSlides (product sections).
 */
export const PPTX_COMPARISON_TIGHT = {
  /** Bullet body — small to fit 12 bullets on one slide */
  FS: 9,
  /** Minimal gap between stacked bullet rows (inches) */
  GAP: 0.015,
  /** "Comparison to Last Month" */
  LM_TITLE_Y: 1.02,
  LM_TITLE_FS: 11,
  LM_TITLE_H: 0.18,
  /** First bullet row — immediately under section title */
  LM_BULLETS_Y: 1.22,
  /** Space after rule before "Last Year" heading */
  AFTER_DIVIDER: 0.045,
  LY_TITLE_H: 0.18,
  /** Delta from "Last Year" heading box top → first bullet (title height + sliver) */
  LY_HEADER_TO_BULLETS: 0.21,
  /** Divider line: gap after last LM bullet */
  DIVIDER_PAD: 0.02
};

/**
 * Row height (inches) for comparison bullets. Compact currency strings → usually 1 line; cap keeps 12 rows on-slide.
 *
 * @param {string} prefix
 * @param {{ dir: string, pct: string, currentFmt: string, prevFmt: string }} metric
 * @param {number} [fontSize] - default PPTX_COMPARISON_TIGHT.FS
 */
export function estimateComparisonBulletHeight(prefix, metric, fontSize = PPTX_COMPARISON_TIGHT.FS) {
  if (!metric) return 0.2;
  const text = `${prefix} has ${metric.dir} by ${metric.pct}% (${metric.currentFmt} vs ${metric.prevFmt}).`;
  const len = text.length;
  const charsPerLine = fontSize <= 9 ? 88 : fontSize <= 10 ? 80 : 72;
  const lines = Math.max(1, Math.ceil(len / charsPerLine));
  const lineHeight = 0.11;
  const pad = 0.035;
  return Math.min(0.28, Math.max(0.185, lines * lineHeight + pad));
}
