import PptxGenJS from 'pptxgenjs';
import { addSectionSlides } from './pptxSectionSlides';
import { estimateComparisonBulletHeight, PPTX_COMPARISON_TIGHT } from './pptxComparisonLayout';
import {
  pptxRunsTrendExplanation,
  pptxRunsSummaryP1,
  pptxRunsSummaryP2,
  pptxRunsSummaryP3,
  pptxRunsSummaryP4ActiveOnly,
  pptxRunsCrmActual,
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

// Bottom blue line: leave space so content is visible (content area ends at 5.5)
const BOTTOM_LINE_Y = 5.85;
const BOTTOM_LINE_H = 0.06;
const CONTENT_END_Y = 5.5;

function formatLabel(val) {
  if (val == null || isNaN(val)) return '0';
  const n = Number(val);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

/**
 * Choose scale (B/M/K) and simple format so data labels display consistently in PowerPoint,
 * Google Slides, and other viewers (many ignore Excel's scaling format codes like #,##0.0,,,"B").
 * Returns scaled values and a simple format code (e.g. 0.0"B") so stored numbers are small.
 * @param {number[][]} valueArrays - One or more arrays of raw numbers (e.g. [ [10e9, 5e9], [2e9 ] ])
 * @returns {{ scale: number, suffix: string, formatCode: string, scaled: (arr: number[]) => number[], maxScaled: number }}
 */
function getChartScale(valueArrays) {
  let maxVal = 0;
  const flat = (valueArrays || []).flat().filter((v) => v != null && !isNaN(v));
  flat.forEach((v) => { const n = Math.abs(Number(v)); if (n > maxVal) maxVal = n; });
  let scale = 1;
  let suffix = '';
  if (maxVal >= 1e9) {
    scale = 1e9;
    suffix = 'B';
  } else if (maxVal >= 1e6) {
    scale = 1e6;
    suffix = 'M';
  } else if (maxVal >= 1e3) {
    scale = 1e3;
    suffix = 'K';
  }
  const formatCode = suffix ? `0.0"${suffix}"` : '0.0';
  return {
    scale,
    suffix,
    formatCode,
    scaled: (arr) => (arr || []).map((v) => (v != null && !isNaN(v) ? Math.round((Number(v) / scale) * 10) / 10 : 0)),
    maxScaled: flat.length ? Math.ceil((Math.max(...flat.map((v) => Math.abs(Number(v)))) / scale) * 1.15) : 1
  };
}

function addBottomLine(slide, pres) {
  slide.addShape(pres.ShapeType.rect, {
    x: 0.5,
    y: BOTTOM_LINE_Y,
    w: 9,
    h: BOTTOM_LINE_H,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });
}

/** Add floating bubble/circle shapes in the background for visual interest */
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

/**
 * Generate Sales Review PowerPoint: Cover (white), TOC, General Performance, General Sales Trend.
 * data: { countrywiseData, monthlyTrendData, trendExplanation }
 */
export async function generateSalesReviewPPTX(data, selectedMonth, userData, logoBase64, returnBlob = false) {
  const pptx = new PptxGenJS();
  pptx.author = userData?.name || 'PCL';
  pptx.company = 'PCL';
  pptx.subject = 'Sales Review Report';
  pptx.title = `Sales Review - ${selectedMonth}`;

  const monthDate = new Date(selectedMonth + '-01');
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const monthlyTrendData = (data && data.monthlyTrendData) || [];
  const trendExplanation = (data && data.trendExplanation) || 'Insufficient data to describe trend.';

  // ----- SLIDE 1: Cover -----
  const slide1 = pptx.addSlide();
  slide1.background = { color: LIGHT_BG };
  addFloatingBubbles(slide1, pptx);

  if (logoBase64) {
    try {
      slide1.addImage({
        data: logoBase64,
        x: 3.2,
        y: 1.2,
        w: 2.6,
        h: 1.4,
        sizing: { type: 'contain', w: 2.6, h: 1.4 }
      });
    } catch (e) {
      console.warn('Could not add logo to cover', e);
    }
  }

  slide1.addShape(pptx.ShapeType.rect, {
    x: 1.0,
    y: 2.95,
    w: 8,
    h: 0.06,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });

  slide1.addText('SALES REVIEW', {
    x: 0.5,
    y: 3.5,
    w: 9,
    h: 0.8,
    fontSize: 40,
    bold: true,
    color: PRIMARY_BLUE_DARK,
    align: 'center',
    fontFace: FONT_FACE
  });

  slide1.addText(monthLabel, {
    x: 0.5,
    y: 4.35,
    w: 9,
    h: 0.5,
    fontSize: 22,
    color: TEAL,
    align: 'center',
    fontFace: FONT_BODY
  });

  addBottomLine(slide1, pptx);

  // ----- SLIDE 2: Table of Contents -----
  const slide2 = pptx.addSlide();
  slide2.background = { color: LIGHT_BG };
  addFloatingBubbles(slide2, pptx);

  slide2.addText('Table of Contents', {
    x: 0.5,
    y: 0.4,
    w: 5,
    h: 0.6,
    fontSize: 26,
    bold: true,
    color: TEAL,
    fontFace: FONT_FACE
  });

  if (logoBase64) {
    try {
      slide2.addImage({
        data: logoBase64,
        x: 7.2,
        y: 0.35,
        w: 1.5,
        h: 0.7,
        sizing: { type: 'contain', w: 1.5, h: 0.7 }
      });
    } catch (e) {
      console.warn('Could not add logo to TOC', e);
    }
  }

  slide2.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 1.05,
    w: 8.5,
    h: 0.015,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });

  const tocText =
    '1.  GENERAL PERFORMANCE HIGHLIGHTS\n\n' +
    '2.  CS PRODUCT PERFORMANCE HIGHLIGHTS\n\n' +
    '3.  LBF PRODUCT PERFORMANCE HIGHLIGHTS\n' +
    '     i.   IPF PRODUCT PERFORMANCE HIGHLIGHTS\n' +
    '     ii.  QUICK CASH PERFORMANCE HIGHLIGHTS\n' +
    '     iii. MIF (SHORT TERM & LONG TERM) PERFORMANCE HIGHLIGHTS\n' +
    '     iv.  MIF CUSTOMS PERFORMANCE HIGHLIGHTS\n' +
    '     v.   YARD FINANCE PERFORMANCE HIGHLIGHTS\n\n' +
    '4.  SME PERFORMANCE HIGHLIGHTS\n\n' +
    '5.  AGRIFINANCE PERFORMANCE HIGHLIGHT';

  slide2.addText(tocText, {
    x: 0.6,
    y: 1.4,
    w: 8.8,
    h: CONTENT_END_Y - 1.4,
    fontSize: 13,
    color: DARK,
    valign: 'top',
    lineSpacing: 20,
    fontFace: FONT_BODY
  });

  addBottomLine(slide2, pptx);

  // ----- SLIDE 3: General Performance -----
  const slide3 = pptx.addSlide();
  slide3.background = { color: LIGHT_BG };
  addFloatingBubbles(slide3, pptx);

  if (logoBase64) {
    try {
      slide3.addImage({
        data: logoBase64,
        x: 3.5,
        y: 2.0,
        w: 3,
        h: 1.6,
        sizing: { type: 'contain', w: 3, h: 1.6 }
      });
    } catch (e) {
      console.warn('Could not add logo', e);
    }
  }

  slide3.addText('1. GENERAL PERFORMANCE HIGHLIGHTS', {
    x: 0.5,
    y: 4.0,
    w: 9,
    h: 0.7,
    fontSize: 24,
    bold: true,
    color: PRIMARY_BLUE_DARK,
    align: 'center',
    fontFace: FONT_FACE
  });

  addBottomLine(slide3, pptx);

  // ----- SLIDE 4: General Sales Trend -----
  const slide4 = pptx.addSlide();
  slide4.background = { color: LIGHT_BG };
  addFloatingBubbles(slide4, pptx);

  slide4.addText('GENERAL SALES TREND', {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: TEAL,
    fontFace: FONT_FACE
  });

  if (logoBase64) {
    try {
      slide4.addImage({
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

  slide4.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 0.95,
    w: 8.5,
    h: 0.02,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });

  if (monthlyTrendData.length > 0) {
    const rawValues = monthlyTrendData.map((d) => d.disbursements);
    const { scaled, formatCode, maxScaled } = getChartScale([rawValues]);
    const chartData = [
      {
        name: 'Disbursements & Loans',
        labels: monthlyTrendData.map((d) => d.label),
        values: scaled(rawValues)
      }
    ];
    try {
      slide4.addChart(pptx.ChartType.bar, chartData, {
        x: 0.5,
        y: 1.15,
        w: 9,
        h: 2.5,
        barDir: 'col',
        chartColors: [ACCENT_BLUE],
        showLegend: false,
        showTitle: false,
        valAxisLabelFontSize: 10,
        catAxisLabelFontSize: 10,
        showValue: true,
        showLabel: false,
        showCatName: false,
        dataLabelPosition: 'outEnd',
        dataLabelFontSize: 9,
        dataLabelFontBold: false,
        dataLabelFontFace: FONT_BODY,
        dataLabelColor: PRIMARY_BLUE_DARK,
        dataLabelFormatCode: formatCode,
        valAxisLabelFormatCode: formatCode,
        valAxisMaxVal: maxScaled,
        showDataTable: false,
        showCatAxisGridLines: false,
        showValAxisGridLines: false,
        showValAxisTitle: false
      });
    } catch (e) {
      console.warn('Could not add chart', e);
      slide4.addText('Chart: Disbursements This Month (latest per month, max 15)', {
        x: 0.6,
        y: 1.5,
        w: 8.3,
        h: 0.5,
        fontSize: 11,
        color: GRAY,
        fontFace: FONT_FACE
      });
    }
  } else {
    slide4.addText('No trend data available. Upload management reports.', {
      x: 0.6,
      y: 1.5,
      w: 8.3,
      h: 0.8,
      fontSize: 12,
      color: GRAY,
      valign: 'top',
      fontFace: FONT_FACE
    });
  }

  slide4.addText('Explanation:', {
    x: 0.5,
    y: 4.25,
    w: 8.5,
    h: 0.3,
    fontSize: 13,
    bold: true,
    color: DARK,
    fontFace: FONT_FACE
  });

  slide4.addText(pptxRunsTrendExplanation(trendExplanation, 12), {
    x: 0.5,
    y: 4.55,
    w: 8.5,
    h: CONTENT_END_Y - 4.55,
    valign: 'top',
    align: 'left',
    wrap: true
  });

  addBottomLine(slide4, pptx);

  // ----- SLIDE 5: Sales and Performance Summary -----
  const summaryData = (data && data.summaryData) || null;
  const slide5 = pptx.addSlide();
  slide5.background = { color: LIGHT_BG };
  addFloatingBubbles(slide5, pptx);

  slide5.addText('SALES AND PERFORMANCE', {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: PRIMARY_BLUE_DARK,
    fontFace: FONT_FACE
  });

  if (logoBase64) {
    try {
      slide5.addImage({
        data: logoBase64,
        x: 7.2,
        y: 0.3,
        w: 1.5,
        h: 0.6,
        sizing: { type: 'contain', w: 1.5, h: 0.6 }
      });
    } catch (e) {
      console.warn('Could not add logo to summary slide', e);
    }
  }

  slide5.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 0.95,
    w: 8.5,
    h: 0.02,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });

  if (summaryData) {
    const ml = summaryData.monthLabel || monthLabel;
    slide5.addText(pptxRunsSummaryP1(summaryData, ml, 11), {
      x: 0.5,
      y: 1.1,
      w: 8.5,
      h: 0.5,
      valign: 'top',
      wrap: true
    });

    slide5.addShape(pptx.ShapeType.rect, {
      x: 0.5,
      y: 1.7,
      w: 8.5,
      h: 0.02,
      fill: { color: PRIMARY_BLUE },
      line: { type: 'none' }
    });

    slide5.addText(pptxRunsSummaryP2(summaryData, ml, 11), {
      x: 0.5,
      y: 1.85,
      w: 4.2,
      h: 1.4,
      valign: 'top',
      wrap: true
    });

    slide5.addShape(pptx.ShapeType.rect, {
      x: 4.85,
      y: 1.85,
      w: 0.02,
      h: 1.5,
      fill: { color: PRIMARY_BLUE },
      line: { type: 'none' }
    });

    const newVal = summaryData.newBusiness || 0;
    const repeatVal = summaryData.repeatBusiness || 0;
    if (newVal > 0 || repeatVal > 0) {
      try {
        const { scaled, formatCode } = getChartScale([[newVal, repeatVal]]);
        const pieChartData = [
          { name: 'New vs Repeat', labels: ['New Business', 'Repeat Business'], values: scaled([newVal, repeatVal]) }
        ];
        slide5.addChart(pptx.ChartType.pie, pieChartData, {
          x: 5.1,
          y: 1.9,
          w: 2.4,
          h: 1.4,
          showLegend: true,
          legendPos: 'r',
          legendFontSize: 9,
          chartColors: [PRIMARY_BLUE_DARK, GOLD],
          showTitle: false,
          fontFace: FONT_FACE,
          showValue: true,
          showLabel: false,
          showPercent: true,
          dataLabelPosition: 'bestFit',
          dataLabelFontSize: 9,
          dataLabelColor: WHITE,
          dataLabelFormatCode: formatCode
        });
      } catch (e) {
        console.warn('Could not add pie chart', e);
      }
    }

    slide5.addShape(pptx.ShapeType.rect, {
      x: 0.5,
      y: 3.45,
      w: 8.5,
      h: 0.02,
      fill: { color: PRIMARY_BLUE },
      line: { type: 'none' }
    });

    slide5.addText(pptxRunsSummaryP3(summaryData, ml, 11), {
      x: 0.5,
      y: 3.6,
      w: 8.5,
      h: 0.45,
      valign: 'top',
      wrap: true
    });

    slide5.addShape(pptx.ShapeType.rect, {
      x: 0.5,
      y: 4.15,
      w: 8.5,
      h: 0.02,
      fill: { color: PRIMARY_BLUE },
      line: { type: 'none' }
    });

    if (summaryData.activeRepsFormatted != null) {
      slide5.addText(pptxRunsSummaryP4ActiveOnly(ml, summaryData.activeRepsFormatted, 11), {
        x: 0.5,
        y: 4.3,
        w: 8.5,
        h: 0.4,
        valign: 'top',
        wrap: true
      });
    }
    if (summaryData.crmActualRepsTotal != null) {
      slide5.addText(pptxRunsCrmActual(ml, summaryData.crmActualRepsDate, summaryData.crmActualRepsTotal, 11), {
        x: 0.5,
        y: 4.72,
        w: 8.5,
        h: 0.4,
        valign: 'top',
        wrap: true
      });
    }
  } else {
    slide5.addText('No summary data available for the selected month. Upload management reports.', {
      x: 0.5,
      y: 1.2,
      w: 8.5,
      h: 0.6,
      fontSize: 11,
      color: GRAY,
      valign: 'top',
      fontFace: FONT_FACE
    });
  }

  addBottomLine(slide5, pptx);

  // ----- SLIDE 6: Performance Comparison -----
  const comparisonData = (data && data.comparisonData) || null;
  const slide6 = pptx.addSlide();
  slide6.background = { color: LIGHT_BG };
  addFloatingBubbles(slide6, pptx);

  slide6.addText('PERFORMANCE COMPARISON', {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: TEAL,
    fontFace: FONT_FACE
  });

  if (logoBase64) {
    try {
      slide6.addImage({
        data: logoBase64,
        x: 7.2,
        y: 0.3,
        w: 1.5,
        h: 0.6,
        sizing: { type: 'contain', w: 1.5, h: 0.6 }
      });
    } catch (e) {
      console.warn('Could not add logo to comparison slide', e);
    }
  }

  slide6.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 0.95,
    w: 8.5,
    h: 0.02,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });

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

  const boldBlue = (str) => ({ text: str, options: { bold: true, color: PRIMARY_BLUE, fontFace: FONT_FACE } });
  const plain = (str) => ({ text: str, options: { fontFace: FONT_FACE, color: DARK } });

  const comparisonBulletRuns = (m) => [
    plain(' has '),
    boldBlue(m.dir),
    plain(' by '),
    boldBlue(m.pct + '%'),
    plain(' ('),
    boldBlue(m.currentFmt),
    plain(' vs '),
    boldBlue(m.prevFmt),
    plain(').')
  ];

  const comparisonBulletsList = (data) =>
    [
      ['The total amount disbursed', data.disbursements],
      ['The amount disbursed for new business', data.newBusiness],
      ['The total loan counts', data.numberOfLoans],
      ['The average loan size', data.averageLoanSize],
      ['The total Outstanding Balance (portfolio)', data.portfolio],
      ['The number of Active agents', data.activeReps]
    ].filter(([, metric]) => metric);

  if (comparisonData) {
    const lm = comparisonData.lastMonth;
    const ly = comparisonData.lastYear;
    const lmLabel = comparisonData.lastMonthLabel || '';
    const lyLabel = comparisonData.lastYearLabel || '';

    slide6.addText(`Comparison to Last Month (${lmLabel})`, {
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
      comparisonBulletsList(lm).forEach(([prefix, metric]) => {
        const h = estimateComparisonBulletHeight(prefix, metric, COMP_BULLET_FS);
        slide6.addText([plain(prefix), ...comparisonBulletRuns(metric)], {
          x: 0.6,
          y,
          w: 8.3,
          h,
          bullet: true,
          fontSize: COMP_BULLET_FS,
          fontFace: FONT_FACE,
          color: DARK,
          valign: 'top',
          wrap: true
        });
        y += h + COMP_BULLET_GAP;
      });
      yAfterLm = y;
    }

    const dividerY =
      yAfterLm <= LM_BULLETS_Y + 0.02 ? 2.42 : yAfterLm - COMP_BULLET_GAP + DIVIDER_PAD;
    slide6.addShape(pptx.ShapeType.rect, {
      x: 0.5,
      y: dividerY,
      w: 8.5,
      h: 0.015,
      fill: { color: PRIMARY_BLUE },
      line: { type: 'none' }
    });

    const lyHeadingY = dividerY + AFTER_DIVIDER;
    slide6.addText(`Comparison to Last Year (${lyLabel})`, {
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
      comparisonBulletsList(ly).forEach(([prefix, metric]) => {
        const h = estimateComparisonBulletHeight(prefix, metric, COMP_BULLET_FS);
        slide6.addText([plain(prefix), ...comparisonBulletRuns(metric)], {
          x: 0.6,
          y,
          w: 8.3,
          h,
          bullet: true,
          fontSize: COMP_BULLET_FS,
          fontFace: FONT_FACE,
          color: DARK,
          valign: 'top',
          wrap: true
        });
        y += h + COMP_BULLET_GAP;
      });
    }
  } else {
    slide6.addText('No comparison data available for the selected month.', {
      x: 0.5,
      y: 1.2,
      w: 8.5,
      h: 0.5,
      fontSize: 11,
      color: GRAY,
      valign: 'top',
      fontFace: FONT_FACE
    });
  }

  addBottomLine(slide6, pptx);

  // ----- SLIDE 7: NEW BUSINESS SALES PERFORMANCE -----
  const slide7 = pptx.addSlide();
  slide7.background = { color: LIGHT_BG };
  addFloatingBubbles(slide7, pptx);
  slide7.addText('NEW BUSINESS SALES PERFORMANCE', {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: PRIMARY_BLUE_DARK,
    fontFace: FONT_FACE
  });
  if (logoBase64) {
    try {
      slide7.addImage({
        data: logoBase64,
        x: 7.2,
        y: 0.3,
        w: 1.5,
        h: 0.6,
        sizing: { type: 'contain', w: 1.5, h: 0.6 }
      });
    } catch (e) {}
  }
  slide7.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 0.95,
    w: 8.5,
    h: 0.02,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });

  const newBusinessComparison = data.newBusinessComparison;
  if (newBusinessComparison) {
    const { monthLabel: nbMonth, lastMonthChange: nbLM, lastMonthLabel: nbLMLabel, lastYearChange: nbLY, lastYearLabel: nbLYLabel } = newBusinessComparison;
    const nbLMText = nbLM ? `${nbLM.dir} by ${nbLM.pct}%` : 'N/A';
    const nbLYText = nbLY ? `${nbLY.dir} by ${nbLY.pct}%` : 'N/A';
    slide7.addText(
      pptxRunsNewBusinessExplanation(nbMonth, nbLMText, nbLYText, nbLMLabel, nbLYLabel, 12),
      { x: 0.5, y: 1.05, w: 8.5, h: 0.6, valign: 'top', wrap: true }
    );
    
    const nbTrend = data.newBusinessTrend || [];
    if (nbTrend.length > 0) {
      const rawVals = nbTrend.map((d) => d.newBusiness);
      const { scaled, formatCode, maxScaled } = getChartScale([rawVals]);
      const chartData = [{ name: 'New Business', labels: nbTrend.map((d) => d.label), values: scaled(rawVals) }];
      try {
        slide7.addChart(pptx.ChartType.line, chartData, {
          x: 0.5,
          y: 1.8,
          w: 9,
          h: 2.8,
          chartColors: [PRIMARY_BLUE],
          showLegend: false,
          showTitle: false,
          valAxisLabelFontSize: 10,
          catAxisLabelFontSize: 10,
          showValue: true,
          showLabel: false,
          showCatName: false,
          dataLabelPosition: 'outEnd',
          dataLabelFontSize: 9,
          dataLabelFontBold: false,
          dataLabelFontFace: FONT_BODY,
          dataLabelColor: PRIMARY_BLUE_DARK,
          dataLabelFormatCode: formatCode,
          valAxisLabelFormatCode: formatCode,
          valAxisMaxVal: maxScaled,
          showCatAxisGridLines: false,
          showValAxisGridLines: false
        });
      } catch (e) {
        console.warn('Could not add new business chart', e);
      }
    }
  }
  addBottomLine(slide7, pptx);

  // ----- SLIDE 8: REPEAT BUSINESS SALES PERFORMANCE -----
  const slide8 = pptx.addSlide();
  slide8.background = { color: LIGHT_BG };
  addFloatingBubbles(slide8, pptx);
  slide8.addText('REPEAT BUSINESS SALES PERFORMANCE', {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: TEAL,
    fontFace: FONT_FACE
  });
  if (logoBase64) {
    try {
      slide8.addImage({
        data: logoBase64,
        x: 7.2,
        y: 0.3,
        w: 1.5,
        h: 0.6,
        sizing: { type: 'contain', w: 1.5, h: 0.6 }
      });
    } catch (e) {}
  }
  slide8.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 0.95,
    w: 8.5,
    h: 0.02,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });

  const repeatBusinessComparison = data.repeatBusinessComparison;
  if (repeatBusinessComparison) {
    const { monthLabel: rbMonth, lastMonthChange: rbLM, lastMonthLabel: rbLMLabel, lastYearChange: rbLY, lastYearLabel: rbLYLabel } = repeatBusinessComparison;
    const rbLMText = rbLM ? `${rbLM.dir} by ${rbLM.pct}%` : 'N/A';
    const rbLYText = rbLY ? `${rbLY.dir} by ${rbLY.pct}%` : 'N/A';
    slide8.addText(
      pptxRunsRepeatBusinessExplanation(rbMonth, rbLMText, rbLYText, rbLMLabel, rbLYLabel, 12),
      { x: 0.5, y: 1.05, w: 8.5, h: 0.6, valign: 'top', wrap: true }
    );
    
    const rbTrend = data.repeatBusinessTrend || [];
    if (rbTrend.length > 0) {
      const rawVals = rbTrend.map((d) => d.repeatBusiness);
      const { scaled, formatCode, maxScaled } = getChartScale([rawVals]);
      const chartData = [{ name: 'Repeat Business', labels: rbTrend.map((d) => d.label), values: scaled(rawVals) }];
      try {
        slide8.addChart(pptx.ChartType.line, chartData, {
          x: 0.5,
          y: 1.8,
          w: 9,
          h: 2.8,
          chartColors: [PRIMARY_BLUE],
          showLegend: false,
          showTitle: false,
          valAxisLabelFontSize: 10,
          catAxisLabelFontSize: 10,
          showValue: true,
          showLabel: false,
          showCatName: false,
          dataLabelPosition: 'outEnd',
          dataLabelFontSize: 9,
          dataLabelFontBold: false,
          dataLabelFontFace: FONT_BODY,
          dataLabelColor: PRIMARY_BLUE_DARK,
          dataLabelFormatCode: formatCode,
          valAxisLabelFormatCode: formatCode,
          valAxisMaxVal: maxScaled,
          showCatAxisGridLines: false,
          showValAxisGridLines: false
        });
      } catch (e) {
        console.warn('Could not add repeat business chart', e);
      }
    }
  }
  addBottomLine(slide8, pptx);

  // ----- SLIDE 9: Per Product Contribution -----
  const productContributionData = (data && data.productContributionData) || null;
  const slide9 = pptx.addSlide();
  slide9.background = { color: LIGHT_BG };
  addFloatingBubbles(slide9, pptx);

  slide9.addText('PER PRODUCT CONTRIBUTION', {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 22,
    bold: true,
    color: PRIMARY_BLUE_DARK,
    fontFace: FONT_FACE
  });

  if (logoBase64) {
    try {
      slide9.addImage({
        data: logoBase64,
        x: 7.2,
        y: 0.3,
        w: 1.5,
        h: 0.6,
        sizing: { type: 'contain', w: 1.5, h: 0.6 }
      });
    } catch (e) {
      console.warn('Could not add logo to product contribution slide', e);
    }
  }

  slide9.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 0.95,
    w: 8.5,
    h: 0.02,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });

  if (productContributionData && productContributionData.products && productContributionData.products.length > 0) {
    const { monthLabel, products, productsRanked, totalFormatted } = productContributionData;
    const pieProducts = products.filter((p) => p.value > 0);
    const tableRows = (productsRanked && productsRanked.length > 0) ? productsRanked : products.map((p, i) => ({ ...p, rank: i + 1 }));

    slide9.addText(pptxRunsProductContributionSubtitle(monthLabel, totalFormatted, 10), {
      x: 0.5,
      y: 1.05,
      w: 8.5,
      h: 0.35,
      valign: 'top',
      wrap: true
    });

    if (pieProducts.length > 0) {
      const rawVals = pieProducts.map((p) => p.value);
      const { scaled, formatCode } = getChartScale([rawVals]);
      const pieChartData = [
        {
          name: 'Products',
          labels: pieProducts.map((p) => p.name),
          values: scaled(rawVals)
        }
      ];
      try {
        slide9.addChart(pptx.ChartType.pie, pieChartData, {
          x: 0.5,
          y: 1.5,
          w: 4.2,
          h: 2.8,
          showLegend: true,
          legendPos: 'b',
          legendFontSize: 8,
          chartColors: pieProducts.map((p) => p.color.replace('#', '')),
          showTitle: false,
          fontFace: FONT_FACE,
          showValue: true,
          showPercent: true,
          dataLabelPosition: 'bestFit',
          dataLabelFontSize: 9,
          dataLabelColor: PRIMARY_BLUE_DARK,
          dataLabelFormatCode: formatCode
        });
      } catch (e) {
        console.warn('Could not add product pie chart', e);
      }
    }

    slide9.addShape(pptx.ShapeType.rect, {
      x: 4.85,
      y: 1.5,
      w: 0.02,
      h: 2.8,
      fill: { color: PRIMARY_BLUE },
      line: { type: 'none' }
    });

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
      slide9.addTable([headerRow, ...dataRows], {
        x: 5.1,
        y: 1.5,
        w: 4.2,
        colW: [0.4, 1.6, 1.4, 0.5],
        fontSize: 9,
        fontFace: FONT_FACE,
        border: { type: 'solid', pt: 1, color: 'e2e8f0' },
        margin: 3,
        valign: 'middle'
      });
    } catch (e) {
      console.warn('Could not add product table', e);
    }
  } else {
    slide9.addText('No product contribution data available for the selected month.', {
      x: 0.5,
      y: 1.2,
      w: 8.5,
      h: 0.5,
      fontSize: 11,
      color: GRAY,
      valign: 'top',
      fontFace: FONT_FACE
    });
  }

  addBottomLine(slide9, pptx);

  // ----- Product sections (CS, LBF, IPF, SME, AgriFinance, etc.) -----
  const sectionsData = (data && data.sectionsData) || [];
  sectionsData.forEach((sd) => {
    addSectionSlides(pptx, sd.section, sd, logoBase64, monthLabel);
  });

  // ----- Thank you slide -----
  const slideThankYou = pptx.addSlide();
  slideThankYou.background = { color: LIGHT_BG };
  addFloatingBubbles(slideThankYou, pptx);
  slideThankYou.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 2.2,
    w: 9,
    h: 0.05,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });
  slideThankYou.addText('Thank You', {
    x: 0.5,
    y: 2.5,
    w: 9,
    h: 0.9,
    fontSize: 42,
    bold: true,
    color: PRIMARY_BLUE_DARK,
    align: 'center',
    fontFace: FONT_FACE
  });
  slideThankYou.addText('Thank you for your attention.', {
    x: 0.5,
    y: 3.5,
    w: 9,
    h: 0.4,
    fontSize: 18,
    color: DARK,
    align: 'center',
    fontFace: FONT_FACE
  });
  slideThankYou.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 4.2,
    w: 9,
    h: 0.02,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });
  if (logoBase64) {
    try {
      slideThankYou.addImage({
        data: logoBase64,
        x: 4,
        y: 4.8,
        w: 2,
        h: 1,
        sizing: { type: 'contain', w: 2, h: 1 }
      });
    } catch (e) {}
  }
  addBottomLine(slideThankYou, pptx);

  const fileName = `Sales_Review_${selectedMonth}.pptx`;
  
  // If returnBlob is true, return the blob instead of downloading
  if (returnBlob) {
    const blob = await pptx.write({ outputType: 'blob' });
    return blob;
  }
  
  await pptx.writeFile({ fileName });
  return { success: true, fileName };
}
