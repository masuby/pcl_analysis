/**
 * CS is reported as two departments — CS Mainland and CS Zanzibar.
 *
 * This is a direct port of `zanzibar_mask` / `scope_frames` in
 * C:\Users\Daniel\Desktop\code\pcl\CRM\crm_reports.py, which is the definition
 * of record. Keep the two in step: if the rule changes there, change it here,
 * or the web figures and the emailed workbooks will disagree about who is in
 * which half — and both are read by the same people in the same meeting.
 *
 * The rule, in words:
 *
 *   Zone says ZANZIBAR                         -> Zanzibar
 *   Zone is known and does not say ZANZIBAR    -> Mainland
 *   Zone is unknown (blank / ERR / NaN / None) -> fall back to the branch,
 *                                                 tenant or region text
 *
 * The fallback matters because the Zone column is genuinely empty for some
 * users, while their tenant is named 'ZANZIBAR MOHAMED' or their branch is
 * 'Pemba Branch'. Without it those rows land in Mainland and the Zanzibar
 * subtotals come out short.
 */

/** Zone values that mean "we do not know", not "mainland". */
const BLANK_GROUPS = new Set(['', 'ERR', 'NAN', 'NONE', 'NULL', 'N/A', '-']);

/**
 * Names that mark a CS row as Zanzibar when its Zone is unknown. The tenants
 * are named 'ZANZIBAR MOHAMED', 'Zanzibar Pemba', 'ZANZIBAR LOREN'; the
 * branches on the online sheet are Zanzibar Main Branch, Michenzani Mall
 * Branch and Pemba Branch.
 */
export const ZANZIBAR_HINTS = ['ZANZIBAR', 'PEMBA', 'MICHENZANI', 'UNGUJA'];

const norm = (v) => String(v ?? '').toUpperCase().trim();

/** Fields consulted, in order, when the Zone is unknown. */
const FALLBACK_FIELDS = [
  'Tenant', 'tenant',
  'Branch', 'branch', 'Branch_Name', 'branchName',
  'Region', 'region',
  'Supervision', 'supervision', 'Supervision_Name', 'supervisionName',
];

/** True when free text names a Zanzibar tenant, branch or region. */
export const textLooksZanzibar = (text) => {
  const t = norm(text);
  return t !== '' && ZANZIBAR_HINTS.some((h) => t.includes(h));
};

/**
 * Decide which half of CS a row belongs to.
 *
 * @param {object} row       any record carrying a zone and/or branch-ish field
 * @param {object} [opts]
 * @param {string[]} [opts.zoneFields]     where to look for the zone
 * @param {string[]} [opts.fallbackFields] where to look when the zone is unknown
 * @returns {boolean} true for Zanzibar
 */
export const isZanzibarRow = (row, opts = {}) => {
  if (!row) return false;
  const zoneFields = opts.zoneFields || ['Zone', 'zone', 'Zone_Name', 'zoneName'];
  const fallbackFields = opts.fallbackFields || FALLBACK_FIELDS;

  let zone = '';
  for (const f of zoneFields) {
    if (row[f] != null && norm(row[f]) !== '') { zone = norm(row[f]); break; }
  }

  if (zone.includes('ZANZIBAR')) return true;
  // A zone we can read and that does not say Zanzibar is Mainland — do not let
  // a branch called 'Pemba Road' in a mainland zone drag the row across.
  if (zone !== '' && !BLANK_GROUPS.has(zone)) return false;

  return fallbackFields.some((f) => textLooksZanzibar(row[f]));
};

/** 'Zanzibar' | 'Mainland' — the label used in headings and subtotal rows. */
export const csScopeOf = (row, opts) => (isZanzibarRow(row, opts) ? 'Zanzibar' : 'Mainland');

/**
 * Split rows into the two blocks a CS report shows.
 * @returns {{mainland: object[], zanzibar: object[]}}
 */
export const splitCsRows = (rows, opts) => {
  const mainland = [];
  const zanzibar = [];
  for (const r of rows || []) (isZanzibarRow(r, opts) ? zanzibar : mainland).push(r);
  return { mainland, zanzibar };
};

/** The two blocks in the order they are shown, Mainland first. */
export const CS_SECTIONS = [
  { key: 'mainland', label: 'Mainland' },
  { key: 'zanzibar', label: 'Zanzibar' },
];
