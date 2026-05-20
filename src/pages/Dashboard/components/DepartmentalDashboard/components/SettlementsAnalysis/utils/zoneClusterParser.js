import * as XLSX from 'xlsx';

/**
 * Parse a Zone & Cluster XLSX file (or blob) and return:
 *  - branchToProduct: Map<normalizedBranchName, product>
 *  - products: Set<product>
 *  - rawRows: the flat array of { zone, branch, cluster, product }
 *
 * The user's Zone & Cluster workbook has 4 columns in the first (only) sheet:
 *   Zone | Branch | Cluster | Product
 *
 * File/sheet name may change over time, so we do not rely on them. Column matching
 * is done by header name, case-insensitive.
 */

const normalizeKey = (v) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const readWorkbookFromAny = async (input) => {
  if (!input) throw new Error('No Zone & Cluster file provided');
  if (input instanceof ArrayBuffer) {
    return XLSX.read(input, { type: 'array' });
  }
  if (input instanceof Uint8Array) {
    return XLSX.read(input, { type: 'array' });
  }
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    const buf = await input.arrayBuffer();
    return XLSX.read(buf, { type: 'array' });
  }
  if (typeof input === 'string') {
    return XLSX.read(input, { type: 'base64' });
  }
  throw new Error('Unsupported zone/cluster input type');
};

export const parseZoneClusterWorkbook = async (input) => {
  const wb = await readWorkbookFromAny(input);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Zone & Cluster workbook has no sheets');

  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });

  const branchToProduct = new Map();
  const products = new Set();
  const rawRows = [];

  for (const row of rows) {
    const keys = Object.keys(row);
    const zoneKey = keys.find((k) => normalizeKey(k) === 'zone');
    const branchKey = keys.find((k) => normalizeKey(k) === 'branch');
    const clusterKey = keys.find((k) => normalizeKey(k) === 'cluster');
    const productKey = keys.find((k) => normalizeKey(k) === 'product');

    const branch = branchKey ? String(row[branchKey] ?? '').trim() : '';
    const product = productKey ? String(row[productKey] ?? '').trim() : '';
    if (!branch || !product) continue;

    const nkey = normalizeKey(branch);
    if (!branchToProduct.has(nkey)) {
      branchToProduct.set(nkey, product);
    }
    products.add(product);

    rawRows.push({
      zone: zoneKey ? String(row[zoneKey] ?? '').trim() : '',
      branch,
      cluster: clusterKey ? String(row[clusterKey] ?? '').trim() : '',
      product,
    });
  }

  return { branchToProduct, products, rawRows };
};

/**
 * Resolve a transactions-sheet branch name to a product using the branch map.
 * The mapping tolerates capitalization / extra whitespace differences.
 *
 * Returns '' when the branch cannot be mapped (so the caller can count it under
 * an "Unmapped" bucket without throwing).
 */
export const resolveProductForBranch = (branchToProduct, branch) => {
  if (!branchToProduct || !branch) return '';
  const nkey = normalizeKey(branch);
  if (branchToProduct.has(nkey)) return branchToProduct.get(nkey);

  // Some branch names differ only in LBF casing (e.g. "LBF CITY CENTRE" vs "LBF City Mall").
  // Try a best-effort fuzzy match by prefix for LBF/SME/CS, which all follow a product prefix convention.
  for (const prefix of ['LBF', 'SME', 'CS']) {
    if (nkey.startsWith(prefix.toLowerCase() + ' ') || nkey === prefix.toLowerCase()) {
      return prefix;
    }
  }
  return '';
};
