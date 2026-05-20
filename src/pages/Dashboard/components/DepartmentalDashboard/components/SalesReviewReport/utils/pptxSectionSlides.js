/**
 * Append slides for one product section (CS, LBF, IPF, etc.) to the PPTX.
 * Same flow as country: title page, summary, trend chart, comparison, (optional) product contribution.
 */
import PptxGenJS from 'pptxgenjs';
import { estimateComparisonBulletHeight, PPTX_COMPARISON_TIGHT } from './pptxComparisonLayout';
import {
  pptxRunsTrendExplanation,
  pptxRunsSummaryP1,
  pptxRunsSummaryP2,
  pptxRunsSummaryP3,
  pptxRunsCrmActual,
  pptxRunsActiveAgentsWithTarget,
  pptxRunsActualAgentsWithTarget,
  pptxRunsActiveAgentsSimple,
  pptxRunsNewBusinessExplanation,
  pptxRunsRepeatBusinessExplanation,
  pptxRunsProductContributionSubtitle
} from './pptxSalesReviewTextRuns';

const PRIMARY_BLUE = '2a5298';
const PRIMARY_BLUE_DARK = '1e3a6f';
const GOLD = 'd4af37';
const WHITE = 'FFFFFF';
const DARK = '1e293b';
const GRAY = '64748b';
const ACCENT_BLUE = '4a90e2';
const TEAL = '0d9488';
const LIGHT_BG = 'f8fafc';
const SOFT_BLUE = 'e0f2fe';
const MUTED_GOLD = 'fef3c7';
const FONT_FACE = 'Segoe UI';
const FONT_BODY = 'Segoe UI';
const BOTTOM_LINE_Y = 5.85;
const BOTTOM_LINE_H = 0.06;
const CONTENT_END_Y = 5.5;

/** Scale chart values to B/M/K and use simple format for cross-viewer data labels (PowerPoint, Google Slides, etc.) */
function getChartScale(valueArrays) {
  let maxVal = 0;
  const flat = (valueArrays || []).flat().filter((v) => v != null && !isNaN(v));
  flat.forEach((v) => { const n = Math.abs(Number(v)); if (n > maxVal) maxVal = n; });
  let scale = 1;
  let suffix = '';
  if (maxVal >= 1e9) { scale = 1e9; suffix = 'B'; } else if (maxVal >= 1e6) { scale = 1e6; suffix = 'M'; } else if (maxVal >= 1e3) { scale = 1e3; suffix = 'K'; }
  const formatCode = suffix ? `0.0"${suffix}"` : '0.0';
  return {
    scale,
    suffix,
    formatCode,
    scaled: (arr) => (arr || []).map((v) => (v != null && !isNaN(v) ? Math.round((Number(v) / scale) * 10) / 10 : 0)),
    maxScaled: flat.length ? Math.ceil((Math.max(...flat.map((v) => Math.abs(Number(v)))) / scale) * 1.15) : 1
  };
}

function addBottomLine(slide, pptx) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: BOTTOM_LINE_Y,
    w: 9,
    h: BOTTOM_LINE_H,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });
}

function addFloatingBubbles(slide, pres) {
  const bubbles = [
    { x: 7.5, y: 0.2, w: 1.8, h: 1.8, color: ACCENT_BLUE, transparency: 88 },
    { x: -0.3, y: 2.5, w: 1.4, h: 1.4, color: GOLD, transparency: 90 },
    { x: 8.2, y: 4.8, w: 1.2, h: 1.2, color: SOFT_BLUE, transparency: 85 },
    { x: -0.2, y: 5.5, w: 1.0, h: 1.0, color: PRIMARY_BLUE, transparency: 91 },
    { x: 7.8, y: 6.2, w: 0.9, h: 0.9, color: MUTED_GOLD, transparency: 90 },
    { x: 0.1, y: 0.8, w: 0.7, h: 0.7, color: TEAL, transparency: 89 }
  ];
  bubbles.forEach((b) => {
    slide.addShape(pres.ShapeType.ellipse, {
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      fill: { color: b.color, transparency: b.transparency },
      line: { type: 'none' }
    });
  });
}

function addSectionHeader(slide, pptx, title, logoBase64, headlineColor = PRIMARY_BLUE_DARK) {
  slide.addText(title, {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: headlineColor,
    fontFace: FONT_FACE
  });
  if (logoBase64) {
    try {
      slide.addImage({
        data: logoBase64,
        x: 7.2,
        y: 0.3,
        w: 1.5,
        h: 0.6,
        sizing: { type: 'contain', w: 1.5, h: 0.6 }
      });
    } catch (e) {
      console.warn('Could not add logo', e);
    }
  }
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 0.95,
    w: 8.5,
    h: 0.02,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });
}

/**
 * Add all slides for one product section.
 * @param {PptxGenJS} pptx
 * @param {{ tocNumber: string, title: string, trendTitle: string, productKeys?: string[] }} section - from reportSectionConfig
 * @param {{ summaryData, comparisonData, monthlyTrendData, trendExplanation, productContributionData }} sectionData
 * @param {string|null} logoBase64
 * @param {string} monthLabel
 */
/** Full spectrum by percentage (0–100%): violet → indigo → blue → green → yellow → orange → red. */
const PERCENTAGE_COLOR_BANDS = [
  { min: 90, color: '7c3aed' },   // violet  (≥90%)
  { min: 80, color: '4f46e5' },   // indigo  (80–90%)
  { min: 70, color: '2563eb' },   // blue    (70–80%)
  { min: 50, color: '16a34a' },   // green   (50–70%)
  { min: 30, color: 'eab308' },   // yellow  (30–50%)
  { min: 10, color: 'ea580c' },   // orange  (10–30%)
  { min: 0, color: 'dc2626' }     // red     (<10%)
];

function getColorForPercentage(pct) {
  const n = Math.min(100, Math.max(0, Number(pct) || 0));
  for (let i = 0; i < PERCENTAGE_COLOR_BANDS.length; i++) {
    if (n >= PERCENTAGE_COLOR_BANDS[i].min) return PERCENTAGE_COLOR_BANDS[i].color;
  }
  return PERCENTAGE_COLOR_BANDS[PERCENTAGE_COLOR_BANDS.length - 1].color;
}

function formatSupervisionValue(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

function addSupervisionSlide(pptx, section, supervisionData, logoBase64) {
  const { rows, totalTarget, totalValue, totalActiveReps = 0, totalActualReps = 0 } = supervisionData;
  if (!rows || rows.length === 0) return;
  const slide = pptx.addSlide();
  slide.background = { color: LIGHT_BG };
  addFloatingBubbles(slide, pptx);
  addSectionHeader(slide, pptx, 'SUPERVISION PERFORMANCE', logoBase64, TEAL);

  const totalPct = totalTarget > 0 ? ((totalValue / totalTarget) * 100).toFixed(1) : '0';
  const tableHeader = [
    { text: 'Supervision', options: { bold: true, fontFace: FONT_FACE, fontSize: 9, color: WHITE, fill: { color: PRIMARY_BLUE } } },
    { text: 'Target', options: { bold: true, align: 'right', fontFace: FONT_FACE, fontSize: 9, color: WHITE, fill: { color: PRIMARY_BLUE } } },
    { text: 'Value', options: { bold: true, align: 'right', fontFace: FONT_FACE, fontSize: 9, color: WHITE, fill: { color: PRIMARY_BLUE } } },
    { text: '%', options: { bold: true, align: 'right', fontFace: FONT_FACE, fontSize: 9, color: WHITE, fill: { color: PRIMARY_BLUE } } },
    { text: 'Active Reps', options: { bold: true, align: 'center', fontFace: FONT_FACE, fontSize: 9, color: WHITE, fill: { color: PRIMARY_BLUE } } },
    { text: 'Actual Reps', options: { bold: true, align: 'center', fontFace: FONT_FACE, fontSize: 9, color: WHITE, fill: { color: PRIMARY_BLUE } } }
  ];
  const rowColors = rows.map((r) => getColorForPercentage(r.percentage));
  const dataRows = rows.map((r, idx) => {
    const bg = rowColors[idx];
    return [
      { text: (r.name || '').slice(0, 24), options: { fontFace: FONT_BODY, fontSize: 8, color: WHITE, fill: { color: bg } } },
      { text: formatSupervisionValue(r.target), options: { align: 'right', fontFace: FONT_BODY, fontSize: 8, color: WHITE, fill: { color: bg } } },
      { text: formatSupervisionValue(r.value), options: { align: 'right', fontFace: FONT_BODY, fontSize: 8, color: WHITE, fill: { color: bg } } },
      { text: r.percentage.toFixed(1) + '%', options: { align: 'right', fontFace: FONT_BODY, fontSize: 8, color: WHITE, fill: { color: bg } } },
      { text: String(r.activeReps ?? 0), options: { align: 'center', fontFace: FONT_BODY, fontSize: 8, color: WHITE, fill: { color: bg } } },
      { text: String(r.actualReps ?? 0), options: { align: 'center', fontFace: FONT_BODY, fontSize: 8, color: WHITE, fill: { color: bg } } }
    ];
  });
  const totalRow = [
    { text: 'Total', options: { bold: true, fontFace: FONT_FACE, fontSize: 9, color: WHITE, fill: { color: PRIMARY_BLUE_DARK } } },
    { text: formatSupervisionValue(totalTarget), options: { bold: true, align: 'right', fontFace: FONT_FACE, fontSize: 9, color: WHITE, fill: { color: PRIMARY_BLUE_DARK } } },
    { text: formatSupervisionValue(totalValue), options: { bold: true, align: 'right', fontFace: FONT_FACE, fontSize: 9, color: WHITE, fill: { color: PRIMARY_BLUE_DARK } } },
    { text: totalPct + '%', options: { bold: true, align: 'right', fontFace: FONT_FACE, fontSize: 9, color: WHITE, fill: { color: PRIMARY_BLUE_DARK } } },
    { text: String(totalActiveReps), options: { bold: true, align: 'center', fontFace: FONT_FACE, fontSize: 9, color: WHITE, fill: { color: PRIMARY_BLUE_DARK } } },
    { text: String(totalActualReps), options: { bold: true, align: 'center', fontFace: FONT_FACE, fontSize: 9, color: WHITE, fill: { color: PRIMARY_BLUE_DARK } } }
  ];
  try {
    slide.addTable([tableHeader, ...dataRows, totalRow], {
      x: 0.5, y: 1.05, w: 4.5, colW: [1.4, 0.55, 0.55, 0.4, 0.5, 0.5], fontSize: 8, fontFace: FONT_BODY,
      border: { type: 'solid', pt: 0.5, color: 'e2e8f0' }, margin: 2, valign: 'middle'
    });
  } catch (e) { console.warn('Supervision table error', e); }

  const sepX = 4.55;
  slide.addShape(pptx.ShapeType.rect, {
    x: sepX, y: 1.0, w: 0.03, h: 3.4, fill: { color: PRIMARY_BLUE }, line: { type: 'none' }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: sepX - 0.02, y: 1.0, w: 0.07, h: 0.02, fill: { color: TEAL }, line: { type: 'none' }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: sepX - 0.02, y: 4.38, w: 0.07, h: 0.02, fill: { color: TEAL }, line: { type: 'none' }
  });

  const chartColors = rows.map((r) => getColorForPercentage(r.percentage));
  const chartData = [{
    name: '% of Target',
    labels: rows.map((r) => (r.name || '').slice(0, 20)),
    values: rows.map((r) => r.percentage)
  }];
  try {
    slide.addChart(pptx.ChartType.bar, chartData, {
      x: 4.7, y: 1.05, w: 4.7, h: 3.35, barDir: 'bar', chartColors,
      showLegend: false, showTitle: false, valAxisLabelFontSize: 8, catAxisLabelFontSize: 7,
      showValue: true, showLabel: false, dataLabelPosition: 'outEnd', dataLabelFontSize: 8,
      dataLabelFontFace: FONT_BODY, dataLabelColor: DARK, dataLabelFormatCode: '0.0"%"',
      showCatAxisGridLines: false, showValAxisGridLines: false
    });
  } catch (e) { console.warn('Supervision chart error', e); }
  addBottomLine(slide, pptx);
}

export function addSectionSlides(pptx, section, sectionData, logoBase64, monthLabel) {
  const { summaryData, comparisonData, monthlyTrendData, trendExplanation, productContributionData, supervisionData } = sectionData;

  // 1. Section title slide (e.g. "2. CS PRODUCT PERFORMANCE HIGHLIGHTS")
  const slideTitle = pptx.addSlide();
  slideTitle.background = { color: LIGHT_BG };
  addFloatingBubbles(slideTitle, pptx);
  slideTitle.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 2.8,
    w: 9,
    h: 0.05,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });
  slideTitle.addText(`${section.tocNumber}. ${section.title}`, {
    x: 0.5,
    y: 3.2,
    w: 9,
    h: 0.8,
    fontSize: 24,
    bold: true,
    color: PRIMARY_BLUE_DARK,
    align: 'center',
    fontFace: FONT_FACE
  });
  if (logoBase64) {
    try {
      slideTitle.addImage({
        data: logoBase64,
        x: 3.5,
        y: 1.2,
        w: 3,
        h: 1.4,
        sizing: { type: 'contain', w: 3, h: 1.4 }
      });
    } catch (e) {}
  }
  addBottomLine(slideTitle, pptx);

  // 2. Summary slide (same layout as main summary: p1, line, p2 left + pie right, line, p3, line, p4)
  const slideSum = pptx.addSlide();
  slideSum.background = { color: LIGHT_BG };
  addFloatingBubbles(slideSum, pptx);
  addSectionHeader(slideSum, pptx, 'SALES AND PERFORMANCE', logoBase64, TEAL);
  if (summaryData) {
    const ml = summaryData.monthLabel || monthLabel;
    slideSum.addText(pptxRunsSummaryP1(summaryData, ml, 12), { x: 0.5, y: 1.1, w: 8.5, h: 0.5, valign: 'top', wrap: true });
    slideSum.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.7, w: 8.5, h: 0.02, fill: { color: PRIMARY_BLUE }, line: { type: 'none' } });
    slideSum.addText(pptxRunsSummaryP2(summaryData, ml, 12), { x: 0.5, y: 1.85, w: 4.2, h: 1.4, valign: 'top', wrap: true });
    slideSum.addShape(pptx.ShapeType.rect, { x: 4.85, y: 1.85, w: 0.02, h: 1.5, fill: { color: PRIMARY_BLUE }, line: { type: 'none' } });
    const newVal = summaryData.newBusiness || 0;
    const repeatVal = summaryData.repeatBusiness || 0;
    if (newVal > 0 || repeatVal > 0) {
      try {
        const { scaled, formatCode } = getChartScale([[newVal, repeatVal]]);
        slideSum.addChart(pptx.ChartType.pie, [{ name: 'New vs Repeat', labels: ['New Business', 'Repeat Business'], values: scaled([newVal, repeatVal]) }], {
          x: 5.1, y: 1.9, w: 2.4, h: 1.4, showLegend: true, legendPos: 'r', legendFontSize: 9,
          chartColors: [PRIMARY_BLUE_DARK, GOLD], showTitle: false, fontFace: FONT_FACE,
          showValue: true, showLabel: false, showPercent: true, dataLabelPosition: 'bestFit',
          dataLabelFontSize: 9, dataLabelColor: WHITE, dataLabelFormatCode: formatCode
        });
      } catch (e) {}
    }
    slideSum.addShape(pptx.ShapeType.rect, { x: 0.5, y: 3.45, w: 8.5, h: 0.02, fill: { color: PRIMARY_BLUE }, line: { type: 'none' } });
    slideSum.addText(pptxRunsSummaryP3(summaryData, ml, 12), { x: 0.5, y: 3.6, w: 8.5, h: 0.45, valign: 'top', wrap: true });
    slideSum.addShape(pptx.ShapeType.rect, { x: 0.5, y: 4.15, w: 8.5, h: 0.02, fill: { color: PRIMARY_BLUE }, line: { type: 'none' } });
    if (summaryData.activeTarget != null && summaryData.actualTarget != null) {
      const hideActualAgentsMonthLine = section.id?.startsWith('cs-') || section.id === 'lbf';
      slideSum.addText(pptxRunsActiveAgentsWithTarget(summaryData, ml, 12), {
        x: 0.5, y: 4.3, w: 8.5, h: 0.5, valign: 'top', wrap: true
      });
      if (!hideActualAgentsMonthLine) {
        slideSum.addText(pptxRunsActualAgentsWithTarget(summaryData, ml, 12), {
          x: 0.5, y: 4.9, w: 8.5, h: 0.5, valign: 'top', wrap: true
        });
      }
      if (summaryData.crmActualRepsTotal != null) {
        slideSum.addText(pptxRunsCrmActual(ml, summaryData.crmActualRepsDate, summaryData.crmActualRepsTotal, 12), {
          x: 0.5, y: hideActualAgentsMonthLine ? 4.9 : 5.35, w: 8.5, h: 0.35, valign: 'top', wrap: true
        });
      }
    } else if (summaryData.activeTarget != null) {
      slideSum.addText(pptxRunsActiveAgentsWithTarget(summaryData, ml, 12), {
        x: 0.5, y: 4.3, w: 8.5, h: 0.4, valign: 'top', wrap: true
      });
      if (summaryData.crmActualRepsTotal != null) {
        slideSum.addText(pptxRunsCrmActual(ml, summaryData.crmActualRepsDate, summaryData.crmActualRepsTotal, 12), {
          x: 0.5, y: 4.72, w: 8.5, h: 0.35, valign: 'top', wrap: true
        });
      }
    } else {
      if (summaryData.activeRepsFormatted != null) {
        slideSum.addText(pptxRunsActiveAgentsSimple(ml, summaryData.activeRepsFormatted, 12), {
          x: 0.5, y: 4.3, w: 8.5, h: 0.4, valign: 'top', wrap: true
        });
      }
      if (summaryData.crmActualRepsTotal != null) {
        slideSum.addText(pptxRunsCrmActual(ml, summaryData.crmActualRepsDate, summaryData.crmActualRepsTotal, 12), {
          x: 0.5, y: 4.72, w: 8.5, h: 0.35, valign: 'top', wrap: true
        });
      }
    }
  } else {
    slideSum.addText('No summary data available for this section.', { x: 0.5, y: 1.2, w: 8.5, h: 0.5, fontSize: 11, color: GRAY, valign: 'top', fontFace: FONT_FACE });
  }
  addBottomLine(slideSum, pptx);

  // 3. Trend slide (chart + explanation)
  const slideTrend = pptx.addSlide();
  slideTrend.background = { color: LIGHT_BG };
  addFloatingBubbles(slideTrend, pptx);
  addSectionHeader(slideTrend, pptx, section.trendTitle || section.title, logoBase64, PRIMARY_BLUE_DARK);
  if (monthlyTrendData && monthlyTrendData.length > 0) {
    const rawVals = monthlyTrendData.map((d) => d.disbursements);
    const { scaled, formatCode, maxScaled } = getChartScale([rawVals]);
    const chartData = [{ name: 'Disbursements', labels: monthlyTrendData.map((d) => d.label), values: scaled(rawVals) }];
      try {
        slideTrend.addChart(pptx.ChartType.bar, chartData, {
          x: 0.5, y: 1.15, w: 9, h: 2.5, barDir: 'col', chartColors: [ACCENT_BLUE], showLegend: false, showTitle: false,
          valAxisLabelFontSize: 10, catAxisLabelFontSize: 10, showValue: true, showLabel: false, showCatName: false,
          dataLabelPosition: 'outEnd', dataLabelFontSize: 9, dataLabelFontBold: false, dataLabelFontFace: FONT_BODY,
          dataLabelColor: PRIMARY_BLUE_DARK, dataLabelFormatCode: formatCode, valAxisLabelFormatCode: formatCode,
          valAxisMaxVal: maxScaled, showDataTable: false,
          showCatAxisGridLines: false, showValAxisGridLines: false
        });
    } catch (e) {
      slideTrend.addText('Chart: no data', { x: 0.6, y: 1.5, w: 8.3, h: 0.5, fontSize: 11, color: GRAY, fontFace: FONT_FACE });
    }
  } else {
    slideTrend.addText('No trend data available.', { x: 0.6, y: 1.5, w: 8.3, h: 0.5, fontSize: 11, color: GRAY, fontFace: FONT_FACE });
  }
  slideTrend.addText('Explanation:', { x: 0.5, y: 4.25, w: 8.5, h: 0.3, fontSize: 13, bold: true, color: DARK, fontFace: FONT_FACE });
  slideTrend.addText(pptxRunsTrendExplanation(trendExplanation || 'Insufficient data.', 12), {
    x: 0.5,
    y: 4.55,
    w: 8.5,
    h: CONTENT_END_Y - 4.55,
    valign: 'top',
    wrap: true
  });
  addBottomLine(slideTrend, pptx);

  // 4. Comparison slide
  const slideComp = pptx.addSlide();
  slideComp.background = { color: LIGHT_BG };
  addFloatingBubbles(slideComp, pptx);
  addSectionHeader(slideComp, pptx, 'PERFORMANCE COMPARISON', logoBase64, TEAL);
  const plain = (str) => ({ text: str, options: { fontFace: FONT_FACE, color: DARK } });
  const boldBlue = (str) => ({ text: str, options: { bold: true, color: PRIMARY_BLUE, fontFace: FONT_FACE } });
  const bulletRuns = (m) => [plain(' has '), boldBlue(m.dir), plain(' by '), boldBlue(m.pct + '%'), plain(' ('), boldBlue(m.currentFmt), plain(' vs '), boldBlue(m.prevFmt), plain(').')];
  const {
    FS: COMP_BULLET_FS,
    GAP: COMP_BULLET_GAP,
    LM_TITLE_Y,
    LM_TITLE_FS,
    LM_TITLE_H,
    LM_BULLETS_Y,
    AFTER_DIVIDER,
    LY_TITLE_H,
    LY_HEADER_TO_BULLETS,
    DIVIDER_PAD
  } = PPTX_COMPARISON_TIGHT;
  if (comparisonData) {
    const lm = comparisonData.lastMonth;
    const ly = comparisonData.lastYear;
    const bullets = (data) => [
      ['The total amount disbursed', data.disbursements],
      ['The amount disbursed for new business', data.newBusiness],
      ['The total loan counts', data.numberOfLoans],
      ['The average loan size', data.averageLoanSize],
      ['The total Outstanding Balance (portfolio)', data.portfolio],
      ['The number of Active agents', data.activeReps]
    ].filter(([, metric]) => metric);
    slideComp.addText(`Comparison to Last Month (${comparisonData.lastMonthLabel || ''})`, {
      x: 0.5,
      y: LM_TITLE_Y,
      w: 8.5,
      h: LM_TITLE_H,
      fontSize: LM_TITLE_FS,
      bold: true,
      color: DARK,
      fontFace: FONT_FACE
    });
    let yAfterLm = LM_BULLETS_Y;
    if (lm) {
      let y = LM_BULLETS_Y;
      bullets(lm).forEach(([prefix, metric]) => {
        const h = estimateComparisonBulletHeight(prefix, metric, COMP_BULLET_FS);
        slideComp.addText([plain(prefix), ...bulletRuns(metric)], {
          x: 0.6, y, w: 8.3, h, bullet: true, fontSize: COMP_BULLET_FS, fontFace: FONT_FACE, color: DARK, valign: 'top', wrap: true
        });
        y += h + COMP_BULLET_GAP;
      });
      yAfterLm = y;
    }
    const dividerY =
      yAfterLm <= LM_BULLETS_Y + 0.02 ? 2.42 : yAfterLm - COMP_BULLET_GAP + DIVIDER_PAD;
    slideComp.addShape(pptx.ShapeType.rect, { x: 0.5, y: dividerY, w: 8.5, h: 0.015, fill: { color: PRIMARY_BLUE }, line: { type: 'none' } });
    const lyHeadingY = dividerY + AFTER_DIVIDER;
    slideComp.addText(`Comparison to Last Year (${comparisonData.lastYearLabel || ''})`, {
      x: 0.5,
      y: lyHeadingY,
      w: 8.5,
      h: LY_TITLE_H,
      fontSize: LM_TITLE_FS,
      bold: true,
      color: DARK,
      fontFace: FONT_FACE
    });
    if (ly) {
      let y = lyHeadingY + LY_HEADER_TO_BULLETS;
      bullets(ly).forEach(([prefix, metric]) => {
        const h = estimateComparisonBulletHeight(prefix, metric, COMP_BULLET_FS);
        slideComp.addText([plain(prefix), ...bulletRuns(metric)], {
          x: 0.6, y, w: 8.3, h, bullet: true, fontSize: COMP_BULLET_FS, fontFace: FONT_FACE, color: DARK, valign: 'top', wrap: true
        });
        y += h + COMP_BULLET_GAP;
      });
    }
  } else {
    slideComp.addText('No comparison data available.', { x: 0.5, y: 1.2, w: 8.5, h: 0.5, fontSize: 11, color: GRAY, valign: 'top', fontFace: FONT_FACE });
  }
  addBottomLine(slideComp, pptx);

  // 5. New Business Sales Performance
  const newBusinessComparison = sectionData.newBusinessComparison;
  if (newBusinessComparison) {
    const slideNew = pptx.addSlide();
    slideNew.background = { color: LIGHT_BG };
    addFloatingBubbles(slideNew, pptx);
    addSectionHeader(slideNew, pptx, 'NEW BUSINESS SALES PERFORMANCE', logoBase64, PRIMARY_BLUE_DARK);
    const { monthLabel: nbMonth, lastMonthChange: nbLM, lastMonthLabel: nbLMLabel, lastYearChange: nbLY, lastYearLabel: nbLYLabel } = newBusinessComparison;
    const nbLMText = nbLM ? `${nbLM.dir} by ${nbLM.pct}%` : 'N/A';
    const nbLYText = nbLY ? `${nbLY.dir} by ${nbLY.pct}%` : 'N/A';
    slideNew.addText(pptxRunsNewBusinessExplanation(nbMonth, nbLMText, nbLYText, nbLMLabel, nbLYLabel, 12), {
      x: 0.5, y: 1.05, w: 8.5, h: 0.6, valign: 'top', wrap: true
    });
    const nbTrend = sectionData.newBusinessTrend || [];
    if (nbTrend.length > 0) {
      const rawVals = nbTrend.map((d) => d.newBusiness);
      const { scaled, formatCode, maxScaled } = getChartScale([rawVals]);
      const chartData = [{ name: 'New Business', labels: nbTrend.map((d) => d.label), values: scaled(rawVals) }];
      try {
        slideNew.addChart(pptx.ChartType.line, chartData, {
          x: 0.5, y: 1.8, w: 9, h: 2.8, chartColors: [PRIMARY_BLUE], showLegend: false, showTitle: false,
          valAxisLabelFontSize: 10, catAxisLabelFontSize: 10, showValue: true, showLabel: false, showCatName: false,
          dataLabelPosition: 'outEnd', dataLabelFontSize: 9, dataLabelFontBold: false, dataLabelFontFace: FONT_BODY,
          dataLabelColor: PRIMARY_BLUE_DARK, dataLabelFormatCode: formatCode, valAxisLabelFormatCode: formatCode,
          valAxisMaxVal: maxScaled, showCatAxisGridLines: false, showValAxisGridLines: false
        });
      } catch (e) {}
    }
    addBottomLine(slideNew, pptx);
  }

  // 6. Repeat Business Sales Performance
  const repeatBusinessComparison = sectionData.repeatBusinessComparison;
  if (repeatBusinessComparison) {
    const slideRepeat = pptx.addSlide();
    slideRepeat.background = { color: LIGHT_BG };
    addFloatingBubbles(slideRepeat, pptx);
    addSectionHeader(slideRepeat, pptx, 'REPEAT BUSINESS SALES PERFORMANCE', logoBase64, TEAL);
    const { monthLabel: rbMonth, lastMonthChange: rbLM, lastMonthLabel: rbLMLabel, lastYearChange: rbLY, lastYearLabel: rbLYLabel } = repeatBusinessComparison;
    const rbLMText = rbLM ? `${rbLM.dir} by ${rbLM.pct}%` : 'N/A';
    const rbLYText = rbLY ? `${rbLY.dir} by ${rbLY.pct}%` : 'N/A';
    slideRepeat.addText(pptxRunsRepeatBusinessExplanation(rbMonth, rbLMText, rbLYText, rbLMLabel, rbLYLabel, 12), {
      x: 0.5, y: 1.05, w: 8.5, h: 0.6, valign: 'top', wrap: true
    });
    const rbTrend = sectionData.repeatBusinessTrend || [];
    if (rbTrend.length > 0) {
      const rawVals = rbTrend.map((d) => d.repeatBusiness);
      const { scaled, formatCode, maxScaled } = getChartScale([rawVals]);
      const chartData = [{ name: 'Repeat Business', labels: rbTrend.map((d) => d.label), values: scaled(rawVals) }];
      try {
        slideRepeat.addChart(pptx.ChartType.line, chartData, {
          x: 0.5, y: 1.8, w: 9, h: 2.8, chartColors: [PRIMARY_BLUE], showLegend: false, showTitle: false,
          valAxisLabelFontSize: 10, catAxisLabelFontSize: 10, showValue: true, showLabel: false, showCatName: false,
          dataLabelPosition: 'outEnd', dataLabelFontSize: 9, dataLabelFontBold: false, dataLabelFontFace: FONT_BODY,
          dataLabelColor: PRIMARY_BLUE_DARK, dataLabelFormatCode: formatCode, valAxisLabelFormatCode: formatCode,
          valAxisMaxVal: maxScaled, showCatAxisGridLines: false, showValAxisGridLines: false
        });
      } catch (e) {}
    }
    addBottomLine(slideRepeat, pptx);
  }

  // 7. Product contribution slide (only if section has sub-products with data)
  const prodData = productContributionData;
  if (prodData && prodData.products && prodData.products.length > 0 && prodData.products.some((p) => p.value > 0)) {
    const slideProd = pptx.addSlide();
    slideProd.background = { color: LIGHT_BG };
    addFloatingBubbles(slideProd, pptx);
    addSectionHeader(slideProd, pptx, 'PER PRODUCT CONTRIBUTION', logoBase64, PRIMARY_BLUE_DARK);
    slideProd.addText(pptxRunsProductContributionSubtitle(prodData.monthLabel, prodData.totalFormatted, 10, true), {
      x: 0.5, y: 1.05, w: 8.5, h: 0.35, valign: 'top', wrap: true
    });
    const pieProducts = prodData.products.filter((p) => p.value > 0);
    if (pieProducts.length > 0) {
      try {
        const rawVals = pieProducts.map((p) => p.value);
        const { scaled, formatCode } = getChartScale([rawVals]);
        slideProd.addChart(pptx.ChartType.pie, [{ name: 'Products', labels: pieProducts.map((p) => p.name), values: scaled(rawVals) }], {
          x: 0.5, y: 1.5, w: 4.2, h: 2.8, showLegend: true, legendPos: 'b', legendFontSize: 8,
          chartColors: pieProducts.map((p) => (p.color || '').replace('#', '')), showTitle: false, fontFace: FONT_FACE,
          showValue: true, showPercent: true, dataLabelPosition: 'bestFit', dataLabelFontSize: 9, dataLabelColor: PRIMARY_BLUE_DARK, dataLabelFormatCode: formatCode
        });
      } catch (e) {}
    }
    slideProd.addShape(pptx.ShapeType.rect, { x: 4.85, y: 1.5, w: 0.02, h: 2.8, fill: { color: PRIMARY_BLUE }, line: { type: 'none' } });
    const tableRows = prodData.productsRanked && prodData.productsRanked.length > 0
      ? prodData.productsRanked
      : (prodData.products || []).map((p, i) => ({ ...p, rank: i + 1 }));
    const headerRow = [
      { text: 'Rank', options: { bold: true, align: 'center', fontFace: FONT_FACE, fontSize: 10, color: WHITE, fill: { color: PRIMARY_BLUE } } },
      { text: 'Product', options: { bold: true, fontFace: FONT_FACE, fontSize: 10, color: WHITE, fill: { color: PRIMARY_BLUE } } },
      { text: 'Amount (TZS)', options: { bold: true, fontFace: FONT_FACE, fontSize: 10, color: WHITE, fill: { color: PRIMARY_BLUE } } },
      { text: '%', options: { bold: true, align: 'right', fontFace: FONT_FACE, fontSize: 10, color: WHITE, fill: { color: PRIMARY_BLUE } } }
    ];
    const dataRows = tableRows.map((p, idx) => {
      const isEven = idx % 2 === 0;
      const bgColor = isEven ? 'f8fafc' : WHITE;
      return [
        { text: String(p.rank), options: { align: 'center', fontFace: FONT_FACE, fontSize: 9, color: PRIMARY_BLUE, bold: true, fill: { color: bgColor } } },
        { text: p.name, options: { fontFace: FONT_FACE, fontSize: 9, color: DARK, bold: false, fill: { color: bgColor } } },
        { text: p.valueFormatted, options: { fontFace: FONT_FACE, fontSize: 9, color: PRIMARY_BLUE, bold: true, fill: { color: bgColor } } },
        { text: p.percentage + '%', options: { align: 'right', fontFace: FONT_FACE, fontSize: 9, color: PRIMARY_BLUE, bold: true, fill: { color: bgColor } } }
      ];
    });
    try {
      slideProd.addTable([headerRow, ...dataRows], {
        x: 5.1, y: 1.5, w: 4.2, colW: [0.4, 1.6, 1.4, 0.5], fontSize: 9, fontFace: FONT_FACE,
        border: { type: 'solid', pt: 1, color: 'e2e8f0' }, margin: 3, valign: 'middle'
      });
    } catch (e) {}
    addBottomLine(slideProd, pptx);
  }

  if (supervisionData?.rows?.length > 0) {
    addSupervisionSlide(pptx, section, supervisionData, logoBase64);
  }
}
