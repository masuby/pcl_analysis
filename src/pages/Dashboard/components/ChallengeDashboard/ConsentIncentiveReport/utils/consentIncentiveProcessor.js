/**
 * Consent Incentive Report — Data Processor
 *
 * Implements the 7-step procedure documented in
 * ConsentIncentive_Procedure_2026.xlsx
 *
 * Inputs:
 *   leadBuffer     ArrayBuffer  — uploaded Lead Report
 *   loanBuffer     ArrayBuffer  — uploaded Loan Accounts file
 *   crmBuffers     Array<{ buffer, meta }>  — all CS CRM reports (latest first)
 *
 * Output (returned object):
 *   summary, agents, periods, consents3m, consentsCurrent, converted, teamAwards,
 *   topPerformers, diagnostics
 */

import * as XLSX from 'xlsx';

// ── Tunables ─────────────────────────────────────────────────────────────────
const RATES = {
  CS:  { verified: 250,   unverified: 0, converted: 750,   topBonus: 100 },
  LBF: { verified: 1_500, unverified: 0, converted: 3_500, topBonus: 500 },
  SME: { verified: 1_500, unverified: 0, converted: 3_500, topBonus: 500 },
};
const ACTIVE_DAYS_THRESHOLD   = 90;     // Last_Login window
const FUZZY_THRESHOLD         = 0.66;   // Lead.Name ↔ Loan.Account Holder Name
const TEAM_DRINKUP_THRESHOLD  = 150;
const TEAM_DRINKUP_AMOUNT     = 200_000;
const THREE_MONTHS_MS         = 90 * 24 * 3600 * 1000;

const PRODUCT_LABELS = {
  CS:  'CS — Civil Servant',
  LBF: 'LBF — Log Book Finance',
  SME: 'SME — Small & Medium Enterprise',
};

// ── String helpers ───────────────────────────────────────────────────────────
const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip diacritics
  .toLowerCase().trim().replace(/\s+/g, ' ');

const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 1);

/** Fuzzy name match score (max-token-count denominator, supports 2-vs-3 differences). */
function nameSimilarity(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  ta.forEach((t) => { if (tb.has(t)) inter++; });
  return inter / Math.max(ta.size, tb.size);
}

// ── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Detect whether a column of date strings uses DMY or MDY ordering.
 * Sample-driven: any value with first > 12 votes DMY, any with second > 12 votes MDY.
 * Returns 'DMY' | 'MDY' | fallback when undecidable.
 */
function detectDateFormat(values, fallback = 'DMY') {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    if (!v || v instanceof Date) continue;
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a > 12 && b <= 12)      dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  if (dmy > mdy) return 'DMY';
  if (mdy > dmy) return 'MDY';
  return fallback;
}

/**
 * Parse a date that may arrive as Date, ISO string, "DD-MM-YYYY HH:mm",
 * "DD/MM/YYYY HH:mm", or "MM/DD/YYYY HH:mm" depending on the column's format.
 * @param {*} v
 * @param {'DMY'|'MDY'} fmt  Component order for ambiguous values (default DMY)
 */
function parseDate(v, fmt = 'DMY') {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v).trim();
  if (!s || s.toUpperCase() === 'NEVER' || s.toUpperCase() === 'NOT SET') return null;

  // ISO yyyy-mm-dd first (avoid US-format ambiguity)
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
    const dt = new Date(s);
    if (!isNaN(dt)) return dt;
  }

  // "X[-/]X[-/]YYYY HH:mm"
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    let a = parseInt(m[1], 10);
    let b = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    const day   = fmt === 'MDY' ? b : a;
    const month = fmt === 'MDY' ? a : b;
    const hh = m[4] ? parseInt(m[4], 10) : 0;
    const mm = m[5] ? parseInt(m[5], 10) : 0;
    const dt = new Date(y, month - 1, day, hh, mm);
    if (!isNaN(dt)) return dt;
  }

  const native = new Date(s);
  return isNaN(native) ? null : native;
}

const dayKey = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
const monthKey = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';

// ── Excel helpers ────────────────────────────────────────────────────────────
function parseWorkbook(buffer) {
  return XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
}
function sheetToObjects(workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}
function findSheet(workbook, ...candidates) {
  const names = workbook.SheetNames;
  for (const c of candidates) {
    const m = names.find((n) => norm(n) === norm(c));
    if (m) return m;
  }
  for (const c of candidates) {
    const m = names.find((n) => norm(n).includes(norm(c)));
    if (m) return m;
  }
  return null;
}
function pickCol(row, ...candidates) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const k = keys.find((k) => norm(k) === norm(c));
    if (k !== undefined) return k;
  }
  for (const c of candidates) {
    const k = keys.find((k) => norm(k).includes(norm(c)));
    if (k !== undefined) return k;
  }
  return null;
}
function get(row, ...candidates) {
  const k = pickCol(row, ...candidates);
  return k ? (row[k] ?? '') : '';
}

// ── Product resolver ─────────────────────────────────────────────────────────
function resolveProduct(raw, tenant = '') {
  const s = norm(raw);
  const t = norm(tenant);
  if (s === 'cs' || t.startsWith('cs '))   return 'CS';
  if (s === 'lbf' || t.startsWith('lbf ')) return 'LBF';
  if (s === 'sme' || t.startsWith('sme ')) return 'SME';
  if (s.includes('civil')) return 'CS';
  if (s.includes('log') || s.includes('book')) return 'LBF';
  if (s.includes('sme') || s.includes('medium')) return 'SME';
  return (raw ? String(raw).toUpperCase() : 'UNKNOWN');
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1: Build CRM user_data lookup map
// ═══════════════════════════════════════════════════════════════════════════
function buildUserDataMap(crmBuffer) {
  const wb = parseWorkbook(crmBuffer);
  const sheet = findSheet(wb, 'user_data', 'users', 'user data');
  if (!sheet) {
    return {
      map: new Map(),
      diag: { sheetName: null, availableSheets: wb.SheetNames, totalRows: 0, agentsLoaded: 0, byProduct: {}, byZone: {}, sampleAgents: [], detectedColumns: null },
    };
  }
  const rows = sheetToObjects(wb, sheet);
  const map  = new Map();

  let detectedColumns = null;
  if (rows.length) {
    detectedColumns = {
      name:      pickCol(rows[0], 'Name'),
      tenant:    pickCol(rows[0], 'Tenant'),
      zone:      pickCol(rows[0], 'Zone'),
      product:   pickCol(rows[0], 'Product', 'Products'),
      lastLogin: pickCol(rows[0], 'Last_Login', 'Last Login'),
      role:      pickCol(rows[0], 'Role'),
    };
  }

  // Detect Last_Login date format
  const sampleLogins = rows.slice(0, 200)
    .map((r) => get(r, 'Last_Login', 'Last Login'))
    .filter((v) => v && String(v).toUpperCase() !== 'NEVER');
  const loginDateFmt = detectDateFormat(sampleLogins, 'DMY');

  const byProduct = { CS: 0, LBF: 0, SME: 0, UNKNOWN: 0 };
  const byZone    = {};

  rows.forEach((row) => {
    const name      = get(row, 'Name');
    const tenant    = get(row, 'Tenant');
    const zone      = get(row, 'Zone');
    const product   = resolveProduct(get(row, 'Product', 'Products'), tenant);
    const lastLogin = get(row, 'Last_Login', 'Last Login');
    const role      = get(row, 'Role');

    if (!name) return;

    map.set(norm(name), {
      name:           String(name),
      branch:         String(tenant || ''),     // Tenant = Branch
      zone:           String(zone   || ''),
      product,
      lastLogin:      String(lastLogin || ''),
      lastLoginParsed:parseDate(lastLogin, loginDateFmt),
      role:           String(role || ''),
    });

    byProduct[product in byProduct ? product : 'UNKNOWN']++;
    if (zone) byZone[zone] = (byZone[zone] || 0) + 1;
  });

  const sampleAgents = [...map.values()].slice(0, 5).map((a) => ({
    name: a.name, product: a.product, zone: a.zone, branch: a.branch, lastLogin: a.lastLogin,
  }));

  return {
    map,
    diag: {
      sheetName: sheet,
      availableSheets: wb.SheetNames,
      totalRows: rows.length,
      agentsLoaded: map.size,
      byProduct,
      byZone,
      sampleAgents,
      detectedColumns,
      loginDateFmt,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 3: Active status (uses pre-parsed Last_Login)
// ═══════════════════════════════════════════════════════════════════════════
function isActive(parsedDate, today = new Date()) {
  if (!parsedDate) return false;
  const days = (today.getTime() - parsedDate.getTime()) / (24 * 3600 * 1000);
  return days <= ACTIVE_DAYS_THRESHOLD;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 4: Loan parsing + fuzzy conversion match
// ═══════════════════════════════════════════════════════════════════════════
function buildLoanIndex(loanBuffer) {
  const wb = parseWorkbook(loanBuffer);
  const sheet = findSheet(wb, 'Loan Accounts', 'Loans', 'Sheet1') || wb.SheetNames[0];
  const rows = sheetToObjects(wb, sheet);

  // Auto-detect activation-date format (defaults to MDY for slash, since Loan exports often US)
  const sampleDates = rows.slice(0, 200)
    .map((r) => get(r, 'Activation Date (Loan)', 'Activation Date'))
    .filter(Boolean);
  const dateFmt = detectDateFormat(sampleDates, 'MDY');

  const loans = rows.map((row) => ({
    loanName:        get(row, 'Loan Name'),
    accountId:       get(row, 'Account ID'),
    accountHolder:   get(row, 'Account Holder Name'),
    loanAmount:      Number(get(row, 'Loan Amount')) || 0,
    branch:          get(row, 'Branch'),
    salesRep:        get(row, 'Sales Reps (Client)', 'Sales Rep (Client)', 'Sales Rep'),
    activationDate:  parseDate(get(row, 'Activation Date (Loan)', 'Activation Date'), dateFmt),
    clientType:      get(row, 'CLIENT TYPE', 'Client Type'),
  })).filter((l) => l.accountHolder);

  // Determine latest month from activation dates
  let latestMonth = null;
  loans.forEach((l) => {
    if (l.activationDate) {
      const m = monthKey(l.activationDate);
      if (!latestMonth || m > latestMonth) latestMonth = m;
    }
  });

  // Filter to latest month
  const filtered = latestMonth
    ? loans.filter((l) => l.activationDate && monthKey(l.activationDate) === latestMonth)
    : [];

  return {
    allLoans:    loans,
    filtered,
    latestMonth,
    sheet,
    availableSheets: wb.SheetNames,
    totalRows:   rows.length,
    dateFmt,
  };
}

/**
 * Find ALL loans that fuzzy-match a lead name above the threshold.
 * Sorted highest-score first, then latest activation.
 * Returns Array<{ loan, score }>.
 */
function findAllLoanMatches(leadName, candidateLoans) {
  const out = [];
  candidateLoans.forEach((l) => {
    const score = nameSimilarity(leadName, l.accountHolder);
    if (score >= FUZZY_THRESHOLD) out.push({ loan: l, score });
  });
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ad = a.loan.activationDate?.getTime() ?? 0;
    const bd = b.loan.activationDate?.getTime() ?? 0;
    return bd - ad;
  });
  return out;
}

// ─── Team helpers ────────────────────────────────────────────────────────────

/** A team value counts as "missing" if it's blank, "none", "n/a", or "-". */
function isMissingTeam(t) {
  if (!t) return true;
  const n = norm(t);
  return n === '' || n === 'none' || n === 'n/a' || n === '-' || n === 'null';
}

/**
 * Build canonical team-per-agent map from the entire Lead file.
 * For each agent, picks the MOST FREQUENT non-missing team value.
 * @returns Map<normName, canonicalTeam>
 */
function buildCanonicalTeamMap(leadRows) {
  const agentTeamCounts = new Map();   // normName -> { team -> count }
  leadRows.forEach((row) => {
    const cb = get(row, 'Created_By', 'Created By');
    const t  = get(row, 'Team_Name', 'Team Name', 'Team');
    if (!cb || isMissingTeam(t)) return;
    const k = norm(cb);
    if (!agentTeamCounts.has(k)) agentTeamCounts.set(k, new Map());
    const teams = agentTeamCounts.get(k);
    teams.set(String(t), (teams.get(String(t)) || 0) + 1);
  });

  const out = new Map();
  agentTeamCounts.forEach((teams, k) => {
    let bestTeam = '', bestCount = -1;
    teams.forEach((c, t) => { if (c > bestCount) { bestCount = c; bestTeam = t; } });
    out.set(k, bestTeam);
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 5: Field-activity verification across all CRM reports
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Build a combined agent_activity lookup map from multiple CRM buffers.
 * Key: `${normName}|${dayKey}` -> { targetMet, status, atLocation }
 * If an agent has multiple activities on the same day, prefer AT_LOCATION+COMPLETED.
 */
function buildActivityMap(crmBuffers) {
  const map = new Map();
  let totalActivityRows = 0;
  let reportsScanned    = 0;

  crmBuffers.forEach(({ buffer, meta }) => {
    try {
      const wb    = parseWorkbook(buffer);
      const sheet = findSheet(wb, 'agent_activity', 'agent activity', 'Agent_Activity');
      if (!sheet) return;
      reportsScanned++;

      const rows = sheetToObjects(wb, sheet);

      // Detect Start_Date format per report
      const sampleDates = rows.slice(0, 200)
        .map((r) => get(r, 'Start_Date', 'Start Date'))
        .filter(Boolean);
      const dateFmt = detectDateFormat(sampleDates, 'DMY');

      rows.forEach((row) => {
        totalActivityRows++;
        const agentName = get(row, 'Agent_Name', 'Agent Name');
        const status    = get(row, 'Status');
        const targetMet = get(row, 'Target_Met', 'Target Met');
        const startDate = parseDate(get(row, 'Start_Date', 'Start Date'), dateFmt);

        if (!agentName || !startDate) return;

        const k = `${norm(agentName)}|${dayKey(startDate)}`;
        const atLocation = String(targetMet).toUpperCase() === 'AT_LOCATION'
                       && String(status).toUpperCase() === 'COMPLETED';
        const existing = map.get(k);
        // Prefer AT_LOCATION over not-at-location
        if (!existing || (atLocation && !existing.atLocation)) {
          map.set(k, { targetMet, status, atLocation });
        }
      });
    } catch (e) {
      console.warn('[CIR] Failed to parse agent_activity from CRM report:', meta?.id, e);
    }
  });

  return { map, totalActivityRows, reportsScanned };
}

function verifyFieldActivity(activityMap, createdBy, consentDate) {
  if (!consentDate) return false;
  const k = `${norm(createdBy)}|${dayKey(consentDate)}`;
  return activityMap.get(k)?.atLocation === true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Team aggregation (shared by main processor + per-product filter)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Build per-team standings from a list of already-priced agents.
 * Each agent carries team + verified/unverified/converted + payout fields.
 */
export function buildTeamsFromAgents(agents) {
  const teamStatsMap = new Map(); // teamName -> aggregator
  agents.forEach((a) => {
    if (!a.team) return;   // skip teamless agents
    if (!teamStatsMap.has(a.team)) {
      teamStatsMap.set(a.team, {
        team:        a.team,
        verified:    0,
        unverified:  0,
        converted:   0,
        basePayout:  0,
        topBonus:    0,
        totalPayout: 0,
        agentSet:    new Set(),
        productSet:  new Set(),
        branchSet:   new Set(),
      });
    }
    const ts = teamStatsMap.get(a.team);
    ts.verified    += a.verified;
    ts.unverified  += a.unverified;
    ts.converted   += a.converted;
    ts.basePayout  += a.basePayout;
    ts.topBonus    += a.topBonus;
    ts.totalPayout += a.totalPayout;
    ts.agentSet.add(a.name);
    if (a.product) ts.productSet.add(a.product);
    if (a.branch)  ts.branchSet.add(a.branch);
  });

  return [...teamStatsMap.values()].map((ts) => {
    const qualified = ts.verified >= TEAM_DRINKUP_THRESHOLD;
    return {
      team:           ts.team,
      verified:       ts.verified,
      unverified:     ts.unverified,
      converted:      ts.converted,
      agents:         ts.agentSet.size,
      products:       [...ts.productSet].sort().join(', '),
      branches:       [...ts.branchSet].sort().join(', '),
      basePayout:     ts.basePayout,
      topBonus:       ts.topBonus,
      agentPayout:    ts.totalPayout,
      qualified,
      drinkupAmount:  qualified ? TEAM_DRINKUP_AMOUNT : 0,
      shortBy:        Math.max(0, TEAM_DRINKUP_THRESHOLD - ts.verified),
    };
  }).sort((a, b) => b.verified - a.verified);
}

/**
 * Produce a product-scoped copy of a processed report (CS / LBF / SME).
 * Agents, consents, conversions are filtered to the product; teams, summary
 * totals, top performers and byProduct are recomputed from that subset so the
 * downloaded Excel + email are fully product-specific. `summary.product` is
 * stamped so the export/email can label the report.
 */
export function filterReportByProduct(data, product) {
  if (!product) return data;
  const P = String(product).toUpperCase();

  const agents          = data.agents.filter((a) => a.product === P);
  const consents3m      = data.consents3m.filter((c) => c.product === P);
  const consentsCurrent = data.consentsCurrent.filter((c) => c.product === P);
  const converted       = data.converted.filter((c) => c.product === P);

  const teams      = buildTeamsFromAgents(agents);
  const teamAwards = teams
    .filter((t) => t.qualified)
    .map((t) => ({ team: t.team, totalVerified: t.verified, drinkupAmount: t.drinkupAmount }));

  const totalVerified   = agents.reduce((s, a) => s + a.verified,   0);
  const totalUnverified = agents.reduce((s, a) => s + a.unverified, 0);
  const totalConverted  = agents.reduce((s, a) => s + a.converted,  0);
  const totalPayout     = agents.reduce((s, a) => s + a.totalPayout, 0);
  const teamAwardTotal  = teamAwards.reduce((s, t) => s + t.drinkupAmount, 0);

  const prev = data.summary.byProduct?.[P] ?? {};
  const byProduct = {
    [P]: {
      label:       PRODUCT_LABELS[P] ?? prev.label ?? P,
      agents:      agents.length,
      verified:    totalVerified,
      unverified:  totalUnverified,
      converted:   totalConverted,
      totalPayout,
    },
  };
  const topPerformers = data.topPerformers?.[P] ? { [P]: data.topPerformers[P] } : {};

  const summary = {
    ...data.summary,
    product:        P,
    totalAgents:    agents.length,
    totalVerified,
    totalUnverified,
    totalConverted,
    totalPayout,
    teamAwardTotal,
    grandTotal:     totalPayout + teamAwardTotal,
    totalTeams:     teams.length,
    teamsQualified: teams.filter((t) => t.qualified).length,
    topTeam:        teams[0] ?? null,
    byProduct,
    topPerformers,
  };

  return { ...data, agents, consents3m, consentsCurrent, converted, teams, teamAwards, topPerformers, summary };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {ArrayBuffer} leadBuffer
 * @param {ArrayBuffer} loanBuffer
 * @param {Array<{ buffer: ArrayBuffer, meta: Object }>} crmBuffers   — latest first
 * @returns processed report object
 */
export function processConsentIncentiveReport(leadBuffer, loanBuffer, crmBuffers, options = {}) {
  if (!crmBuffers || !crmBuffers.length) {
    throw new Error('No CS CRM reports available. Upload a CRM report to the database first.');
  }
  // The UI lets the user pick the report month; when supplied it overrides the
  // period label everywhere (title, summary, email) so the report reads e.g.
  // "JUNE 2026" regardless of any stray dates in the Lead file.
  const periodLabel = options.periodLabel || null;

  // ── Step 1: VLOOKUP user_data from LATEST CRM ────────────────────────────
  const latestCRM = crmBuffers[0];
  const { map: userMap, diag: userDiag } = buildUserDataMap(latestCRM.buffer);

  // ── Step 4-prep: Loan parsing ────────────────────────────────────────────
  const loanIndex = buildLoanIndex(loanBuffer);

  // ── Step 5-prep: build agent_activity map across ALL CRM reports ─────────
  const { map: activityMap, totalActivityRows, reportsScanned } = buildActivityMap(crmBuffers);

  // ── Parse Lead file ───────────────────────────────────────────────────────
  const leadWb    = parseWorkbook(leadBuffer);
  const leadSheet = findSheet(leadWb, 'Lead_Report', 'Lead Report', 'Leads') || leadWb.SheetNames[0];
  const leadRows  = sheetToObjects(leadWb, leadSheet);
  if (!leadRows.length) throw new Error('Lead file appears to be empty.');

  let leadColumns = null;
  if (leadRows.length) {
    leadColumns = {
      name:          pickCol(leadRows[0], 'Name'),
      createdBy:     pickCol(leadRows[0], 'Created_By', 'Created By'),
      consentStatus: pickCol(leadRows[0], 'Consent_Status'),
      consentDate:   pickCol(leadRows[0], 'Consent_Date'),
      team:          pickCol(leadRows[0], 'Team_Name'),
      branch:        pickCol(leadRows[0], 'Branch'),
      region:        pickCol(leadRows[0], 'Region'),
    };
  }

  // ── Detect Consent_Date format on the Lead file (slash defaults MDY per spec) ──
  const sampleConsentDates = leadRows.slice(0, 300)
    .map((r) => get(r, 'Consent_Date'))
    .filter(Boolean);
  const leadDateFmt = detectDateFormat(sampleConsentDates, 'MDY');

  // ── Step 0: Build canonical team-per-agent (back-fill missing TEAM_NAME) ──
  const canonicalTeam = buildCanonicalTeamMap(leadRows);

  // ── Compute current month + 3-month window from Consent_Date max ─────────
  const allLeadDates = [];
  leadRows.forEach((r) => { const d = parseDate(get(r, 'Consent_Date'), leadDateFmt); if (d) allLeadDates.push(d); });
  const maxLeadDate = allLeadDates.length ? new Date(Math.max(...allLeadDates.map((d) => d.getTime()))) : new Date();
  const currentMonthKey = monthKey(maxLeadDate);
  const threeMonthsAgo  = new Date(maxLeadDate.getTime() - THREE_MONTHS_MS);

  // ── Diagnostics counters ─────────────────────────────────────────────────
  const statusCounts        = {};
  const unmatchedNames      = new Set();
  let rowsTotal             = leadRows.length;
  let rowsAccepted          = 0;
  let rowsDropped           = 0;
  let lookupMatched         = 0;
  let lookupUnmatched       = 0;

  // ── Step 2: Process every Lead row ───────────────────────────────────────
  // Build:
  //  - consents3m / consentsCurrent — operational sheets B & C
  //  - agentAccum — per agent payout calc base
  //  - teamAccum  — team drink-up totals
  const consents3m       = [];
  const consentsCurrent  = [];
  const agentAccum       = new Map();
  const teamAccum        = new Map();
  const today            = new Date();

  let teamBackfilled = 0;

  leadRows.forEach((row) => {
    const status = get(row, 'Consent_Status');
    if (status) statusCounts[status] = (statusCounts[status] || 0) + 1;

    if (norm(status) !== 'accepted') { rowsDropped++; return; }
    rowsAccepted++;

    const createdBy   = get(row, 'Created_By');
    if (!createdBy)   { rowsDropped++; return; }

    const leadName    = get(row, 'Name');
    const rawTeam     = get(row, 'Team_Name');
    const consentDate = parseDate(get(row, 'Consent_Date'), leadDateFmt);
    const leadBranch  = get(row, 'Branch');
    const leadRegion  = get(row, 'Region');

    // Step 0: Back-fill missing TEAM_NAME from canonical map
    let team = String(rawTeam || '');
    if (isMissingTeam(team)) {
      const canon = canonicalTeam.get(norm(createdBy));
      if (canon) { team = canon; teamBackfilled++; }
      else       { team = ''; }   // truly no team for this agent anywhere
    }

    // Step 1 lookup
    const crmInfo = userMap.get(norm(createdBy));
    if (crmInfo) lookupMatched++;
    else { lookupUnmatched++; unmatchedNames.add(String(createdBy)); }

    const branch  = crmInfo?.branch  || String(leadBranch || '');
    const zone    = crmInfo?.zone    || String(leadRegion || '');
    const product = crmInfo?.product || 'UNKNOWN';

    // Step 5: field verification
    const fieldVerified = verifyFieldActivity(activityMap, createdBy, consentDate);

    // 3-month window check
    if (consentDate && consentDate >= threeMonthsAgo) {
      const consentRow = {
        agent:          String(createdBy),
        branch, zone, product,
        leadName:       String(leadName || ''),
        consentDate,
        team,
        fieldVerified,
      };
      consents3m.push(consentRow);
      if (monthKey(consentDate) === currentMonthKey) {
        consentsCurrent.push(consentRow);
      }
    }

    // Per-agent accumulator
    const akey = norm(createdBy);
    if (!agentAccum.has(akey)) {
      agentAccum.set(akey, {
        name:       String(createdBy),
        branch, zone, product,
        team,
        lastLogin:       crmInfo?.lastLogin       || '',
        lastLoginParsed: crmInfo?.lastLoginParsed || null,
        active:          isActive(crmInfo?.lastLoginParsed, today),
        lookupMatched: Boolean(crmInfo),
        verified:   0,
        unverified: 0,
        converted:  0,
      });
    }
    const acc = agentAccum.get(akey);
    if (crmInfo) {  // keep CRM data fresh
      acc.branch          = crmInfo.branch  || acc.branch;
      acc.zone            = crmInfo.zone    || acc.zone;
      acc.product         = crmInfo.product || acc.product;
      acc.lastLogin       = crmInfo.lastLogin;
      acc.lastLoginParsed = crmInfo.lastLoginParsed;
      acc.active          = isActive(crmInfo.lastLoginParsed, today);
    }
    if (team && !acc.team) acc.team = team;
    if (fieldVerified) acc.verified++;
    else               acc.unverified++;
  });

  // ── Step 4: Conversion matching (aggregated — all loans per lead) ─────────
  // For each Lead row in the 3-month window, find ALL loans that fuzzy-match.
  // Each lead is one row in the converted sheet; all matched-loan salesReps,
  // branches, names, and amounts are aggregated into that row.
  const converted    = [];
  const matchedLoans = new Set();

  // Pre-dedup by leadName so the same client doesn't appear twice
  const seenLeadKey = new Set();

  consents3m.forEach((c) => {
    if (!c.leadName) return;
    const lk = norm(c.leadName);
    if (seenLeadKey.has(lk)) return;

    // Find all loans in the latest month that haven't already been claimed
    const candidates = loanIndex.filtered.filter((l) => !matchedLoans.has(l.accountId));
    const matches    = findAllLoanMatches(c.leadName, candidates);
    if (!matches.length) return;

    seenLeadKey.add(lk);

    // Claim each matched loan so a different lead can't re-claim it
    matches.forEach((m) => matchedLoans.add(m.loan.accountId));

    // Aggregate
    const best         = matches[0].loan;
    const dedup        = (vals) => [...new Set(vals.map((v) => String(v ?? '').trim()).filter(Boolean))];
    const salesRepList = dedup(matches.map((m) => m.loan.salesRep));
    const branchList   = dedup(matches.map((m) => m.loan.branch));
    const loanNameList = dedup(matches.map((m) => m.loan.loanName));
    const clientTypes  = dedup(matches.map((m) => m.loan.clientType));
    const totalAmount  = matches.reduce((s, m) => s + (m.loan.loanAmount || 0), 0);
    const latestActiv  = matches
      .map((m) => m.loan.activationDate).filter(Boolean)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    converted.push({
      agent:           c.agent,
      product:         c.product,
      leadName:        c.leadName,
      consentDate:     c.consentDate,
      accountHolder:   best.accountHolder,
      loanName:        loanNameList.join(' · '),
      loanAmount:      totalAmount,
      loanBranch:      branchList.join(' · '),
      salesRep:        salesRepList.join(' · '),
      salesRepCount:   salesRepList.length,
      activationDate:  latestActiv,
      clientType:      clientTypes.join(' · '),
      similarity:      matches[0].score,
      loanCount:       matches.length,
    });

    // Credit agent — +1 per converted lead (NOT per loan)
    const acc = agentAccum.get(norm(c.agent));
    if (acc) acc.converted++;
  });

  // ── Step 7: Pricing — compute payouts ────────────────────────────────────
  const agents = [];
  agentAccum.forEach((a) => {
    const rate = RATES[a.product] ?? { verified: 0, unverified: 0, converted: 0, topBonus: 0 };
    const basePayout = a.verified   * rate.verified
                     + a.unverified * rate.unverified
                     + a.converted  * rate.converted;
    agents.push({
      ...a,
      verifiedRate:   rate.verified,
      unverifiedRate: rate.unverified,
      convertedRate:  rate.converted,
      basePayout,
      topBonus:       0,
      totalPayout:    basePayout,
    });
  });

  // Top performer per product (most verified consents)
  const topPerformers = {};
  const byProduct     = {};
  ['CS', 'LBF', 'SME'].forEach((p) => {
    const subset = agents.filter((a) => a.product === p);
    byProduct[p] = {
      label:        PRODUCT_LABELS[p],
      agents:       subset.length,
      verified:     subset.reduce((s, a) => s + a.verified,    0),
      unverified:   subset.reduce((s, a) => s + a.unverified,  0),
      converted:    subset.reduce((s, a) => s + a.converted,   0),
      totalPayout:  0,
    };
    if (!subset.length) return;
    const sorted = [...subset].sort((a, b) =>
      b.verified !== a.verified ? b.verified - a.verified : b.converted - a.converted
    );
    const top = sorted[0];
    topPerformers[p] = top;
    const bonus = top.verified * (RATES[p]?.topBonus ?? 0);
    top.topBonus    = bonus;
    top.totalPayout = top.basePayout + bonus;
  });
  ['CS', 'LBF', 'SME'].forEach((p) => {
    byProduct[p].totalPayout = agents.filter((a) => a.product === p).reduce((s, a) => s + a.totalPayout, 0);
  });

  // Handle UNKNOWN product
  const unknownAgents = agents.filter((a) => !['CS', 'LBF', 'SME'].includes(a.product));
  if (unknownAgents.length) {
    byProduct['UNKNOWN'] = {
      label:       'Unknown Product (unmatched in CRM user_data)',
      agents:      unknownAgents.length,
      verified:    unknownAgents.reduce((s, a) => s + a.verified,   0),
      unverified:  unknownAgents.reduce((s, a) => s + a.unverified, 0),
      converted:   unknownAgents.reduce((s, a) => s + a.converted,  0),
      totalPayout: unknownAgents.reduce((s, a) => s + a.totalPayout, 0),
    };
  }

  // Sort agents by total payout desc, tie-break by verified count
  agents.sort((a, b) =>
    b.totalPayout !== a.totalPayout ? b.totalPayout - a.totalPayout : b.verified - a.verified
  );
  consents3m.sort((a, b) => (b.consentDate?.getTime() ?? 0) - (a.consentDate?.getTime() ?? 0));
  consentsCurrent.sort((a, b) => (b.consentDate?.getTime() ?? 0) - (a.consentDate?.getTime() ?? 0));
  converted.sort((a, b) => (b.activationDate?.getTime() ?? 0) - (a.activationDate?.getTime() ?? 0));

  // ── Team Summary (per-team stats, qualification flag) ────────────────────
  // Build by walking agents (already enriched with team + verified/unverified/converted)
  const teams = buildTeamsFromAgents(agents);

  // teamAwards = subset of qualified teams (used by the original code path)
  const teamAwards = teams
    .filter((t) => t.qualified)
    .map((t) => ({ team: t.team, totalVerified: t.verified, drinkupAmount: t.drinkupAmount }));

  // ── Summary ──────────────────────────────────────────────────────────────
  const totalPayout    = agents.reduce((s, a) => s + a.totalPayout, 0);
  const teamAwardTotal = teamAwards.reduce((s, t) => s + t.drinkupAmount, 0);

  const monthsInData = [...new Set(allLeadDates.map((d) =>
    d.toLocaleString('en-GB', { month: 'long', year: 'numeric' })
  ))];

  const summary = {
    totalAgents:    agents.length,
    totalAccepted:  rowsAccepted,
    totalVerified:  agents.reduce((s, a) => s + a.verified,   0),
    totalUnverified:agents.reduce((s, a) => s + a.unverified, 0),
    totalConverted: agents.reduce((s, a) => s + a.converted,  0),
    totalPayout,
    teamAwardTotal,
    grandTotal:     totalPayout + teamAwardTotal,
    totalTeams:     teams.length,
    teamsQualified: teams.filter((t) => t.qualified).length,
    topTeam:        teams[0] ?? null,
    byProduct,
    topPerformers,
    period:         periodLabel || monthsInData.join(' · ') || 'All Time',
    monthsInData,
    currentMonthKey,
    currentMonthLabel: periodLabel || maxLeadDate.toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
    threeMonthsFrom:   threeMonthsAgo,
    threeMonthsTo:     maxLeadDate,
  };

  // ── Diagnostics ──────────────────────────────────────────────────────────
  const diagnostics = {
    crmReports: crmBuffers.map((c) => ({
      id:       c.meta?.id,
      title:    c.meta?.title    ?? c.meta?.fileName ?? '',
      fileName: c.meta?.fileName ?? '',
      date:     c.meta?.date     ?? c.meta?.createdAt ?? '',
    })),
    latestCRM: {
      id:       latestCRM.meta?.id,
      title:    latestCRM.meta?.title    ?? latestCRM.meta?.fileName ?? '',
      fileName: latestCRM.meta?.fileName ?? '',
      date:     latestCRM.meta?.date     ?? latestCRM.meta?.createdAt ?? '',
      fileSize: latestCRM.meta?.fileSize ?? 0,
    },
    userData: userDiag,
    activity: {
      reportsScanned,
      totalActivityRows,
      lookupSize: activityMap.size,
    },
    lead: {
      sheetName:       leadSheet,
      availableSheets: leadWb.SheetNames,
      detectedColumns: leadColumns,
      dateFormat:      leadDateFmt,
      rowsTotal,
      rowsAccepted,
      rowsDropped,
      lookupMatched,
      lookupUnmatched,
      lookupMatchRate: rowsAccepted > 0 ? lookupMatched / rowsAccepted : 0,
      unmatchedNames:  [...unmatchedNames].slice(0, 50),
      statusCounts,
      teamBackfilled,
      uniqueTeams:     teams.length,
    },
    loan: {
      sheet:           loanIndex.sheet,
      availableSheets: loanIndex.availableSheets,
      totalRows:       loanIndex.totalRows,
      latestMonth:     loanIndex.latestMonth,
      loansInLatestMonth: loanIndex.filtered.length,
      matchedLoans:    matchedLoans.size,
      dateFormat:      loanIndex.dateFmt,
    },
    output: {
      uniqueAgents:   agents.length,
      uniqueTeams:    teams.length,
      teamsQualified: teamAwards.length,
      consents3m:     consents3m.length,
      consentsCurrent:consentsCurrent.length,
      converted:      converted.length,
      teamsAwarded:   teamAwards.length,
      topPerformers:  Object.keys(topPerformers),
      totalPayout,
      teamAwardTotal,
    },
  };

  return {
    summary,
    agents,
    teams,
    consents3m,
    consentsCurrent,
    converted,
    teamAwards,
    topPerformers,
    diagnostics,
    period: summary.period,
    monthsInData,
  };
}
