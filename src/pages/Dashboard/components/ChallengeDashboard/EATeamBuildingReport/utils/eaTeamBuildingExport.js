/**
 * EA Team Building Report — Excel Export
 *
 * Layout: merged PRODUCT → REGION → BRANCH/TL, then per-agent columns.
 * Monthly data: one column per month → "50,000,000 (5)" format.
 * Column groups separated by medium blue right-border dividers.
 * Super-header rows label each column group.
 */

import XLSXStyle from 'xlsx-js-style';

const PAR_LIMIT = 0.04;

const PRODUCT_LABELS = {
  CS:  'CS — CIVIL SERVANT',
  LBF: 'LBF — LOG BOOK FINANCE',
  SME: 'SME — SMALL & MEDIUM ENTERPRISE',
};

const PAL = {
  productBg: '1F3864', productFg: 'FFFFFF',
  regionBg:  '2E74B5', regionFg:  'FFFFFF',
  branchBg:  'D6E4F0', branchFg:  '1F3864',
  agentBg:   'FFFFFF', agentAlt:  'F7FAFD',
  headerBg:  '1F3864', headerFg:  'FFFFFF',
};

// ── border helpers ────────────────────────────────────────────────────────────
const thin  = { style: 'thin',   color: { rgb: 'C8D0DA' } };
const med   = { style: 'medium', color: { rgb: '8EA9C1' } };
const sep   = { style: 'medium', color: { rgb: '2563EB' } }; // group separator

const BORDER     = { top: thin, bottom: thin, left: thin,  right: thin  };
const BORDER_MED = { top: med,  bottom: med,  left: med,   right: med   };
const BORDER_SEP = { top: thin, bottom: thin, left: thin,  right: sep   }; // right group separator

// ── style helpers ─────────────────────────────────────────────────────────────
const A = (horizontal = 'left', wrap = false, vertical = 'center') =>
  ({ horizontal, vertical, wrapText: wrap });

const F = (bold = false, color = '000000', sz = 9, name = 'Arial') =>
  ({ name, bold, color: { rgb: color }, sz });

const FILL = (rgb) => ({ patternType: 'solid', fgColor: { rgb } });

// ── cell factories ────────────────────────────────────────────────────────────
function hdrCell(v, isSep = false) {
  return {
    v: v ?? '', t: 's',
    s: {
      font:      F(true, PAL.headerFg, 9),
      fill:      FILL(PAL.headerBg),
      alignment: A('center', true),
      border:    isSep ? BORDER_SEP : BORDER,
    },
  };
}

/** Super-header cell — labels a column group */
function superHdrCell(v, bg = '1E3A5F', isSep = false) {
  return {
    v: v ?? '', t: 's',
    s: {
      font:      F(true, 'FFFFFF', 9),
      fill:      FILL(bg),
      alignment: A('center', false, 'center'),
      border:    isSep ? BORDER_SEP : BORDER,
    },
  };
}

function blankSuper(bg = '1E3A5F', isSep = false) {
  return { v: '', t: 's', s: { fill: FILL(bg), border: isSep ? BORDER_SEP : BORDER } };
}

function mergedCell(v, bgKey, fgKey, border = BORDER) {
  return {
    v: v ?? '', t: 's',
    s: { font: F(true, PAL[fgKey], 9), fill: FILL(PAL[bgKey]), alignment: A('center', true, 'center'), border },
  };
}

function blankOf(bg, isSep = false) {
  return { v: '', t: 's', s: { fill: FILL(bg), border: isSep ? BORDER_SEP : BORDER } };
}

function agentCell(v, alt = false, bold = false, isSep = false) {
  const bg = alt ? PAL.agentAlt : PAL.agentBg;
  return {
    v: v ?? '', t: 's',
    s: { font: F(bold, '1A1A2E', 9), fill: FILL(bg), alignment: A('left', false), border: isSep ? BORDER_SEP : BORDER },
  };
}

function numCell(v, alt = false, color = null, isSep = false) {
  const bg = alt ? PAL.agentAlt : PAL.agentBg;
  return {
    v: v ?? 0, t: 'n',
    s: {
      font:      { name: 'Arial', bold: false, sz: 9, color: { rgb: color ?? '1A1A2E' } },
      fill:      FILL(bg),
      alignment: A('right'),
      border:    isSep ? BORDER_SEP : BORDER,
      numFmt:    '#,##0',
    },
  };
}

function monthCell(mo, alt = false, isSep = false) {
  const bg = alt ? PAL.agentAlt : PAL.agentBg;
  if (!mo || (mo.amt === 0 && mo.loans === 0)) {
    return {
      v: '—', t: 's',
      s: { font: F(false, '9CA3AF', 9), fill: FILL(bg), alignment: A('right'), border: isSep ? BORDER_SEP : BORDER },
    };
  }
  const v = `${Math.round(mo.amt).toLocaleString()} (${mo.loans})`;
  return {
    v, t: 's',
    s: { font: F(false, '1A1A2E', 9), fill: FILL(bg), alignment: A('right'), border: isSep ? BORDER_SEP : BORDER },
  };
}

function pctCell(numerator, denominator, alt = false, isSep = false) {
  const v     = denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
  const color = v >= 100 ? '166534' : v >= 75 ? 'B45309' : '9C0006';
  const bg    = alt ? PAL.agentAlt : PAL.agentBg;
  return {
    v, t: 'n',
    s: { font: F(true, color, 9), fill: FILL(bg), alignment: A('center'), border: isSep ? BORDER_SEP : BORDER, numFmt: '0"%"' },
  };
}

function parCell(par, alt = false, isSep = false) {
  const bg    = alt ? PAL.agentAlt : PAL.agentBg;
  const ok    = (par ?? 0) <= PAR_LIMIT;
  const color = ok ? '166534' : '9C0006';
  return {
    v: `${((par ?? 0) * 100).toFixed(1)}%`, t: 's',
    s: { font: F(true, color, 9), fill: FILL(bg), alignment: A('center'), border: isSep ? BORDER_SEP : BORDER },
  };
}

function statusCell(qualified, alt) {
  const bg = qualified ? (alt ? 'DCFCE7' : 'F0FDF4') : (alt ? 'FEE2E2' : 'FFF5F5');
  const fg = qualified ? '166534' : '991B1B';
  return {
    v: qualified ? 'QUALIFIED' : 'NOT QUALIFIED', t: 's',
    s: { font: F(true, fg, 9), fill: FILL(bg), alignment: A('center'), border: BORDER },
  };
}

// ── AOA → worksheet ───────────────────────────────────────────────────────────
function aoaToSheet(aoa, colWidths, rowHeights = {}) {
  const ws = {};
  let maxR = 0, maxC = 0;
  aoa.forEach((row, r) => {
    if (r > maxR) maxR = r;
    row.forEach((cell, col) => {
      if (col > maxC) maxC = col;
      if (cell !== null && cell !== undefined) {
        ws[XLSXStyle.utils.encode_cell({ r, c: col })] = cell;
      }
    });
  });
  ws['!ref'] = XLSXStyle.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  if (colWidths) ws['!cols'] = colWidths.map((w) => ({ wch: w }));
  if (Object.keys(rowHeights).length) {
    ws['!rows'] = [];
    for (let i = 0; i <= maxR; i++) ws['!rows'].push(rowHeights[i] ? { hpx: rowHeights[i] } : {});
  }
  return ws;
}

/** Add medium blue right-border to cells at the given column indices (group separators). */
function applyGroupSeps(rows, sepCols) {
  const SEP_RIGHT = { style: 'medium', color: { rgb: '2563EB' } };
  rows.forEach((row) => {
    sepCols.forEach((col) => {
      const cell = row[col];
      if (cell && cell.s) {
        row[col] = { ...cell, s: { ...cell.s, border: { ...(cell.s.border || BORDER), right: SEP_RIGHT } } };
      }
    });
  });
}

const fmt  = (n) => Math.round(n ?? 0).toLocaleString();
/** % achieved ratio — 0 when no target; always tiebreak by absolute amount */
const achv = (amount, target) => target > 0 ? amount / target : 0;
const cmpAchv = (aAmt, aTgt, bAmt, bTgt) => {
  const d = achv(bAmt, bTgt) - achv(aAmt, aTgt);
  return d !== 0 ? d : bAmt - aAmt;
};

// ── Sheet: All Agents ─────────────────────────────────────────────────────────

function buildAllAgentsSheet(hierarchy, monthsInData) {
  const months = monthsInData;

  const sortedProducts = ['CS', 'LBF', 'SME']
    .filter((p) => hierarchy[p])
    .concat(Object.keys(hierarchy).filter((p) => !['CS', 'LBF', 'SME'].includes(p)))
    .sort((a, b) => cmpAchv(hierarchy[a].totalAmount, hierarchy[a].target, hierarchy[b].totalAmount, hierarchy[b].target));

  const COL_PRODUCT   = 0;
  const COL_REGION    = 1;
  const COL_BRANCH    = 2;  // group sep after col 2
  const COL_NUM       = 3;
  const COL_NAME      = 4;
  const COL_ROLE      = 5;
  const COL_CAT       = 6;
  const COL_PERIOD    = 7;
  const COL_FLAG      = 8;  // group sep after col 8
  const MONTHLY_START = 9;
  // group sep after last monthly col: MONTHLY_START + months.length - 1
  const rightStart    = MONTHLY_START + months.length; // group sep after rightStart + 3 (% ACHIEVED)

  const monthCols  = months.map((m) => m.slice(0, 3).toUpperCase());
  const fixedRight = ['TOTAL LOANS', 'TOTAL AMOUNT (TZS)', 'TARGET (TZS)', '% ACHIEVED', 'STATUS'];

  // ── super-header (row 0) ─────────────────────────────────────────────────────
  const totalCols   = 3 + 6 + months.length + 5; // product+region+branch + identity + monthly + right
  const superHdrRow = new Array(totalCols).fill(null);
  const G1 = '1F3864'; const G2 = '2563EB'; const G3 = '155E75'; const G4 = '166534';

  // Group 1: PRODUCT / REGION / BRANCH (cols 0-2)
  superHdrRow[0] = superHdrCell('PRODUCT / REGION / BRANCH', G1);
  superHdrRow[1] = blankSuper(G1);
  superHdrRow[2] = blankSuper(G1, true); // sep right

  // Group 2: AGENT INFORMATION (cols 3-8)
  superHdrRow[3] = superHdrCell('AGENT INFORMATION', G2);
  for (let i = 4; i <= 7; i++) superHdrRow[i] = blankSuper(G2);
  superHdrRow[8] = blankSuper(G2, true); // sep right

  // Group 3: MONTHLY DISBURSEMENT (cols 9 to 9+months-1)
  superHdrRow[9] = superHdrCell(`MONTHLY DISBURSEMENT  (Amount · Count)`, G3);
  for (let i = 10; i < MONTHLY_START + months.length - 1; i++) superHdrRow[i] = blankSuper(G3);
  if (months.length > 0) superHdrRow[MONTHLY_START + months.length - 1] = blankSuper(G3, true);

  // Group 4: PERFORMANCE (last 5 cols)
  const perfStart = MONTHLY_START + months.length;
  superHdrRow[perfStart] = superHdrCell('PERFORMANCE SUMMARY', G4);
  for (let i = perfStart + 1; i < totalCols; i++) superHdrRow[i] = blankSuper(G4);

  // ── column header (row 1) ────────────────────────────────────────────────────
  const hdrRow = [
    'PRODUCT', 'REGION', 'BRANCH / TL',
    '#', 'SALES REP.', 'TITLE', 'CATEGORY', 'PERIOD JOINED', 'FLAG JOINED DATE',
    ...monthCols,
    ...fixedRight,
  ];

  const colWidths = [
    20, 22, 28,
    5, 26, 18, 12, 16, 10,
    ...months.map(() => 22),
    10, 18, 18, 11, 15,
  ];

  const rows       = [];
  const merges     = [];
  const rowHeights = {};

  rows.push(superHdrRow);        rowHeights[0] = 20;
  rows.push(hdrRow.map((h, i) => {
    const sepCols = [2, 8, MONTHLY_START + months.length - 1];
    return hdrCell(h, sepCols.includes(i));
  }));                           rowHeights[1] = 28;

  // Merges for super-header
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } });
  merges.push({ s: { r: 0, c: 3 }, e: { r: 0, c: 8 } });
  if (months.length > 1) merges.push({ s: { r: 0, c: 9 }, e: { r: 0, c: MONTHLY_START + months.length - 1 } });
  if (fixedRight.length > 1) merges.push({ s: { r: 0, c: perfStart }, e: { r: 0, c: totalCols - 1 } });

  let rowIdx = 2;

  sortedProducts.forEach((product) => {
    const pObj           = hierarchy[product];
    const pName          = PRODUCT_LABELS[product] ?? product;
    const productStartRow = rowIdx;

    Object.entries(pObj.regions)
      .sort(([, a], [, b]) => cmpAchv(a.totalAmount, a.target, b.totalAmount, b.target))
      .forEach(([region, rObj]) => {
      const regionStartRow = rowIdx;

      Object.entries(rObj.branches)
        .sort(([, a], [, b]) => cmpAchv(a.totalAmount, a.target, b.totalAmount, b.target))
        .forEach(([branch, bObj]) => {
        const branchStartRow = rowIdx;
        const sortedAgents   = [...bObj.agents].sort((a, b) => cmpAchv(a.totalAmount, a.target, b.totalAmount, b.target));

        sortedAgents.forEach((agent, idx) => {
          const alt      = idx % 2 === 1;
          const agentRow = new Array(totalCols).fill(null);

          agentRow[COL_NUM]    = numCell(idx + 1, alt);
          agentRow[COL_NAME]   = agentCell(agent.repName, alt, true);
          agentRow[COL_ROLE]   = agentCell(agent.title || agent.role || '—', alt);
          agentRow[COL_CAT]    = agentCell(agent.flag === 'Yes' ? 'Old Agent' : 'New Agent', alt);
          agentRow[COL_PERIOD] = agentCell(agent.period || 'Unknown', alt);
          agentRow[COL_FLAG]   = agentCell(agent.flag || '—', alt, false, true); // sep

          months.forEach((m, mi) => {
            const isLastMonth = mi === months.length - 1;
            agentRow[MONTHLY_START + mi] = monthCell(agent.monthly[m], alt, isLastMonth);
          });

          agentRow[rightStart]     = numCell(agent.totalLoans,  alt);
          agentRow[rightStart + 1] = numCell(agent.totalAmount, alt);
          agentRow[rightStart + 2] = numCell(agent.target ?? 0, alt);
          agentRow[rightStart + 3] = pctCell(agent.totalAmount, agent.target ?? 0, alt);
          agentRow[rightStart + 4] = statusCell(agent.qualified, alt);

          rows.push(agentRow);
          rowHeights[rowIdx] = 18;
          rowIdx++;
        });

        // ── BRANCH/TL merged cell ─────────────────────────────────────────────
        const tlQual  = bObj.tlQualified;
        const tlPct   = bObj.target > 0 ? Math.round((bObj.totalAmount / bObj.target) * 100) : 0;
        const branchLabel = [
          branch,
          bObj.tlName ? `TL: ${bObj.tlName}` : '',
          `Tgt: ${fmt(bObj.target)} | Act: ${fmt(bObj.totalAmount)}`,
          `Achv: ${tlPct}% | PAR>30: ${((bObj.tlPar30 ?? 0) * 100).toFixed(1)}%`,
          tlQual ? '✓ QUALIFIED' : `✗ NOT QUAL. — ${bObj.tlReason || ''}`,
        ].filter(Boolean).join('\n');

        rows[branchStartRow][COL_BRANCH] = mergedCell(branchLabel, 'branchBg', 'branchFg', BORDER_SEP);
        for (let r = branchStartRow + 1; r < rowIdx; r++) rows[r][COL_BRANCH] = blankOf(PAL.branchBg, true);
        if (rowIdx - 1 >= branchStartRow) merges.push({ s: { r: branchStartRow, c: COL_BRANCH }, e: { r: rowIdx - 1, c: COL_BRANCH } });
      });

      // ── REGION merged cell ────────────────────────────────────────────────────
      const regQual = rObj.regionQualified;
      const regPct  = rObj.target > 0 ? Math.round((rObj.totalAmount / rObj.target) * 100) : 0;
      const regionLabel = [
        region.toUpperCase(),
        `Tgt: ${fmt(rObj.target)} | Act: ${fmt(rObj.totalAmount)}`,
        `Achv: ${regPct}% | PAR>30: ${((rObj.regionPar30 ?? 0) * 100).toFixed(1)}%`,
        regQual ? '✓ QUALIFIED' : `✗ NOT QUAL. — ${rObj.regionReason || ''}`,
      ].join('\n');

      rows[regionStartRow][COL_REGION] = mergedCell(regionLabel, 'regionBg', 'regionFg');
      for (let r = regionStartRow + 1; r < rowIdx; r++) rows[r][COL_REGION] = blankOf(PAL.regionBg);
      if (rowIdx - 1 >= regionStartRow) merges.push({ s: { r: regionStartRow, c: COL_REGION }, e: { r: rowIdx - 1, c: COL_REGION } });
    });

    // ── PRODUCT merged cell ───────────────────────────────────────────────────
    const pct          = pObj.target > 0 ? Math.round((pObj.totalAmount / pObj.target) * 100) : 0;
    const productLabel = [
      pName,
      `Target: ${fmt(pObj.target)} TZS`,
      `Actual: ${fmt(pObj.totalAmount)} TZS`,
      `Achieved: ${pct}%  |  Loans: ${pObj.totalLoans}`,
      `Qualified agents: ${pObj.qualCount}`,
    ].join('\n');

    rows[productStartRow][COL_PRODUCT] = mergedCell(productLabel, 'productBg', 'productFg', BORDER_MED);
    for (let r = productStartRow + 1; r < rowIdx; r++) rows[r][COL_PRODUCT] = blankOf(PAL.productBg);
    if (rowIdx - 1 >= productStartRow) merges.push({ s: { r: productStartRow, c: COL_PRODUCT }, e: { r: rowIdx - 1, c: COL_PRODUCT } });
  });

  // Apply group separator on col 8 for all data rows (FLAG col)
  applyGroupSeps(rows.slice(2), [8]);

  const ws = aoaToSheet(rows, colWidths, rowHeights);
  ws['!merges'] = merges;
  ws['!freeze'] = { xSplit: 3, ySplit: 2 };
  return ws;
}

// ── Sheet: Qualified ─────────────────────────────────────────────────────────

function buildQualifiedSheet(hierarchy, monthsInData) {
  const months    = monthsInData;
  const monthCols = months.map((m) => m.slice(0, 3).toUpperCase());

  const qualGreen = (v, alt) => ({
    v, t: 's',
    s: { font: F(true, '166534', 9), fill: FILL(alt ? 'DCFCE7' : 'F0FDF4'), alignment: A('center'), border: BORDER },
  });

  const rows       = [];
  const rowHeights = {};
  const merges     = [];
  let rowIdx = 0;

  // helper: section divider
  const sectionHdr = (title, cols) => {
    const row = [];
    row.push({
      v: title, t: 's',
      s: { font: F(true, '1E3A5F', 11), fill: FILL('DBEAFE'), alignment: A('left', false, 'center'), border: BORDER },
    });
    for (let i = 1; i < cols; i++) row.push({ v: '', t: 's', s: { fill: FILL('DBEAFE'), border: BORDER } });
    return row;
  };

  // ════════════════════════════════════════════════════════════════════════════
  // TABLE 1 — QUALIFIED SALES REPS
  // ════════════════════════════════════════════════════════════════════════════
  //  Col groups:
  //  0-4  : #, PRODUCT, REGION, BRANCH/TL, SALES REP.   [IDENTITY]        sep after 4
  //  5-8  : ROLE, CATEGORY, PERIOD JOINED, FLAG          [AGENT INFO]      sep after 8
  //  9..N : monthly                                      [MONTHLY DATA]    sep after last
  //  N+1.. : TOTAL LOANS, MIN, TOTAL AMOUNT, MIN, TARGET, %  [PERFORMANCE]

  const T1_ID_END   = 4;   // sep col
  const T1_INFO_END = 8;   // sep col
  const T1_MONTH_S  = 9;
  const T1_MONTH_E  = T1_MONTH_S + months.length - 1; // sep col
  const T1_RIGHT_S  = T1_MONTH_S + months.length;

  const T1_COLS = [
    '#', 'PRODUCT', 'REGION', 'BRANCH / TL', 'SALES REP.',
    'TITLE', 'CATEGORY', 'PERIOD JOINED', 'FLAG JOINED DATE',
    ...monthCols,
    'TOTAL LOANS', 'MIN LOANS', 'TOTAL AMOUNT (TZS)', 'MIN AMOUNT (TZS)', 'TARGET (TZS)', '% ACHIEVED',
  ];
  const T1_LEN    = T1_COLS.length;
  const T1_WIDTHS = [5, 20, 20, 26, 26, 18, 12, 16, 10, ...months.map(() => 22), 10, 11, 18, 18, 18, 11];

  // Section header
  rows.push(sectionHdr('QUALIFIED SALES REPS', T1_LEN)); rowHeights[rowIdx] = 22;
  merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: T1_LEN - 1 } }); rowIdx++;

  // Super-header for T1
  {
    const sh = new Array(T1_LEN).fill(null);
    const G1 = '1F3864', G2 = '2563EB', G3 = '155E75', G4 = '166534';
    sh[0] = superHdrCell('IDENTITY', G1);
    for (let i = 1; i < T1_ID_END; i++) sh[i] = blankSuper(G1);
    sh[T1_ID_END] = blankSuper(G1, true);
    sh[T1_ID_END + 1] = superHdrCell('AGENT INFO', G2);
    for (let i = T1_ID_END + 2; i < T1_INFO_END; i++) sh[i] = blankSuper(G2);
    sh[T1_INFO_END] = blankSuper(G2, true);
    sh[T1_MONTH_S] = superHdrCell('MONTHLY DISBURSEMENT', G3);
    for (let i = T1_MONTH_S + 1; i < T1_MONTH_E; i++) sh[i] = blankSuper(G3);
    if (months.length > 0) sh[T1_MONTH_E] = blankSuper(G3, true);
    sh[T1_RIGHT_S] = superHdrCell('PERFORMANCE TARGETS', G4);
    for (let i = T1_RIGHT_S + 1; i < T1_LEN; i++) sh[i] = blankSuper(G4);

    rows.push(sh); rowHeights[rowIdx] = 18;
    if (T1_ID_END > 0)   merges.push({ s: { r: rowIdx, c: 0 },          e: { r: rowIdx, c: T1_ID_END } });
    if (T1_INFO_END > T1_ID_END + 1) merges.push({ s: { r: rowIdx, c: T1_ID_END + 1 }, e: { r: rowIdx, c: T1_INFO_END } });
    if (months.length > 1) merges.push({ s: { r: rowIdx, c: T1_MONTH_S }, e: { r: rowIdx, c: T1_MONTH_E } });
    if (T1_LEN - T1_RIGHT_S > 1) merges.push({ s: { r: rowIdx, c: T1_RIGHT_S }, e: { r: rowIdx, c: T1_LEN - 1 } });
    rowIdx++;
  }

  // Column header
  rows.push(T1_COLS.map((h, i) => hdrCell(h, [T1_ID_END, T1_INFO_END, T1_MONTH_E].includes(i))));
  rowHeights[rowIdx++] = 28;

  // ── collect ALL qualified agents, sort globally by % achieved ────────────────
  const allQualAgents = [];
  Object.entries(hierarchy).forEach(([product, pObj]) => {
    const pName = PRODUCT_LABELS[product] ?? product;
    Object.entries(pObj.regions).forEach(([region, rObj]) => {
      Object.entries(rObj.branches).forEach(([branch, bObj]) => {
        bObj.agents.filter((a) => a.qualified).forEach((agent) => {
          allQualAgents.push({ pName, region, branch, agent });
        });
      });
    });
  });
  allQualAgents.sort((x, y) => cmpAchv(x.agent.totalAmount, x.agent.target, y.agent.totalAmount, y.agent.target));

  allQualAgents.forEach(({ pName, region, branch, agent }, idx) => {
    const alt = idx % 2 === 1;
    const row = new Array(T1_LEN).fill(null);
    row[0] = numCell(idx + 1, alt);
    row[1] = agentCell(pName, alt);
    row[2] = agentCell(region, alt);
    row[3] = agentCell(branch, alt);
    row[4] = agentCell(agent.repName, alt, true, true); // sep
    row[5] = agentCell(agent.title || agent.role || '—', alt);
    row[6] = agentCell(agent.flag === 'Yes' ? 'Old Agent' : 'New Agent', alt);
    row[7] = agentCell(agent.period || 'Unknown', alt);
    row[8] = agentCell(agent.flag || '—', alt, false, true); // sep
    months.forEach((m, mi) => {
      row[T1_MONTH_S + mi] = monthCell(agent.monthly[m], alt, mi === months.length - 1);
    });
    row[T1_RIGHT_S]     = numCell(agent.totalLoans,   alt);
    row[T1_RIGHT_S + 1] = numCell(agent.minLoans ?? 0, alt, '166534');
    row[T1_RIGHT_S + 2] = numCell(agent.totalAmount,  alt);
    row[T1_RIGHT_S + 3] = numCell(agent.minDisb ?? 0,  alt, '166534');
    row[T1_RIGHT_S + 4] = numCell(agent.target ?? 0,   alt);
    row[T1_RIGHT_S + 5] = pctCell(agent.totalAmount, agent.target ?? 0, alt);
    rows.push(row); rowHeights[rowIdx++] = 18;
  });

  // spacers
  for (let i = 0; i < 2; i++) {
    rows.push(new Array(T1_LEN).fill({ v: '', t: 's', s: { border: {} } }));
    rowHeights[rowIdx++] = 8;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TABLE 2 — QUALIFIED TEAM LEADERS
  // ════════════════════════════════════════════════════════════════════════════
  const T2_COLS   = ['#', 'PRODUCT', 'REGION', 'BRANCH / TL', 'TL NAME',
    'BRANCH TARGET (TZS)', 'BRANCH ACTUAL (TZS)', '% ACHIEVED', 'PAR > 30'];
  const T2_LEN    = T2_COLS.length;
  const T2_WIDTHS = [5, 20, 22, 28, 24, 20, 20, 13, 12];

  rows.push(sectionHdr('QUALIFIED TEAM LEADERS', T2_LEN)); rowHeights[rowIdx] = 22;
  merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: T2_LEN - 1 } }); rowIdx++;

  // Super-header for T2
  {
    const sh = new Array(T2_LEN).fill(null);
    sh[0] = superHdrCell('IDENTITY', '1F3864');
    for (let i = 1; i <= 4; i++) sh[i] = blankSuper('1F3864');
    sh[4] = blankSuper('1F3864', true);
    sh[5] = superHdrCell('PERFORMANCE (Target vs Actual + PAR)', '166534');
    for (let i = 6; i < T2_LEN; i++) sh[i] = blankSuper('166534');
    rows.push(sh); rowHeights[rowIdx] = 18;
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: 4 } });
    merges.push({ s: { r: rowIdx, c: 5 }, e: { r: rowIdx, c: T2_LEN - 1 } });
    rowIdx++;
  }

  rows.push(T2_COLS.map((h, i) => hdrCell(h, i === 4)));
  rowHeights[rowIdx++] = 28;

  // ── collect ALL qualified TLs, sort globally by % achieved ──────────────────
  const allQualTLs = [];
  Object.entries(hierarchy).forEach(([product, pObj]) => {
    const pName = PRODUCT_LABELS[product] ?? product;
    Object.entries(pObj.regions).forEach(([region, rObj]) => {
      Object.entries(rObj.branches).filter(([, b]) => b.tlQualified).forEach(([branch, bObj]) => {
        allQualTLs.push({ pName, region, branch, bObj });
      });
    });
  });
  allQualTLs.sort((x, y) => cmpAchv(x.bObj.totalAmount, x.bObj.target, y.bObj.totalAmount, y.bObj.target));

  allQualTLs.forEach(({ pName, region, branch, bObj }, idx) => {
    const alt = idx % 2 === 1;
    const row = new Array(T2_LEN).fill(null);
    row[0] = numCell(idx + 1, alt);
    row[1] = agentCell(pName, alt);
    row[2] = agentCell(region, alt);
    row[3] = agentCell(branch, alt);
    row[4] = agentCell(bObj.tlName || '—', alt, true, true); // sep
    row[5] = numCell(bObj.target      ?? 0, alt);
    row[6] = numCell(bObj.totalAmount ?? 0, alt);
    row[7] = pctCell(bObj.totalAmount ?? 0, bObj.target ?? 0, alt);
    row[8] = parCell(bObj.tlPar30 ?? 0, alt);
    rows.push(row); rowHeights[rowIdx++] = 18;
  });

  for (let i = 0; i < 2; i++) {
    rows.push(new Array(T2_LEN).fill({ v: '', t: 's', s: { border: {} } }));
    rowHeights[rowIdx++] = 8;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TABLE 3 — QUALIFIED REGIONS / BRANCH MANAGERS
  // ════════════════════════════════════════════════════════════════════════════
  const T3_COLS   = ['#', 'PRODUCT', 'REGION',
    'REGION TARGET (TZS)', 'REGION ACTUAL (TZS)', '% ACHIEVED', 'PAR > 30'];
  const T3_LEN    = T3_COLS.length;
  const T3_WIDTHS = [5, 20, 28, 22, 22, 14, 12];

  rows.push(sectionHdr('QUALIFIED REGIONS / BRANCH MANAGERS', T3_LEN)); rowHeights[rowIdx] = 22;
  merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: T3_LEN - 1 } }); rowIdx++;

  // Super-header for T3
  {
    const sh = new Array(T3_LEN).fill(null);
    sh[0] = superHdrCell('IDENTITY', '1F3864');
    for (let i = 1; i <= 2; i++) sh[i] = blankSuper('1F3864');
    sh[2] = blankSuper('1F3864', true);
    sh[3] = superHdrCell('PERFORMANCE (Target vs Actual + PAR)', '166534');
    for (let i = 4; i < T3_LEN; i++) sh[i] = blankSuper('166534');
    rows.push(sh); rowHeights[rowIdx] = 18;
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: 2 } });
    merges.push({ s: { r: rowIdx, c: 3 }, e: { r: rowIdx, c: T3_LEN - 1 } });
    rowIdx++;
  }

  rows.push(T3_COLS.map((h, i) => hdrCell(h, i === 2)));
  rowHeights[rowIdx++] = 28;

  // ── collect ALL qualified regions, sort globally by % achieved ───────────────
  const allQualRegions = [];
  Object.entries(hierarchy).forEach(([product, pObj]) => {
    const pName = PRODUCT_LABELS[product] ?? product;
    Object.entries(pObj.regions).filter(([, r]) => r.regionQualified).forEach(([region, rObj]) => {
      allQualRegions.push({ pName, region, rObj });
    });
  });
  allQualRegions.sort((x, y) => cmpAchv(x.rObj.totalAmount, x.rObj.target, y.rObj.totalAmount, y.rObj.target));

  allQualRegions.forEach(({ pName, region, rObj }, idx) => {
    const alt = idx % 2 === 1;
    const row = new Array(T3_LEN).fill(null);
    row[0] = numCell(idx + 1, alt);
    row[1] = agentCell(pName, alt);
    row[2] = agentCell(region, alt, true, true); // sep
    row[3] = numCell(rObj.target      ?? 0, alt);
    row[4] = numCell(rObj.totalAmount ?? 0, alt);
    row[5] = pctCell(rObj.totalAmount ?? 0, rObj.target ?? 0, alt);
    row[6] = parCell(rObj.regionPar30 ?? 0, alt);
    rows.push(row); rowHeights[rowIdx++] = 18;
  });

  const ws = aoaToSheet(rows, T1_WIDTHS, rowHeights);
  ws['!merges'] = merges;
  ws['!freeze'] = { ySplit: 3 }; // section label + super-header + col header
  return ws;
}

// ── Sheet: Not Qualified ──────────────────────────────────────────────────────

function buildNotQualifiedSheet(hierarchy, monthsInData) {
  const months = monthsInData;

  const monthCols  = months.map((m) => m.slice(0, 3).toUpperCase());

  // Col groups (same structure as T1 in Qualified)
  const ID_END   = 4;
  const INFO_END = 8;
  const MONTH_S  = 9;
  const MONTH_E  = MONTH_S + months.length - 1;
  const RIGHT_S  = MONTH_S + months.length;

  const hdrRow = [
    '#', 'PRODUCT', 'REGION', 'BRANCH / TL', 'SALES REP.',
    'TITLE', 'CATEGORY', 'PERIOD JOINED', 'FLAG JOINED DATE',
    ...monthCols,
    'TOTAL LOANS', 'TOTAL AMOUNT (TZS)', 'TARGET (TZS)', '% ACHIEVED', 'REASON',
  ];
  const totalCols = hdrRow.length;

  const colWidths = [
    5, 20, 20, 26, 26, 18, 12, 16, 10,
    ...months.map(() => 22),
    10, 18, 18, 11, 42,
  ];

  const rows       = [];
  const rowHeights = {};
  const merges     = [];
  let rowIdx = 0;

  // ── Super-header ─────────────────────────────────────────────────────────────
  {
    const sh = new Array(totalCols).fill(null);
    const G1 = '1F3864', G2 = '2563EB', G3 = '155E75', G4 = '991B1B';
    sh[0] = superHdrCell('IDENTITY', G1);
    for (let i = 1; i < ID_END; i++) sh[i] = blankSuper(G1);
    sh[ID_END] = blankSuper(G1, true);
    sh[ID_END + 1] = superHdrCell('AGENT INFO', G2);
    for (let i = ID_END + 2; i < INFO_END; i++) sh[i] = blankSuper(G2);
    sh[INFO_END] = blankSuper(G2, true);
    sh[MONTH_S] = superHdrCell('MONTHLY DISBURSEMENT', G3);
    for (let i = MONTH_S + 1; i < MONTH_E; i++) sh[i] = blankSuper(G3);
    if (months.length > 0) sh[MONTH_E] = blankSuper(G3, true);
    sh[RIGHT_S] = superHdrCell('PERFORMANCE & REASON', G4);
    for (let i = RIGHT_S + 1; i < totalCols; i++) sh[i] = blankSuper(G4);

    rows.push(sh); rowHeights[rowIdx] = 18;
    if (ID_END > 0) merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: ID_END } });
    merges.push({ s: { r: rowIdx, c: ID_END + 1 }, e: { r: rowIdx, c: INFO_END } });
    if (months.length > 1) merges.push({ s: { r: rowIdx, c: MONTH_S }, e: { r: rowIdx, c: MONTH_E } });
    if (totalCols - RIGHT_S > 1) merges.push({ s: { r: rowIdx, c: RIGHT_S }, e: { r: rowIdx, c: totalCols - 1 } });
    rowIdx++;
  }

  // ── Column header ─────────────────────────────────────────────────────────────
  rows.push(hdrRow.map((h, i) => hdrCell(h, [ID_END, INFO_END, MONTH_E].includes(i))));
  rowHeights[rowIdx++] = 28;

  // ── collect ALL not-qualified agents, sort globally by % achieved ─────────────
  const allNotQual = [];
  Object.entries(hierarchy).forEach(([product, pObj]) => {
    const pName = PRODUCT_LABELS[product] ?? product;
    Object.entries(pObj.regions).forEach(([region, rObj]) => {
      Object.entries(rObj.branches).forEach(([branch, bObj]) => {
        bObj.agents.filter((a) => !a.qualified).forEach((agent) => {
          allNotQual.push({ pName, region, branch, agent });
        });
      });
    });
  });
  allNotQual.sort((x, y) => cmpAchv(x.agent.totalAmount, x.agent.target, y.agent.totalAmount, y.agent.target));

  allNotQual.forEach(({ pName, region, branch, agent }, idx) => {
    const alt = idx % 2 === 1;
    const row = new Array(totalCols).fill(null);
    row[0] = numCell(idx + 1, alt);
    row[1] = agentCell(pName, alt);
    row[2] = agentCell(region, alt);
    row[3] = agentCell(branch, alt);
    row[4] = agentCell(agent.repName, alt, true, true); // sep
    row[5] = agentCell(agent.title || agent.role || '—', alt);
    row[6] = agentCell(agent.flag === 'Yes' ? 'Old Agent' : 'New Agent', alt);
    row[7] = agentCell(agent.period || 'Unknown', alt);
    row[8] = agentCell(agent.flag || '—', alt, false, true); // sep
    months.forEach((m, mi) => {
      row[MONTH_S + mi] = monthCell(agent.monthly[m], alt, mi === months.length - 1);
    });
    row[RIGHT_S]     = numCell(agent.totalLoans,  alt);
    row[RIGHT_S + 1] = numCell(agent.totalAmount, alt);
    row[RIGHT_S + 2] = numCell(agent.target ?? 0, alt);
    row[RIGHT_S + 3] = pctCell(agent.totalAmount, agent.target ?? 0, alt);
    row[RIGHT_S + 4] = {
      v: agent.qualReason || '—', t: 's',
      s: { font: F(false, '9C0006', 9), fill: FILL(alt ? 'FEE2E2' : 'FFF5F5'), alignment: A('left', true), border: BORDER },
    };
    rows.push(row); rowHeights[rowIdx++] = 18;
  });

  const ws = aoaToSheet(rows, colWidths, rowHeights);
  ws['!merges'] = merges;
  ws['!freeze'] = { ySplit: 2 };
  return ws;
}

// ── Sheet: Summary ────────────────────────────────────────────────────────────

function buildSummarySheet(summary, monthsInData) {
  const {
    totalAgents, totalAmount, totalLoans,
    qualified, notQualified, qualifiedTLs, qualifiedRegions,
    oldAgents, newAgents, byProduct,
  } = summary;
  const generated = new Date().toLocaleString('en-GB');

  const mk = (v, bold = false, bg = 'FFFFFF', fg = '1A1A2E', align = 'left', sz = 9, numFmt = null) => ({
    v: v ?? '', t: typeof v === 'number' ? 'n' : 's',
    s: { font: F(bold, fg, sz), fill: FILL(bg), alignment: A(align), border: BORDER, ...(numFmt ? { numFmt } : {}) },
  });

  const HDR = PAL.headerBg; const HDR_FG = PAL.headerFg; const SUB = 'F3F4F6';

  const productRows = ['CS', 'LBF', 'SME'].filter((p) => byProduct[p]).map((p, i) => {
    const b  = byProduct[p];
    const bg = i % 2 === 0 ? SUB : 'FFFFFF';
    const pct = b.target > 0 ? Math.round((b.totalAmount / b.target) * 100) : 0;
    return [
      mk(PRODUCT_LABELS[p] ?? p, false, bg, '1A1A2E', 'left'),
      mk(b.agents,      false, bg, '1A1A2E', 'right'),
      mk(b.qualified,   false, bg, b.qualified > 0 ? '166534' : '9C0006', 'right'),
      mk(b.totalAmount, false, bg, '1A1A2E', 'right', 9, '#,##0'),
      mk(b.target,      false, bg, '1A1A2E', 'right', 9, '#,##0'),
      mk(pct,           true,  bg, pct >= 100 ? '166534' : pct >= 75 ? 'B45309' : '9C0006', 'right', 9, '0"%"'),
    ];
  });

  const rows = [
    [mk('EA TEAM BUILDING REPORT — ALL PCL STAFF (KE & UG)', true, HDR, HDR_FG, 'left', 12), mk('',false,HDR), mk('',false,HDR), mk('',false,HDR), mk('',false,HDR), mk('',false,HDR)],
    [mk(`Generated: ${generated}`, false, SUB, '6B7280', 'left', 8), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB)],
    [mk(''), mk(''), mk(''), mk(''), mk(''), mk('')],

    [mk('OVERALL METRICS', true, HDR, HDR_FG), mk('',false,HDR), mk('',false,HDR), mk('',false,HDR), mk('',false,HDR), mk('',false,HDR)],
    [mk('Total Active Agents',        false, SUB), mk(totalAgents,      true, SUB, '1A1A2E', 'right'), mk(''), mk(''), mk(''), mk('')],
    [mk('Qualified Sales Reps',       false, SUB), mk(qualified,        true, SUB, '166534', 'right'), mk(''), mk(''), mk(''), mk('')],
    [mk('Not Qualified Reps',         false, SUB), mk(notQualified,     true, SUB, '9C0006', 'right'), mk(''), mk(''), mk(''), mk('')],
    [mk('Qualified Team Leaders',     false, SUB), mk(qualifiedTLs ?? 0,true, SUB, '166534', 'right'), mk(''), mk(''), mk(''), mk('')],
    [mk('Qualified Regions / BMs',    false, SUB), mk(qualifiedRegions ?? 0, true, SUB, '166534', 'right'), mk(''), mk(''), mk(''), mk('')],
    [mk('Total Disbursed (TZS)',       false, SUB), mk(totalAmount,      true, SUB, '1A1A2E', 'right', 9, '#,##0'), mk(''), mk(''), mk(''), mk('')],
    [mk('Total Loans',                false, SUB), mk(totalLoans,       true, SUB, '1A1A2E', 'right'), mk(''), mk(''), mk(''), mk('')],
    [mk('Old Agents (before 2026)',   false, SUB), mk(oldAgents,        true, SUB, '1A1A2E', 'right'), mk(''), mk(''), mk(''), mk('')],
    [mk('New Agents (Jan–Apr 2026)',  false, SUB), mk(newAgents,        true, SUB, '1A1A2E', 'right'), mk(''), mk(''), mk(''), mk('')],
    [mk('Months Covered',            false, SUB), mk(monthsInData.join(', '), false, SUB), mk(''), mk(''), mk(''), mk('')],
    [mk(''), mk(''), mk(''), mk(''), mk(''), mk('')],

    [
      mk('PRODUCT',        true, HDR, HDR_FG, 'left'),
      mk('AGENTS',         true, HDR, HDR_FG, 'right'),
      mk('QUALIFIED REPS', true, HDR, HDR_FG, 'right'),
      mk('TOTAL DISBURSED',true, HDR, HDR_FG, 'right'),
      mk('TARGET (TZS)',   true, HDR, HDR_FG, 'right'),
      mk('% ACHIEVED',     true, HDR, HDR_FG, 'right'),
    ],
    ...productRows,
  ];

  const ws = aoaToSheet(rows, [38, 18, 18, 20, 20, 14]);
  ws['!rows']   = rows.map((_, i) => ({ hpx: i === 0 ? 28 : 18 }));
  ws['!freeze'] = { ySplit: 1 };
  return ws;
}

// ── Sheet: Criteria ───────────────────────────────────────────────────────────

function buildCriteriaSheet() {
  const rows       = [];
  const merges     = [];
  const rowHeights = {};
  let rowIdx = 0;

  const COLS   = 7;
  const HDR    = '1F3864';
  const HDR_FG = 'FFFFFF';
  const SUB    = 'F3F4F6';
  const BLU    = 'DBEAFE';
  const BLU_FG = '1E3A5F';
  const OLD_BG = 'DBEAFE'; const OLD_FG = '1E3A5F'; // Old agents — blue
  const NEW_BG = 'DCFCE7'; const NEW_FG = '166534'; // New agents — green
  const TL_BG  = 'FEF3C7'; const TL_FG  = '92400E'; // Team Leaders — yellow
  const RG_BG  = 'FED7AA'; const RG_FG  = '9A3412'; // Regions/BMs — amber

  const cell = (v, bold, bg, fg, align = 'left', sz = 9, wrap = false) => ({
    v: v ?? '', t: 's',
    s: { font: F(bold, fg, sz), fill: FILL(bg), alignment: A(align, wrap, 'center'), border: BORDER },
  });
  const blank = (bg) => ({ v: '', t: 's', s: { fill: FILL(bg), border: BORDER } });
  const fullRow = (v, bold, bg, fg, sz = 9) => {
    const r = [cell(v, bold, bg, fg, 'center', sz), ...Array(COLS - 1).fill(blank(bg))];
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: COLS - 1 } });
    return r;
  };

  // ── Title ───────────────────────────────────────────────────────────────────
  rows.push(fullRow('EA TEAM BUILDING QUALIFICATION CRITERIA — 2026', true, HDR, HDR_FG, 13));
  rowHeights[rowIdx++] = 34;

  rows.push(fullRow('Effective: January – April 2026  |  Thresholds are CUMULATIVE (monthly value × number of months)', false, BLU, BLU_FG, 9));
  rowHeights[rowIdx++] = 20;

  rows.push(Array(COLS).fill({ v: '', t: 's', s: { fill: FILL('FFFFFF'), border: {} } }));
  rowHeights[rowIdx++] = 8;

  // ── Column headers ──────────────────────────────────────────────────────────
  const hdrs = ['PRODUCT', 'LEVEL', 'CATEGORY', 'ZONE / NOTES', 'MIN LOANS / MONTH', 'MIN DISBURSEMENT / MONTH', 'OTHER CONDITION'];
  rows.push(hdrs.map((h) => hdrCell(h)));
  rowHeights[rowIdx++] = 28;

  // ── Data rows ───────────────────────────────────────────────────────────────
  const dataRows = [
    // product, level,           category,    zone,       minLoans,          minDisb,                   other
    ['LBF', 'Agent',        'Old Agent', '—',        '≥ 4 loans / month', '≥ TZS 20,000,000 / month', '—',        OLD_BG, OLD_FG],
    ['LBF', 'Agent',        'New Agent', '—',        '≥ 3 loans / month', '≥ TZS 15,000,000 / month', '—',        NEW_BG, NEW_FG],
    ['LBF', 'Team Leader',  'All',       '—',        '—',                 '—',                         '≥ 130% cumulative sales target  AND  PAR > 30 ≤ 4%', TL_BG, TL_FG],
    ['CS',  'Agent',        'Old Agent', 'Mainland', '≥ 4 loans / month', '≥ TZS 10,000,000 / month', '—',        OLD_BG, OLD_FG],
    ['CS',  'Agent',        'Old Agent', 'Zanzibar', '≥ 4 loans / month', '≥ TZS 20,000,000 / month', '—',        OLD_BG, OLD_FG],
    ['CS',  'Agent',        'New Agent', 'Mainland', '≥ 3 loans / month', '≥ TZS 7,500,000 / month',  '—',        NEW_BG, NEW_FG],
    ['CS',  'Agent',        'New Agent', 'Zanzibar', '≥ 3 loans / month', '≥ TZS 15,000,000 / month', '—',        NEW_BG, NEW_FG],
    ['CS',  'Team Leader',  'All',       'TZ Mainland', '—',              '—',                         '≥ 150% cumulative sales target  AND  PAR > 30 ≤ 4%', TL_BG, TL_FG],
    ['CS',  'Team Leader',  'All',       'Zanzibar',    '—',              '—',                         '≥ 130% cumulative sales target  AND  PAR > 30 ≤ 4%', TL_BG, TL_FG],
    ['SME & AGRI', 'Agent', 'All',       '—',        '≥ 4 loans / month', '≥ TZS 8,000,000 / month',  'Cumulative 32 loans (4 × 8 mo)', OLD_BG, OLD_FG],
    ['SME & AGRI', 'Team Leader / BM / Sr Loan Officer', 'All', '—', '—', '—',                        '≥ 120% cumulative sales target  AND  PAR > 30 ≤ 4%', TL_BG, TL_FG],
    ['LBF', 'Region / BM',  'All',       '—',        '—',                 '—',                         '≥ 130% cumulative sales target  AND  PAR > 30 ≤ 4%', RG_BG, RG_FG],
    ['CS',  'Region / BM',  'All',       'TZ Mainland', '—',              '—',                         '≥ 150% cumulative sales target  AND  PAR > 30 ≤ 4%', RG_BG, RG_FG],
    ['CS',  'Region / BM',  'All',       'Zanzibar',    '—',              '—',                         '≥ 130% cumulative sales target  AND  PAR > 30 ≤ 4%', RG_BG, RG_FG],
    ['SME & AGRI', 'Region / BM', 'All', '—',        '—',                 '—',                         '≥ 120% cumulative sales target  AND  PAR > 30 ≤ 4%', RG_BG, RG_FG],
  ];

  dataRows.forEach(([p, lvl, cat, zone, loans, disb, other, bg, fg]) => {
    rows.push([
      cell(p,     true,  bg, fg, 'center'),
      cell(lvl,   false, bg, fg, 'left'),
      cell(cat,   false, bg, fg, 'left'),
      cell(zone,  false, bg, fg, 'left'),
      cell(loans, false, bg, fg, 'center'),
      cell(disb,  true,  bg, fg, 'center'),
      cell(other, false, bg, fg, 'left', 9, true),
    ]);
    rowHeights[rowIdx++] = 20;
  });

  const ws = aoaToSheet(rows, [8, 16, 14, 14, 22, 26, 52], rowHeights);
  ws['!merges'] = merges;
  ws['!freeze'] = { ySplit: 4 };
  return ws;
}

// ── public API ────────────────────────────────────────────────────────────────

export function downloadEATeamBuildingReport(processedData) {
  const { hierarchy, monthsInData, summary } = processedData;
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, buildSummarySheet(summary, monthsInData),        'Summary');
  XLSXStyle.utils.book_append_sheet(wb, buildAllAgentsSheet(hierarchy, monthsInData),    'All Agents');
  XLSXStyle.utils.book_append_sheet(wb, buildQualifiedSheet(hierarchy, monthsInData),    'Qualified');
  XLSXStyle.utils.book_append_sheet(wb, buildNotQualifiedSheet(hierarchy, monthsInData), 'Not Qualified');
  XLSXStyle.utils.book_append_sheet(wb, buildCriteriaSheet(),                            'Criteria');
  XLSXStyle.writeFile(wb, `EA_Team_Building_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
}

export function buildEATeamBuildingReportBuffer(processedData) {
  const { hierarchy, monthsInData, summary } = processedData;
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, buildSummarySheet(summary, monthsInData),        'Summary');
  XLSXStyle.utils.book_append_sheet(wb, buildAllAgentsSheet(hierarchy, monthsInData),    'All Agents');
  XLSXStyle.utils.book_append_sheet(wb, buildQualifiedSheet(hierarchy, monthsInData),    'Qualified');
  XLSXStyle.utils.book_append_sheet(wb, buildNotQualifiedSheet(hierarchy, monthsInData), 'Not Qualified');
  XLSXStyle.utils.book_append_sheet(wb, buildCriteriaSheet(),                            'Criteria');
  const date     = new Date().toISOString().slice(0, 10);
  const fileName = `EA_Team_Building_Report_${date}.xlsx`;
  const buffer   = XLSXStyle.write(wb, { bookType: 'xlsx', type: 'array' });
  return { buffer: new Uint8Array(buffer), fileName };
}

export function bufferToBase64(uint8) {
  let bin = '';
  for (let i = 0; i < uint8.length; i++) bin += String.fromCharCode(uint8[i]);
  return window.btoa(bin);
}

export function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const tzsFmt = (v) => Math.round(v ?? 0).toLocaleString();
