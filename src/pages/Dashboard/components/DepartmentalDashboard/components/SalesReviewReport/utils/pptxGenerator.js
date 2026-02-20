import PptxGenJS from 'pptxgenjs';
import { addSectionSlides } from './pptxSectionSlides';

const PRIMARY_BLUE = '2a5298';
const PRIMARY_BLUE_DARK = '1e3a6f';
const GOLD = 'd4af37';
const WHITE = 'FFFFFF';
const DARK = '1e293b';
const GRAY = '64748b';
const ACCENT_BLUE = '4a90e2';

const FONT_FACE = 'Book Antiqua';

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

  // ----- SLIDE 1: Cover (white, blue logo, blue line, blue text) -----
  const slide1 = pptx.addSlide();
  slide1.background = { color: WHITE };

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
    y: 3.0,
    w: 8,
    h: 0.03,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });

  slide1.addText('SALES REVIEW', {
    x: 0.5,
    y: 3.5,
    w: 9,
    h: 0.8,
    fontSize: 36,
    bold: true,
    color: PRIMARY_BLUE,
    align: 'center',
    fontFace: FONT_FACE
  });

  slide1.addText(monthLabel, {
    x: 0.5,
    y: 4.3,
    w: 9,
    h: 0.5,
    fontSize: 24,
    color: PRIMARY_BLUE_DARK,
    align: 'center',
    fontFace: FONT_FACE
  });

  addBottomLine(slide1, pptx);

  // ----- SLIDE 2: Table of Contents -----
  const slide2 = pptx.addSlide();
  slide2.background = { color: WHITE };

  slide2.addText('Table of Contents', {
    x: 0.5,
    y: 0.4,
    w: 5,
    h: 0.6,
    fontSize: 28,
    bold: true,
    color: DARK,
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
    fontSize: 14,
    color: DARK,
    valign: 'top',
    lineSpacing: 20,
    fontFace: FONT_FACE
  });

  addBottomLine(slide2, pptx);

  // ----- SLIDE 3: General Performance - centered title, large logo only -----
  const slide3 = pptx.addSlide();
  slide3.background = { color: WHITE };

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
    fontSize: 26,
    bold: true,
    color: PRIMARY_BLUE,
    align: 'center',
    fontFace: FONT_FACE
  });

  addBottomLine(slide3, pptx);

  // ----- SLIDE 4: General Sales Trend -----
  const slide4 = pptx.addSlide();
  slide4.background = { color: WHITE };

  slide4.addText('GENERAL SALES TREND', {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 24,
    bold: true,
    color: DARK,
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
    const chartData = [
      {
        name: 'Disbursements & Loans',
        labels: monthlyTrendData.map((d) => d.label),
        values: monthlyTrendData.map((d) => d.disbursements)
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
        dataLabelFontSize: 12,
        dataLabelFontBold: true,
        dataLabelFontFace: FONT_FACE,
        dataLabelColor: PRIMARY_BLUE_DARK,
        dataLabelFormatCode: '#,##0.0,,,"B"',
        showDataTable: false,
        showCatAxisGridLines: false,
        showValAxisGridLines: false,
        valAxisMaxVal: null,
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

  slide4.addText(trendExplanation, {
    x: 0.5,
    y: 4.55,
    w: 8.5,
    h: CONTENT_END_Y - 4.55,
    fontSize: 12,
    color: DARK,
    valign: 'top',
    align: 'left',
    wrap: true,
    fontFace: FONT_FACE
  });

  addBottomLine(slide4, pptx);

  // ----- SLIDE 5: Sales and Performance Summary -----
  const summaryData = (data && data.summaryData) || null;
  const slide5 = pptx.addSlide();
  slide5.background = { color: WHITE };

  slide5.addText('SALES AND PERFORMANCE', {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 24,
    bold: true,
    color: DARK,
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
    const p1 =
      `The total amount disbursed in the month of ${ml} is ${summaryData.disbursementsFormatted} TZS, having achieved ${summaryData.targetPct}% of the total target ${summaryData.targetFormatted} TZS.`;
    slide5.addText(p1, {
      x: 0.5,
      y: 1.1,
      w: 8.5,
      h: 0.5,
      fontSize: 11,
      color: DARK,
      valign: 'top',
      wrap: true,
      fontFace: FONT_FACE
    });

    slide5.addShape(pptx.ShapeType.rect, {
      x: 0.5,
      y: 1.7,
      w: 8.5,
      h: 0.02,
      fill: { color: PRIMARY_BLUE },
      line: { type: 'none' }
    });

    const p2 =
      `Of the total amount disbursed in the month of ${ml}, ${summaryData.newBusinessFormatted} TZS (${summaryData.newPct}%) came from new business and ${summaryData.repeatBusinessFormatted} TZS (${summaryData.repeatPct}%) came from repeat business.`;
    slide5.addText(p2, {
      x: 0.5,
      y: 1.85,
      w: 4.2,
      h: 1.4,
      fontSize: 11,
      color: DARK,
      valign: 'top',
      wrap: true,
      fontFace: FONT_FACE
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
        const pieChartData = [
          { name: 'New vs Repeat', labels: ['New Business', 'Repeat Business'], values: [newVal, repeatVal] }
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
          dataLabelFontSize: 10,
          dataLabelColor: WHITE,
          dataLabelFormatCode: '#,##0.0,,,"B"'
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

    const p3 =
      `The total loan counts for the month of ${ml} is ${summaryData.numberOfLoansFormatted}, making the average loan size be ${summaryData.averageLoanSizeFormatted} TZS.`;
    slide5.addText(p3, {
      x: 0.5,
      y: 3.6,
      w: 8.5,
      h: 0.45,
      fontSize: 11,
      color: DARK,
      valign: 'top',
      wrap: true,
      fontFace: FONT_FACE
    });

    slide5.addShape(pptx.ShapeType.rect, {
      x: 0.5,
      y: 4.15,
      w: 8.5,
      h: 0.02,
      fill: { color: PRIMARY_BLUE },
      line: { type: 'none' }
    });

    const p4 =
      `The total number of Active agents for the month of ${ml} stands at ${summaryData.activeRepsFormatted}.`;
    slide5.addText(p4, {
      x: 0.5,
      y: 4.3,
      w: 8.5,
      h: 0.4,
      fontSize: 11,
      color: DARK,
      valign: 'top',
      wrap: true,
      fontFace: FONT_FACE
    });
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
  slide6.background = { color: WHITE };

  slide6.addText('PERFORMANCE COMPARISON', {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 24,
    bold: true,
    color: DARK,
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

  const bulletOpts = (y, h) => ({
    x: 0.6,
    y,
    w: 8.3,
    h: h || 0.2,
    bullet: true,
    fontSize: 12,
    fontFace: FONT_FACE,
    color: DARK,
    valign: 'top',
    wrap: true
  });

  const boldBlue = (str) => ({ text: str, options: { bold: true, color: PRIMARY_BLUE, fontFace: FONT_FACE } });
  const plain = (str) => ({ text: str, options: { fontFace: FONT_FACE } });

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

  if (comparisonData) {
    const lm = comparisonData.lastMonth;
    const ly = comparisonData.lastYear;
    const lmLabel = comparisonData.lastMonthLabel || '';
    const lyLabel = comparisonData.lastYearLabel || '';

    slide6.addText(`Comparison to Last Month (${lmLabel})`, {
      x: 0.5,
      y: 1.1,
      w: 8.5,
      h: 0.28,
      fontSize: 13,
      bold: true,
      color: DARK,
      fontFace: FONT_FACE
    });

    if (lm) {
      const bullets = [
        ['The total amount disbursed', lm.disbursements],
        ['The amount disbursed for new business', lm.newBusiness],
        ['The total loan counts', lm.numberOfLoans],
        ['The average loan size', lm.averageLoanSize],
        ['The number of Active agents', lm.activeReps]
      ];
      bullets.forEach(([prefix, metric], i) => {
        slide6.addText([plain(prefix), ...comparisonBulletRuns(metric)], bulletOpts(1.38 + i * 0.22, 0.22));
      });
    }

    slide6.addShape(pptx.ShapeType.rect, {
      x: 0.5,
      y: 2.55,
      w: 8.5,
      h: 0.02,
      fill: { color: PRIMARY_BLUE },
      line: { type: 'none' }
    });

    slide6.addText(`Comparison to Last Year (${lyLabel})`, {
      x: 0.5,
      y: 2.7,
      w: 8.5,
      h: 0.28,
      fontSize: 13,
      bold: true,
      color: DARK,
      fontFace: FONT_FACE
    });

    if (ly) {
      const bullets = [
        ['The total amount disbursed', ly.disbursements],
        ['The amount disbursed for new business', ly.newBusiness],
        ['The total loan counts', ly.numberOfLoans],
        ['The average loan size', ly.averageLoanSize],
        ['The number of Active agents', ly.activeReps]
      ];
      bullets.forEach(([prefix, metric], i) => {
        slide6.addText([plain(prefix), ...comparisonBulletRuns(metric)], bulletOpts(2.98 + i * 0.22, 0.22));
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
  slide7.background = { color: WHITE };
  slide7.addText('NEW BUSINESS SALES PERFORMANCE', {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 24,
    bold: true,
    color: DARK,
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
    const nbExplanation = `The total amount disbursed for new business for the month of ${nbMonth} has ${nbLMText} in comparison to ${nbLMLabel || 'the previous month'}, and ${nbLYText} in comparison to ${nbLYLabel || 'the same month last year'}.`;
    
    slide7.addText(nbExplanation, {
      x: 0.5,
      y: 1.05,
      w: 8.5,
      h: 0.6,
      fontSize: 12,
      color: DARK,
      valign: 'top',
      wrap: true,
      fontFace: FONT_FACE
    });
    
    const nbTrend = data.newBusinessTrend || [];
    if (nbTrend.length > 0) {
      const chartData = [{ name: 'New Business', labels: nbTrend.map((d) => d.label), values: nbTrend.map((d) => d.newBusiness) }];
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
          dataLabelFontSize: 11,
          dataLabelFontBold: true,
          dataLabelFontFace: FONT_FACE,
          dataLabelColor: PRIMARY_BLUE_DARK,
          dataLabelFormatCode: '#,##0.0,,,"B"',
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
  slide8.background = { color: WHITE };
  slide8.addText('REPEAT BUSINESS SALES PERFORMANCE', {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 24,
    bold: true,
    color: DARK,
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
    const rbExplanation = `The total amount disbursed for repeat business for the month of ${rbMonth} has ${rbLMText} in comparison to ${rbLMLabel || 'the previous month'}, and ${rbLYText} in comparison to ${rbLYLabel || 'the same month last year'}.`;
    
    slide8.addText(rbExplanation, {
      x: 0.5,
      y: 1.05,
      w: 8.5,
      h: 0.6,
      fontSize: 12,
      color: DARK,
      valign: 'top',
      wrap: true,
      fontFace: FONT_FACE
    });
    
    const rbTrend = data.repeatBusinessTrend || [];
    if (rbTrend.length > 0) {
      const chartData = [{ name: 'Repeat Business', labels: rbTrend.map((d) => d.label), values: rbTrend.map((d) => d.repeatBusiness) }];
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
          dataLabelFontSize: 11,
          dataLabelFontBold: true,
          dataLabelFontFace: FONT_FACE,
          dataLabelColor: PRIMARY_BLUE_DARK,
          dataLabelFormatCode: '#,##0.0,,,"B"',
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
  slide9.background = { color: WHITE };

  slide9.addText('PER PRODUCT CONTRIBUTION', {
    x: 0.5,
    y: 0.35,
    w: 5,
    h: 0.5,
    fontSize: 24,
    bold: true,
    color: DARK,
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

    slide9.addText(`Contribution to total sales (Disbursements This Month) — ${monthLabel}. Total: ${totalFormatted} TZS`, {
      x: 0.5,
      y: 1.05,
      w: 8.5,
      h: 0.35,
      fontSize: 10,
      color: DARK,
      valign: 'top',
      wrap: true,
      fontFace: FONT_FACE
    });

    if (pieProducts.length > 0) {
      const pieChartData = [
        {
          name: 'Products',
          labels: pieProducts.map((p) => p.name),
          values: pieProducts.map((p) => p.value)
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
          dataLabelFormatCode: '#,##0.0,,,"B"'
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
        { text: p.valueFormatted, options: { fontFace: FONT_FACE, fontSize: 9, color: DARK, bold: true, fill: { color: bgColor } } },
        { text: p.percentage + '%', options: { align: 'right', fontFace: FONT_FACE, fontSize: 9, color: GRAY, fill: { color: bgColor } } }
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
  slideThankYou.background = { color: WHITE };
  slideThankYou.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 2.2,
    w: 9,
    h: 0.02,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });
  slideThankYou.addText('Thank You', {
    x: 0.5,
    y: 2.6,
    w: 9,
    h: 0.8,
    fontSize: 44,
    bold: true,
    color: PRIMARY_BLUE,
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
