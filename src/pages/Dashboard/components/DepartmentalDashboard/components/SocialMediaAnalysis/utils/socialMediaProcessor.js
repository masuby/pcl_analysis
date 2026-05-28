/**
 * Social Media Analysis — Processor
 *
 * Input:  raw rows from /api/social-media/data
 *           { lbf: [[header...], [row...], ...],
 *             cs:  [[header...], [row...], ...] }
 *
 * Output: a single object with the aggregates the report sheets need:
 *           { period, monthLabel, weeksInData,
 *             total, quality, converted, qualityRate, convRate,
 *             agentCount, callsPerAgent, successRate,
 *             byPlatform:   { platform: { total, quality, converted,
 *                                          byProduct: { CS, LBF, SME, OTHERS } } },
 *             byAgent:      [{ agent, source, total, quality, converted, byProduct }],
 *             byStatus:     [{ status, count, pct }],
 *             byProduct:    { CS, LBF, SME, OTHERS: { total, quality, converted, agents } },
 *             byWeek:       { 1: { total, ... }, 2: ..., 3: ..., 4: ..., 5: ... },
 *             rows:         [...normalised rows for raw drill-down] }
 */

// ── Standardised dropdown values (must match bootstrap_may2026.py) ──────────
const LBF_STATUSES = [
  'Not picking', 'Not interested', 'Request callback', 'Not reachable',
  'Not qualified', 'Request more time', 'Failed to connect',
  'Duplicated number', 'Qualified for SME', 'Qualified for CS',
  'Converted', 'Referred',
];
const CS_STATUSES = [
  'Not picking', 'Not reachable', 'Request callback', 'Not interested',
  'No affordability', 'Not qualified', 'Existing client',
  'Qualified for LBF', 'Qualified for SME', 'Converted',
  'Duplicated number', 'Probation', 'Busy', 'Redirected', 'Other',
];

// A consent is "quality" if it's an engaged lead (not dead/silent)
const QUALITY_STATUSES = new Set([
  'Converted', 'Qualified for CS', 'Qualified for LBF', 'Qualified for SME',
  'Request callback', 'Request more time', 'Existing client', 'Probation',
  'Referred', 'Busy',                      // engaged but couldn't talk now
]);

const PRODUCTS = ['CS', 'LBF', 'SME', 'OTHERS'];

// Google Sheets serial date epoch (1899-12-30) → JS Date
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
function serialToDate(s) {
  if (typeof s !== 'number') {
    if (s && typeof s === 'string') {
      // Already a date string like "13/05/2026"
      const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
      if (m) {
        let [, d, mo, y] = m;
        d = +d; mo = +mo; y = +y; if (y < 100) y += 2000;
        return new Date(Date.UTC(y, mo - 1, d));
      }
    }
    return null;
  }
  return new Date(SERIAL_EPOCH_MS + s * 86400000);
}

function weekOfMonth(d) {
  if (!d) return null;
  return Math.min(5, Math.ceil(d.getUTCDate() / 7));
}

function normalizeProduct(productRaw, source) {
  const p = String(productRaw || '').toLowerCase();
  if (source === 'CS')        return 'CS';
  if (p.includes('lbf'))      return 'LBF';
  if (p.includes('sme'))      return 'SME';
  if (p.includes('cs'))       return 'CS';
  return 'OTHERS';
}

function normalizePlatform(platformRaw) {
  const p = String(platformRaw || '').trim();
  if (!p) return 'Unknown';
  // Normalize common variants to canonical names matching the template
  const lower = p.toLowerCase();
  if (lower.includes('whatsapp') || lower === 'wa')                return 'WhatsApp';
  if (lower === 'fb' || lower.includes('facebook'))                return 'Facebook';
  if (lower === 'ig' || lower.includes('instagram'))                return 'Instagram';
  if (lower.includes('weblead') || lower.includes('website'))       return 'Website';
  if (lower.includes('mobile') || lower.includes('app'))            return 'Mobile App';
  if (lower.includes('ussd'))                                       return 'USSD';
  if (lower.includes('cx'))                                         return 'CX Incoming';
  if (lower.includes('cars'))                                       return 'Cars 360';
  if (lower === 'tt' || lower === 'tiktok')                         return 'TikTok';
  // Keep original casing for anything else
  return p;
}

function makeEmptyAggregator() {
  return { total: 0, quality: 0, converted: 0 };
}

// ── Index look-up (header → col idx) ────────────────────────────────────────
function indexOfHeader(header, ...candidates) {
  const lower = header.map((h) => String(h || '').trim().toLowerCase());
  for (const c of candidates) {
    const i = lower.indexOf(c.toLowerCase());
    if (i !== -1) return i;
  }
  return -1;
}

function normalizeRow(rawRow, header, source) {
  const idx = {
    product:   indexOfHeader(header, 'Product'),
    platform:  indexOfHeader(header, 'Platform', 'Platform/Channel', 'Channel'),
    name:      indexOfHeader(header, 'name'),
    check_no:  indexOfHeader(header, 'check_no'),
    date:      indexOfHeader(header, 'date'),
    agent:     indexOfHeader(header, 'assigned_to'),
    phone:     indexOfHeader(header, 'phone_no', 'phone_number'),
    feedback:  indexOfHeader(header, 'feedback'),
    status:    indexOfHeader(header, 'status'),
    comment:   indexOfHeader(header, 'comment'),
    converted: indexOfHeader(header, 'is_converted?', 'is_converted'),
  };
  const g = (key) => idx[key] >= 0 ? rawRow[idx[key]] : '';
  const dt = serialToDate(g('date'));
  const status = String(g('status') || '').trim();
  return {
    source,
    product:   normalizeProduct(g('product'), source),
    platform:  normalizePlatform(g('platform')),
    name:      String(g('name')      || '').trim(),
    check_no:  String(g('check_no')  || '').trim(),
    date:      dt,
    week:      weekOfMonth(dt),
    agent:     String(g('agent')     || '').trim(),
    phone:     String(g('phone')     || '').trim(),
    feedback:  String(g('feedback')  || '').trim(),
    status,
    comment:   String(g('comment')   || '').trim(),
    converted: String(g('converted') || '').toLowerCase() === 'yes'
               || status === 'Converted',
    isQuality: QUALITY_STATUSES.has(status),
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

/**
 * @param {{ lbf: Array<Array>, cs: Array<Array> }} api
 * @param {string} [period='MAY 2026']
 */
export function processSocialMediaData(api, period = 'MAY 2026') {
  const lbfRows = api?.lbf ?? [];
  const csRows  = api?.cs  ?? [];

  const lbfHeader = lbfRows[0] || [];
  const csHeader  = csRows[0]  || [];

  // Normalise every row
  const rows = [
    ...lbfRows.slice(1).map((r) => normalizeRow(r, lbfHeader, 'LBF')),
    ...csRows.slice(1) .map((r) => normalizeRow(r, csHeader,  'CS')),
  ].filter((r) => r.platform && r.phone);   // drop empty rows

  const total     = rows.length;
  const quality   = rows.filter((r) => r.isQuality).length;
  const converted = rows.filter((r) => r.converted).length;

  // ── byPlatform ────────────────────────────────────────────────────────────
  const byPlatform = {};
  rows.forEach((r) => {
    const p = byPlatform[r.platform] ??= {
      ...makeEmptyAggregator(),
      byProduct: Object.fromEntries(PRODUCTS.map((p) => [p, makeEmptyAggregator()])),
      byWeek:    {},
    };
    p.total++;
    if (r.isQuality)  p.quality++;
    if (r.converted)  p.converted++;

    const bp = p.byProduct[r.product] ?? p.byProduct.OTHERS;
    bp.total++;
    if (r.isQuality)  bp.quality++;
    if (r.converted)  bp.converted++;

    if (r.week) {
      const w = p.byWeek[r.week] ??= {
        ...makeEmptyAggregator(),
        byProduct: Object.fromEntries(PRODUCTS.map((p) => [p, makeEmptyAggregator()])),
      };
      w.total++;
      if (r.isQuality)  w.quality++;
      if (r.converted)  w.converted++;
      const wbp = w.byProduct[r.product] ?? w.byProduct.OTHERS;
      wbp.total++;
      if (r.isQuality)  wbp.quality++;
      if (r.converted)  wbp.converted++;
    }
  });

  // ── byAgent ───────────────────────────────────────────────────────────────
  const agentMap = {};
  rows.forEach((r) => {
    if (!r.agent) return;
    const key = `${r.source}|${r.agent.toLowerCase()}`;
    const a = agentMap[key] ??= {
      agent:    r.agent,
      source:   r.source,
      total: 0, quality: 0, converted: 0,
      byProduct: Object.fromEntries(PRODUCTS.map((p) => [p, makeEmptyAggregator()])),
    };
    a.total++;
    if (r.isQuality)  a.quality++;
    if (r.converted)  a.converted++;
    const bp = a.byProduct[r.product] ?? a.byProduct.OTHERS;
    bp.total++;
    if (r.isQuality)  bp.quality++;
    if (r.converted)  bp.converted++;
  });
  const byAgent = Object.values(agentMap).sort((a, b) => b.total - a.total);

  // ── byStatus ──────────────────────────────────────────────────────────────
  const statusCounts = {};
  rows.forEach((r) => {
    if (!r.status) return;
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  });
  const allStatuses = [...new Set([...LBF_STATUSES, ...CS_STATUSES])];
  const byStatus = allStatuses
    .filter((s) => statusCounts[s] !== undefined || s === 'Converted' || s === 'Not picking')
    .map((s) => ({
      status: s,
      count:  statusCounts[s] ?? 0,
      pct:    total > 0 ? (statusCounts[s] ?? 0) / total : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // ── byProduct ─────────────────────────────────────────────────────────────
  const byProduct = Object.fromEntries(PRODUCTS.map((p) => [p,
    { ...makeEmptyAggregator(), agents: 0 }]));
  rows.forEach((r) => {
    const bp = byProduct[r.product] ?? byProduct.OTHERS;
    bp.total++;
    if (r.isQuality)  bp.quality++;
    if (r.converted)  bp.converted++;
  });
  // Distinct agents per product
  const productAgents = Object.fromEntries(PRODUCTS.map((p) => [p, new Set()]));
  rows.forEach((r) => {
    if (r.agent) (productAgents[r.product] ?? productAgents.OTHERS).add(r.agent.toLowerCase());
  });
  PRODUCTS.forEach((p) => { byProduct[p].agents = productAgents[p].size; });

  // ── byWeek (overall + per-product, with distinct agent counts) ─────────
  // Agent Performance sheet (template) needs:
  //   • per-week unique-agent count (for "No of agents" row)
  //   • per-week-per-product unique-agent count (for each product block)
  const byWeek = {};
  const weekAgentSets        = {};     // week → Set<agent>
  const weekProductAgentSets = {};     // week → product → Set<agent>

  rows.forEach((r) => {
    if (!r.week) return;
    const w = byWeek[r.week] ??= {
      ...makeEmptyAggregator(),
      byProduct: Object.fromEntries(PRODUCTS.map((p) => [p, { ...makeEmptyAggregator(), agents: 0 }])),
      agents: 0,
    };
    w.total++;
    if (r.isQuality)  w.quality++;
    if (r.converted)  w.converted++;
    const bp = w.byProduct[r.product] ?? w.byProduct.OTHERS;
    bp.total++;
    if (r.isQuality)  bp.quality++;
    if (r.converted)  bp.converted++;

    if (r.agent) {
      const key = r.agent.toLowerCase();
      (weekAgentSets[r.week] ??= new Set()).add(key);
      const wpa = weekProductAgentSets[r.week] ??= {};
      (wpa[r.product] ??= new Set()).add(key);
    }
  });

  // Fold the agent-counts back into the byWeek aggregates
  Object.entries(byWeek).forEach(([w, agg]) => {
    agg.agents = weekAgentSets[w]?.size ?? 0;
    PRODUCTS.forEach((p) => {
      agg.byProduct[p].agents = weekProductAgentSets[w]?.[p]?.size ?? 0;
    });
  });
  const weeksInData = Object.keys(byWeek).map(Number).sort((a, b) => a - b);

  const agentCount = byAgent.length;

  return {
    period,
    monthLabel: period.replace(/SHEET$/i, '').trim() || period,
    total, quality, converted,
    qualityRate: total > 0 ? quality   / total : 0,
    convRate:    total > 0 ? converted / total : 0,
    successRate: total > 0 ? quality   / total : 0,    // alias for the template
    agentCount,
    callsPerAgent: agentCount > 0 ? Math.round(total / agentCount) : 0,
    byPlatform,
    byAgent,
    byStatus,
    byProduct,
    byWeek,
    weeksInData,
    rows,
  };
}
