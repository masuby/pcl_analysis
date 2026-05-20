import ExcelJS from 'exceljs';

const SKY_BLUE_THEME = {
  banner: '0F172A',   // premium dark slate banner
  header: '1E3A8A',   // strong blue table headers
  soft: 'F8FAFC',     // clean neutral row tint
  softAlt: 'EEF2FF',  // gentle alternate blue tint
  accent: '1E3A8A',   // overall row accent
};

const PALETTE = {
  Total: SKY_BLUE_THEME,
  CS: SKY_BLUE_THEME,
  LBF: SKY_BLUE_THEME,
  SME: SKY_BLUE_THEME,
  Agrifinance: SKY_BLUE_THEME,
};

const TAB_COLORS = {
  Summary: '1E3A8A',
  CS: '1E3A8A',
  LBF: '1E3A8A',
  SME: '1E3A8A',
  Agrifinance: '1E3A8A',
};

const FONT_FAMILY = 'Malgun Gothic';
const BANNER_FONT = { name: FONT_FAMILY, size: 8, bold: true, color: { argb: 'FFFFFFFF' } };
const TABLE_TITLE_FONT = { name: FONT_FAMILY, size: 8, bold: true, color: { argb: 'FFFFFFFF' } };
const HEADER_FONT = { name: FONT_FAMILY, size: 8, bold: true, color: { argb: 'FFFFFFFF' } };
const BODY_FONT = { name: FONT_FAMILY, size: 8, color: { argb: 'FF0F172A' } };
const METRIC_FONT = { name: FONT_FAMILY, size: 8, bold: true, color: { argb: 'FF0F172A' } };
const OVERALL_FONT = { name: FONT_FAMILY, size: 8, bold: true, color: { argb: 'FFFFFFFF' } };

const CURRENCY_FORMAT = '#,##0';
const INT_FORMAT = '#,##0';
const PCT_FORMAT = '0.00%';
const PCT_CHANGE_FORMAT = '[Color10]+0.00%;[Red]-0.00%;0.00%';
const thinBorder = { style: 'thin', color: { argb: 'FFCBD5E1' } };
const OVERALL_ISSUED_FILL = 'D4A017'; // gold highlight for "Issued/Disbursed" rows

const paletteFor = (product) => PALETTE[product] || PALETTE.Total;
const solidFill = (color) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } });

const mergedBanner = (ws, row, colSpan, text, { fill, font, height }) => {
  for (let c = 1; c <= colSpan; c++) {
    const cell = ws.getCell(row, c);
    cell.fill = fill;
    cell.font = font;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
    cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
  }
  ws.getCell(row, 1).value = text;
  ws.mergeCells(row, 1, row, colSpan);
  if (height) ws.getRow(row).height = height;
};

const styleHeaderCell = (cell, palette) => {
  cell.fill = solidFill(palette.header);
  cell.font = HEADER_FONT;
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
};

const writeDataRow = ({ ws, row, colSpan, palette, rowIndex, label, values, total, numFmt, style }) => {
  const totalCol = colSpan;
  const alt = rowIndex % 2 === 0;

  const labelCell = ws.getCell(row, 1);
  labelCell.value = label;
  labelCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  labelCell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
  if (style === 'overall') {
    const isIssuedRow = /issued|disbursed/i.test(String(label || ''));
    const overallFill = isIssuedRow ? OVERALL_ISSUED_FILL : palette.accent;
    labelCell.font = OVERALL_FONT;
    labelCell.fill = solidFill(overallFill);
  } else {
    labelCell.font = METRIC_FONT;
    labelCell.fill = solidFill(palette.soft);
  }

  for (let i = 0; i < values.length; i++) {
    const cell = ws.getCell(row, 2 + i);
    cell.value = values[i];
    cell.numFmt = numFmt;
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
    cell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
    if (style === 'overall') {
      const isIssuedRow = /issued|disbursed/i.test(String(label || ''));
      const overallFill = isIssuedRow ? OVERALL_ISSUED_FILL : palette.accent;
      cell.font = OVERALL_FONT;
      cell.fill = solidFill(overallFill);
    } else {
      cell.font = BODY_FONT;
      if (alt) cell.fill = solidFill(palette.softAlt);
    }
  }

  const tcell = ws.getCell(row, totalCol);
  tcell.value = total;
  tcell.numFmt = numFmt;
  tcell.alignment = { horizontal: 'right', vertical: 'middle' };
  tcell.border = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };
  if (style === 'overall') {
    const isIssuedRow = /issued|disbursed/i.test(String(label || ''));
    const overallFill = isIssuedRow ? OVERALL_ISSUED_FILL : palette.accent;
    tcell.font = OVERALL_FONT;
    tcell.fill = solidFill(overallFill);
  } else {
    tcell.font = { ...METRIC_FONT };
    tcell.fill = solidFill(palette.soft);
  }

  ws.getRow(row).height = 12;
};

const computePctChange = (pctArray) => {
  const out = [];
  for (let i = 0; i < pctArray.length; i++) {
    if (i === 0) { out.push(null); continue; }
    const prev = Number(pctArray[i - 1]);
    const cur = Number(pctArray[i]);
    if (!isFinite(prev) || prev === 0) { out.push(null); continue; }
    out.push((cur - prev) / prev);
  }
  return out;
};

const buildTable = ({
  ws, startRow, title, palette, monthLabels,
  sourceRows, overallSettled, overallIssued, numFmt,
}) => {
  const colSpan = 1 + monthLabels.length + 1;
  const totalCol = colSpan;

  mergedBanner(ws, startRow, colSpan, title, {
    fill: solidFill(palette.header),
    font: TABLE_TITLE_FONT,
    height: 14,
  });

  const headerRow = startRow + 1;
  ws.getCell(headerRow, 1).value = 'Metric';
  monthLabels.forEach((label, i) => { ws.getCell(headerRow, 2 + i).value = label; });
  ws.getCell(headerRow, totalCol).value = 'Total';
  for (let c = 1; c <= colSpan; c++) styleHeaderCell(ws.getCell(headerRow, c), palette);
  ws.getRow(headerRow).height = 14;

  let cursor = headerRow + 1;
  sourceRows.forEach((src, idx) => {
    writeDataRow({
      ws, row: cursor, colSpan, palette, rowIndex: idx,
      label: src.label, values: src.values, total: src.total, numFmt, style: 'institution',
    });
    cursor += 1;
  });

  writeDataRow({
    ws, row: cursor, colSpan, palette, rowIndex: 0,
    label: overallSettled.label, values: overallSettled.values, total: overallSettled.total, numFmt, style: 'overall',
  });
  cursor += 1;

  writeDataRow({
    ws, row: cursor, colSpan, palette, rowIndex: 0,
    label: overallIssued.label, values: overallIssued.values, total: overallIssued.total, numFmt, style: 'overall',
  });
  cursor += 1;

  const pctValues = overallSettled.values.map((v, i) => {
    const b = Number(overallIssued.values[i]) || 0;
    return b > 0 ? (Number(v) || 0) / b : 0;
  });
  const pctTotal = (Number(overallIssued.total) || 0) > 0
    ? (Number(overallSettled.total) || 0) / Number(overallIssued.total)
    : 0;
  writeDataRow({
    ws, row: cursor, colSpan, palette, rowIndex: 1,
    label: '% Settled', values: pctValues, total: pctTotal, numFmt: PCT_FORMAT, style: 'pct',
  });
  cursor += 1;

  const changeValues = computePctChange(pctValues);
  writeDataRow({
    ws, row: cursor, colSpan, palette, rowIndex: 2,
    label: '% Change', values: changeValues.map((v) => (v == null ? null : v)),
    total: null, numFmt: PCT_CHANGE_FORMAT, style: 'change',
  });
  for (let i = 0; i < changeValues.length; i++) {
    if (changeValues[i] == null) {
      const cell = ws.getCell(cursor, 2 + i);
      cell.value = null;
      cell.numFmt = 'General';
    }
  }
  ws.getCell(cursor, totalCol).value = null;
  ws.getCell(cursor, totalCol).numFmt = 'General';

  return { endRow: cursor };
};

const buildSheet = ({ wb, sheetName, productKey, productLabel, monthly, sources }) => {
  const palette = paletteFor(productKey);
  const monthLabels = monthly.map((m) => m.monthLabel);
  const settledLoansMonthly = monthly.map((m) => m.settledLoans);
  const issuedLoansMonthly = monthly.map((m) => m.issuedLoans);
  const settledBalanceMonthly = monthly.map((m) => m.settledBalance);
  const totalDisbursedMonthly = monthly.map((m) => m.totalDisbursed);
  const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);

  const colSpan = 1 + monthly.length + 1;
  const ws = wb.addWorksheet(sheetName, {
    properties: { tabColor: { argb: `FF${TAB_COLORS[sheetName] || palette.accent}` } },
    views: [{ state: 'frozen', ySplit: 1, xSplit: 1, showGridLines: false }],
  });

  ws.getColumn(1).width = 17;
  for (let c = 2; c <= colSpan; c++) ws.getColumn(c).width = 9;
  ws.getColumn(colSpan).width = 10;

  mergedBanner(ws, 1, colSpan, `SETTLEMENTS ANALYSIS — ${productLabel.toUpperCase()}`, {
    fill: solidFill(palette.banner),
    font: BANNER_FONT,
    height: 14,
  });

  // Keep a clean spacer row; no development text in final workbook.
  ws.getRow(2).height = 4;
  ws.getRow(3).height = 4;

  const tbl1 = buildTable({
    ws, startRow: 4, title: 'OVERALL SETTLED LOANS  vs  OVERALL LOANS ISSUED',
    palette, monthLabels,
    sourceRows: sources.map((s) => ({ label: `Source: ${s.name}`, values: s.countPerMonth, total: s.totalCount })),
    overallSettled: { label: `${productLabel} Settled Loans`, values: settledLoansMonthly, total: sum(settledLoansMonthly) },
    overallIssued: { label: `${productLabel} Loans Issued`, values: issuedLoansMonthly, total: sum(issuedLoansMonthly) },
    numFmt: INT_FORMAT,
  });

  const tbl2StartRow = tbl1.endRow + 2;
  buildTable({
    ws, startRow: tbl2StartRow, title: 'OVERALL SETTLEMENT BALANCE  vs  OVERALL TOTAL DISBURSED',
    palette, monthLabels,
    sourceRows: sources.map((s) => ({ label: `Source: ${s.name}`, values: s.balancePerMonth, total: s.totalBalance })),
    overallSettled: { label: `${productLabel} Settlement Balance`, values: settledBalanceMonthly, total: sum(settledBalanceMonthly) },
    overallIssued: { label: `${productLabel} Total Disbursed`, values: totalDisbursedMonthly, total: sum(totalDisbursedMonthly) },
    numFmt: CURRENCY_FORMAT,
  });
};

export const buildSettlementWorkbook = async (report) => {
  if (!report || !report.perProduct) throw new Error('Settlement report payload is empty');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'PCL Analysis — Settlements';
  wb.created = new Date();

  const summary = report.perProduct.Total;
  if (summary) {
    buildSheet({
      wb,
      sheetName: 'Summary',
      productKey: 'Total',
      productLabel: 'Overall',
      monthly: summary.monthly,
      sources: summary.sources || [],
    });
  }

  const orderedProducts = report.products.filter((p) => p !== 'Total' && p !== 'Unmapped');
  for (const product of orderedProducts) {
    const data = report.perProduct[product];
    if (!data) continue;
    const name = product.length > 31 ? product.slice(0, 31) : product;
    buildSheet({
      wb,
      sheetName: name,
      productKey: product,
      productLabel: product,
      monthly: data.monthly,
      sources: data.sources || [],
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer };
};

