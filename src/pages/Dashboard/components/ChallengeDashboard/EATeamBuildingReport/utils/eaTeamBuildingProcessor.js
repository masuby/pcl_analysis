/**
 * EA Team Building Report — Processor
 *
 * Criteria (EAST AFRICA TEAM BUILDING 2026 — ALL PCL STAFF / KE & UG):
 * ─────────────────────────────────────────────────────────────────────────────
 * Model: TOP-PERFORMER SELECTION (not a pass/fail threshold).
 * For each (country, product, role) bucket, candidates are ranked by their
 * % achievement of cumulative YTD sales target. Top-N are flagged "selected"
 * per the slot table below; the rest are listed but not selected.
 * ─────────────────────────────────────────────────────────────────────────────
 * KENYA slots (15 total) — top performers per role
 *   LBF: 1 Sales Agent (≥140% YTD) · 1 Telesales (active each month)
 *        1 Team Leader (≥130% YTD) · 1 BM (≥120% YTD)
 *   CS : 1 Sales Agent (≥140% YTD) · 1 FSTL (≥150% YTD)
 *        1 RSM (≥120% YTD) · 1 Cluster Manager (≥120% YTD)
 *   SME: 1 Sales Agent (≥130% YTD) · 1 Team Leader (≥120% YTD) · 1 RSM (≥100% YTD)
 *   AGRI: 1 Sales Agent (≥130% YTD)
 *   BO : 2 (MGM discretionary — not auto-selected)
 *   RO : 1 (CE ≥ 90% · Retention ≥ 92% · PAR 30 < 1%)
 * ─────────────────────────────────────────────────────────────────────────────
 * UGANDA slots (20 total) — top performers per role
 *   LBF: 2 Sales Agents (≥140% YTD) · 1 Telesales (active each month)
 *        1 TL (≥130% YTD) · 1 BM (≥120% YTD) · 1 Cluster Mgr (90% TLs on target)
 *   CS : 2 Mainland SA (≥140% YTD) · 1 ZNZ SA (≥150% YTD)
 *        1 BLO (≥150% YTD) · 1 RSM (≥120% YTD)
 *   SME: 2 Sales Agents (≥130% YTD) · 1 TL (≥120% YTD)
 *   AGRI: 1 SA (≥130% YTD) · 1 TL (≥120% YTD)
 *   RO : 2 (CE ≥ 90% · Retention ≥ 92% · PAR 30 < 1%)
 *   BO : 2 (MGM discretionary)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cross-trip exclusion: a staff member selected for the Kenya trip cannot
 * also be selected for the Uganda trip (memo disclaimer). Kenya slots are
 * filled first; Uganda picks from the remaining candidates.
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTANT: KENYA / UGANDA are DESTINATIONS, not staff locations. All
 * candidates come from the same (Tanzanian) staff pool; the memo's two tables
 * allocate how many TZ staff travel to each event. Selection is role-based:
 * agent-level slots rank individual reps, TL slots rank Branch/TL roll-ups,
 * BM/RSM/Cluster slots rank Region roll-ups — each with its own ratio.
 *
 * NOTE: The MGM-discretionary (BO) and special-metric (RO: CE/Retention/
 * PAR<1%) slots are surfaced but not auto-selected — those require manual MGM
 * input that lives outside the source xlsx files. The UG LBF Cluster Manager
 * slot ("90% of TLs on target") is computed as a status, not a named person.
 * ─────────────────────────────────────────────────────────────────────────────
 * IPF exclusion: Term contains "IPF" → skip for loan counts
 * Old / New / Zanzibar / tenure rules: same as Local Trip.
 */

import * as XLSX from 'xlsx';

// ── helpers ───────────────────────────────────────────────────────────────────
const trim    = (s) => String(s ?? '').trim();
const norm    = (s) => trim(s).toLowerCase();
const normKey = (s) => trim(s).replace(/\s+/g, ' ').toLowerCase();

const MONTH_ORDER = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const JAN_2026  = new Date('2026-01-01');
const MAY_2026  = new Date('2026-05-01');
const PAR_LIMIT = 0.04; // 4%

// ── robust field getter ───────────────────────────────────────────────────────
function getField(row, name, posIdx) {
  if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
  const needle = name.trim().toLowerCase();
  const keys   = Object.keys(row);
  const match  = keys.find((k) => k.trim().toLowerCase() === needle);
  if (match !== undefined && row[match] !== undefined && row[match] !== null && row[match] !== '') {
    return row[match];
  }
  if (posIdx !== undefined) {
    const vals = Object.values(row);
    if (posIdx < vals.length && vals[posIdx] !== undefined && vals[posIdx] !== null) {
      return vals[posIdx];
    }
  }
  return undefined;
}

// ── sheet parsing helpers ─────────────────────────────────────────────────────
function parseAllSheets(buffer) {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
  const out = {};
  wb.SheetNames.forEach((n) => {
    out[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' });
  });
  return out;
}

function parseFirst(buffer) {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}

function getSheetRows(sheets, name) {
  if (sheets[name]) return sheets[name];
  const lower = name.toLowerCase();
  const key   = Object.keys(sheets).find((k) => k.trim().toLowerCase() === lower);
  return key ? sheets[key] : null;
}

function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

// ── region name overrides ─────────────────────────────────────────────────────
// Sales file region names → Target sheet region keys
const REGION_OVERRIDES = {
  'sme arusha branch': 'sme northern',
  'sme tazara branch': 'sme dar zone',
};

// ── agent qualification criteria (per-month thresholds) ──────────────────────
const THRESHOLDS = {
  LBF: {
    agent: {
      Old: { loansPerMonth: 4, disbursePerMonth: 20_000_000 },
      New: { loansPerMonth: 3, disbursePerMonth: 15_000_000 },
    },
  },
  CS: {
    agent: {
      Old: {
        Mainland: { loansPerMonth: 4, disbursePerMonth: 10_000_000 },
        Zanzibar: { loansPerMonth: 4, disbursePerMonth: 20_000_000 },
      },
      New: {
        Mainland: { loansPerMonth: 3, disbursePerMonth:  7_500_000 },
        Zanzibar: { loansPerMonth: 3, disbursePerMonth: 15_000_000 },
      },
    },
  },
  SME: {
    agent: {
      Old: { loansPerMonth: 4, disbursePerMonth: 8_000_000 },
      New: { loansPerMonth: 3, disbursePerMonth: 6_000_000 },
    },
  },
};

function isZanzibar(region) { return norm(region).includes('zanzibar'); }

/**
 * Qualify an individual sales agent.
 * Thresholds are per-month; cumulative = threshold × monthsCount.
 */
function qualifyAgent(agent, product, region, monthsCount) {
  const t = THRESHOLDS[product];
  if (!t) return { qualified: false, reason: `Unknown product: ${product}`, minLoans: 0, minDisb: 0 };

  const cat = agent.flag === 'Yes' ? 'Old' : 'New';
  let threshold;

  if (product === 'CS') {
    const zone = isZanzibar(region) ? 'Zanzibar' : 'Mainland';
    threshold  = t.agent[cat][zone];
  } else {
    threshold = t.agent[cat];
  }

  const minLoans = threshold.loansPerMonth  * monthsCount;
  const minDisb  = threshold.disbursePerMonth * monthsCount;

  const passL = agent.totalLoans  >= minLoans;
  const passD = agent.totalAmount >= minDisb;
  const ok    = passL && passD;

  const parts = [];
  if (!passL) parts.push(`Loans ${agent.totalLoans}/${minLoans} (${threshold.loansPerMonth}/mo × ${monthsCount}mo)`);
  if (!passD) parts.push(`TZS ${Math.round(agent.totalAmount).toLocaleString()}/${minDisb.toLocaleString()}`);

  return { qualified: ok, reason: ok ? 'Criteria met' : parts.join('; '), minLoans, minDisb };
}

/**
 * EA Team Building leader-level YTD % thresholds — used for the informational
 * TL / Region verdicts shown on the All Agents sheet (the actual slot
 * selection below uses the per-role ratios from the memo's KE/UG tables).
 */
function leaderRatio(product, region /*, country */) {
  const p = String(product || '').toUpperCase();
  if (p === 'LBF') return 1.30;
  if (p === 'CS')  return isZanzibar(region) ? 1.30 : 1.50;
  if (p === 'SME' || p === 'AGRI' || p === 'SME & AGRI') return 1.20;
  return 1.30;
}

/**
 * EA Team Building AGENT minimum YTD % threshold (the memo's "Top performer
 * (xxx% YTD)" line is the entry bar; ranking then picks the best among those
 * that clear it).
 *   LBF  → 140 % · CS Mainland → 140 % · CS Zanzibar → 150 %
 *   SME / AGRI → 130 %
 */
function agentTopRatio(product, region) {
  const p = String(product || '').toUpperCase();
  if (p === 'LBF') return 1.40;
  if (p === 'CS')  return isZanzibar(region) ? 1.50 : 1.40;
  if (p === 'SME' || p === 'AGRI' || p === 'SME & AGRI') return 1.30;
  return 1.40;
}

/** Classify a Users-file Title into the role families the memo's tables use. */
function classifyTitle(t) {
  const s = norm(t);
  if (!s) return 'UNKNOWN';
  if (s.includes('telesales') || s.includes('tele sales') || s.includes('tele-sales')
    || s.includes('call centre agent') || s.includes('call center agent'))          return 'TELESALES';
  if (s.includes('branch loan officer'))                                            return 'BLO';
  if (s.includes('team leader') || s.includes('team sale leader'))                  return 'TL';
  if (s.includes('cluster'))                                                        return 'CLUSTER';
  if (s.includes('branch manager'))                                                 return 'BM';
  if (s.includes('regional') || s === 'rsm' || s.includes('zonal'))                 return 'RSM';
  if (s.includes('supervisor'))                                                     return 'SUPERVISOR';
  if (s.includes('coordinator'))                                                    return 'COORDINATOR';
  return 'AGENT'; // sales agents, loan officers, and anything agent-like
}

/**
 * EA Team Building slot tables — straight from the memo. These are DESTINATION
 * allocations: all candidates come from the same (Tanzanian) staff pool; the
 * KENYA trip slots are filled first, then the UGANDA slots from whoever is
 * left (memo disclaimer: one person cannot qualify for both trips).
 *
 *   pool: 'agent'  → ranked from individual sales reps (role-filtered)
 *         'branch' → ranked from Branch/TL roll-ups   (TLs / FSTLs)
 *         'region' → ranked from Region roll-ups      (BM / RSM / Cluster)
 *   ratio: minimum YTD % of cumulative target; mom: month-on-month activity
 *   manual: slot needs data outside the sales files (BO/RO) — listed only.
 *   special 'TL_ON_TARGET': UG LBF Cluster Manager — 90% of TLs on target YTD.
 */
const EA_SLOT_TABLE = {
  KE: [
    { product: 'LBF',  pool: 'agent',  role: 'AGENT',     label: 'Sales Agents',   slots: 1, ratio: 1.40, mom: true },
    { product: 'LBF',  pool: 'agent',  role: 'TELESALES', label: 'Telesales',      slots: 1, ratio: 1.40, mom: true },
    { product: 'LBF',  pool: 'branch',                    label: 'Team Leaders',   slots: 1, ratio: 1.30 },
    { product: 'LBF',  pool: 'region',                    label: 'BM',             slots: 1, ratio: 1.20 },
    { product: 'CS',   pool: 'agent',  role: 'AGENT',     label: 'Sales Agents',   slots: 1, ratio: 1.40 },
    { product: 'CS',   pool: 'branch',                    label: 'FSTL',           slots: 1, ratio: 1.50 },
    { product: 'CS',   pool: 'region',                    label: 'RSM',            slots: 1, ratio: 1.20 },
    { product: 'CS',   pool: 'region',                    label: 'Cluster Manager',slots: 1, ratio: 1.20 },
    { product: 'SME',  pool: 'agent',  role: 'AGENT',     label: 'Sales Agents',   slots: 1, ratio: 1.30 },
    { product: 'SME',  pool: 'branch',                    label: 'Team Leaders',   slots: 1, ratio: 1.20 },
    { product: 'SME',  pool: 'region',                    label: 'RSM',            slots: 1, ratio: 1.00 },
    { product: 'AGRI', pool: 'agent',  role: 'AGENT',     label: 'Sales Agents',   slots: 1, ratio: 1.30 },
    { product: 'BO',   manual: 'MGM Discretionary',       label: 'BO',             slots: 2 },
    { product: 'RO',   manual: 'Top performer — CE ≥ 90% · Retention ≥ 92% · PAR 30 < 1%', label: 'RO', slots: 1 },
  ],
  UG: [
    { product: 'LBF',  pool: 'agent',  role: 'AGENT',     label: 'Sales Agents',   slots: 2, ratio: 1.40, mom: true },
    { product: 'LBF',  pool: 'agent',  role: 'TELESALES', label: 'Telesales',      slots: 1, ratio: 1.40, mom: true },
    { product: 'LBF',  pool: 'branch',                    label: 'Team Leaders',   slots: 1, ratio: 1.30 },
    { product: 'LBF',  pool: 'region',                    label: 'BM',             slots: 1, ratio: 1.20 },
    { product: 'LBF',  special: 'TL_ON_TARGET',           label: 'Cluster Manager',slots: 1 },
    { product: 'CS',   pool: 'agent',  role: 'AGENT', zone: 'Mainland', label: 'Sales Agents Mainland', slots: 2, ratio: 1.40 },
    { product: 'CS',   pool: 'agent',  role: 'AGENT', zone: 'Zanzibar', label: 'Sales Agents ZNZ',      slots: 1, ratio: 1.50 },
    { product: 'CS',   pool: 'agent',  role: 'BLO',       label: 'BLO',            slots: 1, ratio: 1.50 },
    { product: 'CS',   pool: 'region',                    label: 'RSM',            slots: 1, ratio: 1.20 },
    { product: 'SME',  pool: 'agent',  role: 'AGENT',     label: 'Sales Agents',   slots: 2, ratio: 1.30 },
    { product: 'SME',  pool: 'branch',                    label: 'Team Leaders',   slots: 1, ratio: 1.20 },
    { product: 'AGRI', pool: 'agent',  role: 'AGENT',     label: 'Sales Agents',   slots: 1, ratio: 1.30 },
    { product: 'AGRI', pool: 'branch',                    label: 'Team Leaders',   slots: 1, ratio: 1.20 },
    { product: 'RO',   manual: 'Top performer — CE ≥ 90% · Retention ≥ 92% · PAR 30 < 1%', label: 'RO', slots: 2 },
    { product: 'BO',   manual: 'MGM Discretionary',       label: 'BO',             slots: 2 },
  ],
};

/**
 * Qualify a Team Leader.
 * Criteria: branch actual ≥ (branch target × ratio)  AND  branch PAR>30 ≤ 4%
 *   ratio depends on product + zone (see leaderRatio above).
 */
function qualifyTL(bObj, product, region) {
  const ratio       = leaderRatio(product, region);
  const requiredTgt = bObj.target * ratio;
  const passTarget  = bObj.target > 0 && bObj.totalAmount >= requiredTgt;
  const passPAR     = bObj.par30 <= PAR_LIMIT;
  const ok          = passTarget && passPAR;

  const pct      = bObj.target > 0 ? Math.round((bObj.totalAmount / bObj.target) * 100) : 0;
  const required = Math.round(ratio * 100);
  const parts    = [];
  if (!passTarget) {
    parts.push(bObj.target === 0 ? 'No target set' : `Achievement ${pct}% < ${required}%`);
  }
  if (!passPAR) parts.push(`PAR>30 ${(bObj.par30 * 100).toFixed(1)}% > 4%`);

  return {
    qualified:    ok,
    reason:       ok ? 'Criteria met' : parts.join('; '),
    achievement:  bObj.target > 0 ? bObj.totalAmount / bObj.target : 0,
    par30:        bObj.par30,
    requiredRatio: ratio,
  };
}

/**
 * Qualify a Region / Branch Manager.
 * Criteria: region actual ≥ (region target × ratio)  AND  region PAR>30 ≤ 4%
 *   ratio depends on product + zone (see leaderRatio above).
 */
function qualifyRegion(rObj, product, region) {
  const ratio       = leaderRatio(product, region);
  const requiredTgt = rObj.target * ratio;
  const passTarget  = rObj.target > 0 && rObj.totalAmount >= requiredTgt;
  const passPAR     = rObj.par30 <= PAR_LIMIT;
  const ok          = passTarget && passPAR;

  const pct      = rObj.target > 0 ? Math.round((rObj.totalAmount / rObj.target) * 100) : 0;
  const required = Math.round(ratio * 100);
  const parts    = [];
  if (!passTarget) {
    parts.push(rObj.target === 0 ? 'No target set' : `Achievement ${pct}% < ${required}%`);
  }
  if (!passPAR) parts.push(`PAR>30 ${(rObj.par30 * 100).toFixed(1)}% > 4%`);

  return {
    qualified:    ok,
    reason:       ok ? 'Criteria met' : parts.join('; '),
    achievement:  rObj.target > 0 ? rObj.totalAmount / rObj.target : 0,
    par30:        rObj.par30,
    requiredRatio: ratio,
  };
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * @param {ArrayBuffer} salesBuf
 * @param {ArrayBuffer} usersBuf
 * @param {ArrayBuffer} activitiesBuf
 * @param {ArrayBuffer|null} loanBuf  — Loan Accounts file for PAR>30 calculation
 */
export function processEATeamBuildingReport(salesBuf, usersBuf, activitiesBuf, loanBuf) {

  // ── parse sales file (2 sheets: Sales + Target) ──────────────────────────────
  const salesSheets = parseAllSheets(salesBuf);
  const salesRows   = getSheetRows(salesSheets, 'Sales')  ?? Object.values(salesSheets)[0] ?? [];
  const targetRows  = getSheetRows(salesSheets, 'Target') ?? Object.values(salesSheets)[1] ?? [];

  const usersRows = parseFirst(usersBuf);
  const actRows   = parseFirst(activitiesBuf);

  // ── PAR map from Loan file ────────────────────────────────────────────────────
  // parMap: norm(salesRep) → { totalPrincipal, par30Principal }
  const parMap = {};
  if (loanBuf) {
    const loanSheets = parseAllSheets(loanBuf);
    const loanRows   = getSheetRows(loanSheets, 'Loan Accounts') ?? Object.values(loanSheets)[0] ?? [];
    loanRows.forEach((row) => {
      const vals             = Object.values(row);
      const repName          = trim(String(vals[11] ?? ''));
      if (!repName || norm(repName).startsWith('unallocated')) return;
      const daysInArrears    = parseFloat(String(vals[4]  ?? '0').replace(/,/g, '')) || 0;
      const principalBalance = parseFloat(String(vals[10] ?? '0').replace(/,/g, '')) || 0;
      if (principalBalance <= 0) return;
      const key = norm(repName);
      if (!parMap[key]) parMap[key] = { totalPrincipal: 0, par30Principal: 0 };
      parMap[key].totalPrincipal += principalBalance;
      if (daysInArrears > 30) parMap[key].par30Principal += principalBalance;
    });
  }

  function getAgentPAR(repName) {
    const d = parMap[norm(repName)];
    if (!d || d.totalPrincipal === 0) return { totalPrincipal: 0, par30Principal: 0, par30: 0 };
    return { ...d, par30: d.par30Principal / d.totalPrincipal };
  }

  // ── target map (VLOOKUP style) ────────────────────────────────────────────────
  // col-0 = Branch/TL name, col-1 = target value
  const targetMap = {};
  targetRows.forEach((row) => {
    const vals = Object.values(row);
    if (vals.length < 2) return;
    const key = normKey(String(vals[0] ?? '').trim());
    const raw = vals[1];
    const val = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '0').replace(/,/g, '')) || 0;
    if (!key || key === 'branch/tl' || key === 'branch / tl' || key === 'target' || val === 0) return;
    targetMap[key] = val;
  });

  // ── users map: norm(displayName) → { title, role, branch } ───────────────────
  // We use TITLE (not Role) — Title is more precise and is what the EA Team
  // Building memo's role names refer to (Independent TL, FSTL, BLO, RSM, etc.).
  const usersMap = {};
  usersRows.forEach((row) => {
    const name = norm(getField(row, 'Display Name', 0) ?? getField(row, 'Name', 0) ?? '');
    if (!name) return;
    const title      = trim(String(getField(row, 'Title',  3) ?? ''));
    const role       = trim(String(getField(row, 'Role',   2) ?? ''));
    const userBranch = trim(String(getField(row, 'Branch', 6) ?? ''));
    usersMap[name] = { title, role, branch: userBranch };
  });

  // ── activities map: norm(name) → earliest date ───────────────────────────────
  const actMap = {};
  actRows.forEach((row) => {
    const vals = Object.values(row);
    const name = norm(String(
      getField(row, 'Affected Item Name', 1) ??
      getField(row, 'Name', 1) ??
      vals[1] ?? '',
    ));
    const d = toDate(
      getField(row, 'Creation Date', 0) ??
      getField(row, 'Date', 0) ??
      vals[0] ?? '',
    );
    if (!name || !d) return;
    if (!actMap[name] || d < actMap[name]) actMap[name] = d;
  });

  function getJoinInfo(repName) {
    const d = actMap[norm(repName)];
    if (!d) return { joinDate: 'Unknown', period: 'Unknown', flag: 'No' };
    const ds = d.toLocaleDateString('en-GB');
    if (d < JAN_2026) return { joinDate: ds, period: 'Before Jan 2026', flag: 'Yes' };
    if (d < MAY_2026) return { joinDate: ds, period: 'Jan–Apr 2026',    flag: 'No'  };
    return              { joinDate: ds, period: 'After Apr 2026',   flag: 'No'  };
  }

  function getUser(repName)  { return usersMap[norm(repName)] ?? null; }
  function getRole(repName)  { return getUser(repName)?.role  ?? ''; }
  function getTitle(repName) { return getUser(repName)?.title ?? ''; }

  // ── aggregate agent data from Sales sheet ─────────────────────────────────────
  const agentMap  = {};
  const monthsSet = new Set();

  salesRows.forEach((row) => {
    // Skip IPF loans
    const term = norm(String(getField(row, 'Term', 2) ?? ''));
    if (term.includes('ipf')) return;

    const repName = trim(String(getField(row, 'SALES REP.', 0) ?? getField(row, 'Sales Rep', 0) ?? ''));
    const product = trim(String(getField(row, 'Product', 11) ?? ''));
    const region  = trim(String(getField(row, 'Supervision / Region', 10) ?? getField(row, 'Region', 10) ?? ''));
    const branch  = trim(String(getField(row, 'Branch / TL', 9) ?? getField(row, 'Branch/TL', 9) ?? ''));
    const month   = trim(String(getField(row, 'Month', 5) ?? ''));

    const rawAmt  = getField(row, 'Disburse Amount', 7);
    const rawTgt  = getField(row, 'Reps Target', 6);

    const amount  = typeof rawAmt === 'number' ? rawAmt : parseFloat(String(rawAmt  ?? '0').replace(/,/g, '')) || 0;
    const repsTgt = typeof rawTgt === 'number' ? rawTgt : parseFloat(String(rawTgt  ?? '0').replace(/,/g, '')) || 0;

    if (!repName || !product || !month) return;
    monthsSet.add(month);

    const key = `${product}|||${region}|||${branch}|||${repName}`;
    if (!agentMap[key]) {
      agentMap[key] = { repName, product, region, branch, monthly: {}, totalAmount: 0, totalLoans: 0, repsTarget: 0 };
    }
    const a = agentMap[key];
    if (!a.monthly[month]) a.monthly[month] = { amt: 0, loans: 0 };
    a.monthly[month].amt   += amount;
    a.monthly[month].loans += 1;
    a.totalAmount           += amount;
    a.totalLoans            += 1;
    if (repsTgt > a.repsTarget) a.repsTarget = repsTgt;
  });

  // Enrich agents
  Object.values(agentMap).forEach((a) => {
    Object.assign(a, getJoinInfo(a.repName));
    a.role        = getRole(a.repName);
    a.title       = getTitle(a.repName);
    a.titleFamily = classifyTitle(a.title);
    const p    = getAgentPAR(a.repName);
    a.totalPrincipal = p.totalPrincipal;
    a.par30Principal = p.par30Principal;
    a.par30          = p.par30;
  });

  const monthsInData = [...monthsSet].sort((x, y) => MONTH_ORDER.indexOf(x) - MONTH_ORDER.indexOf(y));
  const monthsCount  = monthsInData.length || 1;

  // ── build hierarchy ───────────────────────────────────────────────────────────
  const hierarchy = {};
  Object.values(agentMap).forEach((a) => {
    if (!hierarchy[a.product]) hierarchy[a.product] = { regions: {} };
    const pObj = hierarchy[a.product];
    if (!pObj.regions[a.region]) pObj.regions[a.region] = { branches: {} };
    const rObj = pObj.regions[a.region];
    if (!rObj.branches[a.branch]) rObj.branches[a.branch] = { agents: [] };
    rObj.branches[a.branch].agents.push(a);
  });

  // ── qualification (bottom-up) ─────────────────────────────────────────────────
  const PRODUCT_ORDER = ['CS', 'LBF', 'SME'];
  const products = [
    ...PRODUCT_ORDER.filter((p) => hierarchy[p]),
    ...Object.keys(hierarchy).filter((p) => !PRODUCT_ORDER.includes(p)),
  ];

  products.forEach((product) => {
    const pObj = hierarchy[product];

    Object.entries(pObj.regions).forEach(([region, rObj]) => {
      // Region target VLOOKUP (with override for SME region name mismatches)
      const regionKey = REGION_OVERRIDES[normKey(region)] ?? normKey(region);
      // Multiply by monthsCount so cumulative actual can be compared to cumulative target
      rObj.target     = (targetMap[regionKey] ?? 0) * monthsCount;

      Object.entries(rObj.branches).forEach(([branch, bObj]) => {
        // TL target: cumulative (monthly × months)
        bObj.target = (targetMap[normKey(branch)] ?? 0) * monthsCount;

        // Step 1: qualify each agent (cumulative thresholds)
        bObj.agents.forEach((agent) => {
          const q           = qualifyAgent(agent, product, region, monthsCount);
          agent.qualified   = q.qualified;
          agent.qualReason  = q.reason;
          agent.minLoans    = q.minLoans;
          agent.minDisb     = q.minDisb;
          agent.target      = agent.repsTarget * monthsCount;
        });

        // Step 2: branch totals + PAR (aggregated across all agents)
        bObj.totalAmount    = bObj.agents.reduce((s, a) => s + a.totalAmount, 0);
        bObj.totalLoans     = bObj.agents.reduce((s, a) => s + a.totalLoans,  0);
        bObj.totalPrincipal = bObj.agents.reduce((s, a) => s + a.totalPrincipal, 0);
        bObj.par30Principal = bObj.agents.reduce((s, a) => s + a.par30Principal, 0);
        bObj.par30          = bObj.totalPrincipal > 0 ? bObj.par30Principal / bObj.totalPrincipal : 0;
        bObj.qualCount      = bObj.agents.filter((a) => a.qualified).length;

        // TL name from "Branch Name (TL Name)" pattern
        const tlMatch = trim(branch).match(/\(([^)]+)\)\s*$/);
        bObj.tlName   = tlMatch ? trim(tlMatch[1]) : trim(branch);

        // Step 3: qualify TL (per LOCAL TRIPS memo % target + PAR ≤ 4%)
        const tlQual       = qualifyTL(bObj, product, region);
        bObj.tlQualified   = tlQual.qualified;
        bObj.tlReason      = tlQual.reason;
        bObj.tlAchievement = tlQual.achievement;
        bObj.tlPar30       = tlQual.par30;
        bObj.tlRequiredRatio = tlQual.requiredRatio;
      });

      // Step 4: region totals + PAR
      rObj.totalAmount    = Object.values(rObj.branches).reduce((s, b) => s + b.totalAmount, 0);
      rObj.totalLoans     = Object.values(rObj.branches).reduce((s, b) => s + b.totalLoans,  0);
      rObj.totalPrincipal = Object.values(rObj.branches).reduce((s, b) => s + b.totalPrincipal, 0);
      rObj.par30Principal = Object.values(rObj.branches).reduce((s, b) => s + b.par30Principal, 0);
      rObj.par30          = rObj.totalPrincipal > 0 ? rObj.par30Principal / rObj.totalPrincipal : 0;
      rObj.qualCount      = Object.values(rObj.branches).reduce((s, b) => s + b.qualCount, 0);

      // Step 5: qualify region (per LOCAL TRIPS memo % target + PAR ≤ 4%)
      const rq               = qualifyRegion(rObj, product, region);
      rObj.regionQualified   = rq.qualified;
      rObj.regionReason      = rq.reason;
      rObj.regionAchievement = rq.achievement;
      rObj.regionPar30       = rq.par30;
      rObj.regionRequiredRatio = rq.requiredRatio;
    });

    // Product totals
    pObj.target      = Object.values(pObj.regions).reduce((s, r) => s + r.target,      0);
    pObj.totalAmount = Object.values(pObj.regions).reduce((s, r) => s + r.totalAmount, 0);
    pObj.totalLoans  = Object.values(pObj.regions).reduce((s, r) => s + r.totalLoans,  0);
    pObj.qualCount   = Object.values(pObj.regions).reduce((s, r) => s + r.qualCount,   0);
  });

  // ── EA Team Building eligibility + destination-slot selection ─────────────
  // Step A: per-agent eligibility — the memo's "Top performer (xxx% YTD)" bar:
  //   YTD % of cumulative target ≥ ratio, PAR ≤ 4%, and (LBF only) active
  //   month-on-month. This drives the Qualified / Not Qualified sheets.
  const activeEveryMonth = (a) =>
    monthsInData.length > 0 && monthsInData.every((m) => (a.monthly[m]?.loans || 0) > 0);

  Object.values(agentMap).forEach((a) => {
    const ratio     = agentTopRatio(a.product, a.region);
    const targetCum = (a.repsTarget || 0) * monthsCount;
    const pct       = targetCum > 0 ? a.totalAmount / targetCum : 0;
    const needsMoM  = String(a.product).toUpperCase() === 'LBF';
    const momOk     = !needsMoM || activeEveryMonth(a);

    a.eaTopRatio      = ratio;
    a.eaYtdPct        = pct;
    a.eaThresholdPass = targetCum > 0 && pct >= ratio;
    a.momActive       = activeEveryMonth(a);
    a.qualified       = a.eaThresholdPass && (a.par30 || 0) <= PAR_LIMIT && momOk;
    a.qualReason      = a.qualified ? 'EA TB threshold met'
      : !a.eaThresholdPass ? `YTD ${Math.round(pct * 100)}% < ${Math.round(ratio * 100)}% (target ${targetCum.toLocaleString()})`
      : (a.par30 || 0) > PAR_LIMIT ? `PAR>30 ${((a.par30 || 0) * 100).toFixed(1)}% > 4%`
      : 'Not active every month (month-on-month sales required)';
    a.selected    = false;
    a.selectedFor = null;
  });

  // Step B: candidate pools per slot definition.
  const agentPool = (def) => Object.values(agentMap).filter((a) => {
    if (String(a.product).toUpperCase() !== def.product) return false;
    const fam = a.titleFamily === 'UNKNOWN' ? 'AGENT' : a.titleFamily;
    if (fam !== def.role) return false;
    if (def.zone === 'Mainland' && isZanzibar(a.region)) return false;
    if (def.zone === 'Zanzibar' && !isZanzibar(a.region)) return false;
    const targetCum = (a.repsTarget || 0) * monthsCount;
    const pct       = targetCum > 0 ? a.totalAmount / targetCum : 0;
    if (!(targetCum > 0 && pct >= def.ratio)) return false;
    if ((a.par30 || 0) > PAR_LIMIT) return false;
    if (def.mom && !activeEveryMonth(a)) return false;
    return true;
  }).map((a) => ({
    key:   `A|${norm(a.repName)}`,
    name:  a.repName,
    detail:`${a.branch || a.region}`,
    pct:   a.eaYtdPct,
    par30: a.par30 || 0,
    _agent: a,
  }));

  const branchPool = (def) => {
    const ph = hierarchy[def.product];
    if (!ph) return [];
    const out = [];
    Object.entries(ph.regions).forEach(([region, rObj]) => {
      Object.entries(rObj.branches).forEach(([branch, bObj]) => {
        if (!(bObj.target > 0)) return;
        const pct = bObj.totalAmount / bObj.target;
        if (pct < def.ratio) return;
        if ((bObj.par30 || 0) > PAR_LIMIT) return;
        out.push({
          key:   `B|${normKey(branch)}`,
          name:  bObj.tlName || branch,
          detail: bObj.tlName && bObj.tlName !== branch ? branch : region,
          pct,
          par30: bObj.par30 || 0,
        });
      });
    });
    return out;
  };

  const regionPool = (def) => {
    const ph = hierarchy[def.product];
    if (!ph) return [];
    const out = [];
    Object.entries(ph.regions).forEach(([region, rObj]) => {
      if (!(rObj.target > 0)) return;
      const pct = rObj.totalAmount / rObj.target;
      if (pct < def.ratio) return;
      if ((rObj.par30 || 0) > PAR_LIMIT) return;
      out.push({ key: `R|${normKey(region)}`, name: region, detail: 'Region', pct, par30: rObj.par30 || 0 });
    });
    return out;
  };

  // Special: UG LBF Cluster Manager — 90% of TLs must be on target YTD.
  function tlOnTargetShare(product) {
    const ph = hierarchy[product];
    if (!ph) return { share: 0, onTarget: 0, total: 0 };
    let total = 0, onTarget = 0;
    Object.values(ph.regions).forEach((rObj) => {
      Object.values(rObj.branches).forEach((bObj) => {
        if (!(bObj.target > 0)) return;
        total++;
        if (bObj.totalAmount / bObj.target >= 1.0) onTarget++;
      });
    });
    return { share: total > 0 ? onTarget / total : 0, onTarget, total };
  }

  // Step C: fill the slots — Kenya first, then Uganda from whoever is left
  // (memo: qualifying for one trip removes eligibility for the other).
  const taken = new Set();
  const selection = { KE: [], UG: [] };

  ['KE', 'UG'].forEach((country) => {
    EA_SLOT_TABLE[country].forEach((def) => {
      const entry = {
        product: def.product,
        label:   def.label,
        slots:   def.slots,
        ratio:   def.ratio ?? null,
        manual:  def.manual ?? null,
        selected: [],
        candidateCount: 0,
        note: '',
      };

      if (def.manual) {
        entry.note = def.manual;
      } else if (def.special === 'TL_ON_TARGET') {
        const { share, onTarget, total } = tlOnTargetShare(def.product);
        const met = total > 0 && share >= 0.9;
        entry.note = total === 0
          ? 'No TL targets available'
          : `${Math.round(share * 100)}% of TLs on target (${onTarget}/${total}) — ${met ? 'criteria MET' : 'below the 90% bar'}`;
        entry.criteriaMet = met;
      } else {
        const pool = (def.pool === 'agent' ? agentPool(def)
          : def.pool === 'branch' ? branchPool(def)
          : regionPool(def))
          .sort((a, b) => b.pct - a.pct);
        entry.candidateCount = pool.length;
        for (const cand of pool) {
          if (entry.selected.length >= def.slots) break;
          if (taken.has(cand.key)) continue;
          taken.add(cand.key);
          entry.selected.push({ name: cand.name, detail: cand.detail, pct: cand.pct, par30: cand.par30 });
          if (cand._agent) { cand._agent.selected = true; cand._agent.selectedFor = country; }
        }
        if (!entry.selected.length) {
          entry.note = pool.length === 0
            ? 'No candidate meets the threshold'
            : 'All qualifying candidates already selected in another slot';
        }
      }
      selection[country].push(entry);
    });
  });

  // ── summary ───────────────────────────────────────────────────────────────────
  const allAgents = Object.values(agentMap);

  let qualifiedTLs = 0;
  let qualifiedRegions = 0;
  products.forEach((p) => {
    Object.values(hierarchy[p].regions).forEach((rObj) => {
      if (rObj.regionQualified) qualifiedRegions++;
      Object.values(rObj.branches).forEach((bObj) => {
        if (bObj.tlQualified) qualifiedTLs++;
      });
    });
  });

  // Selected count per product across BOTH trips (agents + TL/branch + region
  // slots) — so the per-product breakdown's SELECTED column sums to the total.
  const selByProduct = {};
  ['KE', 'UG'].forEach((c) => selection[c].forEach((e) => {
    selByProduct[e.product] = (selByProduct[e.product] || 0) + e.selected.length;
  }));

  const summary = {
    totalAgents:     allAgents.length,
    totalAmount:     allAgents.reduce((s, a) => s + a.totalAmount, 0),
    totalLoans:      allAgents.reduce((s, a) => s + a.totalLoans,  0),
    qualified:       allAgents.filter((a) => a.qualified).length,
    notQualified:    allAgents.filter((a) => !a.qualified).length,
    qualifiedTLs,
    qualifiedRegions,
    oldAgents:       allAgents.filter((a) => a.flag === 'Yes').length,
    newAgents:       allAgents.filter((a) => a.flag === 'No' && a.period !== 'Unknown').length,
    monthsInData,
    byProduct: Object.fromEntries(
      products.map((p) => {
        const list = Object.values(hierarchy[p].regions)
          .flatMap((r) => Object.values(r.branches).flatMap((b) => b.agents));
        return [p, {
          target:      hierarchy[p].target,
          totalAmount: hierarchy[p].totalAmount,
          totalLoans:  hierarchy[p].totalLoans,
          // "qualified" here = ELIGIBLE (met the role's YTD top-performer bar),
          // recomputed AFTER the EA-TB override so it sums to summary.qualified.
          qualified:   list.filter((a) => a.qualified).length,
          // SELECTED across both trips incl. TL/branch + region slots (not just
          // individual agents), so it sums to selectedTotal.
          selected:    selByProduct[p] || 0,
          agents:      list.length,
        }];
      }),
    ),
    // EA-specific roll-ups (auto-selected slots — BO/RO manual slots excluded)
    selectedKE: selection.KE.reduce((s, e) => s + e.selected.length, 0),
    selectedUG: selection.UG.reduce((s, e) => s + e.selected.length, 0),
    selectedTotal:
      selection.KE.reduce((s, e) => s + e.selected.length, 0) +
      selection.UG.reduce((s, e) => s + e.selected.length, 0),
    slotsKE: EA_SLOT_TABLE.KE.reduce((s, e) => s + e.slots, 0),
    slotsUG: EA_SLOT_TABLE.UG.reduce((s, e) => s + e.slots, 0),
  };

  return { hierarchy, monthsInData, products, summary, selection };
}
