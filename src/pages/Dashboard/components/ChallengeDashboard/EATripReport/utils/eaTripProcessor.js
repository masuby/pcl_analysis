/**
 * EA Trip Report — Processor
 *
 * Criteria (EAST AFRICA TRIP / SALES MANAGERS memo — 2026):
 * ─────────────────────────────────────────────────────────────────────────────
 * Audience: SALES MANAGERS ONLY (Branch Managers, Call Center Supervisors,
 *           Regional Managers, SME Regional Managers).
 * Agents and Team Leaders are excluded from this report — the engine filters
 * them out via the MANAGER_ROLES whitelist below.
 * ─────────────────────────────────────────────────────────────────────────────
 * LEADER % thresholds (same shape as Local Trip, applied at branch/region level)
 *   LBF BM / Call Center Supervisor  → ≥130% cumulative YTD sales · PAR ≤ 4%
 *   CS  Regional Manager (Mainland)  → ≥150% cumulative YTD sales · PAR ≤ 4%
 *   CS  Regional Manager (Zanzibar)  → ≥130% cumulative YTD sales · PAR ≤ 4%
 *   SME Regional Manager             → ≥120% cumulative YTD sales · PAR ≤ 4%
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTE on "130 % loan counts": deferred — Sales file has no loan-count target.
 * ─────────────────────────────────────────────────────────────────────────────
 * Tenure rule: all staff must have ≥3 months of work (rows where earliest
 *              activity date is after the start of the reporting window are
 *              treated as "After Apr 2026" / excluded by the upstream filter).
 *
 * Legacy header retained below for reference of the threshold shape.
 * ─────────────────────────────────────────────────────────────────────────────
 * ORIGINAL criteria block (Local Trip — Sales Departments):
 * ─────────────────────────────────────────────────────────────────────────────
 * AGENT thresholds (per-month, × N months for cumulative)
 *   LBF Agent  Old  ≥4 loans/month  AND ≥20,000,000 TZS/month
 *   LBF Agent  New  ≥3 loans/month  AND ≥15,000,000 TZS/month
 *   CS  Agent  Old  Mainland  ≥4 loans/month  AND ≥10,000,000 TZS/month
 *   CS  Agent  Old  Zanzibar  ≥4 loans/month  AND ≥20,000,000 TZS/month
 *   CS  Agent  New  Mainland  ≥3 loans/month  AND  ≥7,500,000 TZS/month
 *   CS  Agent  New  Zanzibar  ≥3 loans/month  AND ≥15,000,000 TZS/month
 *   SME & AGRI Agent  All  ≥4 loans/month  AND ≥8,000,000 TZS/month  (cum 32 loans)
 * ─────────────────────────────────────────────────────────────────────────────
 * TEAM LEADER thresholds (% of cumulative sales target + PAR>30 ≤ 4%)
 *   LBF TL                ≥130% cumulative sales target
 *   CS  TL  TZ Mainland   ≥150% cumulative sales target
 *   CS  TL  Zanzibar      ≥130% cumulative sales target
 *   SME & AGRI TL/BM/SrLO ≥120% cumulative sales target
 * ─────────────────────────────────────────────────────────────────────────────
 * REGION / BRANCH MANAGER thresholds (% of cumulative target + PAR>30 ≤ 4%)
 *   LBF Region/BM              ≥130%
 *   CS  Region/BM TZ Mainland  ≥150%
 *   CS  Region/BM Zanzibar     ≥130%
 *   SME & AGRI Region/BM       ≥120%
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTE: "Achieve 130% new business" and "loan counts" lines from the memo
 * are stricter SUB-CRITERIA on top of the sales-target percentage. They are
 * not enforced here because the current Sales/Loan source files do not
 * separate "new business" disbursements from renewals and do not surface a
 * loan-count target. They can be added once those columns are wired through.
 * ─────────────────────────────────────────────────────────────────────────────
 * IPF exclusion: Term contains "IPF" → skip for loan counts
 * Old agent   = earliest activity date < 2026-01-01
 * New agent   = earliest activity date Jan–Apr 2026
 * CS Zanzibar = Supervision/Region contains "ZANZIBAR"
 * Tenure rule: agents with no activity record or first activity after Apr 2026
 *              are flagged as 'No' / 'After Apr 2026' and effectively excluded.
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
 * Local Trip leader-level percentage thresholds (per LOCAL TRIPS memo).
 * Applied to both Team Leader (branch) and Region / Branch Manager levels.
 *   LBF              → 130 %
 *   CS  TZ Mainland  → 150 %
 *   CS  Zanzibar     → 130 %
 *   SME & AGRI       → 120 %
 * Unknown products fall back to 130 % to err on the strict side.
 */
function leaderRatio(product, region) {
  const p = String(product || '').toUpperCase();
  if (p === 'LBF') return 1.30;
  if (p === 'CS')  return isZanzibar(region) ? 1.30 : 1.50;
  if (p === 'SME' || p === 'AGRI' || p === 'SME & AGRI') return 1.20;
  return 1.30;
}

/**
 * Qualify a Team Leader / Branch Manager (EA Trip criteria).
 * 4 criteria per memo:
 *   (a) Sales target  ≥ ratio
 *   (b) Loan count    ≥ ratio   (skipped if no loan-count target available)
 *   (c) PAR ≤ 4%
 * SME only requires (a) and (c); CS/LBF require all four.
 */
function qualifyTL(bObj, product, region) {
  const ratio      = leaderRatio(product, region);
  const p          = String(product || '').toUpperCase();
  const requiresLoanCount = (p === 'LBF' || p === 'CS');

  const reqSales  = bObj.target * ratio;
  const passSales = bObj.target > 0 && bObj.totalAmount >= reqSales;
  const salesPct  = bObj.target > 0 ? bObj.totalAmount / bObj.target : 0;

  const reqLoans  = bObj.loansTarget * ratio;
  const passLoans = !requiresLoanCount || (bObj.loansTarget > 0 && bObj.totalLoans >= reqLoans);
  const loansPct  = bObj.loansTarget > 0 ? bObj.totalLoans / bObj.loansTarget : 0;

  const passPAR   = bObj.par30 <= PAR_LIMIT;
  const ok = passSales && passLoans && passPAR;

  const required = Math.round(ratio * 100);
  const parts = [];
  if (!passSales) parts.push(bObj.target === 0      ? 'No sales target' : `Sales ${Math.round(salesPct*100)}% < ${required}%`);
  if (!passLoans) parts.push(bObj.loansTarget === 0 ? 'No loan-count tgt' : `Loans ${Math.round(loansPct*100)}% < ${required}%`);
  if (!passPAR)   parts.push(`PAR>30 ${(bObj.par30 * 100).toFixed(1)}% > 4%`);

  return {
    qualified: ok, reason: ok ? 'Criteria met' : parts.join('; '),
    achievement: salesPct, loansAchv: loansPct,
    par30: bObj.par30, requiredRatio: ratio,
  };
}

function qualifyRegion(rObj, product, region) {
  const ratio      = leaderRatio(product, region);
  const p          = String(product || '').toUpperCase();
  const requiresLoanCount = (p === 'LBF' || p === 'CS');

  const reqSales  = rObj.target * ratio;
  const passSales = rObj.target > 0 && rObj.totalAmount >= reqSales;
  const salesPct  = rObj.target > 0 ? rObj.totalAmount / rObj.target : 0;

  const reqLoans  = rObj.loansTarget * ratio;
  const passLoans = !requiresLoanCount || (rObj.loansTarget > 0 && rObj.totalLoans >= reqLoans);
  const loansPct  = rObj.loansTarget > 0 ? rObj.totalLoans / rObj.loansTarget : 0;

  const passPAR   = rObj.par30 <= PAR_LIMIT;
  const ok = passSales && passLoans && passPAR;

  const required = Math.round(ratio * 100);
  const parts = [];
  if (!passSales) parts.push(rObj.target === 0      ? 'No sales target' : `Sales ${Math.round(salesPct*100)}% < ${required}%`);
  if (!passLoans) parts.push(rObj.loansTarget === 0 ? 'No loan-count tgt' : `Loans ${Math.round(loansPct*100)}% < ${required}%`);
  if (!passPAR)   parts.push(`PAR>30 ${(rObj.par30 * 100).toFixed(1)}% > 4%`);

  return {
    qualified: ok, reason: ok ? 'Criteria met' : parts.join('; '),
    achievement: salesPct, loansAchv: loansPct,
    par30: rObj.par30, requiredRatio: ratio,
  };
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * @param {ArrayBuffer} salesBuf
 * @param {ArrayBuffer} usersBuf
 * @param {ArrayBuffer} activitiesBuf
 * @param {ArrayBuffer|null} loanBuf  — Loan Accounts file for PAR>30 calculation
 */
// Titles considered "Sales Manager" for the EA Trip (case-insensitive substring).
// We use TITLE (not Role) per the corrected spec — Title is more precise and
// distinguishes Branch Manager vs Regional vs Cluster vs Call Centre Supervisor.
const MANAGER_TITLES = [
  'branch manager',
  'call center supervisor',
  'call centre supervisor',
  'regional sales manager',
  'regional manager',
  'cluster manager',
  'zonal sales manager',
  'zonal manager',
  'rsm',
];

function isManagerTitle(title) {
  const t = String(title || '').toLowerCase().trim();
  if (!t) return false;
  return MANAGER_TITLES.some((needle) => t.includes(needle)) || t === 'rsm';
}

export function processEATripReport(salesBuf, usersBuf, activitiesBuf, loanBuf) {

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

  // ── users map: norm(displayName) → { title, role, branch } (use Title) ──────
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

  function getUser(repName) { return usersMap[norm(repName)] ?? null; }
  function getRole(repName) { return getUser(repName)?.role  ?? ''; }
  function getTitle(repName){ return getUser(repName)?.title ?? ''; }

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
    a.role  = getRole(a.repName);
    a.title = getTitle(a.repName);
    const p = getAgentPAR(a.repName);
    a.totalPrincipal = p.totalPrincipal;
    a.par30Principal = p.par30Principal;
    a.par30          = p.par30;
  });

  // NOTE: We do NOT filter by manager title here.
  // Managers don't usually appear as Sales Reps in the Sales file — they MANAGE
  // branches/regions. The EA Trip criteria reward managers based on the
  // performance of the branch (LBF Branch Managers) or region (CS / SME
  // Regional Managers) they oversee. So we keep all sales reps for aggregation
  // and let qualifyTL / qualifyRegion produce the per-manager verdicts. The
  // export/UI then surfaces those at the appropriate level per product.

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

        // Step 2: branch totals + PAR + loan-count target
        bObj.totalAmount    = bObj.agents.reduce((s, a) => s + a.totalAmount, 0);
        bObj.totalLoans     = bObj.agents.reduce((s, a) => s + a.totalLoans,  0);
        bObj.loansTarget    = bObj.agents.reduce((s, a) => s + (a.minLoans || 0), 0);
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

      // Step 4: region totals + PAR + loan-count target
      rObj.totalAmount    = Object.values(rObj.branches).reduce((s, b) => s + b.totalAmount, 0);
      rObj.totalLoans     = Object.values(rObj.branches).reduce((s, b) => s + b.totalLoans,  0);
      rObj.loansTarget    = Object.values(rObj.branches).reduce((s, b) => s + (b.loansTarget || 0), 0);
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

  // ── EA TRIP manager counts — per the memo's eligibility table:
  //     LBF  → Branch Managers   (branch level)
  //     CS   → Regional Managers (region level)
  //     SME  → Regional Manager  (region level)
  function countBranches(p) {
    const ph = hierarchy[p];
    if (!ph) return { total: 0, qualified: 0 };
    let total = 0, qualified = 0;
    Object.values(ph.regions).forEach((r) => {
      Object.values(r.branches).forEach((b) => {
        total++;
        if (b.tlQualified) qualified++;
      });
    });
    return { total, qualified };
  }
  function countRegions(p) {
    const ph = hierarchy[p];
    if (!ph) return { total: 0, qualified: 0 };
    const regs = Object.values(ph.regions);
    return { total: regs.length, qualified: regs.filter((r) => r.regionQualified).length };
  }

  const lbfMgrs = countBranches('LBF');           // LBF Branch Managers
  const csMgrs  = countRegions('CS');             // CS Regional Managers
  const smeMgrs = countRegions('SME');            // SME Regional Manager
  const totalManagers   = lbfMgrs.total     + csMgrs.total     + smeMgrs.total;
  const qualifiedMgrs   = lbfMgrs.qualified + csMgrs.qualified + smeMgrs.qualified;

  const summary = {
    totalAgents:     allAgents.length,
    totalAmount:     allAgents.reduce((s, a) => s + a.totalAmount, 0),
    totalLoans:      allAgents.reduce((s, a) => s + a.totalLoans,  0),
    qualified:       allAgents.filter((a) => a.qualified).length,
    notQualified:    allAgents.filter((a) => !a.qualified).length,
    qualifiedTLs,
    qualifiedRegions,
    // EA Trip manager metrics (single source of truth — used by web + Excel)
    totalManagers,
    qualifiedManagers: qualifiedMgrs,
    lbfMgrs,         // { total, qualified } — LBF Branch Managers
    csMgrs,          // { total, qualified } — CS Regional Managers
    smeMgrs,         // { total, qualified } — SME Regional Manager
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
  };

  return { hierarchy, monthsInData, products, summary };
}
