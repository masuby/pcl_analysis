/**
 * PptxGenJS rich-text runs: narrative body in slate, figures/dates in bold blue (#2a5298).
 */
import { segmentTrendExplanation } from './trendDataUtils';

const FONT_FACE = 'Segoe UI';
const DARK = '1e293b';
const PRIMARY_BLUE = '2a5298';

function base(fontSize) {
  return { fontFace: FONT_FACE, fontSize, color: DARK };
}

function data(fontSize) {
  return { fontFace: FONT_FACE, fontSize, bold: true, color: PRIMARY_BLUE };
}

/** @param {Array<{ text: string, data?: boolean }>} parts */
export function pptxRunsFromParts(parts, fontSize = 11) {
  return parts.map(({ text, data: isData }) => ({
    text,
    options: isData ? data(fontSize) : base(fontSize)
  }));
}

export function pptxRunsTrendExplanation(text, fontSize = 12) {
  const segs = segmentTrendExplanation(text);
  return segs.map((s) => ({
    text: s.value,
    options: s.type === 'data' ? data(fontSize) : base(fontSize)
  }));
}

export function pptxRunsSummaryP1(summaryData, ml, fontSize = 11) {
  return pptxRunsFromParts(
    [
      { text: 'The total amount disbursed in the month of ' },
      { text: ml, data: true },
      { text: ' is ' },
      { text: `${summaryData.disbursementsFormatted} TZS`, data: true },
      { text: ', having achieved ' },
      { text: `${summaryData.targetPct}%`, data: true },
      { text: ' of the total target ' },
      { text: `${summaryData.targetFormatted} TZS`, data: true },
      { text: '.' }
    ],
    fontSize
  );
}

export function pptxRunsSummaryP2(summaryData, ml, fontSize = 11) {
  return pptxRunsFromParts(
    [
      { text: 'Of the total amount disbursed in the month of ' },
      { text: ml, data: true },
      { text: ', ' },
      { text: `${summaryData.newBusinessFormatted} TZS (${summaryData.newPct}%)`, data: true },
      { text: ' came from new business and ' },
      { text: `${summaryData.repeatBusinessFormatted} TZS (${summaryData.repeatPct}%)`, data: true },
      { text: ' came from repeat business.' }
    ],
    fontSize
  );
}

export function pptxRunsSummaryP3(summaryData, ml, fontSize = 11) {
  return pptxRunsFromParts(
    [
      { text: 'The total loan counts for the month of ' },
      { text: ml, data: true },
      { text: ' is ' },
      { text: String(summaryData.numberOfLoansFormatted), data: true },
      { text: ', making the average loan size be ' },
      { text: `${summaryData.averageLoanSizeFormatted} TZS`, data: true },
      { text: '.' }
    ],
    fontSize
  );
}

export function pptxRunsSummaryP4ActiveOnly(ml, activeRepsFormatted, fontSize = 11) {
  return pptxRunsFromParts(
    [
      { text: 'The total number of Active agents for the month of ' },
      { text: ml, data: true },
      { text: ' stands at ' },
      { text: String(activeRepsFormatted), data: true },
      { text: '.' }
    ],
    fontSize
  );
}

export function pptxRunsCrmActual(ml, dateStr, total, fontSize = 11) {
  return pptxRunsFromParts(
    [
      { text: 'The total Number of Actual reps from CRM up to ' },
      { text: dateStr || ml, data: true },
      { text: ' stands at ' },
      { text: String(total), data: true },
      { text: '.' }
    ],
    fontSize
  );
}

export function pptxRunsActiveAgentsWithTarget(summaryData, ml, fontSize = 12) {
  const a = summaryData.activeAchieved ?? summaryData.activeRepsFormatted;
  return pptxRunsFromParts(
    [
      { text: 'The total Number of Active Agents for the Month of ' },
      { text: ml, data: true },
      { text: ' stands at ' },
      { text: String(a), data: true },
      { text: ', having achieved ' },
      { text: `${summaryData.activePct}%`, data: true },
      { text: ' of the total Active Agent target (' },
      { text: String(summaryData.activeTarget), data: true },
      { text: ').' }
    ],
    fontSize
  );
}

export function pptxRunsActualAgentsWithTarget(summaryData, ml, fontSize = 12) {
  return pptxRunsFromParts(
    [
      { text: 'The total Number of Actual Agents for the Month of ' },
      { text: ml, data: true },
      { text: ' stands at ' },
      { text: String(summaryData.actualAchieved ?? 0), data: true },
      { text: ', having achieved ' },
      { text: `${summaryData.actualPct}%`, data: true },
      { text: ' of the total Actual Agent target (' },
      { text: String(summaryData.actualTarget), data: true },
      { text: ').' }
    ],
    fontSize
  );
}

export function pptxRunsActiveAgentsSimple(ml, activeRepsFormatted, fontSize = 12) {
  return pptxRunsFromParts(
    [
      { text: 'The total number of Active agents for the month of ' },
      { text: ml, data: true },
      { text: ' stands at ' },
      { text: String(activeRepsFormatted), data: true },
      { text: '.' }
    ],
    fontSize
  );
}

export function pptxRunsNewBusinessExplanation(monthLabel, lmText, lyText, lastMonthLabel, lastYearLabel, fontSize = 12) {
  return pptxRunsFromParts(
    [
      { text: 'The total amount disbursed for new business for the month of ' },
      { text: monthLabel, data: true },
      { text: ' has ' },
      { text: lmText, data: true },
      { text: ' in comparison to ' },
      { text: lastMonthLabel || 'the previous month', data: true },
      { text: ', and ' },
      { text: lyText, data: true },
      { text: ' in comparison to ' },
      { text: lastYearLabel || 'the same month last year', data: true },
      { text: '.' }
    ],
    fontSize
  );
}

export function pptxRunsRepeatBusinessExplanation(monthLabel, lmText, lyText, lastMonthLabel, lastYearLabel, fontSize = 12) {
  return pptxRunsFromParts(
    [
      { text: 'The total amount disbursed for repeat business for the month of ' },
      { text: monthLabel, data: true },
      { text: ' has ' },
      { text: lmText, data: true },
      { text: ' in comparison to ' },
      { text: lastMonthLabel || 'the previous month', data: true },
      { text: ', and ' },
      { text: lyText, data: true },
      { text: ' in comparison to ' },
      { text: lastYearLabel || 'the same month last year', data: true },
      { text: '.' }
    ],
    fontSize
  );
}

export function pptxRunsProductContributionSubtitle(monthLabel, totalFormatted, fontSize = 12, short = false) {
  if (short) {
    return pptxRunsFromParts(
      [
        { text: 'Contribution — ' },
        { text: monthLabel, data: true },
        { text: '. Total: ' },
        { text: `${totalFormatted} TZS`, data: true }
      ],
      fontSize
    );
  }
  return pptxRunsFromParts(
    [
      { text: 'Contribution to total sales (Disbursements This Month) — ' },
      { text: monthLabel, data: true },
      { text: '. Total: ' },
      { text: `${totalFormatted} TZS`, data: true }
    ],
    fontSize
  );
}
