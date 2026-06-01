/**
 * Social Media Analysis — Excel Export
 *
 * Three sheets matching the Call Centre Report template:
 *   1. Data              — per-platform × per-product breakdown w/ weekly cols
 *   2. Agent Performance — per-agent ranking + per-product summary
 *   3. Dispositions      — per-status counts + % of total
 */

import XLSXStyle from 'xlsx-js-style';

const PRODUCTS    = ['CS', 'LBF', 'SME', 'OTHERS'];
const METRICS     = ['Total', 'Quality', '% Quality', 'Converted', 'Conv Rate'];

const PAL = {
  headerBg:  '1F3864', headerFg: 'FFFFFF',
  subHdr:    '2E74B5', subHdrFg: 'FFFFFF',
  platBg:    'D6E4F0', platFg:   '1F3864',
  prodBg:    'F0F4F8',
  altRow:    'F7FAFD',
  totalBg:   '1E3A5F', totalFg:  'FFFFFF',
  csBg:      'C6EFCE', csFg:     '276221',
  lbfBg:     'BDD7EE', lbfFg:    '1E3A5F',
  smeBg:     'FCE4D6', smeFg:    '7F2B0E',
  otherBg:   'E5E7EB', otherFg:  '374151',
  qualGood:  '166534', qualMid:  '92400E', qualBad:  '991B1B',
};

const PROD_PAL = {
  CS:     { bg: PAL.csBg,    fg: PAL.csFg },
  LBF:    { bg: PAL.lbfBg,   fg: PAL.lbfFg },
  SME:    { bg: PAL.smeBg,   fg: PAL.smeFg },
  OTHERS: { bg: PAL.otherBg, fg: PAL.otherFg },
};

// ── style helpers ────────────────────────────────────────────────────────────
const thin     = { style: 'thin',   color: { rgb: 'C8D0DA' } };
const medium   = { style: 'medium', color: { rgb: '8EA9C1' } };
const BORDER   = { top: thin, bottom: thin, left: thin, right: thin };
const BORDER_M = { top: medium, bottom: medium, left: medium, right: medium };

const F = (bold = false, color = '000000', sz = 9, name = 'Inter') =>
  ({ name, bold, color: { rgb: color }, sz });
const A = (h = 'left', wrap = false, v = 'center') =>
  ({ horizontal: h, vertical: v, wrapText: wrap });
const FILL = (rgb) => ({ patternType: 'solid', fgColor: { rgb } });

function titleCell(v, span) {
  return { v, t: 's', s: {
    font: F(true, PAL.headerFg, 14), fill: FILL(PAL.headerBg),
    alignment: A('center', false, 'center'), border: BORDER_M,
  }};
}
function subtitleCell(v) {
  return { v, t: 's', s: {
    font: F(false, PAL.headerBg, 10), fill: FILL('EFF6FF'),
    alignment: A('center'), border: BORDER,
  }};
}
function hdrCell(v, al = 'center') {
  return { v: v ?? '', t: 's', s: {
    font: F(true, PAL.headerFg, 10), fill: FILL(PAL.headerBg),
    alignment: A(al, true), border: BORDER,
  }};
}
function subHdrCell(v, bg = PAL.subHdr) {
  return { v: v ?? '', t: 's', s: {
    font: F(true, PAL.subHdrFg, 9), fill: FILL(bg),
    alignment: A('center', true), border: BORDER,
  }};
}
function cell(v, opts = {}) {
  const { bold = false, color = '1F2937', al = 'left', bg = 'FFFFFF', sz = 9 } = opts;
  return { v: v ?? '', t: typeof v === 'number' ? 'n' : 's', s: {
    font: F(bold, color, sz), fill: FILL(bg),
    alignment: A(al), border: BORDER,
  }};
}
function numCell(v, opts = {}) {
  const { bold = false, color = '1F2937', bg = 'FFFFFF', fmt = '#,##0' } = opts;
  return { v: typeof v === 'number' ? v : (Number(v) || 0), t: 'n', s: {
    font: F(bold, color, 9), fill: FILL(bg),
    alignment: A('right'), border: BORDER, numFmt: fmt,
  }};
}
function pctCell(ratio, bg = 'FFFFFF') {
  const r = ratio ?? 0;
  const color = r >= 0.30 ? PAL.qualGood : r >= 0.10 ? PAL.qualMid : PAL.qualBad;
  return { v: r, t: 'n', s: {
    font: F(true, color, 9), fill: FILL(bg),
    alignment: A('right'), border: BORDER, numFmt: '0.0%',
  }};
}
function prodPill(p, opts = {}) {
  const { bg, fg } = PROD_PAL[p] ?? PROD_PAL.OTHERS;
  return { v: p, t: 's', s: {
    font: F(true, fg, 9), fill: FILL(bg),
    alignment: A('center'), border: BORDER, ...(opts.s ?? {}),
  }};
}
function setRow(ws, r, cells) {
  cells.forEach((c, ci) => {
    const a = XLSXStyle.utils.encode_cell({ r, c: ci });
    if (c) ws[a] = c;
  });
}
function setWidths(ws, widths) { ws['!cols'] = widths.map((w) => ({ wch: w })); }
function mergeRng(ws, sr, sc, er, ec) {
  if (!ws['!merges']) ws['!merges'] = [];
  ws['!merges'].push({ s: { r: sr, c: sc }, e: { r: er, c: ec } });
}
function finaliseSheet(ws, r, c) {
  ws['!ref'] = XLSXStyle.utils.encode_range({ r: 0, c: 0 }, { r, c });
}

/**
 * Apply a true freeze pane that Excel/LibreOffice/Sheets actually honour.
 *
 * xlsx-js-style needs the FULL pane shape:
 *   - xSplit       — number of leftmost columns to freeze
 *   - ySplit       — number of top rows to freeze
 *   - topLeftCell  — first scrollable cell (A1-notation, REQUIRED)
 *   - state        — 'frozen' (REQUIRED — without it Excel renders a split bar)
 *   - activePane   — which pane is active when the file opens
 *
 * Without the last three, the writer emits just split coordinates and the
 * panes scroll freely — which is exactly the "freeze isn't working" symptom.
 * We also mirror to `!views` and the legacy `!frozenRows/!frozenCols`
 * for readers that prefer those shapes.
 */
function applyFreeze(ws, ySplit, xSplit) {
  const topLeftCell = XLSXStyle.utils.encode_cell({ r: ySplit, c: xSplit });
  // Standard SheetJS / xlsx-js-style sheet-view shape that survives writing
  // to the .xlsx file. Both the top-level fields and the nested `pane`
  // object are needed by different downstream consumers; we set them all.
  ws['!views'] = [{
    showGridLines: true,
    state:        'frozen',
    xSplit, ySplit,
    topLeftCell,
    activePane:   'bottomRight',
    pane: {
      state:      'frozen',
      xSplit, ySplit,
      topLeftCell,
      activePane: 'bottomRight',
    },
  }];
  // Legacy/extra properties for any other tool that reads them
  ws['!freeze']     = { xSplit, ySplit };
  ws['!frozenRows'] = ySplit;
  ws['!frozenCols'] = xSplit;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sheet 1 — DATA  (per-platform × per-product, with weekly columns)
// ═══════════════════════════════════════════════════════════════════════════
function buildDataSheet(d) {
  const ws = {};
  const weeks = d.weeksInData.length ? d.weeksInData : [1];

  // Column layout:
  //   col 0:  Metric label
  //   per product (CS, LBF, SME, OTHERS):
  //     1 monthly total
  //     2-? one column per week
  //   then a wide separator
  // For simplicity we render a flat table: rows × (Metric | PRODUCT MONTH | W1 | W2 | ... | TOTAL)
  // and one section per platform.

  // For each platform: header band + 5 metric rows (Total, Quality, %Quality, Converted, Conv Rate)
  // Columns: METRIC | per product (4 products × (Month + N weeks)) — getting wide.
  // To keep readable, we put each PRODUCT in its own column-block.
  const COLS_PER_PROD = 1 + weeks.length;   // Total + N weeks
  const totalCols = 1 + PRODUCTS.length * COLS_PER_PROD;

  let r = 0;
  // Title
  setRow(ws, r, [titleCell(`SOCIAL MEDIA ANALYSIS — DATA  •  ${d.monthLabel}`)]);
  mergeRng(ws, r, 0, r, totalCols - 1);
  r++;
  setRow(ws, r, [subtitleCell(
    `${d.total.toLocaleString()} total leads · ${d.quality.toLocaleString()} quality (${Math.round(d.qualityRate*100)}%) · ${d.converted.toLocaleString()} converted (${Math.round(d.convRate*100)}%)`
  )]);
  mergeRng(ws, r, 0, r, totalCols - 1);
  r += 2;

  // Super-header: METRIC | CS [span] | LBF [span] | SME [span] | OTHERS [span]
  const supHdr = [hdrCell('METRIC')];
  PRODUCTS.forEach((p) => {
    supHdr.push(prodPill(p));
    for (let i = 1; i < COLS_PER_PROD; i++) supHdr.push(prodPill(p));
  });
  setRow(ws, r, supHdr);
  let c0 = 1;
  PRODUCTS.forEach(() => {
    mergeRng(ws, r, c0, r, c0 + COLS_PER_PROD - 1);
    c0 += COLS_PER_PROD;
  });
  r++;

  // Sub-header: METRIC | (MONTH | W1 W2 ...) × 4
  const subHdr = [hdrCell('METRIC')];
  PRODUCTS.forEach(() => {
    subHdr.push(subHdrCell(d.monthLabel));
    weeks.forEach((w) => subHdr.push(subHdrCell(`Week ${w}`)));
  });
  setRow(ws, r, subHdr);
  r++;

  // Iterate platforms (sorted by total desc)
  const platforms = Object.entries(d.byPlatform)
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([name, agg]) => ({ name, ...agg }));

  if (!platforms.length) {
    setRow(ws, r, [cell('No data for this period.', { color: '6B7280', al: 'center' })]);
    mergeRng(ws, r, 0, r, totalCols - 1);
    r++;
  }

  platforms.forEach((plat, pi) => {
    // Platform header band
    setRow(ws, r, [{ v: plat.name, t: 's', s: {
      font: F(true, PAL.platFg, 11), fill: FILL(PAL.platBg),
      alignment: A('left'), border: BORDER_M,
    }}]);
    mergeRng(ws, r, 0, r, totalCols - 1);
    r++;

    METRICS.forEach((metric, mi) => {
      const row = [cell(metric, { bold: true, color: '1F3864', bg: PAL.prodBg })];
      PRODUCTS.forEach((p) => {
        const monthAgg = plat.byProduct[p] ?? { total: 0, quality: 0, converted: 0 };
        const monthVal = computeMetric(metric, monthAgg);
        row.push(metricCell(metric, monthVal));

        weeks.forEach((w) => {
          const wkAgg = plat.byWeek?.[w]?.byProduct?.[p] ?? { total: 0, quality: 0, converted: 0 };
          const wkVal = computeMetric(metric, wkAgg);
          row.push(metricCell(metric, wkVal));
        });
      });
      setRow(ws, r, row);
      r++;
    });
  });

  // ── Overall summary band ───────────────────────────────────────────────────
  r++;
  setRow(ws, r, [{ v: 'OVERALL SUMMARY', t: 's', s: {
    font: F(true, PAL.totalFg, 11), fill: FILL(PAL.totalBg),
    alignment: A('left'), border: BORDER_M,
  }}]);
  mergeRng(ws, r, 0, r, totalCols - 1);
  r++;

  METRICS.forEach((metric) => {
    const row = [cell(metric, { bold: true, color: 'FFFFFF', bg: PAL.totalBg })];
    PRODUCTS.forEach((p) => {
      const monthAgg = d.byProduct[p] ?? { total: 0, quality: 0, converted: 0 };
      const monthVal = computeMetric(metric, monthAgg);
      row.push(metricCell(metric, monthVal));

      weeks.forEach((w) => {
        const wkAgg = d.byWeek?.[w]?.byProduct?.[p] ?? { total: 0, quality: 0, converted: 0 };
        const wkVal = computeMetric(metric, wkAgg);
        row.push(metricCell(metric, wkVal));
      });
    });
    setRow(ws, r, row);
    r++;
  });

  // Widths
  setWidths(ws, [
    22,
    ...PRODUCTS.flatMap(() => [14, ...weeks.map(() => 11)]),
  ]);
  finaliseSheet(ws, r, totalCols - 1);
  // Freeze: top 5 rows (title + subtitle + blank + product super-hdr + month/week sub-hdr)
  //          plus the METRIC column (col 0).  So when you scroll right through
  //          products and weeks, the row labels stay; when you scroll down
  //          through platform sections, both the product-band and the
  //          week-column headers stay visible.
  // Freeze panes — must use !views (the standard SheetJS form) for the
  // xlsx-js-style writer to emit the <pane/> XML correctly.
  applyFreeze(ws, 5, 1);
  return ws;
}

function computeMetric(metric, agg) {
  switch (metric) {
    case 'Total':      return agg.total;
    case 'Quality':    return agg.quality;
    case '% Quality':  return agg.total > 0 ? agg.quality / agg.total : 0;
    case 'Converted':  return agg.converted;
    case 'Conv Rate':  return agg.total > 0 ? agg.converted / agg.total : 0;
    default: return 0;
  }
}
function metricCell(metric, v) {
  return (metric === '% Quality' || metric === 'Conv Rate')
    ? pctCell(v)
    : numCell(v);
}

// ═══════════════════════════════════════════════════════════════════════════
// Sheet 2 — AGENT PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════
// ── Sheet 2 — AGENT PERFORMANCE  (template-faithful arrangement) ────────
//
//   Mirrors the Call Centre report template exactly:
//
//                | January | February | March | April | Week 1 | Week 2 | Week 3 | Week 4 |
//     No of agents
//     Total calls made
//     Calls per agent
//     Successful
//     Success rate
//                      (blank row)
//     Products                                  ← section banner
//     LBF              ← product banner
//       No of agents
//       Successful calls
//       Calls per agent
//       Converted
//       Conversion rate
//       Sales          ← sub-header
//         New
//         Repeat
//                      (blank row)
//     CS  …  SME  …  Others … same shape
//                      (blank row)
//     Total Sales
//
//   Jan-Apr columns stay empty for now (no YTD data); Week columns are
//   computed from `byWeek[w]` and `byWeek[w].byProduct[p]`. Sales/New/Repeat
//   rows are left blank because we don't track new-vs-repeat conversions.

const AP_OVERALL_METRICS = [
  { key: 'agents',     label: 'No of agents'    },
  { key: 'total',      label: 'Total calls made'},
  { key: 'cpa',        label: 'Calls per agent' },
  { key: 'quality',    label: 'Successful'      },
  { key: 'successPct', label: 'Success rate'    },
];

const AP_PRODUCT_METRICS = [
  { key: 'agents',     label: 'No of agents'    },
  { key: 'quality',    label: 'Successful calls'},
  { key: 'cpa',        label: 'Calls per agent' },
  { key: 'converted',  label: 'Converted'       },
  { key: 'convPct',    label: 'Conversion rate' },
];

function buildAgentPerformanceSheet(d) {
  const ws = {};
  // Per-week breakdown of the CURRENT month only (no Jan-Apr columns —
  // we're in May; previous months aren't in the source data).  We use the
  // actual weeks present in the data, falling back to 1..4 to match the
  // Call Centre template.
  const WEEKS = d.weeksInData?.length ? d.weeksInData : [1, 2, 3, 4];
  // 1 label col + N week cols + 1 monthly-total col
  const cols  = 1 + WEEKS.length + 1;
  let r = 0;

  // ── Title row ────────────────────────────────────────────────────────────
  setRow(ws, r, [titleCell(`AGENT PERFORMANCE  •  ${d.monthLabel}`)]);
  mergeRng(ws, r, 0, r, cols - 1);
  r++;
  setRow(ws, r, [subtitleCell(
    `${d.agentCount} agents · ${d.total.toLocaleString()} calls · ${d.callsPerAgent} calls/agent · ${Math.round(d.successRate*100)}% success rate`
  )]);
  mergeRng(ws, r, 0, r, cols - 1);
  r++;

  // ── Column headers (Week 1–N + month total) ─────────────────────────────
  setRow(ws, r, [
    cell('', { bg: PAL.headerBg }),    // empty top-left
    ...WEEKS.map((w) => hdrCell(`Week ${w}`)),
    hdrCell(d.monthLabel.toUpperCase() + ' TOTAL'),
  ]);
  const FREEZE_ROW = r + 1;
  r++;

  // ── Helper: weekly value lookups ────────────────────────────────────────
  const weekAgg     = (w) => d.byWeek?.[w] ?? { total: 0, quality: 0, converted: 0, agents: 0 };
  const weekProdAgg = (w, p) =>
    d.byWeek?.[w]?.byProduct?.[p] ?? { total: 0, quality: 0, converted: 0, agents: 0 };

  // Renders a single metric row given:
  //   label       — text in col A
  //   weekValues  — array<{value, format}>, one per WEEKS entry
  //   monthValue  — {value, format} for the right-most "MAY TOTAL" column
  function metricRow(label, weekValues, monthValue, opts = {}) {
    const { sub = false, sectionRow = false, bold = false } = opts;
    const labelBg   = sectionRow ? PAL.totalBg : (sub ? 'FFFFFF' : PAL.prodBg);
    const labelFg   = sectionRow ? PAL.totalFg : (sub ? '6B7280' : '1F3864');
    const labelText = sub ? `   ${label}` : label;

    const renderVal = (v, bg = 'FFFFFF') => {
      if (v == null) return cell('', { bg });
      if (v.format === 'pct')  return pctCell(v.value, bg);
      if (v.format === 'text') return cell(v.value, { bg, al: 'right' });
      return numCell(v.value, { bg });
    };

    const row = [
      cell(labelText, { bold: bold || !sub, color: labelFg, bg: labelBg }),
      ...weekValues.map((v) => renderVal(v)),
      // Month-total cell — give it a subtle blue tint so it stands out
      renderVal(monthValue, sectionRow ? PAL.totalBg : 'EFF6FF'),
    ];
    setRow(ws, r, row);
    r++;
  }

  // Renders a banner row (product name spanning all data cols)
  function bannerRow(label, opts = {}) {
    const { bg = PAL.platBg, fg = PAL.platFg, sz = 11 } = opts;
    setRow(ws, r, [{
      v: label, t: 's', s: {
        font: F(true, fg, sz),
        fill: FILL(bg),
        alignment: A('left'),
        border: BORDER_M,
      },
    }]);
    mergeRng(ws, r, 0, r, cols - 1);
    r++;
  }

  function blankRow() {
    setRow(ws, r, [cell('', { bg: 'FFFFFF' })]);
    r++;
  }

  // ── OVERALL block ───────────────────────────────────────────────────────
  AP_OVERALL_METRICS.forEach((m) => {
    const weekValues = WEEKS.map((w) => {
      const a = weekAgg(w);
      switch (m.key) {
        case 'agents':     return a.total > 0 ? { value: a.agents } : null;
        case 'total':      return a.total > 0 ? { value: a.total }  : null;
        case 'cpa':        return a.agents > 0
                                  ? { value: Math.round(a.total / a.agents) }
                                  : null;
        case 'quality':    return a.total > 0 ? { value: a.quality } : null;
        case 'successPct': return a.total > 0
                                  ? { value: a.quality / a.total, format: 'pct' }
                                  : null;
        default: return null;
      }
    });
    // Month total — uses the overall summary totals (d.*)
    let monthValue = null;
    switch (m.key) {
      case 'agents':     monthValue = { value: d.agentCount }; break;
      case 'total':      monthValue = { value: d.total };      break;
      case 'cpa':        monthValue = { value: d.callsPerAgent }; break;
      case 'quality':    monthValue = { value: d.quality };    break;
      case 'successPct': monthValue = { value: d.successRate, format: 'pct' }; break;
    }
    metricRow(m.label, weekValues, monthValue);
  });

  blankRow();

  // ── PRODUCTS section banner ─────────────────────────────────────────────
  bannerRow('Products', { bg: PAL.totalBg, fg: PAL.totalFg, sz: 11 });

  // ── Per-product blocks (LBF, CS, SME, Others) ──────────────────────────
  PRODUCTS.forEach((p, i) => {
    if (i > 0) blankRow();

    const palP = PROD_PAL[p];
    bannerRow(p, { bg: palP.bg, fg: palP.fg, sz: 11 });

    AP_PRODUCT_METRICS.forEach((m) => {
      const weekValues = WEEKS.map((w) => {
        const a = weekProdAgg(w, p);
        switch (m.key) {
          case 'agents':    return a.total > 0 ? { value: a.agents } : null;
          case 'quality':   return a.total > 0 ? { value: a.quality } : null;
          case 'cpa':       return a.agents > 0
                                  ? { value: Math.round(a.total / a.agents) }
                                  : null;
          case 'converted': return a.total > 0 ? { value: a.converted } : null;
          case 'convPct':   return a.total > 0
                                  ? { value: a.converted / a.total, format: 'pct' }
                                  : null;
          default: return null;
        }
      });
      const pAgg = d.byProduct[p] ?? { total: 0, quality: 0, converted: 0, agents: 0 };
      let monthValue = null;
      switch (m.key) {
        case 'agents':    monthValue = { value: pAgg.agents }; break;
        case 'quality':   monthValue = { value: pAgg.quality }; break;
        case 'cpa':       monthValue = pAgg.agents > 0
                                  ? { value: Math.round(pAgg.total / pAgg.agents) }
                                  : null; break;
        case 'converted': monthValue = { value: pAgg.converted }; break;
        case 'convPct':   monthValue = pAgg.total > 0
                                  ? { value: pAgg.converted / pAgg.total, format: 'pct' }
                                  : null; break;
      }
      metricRow(m.label, weekValues, monthValue);
    });

    // Sales sub-header  (label only, no values)
    setRow(ws, r, [
      cell('Sales', { bold: true, color: '1F3864', bg: PAL.prodBg }),
      ...WEEKS.map(() => cell('', { bg: PAL.prodBg })),
      cell('', { bg: PAL.prodBg }),
    ]);
    r++;

    // ── New / Repeat — populated from the new client_type column ──────────
    // A "sale" is a converted row. We show `amount (count)` per cell so the
    // reader sees both the loan size and how many sales it represents.
    // e.g. "732,800 (1)" means 1 sale, total loan amount 732,800.
    const fmtAmt = (n) => Math.round(n || 0).toLocaleString();
    const fmtAC  = (amt, cnt) =>
      (!cnt && !amt) ? null
                     : { value: `${fmtAmt(amt)} (${cnt})`, format: 'text' };

    const newWeek = WEEKS.map((w) => {
      const a = weekProdAgg(w, p);
      return fmtAC(a.newLoanAmount, a.newSales);
    });
    const repWeek = WEEKS.map((w) => {
      const a = weekProdAgg(w, p);
      return fmtAC(a.repeatLoanAmount, a.repeatSales);
    });
    const pAgg = d.byProduct[p] ?? {};
    metricRow('New',    newWeek, fmtAC(pAgg.newLoanAmount,    pAgg.newSales),    { sub: true });
    metricRow('Repeat', repWeek, fmtAC(pAgg.repeatLoanAmount, pAgg.repeatSales), { sub: true });

    // Total loan amount per product (sum of all converted loan_amount values)
    const loanWeek = WEEKS.map((w) => {
      const a = weekProdAgg(w, p);
      return a.loanAmount > 0 ? { value: a.loanAmount } : null;
    });
    const pLoan = pAgg.loanAmount || 0;
    metricRow('Loan amount', loanWeek, pLoan > 0 ? { value: pLoan } : null, { sub: true });
  });

  blankRow();

  // ── Total Sales (grand total of conversions across all products) ───────
  const totalSalesByWeek = WEEKS.map((w) => {
    const a = weekAgg(w);
    return a.converted > 0 ? { value: a.converted } : null;
  });
  const totalSalesMonth = { value: d.converted };
  metricRow('Total Sales', totalSalesByWeek, totalSalesMonth, { sectionRow: true, bold: true });

  // ── Column widths + freeze ──────────────────────────────────────────────
  setWidths(ws, [
    22,                            // label column
    ...WEEKS.map(() => 14),        // W1..WN
    18,                            // month total
  ]);
  finaliseSheet(ws, r, cols - 1);

  // Freeze: rows 0..FREEZE_ROW-1 (title + subtitle + column header)
  //         + first column (the row labels).
  applyFreeze(ws, FREEZE_ROW, 1);
  return ws;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sheet 3 — DISPOSITIONS
// ═══════════════════════════════════════════════════════════════════════════
function buildDispositionsSheet(d) {
  const ws = {};
  const cols = 4;
  let r = 0;
  setRow(ws, r, [titleCell(`DISPOSITIONS  •  ${d.monthLabel}`)]);
  mergeRng(ws, r, 0, r, cols - 1);
  r++;
  setRow(ws, r, [subtitleCell(
    `Breakdown of every lead by its final status (${d.total.toLocaleString()} total)`
  )]);
  mergeRng(ws, r, 0, r, cols - 1);
  r += 2;
  setRow(ws, r, [
    hdrCell('#', 'right'),
    hdrCell('STATUS'),
    hdrCell('COUNT', 'right'),
    hdrCell('% OF TOTAL', 'right'),
  ]);
  r++;

  const maxCount = d.byStatus.reduce((m, s) => Math.max(m, s.count), 0);
  d.byStatus.forEach((s, i) => {
    const bg = i % 2 === 0 ? 'FFFFFF' : PAL.altRow;
    // Choose colour band based on disposition type
    const palBg = pickStatusBg(s.status);
    setRow(ws, r, [
      numCell(i + 1, { color: '9CA3AF', bg }),
      { v: s.status, t: 's', s: {
        font: F(true, pickStatusFg(s.status), 9), fill: FILL(palBg),
        alignment: A('left'), border: BORDER,
      }},
      numCell(s.count, { bold: true, bg }),
      pctCell(s.pct, bg),
    ]);
    r++;
  });
  // Totals row
  setRow(ws, r, [
    cell('', { bg: PAL.totalBg }),
    cell('TOTAL', { bold: true, color: 'FFFFFF', bg: PAL.totalBg }),
    numCell(d.total, { bold: true, color: 'FFFFFF', bg: PAL.totalBg }),
    pctCell(1, PAL.totalBg),
  ]);
  r++;

  setWidths(ws, [6, 36, 14, 14]);
  finaliseSheet(ws, r, cols - 1);
  // Freeze: header row (the col-header is at r=3 because of the `r += 2`
  //          after the subtitle, so ySplit=4 keeps rows 0-3 pinned)
  //          + first 2 cols (# and STATUS) so the metrics stay visible
  //          when scrolling.
  applyFreeze(ws, 4, 2);
  return ws;
}

function pickStatusBg(s) {
  switch (s) {
    case 'Converted':                 return 'DCFCE7';
    case 'Qualified for LBF':         return 'E0E7FF';
    case 'Qualified for SME':         return 'D1FAE5';
    case 'Qualified for CS':          return 'CFFAFE';
    case 'Existing client':           return 'DBEAFE';
    case 'Probation':                 return 'EDE9FE';
    case 'Referred':                  return 'FCE7F3';
    case 'Request callback':
    case 'Request more time':         return 'FEF3C7';
    case 'No affordability':          return 'FED7AA';
    case 'Duplicated number':         return 'E9D5FF';
    case 'Not picking':               return 'F3F4F6';
    case 'Not reachable':             return 'E5E7EB';
    case 'Not interested':            return 'FEE2E2';
    case 'Not qualified':             return 'FECACA';
    case 'Failed to connect':         return 'FEE4E2';
    case 'Busy':                      return 'FEF9C3';
    case 'Redirected':                return 'E0F2FE';
    case 'Other':                     return 'F9FAFB';
    default:                          return 'FFFFFF';
  }
}
function pickStatusFg(s) {
  switch (s) {
    case 'Converted':                 return '14532D';
    case 'Qualified for LBF':         return '3730A3';
    case 'Qualified for SME':         return '065F46';
    case 'Qualified for CS':          return '155E75';
    case 'Existing client':           return '1E3A8A';
    case 'Probation':                 return '5B21B6';
    case 'Referred':                  return '9D174D';
    case 'Request callback':
    case 'Request more time':         return '92400E';
    case 'No affordability':          return '7C2D12';
    case 'Duplicated number':         return '6B21A8';
    case 'Not picking':               return '4B5563';
    case 'Not reachable':             return '374151';
    case 'Not interested':            return '991B1B';
    case 'Not qualified':             return '7F1D1D';
    case 'Failed to connect':         return '7F1D1D';
    case 'Busy':                      return '854D0E';
    case 'Redirected':                return '075985';
    case 'Other':                     return '6B7280';
    default:                          return '1F2937';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

export function buildSocialMediaReportBuffer(processedData) {
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, buildDataSheet(processedData),              'Data');
  XLSXStyle.utils.book_append_sheet(wb, buildAgentPerformanceSheet(processedData),  'Agent Performance');
  XLSXStyle.utils.book_append_sheet(wb, buildDispositionsSheet(processedData),      'Dispositions');

  const buffer  = XLSXStyle.write(wb, { type: 'array', bookType: 'xlsx' });
  const date    = new Date().toISOString().slice(0, 10);
  const fileName = `Social_Media_Report_${date}.xlsx`;
  return { buffer, fileName };
}

export function downloadSocialMediaReport(processedData) {
  const { buffer, fileName } = buildSocialMediaReportBuffer(processedData);
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
