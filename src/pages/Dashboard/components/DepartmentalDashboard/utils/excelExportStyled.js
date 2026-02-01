/**
 * Excel export with colors, freeze panes, and bold total rows using xlsx-js-style
 * Each section = ONE sheet with multiple tables (same structure as UI)
 */
import * as XLSX from 'xlsx-js-style';

const BORDER_THIN = { style: 'thin', color: { rgb: 'FF000000' } };
const BORDER_HAIR = { style: 'hair', color: { rgb: 'FFD0D0D0' } };

const toArgb = (hex) => {
  if (!hex) return 'FF4472C4';
  const h = String(hex).replace(/^#/, '');
  return h.length === 6 ? 'FF' + h.toUpperCase() : h.toUpperCase();
};

/**
 * Build ONE worksheet from multiple tables (section title + table, section title + table, ...)
 * @param {Array} tables - [{ title?: string, data: Array<Object>, totalRowIndices?: number[], headerColors?: {}, colWidths?: number[] }, ...]
 * @param {Object} options - { freeze: { row, col } }
 * totalRowIndices: 0-based indices of data rows that are total rows (e.g. [data.length - 1])
 */
export const buildSheetFromTables = (tables, options = {}) => {
  if (!tables || tables.length === 0) return null;
  const ws = {};
  let currentRow = 0;
  let maxCol = 0;
  const colWidthsMap = {};

  tables.forEach((table) => {
    if (!table.data || table.data.length === 0) return;

    if (table.title) {
      const ref = XLSX.utils.encode_cell(0, currentRow);
      ws[ref] = { t: 's', v: table.title };
      ws[ref].s = {
        font: { bold: true, sz: 12, color: { rgb: 'FF2E5090' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'FFE9EEF7' } },
        alignment: { horizontal: 'left', vertical: 'center' }
      };
      currentRow += 1;
    }

    const headers = Object.keys(table.data[0]);
    const headerColors = table.headerColors || {};
    const totalRowIndices = table.totalRowIndices || [];
    const colWidths = table.colWidths || headers.map(() => 14);

    headers.forEach((w, i) => {
      colWidthsMap[i] = Math.max(colWidthsMap[i] || 0, colWidths[i] || 14);
    });
    maxCol = Math.max(maxCol, headers.length - 1);

    // Header row
    headers.forEach((h, c) => {
      const ref = XLSX.utils.encode_cell(c, currentRow);
      ws[ref] = { t: 's', v: h };
      const bg = toArgb(headerColors[h] || headerColors[headers[c]] || '4472C4');
      ws[ref].s = {
        fill: { patternType: 'solid', fgColor: { rgb: bg } },
        font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 11 },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN }
      };
    });
    currentRow += 1;

    // Data rows
    table.data.forEach((row, r) => {
      const isTotalRow = totalRowIndices.includes(r);
      headers.forEach((h, c) => {
        const ref = XLSX.utils.encode_cell(c, currentRow);
        let val = row[h];
        if (val !== null && val !== undefined && typeof val === 'number' && !Number.isInteger(val))
          val = Math.round(val * 100) / 100;
        ws[ref] = { t: typeof val === 'number' ? 'n' : 's', v: val };
        ws[ref].s = {
          border: { top: BORDER_HAIR, bottom: BORDER_HAIR, left: BORDER_HAIR, right: BORDER_HAIR }
        };
        if (isTotalRow) {
          ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: 'FFD6DCE4' } };
          ws[ref].s.font = { bold: true, color: { rgb: 'FF2E5090' }, sz: 11 };
          ws[ref].s.border = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };
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
    ws['!freeze'] = { xSplit: col, ySplit: row, topLeftCell: XLSX.utils.encode_cell(col, row) };
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
export const exportMultipleSheetsWithStyles = (sheets, fileName) => {
  if (!sheets || sheets.length === 0) {
    console.warn('No sheets to export');
    return;
  }
  const wb = XLSX.utils.book_new();

  sheets.forEach((sheet) => {
    if (!sheet.tables || sheet.tables.length === 0) return;
    const hasData = sheet.tables.some((t) => t.data && t.data.length > 0);
    if (!hasData) return;
    const ws = buildSheetFromTables(sheet.tables, { freeze: sheet.freeze });
    if (ws) XLSX.utils.book_append_sheet(wb, ws, (sheet.name || 'Sheet').substring(0, 31));
  });

  const finalFileName = fileName || `HOD_ScoreCard_${new Date().toISOString().split('T')[0]}.xlsx`;
  try {
    XLSX.writeFile(wb, finalFileName, { bookType: 'xlsx', bookSST: false });
  } catch (e) {
    XLSX.writeFile(wb, finalFileName);
  }
};

/**
 * Export a single section to one Excel file (one sheet, same structure as UI: multiple tables with titles)
 * @param {Object} section - { name, tables: [...], freeze? }
 * @param {string} fileName
 */
export const exportSingleSectionWithStyles = (section, fileName) => {
  if (!section || !section.tables || section.tables.length === 0) return;
  const hasData = section.tables.some((t) => t.data && t.data.length > 0);
  if (!hasData) return;
  const wb = XLSX.utils.book_new();
  const ws = buildSheetFromTables(section.tables, { freeze: section.freeze });
  if (ws) XLSX.utils.book_append_sheet(wb, ws, (section.name || 'Sheet').substring(0, 31));
  const finalFileName = fileName || `${(section.name || 'Export').replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
  try {
    XLSX.writeFile(wb, finalFileName, { bookType: 'xlsx', bookSST: false });
  } catch (e) {
    XLSX.writeFile(wb, finalFileName);
  }
};

/**
 * Append a table to a worksheet at startRow (helper for custom builds)
 */
export const appendTableToSheet = (ws, data, startRow, options = {}) => {
  if (!data || data.length === 0) return startRow;
  const headers = Object.keys(data[0]);
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } };

  headers.forEach((h, c) => {
    const ref = XLSX.utils.encode_cell(c, startRow);
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
      const ref = XLSX.utils.encode_cell(c, rowIndex);
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
