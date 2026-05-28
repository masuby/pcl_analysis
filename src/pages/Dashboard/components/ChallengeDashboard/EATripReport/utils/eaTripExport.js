/**
 * EA Trip Report — Excel Export
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
  // EA TRIP is for SALES MANAGERS only. Per the memo:
  //   LBF → Branch Managers (branch level)
  //   CS  → Regional Managers (region level)
  //   SME → Regional Manager  (region level)
  // We do NOT list individual sales reps here.

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
  // TABLE A — QUALIFIED LBF BRANCH MANAGERS (branch level)
  // ════════════════════════════════════════════════════════════════════════════
  const T2_COLS   = ['#', 'PRODUCT', 'REGION', 'BRANCH / TL', 'BRANCH MANAGER',
    'BRANCH TARGET (TZS)', 'BRANCH ACTUAL (TZS)', '% ACHIEVED', 'PAR > 30'];
  const T2_LEN    = T2_COLS.length;
  const T2_WIDTHS = [5, 20, 22, 28, 24, 20, 20, 13, 12];

  rows.push(sectionHdr('QUALIFIED LBF BRANCH MANAGERS', T2_LEN)); rowHeights[rowIdx] = 22;
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

  // Collect qualified LBF branches only (per memo: LBF → Branch Managers)
  const allQualTLs = [];
  if (hierarchy.LBF) {
    Object.entries(hierarchy.LBF.regions).forEach(([region, rObj]) => {
      Object.entries(rObj.branches).filter(([, b]) => b.tlQualified).forEach(([branch, bObj]) => {
        allQualTLs.push({ pName: PRODUCT_LABELS.LBF, region, branch, bObj });
      });
    });
  }
  allQualTLs.sort((x, y) => cmpAchv(x.bObj.totalAmount, x.bObj.target, y.bObj.totalAmount, y.bObj.target));

  if (!allQualTLs.length) {
    const noneRow = new Array(T2_LEN).fill(null);
    noneRow[0] = agentCell('No LBF Branch Managers qualified yet.', false, false, false);
    rows.push(noneRow);
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: T2_LEN - 1 } });
    rowHeights[rowIdx++] = 22;
  } else {
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
  }

  // spacers
  for (let i = 0; i < 2; i++) {
    rows.push(new Array(T2_LEN).fill({ v: '', t: 's', s: { border: {} } }));
    rowHeights[rowIdx++] = 8;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TABLE B — QUALIFIED CS / SME REGIONAL MANAGERS (region level)
  // ════════════════════════════════════════════════════════════════════════════
  const T3_COLS   = ['#', 'PRODUCT', 'REGION', 'ZONE',
    'REGION TARGET (TZS)', 'REGION ACTUAL (TZS)', '% ACHIEVED', 'PAR > 30'];
  const T3_LEN    = T3_COLS.length;

  rows.push(sectionHdr('QUALIFIED CS / SME REGIONAL MANAGERS', T3_LEN)); rowHeights[rowIdx] = 22;
  merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: T3_LEN - 1 } }); rowIdx++;

  // Super-header for T3
  {
    const sh = new Array(T3_LEN).fill(null);
    sh[0] = superHdrCell('IDENTITY', '1F3864');
    for (let i = 1; i <= 3; i++) sh[i] = blankSuper('1F3864');
    sh[3] = blankSuper('1F3864', true);
    sh[4] = superHdrCell('PERFORMANCE (Target vs Actual + PAR)', '166534');
    for (let i = 5; i < T3_LEN; i++) sh[i] = blankSuper('166534');
    rows.push(sh); rowHeights[rowIdx] = 18;
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: 3 } });
    merges.push({ s: { r: rowIdx, c: 4 }, e: { r: rowIdx, c: T3_LEN - 1 } });
    rowIdx++;
  }

  rows.push(T3_COLS.map((h, i) => hdrCell(h, i === 3)));
  rowHeights[rowIdx++] = 28;

  // Collect qualified CS + SME regions only (per memo)
  const allQualRegions = [];
  ['CS', 'SME'].forEach((p) => {
    const pObj = hierarchy[p];
    if (!pObj) return;
    const pName = PRODUCT_LABELS[p] ?? p;
    Object.entries(pObj.regions).filter(([, r]) => r.regionQualified).forEach(([region, rObj]) => {
      const zone = /zanzibar/i.test(region) ? 'Zanzibar' : 'TZ Mainland';
      allQualRegions.push({ pName, region, zone, rObj });
    });
  });
  allQualRegions.sort((x, y) => cmpAchv(x.rObj.totalAmount, x.rObj.target, y.rObj.totalAmount, y.rObj.target));

  if (!allQualRegions.length) {
    const noneRow = new Array(T3_LEN).fill(null);
    noneRow[0] = agentCell('No CS / SME Regional Managers qualified yet.', false, false, false);
    rows.push(noneRow);
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: T3_LEN - 1 } });
    rowHeights[rowIdx++] = 22;
  } else {
    allQualRegions.forEach(({ pName, region, zone, rObj }, idx) => {
      const alt = idx % 2 === 1;
      const row = new Array(T3_LEN).fill(null);
      row[0] = numCell(idx + 1, alt);
      row[1] = agentCell(pName, alt);
      row[2] = agentCell(region, alt);
      row[3] = agentCell(zone, alt, true, true);
      row[4] = numCell(rObj.target      ?? 0, alt);
      row[5] = numCell(rObj.totalAmount ?? 0, alt);
      row[6] = pctCell(rObj.totalAmount ?? 0, rObj.target ?? 0, alt);
      row[7] = parCell(rObj.regionPar30 ?? 0, alt);
      rows.push(row); rowHeights[rowIdx++] = 18;
    });
  }

  const ws = aoaToSheet(rows, T2_WIDTHS, rowHeights);
  ws['!merges'] = merges;
  ws['!freeze'] = { ySplit: 3 }; // section label + super-header + col header
  return ws;
}

// ── Sheet: Not Qualified ──────────────────────────────────────────────────────

function buildNotQualifiedSheet(hierarchy /* , monthsInData */) {
  // EA TRIP Not Qualified — MANAGERS ONLY per the memo:
  //   LBF Branch Managers (branch level) + CS / SME Regional Managers (region).

  const rows       = [];
  const rowHeights = {};
  const merges     = [];
  let rowIdx = 0;

  const sectionHdr = (title, cols, bg = 'FEE2E2', fg = '991B1B') => {
    const row = [];
    row.push({
      v: title, t: 's',
      s: { font: F(true, fg, 11), fill: FILL(bg), alignment: A('left', false, 'center'), border: BORDER },
    });
    for (let i = 1; i < cols; i++) row.push({ v: '', t: 's', s: { fill: FILL(bg), border: BORDER } });
    return row;
  };

  // ── TABLE A: LBF Branch Managers that did NOT qualify ──────────────────────
  const A_COLS    = ['#', 'PRODUCT', 'REGION', 'BRANCH / TL', 'BRANCH MANAGER',
    'BRANCH TARGET (TZS)', 'BRANCH ACTUAL (TZS)', '% ACHIEVED', 'PAR > 30', 'REASON'];
  const A_LEN     = A_COLS.length;
  const A_WIDTHS  = [5, 20, 22, 28, 24, 20, 20, 13, 12, 44];

  rows.push(sectionHdr('NOT-QUALIFIED LBF BRANCH MANAGERS', A_LEN));
  merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: A_LEN - 1 } });
  rowHeights[rowIdx++] = 22;

  // super-header
  {
    const sh = new Array(A_LEN).fill(null);
    sh[0] = superHdrCell('IDENTITY', '1F3864');
    for (let i = 1; i <= 4; i++) sh[i] = blankSuper('1F3864');
    sh[4] = blankSuper('1F3864', true);
    sh[5] = superHdrCell('PERFORMANCE & REASON', '991B1B');
    for (let i = 6; i < A_LEN; i++) sh[i] = blankSuper('991B1B');
    rows.push(sh);
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: 4 } });
    merges.push({ s: { r: rowIdx, c: 5 }, e: { r: rowIdx, c: A_LEN - 1 } });
    rowHeights[rowIdx++] = 18;
  }
  rows.push(A_COLS.map((h, i) => hdrCell(h, i === 4)));
  rowHeights[rowIdx++] = 28;

  const lbfNotQual = [];
  if (hierarchy.LBF) {
    Object.entries(hierarchy.LBF.regions).forEach(([region, rObj]) => {
      Object.entries(rObj.branches).filter(([, b]) => !b.tlQualified).forEach(([branch, bObj]) => {
        lbfNotQual.push({ pName: PRODUCT_LABELS.LBF, region, branch, bObj });
      });
    });
  }
  lbfNotQual.sort((x, y) => cmpAchv(x.bObj.totalAmount, x.bObj.target, y.bObj.totalAmount, y.bObj.target));

  if (!lbfNotQual.length) {
    const noneRow = new Array(A_LEN).fill(null);
    noneRow[0] = agentCell('No LBF Branch Managers in the data (or all qualified).', false, false, false);
    rows.push(noneRow);
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: A_LEN - 1 } });
    rowHeights[rowIdx++] = 22;
  } else {
    lbfNotQual.forEach(({ pName, region, branch, bObj }, idx) => {
      const alt = idx % 2 === 1;
      const row = new Array(A_LEN).fill(null);
      row[0] = numCell(idx + 1, alt);
      row[1] = agentCell(pName, alt);
      row[2] = agentCell(region, alt);
      row[3] = agentCell(branch, alt);
      row[4] = agentCell(bObj.tlName || '—', alt, true, true);
      row[5] = numCell(bObj.target      ?? 0, alt);
      row[6] = numCell(bObj.totalAmount ?? 0, alt);
      row[7] = pctCell(bObj.totalAmount ?? 0, bObj.target ?? 0, alt);
      row[8] = parCell(bObj.tlPar30 ?? 0, alt);
      row[9] = {
        v: bObj.tlReason || '—', t: 's',
        s: { font: F(false, '9C0006', 9), fill: FILL(alt ? 'FEE2E2' : 'FFF5F5'), alignment: A('left', true), border: BORDER },
      };
      rows.push(row); rowHeights[rowIdx++] = 18;
    });
  }

  // spacer
  for (let i = 0; i < 2; i++) {
    rows.push(new Array(A_LEN).fill({ v: '', t: 's', s: { border: {} } }));
    rowHeights[rowIdx++] = 8;
  }

  // ── TABLE B: CS / SME Regional Managers that did NOT qualify ───────────────
  const B_COLS    = ['#', 'PRODUCT', 'REGION', 'ZONE',
    'REGION TARGET (TZS)', 'REGION ACTUAL (TZS)', '% ACHIEVED', 'PAR > 30', 'REASON'];
  const B_LEN     = B_COLS.length;

  rows.push(sectionHdr('NOT-QUALIFIED CS / SME REGIONAL MANAGERS', B_LEN));
  merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: B_LEN - 1 } });
  rowHeights[rowIdx++] = 22;

  {
    const sh = new Array(B_LEN).fill(null);
    sh[0] = superHdrCell('IDENTITY', '1F3864');
    for (let i = 1; i <= 3; i++) sh[i] = blankSuper('1F3864');
    sh[3] = blankSuper('1F3864', true);
    sh[4] = superHdrCell('PERFORMANCE & REASON', '991B1B');
    for (let i = 5; i < B_LEN; i++) sh[i] = blankSuper('991B1B');
    rows.push(sh);
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: 3 } });
    merges.push({ s: { r: rowIdx, c: 4 }, e: { r: rowIdx, c: B_LEN - 1 } });
    rowHeights[rowIdx++] = 18;
  }
  rows.push(B_COLS.map((h, i) => hdrCell(h, i === 3)));
  rowHeights[rowIdx++] = 28;

  const csmeNotQual = [];
  ['CS', 'SME'].forEach((p) => {
    const pObj = hierarchy[p];
    if (!pObj) return;
    const pName = PRODUCT_LABELS[p] ?? p;
    Object.entries(pObj.regions).filter(([, r]) => !r.regionQualified).forEach(([region, rObj]) => {
      const zone = /zanzibar/i.test(region) ? 'Zanzibar' : 'TZ Mainland';
      csmeNotQual.push({ pName, region, zone, rObj });
    });
  });
  csmeNotQual.sort((x, y) => cmpAchv(x.rObj.totalAmount, x.rObj.target, y.rObj.totalAmount, y.rObj.target));

  if (!csmeNotQual.length) {
    const noneRow = new Array(B_LEN).fill(null);
    noneRow[0] = agentCell('No CS / SME Regional Managers in the data (or all qualified).', false, false, false);
    rows.push(noneRow);
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: B_LEN - 1 } });
    rowHeights[rowIdx++] = 22;
  } else {
    csmeNotQual.forEach(({ pName, region, zone, rObj }, idx) => {
      const alt = idx % 2 === 1;
      const row = new Array(B_LEN).fill(null);
      row[0] = numCell(idx + 1, alt);
      row[1] = agentCell(pName, alt);
      row[2] = agentCell(region, alt);
      row[3] = agentCell(zone, alt, true, true);
      row[4] = numCell(rObj.target      ?? 0, alt);
      row[5] = numCell(rObj.totalAmount ?? 0, alt);
      row[6] = pctCell(rObj.totalAmount ?? 0, rObj.target ?? 0, alt);
      row[7] = parCell(rObj.regionPar30 ?? 0, alt);
      row[8] = {
        v: rObj.regionReason || '—', t: 's',
        s: { font: F(false, '9C0006', 9), fill: FILL(alt ? 'FEE2E2' : 'FFF5F5'), alignment: A('left', true), border: BORDER },
      };
      rows.push(row); rowHeights[rowIdx++] = 18;
    });
  }

  const ws = aoaToSheet(rows, A_WIDTHS, rowHeights);
  ws['!merges'] = merges;
  ws['!freeze'] = { ySplit: 3 };
  return ws;
}

// ── Sheet: Summary ────────────────────────────────────────────────────────────

function buildSummarySheet(summary, monthsInData) {
  const {
    totalAmount, totalLoans,
    totalManagers = 0, qualifiedManagers = 0,
    lbfMgrs = { total: 0, qualified: 0 },
    csMgrs  = { total: 0, qualified: 0 },
    smeMgrs = { total: 0, qualified: 0 },
    byProduct,
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
    [mk('EA TRIP QUALIFICATION REPORT — SALES MANAGERS', true, HDR, HDR_FG, 'left', 12), mk('',false,HDR), mk('',false,HDR), mk('',false,HDR), mk('',false,HDR), mk('',false,HDR)],
    [mk(`Generated: ${generated}`, false, SUB, '6B7280', 'left', 8), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB)],
    [mk(''), mk(''), mk(''), mk(''), mk(''), mk('')],

    [mk('EA TRIP MANAGER QUALIFICATION (per memo)', true, HDR, HDR_FG), mk('',false,HDR), mk('',false,HDR), mk('',false,HDR), mk('',false,HDR), mk('',false,HDR)],
    [mk('Total Managers',                            false, SUB), mk(totalManagers,         true, SUB, '1A1A2E', 'right'), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB)],
    [mk('Qualified Managers',                        false, SUB), mk(qualifiedManagers,     true, SUB, '166534', 'right'), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB)],
    [mk('LBF Branch Managers (qualified / total)',   false, SUB), mk(`${lbfMgrs.qualified} / ${lbfMgrs.total}`, true, SUB, lbfMgrs.qualified > 0 ? '166534' : '6B7280', 'right'), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB)],
    [mk('CS Regional Managers (qualified / total)',  false, SUB), mk(`${csMgrs.qualified} / ${csMgrs.total}`,   true, SUB, csMgrs.qualified  > 0 ? '166534' : '6B7280', 'right'), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB)],
    [mk('SME Regional Manager (qualified / total)',  false, SUB), mk(`${smeMgrs.qualified} / ${smeMgrs.total}`, true, SUB, smeMgrs.qualified > 0 ? '166534' : '6B7280', 'right'), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB)],
    [mk('Total Disbursed (TZS)',                     false, SUB), mk(totalAmount,           true, SUB, '1A1A2E', 'right', 9, '#,##0'), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB)],
    [mk('Total Loans',                               false, SUB), mk(totalLoans,            true, SUB, '1A1A2E', 'right'), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB)],
    [mk('Months Covered',                            false, SUB), mk(monthsInData.join(', '), false, SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB), mk('',false,SUB)],
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

// ─────────────────────────────────────────────────────────────────────────────
// EA TRIP criteria sheet — MIRRORS the spec file (EATrip_Criteria_2026.xlsx).
// Per memo: this trip is for SALES MANAGERS only. No agent-level rows.
// ─────────────────────────────────────────────────────────────────────────────
function buildCriteriaSheet() {
  const rows       = [];
  const merges     = [];
  const rowHeights = {};
  let rowIdx = 0;

  const COLS   = 3;
  const HDR    = '1F3864';
  const HDR_FG = 'FFFFFF';
  const BLU    = 'DBEAFE';
  const BLU_FG = '1E3A5F';
  const LBF_BG = 'BDD7EE'; const LBF_FG = '1E3A5F';
  const CS_BG  = 'C6EFCE'; const CS_FG  = '276221';
  const SME_BG = 'FCE4D6'; const SME_FG = '7F2B0E';
  const NOTE_BG= 'FFFBEB'; const NOTE_FG= '92400E';

  const cell = (v, bold, bg, fg, align = 'left', sz = 9, wrap = true) => ({
    v: v ?? '', t: 's',
    s: { font: F(bold, fg, sz), fill: FILL(bg), alignment: A(align, wrap, 'center'), border: BORDER },
  });
  const blank = (bg) => ({ v: '', t: 's', s: { fill: FILL(bg), border: BORDER } });
  const fullRow = (v, bold, bg, fg, sz = 9, align = 'center') => {
    const r = [cell(v, bold, bg, fg, align, sz, true), ...Array(COLS - 1).fill(blank(bg))];
    merges.push({ s: { r: rowIdx, c: 0 }, e: { r: rowIdx, c: COLS - 1 } });
    return r;
  };

  // ── Title ───────────────────────────────────────────────────────────────────
  rows.push(fullRow('EAST AFRICA TRIP QUALIFICATION CRITERIA — 2026', true, HDR, HDR_FG, 13));
  rowHeights[rowIdx++] = 34;

  rows.push(fullRow('Audience: SALES MANAGERS  •  Source: EAST AFRICA TRIP memo (PCL Tanzania)', false, BLU, BLU_FG, 10));
  rowHeights[rowIdx++] = 22;

  // ── Column headers ──────────────────────────────────────────────────────────
  rows.push([hdrCell('PRODUCT'), hdrCell('ROLE'), hdrCell('CRITERIA')]);
  rowHeights[rowIdx++] = 26;

  // ── Manager-only data rows (exact mirror of spec) ───────────────────────────
  const dataRows = [
    ['LBF', 'Branch Managers & Call Center Supervisor',
      '• Achieve 130% of your cumulative sales targets YTD\n• Achieve 130% of your loan counts\n• PAR 30 ≤ 4%',
      LBF_BG, LBF_FG],
    ['CS', 'Regional Managers (Tanzania Mainland)',
      'For Tanzania Mainland:\n• Achieve 150% of your cumulative sales targets YTD\n• Achieve 130% of your loan counts\n• PAR 30 ≤ 4%',
      CS_BG, CS_FG],
    ['', 'Regional Managers (Zanzibar)',
      'For Zanzibar:\n• Achieve 130% of your cumulative sale target YTD\n• Achieve 130% of your loan counts\n• PAR 30 ≤ 4%',
      CS_BG, CS_FG],
    ['SME', 'Regional Manager',
      '• Achieve 120% of your cumulative sales target YTD\n• PAR 30 ≤ 4%',
      SME_BG, SME_FG],
  ];

  dataRows.forEach(([p, role, crit, bg, fg]) => {
    rows.push([
      cell(p,    true,  bg, fg, 'center'),
      cell(role, true,  bg, fg, 'left'),
      cell(crit, false, bg, fg, 'left'),
    ]);
    // Multi-line criteria need taller rows
    const lines = String(crit).split('\n').length;
    rowHeights[rowIdx++] = Math.max(22, 18 * lines);
  });

  // ── NOTE block ─────────────────────────────────────────────────────────────
  rows.push(fullRow('NOTE', true, NOTE_BG, NOTE_FG, 10, 'left'));
  rowHeights[rowIdx++] = 22;

  const notes = [
    '• All staff & agents must have at least 3 months of work.',
    '• Qualification will also depend on the overall company performance.',
    '• The qualification selection is subject to review at the Management’s discretion.',
  ];
  notes.forEach((n) => {
    rows.push(fullRow(n, false, NOTE_BG, NOTE_FG, 9, 'left'));
    rowHeights[rowIdx++] = 22;
  });

  const ws = aoaToSheet(rows, [12, 38, 80], rowHeights);
  ws['!merges'] = merges;
  ws['!freeze'] = { ySplit: 3 };
  return ws;
}

// ── public API ────────────────────────────────────────────────────────────────

export function downloadEATripReport(processedData) {
  const { hierarchy, monthsInData, summary } = processedData;
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, buildSummarySheet(summary, monthsInData),        'Summary');
  XLSXStyle.utils.book_append_sheet(wb, buildAllAgentsSheet(hierarchy, monthsInData),    'All Agents');
  XLSXStyle.utils.book_append_sheet(wb, buildQualifiedSheet(hierarchy, monthsInData),    'Qualified');
  XLSXStyle.utils.book_append_sheet(wb, buildNotQualifiedSheet(hierarchy, monthsInData), 'Not Qualified');
  XLSXStyle.utils.book_append_sheet(wb, buildCriteriaSheet(),                            'Criteria');
  XLSXStyle.writeFile(wb, `EA_Trip_Report_${new Date().toISOString().slice(0,10)}.xlsx`);
}

export function buildEATripReportBuffer(processedData) {
  const { hierarchy, monthsInData, summary } = processedData;
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, buildSummarySheet(summary, monthsInData),        'Summary');
  XLSXStyle.utils.book_append_sheet(wb, buildAllAgentsSheet(hierarchy, monthsInData),    'All Agents');
  XLSXStyle.utils.book_append_sheet(wb, buildQualifiedSheet(hierarchy, monthsInData),    'Qualified');
  XLSXStyle.utils.book_append_sheet(wb, buildNotQualifiedSheet(hierarchy, monthsInData), 'Not Qualified');
  XLSXStyle.utils.book_append_sheet(wb, buildCriteriaSheet(),                            'Criteria');
  const date     = new Date().toISOString().slice(0, 10);
  const fileName = `EA_Trip_Report_${date}.xlsx`;
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
