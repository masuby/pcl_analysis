/**
 * Team Building Report — Processor
 *
 * Criteria (TeamBuilding_Criteria_2026.xlsx — updated):
 * ─────────────────────────────────────────────────────────────────────────────
 * LBF Agent  Old  ≥4 loans/month  AND ≥20,000,000 TZS/month  → cumulative × N months
 * LBF Agent  New  ≥3 loans/month  AND ≥15,000,000 TZS/month
 * LBF TL          ≥100% target achieved  AND PAR>30 ≤ 4%
 * ─────────────────────────────────────────────────────────────────────────────
 * CS  Agent  Old  Mainland  ≥4 loans/month  AND ≥10,000,000 TZS/month
 * CS  Agent  Old  Zanzibar  ≥4 loans/month  AND ≥20,000,000 TZS/month
 * CS  Agent  New  Mainland  ≥3 loans/month  AND  ≥7,500,000 TZS/month
 * CS  Agent  New  Zanzibar  ≥3 loans/month  AND ≥15,000,000 TZS/month
 * CS  TL     All            ≥100% cumulative target  AND PAR>30 ≤ 4%
 * ─────────────────────────────────────────────────────────────────────────────
 * SME Agent  Old  ≥4 loans/month  AND ≥8,000,000 TZS/month
 * SME Agent  New  ≥3 loans/month  AND ≥6,000,000 TZS/month
 * SME TL          ≥100% target achieved  AND PAR>30 ≤ 4%
 * ─────────────────────────────────────────────────────────────────────────────
 * Region/BM  All  ≥100% target achieved  AND PAR>30 ≤ 4%
 * ─────────────────────────────────────────────────────────────────────────────
 * IPF exclusion: Term contains "IPF" → skip for loan counts
 * Old agent   = earliest activity date < 2026-01-01
 * New agent   = earliest activity date Jan–Apr 2026
 * CS Zanzibar = Supervision/Region contains "ZANZIBAR"
 */

import * as XLSX from 'xlsx';

// ── helpers ───────────────────────────────────────────────────────────────────
const trim    = (s) => String(s ?? '').trim();
const norm    = (s) => trim(s).toLowerCase();
const normKey = (s) => trim(s).replace(/\s+/g, ' ').toLowerCase();

/**
 * Branch key for the Zone-and-Clusters VLOOKUP: case/space-insensitive and with
 * the generic words Branch/Centre/Center removed, so "LBF TAZARA BRANCH",
 * "LBF Tazara Branch" and "LBF Tazara" all resolve to the same cluster.
 */
const normBranchKey = (s) =>
  trim(s)
    .replace(/ /g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b(branch|centre|center)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

/** A Team Leader is identified by their Title (not Role) containing "TEAM LEADER". */
const isTeamLeaderTitle = (title) => /team\s*leader/i.test(String(title ?? ''));

const MONTH_ORDER = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const JAN_2026  = new Date('2026-01-01');
const MAY_2026  = new Date('2026-05-01');
const PAR_LIMIT = 0.04; // 4%

// Qualification drive: the goal is 270 qualified people across all levels.
// Anything not yet qualified but within NEAR_FLOOR of its target is flagged
// "near" so it can be chased over the line.
const TARGET_PEOPLE = 270;
const NEAR_FLOOR    = 0.60;   // ≥ 60% of the binding threshold = near
const PAR_NEAR      = 0.06;   // PAR within reach of the 4% limit

/**
 * How close a target-based entity (TL / region / cluster) is to qualifying, and
 * what specifically it still needs. `achievement` = actual / target.
 */
function nearness(achievement, par30, target) {
  const achOk  = achievement >= 1;
  const parOk  = (par30 ?? 0) <= PAR_LIMIT;
  const near   = !(achOk && parOk)
    && achievement >= NEAR_FLOOR
    && (par30 ?? 0) <= PAR_NEAR;
  const needs  = [];
  if (!achOk && target > 0) {
    needs.push(`TZS ${Math.round(target * (1 - achievement)).toLocaleString()} more (${Math.round(achievement * 100)}%)`);
  }
  if (!parOk) needs.push(`cut PAR>30 ${((par30 ?? 0) * 100).toFixed(1)}% → ≤4%`);
  return { near, needs: needs.join('; ') };
}

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
 * Qualify a Team Leader.
 * Criteria: branch actual ≥ branch target  AND  branch PAR>30 ≤ 4%
 */
function qualifyTL(bObj) {
  const passTarget = bObj.target > 0 && bObj.totalAmount >= bObj.target;
  const passPAR    = bObj.par30 <= PAR_LIMIT;
  const ok         = passTarget && passPAR;

  const pct   = bObj.target > 0 ? Math.round((bObj.totalAmount / bObj.target) * 100) : 0;
  const parts = [];
  if (!passTarget) {
    parts.push(bObj.target === 0 ? 'No target set' : `Achievement ${pct}% < 100%`);
  }
  if (!passPAR) parts.push(`PAR>30 ${(bObj.par30 * 100).toFixed(1)}% > 4%`);

  return {
    qualified:   ok,
    reason:      ok ? 'Criteria met' : parts.join('; '),
    achievement: bObj.target > 0 ? bObj.totalAmount / bObj.target : 0,
    par30:       bObj.par30,
  };
}

/**
 * Qualify a Region / Branch Manager.
 * Criteria: region actual ≥ region target  AND  region PAR>30 ≤ 4%
 */
function qualifyRegion(rObj) {
  const passTarget = rObj.target > 0 && rObj.totalAmount >= rObj.target;
  const passPAR    = rObj.par30 <= PAR_LIMIT;
  const ok         = passTarget && passPAR;

  const pct   = rObj.target > 0 ? Math.round((rObj.totalAmount / rObj.target) * 100) : 0;
  const parts = [];
  if (!passTarget) {
    parts.push(rObj.target === 0 ? 'No target set' : `Achievement ${pct}% < 100%`);
  }
  if (!passPAR) parts.push(`PAR>30 ${(rObj.par30 * 100).toFixed(1)}% > 4%`);

  return {
    qualified:   ok,
    reason:      ok ? 'Criteria met' : parts.join('; '),
    achievement: rObj.target > 0 ? rObj.totalAmount / rObj.target : 0,
    par30:       rObj.par30,
  };
}

/**
 * Qualify a Cluster.
 * Target = sum of the targets of the branches that roll up into the cluster.
 * Criteria: cluster actual ≥ cluster target  AND  cluster PAR>30 ≤ 4%
 */
function qualifyCluster(cObj) {
  const passTarget = cObj.target > 0 && cObj.totalAmount >= cObj.target;
  const passPAR    = cObj.par30 <= PAR_LIMIT;
  const ok         = passTarget && passPAR;

  const pct   = cObj.target > 0 ? Math.round((cObj.totalAmount / cObj.target) * 100) : 0;
  const parts = [];
  if (!passTarget) {
    parts.push(cObj.target === 0 ? 'No target set' : `Achievement ${pct}% < 100%`);
  }
  if (!passPAR) parts.push(`PAR>30 ${(cObj.par30 * 100).toFixed(1)}% > 4%`);

  return {
    qualified:   ok,
    reason:      ok ? 'Criteria met' : parts.join('; '),
    achievement: cObj.target > 0 ? cObj.totalAmount / cObj.target : 0,
    par30:       cObj.par30,
  };
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * @param {ArrayBuffer} salesBuf
 * @param {ArrayBuffer} usersBuf
 * @param {ArrayBuffer} activitiesBuf
 * @param {ArrayBuffer|null} loanBuf          — Loan Accounts file for PAR>30
 * @param {ArrayBuffer|null} zoneClustersBuf  — OPTIONAL "Zone and Clusters" file.
 *        When supplied, every agent gets a Cluster (Branch → Cluster VLOOKUP on
 *        the user's Branch) and the cluster tables are produced. When omitted the
 *        report behaves exactly as before.
 */
export function processTeamBuildingReport(salesBuf, usersBuf, activitiesBuf, loanBuf, zoneClustersBuf) {

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

  // ── Zone & Clusters map (optional) ────────────────────────────────────────────
  // normBranchKey(Branch) → { cluster, zone, product }
  // Scans every sheet that carries Branch + Cluster columns, so the workbook's
  // "Zone and cluster" summary tab and the per-product tabs all contribute.
  const clusterMap = {};
  let clusterFileLoaded = false;
  if (zoneClustersBuf) {
    try {
      const zcSheets = parseAllSheets(zoneClustersBuf);
      Object.values(zcSheets).forEach((sheetRows) => {
        (sheetRows ?? []).forEach((row) => {
          const branch  = trim(String(getField(row, 'Branch')  ?? ''));
          const cluster = trim(String(getField(row, 'Cluster') ?? ''));
          if (!branch || !cluster) return;
          const key = normBranchKey(branch);
          if (!key || clusterMap[key]) return;      // first definition wins
          clusterMap[key] = {
            cluster,
            zone:    trim(String(getField(row, 'Zone')    ?? '')),
            product: trim(String(getField(row, 'Product') ?? '')),
          };
        });
      });
      clusterFileLoaded = Object.keys(clusterMap).length > 0;
    } catch {
      // A malformed Zone & Clusters file must never break the whole report.
      clusterFileLoaded = false;
    }
  }

  function getCluster(branchName) {
    if (!branchName) return null;
    return clusterMap[normBranchKey(branchName)] ?? null;
  }

  // ── users map: norm(displayName) → { title, role, branch } ───────────────────
  // We use TITLE (not Role) — Title is the precise job title (Independent TL,
  // FSTL, BLO, RSM, Loan Officer, Telesales Agent, etc.) referenced by the
  // criteria memos.
  const usersMap = {};
  usersRows.forEach((row) => {
    const name = norm(getField(row, 'Display Name', 0) ?? getField(row, 'Name', 0) ?? '');
    if (!name) return;
    const title      = trim(String(getField(row, 'Title',  3) ?? ''));
    const role       = trim(String(getField(row, 'Role',   2) ?? ''));
    const userBranch = trim(String(getField(row, 'Branch', 6) ?? ''));
    // One person can hold SEVERAL Users records — a stale account and a current
    // one, often with different job titles. Keeping only the last one seen
    // mislabelled people: NEEMA NDEMBEYE sells SME, but her old
    // "CS FIELD SALES TEAM LEADER" record overwrote her "SME Loan Officer" one,
    // so she was judged against Team Leader criteria instead of as the sales rep
    // she is. Keep them all; getUser() picks by product.
    (usersMap[name] ??= []).push({ title, role, branch: userBranch });
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

  /** Does this Users record belong to `product` (CS | LBF | SME)? */
  function recordMatchesProduct(rec, product) {
    const p = trim(product).toUpperCase();
    if (!p) return false;
    // Match on the whole word only, so "CS" cannot match inside "SERVICES".
    const hay = `${rec.role} ${rec.branch}`.toUpperCase();
    return new RegExp(`(^|[^A-Z])${p}([^A-Z]|$)`).test(hay);
  }

  /**
   * The Users record to believe for this person.
   *
   * People can hold several accounts with different job titles, so "whichever
   * came last in the file" mislabelled them. Score each record against what the
   * sales data actually says the person did:
   *   • the branch they sold in is the strongest signal (LUCAS MAGANGA sells in
   *     SUMBAWANGA, so his Sumbawanga agent record beats his Nzega TL record);
   *   • failing that, the product (NEEMA NDEMBEYE sells SME, so her
   *     "SME Loan Officer" record beats her stale "CS FIELD SALES TEAM LEADER").
   * Ties keep the first record, and a single-record person is untouched.
   */
  function getUser(repName, product = '', branch = '', region = '') {
    const recs = usersMap[norm(repName)];
    if (!recs || recs.length === 0) return null;
    if (recs.length === 1) return recs[0];

    const wantKeys = [normBranchKey(branch), normBranchKey(region)].filter(Boolean);
    const score = (rec) => {
      const recKey = normBranchKey(rec.branch);
      const branchHit = recKey && wantKeys.includes(recKey);
      return (branchHit ? 2 : 0) + (recordMatchesProduct(rec, product) ? 1 : 0);
    };
    let best = recs[0];
    let bestScore = score(recs[0]);
    for (const rec of recs.slice(1)) {
      const s = score(rec);
      if (s > bestScore) { best = rec; bestScore = s; }
    }
    return best;
  }
  const getRole  = (repName, product = '', branch = '', region = '') =>
    getUser(repName, product, branch, region)?.role ?? '';
  const getTitle = (repName, product = '', branch = '', region = '') =>
    getUser(repName, product, branch, region)?.title ?? '';

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

    // Aggregate by PERSON within a product — NOT by person + branch. A rep who
    // shifted branch mid-period (e.g. Mlimani → City Centre) has sales rows
    // under several "Branch / TL" labels; the old key
    // `product|||region|||branch|||rep` split them into separate part-agents, so
    // each fragment fell below the loan/disbursement thresholds and the person
    // was mis-qualified. One person = one record, with their FULL sales,
    // regardless of the shift. This applies to Team Leaders too (their own sales
    // are read whole).
    const key = `${product}|||${normKey(repName)}`;
    if (!agentMap[key]) {
      agentMap[key] = {
        repName, product, monthly: {}, totalAmount: 0, totalLoans: 0, repsTarget: 0,
        _branchTally: {}, _regionTally: {}, bySource: {},
      };
    }
    const a = agentMap[key];
    if (!a.monthly[month]) a.monthly[month] = { amt: 0, loans: 0 };
    a.monthly[month].amt   += amount;
    a.monthly[month].loans += 1;
    a.totalAmount           += amount;
    a.totalLoans            += 1;
    if (repsTgt > a.repsTarget) a.repsTarget = repsTgt;

    // Track every branch / region the rep sold under (weighted by rows, then
    // amount) so they can be placed where they primarily worked.
    if (branch) {
      const bt = a._branchTally[branch] ?? (a._branchTally[branch] = { rows: 0, amt: 0 });
      bt.rows += 1; bt.amt += amount;
    }
    if (region) {
      const rt = a._regionTally[region] ?? (a._regionTally[region] = { rows: 0, amt: 0 });
      rt.rows += 1; rt.amt += amount;
    }

    // Keep WHERE each sale was obtained — the Branch/TL under the physical
    // branch (Supervision/Region), with its own monthly breakdown. The analysis
    // still combines a shifted rep/team into one total (keyed by the Branch/TL),
    // but the Sales sheet reads this to show, e.g., which of VIANERY KOMBA's
    // loans came from Mlimani and which from City Centre — instead of collapsing
    // them all onto the home branch.
    const srcKey = `${branch}|||${region}`;
    const src = a.bySource[srcKey]
      ?? (a.bySource[srcKey] = { branch, region, loans: 0, amt: 0, monthly: {} });
    src.loans += 1;
    src.amt   += amount;
    if (!src.monthly[month]) src.monthly[month] = { amt: 0, loans: 0 };
    src.monthly[month].amt   += amount;
    src.monthly[month].loans += 1;
  });

  // Resolve each rep's home branch/region = where they did the most business
  // (row count, tie-broken by disbursed amount). branchesSeen records the shift
  // so it can be surfaced in the Sales sheet.
  const dominant = (tally) =>
    Object.entries(tally).sort((x, y) => (y[1].rows - x[1].rows) || (y[1].amt - x[1].amt))[0]?.[0] ?? '';
  Object.values(agentMap).forEach((a) => {
    a.branch       = dominant(a._branchTally);
    a.region       = dominant(a._regionTally);
    a.branchesSeen = Object.keys(a._branchTally);
    a.shifted      = a.branchesSeen.length > 1;
    delete a._branchTally;
    delete a._regionTally;
  });

  // Enrich agents
  Object.values(agentMap).forEach((a) => {
    Object.assign(a, getJoinInfo(a.repName));
    a.role  = getRole(a.repName, a.product, a.branch, a.region);
    a.title = getTitle(a.repName, a.product, a.branch, a.region);
    const p = getAgentPAR(a.repName);
    a.totalPrincipal = p.totalPrincipal;
    a.par30Principal = p.par30Principal;
    a.par30          = p.par30;

    // Cluster: VLOOKUP on the user's Branch (the clean branch name), which
    // matches Zone & Clusters far better than the "Branch / TL" team label.
    a.userBranch = getUser(a.repName, a.product, a.branch, a.region)?.branch ?? '';
    const cl     = getCluster(a.userBranch) ?? getCluster(a.branch);
    a.cluster    = cl?.cluster ?? '';
    a.zone       = cl?.zone    ?? '';

    // Team Leaders must not be counted as sales reps.
    a.isTeamLeader = isTeamLeaderTitle(a.title);
  });

  const monthsInData = [...monthsSet].sort((x, y) => MONTH_ORDER.indexOf(x) - MONTH_ORDER.indexOf(y));
  const monthsCount  = monthsInData.length || 1;

  // ── branch home region ────────────────────────────────────────────────────────
  // A whole team (Branch/TL) can shift region mid-period, so its agents carry
  // different Supervision/Region values. If the hierarchy split by region, the
  // Team Leader would be judged separately in each region against the FULL
  // target and fail both, when the combined team qualifies — the VIANERY KOMBA
  // case (611M @ Mlimani + 310M @ City Centre = 921M vs an 805M target: split
  // → 76% and 39%, both fail; combined → 114%, qualifies).
  //
  // So each Branch/TL is placed under ONE home region — the region where the
  // team did most of its business — carrying all its agents and its full sales.
  const branchRegionAmt = {};   // `${product}|||${branch}` → { region → amount }
  Object.values(agentMap).forEach((a) => {
    const bk = `${a.product}|||${normKey(a.branch)}`;
    const m  = branchRegionAmt[bk] ?? (branchRegionAmt[bk] = {});
    m[a.region] = (m[a.region] ?? 0) + a.totalAmount;
  });
  const branchHomeRegion = {};
  Object.entries(branchRegionAmt).forEach(([bk, m]) => {
    branchHomeRegion[bk] = Object.entries(m).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
  });

  // ── build hierarchy ───────────────────────────────────────────────────────────
  const hierarchy = {};
  Object.values(agentMap).forEach((a) => {
    if (!hierarchy[a.product]) hierarchy[a.product] = { regions: {} };
    const pObj       = hierarchy[a.product];
    const homeRegion = branchHomeRegion[`${a.product}|||${normKey(a.branch)}`] || a.region;
    // Reflect the team's placement on the agent too, so the Sales sheet and the
    // per-agent rows agree with the branch/region they are grouped under.
    a.region = homeRegion;
    if (!pObj.regions[homeRegion]) pObj.regions[homeRegion] = { branches: {} };
    const rObj = pObj.regions[homeRegion];
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
      Object.entries(rObj.branches).forEach(([branch, bObj]) => {
        // TL target: cumulative (monthly × months).
        //
        // SME has no branch level at all — its MTD listing carries no Branch/TL
        // column, so every SME rep lands in one unnamed branch and there is no
        // key to look a target up by. Judging that team against a target of 0
        // produced a meaningless "No target set" row. When the branch is unnamed
        // the region IS the team, so the region's target is the honest yardstick.
        // Named branches are untouched: a missing target there is a real gap in
        // the Target sheet and should keep saying so.
        const branchTarget = (targetMap[normKey(branch)] ?? 0) * monthsCount;
        bObj.target = (branchTarget === 0 && !trim(branch))
          ? ((targetMap[REGION_OVERRIDES[normKey(region)] ?? normKey(region)] ?? 0) * monthsCount)
          : branchTarget;

        // Split the branch roster: Team Leaders are NOT sales reps. Their sales
        // still count toward the branch total, but they are judged by the TL
        // criteria (target + PAR) in the Team Leader table, not by rep thresholds.
        bObj.salesAgents = bObj.agents.filter((a) => !a.isTeamLeader);
        bObj.teamLeaders = bObj.agents.filter((a) =>  a.isTeamLeader);

        // Step 1: qualify each SALES AGENT (cumulative thresholds)
        bObj.agents.forEach((agent) => {
          agent.target = agent.repsTarget * monthsCount;
          if (agent.isTeamLeader) {
            agent.qualified  = false;
            agent.qualReason = 'Team Leader — assessed in the Team Leader table';
            agent.minLoans   = 0;
            agent.minDisb    = 0;
            return;
          }
          const q           = qualifyAgent(agent, product, region, monthsCount);
          agent.qualified   = q.qualified;
          agent.qualReason  = q.reason;
          agent.minLoans    = q.minLoans;
          agent.minDisb     = q.minDisb;

          // LBF Call Center exception (confirmed by user 2026-08-14): these agents
          // must ALSO reach ≥100% of their cumulative target, on top of the loan +
          // disbursement thresholds. Every other agent keeps threshold-only rules.
          agent.isLbfCallCenter = product === 'LBF' && /call\s*cent(er|re)/i.test(region || '');
          if (agent.isLbfCallCenter) {
            const meetsTarget = agent.target > 0 && agent.totalAmount >= agent.target;
            agent.targetPct   = agent.target > 0 ? agent.totalAmount / agent.target : 0;
            if (agent.qualified && !meetsTarget) {
              agent.qualified  = false;
              const pctStr     = `${Math.round(agent.targetPct * 100)}%`;
              agent.qualReason = agent.target > 0
                ? `Met loan & disbursement thresholds but only ${pctStr} of target (Call Center needs ≥100%)`
                : 'No target on file — Call Center requires ≥100% of target';
            }
          }

          // "Near" = missed only narrowly on the BINDING threshold (the lower of
          // the two ratios), so a small push qualifies. Record what is needed.
          const loanRatio = q.minLoans > 0 ? agent.totalLoans  / q.minLoans : 1;
          const disbRatio = q.minDisb  > 0 ? agent.totalAmount / q.minDisb  : 1;
          // For LBF Call Center the target is an additional binding constraint.
          const targetRatio = agent.isLbfCallCenter
            ? (agent.target > 0 ? agent.totalAmount / agent.target : 0)
            : 1;
          agent.qualifyRatio = Math.min(loanRatio, disbRatio, targetRatio);
          agent.near = !agent.qualified && agent.qualifyRatio >= NEAR_FLOOR;
          const needs = [];
          if (agent.totalLoans  < q.minLoans) needs.push(`${q.minLoans - agent.totalLoans} more loan(s)`);
          if (agent.totalAmount < q.minDisb)  needs.push(`TZS ${Math.round(q.minDisb - agent.totalAmount).toLocaleString()} more`);
          if (agent.isLbfCallCenter && agent.target > 0 && agent.totalAmount < agent.target) {
            needs.push(`TZS ${Math.round(agent.target - agent.totalAmount).toLocaleString()} more to hit target`);
          }
          agent.nearNeeds = needs.join('; ');
        });

        // Step 2: branch totals + PAR (across the WHOLE roster, TLs included)
        bObj.totalAmount    = bObj.agents.reduce((s, a) => s + a.totalAmount, 0);
        bObj.totalLoans     = bObj.agents.reduce((s, a) => s + a.totalLoans,  0);
        bObj.totalPrincipal = bObj.agents.reduce((s, a) => s + a.totalPrincipal, 0);
        bObj.par30Principal = bObj.agents.reduce((s, a) => s + a.par30Principal, 0);
        bObj.par30          = bObj.totalPrincipal > 0 ? bObj.par30Principal / bObj.totalPrincipal : 0;
        bObj.qualCount      = bObj.salesAgents.filter((a) => a.qualified).length;

        // TL label = the sales file's "Branch / TL" value verbatim. We do NOT
        // substitute a roster member's name when that value is present: a
        // TL-titled agent who merely sold a few loans in a branch that isn't
        // theirs (a roaming TL, e.g. Meshack in ZANZIBAR (MTORO)) would
        // otherwise mislabel the branch. The Branch/TL value already carries the
        // TL identity for LBF and "PLACE (TL)" branches.
        //
        // Some rows carry NO Branch/TL at all though — SME team leaders are
        // recorded against the region only. Falling back to the real person on
        // the roster keeps them visible (NEEMA NDEMBEYE, SME DAR ZONE) instead of
        // printing an anonymous "—" row nobody can act on.
        bObj.tlName = trim(branch)
          || bObj.teamLeaders.map((t) => t.repName).filter(Boolean).join(', ')
          || trim(region);
        bObj.tlTitle  = bObj.teamLeaders[0]?.title ?? '';

        // Branch cluster = the cluster most of its roster belongs to.
        const cCount = {};
        bObj.agents.forEach((a) => { if (a.cluster) cCount[a.cluster] = (cCount[a.cluster] ?? 0) + 1; });
        bObj.cluster = Object.entries(cCount).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';

        // Step 3: qualify TL (100% target + PAR ≤ 4%)
        const tlQual       = qualifyTL(bObj);
        bObj.tlQualified   = tlQual.qualified;
        bObj.tlReason      = tlQual.reason;
        bObj.tlAchievement = tlQual.achievement;
        bObj.tlPar30       = tlQual.par30;
        const tlNear       = nearness(tlQual.achievement, bObj.par30, bObj.target);
        bObj.tlNear        = tlNear.near;
        bObj.tlNearNeeds   = tlNear.needs;
      });

      // Step 4: region totals + PAR
      // Region target: prefer the official region-level row from the Target
      // sheet (this is the authoritative target and is NOT simply the sum of the
      // branch rows). When that row is missing — e.g. a manually corrected sales
      // file that dropped the region rollup rows — fall back to the sum of the
      // region's Branch/TL targets so regions still get a target instead of 0.
      const regionKey       = REGION_OVERRIDES[normKey(region)] ?? normKey(region);
      const regionRow       = (targetMap[regionKey] ?? 0) * monthsCount;
      const branchTargetSum = Object.values(rObj.branches).reduce((s, b) => s + (b.target ?? 0), 0);
      rObj.target         = regionRow > 0 ? regionRow : branchTargetSum;
      rObj.totalAmount    = Object.values(rObj.branches).reduce((s, b) => s + b.totalAmount, 0);
      rObj.totalLoans     = Object.values(rObj.branches).reduce((s, b) => s + b.totalLoans,  0);
      rObj.totalPrincipal = Object.values(rObj.branches).reduce((s, b) => s + b.totalPrincipal, 0);
      rObj.par30Principal = Object.values(rObj.branches).reduce((s, b) => s + b.par30Principal, 0);
      rObj.par30          = rObj.totalPrincipal > 0 ? rObj.par30Principal / rObj.totalPrincipal : 0;
      rObj.qualCount      = Object.values(rObj.branches).reduce((s, b) => s + b.qualCount, 0);

      // Step 5: qualify region (100% target + PAR ≤ 4%)
      const rq               = qualifyRegion(rObj);
      rObj.regionQualified   = rq.qualified;
      rObj.regionReason      = rq.reason;
      rObj.regionAchievement = rq.achievement;
      rObj.regionPar30       = rq.par30;
      const rNear            = nearness(rq.achievement, rObj.par30, rObj.target);
      rObj.regionNear        = rNear.near;
      rObj.regionNearNeeds   = rNear.needs;
    });

    // Product totals
    pObj.target      = Object.values(pObj.regions).reduce((s, r) => s + r.target,      0);
    pObj.totalAmount = Object.values(pObj.regions).reduce((s, r) => s + r.totalAmount, 0);
    pObj.totalLoans  = Object.values(pObj.regions).reduce((s, r) => s + r.totalLoans,  0);
    pObj.qualCount   = Object.values(pObj.regions).reduce((s, r) => s + r.qualCount,   0);
  });

  // ── clusters ──────────────────────────────────────────────────────────────────
  // A cluster groups branches (Zone & Clusters file). Its target is the SUM of
  // its member branches' targets, since the Target sheet carries no cluster rows.
  const clusters = {};
  if (clusterFileLoaded) {
    products.forEach((product) => {
      Object.entries(hierarchy[product].regions).forEach(([region, rObj]) => {
        Object.entries(rObj.branches).forEach(([branch, bObj]) => {
          const name = bObj.cluster;
          if (!name) return;
          if (!clusters[name]) {
            clusters[name] = {
              name,
              zone:           bObj.agents.find((a) => a.zone)?.zone ?? '',
              products:       new Set(),
              regions:        new Set(),
              branchCount:    0,
              target:         0,
              totalAmount:    0,
              totalLoans:     0,
              totalPrincipal: 0,
              par30Principal: 0,
              qualCount:      0,
              agentCount:     0,
            };
          }
          const c = clusters[name];
          c.products.add(product);
          c.regions.add(region);
          c.branchCount    += 1;
          c.target         += bObj.target      ?? 0;   // sum of branch targets
          c.totalAmount    += bObj.totalAmount ?? 0;
          c.totalLoans     += bObj.totalLoans  ?? 0;
          c.totalPrincipal += bObj.totalPrincipal ?? 0;
          c.par30Principal += bObj.par30Principal ?? 0;
          c.qualCount      += bObj.qualCount   ?? 0;
          c.agentCount     += bObj.salesAgents?.length ?? 0;
        });
      });
    });

    Object.values(clusters).forEach((c) => {
      c.par30      = c.totalPrincipal > 0 ? c.par30Principal / c.totalPrincipal : 0;
      const q      = qualifyCluster(c);
      c.qualified  = q.qualified;
      c.reason     = q.reason;
      c.achievement = q.achievement;
      c.productList = [...c.products].join(', ');
      c.regionList  = [...c.regions].join(', ');
      const cNear  = nearness(q.achievement, c.par30, c.target);
      c.near       = cNear.near;
      c.nearNeeds  = cNear.needs;
    });
  }

  // ── summary ───────────────────────────────────────────────────────────────────
  const allAgents = Object.values(agentMap);
  const salesOnly = allAgents.filter((a) => !a.isTeamLeader);

  let qualifiedTLs = 0, qualifiedRegions = 0;
  let nearTLs = 0, nearRegions = 0;
  products.forEach((p) => {
    Object.values(hierarchy[p].regions).forEach((rObj) => {
      if (rObj.regionQualified) qualifiedRegions++;
      else if (rObj.regionNear) nearRegions++;
      Object.values(rObj.branches).forEach((bObj) => {
        if (bObj.tlQualified) qualifiedTLs++;
        else if (bObj.tlNear) nearTLs++;
      });
    });
  });

  const clusterList       = Object.values(clusters);
  const qualifiedClusters = clusterList.filter((c) => c.qualified).length;
  const nearClusters      = clusterList.filter((c) => c.near).length;

  const qualifiedAgents = salesOnly.filter((a) => a.qualified).length;
  const nearAgents      = salesOnly.filter((a) => a.near).length;

  // A qualified PERSON at any level counts toward the 270 goal: each qualified
  // sales rep, Team Leader, Region/BM, and cluster (its manager).
  const totalQualifiedPeople = qualifiedAgents + qualifiedTLs + qualifiedRegions + qualifiedClusters;
  const totalNear            = nearAgents + nearTLs + nearRegions + nearClusters;

  const summary = {
    // Sales-rep figures EXCLUDE Team Leaders (they are judged as TLs instead).
    totalAgents:     salesOnly.length,
    totalAmount:     allAgents.reduce((s, a) => s + a.totalAmount, 0),
    totalLoans:      allAgents.reduce((s, a) => s + a.totalLoans,  0),
    qualified:       salesOnly.filter((a) => a.qualified).length,
    notQualified:    salesOnly.filter((a) => !a.qualified).length,
    teamLeaderCount: allAgents.filter((a) => a.isTeamLeader).length,
    qualifiedTLs,
    qualifiedRegions,
    qualifiedClusters,
    totalClusters:   clusterList.length,
    // The 270-people qualification drive.
    targetPeople:         TARGET_PEOPLE,
    totalQualifiedPeople,
    gapToTarget:          Math.max(0, TARGET_PEOPLE - totalQualifiedPeople),
    nearAgents,
    nearTLs,
    nearRegions,
    nearClusters,
    totalNear,
    oldAgents:       salesOnly.filter((a) => a.flag === 'Yes').length,
    newAgents:       salesOnly.filter((a) => a.flag === 'No' && a.period !== 'Unknown').length,
    // Reps whose sales spanned more than one Branch/TL (branch shift) and were
    // merged into a single record — surfaced so the merge is auditable.
    shiftedReps:     allAgents.filter((a) => a.shifted).length,
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

  return {
    hierarchy,
    monthsInData,
    products,
    summary,
    clusters:          clusterList.sort((a, b) => b.totalAmount - a.totalAmount),
    clusterFileLoaded,
  };
}
