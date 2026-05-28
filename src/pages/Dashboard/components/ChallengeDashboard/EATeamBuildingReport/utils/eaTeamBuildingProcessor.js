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
 * Cross-trip exclusion: if a staff member qualifies for the EA Trip
 * (managers report), they cannot also qualify here (memo disclaimer).
 * ─────────────────────────────────────────────────────────────────────────────
 * Country detection:  Region / Supervision text containing "KENYA" → KE,
 *                     "UGANDA" → UG. Anything else → "TZ/Other" (kept for
 *                     reference but not eligible for KE or UG slots).
 *
 * NOTE: This engine applies the YTD % thresholds and ranks candidates. The
 * MGM-discretionary (BO) and special-metric (RO: CE/Retention/PAR<1%) slots
 * are surfaced but not auto-selected — those require manual MGM input that
 * lives outside the source xlsx files.
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
 * Country detection from a region/supervision label.
 * Returns 'KE', 'UG', or 'OTHER' (TZ / unknown / out-of-scope).
 */
function detectCountry(region) {
  const r = norm(region);
  if (r.includes('kenya') || /\bke\b/.test(r)) return 'KE';
  if (r.includes('uganda') || /\bug\b/.test(r)) return 'UG';
  return 'OTHER';
}

/**
 * EA Team Building leader-level YTD % thresholds per (country, product).
 *
 *   KE — LBF TL/BM 130/120 % · CS FSTL 150 % · CS RSM/CM 120 % · SME TL 120 %
 *        SME RSM 100 % · AGRI 130 %
 *   UG — LBF TL/BM 130/120 % · CS BLO 150 % · CS RSM 120 % · SME TL 120 %
 *        AGRI TL 120 %
 *
 * For the simplified branch/region rollup we use a single representative
 * ratio per (country, product). Unknown products fall back to 130 %.
 */
function leaderRatio(product, region /*, country */) {
  const p = String(product || '').toUpperCase();
  if (p === 'LBF') return 1.30;
  if (p === 'CS')  return isZanzibar(region) ? 1.30 : 1.50;
  if (p === 'SME' || p === 'AGRI' || p === 'SME & AGRI') return 1.20;
  return 1.30;
}

/**
 * EA Team Building AGENT-level YTD % threshold per (country, product, zone).
 * Used to filter the candidate pool before ranking for top-N selection.
 *   LBF Sales Agent  → 140 % YTD
 *   CS  Sales Agent (Mainland / KE / UG-Mainland) → 140 % YTD
 *   CS  Sales Agent  Zanzibar (UG only)           → 150 % YTD
 *   SME Sales Agent  → 130 % YTD
 *   AGRI Sales Agent → 130 % YTD
 */
function agentTopRatio(product, region) {
  const p = String(product || '').toUpperCase();
  if (p === 'LBF') return 1.40;
  if (p === 'CS')  return isZanzibar(region) ? 1.50 : 1.40;
  if (p === 'SME' || p === 'AGRI' || p === 'SME & AGRI') return 1.30;
  return 1.40;
}

/**
 * EA Team Building per-country slot allocation table.
 * Slot counts are advisory — the engine flags top-N agents (per (country,
 * product)) as "selected"; finer role splits (FSTL vs RSM, BO/RO discretion)
 * are deferred to the export and surfaced for manual MGM review.
 */
const EA_SLOTS = {
  KE: { LBF: 4, CS: 4, SME: 3, AGRI: 1, RO: 1, BO: 2 },  // total 15
  UG: { LBF: 6, CS: 5, SME: 3, AGRI: 2, RO: 2, BO: 2 },  // total 20
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
    a.role     = getRole(a.repName);
    a.title    = getTitle(a.repName);
    a.country  = detectCountry(a.region);
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

  // ── EA Team Building top-N selection ──────────────────────────────────────
  // Override the cumulative-threshold `qualified` flag from qualifyAgent with
  // the EA TB YTD-% threshold. Then, per (country, product), rank by % of
  // cumulative target and mark the top-N as `selected = true` per EA_SLOTS.
  Object.values(agentMap).forEach((a) => {
    const ratio    = agentTopRatio(a.product, a.region);
    const targetCum = (a.repsTarget || 0) * monthsCount;
    const pct       = targetCum > 0 ? a.totalAmount / targetCum : 0;
    a.eaTopRatio    = ratio;
    a.eaYtdPct      = pct;
    a.eaThresholdPass = targetCum > 0 && pct >= ratio;
    // Replace the standard `qualified` semantics with EA TB's:
    //   eligible = passes YTD% threshold AND PAR ≤ 4% (sales-rep level)
    a.qualified    = a.eaThresholdPass && (a.par30 || 0) <= PAR_LIMIT;
    a.qualReason   = a.qualified
      ? 'EA TB threshold met'
      : `YTD ${Math.round(pct * 100)}% < ${Math.round(ratio * 100)}% (target ${targetCum.toLocaleString()})`;
    a.selected     = false; // set in next pass
  });

  // Top-N selection per (country, product), descending by YTD %
  Object.entries(EA_SLOTS).forEach(([country, perProduct]) => {
    Object.entries(perProduct).forEach(([product, slots]) => {
      if (!slots) return;
      const pool = Object.values(agentMap)
        .filter((a) => a.country === country && a.product === product && a.qualified)
        .sort((a, b) => (b.eaYtdPct || 0) - (a.eaYtdPct || 0));
      pool.slice(0, slots).forEach((a) => { a.selected = true; });
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
      products.map((p) => [p, {
        target:      hierarchy[p].target,
        totalAmount: hierarchy[p].totalAmount,
        totalLoans:  hierarchy[p].totalLoans,
        qualified:   hierarchy[p].qualCount,
        agents:      Object.values(hierarchy[p].regions)
          .flatMap((r) => Object.values(r.branches).flatMap((b) => b.agents)).length,
      }]),
    ),
    // EA-specific roll-ups
    selectedTotal: allAgents.filter((a) => a.selected).length,
    selectedKE:    allAgents.filter((a) => a.selected && a.country === 'KE').length,
    selectedUG:    allAgents.filter((a) => a.selected && a.country === 'UG').length,
    eligibleKE:    allAgents.filter((a) => a.qualified && a.country === 'KE').length,
    eligibleUG:    allAgents.filter((a) => a.qualified && a.country === 'UG').length,
    byCountry: ['KE', 'UG', 'OTHER'].reduce((acc, c) => {
      const list = allAgents.filter((a) => a.country === c);
      acc[c] = {
        total:    list.length,
        eligible: list.filter((a) => a.qualified).length,
        selected: list.filter((a) => a.selected).length,
      };
      return acc;
    }, {}),
  };

  return { hierarchy, monthsInData, products, summary, slots: EA_SLOTS };
}
