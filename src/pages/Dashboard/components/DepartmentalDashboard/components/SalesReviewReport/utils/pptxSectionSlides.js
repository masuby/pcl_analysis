/**
 * Append slides for one product section (CS, LBF, IPF, etc.) to the PPTX.
 * Same flow as country: title page, summary, trend chart, comparison, (optional) product contribution.
 */
import PptxGenJS from 'pptxgenjs';

const PRIMARY_BLUE = '2a5298';
const PRIMARY_BLUE_DARK = '1e3a6f';
const GOLD = 'd4af37';
const WHITE = 'FFFFFF';
const DARK = '1e293b';
const GRAY = '64748b';
const ACCENT_BLUE = '4a90e2';
const FONT_FACE = 'Book Antiqua';
const BOTTOM_LINE_Y = 5.85;
const BOTTOM_LINE_H = 0.06;
const CONTENT_END_Y = 5.5;

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

function addSectionHeader(slide, pptx, title, logoBase64) {
  slide.addText(title, {
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
export function addSectionSlides(pptx, section, sectionData, logoBase64, monthLabel) {
  const { summaryData, comparisonData, monthlyTrendData, trendExplanation, productContributionData } = sectionData;

  // 1. Section title slide (e.g. "2. CS PRODUCT PERFORMANCE HIGHLIGHTS")
  const slideTitle = pptx.addSlide();
  slideTitle.background = { color: WHITE };
  slideTitle.addShape(pptx.ShapeType.rect, {
    x: 0.5,
    y: 2.8,
    w: 9,
    h: 0.03,
    fill: { color: PRIMARY_BLUE },
    line: { type: 'none' }
  });
  slideTitle.addText(`${section.tocNumber}. ${section.title}`, {
    x: 0.5,
    y: 3.2,
    w: 9,
    h: 0.8,
    fontSize: 26,
    bold: true,
    color: PRIMARY_BLUE,
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
  slideSum.background = { color: WHITE };
  addSectionHeader(slideSum, pptx, 'SALES AND PERFORMANCE', logoBase64);
  if (summaryData) {
    const ml = summaryData.monthLabel || monthLabel;
    slideSum.addText(`The total amount disbursed in the month of ${ml} is ${summaryData.disbursementsFormatted} TZS, having achieved ${summaryData.targetPct}% of the total target ${summaryData.targetFormatted} TZS.`, {
      x: 0.5, y: 1.1, w: 8.5, h: 0.5, fontSize: 12, color: DARK, valign: 'top', wrap: true, fontFace: FONT_FACE
    });
    slideSum.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.7, w: 8.5, h: 0.02, fill: { color: PRIMARY_BLUE }, line: { type: 'none' } });
    slideSum.addText(`Of the total amount disbursed in the month of ${ml}, ${summaryData.newBusinessFormatted} TZS (${summaryData.newPct}%) came from new business and ${summaryData.repeatBusinessFormatted} TZS (${summaryData.repeatPct}%) came from repeat business.`, {
      x: 0.5, y: 1.85, w: 4.2, h: 1.4, fontSize: 12, color: DARK, valign: 'top', wrap: true, fontFace: FONT_FACE
    });
    slideSum.addShape(pptx.ShapeType.rect, { x: 4.85, y: 1.85, w: 0.02, h: 1.5, fill: { color: PRIMARY_BLUE }, line: { type: 'none' } });
    const newVal = summaryData.newBusiness || 0;
    const repeatVal = summaryData.repeatBusiness || 0;
    if (newVal > 0 || repeatVal > 0) {
      try {
        slideSum.addChart(pptx.ChartType.pie, [{ name: 'New vs Repeat', labels: ['New Business', 'Repeat Business'], values: [newVal, repeatVal] }], {
          x: 5.1, y: 1.9, w: 2.4, h: 1.4, showLegend: true, legendPos: 'r', legendFontSize: 9,
          chartColors: [PRIMARY_BLUE_DARK, GOLD], showTitle: false, fontFace: FONT_FACE,
          showValue: true, showLabel: false, showPercent: true, dataLabelPosition: 'bestFit',
          dataLabelFontSize: 10, dataLabelColor: WHITE
        });
      } catch (e) {}
    }
    slideSum.addShape(pptx.ShapeType.rect, { x: 0.5, y: 3.45, w: 8.5, h: 0.02, fill: { color: PRIMARY_BLUE }, line: { type: 'none' } });
    slideSum.addText(`The total loan counts for the month of ${ml} is ${summaryData.numberOfLoansFormatted}, making the average loan size be ${summaryData.averageLoanSizeFormatted} TZS.`, {
      x: 0.5, y: 3.6, w: 8.5, h: 0.45, fontSize: 12, color: DARK, valign: 'top', wrap: true, fontFace: FONT_FACE
    });
    slideSum.addShape(pptx.ShapeType.rect, { x: 0.5, y: 4.15, w: 8.5, h: 0.02, fill: { color: PRIMARY_BLUE }, line: { type: 'none' } });
    slideSum.addText(`The total number of Active agents for the month of ${ml} stands at ${summaryData.activeRepsFormatted}.`, {
      x: 0.5, y: 4.3, w: 8.5, h: 0.4, fontSize: 12, color: DARK, valign: 'top', wrap: true, fontFace: FONT_FACE
    });
  } else {
    slideSum.addText('No summary data available for this section.', { x: 0.5, y: 1.2, w: 8.5, h: 0.5, fontSize: 11, color: GRAY, valign: 'top', fontFace: FONT_FACE });
  }
  addBottomLine(slideSum, pptx);

  // 3. Trend slide (chart + explanation)
  const slideTrend = pptx.addSlide();
  slideTrend.background = { color: WHITE };
  addSectionHeader(slideTrend, pptx, section.trendTitle || section.title, logoBase64);
  if (monthlyTrendData && monthlyTrendData.length > 0) {
    const chartData = [{ name: 'Disbursements', labels: monthlyTrendData.map((d) => d.label), values: monthlyTrendData.map((d) => d.disbursements) }];
      try {
        slideTrend.addChart(pptx.ChartType.bar, chartData, {
          x: 0.5, y: 1.15, w: 9, h: 2.5, barDir: 'col', chartColors: [ACCENT_BLUE], showLegend: false, showTitle: false,
          valAxisLabelFontSize: 10, catAxisLabelFontSize: 10, showValue: true, showLabel: false, showCatName: false,
          dataLabelPosition: 'outEnd', dataLabelFontSize: 12, dataLabelFontBold: true, dataLabelFontFace: FONT_FACE,
          dataLabelColor: PRIMARY_BLUE_DARK, dataLabelFormatCode: '#,##0.0,,,"B"', showDataTable: false,
          showCatAxisGridLines: false, showValAxisGridLines: false
        });
    } catch (e) {
      slideTrend.addText('Chart: no data', { x: 0.6, y: 1.5, w: 8.3, h: 0.5, fontSize: 11, color: GRAY, fontFace: FONT_FACE });
    }
  } else {
    slideTrend.addText('No trend data available.', { x: 0.6, y: 1.5, w: 8.3, h: 0.5, fontSize: 11, color: GRAY, fontFace: FONT_FACE });
  }
  slideTrend.addText('Explanation:', { x: 0.5, y: 4.25, w: 8.5, h: 0.3, fontSize: 13, bold: true, color: DARK, fontFace: FONT_FACE });
  slideTrend.addText(trendExplanation || 'Insufficient data.', { x: 0.5, y: 4.55, w: 8.5, h: CONTENT_END_Y - 4.55, fontSize: 12, color: DARK, valign: 'top', wrap: true, fontFace: FONT_FACE });
  addBottomLine(slideTrend, pptx);

  // 4. Comparison slide
  const slideComp = pptx.addSlide();
  slideComp.background = { color: WHITE };
  addSectionHeader(slideComp, pptx, 'PERFORMANCE COMPARISON', logoBase64);
  const plain = (str) => ({ text: str, options: { fontFace: FONT_FACE } });
  const boldBlue = (str) => ({ text: str, options: { bold: true, color: PRIMARY_BLUE, fontFace: FONT_FACE } });
  const bulletRuns = (m) => [plain(' has '), boldBlue(m.dir), plain(' by '), boldBlue(m.pct + '%'), plain(' ('), boldBlue(m.currentFmt), plain(' vs '), boldBlue(m.prevFmt), plain(').')];
  const bulletOpts = (y) => ({ x: 0.6, y, w: 8.3, h: 0.22, bullet: true, fontSize: 10, fontFace: FONT_FACE, color: DARK, valign: 'top', wrap: true });
  if (comparisonData) {
    const lm = comparisonData.lastMonth;
    const ly = comparisonData.lastYear;
    const bullets = (data) => [
      ['The total amount disbursed', data.disbursements],
      ['The amount disbursed for new business', data.newBusiness],
      ['The total loan counts', data.numberOfLoans],
      ['The average loan size', data.averageLoanSize],
      ['The number of Active agents', data.activeReps]
    ];
    slideComp.addText(`Comparison to Last Month (${comparisonData.lastMonthLabel || ''})`, { x: 0.5, y: 1.1, w: 8.5, h: 0.28, fontSize: 12, bold: true, color: DARK, fontFace: FONT_FACE });
    if (lm) bullets(lm).forEach(([prefix, metric], i) => { slideComp.addText([plain(prefix), ...bulletRuns(metric)], bulletOpts(1.38 + i * 0.22)); });
    slideComp.addShape(pptx.ShapeType.rect, { x: 0.5, y: 2.55, w: 8.5, h: 0.02, fill: { color: PRIMARY_BLUE }, line: { type: 'none' } });
    slideComp.addText(`Comparison to Last Year (${comparisonData.lastYearLabel || ''})`, { x: 0.5, y: 2.7, w: 8.5, h: 0.28, fontSize: 12, bold: true, color: DARK, fontFace: FONT_FACE });
    if (ly) bullets(ly).forEach(([prefix, metric], i) => { slideComp.addText([plain(prefix), ...bulletRuns(metric)], bulletOpts(2.98 + i * 0.22)); });
  } else {
    slideComp.addText('No comparison data available.', { x: 0.5, y: 1.2, w: 8.5, h: 0.5, fontSize: 11, color: GRAY, valign: 'top', fontFace: FONT_FACE });
  }
  addBottomLine(slideComp, pptx);

  // 5. New Business Sales Performance
  const newBusinessComparison = sectionData.newBusinessComparison;
  if (newBusinessComparison) {
    const slideNew = pptx.addSlide();
    slideNew.background = { color: WHITE };
    addSectionHeader(slideNew, pptx, 'NEW BUSINESS SALES PERFORMANCE', logoBase64);
    const { monthLabel: nbMonth, lastMonthChange: nbLM, lastMonthLabel: nbLMLabel, lastYearChange: nbLY, lastYearLabel: nbLYLabel } = newBusinessComparison;
    const nbLMText = nbLM ? `${nbLM.dir} by ${nbLM.pct}%` : 'N/A';
    const nbLYText = nbLY ? `${nbLY.dir} by ${nbLY.pct}%` : 'N/A';
    const nbExplanation = `The total amount disbursed for new business for the month of ${nbMonth} has ${nbLMText} in comparison to ${nbLMLabel || 'the previous month'}, and ${nbLYText} in comparison to ${nbLYLabel || 'the same month last year'}.`;
    slideNew.addText(nbExplanation, { x: 0.5, y: 1.05, w: 8.5, h: 0.6, fontSize: 12, color: DARK, valign: 'top', wrap: true, fontFace: FONT_FACE });
    const nbTrend = sectionData.newBusinessTrend || [];
    if (nbTrend.length > 0) {
      const chartData = [{ name: 'New Business', labels: nbTrend.map((d) => d.label), values: nbTrend.map((d) => d.newBusiness) }];
      try {
        slideNew.addChart(pptx.ChartType.line, chartData, {
          x: 0.5, y: 1.8, w: 9, h: 2.8, chartColors: [PRIMARY_BLUE], showLegend: false, showTitle: false,
          valAxisLabelFontSize: 10, catAxisLabelFontSize: 10, showValue: true, showLabel: false, showCatName: false,
          dataLabelPosition: 'outEnd', dataLabelFontSize: 11, dataLabelFontBold: true, dataLabelFontFace: FONT_FACE,
          dataLabelColor: PRIMARY_BLUE_DARK, dataLabelFormatCode: '#,##0.0,,,"B"', showCatAxisGridLines: false, showValAxisGridLines: false
        });
      } catch (e) {}
    }
    addBottomLine(slideNew, pptx);
  }

  // 6. Repeat Business Sales Performance
  const repeatBusinessComparison = sectionData.repeatBusinessComparison;
  if (repeatBusinessComparison) {
    const slideRepeat = pptx.addSlide();
    slideRepeat.background = { color: WHITE };
    addSectionHeader(slideRepeat, pptx, 'REPEAT BUSINESS SALES PERFORMANCE', logoBase64);
    const { monthLabel: rbMonth, lastMonthChange: rbLM, lastMonthLabel: rbLMLabel, lastYearChange: rbLY, lastYearLabel: rbLYLabel } = repeatBusinessComparison;
    const rbLMText = rbLM ? `${rbLM.dir} by ${rbLM.pct}%` : 'N/A';
    const rbLYText = rbLY ? `${rbLY.dir} by ${rbLY.pct}%` : 'N/A';
    const rbExplanation = `The total amount disbursed for repeat business for the month of ${rbMonth} has ${rbLMText} in comparison to ${rbLMLabel || 'the previous month'}, and ${rbLYText} in comparison to ${rbLYLabel || 'the same month last year'}.`;
    slideRepeat.addText(rbExplanation, { x: 0.5, y: 1.05, w: 8.5, h: 0.6, fontSize: 12, color: DARK, valign: 'top', wrap: true, fontFace: FONT_FACE });
    const rbTrend = sectionData.repeatBusinessTrend || [];
    if (rbTrend.length > 0) {
      const chartData = [{ name: 'Repeat Business', labels: rbTrend.map((d) => d.label), values: rbTrend.map((d) => d.repeatBusiness) }];
      try {
        slideRepeat.addChart(pptx.ChartType.line, chartData, {
          x: 0.5, y: 1.8, w: 9, h: 2.8, chartColors: [PRIMARY_BLUE], showLegend: false, showTitle: false,
          valAxisLabelFontSize: 10, catAxisLabelFontSize: 10, showValue: true, showLabel: false, showCatName: false,
          dataLabelPosition: 'outEnd', dataLabelFontSize: 11, dataLabelFontBold: true, dataLabelFontFace: FONT_FACE,
          dataLabelColor: PRIMARY_BLUE_DARK, dataLabelFormatCode: '#,##0.0,,,"B"', showCatAxisGridLines: false, showValAxisGridLines: false
        });
      } catch (e) {}
    }
    addBottomLine(slideRepeat, pptx);
  }

  // 7. Product contribution slide (only if section has sub-products with data)
  const prodData = productContributionData;
  if (prodData && prodData.products && prodData.products.length > 0 && prodData.products.some((p) => p.value > 0)) {
    const slideProd = pptx.addSlide();
    slideProd.background = { color: WHITE };
    addSectionHeader(slideProd, pptx, 'PER PRODUCT CONTRIBUTION', logoBase64);
    slideProd.addText(`Contribution — ${prodData.monthLabel}. Total: ${prodData.totalFormatted} TZS`, {
      x: 0.5, y: 1.05, w: 8.5, h: 0.35, fontSize: 10, color: DARK, valign: 'top', wrap: true, fontFace: FONT_FACE
    });
    const pieProducts = prodData.products.filter((p) => p.value > 0);
    if (pieProducts.length > 0) {
      try {
        slideProd.addChart(pptx.ChartType.pie, [{ name: 'Products', labels: pieProducts.map((p) => p.name), values: pieProducts.map((p) => p.value) }], {
          x: 0.5, y: 1.5, w: 4.2, h: 2.8, showLegend: true, legendPos: 'b', legendFontSize: 8,
          chartColors: pieProducts.map((p) => (p.color || '').replace('#', '')), showTitle: false, fontFace: FONT_FACE,
          showValue: true, showPercent: true, dataLabelPosition: 'bestFit', dataLabelFontSize: 9, dataLabelColor: PRIMARY_BLUE_DARK, dataLabelFormatCode: '#,##0.0,,,"B"'
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
        { text: p.valueFormatted, options: { fontFace: FONT_FACE, fontSize: 9, color: DARK, bold: true, fill: { color: bgColor } } },
        { text: p.percentage + '%', options: { align: 'right', fontFace: FONT_FACE, fontSize: 9, color: GRAY, fill: { color: bgColor } } }
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
}
