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
    a.role  = getRole(a.repName);
    a.title = getTitle(a.repName);
    const p = getAgentPAR(a.repName);
    a.totalPrincipal = p.totalPrincipal;
    a.par30Principal = p.par30Principal;
    a.par30          = p.par30;

    // Cluster: VLOOKUP on the user's Branch (the clean branch name), which
    // matches Zone & Clusters far better than the "Branch / TL" team label.
    a.userBranch = getUser(a.repName)?.branch ?? '';
    const cl     = getCluster(a.userBranch) ?? getCluster(a.branch);
    a.cluster    = cl?.cluster ?? '';
    a.zone       = cl?.zone    ?? '';

    // Team Leaders must not be counted as sales reps.
    a.isTeamLeader = isTeamLeaderTitle(a.title);
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
        });

        // Step 2: branch totals + PAR (across the WHOLE roster, TLs included)
        bObj.totalAmount    = bObj.agents.reduce((s, a) => s + a.totalAmount, 0);
        bObj.totalLoans     = bObj.agents.reduce((s, a) => s + a.totalLoans,  0);
        bObj.totalPrincipal = bObj.agents.reduce((s, a) => s + a.totalPrincipal, 0);
        bObj.par30Principal = bObj.agents.reduce((s, a) => s + a.par30Principal, 0);
        bObj.par30          = bObj.totalPrincipal > 0 ? bObj.par30Principal / bObj.totalPrincipal : 0;
        bObj.qualCount      = bObj.salesAgents.filter((a) => a.qualified).length;

        // TL name: prefer the real person(s) found in the roster, else fall back
        // to the "Branch Name (TL Name)" pattern used by the sales file.
        const tlMatch = trim(branch).match(/\(([^)]+)\)\s*$/);
        bObj.tlName   = bObj.teamLeaders.length
          ? bObj.teamLeaders.map((t) => t.repName).join(', ')
          : (tlMatch ? trim(tlMatch[1]) : trim(branch));
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
      });

      // Step 4: region totals + PAR
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
    });
  }

  // ── summary ───────────────────────────────────────────────────────────────────
  const allAgents = Object.values(agentMap);
  const salesOnly = allAgents.filter((a) => !a.isTeamLeader);

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

  const clusterList      = Object.values(clusters);
  const qualifiedClusters = clusterList.filter((c) => c.qualified).length;

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
    oldAgents:       salesOnly.filter((a) => a.flag === 'Yes').length,
    newAgents:       salesOnly.filter((a) => a.flag === 'No' && a.period !== 'Unknown').length,
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
