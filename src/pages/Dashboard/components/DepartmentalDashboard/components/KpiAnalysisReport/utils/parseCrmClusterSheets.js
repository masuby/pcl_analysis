/**
 * Parse CRM CS report Excel: agent_activity and Lead_Report sheets.
 * For Cluster KPIs 7 (95% on location completion) and 8 (80% data consent).
 * - agent_activity: filter Product=CS only, then by Zone (caller aggregates only zones in cluster); Status=COMPLETED, Target_Met=AT_LOCATION.
 * - Lead_Report: filter Product=CS only, then by Zone (caller aggregates only zones in cluster); Consent_Status=ACCEPTED.
 */
import * as XLSX from 'xlsx';

function findColIndex(headers, ...patterns) {
  if (!headers || !Array.isArray(headers)) return -1;
  const lower = (s) => String(s ?? '').toLowerCase().trim();
  for (let c = 0; c < headers.length; c++) {
    const h = lower(headers[c]);
    for (const p of patterns) {
      const pp = lower(p);
      if (h === pp || h.includes(pp) || pp.includes(h)) return c;
    }
  }
  return -1;
}

/**
 * Parse agent_activity sheet: only rows with Product=CS; group by Zone.
 * For cluster analysis, caller must then aggregate using only zones in the selected cluster (see aggregateCrmForCluster).
 * @returns { { byZone: Record<string, { completed: number, atLocation: number }> } }
 */
function parseAgentActivity(ws) {
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (raw.length < 2) return { byZone: {} };
  const headers = (raw[0] || []).map((h) => String(h ?? '').trim());
  const productIdx = findColIndex(headers, 'Product');
  const zoneIdx = findColIndex(headers, 'Zone');
  const statusIdx = findColIndex(headers, 'Status');
  const targetMetIdx = findColIndex(headers, 'Target_Met', 'Target Met');
  if (productIdx < 0 || zoneIdx < 0 || statusIdx < 0 || targetMetIdx < 0) return { byZone: {} };

  const byZone = {};
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r] || [];
    const product = String(row[productIdx] ?? '').trim().toUpperCase();
    if (product !== 'CS') continue; // CS only
    const zone = String(row[zoneIdx] ?? '').trim() || '—';
    if (!byZone[zone]) byZone[zone] = { completed: 0, atLocation: 0 };
    const status = String(row[statusIdx] ?? '').trim().toUpperCase();
    const targetMet = String(row[targetMetIdx] ?? '').trim().toUpperCase();
    if (status === 'COMPLETED') {
      byZone[zone].completed += 1;
      if (targetMet === 'AT_LOCATION') byZone[zone].atLocation += 1;
    }
  }
  return { byZone };
}

/**
 * Parse Lead_Report sheet: only rows with Product=CS; group by Zone.
 * For cluster analysis, caller must then aggregate using only zones in the selected cluster (see aggregateCrmForCluster).
 * @returns { { byZone: Record<string, { accepted: number, total: number }> } }
 */
function parseLeadReport(ws) {
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (raw.length < 2) return { byZone: {} };
  const headers = (raw[0] || []).map((h) => String(h ?? '').trim());
  const productIdx = findColIndex(headers, 'Product', 'PRODUCT');
  const zoneIdx = findColIndex(headers, 'Zone');
  const consentIdx = findColIndex(headers, 'Consent_Status', 'Consent Status');
  if (productIdx < 0 || zoneIdx < 0 || consentIdx < 0) return { byZone: {} };

  const byZone = {};
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r] || [];
    const product = String(row[productIdx] ?? '').trim().toUpperCase();
    if (product !== 'CS') continue; // CS only
    const zone = String(row[zoneIdx] ?? '').trim() || '—';
    if (!byZone[zone]) byZone[zone] = { accepted: 0, total: 0 };
    byZone[zone].total += 1;
    const consent = String(row[consentIdx] ?? '').trim().toUpperCase();
    if (consent === 'ACCEPTED') byZone[zone].accepted += 1;
  }
  return { byZone };
}

/**
 * Fetch CRM report file and parse agent_activity and Lead_Report.
 * @param {string} fileUrl - URL to CRM report Excel
 * @returns {Promise<{ agentActivity: { byZone }, leadReport: { byZone } }>}
 */
function getSheet(wb, ...names) {
  const sheetNames = (wb.SheetNames || []).map((n) => String(n || '').trim());
  for (const name of names) {
    const exact = sheetNames.find((s) => s === name);
    if (exact) return wb.Sheets[exact];
    const lower = name.toLowerCase();
    const match = sheetNames.find((s) => s.toLowerCase() === lower);
    if (match) return wb.Sheets[match];
  }
  return null;
}

export async function parseCrmClusterSheets(fileUrl) {
  if (!fileUrl) return { agentActivity: { byZone: {} }, leadReport: { byZone: {} } };
  const response = await fetch(fileUrl);
  if (!response.ok) return { agentActivity: { byZone: {} }, leadReport: { byZone: {} } };
  const ab = await response.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array', cellDates: true });
  const agentWs = getSheet(wb, 'agent_activity', 'Agent_Activity', 'Agent Activity');
  const leadWs = getSheet(wb, 'Lead_Report', 'Lead Report');
  const agentActivity = agentWs ? parseAgentActivity(agentWs) : { byZone: {} };
  const leadReport = leadWs ? parseLeadReport(leadWs) : { byZone: {} };
  return { agentActivity, leadReport };
}

/** Normalize zone for flexible matching: lower case, strip " zone" / " region" suffix, collapse spaces. */
function normalizeZone(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+(zone|region)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True if zone (from CRM file) belongs to the given cluster's zone list.
 * Matching: exact, case-insensitive, normalized ("Highland Region" ↔ "Highland Zone"), and contains (e.g. Zanzibar).
 */
function zoneBelongsToCluster(zone, clusterZones) {
  const z = String(zone || '').trim();
  if (!z) return false;
  const list = (clusterZones || []).map((c) => String(c).trim()).filter(Boolean);
  if (list.length === 0) return false;
  const set = new Set(list);
  const zUpper = z.toUpperCase();
  const zNorm = normalizeZone(z);

  if (set.has(z) || set.has(zUpper)) return true;
  if (zUpper.includes('ZANZIBAR') && (set.has('ZANZIBAR') || list.some((c) => String(c).toUpperCase().includes('ZANZIBAR')))) return true;
  for (const c of list) {
    const cNorm = normalizeZone(c);
    if (zNorm === cNorm) return true;
    if (zNorm && cNorm && (zNorm.includes(cNorm) || cNorm.includes(zNorm))) return true;
    if (zUpper === c.toUpperCase()) return true;
  }
  return false;
}

/**
 * Aggregate CRM metrics for the selected cluster only.
 * Input must be CS-only (from parseAgentActivity/parseLeadReport). We then restrict to zones
 * that belong to clusterZones (cluster boundary). Result is completed/atLocation/accepted/total
 * for that cluster only.
 * @param {object} agentActivity - { byZone } from parse (Product=CS only)
 * @param {object} leadReport - { byZone } from parse (Product=CS only)
 * @param {string[]} clusterZones - Zone names for the selected cluster (e.g. ZONES_BY_CLUSTER_CS[csView])
 */
export function aggregateCrmForCluster(agentActivity, leadReport, clusterZones) {
  if (!clusterZones || !Array.isArray(clusterZones) || clusterZones.length === 0) {
    return { atLocation: 0, completed: 0, accepted: 0, total: 0 };
  }
  let completed = 0;
  let atLocation = 0;
  const ab = agentActivity?.byZone || {};
  for (const [zone, v] of Object.entries(ab)) {
    if (!zoneBelongsToCluster(zone, clusterZones)) continue;
    completed += v.completed ?? 0;
    atLocation += v.atLocation ?? 0;
  }
  let accepted = 0;
  let totalConsent = 0;
  const lb = leadReport?.byZone || {};
  for (const [zone, v] of Object.entries(lb)) {
    if (!zoneBelongsToCluster(zone, clusterZones)) continue;
    accepted += v.accepted ?? 0;
    totalConsent += v.total ?? 0;
  }
  return {
    atLocation,
    completed,
    accepted,
    total: totalConsent
  };
}
