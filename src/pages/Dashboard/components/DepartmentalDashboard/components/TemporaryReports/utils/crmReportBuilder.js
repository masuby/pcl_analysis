import * as XLSX from 'xlsx-js-style';
import { getReportsByDepartmentAndType, getReportFileUrl } from '../../../../../../../services/reports';

const TARGET_YEAR = 2026;
const SUMMARY_MONTHS = [0, 1, 2]; // Jan, Feb, Mar
const CONSENT_KEYS = ['ACCEPTED', 'NOT PROVIDED', 'REJECTED'];
const DEPARTMENTS = ['CS', 'LBF', 'SME'];
const WORKBOOK_CACHE_VERSION = 'v3_dept_colors';
const DEPT_COLORS = {
  CS: { dark: 'FF1E3A8A', mid: 'FF2563EB', light: 'FFDBEAFE' },
  LBF: { dark: 'FF14532D', mid: 'FF16A34A', light: 'FFDCFCE7' },
  SME: { dark: 'FF581C87', mid: 'FFA855F7', light: 'FFF3E8FF' },
};

const normalize = (value) => String(value ?? '').trim().toUpperCase();
const normalizeNoSpace = (value) => normalize(value).replace(/[\s_]+/g, '');

const toDate = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};
const isQ1Target = (date) => !!date && date.getFullYear() === TARGET_YEAR && SUMMARY_MONTHS.includes(date.getMonth());

const getConsentBucket = (row) => {
  const raw = row?.Consent_Status ?? row?.CONSENT_STATUS ?? row?.consent_status ?? row?.Status ?? row?.status ?? '';
  const key = normalize(raw).replace(/_/g, ' ');
  if (key.includes('NOT PROVIDED') || key.includes('NOTPROVIDED')) return 'NOT PROVIDED';
  if (key.includes('ACCEPT')) return 'ACCEPTED';
  if (key.includes('REJECT')) return 'REJECTED';
  return null;
};

const pickFirstValue = (row, keys) => {
  for (const key of Object.keys(row || {})) {
    const nk = normalizeNoSpace(key);
    if (keys.some((candidate) => normalizeNoSpace(candidate) === nk)) return row[key];
  }
  return '';
};

const getRowProduct = (row) => {
  const value = pickFirstValue(row, ['Product', 'PRODUCT']);
  return normalize(value);
};

const sanitizeLeadRow = (row, department, reportDate) => ({
  ReportDate: reportDate.toISOString().split('T')[0],
  Name: pickFirstValue(row, ['Name', 'Customer Name']),
  Created_By: pickFirstValue(row, ['Created_By', 'Created By', 'CreatedBy']),
  Branch: pickFirstValue(row, ['Branch']),
  Product: pickFirstValue(row, ['Product']),
  Consent_Status: pickFirstValue(row, ['Consent_Status', 'Consent Status', 'Status']),
  Contact_Number: pickFirstValue(row, ['Contact_Number', 'Contact Number', 'Phone', 'Phone Number']),
  __Department: department,
});

const pickLeadSheet = (workbook) => {
  const match = (workbook.SheetNames || []).find((name) => normalize(name).replace(/\s+/g, '_') === 'LEAD_REPORT');
  return match || null;
};

const buildSummaryRows = (monthlyTotals) => {
  const monthNames = ['January', 'February', 'March'];
  const rows = [];
  for (let i = 0; i < SUMMARY_MONTHS.length; i += 1) {
    const monthIdx = SUMMARY_MONTHS[i];
    const label = monthNames[i];
    const row = { Month: label };
    DEPARTMENTS.forEach((dept) => {
      const stats = monthlyTotals[dept]?.[monthIdx] || {};
      row[`${dept} Accepted`] = Number(stats.ACCEPTED || 0);
      row[`${dept} Not Provided`] = Number(stats['NOT PROVIDED'] || 0);
      row[`${dept} Rejected`] = Number(stats.REJECTED || 0);
    });
    rows.push(row);
  }

  const totalRow = { Month: 'Total' };
  DEPARTMENTS.forEach((dept) => {
    const totalStats = {};
    CONSENT_KEYS.forEach((key) => {
      totalStats[key] = SUMMARY_MONTHS.reduce((sum, monthIdx) => sum + Number(monthlyTotals[dept]?.[monthIdx]?.[key] || 0), 0);
    });
    totalRow[`${dept} Accepted`] = totalStats.ACCEPTED;
    totalRow[`${dept} Not Provided`] = totalStats['NOT PROVIDED'];
    totalRow[`${dept} Rejected`] = totalStats.REJECTED;
  });
  rows.push(totalRow);
  return rows;
};

const sheetFromRows = (rows, fallback) => {
  if (!rows.length) return XLSX.utils.json_to_sheet([fallback]);
  return XLSX.utils.json_to_sheet(rows);
};

const applyCell = (ws, row, col, value, style) => {
  const ref = XLSX.utils.encode_cell({ r: row, c: col });
  ws[ref] = { t: typeof value === 'number' ? 'n' : 's', v: value, s: style };
};

const buildSummaryStyledSheet = (summaryRows) => {
  const ws = {};
  const headerTopStyle = (rgb) => ({
    fill: { patternType: 'solid', fgColor: { rgb } },
    font: { bold: true, color: { rgb: 'FFFFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  });
  const headerSubStyle = (rgb) => ({
    fill: { patternType: 'solid', fgColor: { rgb } },
    font: { bold: true, color: { rgb: 'FFFFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  });
  const bodyStyle = {
    alignment: { horizontal: 'right', vertical: 'center' },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  };
  const monthStyle = {
    ...bodyStyle,
    alignment: { horizontal: 'left', vertical: 'center' },
    font: { bold: true, color: { rgb: 'FF1E293B' } },
  };
  const totalStyle = {
    ...bodyStyle,
    fill: { patternType: 'solid', fgColor: { rgb: 'FFE8F0FF' } },
    font: { bold: true, color: { rgb: 'FF1E3A8A' } },
  };

  applyCell(ws, 0, 0, 'Month', headerTopStyle('FF0F172A'));
  applyCell(ws, 0, 1, 'CS', headerTopStyle(DEPT_COLORS.CS.dark));
  applyCell(ws, 0, 4, 'LBF', headerTopStyle(DEPT_COLORS.LBF.dark));
  applyCell(ws, 0, 7, 'SME', headerTopStyle(DEPT_COLORS.SME.dark));

  const subHeaders = ['Accepted', 'Not Provided', 'Rejected'];
  applyCell(ws, 1, 0, 'Month', headerSubStyle('FF334155'));
  [
    { startCol: 1, rgb: DEPT_COLORS.CS.mid },
    { startCol: 4, rgb: DEPT_COLORS.LBF.mid },
    { startCol: 7, rgb: DEPT_COLORS.SME.mid },
  ].forEach(({ startCol, rgb }) => {
    subHeaders.forEach((label, i) => {
      applyCell(ws, 1, startCol + i, label, headerSubStyle(rgb));
    });
  });

  summaryRows.forEach((row, idx) => {
    const excelRow = idx + 2;
    const isTotal = row.Month === 'Total';
    applyCell(ws, excelRow, 0, row.Month, isTotal ? { ...monthStyle, ...totalStyle } : monthStyle);
    const values = [
      row['CS Accepted'], row['CS Not Provided'], row['CS Rejected'],
      row['LBF Accepted'], row['LBF Not Provided'], row['LBF Rejected'],
      row['SME Accepted'], row['SME Not Provided'], row['SME Rejected'],
    ];
    values.forEach((val, i) => {
      const col = 1 + i;
      const deptFill =
        col >= 1 && col <= 3 ? DEPT_COLORS.CS.light
          : col >= 4 && col <= 6 ? DEPT_COLORS.LBF.light
            : DEPT_COLORS.SME.light;
      const deptBodyStyle = {
        ...bodyStyle,
        fill: { patternType: 'solid', fgColor: { rgb: deptFill } },
      };
      applyCell(ws, excelRow, col, Number(val || 0), isTotal ? totalStyle : deptBodyStyle);
    });
  });

  // Secondary 2-column totals table: all products combined by category
  const totalsSource = summaryRows.find((row) => row.Month === 'Total') || {};
  const acceptedTotal = Number(totalsSource['CS Accepted'] || 0) + Number(totalsSource['LBF Accepted'] || 0) + Number(totalsSource['SME Accepted'] || 0);
  const notProvidedTotal = Number(totalsSource['CS Not Provided'] || 0) + Number(totalsSource['LBF Not Provided'] || 0) + Number(totalsSource['SME Not Provided'] || 0);
  const rejectedTotal = Number(totalsSource['CS Rejected'] || 0) + Number(totalsSource['LBF Rejected'] || 0) + Number(totalsSource['SME Rejected'] || 0);
  const overallTotal = acceptedTotal + notProvidedTotal + rejectedTotal;

  const miniHeaderStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: 'FF0F172A' } },
    font: { bold: true, color: { rgb: 'FFFFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  };
  const miniRowStyle = {
    alignment: { horizontal: 'left', vertical: 'center' },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
    fill: { patternType: 'solid', fgColor: { rgb: 'FFF8FAFC' } },
  };
  const miniValueStyle = {
    ...miniRowStyle,
    alignment: { horizontal: 'right', vertical: 'center' },
    font: { bold: true, color: { rgb: 'FF1E293B' } },
  };
  const miniTotalStyle = {
    ...miniRowStyle,
    fill: { patternType: 'solid', fgColor: { rgb: 'FFE2E8F0' } },
    font: { bold: true, color: { rgb: 'FF0F172A' } },
  };

  const miniStartRow = summaryRows.length + 4;
  applyCell(ws, miniStartRow, 0, 'Category', miniHeaderStyle);
  applyCell(ws, miniStartRow, 1, 'Total', miniHeaderStyle);

  const miniRows = [
    { label: 'Accepted', value: acceptedTotal },
    { label: 'Not Provided', value: notProvidedTotal },
    { label: 'Rejected', value: rejectedTotal },
    { label: 'All Leads', value: overallTotal, isTotal: true },
  ];
  miniRows.forEach((item, idx) => {
    const r = miniStartRow + 1 + idx;
    const leftStyle = item.isTotal ? miniTotalStyle : miniRowStyle;
    const rightStyle = item.isTotal ? { ...miniTotalStyle, alignment: { horizontal: 'right', vertical: 'center' } } : miniValueStyle;
    applyCell(ws, r, 0, item.label, leftStyle);
    applyCell(ws, r, 1, item.value, rightStyle);
  });

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
    { s: { r: 0, c: 1 }, e: { r: 0, c: 3 } },
    { s: { r: 0, c: 4 }, e: { r: 0, c: 6 } },
    { s: { r: 0, c: 7 }, e: { r: 0, c: 9 } },
  ];
  ws['!cols'] = [{ wch: 16 }, ...Array.from({ length: 9 }, () => ({ wch: 14 }))];
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: miniStartRow + miniRows.length, c: 9 } });
  return ws;
};

const buildDepartmentSheet = (department, rows) => {
  const ws = {};
  const deptTheme = DEPT_COLORS[department] || DEPT_COLORS.CS;
  const columns = ['Report Date', 'Name', 'Created_By', 'Branch', 'Product', 'Consent_Status', 'Contact_Number'];
  const statusDefs = [
    { key: 'ACCEPTED', title: `${department} - ACCEPTED`, color: 'FFD1FAE5', rowA: 'FFF0FDF4', rowB: 'FFDCFCE7' },
    { key: 'NOT PROVIDED', title: `${department} - NOT PROVIDED`, color: 'FFFEF3C7', rowA: 'FFFFFBEB', rowB: 'FFFEF3C7' },
    { key: 'REJECTED', title: `${department} - REJECTED`, color: 'FFFEE2E2', rowA: 'FFFEF2F2', rowB: 'FFFECACA' },
  ];
  const sectionHeaderStyle = (rgb) => ({
    fill: { patternType: 'solid', fgColor: { rgb } },
    font: { bold: true, color: { rgb: 'FF1F2937' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  });
  const colHeaderStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: deptTheme.dark } },
    font: { bold: true, color: { rgb: 'FFFFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  };
  const rowStyle = {
    alignment: { horizontal: 'left', vertical: 'center' },
    border: { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } },
  };
  const totalStyle = (rgb) => ({
    fill: { patternType: 'solid', fgColor: { rgb } },
    font: { bold: true, color: { rgb: 'FF1E293B' } },
    alignment: { horizontal: 'left', vertical: 'center' },
    border: { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } },
  });

  let currentRow = 0;
  statusDefs.forEach((statusDef, sectionIndex) => {
    applyCell(ws, currentRow, 0, statusDef.title, sectionHeaderStyle(statusDef.color));
    ws['!merges'] = ws['!merges'] || [];
    ws['!merges'].push({ s: { r: currentRow, c: 0 }, e: { r: currentRow, c: columns.length - 1 } });
    currentRow += 1;

    columns.forEach((col, colIndex) => applyCell(ws, currentRow, colIndex, col, colHeaderStyle));
    currentRow += 1;

    const sectionRows = rows.filter((row) => normalize(getConsentBucket(row)) === statusDef.key);
    if (!sectionRows.length) {
      applyCell(ws, currentRow, 0, 'No records', rowStyle);
      columns.slice(1).forEach((_, colIndex) => applyCell(ws, currentRow, colIndex + 1, '', rowStyle));
      currentRow += 1;
    } else {
      sectionRows.forEach((row, rowIndex) => {
        const values = [
          row.ReportDate,
          row.Name,
          row.Created_By,
          row.Branch,
          row.Product,
          row.Consent_Status,
          row.Contact_Number,
        ];
        const layeredStyle = {
          ...rowStyle,
          fill: { patternType: 'solid', fgColor: { rgb: rowIndex % 2 === 0 ? statusDef.rowA : statusDef.rowB } },
        };
        values.forEach((val, colIndex) => applyCell(ws, currentRow, colIndex, val ?? '', layeredStyle));
        currentRow += 1;
      });
    }
    const totalLeads = sectionRows.length;
    applyCell(ws, currentRow, 0, `TOTAL ${statusDef.key} LEADS`, totalStyle(statusDef.color));
    applyCell(ws, currentRow, 1, totalLeads, { ...totalStyle(statusDef.color), alignment: { horizontal: 'right', vertical: 'center' } });
    for (let col = 2; col < columns.length; col += 1) {
      applyCell(ws, currentRow, col, '', totalStyle(statusDef.color));
    }
    currentRow += 1;
    if (sectionIndex < statusDefs.length - 1) currentRow += 1;
  });

  ws['!cols'] = [
    { wch: 14 }, { wch: 28 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 18 },
  ];
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, currentRow - 1), c: columns.length - 1 } });
  return ws;
};

const buildUiSummaryRows = (monthlyTotals) => {
  const monthNames = ['January', 'February', 'March'];
  return SUMMARY_MONTHS.map((monthIdx, index) => ({
    month: monthNames[index],
    CS: {
      accepted: Number(monthlyTotals.CS?.[monthIdx]?.ACCEPTED || 0),
      notProvided: Number(monthlyTotals.CS?.[monthIdx]?.['NOT PROVIDED'] || 0),
      rejected: Number(monthlyTotals.CS?.[monthIdx]?.REJECTED || 0),
    },
    LBF: {
      accepted: Number(monthlyTotals.LBF?.[monthIdx]?.ACCEPTED || 0),
      notProvided: Number(monthlyTotals.LBF?.[monthIdx]?.['NOT PROVIDED'] || 0),
      rejected: Number(monthlyTotals.LBF?.[monthIdx]?.REJECTED || 0),
    },
    SME: {
      accepted: Number(monthlyTotals.SME?.[monthIdx]?.ACCEPTED || 0),
      notProvided: Number(monthlyTotals.SME?.[monthIdx]?.['NOT PROVIDED'] || 0),
      rejected: Number(monthlyTotals.SME?.[monthIdx]?.REJECTED || 0),
    },
  }));
};

const buildUiTotals = (uiSummaryRows) => {
  const init = { accepted: 0, notProvided: 0, rejected: 0 };
  return uiSummaryRows.reduce(
    (acc, row) => {
      DEPARTMENTS.forEach((dept) => {
        acc[dept].accepted += row[dept].accepted;
        acc[dept].notProvided += row[dept].notProvided;
        acc[dept].rejected += row[dept].rejected;
      });
      return acc;
    },
    { CS: { ...init }, LBF: { ...init }, SME: { ...init } }
  );
};

const getReportFingerprint = (deptReportsMap) => DEPARTMENTS
  .flatMap((dept) => (deptReportsMap[dept] || []).map((r) => {
    const d = toDate(r.date || r.created_at || r.createdAt);
    const stamp = d ? d.toISOString().split('T')[0] : 'na';
    return `${dept}:${r.id || r.fileName || r.file_name}:${stamp}`;
  }))
  .sort()
  .join('|');

export const buildCrmWorkbookData = async ({ onProgress } = {}) => {
  const monthlyTotals = {
    CS: {},
    LBF: {},
    SME: {},
  };
  const detailedRows = {
    CS: [],
    LBF: [],
    SME: [],
  };
  const processedReportsByDept = { CS: 0, LBF: 0, SME: 0 };
  const acceptedReportsByDept = { CS: 0, LBF: 0, SME: 0 };

  const progress = (phase, value, message) => {
    if (typeof onProgress === 'function') onProgress({ phase, value, message });
  };

  progress('starting', 0, 'Preparing CRM report build...');

  const reportsByDept = {};
  const departmentResponses = await Promise.all(
    DEPARTMENTS.map(async (department) => ({ department, response: await getReportsByDepartmentAndType(department, 'CRM') }))
  );
  departmentResponses.forEach(({ department, response }) => {
    if (!response?.success) {
      reportsByDept[department] = [];
      return;
    }
    reportsByDept[department] = (response.data || []).filter((report) => isQ1Target(toDate(report.date || report.created_at || report.createdAt)));
  });
  const totalPotentialReports = DEPARTMENTS.reduce((sum, dept) => sum + (reportsByDept[dept]?.length || 0), 0);

  const fingerprint = getReportFingerprint(reportsByDept);
  const cacheKey = `tmp_crm_report_${WORKBOOK_CACHE_VERSION}`;
  try {
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached?.fingerprint === fingerprint && cached?.payload) {
        progress('done', 100, 'Loaded CRM report from cache.');
        return cached.payload;
      }
    }
  } catch {
    // ignore cache issues
  }

  let globalProcessed = 0;
  progress('loading', 5, `Found ${totalPotentialReports} CRM reports for 2026.`);

  const reportTasks = DEPARTMENTS.flatMap((department) => (reportsByDept[department] || []).map((report) => ({ department, report })));
  await Promise.all(reportTasks.map(async ({ department, report }) => {
    const reportDate = toDate(report.date || report.created_at || report.createdAt);
    if (!isQ1Target(reportDate)) {
      globalProcessed += 1;
      processedReportsByDept[department] += 1;
      return;
    }

    const fileName = report.fileName || report.file_name || report.title || `${department}_CRM`;
    let fileUrl = report.fileUrl || report.file_url || '';
    if (!fileUrl && (report.filePath || report.file_path)) {
      fileUrl = await getReportFileUrl(report.filePath || report.file_path);
    }
    if (!fileUrl) {
      globalProcessed += 1;
      processedReportsByDept[department] += 1;
      const ratio = totalPotentialReports > 0 ? Math.round((globalProcessed / totalPotentialReports) * 100) : 100;
      progress('loading', Math.min(95, ratio), `Loading ${department} CRM reports...`);
      return;
    }

    let workbook;
    try {
      const fetched = await fetch(fileUrl);
      if (!fetched.ok) throw new Error('Failed to fetch report');
      const ab = await fetched.arrayBuffer();
      workbook = XLSX.read(ab, { type: 'array', raw: false });
    } catch {
      globalProcessed += 1;
      processedReportsByDept[department] += 1;
      const ratio = totalPotentialReports > 0 ? Math.round((globalProcessed / totalPotentialReports) * 100) : 100;
      progress('loading', Math.min(95, ratio), `Loading ${department} CRM reports...`);
      return;
    }

    const sheetName = pickLeadSheet(workbook);
    if (!sheetName) {
      globalProcessed += 1;
      processedReportsByDept[department] += 1;
      const ratio = totalPotentialReports > 0 ? Math.round((globalProcessed / totalPotentialReports) * 100) : 100;
      progress('loading', Math.min(95, ratio), `Loading ${department} CRM reports...`);
      return;
    }
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    if (!rows.length) {
      globalProcessed += 1;
      processedReportsByDept[department] += 1;
      const ratio = totalPotentialReports > 0 ? Math.round((globalProcessed / totalPotentialReports) * 100) : 100;
      progress('loading', Math.min(95, ratio), `Loading ${department} CRM reports...`);
      return;
    }

    const localSummary = {};
    const localRows = [];
    for (const row of rows) {
      const consent = getConsentBucket(row);
      if (!consent) continue;
      const product = getRowProduct(row);
      if (product !== department) continue;

      const monthIdx = reportDate.getMonth();
      if (!localSummary[monthIdx]) {
        localSummary[monthIdx] = { ACCEPTED: 0, 'NOT PROVIDED': 0, REJECTED: 0 };
      }
      localSummary[monthIdx][consent] += 1;
      localRows.push(sanitizeLeadRow(row, department, reportDate, fileName));
    }

    Object.entries(localSummary).forEach(([monthIdxRaw, monthStats]) => {
      const monthIdx = Number(monthIdxRaw);
      if (!monthlyTotals[department][monthIdx]) {
        monthlyTotals[department][monthIdx] = { ACCEPTED: 0, 'NOT PROVIDED': 0, REJECTED: 0 };
      }
      monthlyTotals[department][monthIdx].ACCEPTED += monthStats.ACCEPTED;
      monthlyTotals[department][monthIdx]['NOT PROVIDED'] += monthStats['NOT PROVIDED'];
      monthlyTotals[department][monthIdx].REJECTED += monthStats.REJECTED;
    });
    detailedRows[department].push(...localRows);
    acceptedReportsByDept[department] += 1;
    globalProcessed += 1;
    processedReportsByDept[department] += 1;
    const ratio = totalPotentialReports > 0 ? Math.round((globalProcessed / totalPotentialReports) * 100) : 100;
    progress('loading', Math.min(95, ratio), `Loading ${department} CRM reports...`);
  }));

  progress('finalizing', 96, 'Preparing workbook sheets...');
  const summaryRows = buildSummaryRows(monthlyTotals);
  const uiSummaryRows = buildUiSummaryRows(monthlyTotals);
  const uiTotals = buildUiTotals(uiSummaryRows);
  progress('done', 100, 'CRM report ready.');

  const payload = {
    summaryRows,
    uiSummaryRows,
    uiTotals,
    detailedRows,
    meta: {
      processedReportsByDept,
      acceptedReportsByDept,
      totalPotentialReports,
      totalLeadRows: DEPARTMENTS.reduce((sum, dept) => sum + detailedRows[dept].length, 0),
    },
    workbook: {
      Summary: buildSummaryStyledSheet(summaryRows),
      CS: buildDepartmentSheet('CS', detailedRows.CS),
      LBF: buildDepartmentSheet('LBF', detailedRows.LBF),
      SME: buildDepartmentSheet('SME', detailedRows.SME),
    },
  };
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ fingerprint, payload }));
  } catch {
    // ignore storage failures
  }
  return payload;
};

