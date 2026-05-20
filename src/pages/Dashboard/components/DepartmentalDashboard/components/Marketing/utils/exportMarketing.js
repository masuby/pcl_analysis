import { buildWorkbookBuffer } from '../../../utils/excelExportStyled';

const pct  = (v) => (v == null ? '-' : `${Number(v).toFixed(1)}%`);
const safe = (v) => (v == null || v === 0 ? 0 : v);

const BLUE   = '#1e3c72';
const CS_COL = '#2a5298';
const LBF_COL = '#c05621';
const SME_COL = '#276749';
const ACH_COL = '#7b341e';

const sumArr = (arr) => (arr || []).reduce((s, v) => s + (v || 0), 0);

/* ── Overview sheet: monthly CS/LBF/SME/Grand/Target/Achievement ── */
const overviewSheet = (yearData, compareData) => {
  const { year, monthLabels, segCS, segLBF, segSME, target, actual, achievement } = yearData;
  const prevYear = compareData?.year;

  const rows = monthLabels.map((m, i) => {
    const grand = (segCS[i] || 0) + (segLBF[i] || 0) + (segSME[i] || 0);
    const row = {
      Month:   m,
      'CS Sales':    safe(segCS[i]),
      'LBF Sales':   safe(segLBF[i]),
      'SME Sales':   safe(segSME[i]),
      'Grand Total': grand,
      Target:        safe(target[i]),
      'Achievement %': pct(achievement[i]),
    };
    if (compareData) {
      const prevGrand = ((compareData.segCS?.[i] || 0) + (compareData.segLBF?.[i] || 0) + (compareData.segSME?.[i] || 0));
      row[`${prevYear} Total`] = prevGrand;
      const chg = prevGrand > 0 ? (((grand - prevGrand) / prevGrand) * 100) : null;
      row['YoY Change'] = chg != null ? pct(chg) : '-';
    }
    return row;
  });

  const totalCS    = sumArr(segCS);
  const totalLBF   = sumArr(segLBF);
  const totalSME   = sumArr(segSME);
  const totalGrand = totalCS + totalLBF + totalSME;
  const totalTarget = sumArr(target);
  const totalActual = sumArr(actual);
  const overallAch  = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;

  const totalRow = {
    __totalRow: true,
    Month: 'TOTAL',
    'CS Sales':    totalCS,
    'LBF Sales':   totalLBF,
    'SME Sales':   totalSME,
    'Grand Total': totalGrand,
    Target:        totalTarget,
    'Achievement %': `${overallAch}%`,
  };
  if (compareData) {
    const prevGrand = sumArr(compareData.segCS) + sumArr(compareData.segLBF) + sumArr(compareData.segSME);
    totalRow[`${prevYear} Total`] = prevGrand;
    const chg = prevGrand > 0 ? (((totalGrand - prevGrand) / prevGrand) * 100) : null;
    totalRow['YoY Change'] = chg != null ? pct(chg) : '-';
  }
  rows.push({ __separator: true });
  rows.push(totalRow);

  const headerColors = {
    Month:         BLUE,
    'CS Sales':    CS_COL,
    'LBF Sales':   LBF_COL,
    'SME Sales':   SME_COL,
    'Grand Total': BLUE,
    Target:        '#c53030',
    'Achievement %': ACH_COL,
  };
  if (compareData) {
    headerColors[`${prevYear} Total`] = '#718096';
    headerColors['YoY Change'] = '#276749';
  }

  return {
    name: `Overview ${year}`,
    tables: [{
      title: `Digital Sales Overview — ${year}${compareData ? ` vs ${prevYear}` : ''}`,
      data: rows,
      colWidths: [14, 15, 15, 15, 16, 16, 14, ...(compareData ? [16, 14] : [])],
      headerColors,
      accountingColumns: ['CS Sales', 'LBF Sales', 'SME Sales', 'Grand Total', 'Target', ...(compareData ? [`${prevYear} Total`] : [])],
      totalRowIndices: [rows.length - 1],
    }],
    freeze: { row: 2, col: 1 },
  };
};

/* ── Per-product sheet with funnel metrics ── */
const productSheet = (product, yearData, compareData) => {
  const keyMap = { CS: { seg: 'segCS', cur: 'cs' }, LBF: { seg: 'segLBF', cur: 'lbf' }, SME: { seg: 'segSME', cur: 'sme' } };
  const { seg: segKey, cur: curKey } = keyMap[product];
  const { year, monthLabels } = yearData;
  const seg  = yearData[segKey] || [];
  const curr = yearData[curKey] || {};
  const prevSeg = compareData ? compareData[segKey] : null;
  const prevYear = compareData?.year;

  const hasFunnel = (curr.totalLeads || []).some((v) => v > 0);

  const rows = monthLabels.map((m, i) => {
    const row = { Month: m };
    if (hasFunnel) {
      row['Total Leads']    = safe(curr.totalLeads?.[i]);
      row['Contacted']      = safe(curr.leadsContacted?.[i]);
      row['Viable Leads']   = safe(curr.viableLeads?.[i]);
      row['Converted']      = safe(curr.convertedLeads?.[i]);
      row['Conv. Rate %']   = pct(curr.conversionRate?.[i]);
      row['Avg Loan Size']  = safe(curr.avgLoanSize?.[i]);
    }
    row[`${product} Sales ${year}`] = safe(seg[i]);
    if (prevSeg) {
      row[`${product} Sales ${prevYear}`] = safe(prevSeg[i]);
      const chg = prevSeg[i] > 0 ? (((seg[i] || 0) - prevSeg[i]) / prevSeg[i]) * 100 : null;
      row['YoY Change'] = chg != null ? pct(chg) : '-';
    }
    return row;
  });

  const totSales = sumArr(seg);
  const prevTotalSales = prevSeg ? sumArr(prevSeg) : 0;
  const totalRow = { __totalRow: true, Month: 'TOTAL / AVG' };
  if (hasFunnel) {
    totalRow['Total Leads']   = sumArr(curr.totalLeads);
    totalRow['Contacted']     = sumArr(curr.leadsContacted);
    totalRow['Viable Leads']  = sumArr(curr.viableLeads);
    totalRow['Converted']     = sumArr(curr.convertedLeads);
    const nz = (curr.conversionRate || []).filter((v) => v > 0);
    totalRow['Conv. Rate %']  = nz.length ? pct(nz.reduce((s, v) => s + v, 0) / nz.length) : '-';
    const lnz = (curr.avgLoanSize || []).filter((v) => v > 0);
    totalRow['Avg Loan Size'] = lnz.length ? Math.round(lnz.reduce((s, v) => s + v, 0) / lnz.length) : 0;
  }
  totalRow[`${product} Sales ${year}`] = totSales;
  if (prevSeg) {
    totalRow[`${product} Sales ${prevYear}`] = prevTotalSales;
    const chg = prevTotalSales > 0 ? (((totSales - prevTotalSales) / prevTotalSales) * 100) : null;
    totalRow['YoY Change'] = chg != null ? pct(chg) : '-';
  }
  rows.push({ __separator: true });
  rows.push(totalRow);

  const PROD_COLOR = { CS: CS_COL, LBF: LBF_COL, SME: SME_COL }[product];
  const headerColors = { Month: BLUE };
  if (hasFunnel) {
    headerColors['Total Leads']   = PROD_COLOR;
    headerColors['Contacted']     = PROD_COLOR;
    headerColors['Viable Leads']  = PROD_COLOR;
    headerColors['Converted']     = PROD_COLOR;
    headerColors['Conv. Rate %']  = ACH_COL;
    headerColors['Avg Loan Size'] = '#4a5568';
  }
  headerColors[`${product} Sales ${year}`]    = PROD_COLOR;
  if (prevSeg) {
    headerColors[`${product} Sales ${prevYear}`] = '#718096';
    headerColors['YoY Change'] = '#276749';
  }

  const accountingColumns = [`${product} Sales ${year}`, ...(prevSeg ? [`${product} Sales ${prevYear}`] : [])];
  if (hasFunnel) accountingColumns.push('Avg Loan Size');

  return {
    name: product,
    tables: [{
      title: `${product} — ${hasFunnel ? 'Pipeline & ' : ''}Sales Detail — ${year}`,
      data: rows,
      colWidths: [14, ...(hasFunnel ? [12, 12, 12, 12, 12, 16] : []), 16, ...(prevSeg ? [16, 13] : [])],
      headerColors,
      accountingColumns,
      totalRowIndices: [rows.length - 1],
    }],
    freeze: { row: 2, col: 1 },
  };
};

export const buildMarketingExcelSheets = (yearData, compareData) => [
  overviewSheet(yearData, compareData),
  productSheet('CS',  yearData, compareData),
  productSheet('LBF', yearData, compareData),
  productSheet('SME', yearData, compareData),
];

export const downloadMarketingExcel = async (yearData, compareData) => {
  const { year } = yearData;
  const prevYear  = compareData?.year;
  const fileName  = prevYear
    ? `Digital_Sales_Analysis_${prevYear}_vs_${year}.xlsx`
    : `Digital_Sales_Analysis_${year}.xlsx`;

  const sheets = buildMarketingExcelSheets(yearData, compareData);
  const result = await buildWorkbookBuffer(sheets, fileName);
  if (!result?.buffer) return;

  const blob = new Blob([result.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download = result.fileName;
  a.click();
  URL.revokeObjectURL(url);
};

/* Returns { buffer, fileName } — use for email attachments */
export const buildMarketingExcelBuffer = async (yearData, compareData) => {
  const { year } = yearData;
  const prevYear = compareData?.year;
  const fileName = prevYear
    ? `Digital_Sales_${prevYear}_vs_${year}.xlsx`
    : `Digital_Sales_${year}.xlsx`;
  return buildWorkbookBuffer(buildMarketingExcelSheets(yearData, compareData), fileName);
};

/* ════════════════════════════════════════════════════════
   COMBINED / TOTAL REPORT  (multiple years)
════════════════════════════════════════════════════════ */

const PROD_LABELS = { CS: 'Civil Servant', LBF: 'Log Book Finance', SME: 'Small & Medium Enterprise' };

/* Sheet 1 — year-by-year summary */
const combinedSummarySheet = (allYearsData) => {
  const years = Object.keys(allYearsData).map(Number).sort((a, b) => a - b);

  const yearRows = years.map((y, idx) => {
    const d     = allYearsData[y];
    const cs    = sumArr(d.segCS);
    const lbf   = sumArr(d.segLBF);
    const sme   = sumArr(d.segSME);
    const grand = cs + lbf + sme;
    const tgt   = sumArr(d.target);
    const act   = sumArr(d.actual);
    const ach   = tgt > 0 ? Math.round((act / tgt) * 100) : 0;
    const prevY = idx > 0 ? years[idx - 1] : null;
    const prevGrand = prevY
      ? sumArr(allYearsData[prevY].segCS) + sumArr(allYearsData[prevY].segLBF) + sumArr(allYearsData[prevY].segSME)
      : null;
    const yoy = prevGrand > 0 ? (((grand - prevGrand) / prevGrand) * 100) : null;
    return {
      Year:               String(y),
      'Civil Servant':    cs,
      'Log Book Finance': lbf,
      'SME':              sme,
      'Grand Total':      grand,
      Target:             tgt,
      'Achievement %':    `${ach}%`,
      'YoY Growth':       yoy != null ? pct(yoy) : '—',
    };
  });

  const grandCS    = years.reduce((s, y) => s + sumArr(allYearsData[y].segCS),  0);
  const grandLBF   = years.reduce((s, y) => s + sumArr(allYearsData[y].segLBF), 0);
  const grandSME   = years.reduce((s, y) => s + sumArr(allYearsData[y].segSME), 0);
  const grandTotal = grandCS + grandLBF + grandSME;
  const grandTarget = years.reduce((s, y) => s + sumArr(allYearsData[y].target), 0);
  const grandActual = years.reduce((s, y) => s + sumArr(allYearsData[y].actual), 0);
  const grandAch    = grandTarget > 0 ? Math.round((grandActual / grandTarget) * 100) : 0;

  yearRows.push({ __separator: true });
  yearRows.push({
    __totalRow:         true,
    Year:               'ALL YEARS',
    'Civil Servant':    grandCS,
    'Log Book Finance': grandLBF,
    'SME':              grandSME,
    'Grand Total':      grandTotal,
    Target:             grandTarget,
    'Achievement %':    `${grandAch}%`,
    'YoY Growth':       '—',
  });

  return {
    name: 'Combined Summary',
    tables: [{
      title: `Combined Digital Sales Summary — ${years.join(' · ')}`,
      data: yearRows,
      colWidths: [12, 18, 20, 14, 16, 16, 16, 14],
      headerColors: {
        Year:               BLUE,
        'Civil Servant':    CS_COL,
        'Log Book Finance': LBF_COL,
        SME:                SME_COL,
        'Grand Total':      BLUE,
        Target:             '#c53030',
        'Achievement %':    ACH_COL,
        'YoY Growth':       '#276749',
      },
      accountingColumns: ['Civil Servant', 'Log Book Finance', 'SME', 'Grand Total', 'Target'],
      totalRowIndices: [yearRows.length - 1],
    }],
    freeze: { row: 2, col: 1 },
  };
};

/* Per-product cross-year sheet — monthly columns per year */
const productCrossYearSheet = (product, allYearsData) => {
  const segKey   = { CS: 'segCS', LBF: 'segLBF', SME: 'segSME' }[product];
  const PROD_COLOR = { CS: CS_COL, LBF: LBF_COL, SME: SME_COL }[product];
  const years    = Object.keys(allYearsData).map(Number).sort((a, b) => a - b);
  const months   = allYearsData[years[0]].monthLabels || [];
  const lastY    = years[years.length - 1];
  const prevY    = years.length >= 2 ? years[years.length - 2] : null;

  const rows = months.map((m, i) => {
    const row = { Month: m };
    years.forEach((y) => { row[String(y)] = safe((allYearsData[y][segKey] || [])[i]); });
    if (prevY) {
      const curr = (allYearsData[lastY][segKey] || [])[i] || 0;
      const prev = (allYearsData[prevY][segKey] || [])[i] || 0;
      row['YoY Change'] = prev > 0 ? pct(((curr - prev) / prev) * 100) : '—';
    }
    return row;
  });

  const totalRow = { __totalRow: true, Month: 'TOTAL' };
  years.forEach((y) => { totalRow[String(y)] = sumArr(allYearsData[y][segKey]); });
  if (prevY) {
    const lastTot = sumArr(allYearsData[lastY][segKey]);
    const prevTot = sumArr(allYearsData[prevY][segKey]);
    totalRow['YoY Change'] = prevTot > 0 ? pct(((lastTot - prevTot) / prevTot) * 100) : '—';
  }
  rows.push({ __separator: true });
  rows.push(totalRow);

  const headerColors = { Month: BLUE };
  years.forEach((y) => { headerColors[String(y)] = PROD_COLOR; });
  if (prevY) headerColors['YoY Change'] = '#276749';

  return {
    name: `${product} — All Years`,
    tables: [{
      title: `${PROD_LABELS[product]} (${product}) — Sales Across All Years`,
      data: rows,
      colWidths: [14, ...years.map(() => 16), ...(prevY ? [14] : [])],
      headerColors,
      accountingColumns: years.map(String),
      totalRowIndices: [rows.length - 1],
    }],
    freeze: { row: 2, col: 1 },
  };
};

export const buildTotalExcelSheets = (allYearsData) => {
  const years = Object.keys(allYearsData).map(Number).sort((a, b) => a - b);
  return [
    combinedSummarySheet(allYearsData),
    ...years.map((y) => overviewSheet(allYearsData[y], null)),
    productCrossYearSheet('CS',  allYearsData),
    productCrossYearSheet('LBF', allYearsData),
    productCrossYearSheet('SME', allYearsData),
  ];
};

export const downloadMarketingExcelTotal = async (allYearsData) => {
  const years    = Object.keys(allYearsData).map(Number).sort((a, b) => a - b);
  const fileName = `Digital_Sales_Combined_${years.join('_')}.xlsx`;
  const result   = await buildWorkbookBuffer(buildTotalExcelSheets(allYearsData), fileName);
  if (!result?.buffer) return;
  const blob = new Blob([result.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href    = url;
  a.download = result.fileName;
  a.click();
  URL.revokeObjectURL(url);
};

/* Returns { buffer, fileName } — for email attachment */
export const buildTotalExcelBuffer = async (allYearsData) => {
  const years    = Object.keys(allYearsData).map(Number).sort((a, b) => a - b);
  const fileName = `Digital_Sales_Combined_${years.join('_')}.xlsx`;
  return buildWorkbookBuffer(buildTotalExcelSheets(allYearsData), fileName);
};
