/**
 * CRM — distribution Excel export.
 *
 * Scope follows the dropdowns, so the row count tracks what is on screen. Each
 * row shows the Team Leader it went to, blank when not yet distributed.
 *
 * Plain styling per the house rules: solid header band, thin grey borders,
 * subtle banding, no accent stripes.
 */

import XLSXStyle from 'xlsx-js-style';

const INK = '1F2937';
const HEADER = '1E3A8A';
const BAND = 'F1F5F9';
const LINE = 'CBD5E1';

const border = {
  top: { style: 'thin', color: { rgb: LINE } },
  bottom: { style: 'thin', color: { rgb: LINE } },
  left: { style: 'thin', color: { rgb: LINE } },
  right: { style: 'thin', color: { rgb: LINE } },
};

const titleCell = (v) => ({
  v, t: 's',
  s: { font: { bold: true, sz: 13, color: { rgb: INK } }, alignment: { vertical: 'center' } },
});

const headerCell = (v) => ({
  v, t: 's',
  s: {
    font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: HEADER } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border,
  },
});

const cell = (v, { num = false, band = false, bold = false } = {}) => {
  const isNum = num && typeof v === 'number' && Number.isFinite(v);
  return {
    v: v === null || v === undefined ? '' : v,
    t: isNum ? 'n' : 's',
    s: {
      font: { sz: 10, bold, color: { rgb: INK } },
      alignment: { horizontal: isNum ? 'right' : 'left', vertical: 'center' },
      ...(band ? { fill: { fgColor: { rgb: BAND } } } : {}),
      ...(isNum ? { numFmt: '#,##0' } : {}),
      border,
    },
  };
};

function sheetFrom(title, headers, bodyRows, widths) {
  const ws = XLSXStyle.utils.aoa_to_sheet([
    [titleCell(title)], [], headers.map(headerCell), ...bodyRows,
  ]);
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  ws['!views'] = [{
    pane: { state: 'frozen', xSplit: 0, ySplit: 3, topLeftCell: 'A4', activePane: 'bottomRight' },
  }];
  return ws;
}

const LEAD_HEADERS = [
  'Client Name', 'Phone', 'Valid', 'Branch', 'Region', 'Team', 'CRM Assigned To',
  'Status', 'Consent', 'Consent Date', 'Created', 'Location', 'Comment',
  'Distributed', 'Team Leader', 'TL Email', 'Sent At', 'Times Updated',
];
const LEAD_WIDTHS = [26, 15, 7, 22, 22, 20, 20, 11, 11, 12, 12, 30, 34, 12, 22, 30, 17, 13];

function buildLeadsSheet(leads) {
  const rows = leads.map((l, i) => {
    const a = l.assignee || {};
    const band = i % 2 === 1;
    return [
      cell(l.name || '', { band }),
      cell(l.phone || '', { band }),
      cell(l.phoneValid ? 'Yes' : 'No', { band }),
      cell(l.branch || '', { band }),
      cell(l.region || '', { band }),
      cell(l.team || '', { band }),
      cell(l.crmAssignedTo || '', { band }),
      cell(l.status || '', { band }),
      cell(l.consentStatus || '', { band }),
      cell(l.consentDate || '', { band }),
      cell(l.createdDate || '', { band }),
      cell(l.location || '', { band }),
      cell(l.comment || '', { band }),
      cell(a.name ? 'Yes' : 'No', { band, bold: true }),
      cell(a.name || '', { band, bold: true }),
      cell(a.email || '', { band }),
      cell(a.sentAt || '', { band }),
      cell(l.updateCount ?? 0, { num: true, band }),
    ];
  });
  return sheetFrom('CRM Leads', LEAD_HEADERS, rows, LEAD_WIDTHS);
}

const TL_HEADERS = ['Team Leader', 'Email', 'Branch', 'Leads', 'Callable', 'Sent'];
const TL_WIDTHS = [24, 32, 26, 9, 10, 9];

function buildByTLSheet(leads) {
  const byTL = new Map();
  const unassigned = { name: '— not yet distributed —', email: '', branch: '',
    leads: 0, callable: 0, sent: 0 };

  leads.forEach((l) => {
    const a = l.assignee;
    const bucket = a?.name
      ? (byTL.get(a.email || a.name)
         || { name: a.name, email: a.email || '', branch: l.branch || '',
              leads: 0, callable: 0, sent: 0 })
      : unassigned;
    bucket.leads += 1;
    if (l.phoneValid) bucket.callable += 1;
    if (a?.sentAt) bucket.sent += 1;
    if (a?.name) byTL.set(a.email || a.name, bucket);
  });

  const list = [...byTL.values()].sort((x, y) => y.leads - x.leads);
  if (unassigned.leads > 0) list.push(unassigned);

  const rows = list.map((p, i) => {
    const band = i % 2 === 1;
    return [
      cell(p.name, { band, bold: true }),
      cell(p.email, { band }),
      cell(p.branch, { band }),
      cell(p.leads, { num: true, band }),
      cell(p.callable, { num: true, band }),
      cell(p.sent, { num: true, band }),
    ];
  });

  if (list.length) {
    rows.push([
      cell('TOTAL', { bold: true }), cell(''), cell(''),
      cell(list.reduce((s, p) => s + p.leads, 0), { num: true, bold: true }),
      cell(list.reduce((s, p) => s + p.callable, 0), { num: true, bold: true }),
      cell(list.reduce((s, p) => s + p.sent, 0), { num: true, bold: true }),
    ]);
  }
  return sheetFrom('Leads by Team Leader', TL_HEADERS, rows, TL_WIDTHS);
}

const FILTER_LABELS = {
  status: 'Status', branch: 'Branch', region: 'Region', team: 'Team',
  search: 'Search', validOnly: 'Callable numbers only',
  routable: 'Has a Team Leader', unassigned: 'Not yet distributed',
  assigned: 'Already distributed',
};

function buildFiltersSheet(filters, leadCount, assignedCount) {
  const rows = [];
  Object.entries(FILTER_LABELS).forEach(([k, label]) => {
    const v = filters[k];
    if (v === undefined || v === null || v === '') return;
    rows.push([cell(label, { bold: true }), cell(v === '1' ? 'Yes' : String(v))]);
  });
  if (rows.length === 0) rows.push([cell('Filters', { bold: true }), cell('None — every CRM lead')]);
  rows.push([cell('Leads exported', { bold: true }), cell(leadCount, { num: true })]);
  rows.push([cell('Of which distributed', { bold: true }), cell(assignedCount, { num: true })]);
  rows.push([cell('Not yet distributed', { bold: true }), cell(leadCount - assignedCount, { num: true })]);
  rows.push([cell('Generated', { bold: true }), cell(new Date().toLocaleString())]);
  return sheetFrom('Filters applied', ['Setting', 'Value'], rows, [26, 44]);
}

/**
 * Build and download the CRM workbook.
 * @param {object[]} leads   leads matching the current filters
 * @param {object}   filters the dropdown selections that produced them
 */
export function downloadCRMReport(leads, filters = {}) {
  const assigned = leads.filter((l) => l.assignee?.name).length;
  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, buildLeadsSheet(leads), 'Leads');
  XLSXStyle.utils.book_append_sheet(wb, buildByTLSheet(leads), 'By Team Leader');
  XLSXStyle.utils.book_append_sheet(wb, buildFiltersSheet(filters, leads.length, assigned), 'Filters');

  const scope = [filters.branch, filters.status].filter(Boolean).join('_').replace(/[^\w-]/g, '');
  const date = new Date().toISOString().slice(0, 10);
  XLSXStyle.writeFile(wb, `CRM_Leads${scope ? `_${scope}` : ''}_${date}.xlsx`);
}

export default downloadCRMReport;
