/**
 * DIGITAL DATA — distribution Excel export.
 *
 * Scope is whatever the dropdowns select — every matching lead, distributed or
 * not — so the row count tracks the filter, not how much happens to have been
 * handed out already. A Distributed column marks which is which.
 *
 * Three sheets:
 *   Leads       — one row per lead with the person it was given to (if any)
 *   By Assignee — leads per person, plus a "not yet distributed" row so the
 *                 totals reconcile against the Leads sheet
 *   Filters     — exactly which dropdown selections produced this file,
 *                 so a downloaded workbook can always be reproduced
 *
 * Styling follows the project convention: plain bordered cells, a solid header
 * band, no decorative accent stripes.
 */

import XLSXStyle from 'xlsx-js-style';

const INK    = '1F2937';
const HEADER = '1E3A8A';
const BAND   = 'F1F5F9';
const LINE   = 'CBD5E1';

const border = {
  top:    { style: 'thin', color: { rgb: LINE } },
  bottom: { style: 'thin', color: { rgb: LINE } },
  left:   { style: 'thin', color: { rgb: LINE } },
  right:  { style: 'thin', color: { rgb: LINE } },
};

const titleCell = (v) => ({
  v,
  t: 's',
  s: {
    font: { bold: true, sz: 13, color: { rgb: INK } },
    alignment: { vertical: 'center' },
  },
});

const headerCell = (v) => ({
  v,
  t: 's',
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

const pretty = (s) => String(s ?? '').replace(/_/g, ' ').toLowerCase();

/** Build a worksheet from a title, header labels and body rows. */
function sheetFrom(title, headers, bodyRows, widths) {
  const aoa = [
    [titleCell(title)],
    [],
    headers.map(headerCell),
    ...bodyRows,
  ];
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  // Freeze the header band so long lead lists stay readable while scrolling.
  ws['!views'] = [{
    pane: {
      state: 'frozen', xSplit: 0, ySplit: 3,
      topLeftCell: 'A4', activePane: 'bottomRight',
    },
  }];
  return ws;
}

const LEAD_HEADERS = [
  'Date', 'Customer Name', 'Phone', 'Callable', 'Product', 'Platform', 'Status',
  'Converted', 'Loan Amount', 'Region', 'Comment',
  'Distributed', 'Assigned To', 'Assignee Role', 'Assignee Phone', 'Assignee Email',
  'Branch', 'Cluster', 'Zone', 'Assigned At',
  'Source Workbook', 'Source Tab', 'Source Row',
];

const LEAD_WIDTHS = [
  11, 26, 15, 9, 9, 12, 18, 10, 14, 16, 34,
  12, 22, 20, 15, 30, 22, 12, 12, 17,
  15, 20, 11,
];

function buildLeadsSheet(leads) {
  const rows = leads.map((l, i) => {
    const a = l.assignee || {};
    const band = i % 2 === 1;
    return [
      cell(l.date || '', { band }),
      cell(l.name || '', { band }),
      cell(l.phone || '', { band }),
      cell(l.phoneValid ? 'Yes' : 'No', { band }),
      cell(l.product || '', { band }),
      cell(pretty(l.platform), { band }),
      cell(pretty(l.status), { band }),
      cell(l.isConverted ? 'Yes' : 'No', { band }),
      cell(typeof l.loanAmount === 'number' ? l.loanAmount : '', { num: true, band }),
      cell(l.region || '', { band }),
      cell(l.comment || '', { band }),
      cell(a.name ? 'Yes' : 'No', { band, bold: true }),
      cell(a.name || '', { band, bold: true }),
      cell(a.role || '', { band }),
      cell(a.phone || '', { band }),
      cell(a.email || '', { band }),
      cell(a.branch || '', { band }),
      cell(a.cluster || '', { band }),
      cell(a.zone || '', { band }),
      cell(a.assignedAt || '', { band }),
      cell(l.sourceBook || '', { band }),
      cell(l.sourceTab || '', { band }),
      cell(l.sourceRow ?? '', { num: true, band }),
    ];
  });
  return sheetFrom('Distributed Leads', LEAD_HEADERS, rows, LEAD_WIDTHS);
}

const ASSIGNEE_HEADERS = [
  'Assignee', 'Role', 'Phone', 'Email', 'Branch', 'Cluster',
  'Leads', 'Callable', 'Converted', 'Products', 'Platforms',
];
const ASSIGNEE_WIDTHS = [24, 20, 15, 30, 24, 12, 9, 10, 11, 16, 24];

function buildAssigneeSheet(leads) {
  const byPerson = new Map();
  // Leads with no owner get their own row so the totals reconcile against the
  // Distributed Leads sheet rather than silently falling short.
  const unassigned = { name: '— not yet distributed —', role: '', phone: '', email: '',
    branch: '', cluster: '', leads: 0, callable: 0, converted: 0,
    products: new Set(), platforms: new Set() };

  leads.forEach((l) => {
    const a = l.assignee;
    if (!a?.name) {
      unassigned.leads += 1;
      if (l.phoneValid) unassigned.callable += 1;
      if (l.isConverted) unassigned.converted += 1;
      if (l.product) unassigned.products.add(l.product);
      if (l.platform) unassigned.platforms.add(pretty(l.platform));
      return;
    }
    const key = a.email || a.name;
    if (!byPerson.has(key)) {
      byPerson.set(key, {
        ...a, leads: 0, callable: 0, converted: 0,
        products: new Set(), platforms: new Set(),
      });
    }
    const p = byPerson.get(key);
    p.leads += 1;
    if (l.phoneValid) p.callable += 1;
    if (l.isConverted) p.converted += 1;
    if (l.product) p.products.add(l.product);
    if (l.platform) p.platforms.add(pretty(l.platform));
  });

  const list = [...byPerson.values()].sort((a, b) => b.leads - a.leads);
  if (unassigned.leads > 0) list.push(unassigned);

  const rows = list.map((p, i) => {
    const band = i % 2 === 1;
    return [
      cell(p.name, { band, bold: true }),
      cell(p.role || '', { band }),
      cell(p.phone || '', { band }),
      cell(p.email || '', { band }),
      cell(p.branch || '', { band }),
      cell(p.cluster || '', { band }),
      cell(p.leads, { num: true, band }),
      cell(p.callable, { num: true, band }),
      cell(p.converted, { num: true, band }),
      cell([...p.products].join(', '), { band }),
      cell([...p.platforms].join(', '), { band }),
    ];
  });

  // Totals row.
  if (list.length) {
    rows.push([
      cell('TOTAL', { bold: true }),
      cell(''), cell(''), cell(''), cell(''), cell(''),
      cell(list.reduce((s, p) => s + p.leads, 0), { num: true, bold: true }),
      cell(list.reduce((s, p) => s + p.callable, 0), { num: true, bold: true }),
      cell(list.reduce((s, p) => s + p.converted, 0), { num: true, bold: true }),
      cell(''), cell(''),
    ]);
  }

  return sheetFrom('Leads by Assignee', ASSIGNEE_HEADERS, rows, ASSIGNEE_WIDTHS);
}

const FILTER_LABELS = {
  product: 'Product',
  platform: 'Platform',
  status: 'Status',
  month: 'Month',
  book: 'Source workbook',
  search: 'Search',
  unique: 'Unique numbers only',
  validOnly: 'Callable numbers only',
};

function buildFiltersSheet(filters, leadCount, assignedCount) {
  const rows = [];
  Object.entries(FILTER_LABELS).forEach(([key, label]) => {
    const v = filters[key];
    if (v === undefined || v === null || v === '') return;
    rows.push([cell(label, { bold: true }), cell(v === '1' ? 'Yes' : String(v))]);
  });
  if (rows.length === 0) {
    rows.push([cell('Filters', { bold: true }), cell('None — every cleaned lead')]);
  }
  rows.push([cell('Leads exported', { bold: true }), cell(leadCount, { num: true })]);
  rows.push([cell('Of which distributed', { bold: true }), cell(assignedCount, { num: true })]);
  rows.push([cell('Not yet distributed', { bold: true }), cell(leadCount - assignedCount, { num: true })]);
  rows.push([cell('Generated', { bold: true }), cell(new Date().toLocaleString())]);

  return sheetFrom('Filters applied', ['Setting', 'Value'], rows, [26, 44]);
}

/**
 * Build and download the distribution workbook.
 *
 * Covers every lead matching the dropdown selection — not only the distributed
 * ones — with a Distributed Yes/No column, so the file size tracks the filters
 * the user actually set.
 *
 * @param {object[]} leads   leads (each optionally with .assignee) matching the filters
 * @param {object}   filters the dropdown selections that produced them
 */
export function downloadDistributionReport(leads, filters = {}) {
  const assignedCount = leads.filter((l) => l.assignee?.name).length;

  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, buildLeadsSheet(leads), 'Leads');
  XLSXStyle.utils.book_append_sheet(wb, buildAssigneeSheet(leads), 'By Assignee');
  XLSXStyle.utils.book_append_sheet(wb, buildFiltersSheet(filters, leads.length, assignedCount), 'Filters');

  const scope = [filters.product, filters.month].filter(Boolean).join('_');
  const date = new Date().toISOString().slice(0, 10);
  XLSXStyle.writeFile(wb, `Digital_Data_Distribution${scope ? `_${scope}` : ''}_${date}.xlsx`);
}

export default downloadDistributionReport;
