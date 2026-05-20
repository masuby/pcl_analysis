import * as XLSX from 'xlsx-js-style';
import { injectFreezePanes } from '../../../utils/excelFreezePanes';

const BORDER = { style: 'thin', color: { rgb: 'FFD0D7E2' } };
const HEADER_BG = 'FF1A237E';
const HEADER_BG_2 = 'FF283593';
const HEADER_TEXT_BLUE = 'FF1A237E';
const GRADE_COLORS = { A: 'FF7B1FA2', B: 'FF1976D2', C: 'FF388E3C', D: 'FFF57C00', E: 'FFC62828' };
const COMMENT_COLORS = { EXCELLENT: 'FF388E3C', STANDARD: 'FF1976D2', 'BELOW STANDARD': 'FFF57C00', 'NOT ACCEPTABLE': 'FFC62828' };
const PASTEL = ['FFFFCDD2', 'FFFFE0B2', 'FFFFFFC4', 'FFC8E6C9', 'FFB3E5FC', 'FFC5CAE9', 'FFE1BEE7'];

const isPctCol = (h) => String(h || '').includes('% Achived') || String(h || '').includes('% Unachived');
const isNum = (v) => typeof v === 'number' && !Number.isNaN(v);
const isPeopleMetric = (metric) => ['Active Reps', 'Actual Reps', 'Active', 'Actual'].includes(String(metric || '').trim());
const MONTH_BANDS = ['FFE3F2FD', 'FFE8F5E9', 'FFFFF3E0', 'FFF3E5F5', 'FFE0F7FA', 'FFFCE4EC', 'FFF1F8E9', 'FFE8EAF6', 'FFFFFDE7', 'FFEDE7F6', 'FFE1F5FE', 'FFF9FBE7'];

const buildSheet = (sheet) => {
  const table = sheet?.tables?.[0];
  const rows = table?.data || [];
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]).filter((h) => h !== '__separator' && h !== '__totalRow');
  const ws = {};

  const monthColumns = table?.monthColumns || [];
  const monthSubCols = table?.monthSubCols || [];
  const separatorCol = table?.separatorCol || ' ';
  const cumulativeTitle = `CUMULATIVE (${monthColumns.map((m) => String(m || '').toUpperCase()).join(', ')})`;
  const fixedCols = ['Zone', 'Branch', headers.includes('Regional Sales Manager Name') ? 'Regional Sales Manager Name' : null, 'Metric'].filter(Boolean);
  const fixedCount = fixedCols.length;
  const monthBandByCol = {};
  monthColumns.forEach((m, idx) => {
    const band = MONTH_BANDS[idx % MONTH_BANDS.length];
    monthSubCols.forEach((s) => {
      monthBandByCol[`${m} ${s}`] = band;
    });
  });
  monthSubCols.forEach((s) => {
    monthBandByCol[`Cumulative ${s}`] = 'FFE8EAF6';
  });

  // Two-row grouped header
  headers.forEach((h, c) => {
    const refTop = XLSX.utils.encode_cell({ r: 0, c });
    const refSub = XLSX.utils.encode_cell({ r: 1, c });
    const subLabel = monthSubCols.find((s) => h.endsWith(` ${s}`))
      || (h.startsWith('Cumulative ') ? h.replace('Cumulative ', '') : h);
    ws[refSub] = { t: 's', v: c < fixedCount ? '' : (h === separatorCol ? '' : subLabel) };
    ws[refTop] = { t: 's', v: '' };
    if (c < fixedCount) ws[refTop].v = h;
    if (h === separatorCol) ws[refTop].v = '';
    monthColumns.forEach((m) => {
      if (h === `${m} ${monthSubCols[0]}`) ws[refTop].v = m;
    });
    if (h === `Cumulative ${monthSubCols[0]}`) ws[refTop].v = cumulativeTitle;
    const monthBg = monthBandByCol[h] || 'FFFFFFFF';
    const topBg = h === separatorCol ? 'FF0F172A' : (c < fixedCount ? 'FFFFFFFF' : monthBg);
    ws[refTop].s = {
      fill: { patternType: 'solid', fgColor: { rgb: topBg } },
      font: { name: 'Calibri', bold: true, sz: 8, color: { rgb: h === separatorCol ? 'FFFFFFFF' : HEADER_TEXT_BLUE } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
      border: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER },
    };
    ws[refSub].s = {
      fill: { patternType: 'solid', fgColor: { rgb: h === separatorCol ? 'FF0F172A' : (c < fixedCount ? 'FFFFFFFF' : monthBg) } },
      font: { name: 'Calibri', bold: true, sz: 8, color: { rgb: h === separatorCol ? 'FFFFFFFF' : HEADER_TEXT_BLUE } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
      border: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER },
    };
  });

  // Header merges
  ws['!merges'] = [];
  fixedCols.forEach((_, c) => ws['!merges'].push({ s: { r: 0, c }, e: { r: 1, c } }));
  monthColumns.forEach((m) => {
    const start = headers.indexOf(`${m} ${monthSubCols[0]}`);
    if (start >= 0) ws['!merges'].push({ s: { r: 0, c: start }, e: { r: 0, c: start + monthSubCols.length - 1 } });
  });
  const cumStart = headers.indexOf(`Cumulative ${monthSubCols[0]}`);
  if (cumStart >= 0) ws['!merges'].push({ s: { r: 0, c: cumStart }, e: { r: 0, c: cumStart + monthSubCols.length - 1 } });
  const sepIdx = headers.indexOf(separatorCol);
  if (sepIdx >= 0) ws['!merges'].push({ s: { r: 0, c: sepIdx }, e: { r: rows.length + 1, c: sepIdx } });

  rows.forEach((row, rIdx) => {
    headers.forEach((h, c) => {
      const ref = XLSX.utils.encode_cell({ r: rIdx + 2, c });
      const val = row[h];
      const useNum = isNum(val);
      const peopleRow = isPeopleMetric(row.Metric);
      ws[ref] = { t: useNum ? 'n' : 's', v: useNum ? (isPctCol(h) ? val / 100 : val) : (val ?? '') };
      const baseFill = h === separatorCol
        ? 'FF0F172A'
        : (c < fixedCount ? 'FFFFFFFF' : (monthBandByCol[h] || PASTEL[0]));
      ws[ref].s = {
        fill: { patternType: 'solid', fgColor: { rgb: baseFill } },
        font: { name: 'Calibri', sz: 8, color: { rgb: 'FF1F2937' } },
        alignment: { horizontal: 'left', vertical: 'center', wrapText: false },
        border: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER },
      };
      if (h.startsWith('Cumulative ')) ws[ref].s.border.left = { style: 'medium', color: { rgb: 'FF1A237E' } };
      if (h.endsWith(' Grade')) {
        const g = String(val || '').trim();
        if (GRADE_COLORS[g]) {
          ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: GRADE_COLORS[g] } };
          ws[ref].s.font = { name: 'Calibri', sz: 8, bold: true, color: { rgb: 'FFFFFFFF' } };
        }
      }
      if (h.endsWith(' Comment')) {
        const cKey = String(val || '').toUpperCase().trim();
        if (COMMENT_COLORS[cKey]) {
          ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: COMMENT_COLORS[cKey] } };
          ws[ref].s.font = { name: 'Calibri', sz: 8, bold: true, color: { rgb: 'FFFFFFFF' } };
        }
      }
      if (useNum && isPctCol(h)) ws[ref].s.numFmt = '0.00%';
      else if (useNum) ws[ref].s.numFmt = peopleRow ? '#,##0' : '#,##0.00';
      if (row.__totalRow || row.__supervisionTotalRow) {
        ws[ref].s.fill = { patternType: 'solid', fgColor: { rgb: 'FF1A237E' } };
        ws[ref].s.font = { name: 'Calibri', sz: 8, bold: true, color: { rgb: 'FFFFFFFF' } };
      }
    });
  });

  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length + 1, c: headers.length - 1 } });
  ws['!cols'] = headers.map((_, i) => ({ wch: Math.max(6, Math.round((table?.colWidths?.[i] || 10) * 0.75)) }));
  ws['!rows'] = Array.from({ length: rows.length + 2 }, (_, i) => ({ hpt: i < 2 ? 14 : 12 }));
  if (sheet?.freeze) {
    const splitRow = 2; // keep both month row and subheader row visible
    const splitCol = Math.max(0, sheet.freeze.col || 0);
    ws['!freeze'] = {
      xSplit: splitCol,
      ySplit: splitRow,
      topLeftCell: XLSX.utils.encode_cell({ r: splitRow, c: splitCol }),
      state: 'frozen',
    };
  }
  return ws;
};

export const buildGapWorkbookBuffer = async (sheets, fileName) => {
  const wb = XLSX.utils.book_new();
  const usedSheets = [];
  (sheets || []).forEach((sheet) => {
    const ws = buildSheet(sheet);
    if (!ws) return;
    XLSX.utils.book_append_sheet(wb, ws, (sheet.name || 'Sheet').substring(0, 31));
    usedSheets.push({ freeze: sheet.freeze });
  });
  if (!wb.SheetNames.length) return null;
  let buffer = new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }));
  if (usedSheets.some((s) => s.freeze && ((s.freeze.row || 0) > 0 || (s.freeze.col || 0) > 0))) {
    buffer = await injectFreezePanes(buffer, usedSheets);
  }
  const finalFileName = (fileName || 'Gap_Analysis.xlsx').toLowerCase().endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  return { buffer, fileName: finalFileName };
};

export const exportGapWorkbook = async (sheets, fileName) => {
  const built = await buildGapWorkbookBuffer(sheets, fileName);
  if (!built?.buffer) return;
  const blob = new Blob([built.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = built.fileName;
  a.click();
  URL.revokeObjectURL(url);
};

