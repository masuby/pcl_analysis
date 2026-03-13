/**
 * Excel export with colors, freeze panes, and bold total rows using xlsx-js-style
 * Each section = ONE sheet with multiple tables (same structure as UI)
 * Note: xlsx-js-style does not persist freeze panes - we post-process the buffer to inject them.
 */
import * as XLSX from 'xlsx-js-style';
import { injectFreezePanes } from './excelFreezePanes';

const BORDER_THIN = { style: 'thin', color: { rgb: 'FF000000' } };
const BORDER_HAIR = { style: 'hair', color: { rgb: 'FFD0D0D0' } };

const toArgb = (hex) => {
  if (!hex) return 'FF4472C4';
  const h = String(hex).replace(/^#/, '');
  return h.length === 6 ? 'FF' + h.toUpperCase() : h.toUpperCase();
};

/** Blend hex color with white; ratio 0.8 = 80% color + 20% white (softer/lighter) */
const blendWithWhite = (hex, ratio = 0.8) => {
  if (!hex || typeof hex !== 'string') return null;
  const h = hex.replace(/^#/, '');
  if (h.length !== 6) return toArgb(hex);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const r2 = Math.round(r * ratio + 255 * (1 - ratio));
  const g2 = Math.round(g * ratio + 255 * (1 - ratio));
  const b2 = Math.round(b * ratio + 255 * (1 - ratio));
  return 'FF' + [r2, g2, b2].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
};

/**
/** Columns that typically contain numeric values for accounting format (comma separators) */
const ACCOUNTING_HEADERS = new Set([
  'Target', 'Disbursement', 'Number of Loans', 'Active Reps', 'In Arrear', 'Value in Arrears', 'PAR>7', 'PAR>30',
  'Total Value', 'Total Loans', 'Loans', 'Month Target', 'Value', 'Active Reps', 'Reps',
  'Total Calls', 'Successful Calls', 'Unsuccessful Calls', 'Total Agents', '>50 Calls', '<50 Calls',
  'Number of Leads', 'Prospect', 'Total Agents (CRM)', 'Logged In Agents', 'Total TLS', 'Logged In TLS',
  'Agents >50 Calls', 'Agents <50 Calls', 'Total Agents (CC)',
  'Achieved', 'Remaining', '% Achived', '% Unachived', 'Required to End', 'Active Client', 'Inactive Client', 'Total Clients', 'Average Loan Size'
]);

/**
 * Build ONE worksheet from multiple tables (section title + table, section title + table, ...)
 * @param {Array} tables - [{ title?: string, data: Array<Object>, totalRowIndices?: number[], headerColors?: {}, colWidths?: number[], accountingColumns?: string[] }, ...]
 * @param {Object} options - { freeze: { row, col }, twoDecimalPlaces?: boolean } When twoDecimalPlaces is true, numbers use 2 decimals (KPI report). Omit for ScoreCard etc.
 * totalRowIndices: 0-based indices of data rows that are total rows (e.g. [data.length - 1])
 */
export const buildSheetFromTables = (tables, options = {}) => {
  const twoDecimalPlaces = options.twoDecimalPlaces === true;
  if (!tables || tables.length === 0) return null;
  const ws = {};
  let currentRow = 0;
  let maxCol = 0;
  const colWidthsMap = {};

  const DARK_SEPARATOR_COLOR = 'FF1A1A1A';

  tables.forEach((table) => {
    if (table.darkSeparator === true) {
      const cols = Math.max(maxCol + 1, 20);
      for (let c = 0; c < cols; c++) {
        const ref = XLSX.utils.encode_cell({ r: currentRow, c });
        ws[ref] = { t: 's', v: '' };
        ws[ref].s = {
          fill: { patternType: 'solid', fgColor: { rgb: DARK_SEPARATOR_COLOR } },
          border: { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_HAIR, right: BORDER_HAIR }
        };
      }
      currentRow += 1;
      return;
    }

    if (!table.data || table.data.length === 0) return;

    if (table.title) {
      const ref = XLSX.utils.encode_cell({ r: currentRow, c: 0 });
      ws[ref] = { t: 's', v: table.title };
      ws[ref].s = {
        font: { bold: true, sz: 12, color: { rgb: 'FF2E5090' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'FFE9EEF7' } },
        alignment: { horizontal: 'left', vertical: 'center' }
      };
      currentRow += 1;
    }

    const rawHeaders = Object.keys(table.data[0]);
    const headers = rawHeaders.filter(h => h !== '__separator' && h !== '__totalRow');
    const headerColors = table.headerColors || {};
    const totalRowIndices = table.totalRowIndices || [];
    const totalRowFillColor = table.totalRowFillColor || '#C5CAE9';
    const columnFillColors = table.columnFillColors || [];
    const rowFillColors = table.rowFillColors || [];
    const headerDarkBlue = table.headerDarkBlue === true;
    const totalRowDarkBlue = table.totalRowDarkBlue === true;
    const gradeColors = table.gradeColors || {};
    const commentColors = table.commentColors || {};
    const pctChangeColumn = table.pctChangeColumn || '';
    const pctChangePositiveColor = table.pctChangePositiveColor || '#C8E6C9';
    const pctChangeNegativeColor = table.pctChangeNegativeColor || '#FFCDD2';
    const pctChangeNeutralColor = table.pctChangeNeutralColor || '#F0F0F0';
    const DARK_BLUE_BG = 'FF1A237E';
    const colWidths = table.colWidths || headers.map(() => 14);
    const accountingColumns = table.accountingColumns || [];
    const isAccountingCol = (h) => ACCOUNTING_HEADERS.has(h) || accountingColumns.includes(h);
    const getColumnFill = (c) => {
      if (!columnFillColors.length || c >= columnFillColors.length) return null;
      const hex = columnFillColors[c];
      return hex ? toArgb(hex) : null;
    };

    headers.forEach((w, i) => {
      colWidthsMap[i] = Math.max(colWidthsMap[i] || 0, colWidths[i] || 14);
    });
    maxCol = Math.max(maxCol, headers.length - 1);

    // Header row (dark blue 100% for high visibility when headerDarkBlue)
    headers.forEach((h, c) => {
      const ref = XLSX.utils.encode_cell({ r: currentRow, c });
      ws[ref] = { t: 's', v: h };
      const bg = headerDarkBlue ? DARK_BLUE_BG : toArgb(headerColors[h] || headerColors[headers[c]] || '4472C4');
      const fontColor = headerDarkBlue ? 'FFFFFFFF' : 'FFFFFFFF';
      ws[ref].s = {
        fill: { patternType: 'solid', fgColor: { rgb: bg } },
        font: { bold: true, color: { rgb: fontColor }, sz: 11 },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN }
      };
    });
    currentRow += 1;

    // Data rows
    const BLUE_BOTTOM = { style: 'medium', color: { rgb: 'FF2A5298' } };
    const toArgbTotal = (hex) => {
      const h = String(hex || totalRowFillColor).replace(/^#/, '');
      return h.length === 6 ? 'FF' + h.toUpperCase() : h.toUpperCase();
    };
    table.data.forEach((row, r) => {
      const isSeparatorRow = row.__separator === true;
      const isTotalRow = totalRowIndices.includes(r) || row.__totalRow === true;
      const isSupervisionTotalRow = row.__supervisionTotalRow === true;
      headers.forEach((h, c) => {
        const ref = XLSX.utils.encode_cell({ r: currentRow, c });
        let val = row[h];
        if (isSeparatorRow) {
          ws[ref] = { t: 's', v: '' };
          ws[ref].s = {
            border: { top: BORDER_HAIR, bottom: BLUE_BOTTOM, left: BORDER_HAIR, right: BORDER_HAIR },
            fill: { patternType: 'solid', fgColor: { rgb: 'FFFFFFFF' } }
          };
        } else {
          const isPctCol = h === '% Achived' || h === '% Unachived' || h === '% Achieved' || h === 'Percentage Change' || h === 'Change %';
          if (twoDecimalPlaces && val !== null && val !== undefined && typeof val === 'number' && val === val) {
            if (!isPctCol && !Number.isInteger(val)) val = Math.round(val * 100) / 100;
          }
          const useNum = typeof val === 'number' && !Number.isNaN(val);
          const displayVal = useNum && isPctCol ? val / 100 : (useNum ? val : (val ?? ''));
          ws[ref] = { t: useNum ? 'n' : 's', v: displayVal };
          ws[ref].s = {
            border: { top: BORDER_HAIR, bottom: BORDER_HAIR, left: BORDER_HAIR, right: BORDER_HAIR }
          };
          if (useNum && isPctCol) {
            ws[ref].s.numFmt = '0.00%';
          } else if (useNum && isAccountingCol(h)) {
            ws[ref].s.numFmt = twoDecimalPlaces ? '#,##0.00' : '#,##0';
          } else if (twoDecimalPlaces && useNum && typeof displayVal === 'number') {
            ws[ref].s.numFmt = '0.00';
          }
          if (isSupervisionTotalRow && totalRowDarkBlue) {
            ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: DARK_BLUE_BG } };
            ws[ref].s.font = { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 11 };
            ws[ref].s.border = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
          } else if (isTotalRow && totalRowDarkBlue) {
            ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: DARK_BLUE_BG } };
            ws[ref].s.font = { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 11 };
            ws[ref].s.border = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
          } else if (isSupervisionTotalRow) {
            const textColor = (table.supervisionTotalTextColors || [])[c] ? toArgb(table.supervisionTotalTextColors[c]) : 'FFFFFFFF';
            ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: DARK_BLUE_BG } };
            ws[ref].s.font = { bold: true, color: { rgb: textColor }, sz: 11 };
            ws[ref].s.border = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
          } else if (isTotalRow) {
            ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: toArgbTotal(totalRowFillColor) } };
            ws[ref].s.font = { bold: true, color: { rgb: 'FF2E5090' }, sz: 11 };
            ws[ref].s.border = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
          } else {
            const rowFillHex = rowFillColors[r];
            const gradeHex = h === 'Grade' && gradeColors[String(val).trim()];
            const commentHex = h === 'Comment' && commentColors[String(val).toUpperCase().trim()];
            const isPctChangeCol = pctChangeColumn && (h === pctChangeColumn || h === 'Percentage Change' || h === 'Change %');
            let pctChangeHex = null;
            if (isPctChangeCol) {
              if (typeof val === 'number' && !Number.isNaN(val)) {
                pctChangeHex = val >= 0 ? pctChangePositiveColor : pctChangeNegativeColor;
              } else if (val === '-' || val === '' || val == null) {
                pctChangeHex = pctChangeNeutralColor;
              }
            }
            if (rowFillHex) {
              ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: toArgb(rowFillHex) } };
              ws[ref].s.font = { bold: false, color: { rgb: 'FF000000' }, sz: 11 };
            } else if (gradeHex) {
              ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: blendWithWhite(gradeHex, 0.8) || toArgb(gradeHex) } };
              ws[ref].s.font = { bold: true, color: { rgb: 'FF000000' }, sz: 11 };
            } else if (commentHex) {
              ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: blendWithWhite(commentHex, 0.8) || toArgb(commentHex) } };
              ws[ref].s.font = { bold: true, color: { rgb: 'FF000000' }, sz: 11 };
            } else if (pctChangeHex) {
              ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: toArgb(pctChangeHex) } };
              ws[ref].s.font = { bold: true, color: { rgb: 'FF000000' }, sz: 11 };
            } else {
              const colFill = getColumnFill(c);
              if (colFill) {
                ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: colFill } };
              }
            }
          }
        }
      });
      currentRow += 1;
    });

    currentRow += 1; // blank row between tables
  });

  const lastRow = currentRow - 1;
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: maxCol } });
  ws['!cols'] = Array.from({ length: maxCol + 1 }, (_, i) => ({ wch: colWidthsMap[i] || 14 }));

  if (options.freeze) {
    const { row = 1, col = 0 } = options.freeze;
    const splitRow = Math.max(0, row);
    const splitCol = Math.max(0, col);
    ws['!freeze'] = {
      xSplit: splitCol,
      ySplit: splitRow,
      topLeftCell: XLSX.utils.encode_cell({ r: splitRow, c: splitCol }),
      state: 'frozen'
    };
  }

  return ws;
};

/**
 * Build a worksheet from a single table (legacy)
 */
export const buildStyledSheet = (data, options = {}) => {
  if (!data || data.length === 0) return null;
  const tables = [{ data, totalRowIndices: options.totalRowIndices || [], headerColors: options.headerColors || {}, colWidths: options.colWidths }];
  const ws = buildSheetFromTables(tables, { freeze: options.freeze });
  if (ws && options.colWidths && options.colWidths.length > 0) {
    ws['!cols'] = options.colWidths.map((w) => ({ wch: w }));
  }
  return ws;
};

/**
 * Export workbook with exactly 5 sheets (one per section). Each sheet has multiple tables with colors and freeze.
 * @param {Array} sheets - Array of 5 items: { name, tables: [{ title?, data, totalRowIndices?, headerColors?, colWidths? }], freeze? }
 * @param {string} fileName
 */
export const exportMultipleSheetsWithStyles = async (sheets, fileName, exportOptions = {}) => {
  if (!sheets || sheets.length === 0) {
    console.warn('No sheets to export');
    return;
  }
  const wb = XLSX.utils.book_new();
  const twoDecimalPlaces = exportOptions.twoDecimalPlaces === true;

  sheets.forEach((sheet) => {
    if (!sheet.tables || sheet.tables.length === 0) return;
    const hasData = sheet.tables.some((t) => t.data && t.data.length > 0);
    if (!hasData) return;
    const ws = buildSheetFromTables(sheet.tables, { freeze: sheet.freeze, twoDecimalPlaces });
    if (ws) XLSX.utils.book_append_sheet(wb, ws, (sheet.name || 'Sheet').substring(0, 31));
  });

  // Safety: Excel requires at least one sheet
  if (wb.SheetNames.length === 0) {
    const fallback = buildSheetFromTables([{ data: [{ Message: 'No data to export.' }], headerColors: { Message: '#4472C4' }, colWidths: [40] }], {});
    if (fallback) XLSX.utils.book_append_sheet(wb, fallback, 'Info');
  }

  let buffer = XLSX.write(wb, { bookType: 'xlsx', bookSST: false, type: 'array' });
  const sheetsConfig = sheets.filter((s) => s.tables?.some((t) => t.data?.length > 0)).map((s) => ({ freeze: s.freeze }));
  if (sheetsConfig.some((s) => s.freeze && (s.freeze.row > 0 || s.freeze.col > 0))) {
    buffer = await injectFreezePanes(new Uint8Array(buffer), sheetsConfig);
  }

  const base = fileName || `HOD_ScoreCard_${new Date().toISOString().split('T')[0]}`;
  const finalFileName = base.toLowerCase().endsWith('.xlsx') ? base : `${base}.xlsx`;
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalFileName;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Build workbook as ArrayBuffer (for email attachment).
 * Same logic as exportMultipleSheetsWithStyles but returns binary instead of downloading.
 * @param {Array} sheets - Same format as exportMultipleSheetsWithStyles
 * @param {string} fileName - Base filename for the workbook
 * @param {Object} exportOptions - { twoDecimalPlaces?: boolean }
 * @returns {Promise<{ buffer: Uint8Array, fileName: string } | null>}
 */
export const buildWorkbookBuffer = async (sheets, fileName, exportOptions = {}) => {
  if (!sheets || sheets.length === 0) return null;
  const wb = XLSX.utils.book_new();
  const twoDecimalPlaces = exportOptions.twoDecimalPlaces === true;
  sheets.forEach((sheet) => {
    if (!sheet.tables || sheet.tables.length === 0) return;
    const hasData = sheet.tables.some((t) => t.data && t.data.length > 0);
    if (!hasData) return;
    const ws = buildSheetFromTables(sheet.tables, { freeze: sheet.freeze, twoDecimalPlaces });
    if (ws) XLSX.utils.book_append_sheet(wb, ws, (sheet.name || 'Sheet').substring(0, 31));
  });
  if (wb.SheetNames.length === 0) {
    const fallback = buildSheetFromTables([{ data: [{ Message: 'No data to export.' }], headerColors: { Message: '#4472C4' }, colWidths: [40] }], {});
    if (fallback) XLSX.utils.book_append_sheet(wb, fallback, 'Info');
  }
  let buffer = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', bookSST: false, type: 'array' }));
  const sheetsConfig = sheets.filter((s) => s.tables?.some((t) => t.data?.length > 0)).map((s) => ({ freeze: s.freeze }));
  if (sheetsConfig.some((s) => s.freeze && (s.freeze.row > 0 || s.freeze.col > 0))) {
    buffer = await injectFreezePanes(buffer, sheetsConfig);
  }
  const base = fileName || `HOD_ScoreCard_${new Date().toISOString().split('T')[0]}`;
  const finalFileName = base.toLowerCase().endsWith('.xlsx') ? base : `${base}.xlsx`;
  return { buffer, fileName: finalFileName };
};

/**
 * Export a single section to one Excel file (one sheet, same structure as UI: multiple tables with titles)
 * @param {Object} section - { name, tables: [...], freeze? }
 * @param {string} fileName
 */
export const exportSingleSectionWithStyles = async (section, fileName) => {
  if (!section || !section.tables || section.tables.length === 0) return;
  const hasData = section.tables.some((t) => t.data && t.data.length > 0);
  if (!hasData) return;
  const wb = XLSX.utils.book_new();
  const ws = buildSheetFromTables(section.tables, { freeze: section.freeze });
  if (ws) XLSX.utils.book_append_sheet(wb, ws, (section.name || 'Sheet').substring(0, 31));
  let buffer = XLSX.write(wb, { bookType: 'xlsx', bookSST: false, type: 'array' });
  if (section.freeze && (section.freeze.row > 0 || section.freeze.col > 0)) {
    buffer = await injectFreezePanes(new Uint8Array(buffer), [{ freeze: section.freeze }]);
  }
  const base = fileName || `${(section.name || 'Export').replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}`;
  const finalFileName = base.toLowerCase().endsWith('.xlsx') ? base : `${base}.xlsx`;
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = finalFileName;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Append a table to a worksheet at startRow (helper for custom builds)
 */
export const appendTableToSheet = (ws, data, startRow, options = {}) => {
  if (!data || data.length === 0) return startRow;
  const headers = Object.keys(data[0]);
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } };

  headers.forEach((h, c) => {
    const ref = XLSX.utils.encode_cell({ r: startRow, c });
    ws[ref] = { t: 's', v: h };
    const hex = (options.headerColors || {})[h];
    ws[ref].s = {
      fill: { patternType: 'solid', fgColor: { rgb: toArgb(hex || '4472C4') } },
      font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 11 },
      border: { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN }
    };
  });

      const totalRowIndices = options.totalRowIndices || [];
      data.forEach((row, r) => {
        const rowIndex = startRow + 1 + r;
        const isTotal = totalRowIndices.includes(r);
        headers.forEach((h, c) => {
          const ref = XLSX.utils.encode_cell({ r: rowIndex, c });
      let val = row[h];
      if (val !== null && val !== undefined && typeof val === 'number' && !Number.isInteger(val)) val = Math.round(val * 100) / 100;
      ws[ref] = { t: typeof val === 'number' ? 'n' : 's', v: val };
      ws[ref].s = { border: { top: BORDER_HAIR, bottom: BORDER_HAIR, left: BORDER_HAIR, right: BORDER_HAIR } };
      if (isTotal) {
        ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: 'FFD6DCE4' } };
        ws[ref].s.font = { bold: true, color: { rgb: 'FF2E5090' }, sz: 11 };
      }
    });
  });

  const newMaxRow = startRow + 1 + data.length;
  const newMaxCol = Math.max(range.e.c, headers.length - 1);
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: newMaxRow, c: newMaxCol } });
  return newMaxRow + 1;
};
