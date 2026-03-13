/**
 * Load Zone and cluster.xlsx to get Branch -> Zone, Cluster, Product.
 * Zone column = Region (e.g. Nyasa region = Nyasa Zone in display).
 * Used to filter CS KPI analysis by Cluster 1, Cluster 2, Cluster 3, Zanzibar.
 */
import * as XLSX from 'xlsx';

/** Public URL for Zone and cluster.xlsx (same folder as component). */
export const ZONE_CLUSTER_FILE_URL = new URL('../Zone and cluster.xlsx', import.meta.url).href;

let cachedMapping = null;
let cachedBranchToCluster = null;
let cachedBranchesByCluster = null;

/**
 * Load and parse Zone and cluster.xlsx.
 * @returns {Promise<Array<{ branch: string, zone: string, cluster: string, product: string }>>}
 */
export async function loadZoneClusterMapping() {
  if (cachedMapping) return cachedMapping;
  const res = await fetch(ZONE_CLUSTER_FILE_URL);
  if (!res.ok) throw new Error('Failed to load Zone and cluster file');
  const ab = await res.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array', raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]] || wb.Sheets[0];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows.length) {
    cachedMapping = [];
    return cachedMapping;
  }
  const headers = (rows[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
  const zoneIdx = headers.findIndex((h) => h.includes('zone') && !h.includes('cluster'));
  const branchIdx = headers.findIndex((h) => h.includes('branch'));
  const clusterIdx = headers.findIndex((h) => h.includes('cluster'));
  const productIdx = headers.findIndex((h) => h.includes('product'));
  const out = [];
  const seen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const branch = String(row[branchIdx] ?? '').trim();
    if (!branch || seen.has(branch)) continue;
    seen.add(branch);
    out.push({
      branch,
      zone: String(row[zoneIdx] ?? '').trim(),
      cluster: String(row[clusterIdx] ?? '').trim(),
      product: String(row[productIdx] ?? '').trim()
    });
  }
  cachedMapping = out;
  cachedBranchToCluster = null;
  cachedBranchesByCluster = null;
  return out;
}

/**
 * Get map branch name -> cluster (CS only). Normalizes cluster to Cluster 1, Cluster 2, Cluster 3, Zanzibar.
 * @returns {Promise<Map<string, string>>}
 */
export async function getBranchToClusterCS() {
  if (cachedBranchToCluster) return cachedBranchToCluster;
  const list = await loadZoneClusterMapping();
  const map = new Map();
  for (const r of list) {
    if (r.product.toUpperCase() !== 'CS') continue;
    let cluster = r.cluster.trim();
    if (/cluster\s*1/i.test(cluster)) cluster = 'Cluster 1';
    else if (/cluster\s*2/i.test(cluster)) cluster = 'Cluster 2';
    else if (/cluster\s*3/i.test(cluster)) cluster = 'Cluster 3';
    else if (/zanzibar/i.test(cluster) || /zanzibar/i.test(r.zone)) cluster = 'Zanzibar';
    map.set(r.branch, cluster);
  }
  cachedBranchToCluster = map;
  return map;
}

/**
 * Get branches per cluster (CS only). { 'Cluster 1': ['Arusha', ...], 'Cluster 2': [...], ... }
 * @returns {Promise<Record<string, string[]>>}
 */
export async function getBranchesByClusterCS() {
  if (cachedBranchesByCluster) return cachedBranchesByCluster;
  const map = await getBranchToClusterCS();
  const byCluster = { 'Cluster 1': [], 'Cluster 2': [], 'Cluster 3': [], Zanzibar: [] };
  for (const [branch, cluster] of map) {
    if (byCluster[cluster]) byCluster[cluster].push(branch);
  }
  cachedBranchesByCluster = byCluster;
  return byCluster;
}

/**
 * Zone display name: "Northern Zone" -> "Northern Zone" (Zone column is already like "Nyasa Zone").
 * For "Region" naming: if backend uses "Nyasa region", we treat Zone "Nyasa Zone" as same (just naming).
 */
export function zoneToDisplayName(zone) {
  if (!zone) return '';
  const z = String(zone).trim();
  if (/zone$/i.test(z)) return z;
  return z + ' Zone';
}
