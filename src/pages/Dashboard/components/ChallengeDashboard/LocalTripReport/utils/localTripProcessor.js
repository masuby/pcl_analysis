/**
 * Local Trip Report — Processor
 *
 * Criteria (LOCAL TRIPS / SALES DEPARTMENTS memo — 2026):
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
 * SUB-CRITERIA (enforced): "new business" (Status = New business rows vs a
 * 60%-of-target NB baseline) at 130% for LBF/CS, and "loan counts" (vs the
 * summed per-agent minimum-loan targets) at 130% LBF/CS and 120% SME. Note
 * the CS Mainland SALES ratio is 150% but its NB/loan-count ratios stay 130%.
 * SME has no new-business line in the memo, so that check is skipped for SME.
 * Tenure: agents with a KNOWN join date giving <3 calendar months of work by
 * the end of the reporting window are excluded (memo note).
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

// "Achieve 130% of your loan counts" — enforced when the Sales file's Target
// sheet carries a real "Loan Count target" column (= branch target ÷ per-rep
// rate). When that column is absent (older files) the criterion is skipped so
// it can't spuriously fail everyone. Master kill-switch below.
const ENFORCE_LOAN_COUNTS = true;

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
 * Local Trip leader-level percentage thresholds (per LOCAL TRIPS memo),
 * one ratio PER criterion — the memo sets them independently:
 *   LBF              → sales 130 % · new-biz 130 % · loans 130 %
 *   CS  TZ Mainland  → sales 150 % · new-biz 130 % · loans 130 %
 *   CS  Zanzibar     → sales 130 % · new-biz 130 % · loans 130 %
 *   SME & AGRI       → sales 120 % ·  (no NB line)  · loans 120 %
 * Unknown products fall back to 130 % across the board.
 */
function leaderRatios(product, region) {
  const p = String(product || '').toUpperCase();
  if (p === 'LBF') return { sales: 1.30, newBiz: 1.30, loans: 1.30 };
  if (p === 'CS')  return isZanzibar(region)
    ? { sales: 1.30, newBiz: 1.30, loans: 1.30 }
    : { sales: 1.50, newBiz: 1.30, loans: 1.30 }; // only the sales target is 150% on Mainland
  if (p === 'SME' || p === 'AGRI' || p === 'SME & AGRI') return { sales: 1.20, newBiz: null, loans: 1.20 };
  return { sales: 1.30, newBiz: 1.30, loans: 1.30 };
}

/**
 * Qualify a Team Leader / Branch Manager.
 *
 * Per the LOCAL TRIPS 2026 memo, TL must satisfy ALL of:
 *   (a) Total disbursement ≥ ratio × cumulative sales target
 *   (b) New-business disbursement ≥ ratio × (60% × cumulative sales target)
 *       i.e. the 100% new-business target = 60% of the TL's total target;
 *       the TL must achieve `ratio` (130 / 150 / 120 %) of THAT.
 *   (c) Loan count ≥ ratio × cumulative loan-count target
 *       (loan-count target is derived from each agent's per-month loan threshold
 *       × monthsCount, summed across the branch agents)
 *   (d) PAR>30 ≤ 4 %
 */
function qualifyTL(bObj, product, region) {
  const ratios = leaderRatios(product, region);

  // (a) Sales target
  const reqSales   = bObj.target * ratios.sales;
  const passSales  = bObj.target > 0 && bObj.totalAmount >= reqSales;
  const salesPct   = bObj.target > 0 ? bObj.totalAmount / bObj.target : 0;

  // (b) New-business target (60% of total target is the 100% NB target).
  //     Skipped entirely for products the memo sets no NB line for (SME).
  const newBizTarget = bObj.target * 0.6;
  const nbPct        = newBizTarget > 0 ? bObj.newBizAmount / newBizTarget : 0;
  const passNB       = ratios.newBiz == null
    || (newBizTarget > 0 && bObj.newBizAmount >= newBizTarget * ratios.newBiz);

  // (c) Loan-count target — enforced only when a real Target-sheet loan-count
  //     target exists for this branch (else informational).
  const enforceLoans = ENFORCE_LOAN_COUNTS && bObj.loansTargetFromSheet;
  const reqLoans   = bObj.loansTarget * ratios.loans;
  const passLoans  = !enforceLoans
    || (bObj.loansTarget > 0 && bObj.totalLoans >= reqLoans);
  const loansPct   = bObj.loansTarget > 0 ? bObj.totalLoans / bObj.loansTarget : 0;

  // (d) PAR
  const passPAR    = bObj.par30 <= PAR_LIMIT;

  const ok = passSales && passNB && passLoans && passPAR;

  const parts = [];
  if (!passSales) {
    parts.push(bObj.target === 0
      ? 'No sales target set'
      : `Sales ${Math.round(salesPct * 100)}% < ${Math.round(ratios.sales * 100)}%`);
  }
  if (!passNB) {
    parts.push(newBizTarget === 0
      ? 'No new-biz target'
      : `New-biz ${Math.round(nbPct * 100)}% < ${Math.round(ratios.newBiz * 100)}%`);
  }
  if (!passLoans) {
    parts.push(bObj.loansTarget === 0
      ? 'No loan-count target'
      : `Loans ${Math.round(loansPct * 100)}% < ${Math.round(ratios.loans * 100)}%`);
  }
  if (!passPAR) parts.push(`PAR>30 ${(bObj.par30 * 100).toFixed(1)}% > 4%`);

  return {
    qualified:     ok,
    reason:        ok ? 'Criteria met' : parts.join('; '),
    achievement:   salesPct,
    newBizAchv:    nbPct,
    loansAchv:     loansPct,
    newBizTarget,
    par30:         bObj.par30,
    requiredRatio: ratios.sales,
  };
}

/**
 * Qualify a Region / Branch Manager.
 * Criteria: region actual ≥ (region target × ratio)  AND  region PAR>30 ≤ 4%
 *   ratio depends on product + zone (see leaderRatio above).
 */
function qualifyRegion(rObj, product, region) {
  const ratios = leaderRatios(product, region);

  const reqSales = rObj.target * ratios.sales;
  const passSales = rObj.target > 0 && rObj.totalAmount >= reqSales;
  const salesPct  = rObj.target > 0 ? rObj.totalAmount / rObj.target : 0;

  const newBizTarget = rObj.target * 0.6;
  const nbPct        = newBizTarget > 0 ? rObj.newBizAmount / newBizTarget : 0;
  const passNB       = ratios.newBiz == null
    || (newBizTarget > 0 && rObj.newBizAmount >= newBizTarget * ratios.newBiz);

  const enforceLoans = ENFORCE_LOAN_COUNTS && rObj.loansTargetFromSheet;
  const reqLoans  = rObj.loansTarget * ratios.loans;
  const passLoans = !enforceLoans
    || (rObj.loansTarget > 0 && rObj.totalLoans >= reqLoans);
  const loansPct  = rObj.loansTarget > 0 ? rObj.totalLoans / rObj.loansTarget : 0;

  const passPAR = rObj.par30 <= PAR_LIMIT;
  const ok = passSales && passNB && passLoans && passPAR;

  const parts = [];
  if (!passSales) parts.push(rObj.target === 0       ? 'No sales target'   : `Sales ${Math.round(salesPct*100)}% < ${Math.round(ratios.sales*100)}%`);
  if (!passNB)    parts.push(newBizTarget === 0      ? 'No new-biz target' : `New-biz ${Math.round(nbPct*100)}% < ${Math.round(ratios.newBiz*100)}%`);
  if (!passLoans) parts.push(rObj.loansTarget === 0  ? 'No loan-count tgt' : `Loans ${Math.round(loansPct*100)}% < ${Math.round(ratios.loans*100)}%`);
  if (!passPAR)   parts.push(`PAR>30 ${(rObj.par30 * 100).toFixed(1)}% > 4%`);

  return {
    qualified:     ok,
    reason:        ok ? 'Criteria met' : parts.join('; '),
    achievement:   salesPct,
    newBizAchv:    nbPct,
    loansAchv:     loansPct,
    newBizTarget,
    par30:         rObj.par30,
    requiredRatio: ratios.sales,
  };
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * @param {ArrayBuffer} salesBuf
 * @param {ArrayBuffer} usersBuf
 * @param {ArrayBuffer} activitiesBuf
 * @param {ArrayBuffer|null} loanBuf  — Loan Accounts file for PAR>30 calculation
 */
export function processLocalTripReport(salesBuf, usersBuf, activitiesBuf, loanBuf) {

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

  // ── target maps (VLOOKUP style) ───────────────────────────────────────────────
  // Target sheet columns: Branch/TL | Target | Loan Count target |
  //                       Active Reps Target | Actual Reps Target
  const numOf = (v) => (typeof v === 'number' ? v : parseFloat(String(v ?? '0').replace(/,/g, '')) || 0);
  const targetMap        = {};   // key → monthly disbursement target
  const loanCountTgtMap  = {};   // key → monthly loan-count target
  const activeRepsTgtMap = {};   // key → active-reps target (headcount)
  const actualRepsTgtMap = {};   // key → actual-reps target  (headcount)
  targetRows.forEach((row) => {
    const vals = Object.values(row);
    if (vals.length < 2) return;
    const key = normKey(String(vals[0] ?? '').trim());
    if (!key || key === 'branch/tl' || key === 'branch / tl' || key === 'target') return;
    const val = numOf(vals[1]);
    if (val !== 0) targetMap[key] = val;
    const lc = numOf(getField(row, 'Loan Count target',  2));
    if (lc  !== 0) loanCountTgtMap[key]  = lc;
    const ar = numOf(getField(row, 'Active Reps Target', 3));
    if (ar  !== 0) activeRepsTgtMap[key] = ar;
    const cr = numOf(getField(row, 'Actual Reps Target', 4));
    if (cr  !== 0) actualRepsTgtMap[key] = cr;
  });

  // ── users map: norm(displayName) → { title, role, branch } ───────────────────
  // We use TITLE (not Role) per spec: Title is the precise job title used to
  // classify Independent TL vs Field Sales TL vs Branch LO vs Telesales etc.
  const usersMap = {};
  usersRows.forEach((row) => {
    const name = norm(getField(row, 'Display Name', 0) ?? getField(row, 'Name', 0) ?? '');
    if (!name) return;
    const title      = trim(String(getField(row, 'Title',  3) ?? ''));
    const role       = trim(String(getField(row, 'Role',   2) ?? ''));
    const userBranch = trim(String(getField(row, 'Branch', 6) ?? ''));
    usersMap[name] = { title, role, branch: userBranch };
  });

  /** Classify a Title string into a logical role family used by the criteria. */
  function classifyTitle(t) {
    const s = norm(t);
    if (!s) return 'UNKNOWN';
    if (s.includes('independent team leader') || s.includes('independent sales team leader')) return 'INDEPENDENT_TL';
    if (s.includes('field sales team leader'))                                                return 'FIELD_TL';
    if (s.includes('team leader') || s.includes('team sale leader') || s === 'eam leader')   return 'TEAM_LEADER';
    if (s.includes('cluster'))                                                                return 'CLUSTER_MANAGER';
    if (s.includes('branch manager'))                                                         return 'BRANCH_MANAGER';
    if (s.includes('regional sales manager') || s === 'rsm' || s.includes('zonal'))           return 'REGIONAL_MANAGER';
    if (s.includes('call centre supervisor') || s.includes('call center supervisor'))         return 'CALL_CENTER_SUP';
    if (s.includes('senior loan officer'))                                                    return 'SENIOR_LOAN_OFFICER';
    if (s.includes('branch loan officer'))                                                    return 'BRANCH_LOAN_OFFICER';
    if (s.includes('telesales') || s.includes('tele sales') || s.includes('tele-sales'))      return 'TELESALES';
    if (s.includes('call centre agent') || s.includes('call center agent'))                   return 'CALL_CENTER_AGENT';
    if (s.includes('loan officer'))                                                           return 'LOAN_OFFICER';
    if (s.includes('sales agent') || s.includes('sale agent') || s.includes('sales rep') || s === 'sale rep') return 'SALES_AGENT';
    if (s.includes('sales coordinator') || s.includes('sale coordinator'))                    return 'SALES_COORDINATOR';
    return 'OTHER';
  }

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
    if (!d) return { joinDate: 'Unknown', period: 'Unknown', flag: 'No', joinDateObj: null };
    const ds = d.toLocaleDateString('en-GB');
    if (d < JAN_2026) return { joinDate: ds, period: 'Before Jan 2026', flag: 'Yes', joinDateObj: d };
    if (d < MAY_2026) return { joinDate: ds, period: 'Jan–Apr 2026',    flag: 'No',  joinDateObj: d };
    return              { joinDate: ds, period: 'After Apr 2026',   flag: 'No',  joinDateObj: d };
  }

  function getUserInfo(repName) { return usersMap[norm(repName)] ?? null; }
  function getRole(repName)  { return getUserInfo(repName)?.role  ?? ''; }
  function getTitle(repName) { return getUserInfo(repName)?.title ?? ''; }

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
    const status  = norm(String(getField(row, 'Status', 8) ?? ''));

    const amount       = typeof rawAmt === 'number' ? rawAmt : parseFloat(String(rawAmt  ?? '0').replace(/,/g, '')) || 0;
    const repsTgt      = typeof rawTgt === 'number' ? rawTgt : parseFloat(String(rawTgt  ?? '0').replace(/,/g, '')) || 0;
    // Status vocabulary differs per product: LBF/SME use "New business" /
    // "Repeat business", CS uses "New loan" / "Refinance".
    const isNewBiz     = status.includes('new business') || status.includes('new loan');

    if (!repName || !product || !month) return;
    monthsSet.add(month);

    const key = `${product}|||${region}|||${branch}|||${repName}`;
    if (!agentMap[key]) {
      agentMap[key] = {
        repName, product, region, branch,
        monthly: {}, totalAmount: 0, totalLoans: 0, repsTarget: 0,
        newBizAmount: 0, newBizLoans: 0,
      };
    }
    const a = agentMap[key];
    if (!a.monthly[month]) a.monthly[month] = { amt: 0, loans: 0 };
    a.monthly[month].amt   += amount;
    a.monthly[month].loans += 1;
    a.totalAmount           += amount;
    a.totalLoans            += 1;
    if (isNewBiz) {
      a.newBizAmount += amount;
      a.newBizLoans  += 1;
    }
    if (repsTgt > a.repsTarget) a.repsTarget = repsTgt;
  });

  // Enrich agents
  Object.values(agentMap).forEach((a) => {
    Object.assign(a, getJoinInfo(a.repName));
    a.role        = getRole(a.repName);
    a.title       = getTitle(a.repName);
    a.titleFamily = classifyTitle(a.title);
    const p = getAgentPAR(a.repName);
    a.totalPrincipal = p.totalPrincipal;
    a.par30Principal = p.par30Principal;
    a.par30          = p.par30;
  });

  const monthsInData = [...monthsSet].sort((x, y) => MONTH_ORDER.indexOf(x) - MONTH_ORDER.indexOf(y));
  const monthsCount  = monthsInData.length || 1;

  // ── tenure rule: "All staff & Agents must have atleast 3 months of work" ─────
  // Calendar months from the join month through the last data month, inclusive.
  // Applied only when the join date is known (Unknown keeps today's behaviour).
  const lastMonthIdx = MONTH_ORDER.indexOf(monthsInData[monthsInData.length - 1] ?? '');
  function monthsOfWork(joinDateObj) {
    if (!joinDateObj || lastMonthIdx < 0) return null;
    const jm = joinDateObj.getFullYear() * 12 + joinDateObj.getMonth();
    const lm = 2026 * 12 + lastMonthIdx;
    return lm - jm + 1;
  }

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

        // Step 1: qualify each agent (cumulative thresholds — agent's OWN merit)
        bObj.agents.forEach((agent) => {
          const q                 = qualifyAgent(agent, product, region, monthsCount);
          agent.selfQualified     = q.qualified;
          agent.qualReason        = q.reason;
          // Memo note: all staff & agents must have at least 3 months of work.
          const mow = monthsOfWork(agent.joinDateObj);
          if (mow != null && mow < 3) {
            agent.selfQualified = false;
            agent.qualReason    = `Less than 3 months of work (joined ${agent.joinDate})`;
          }
          agent.minLoans          = q.minLoans;
          agent.minDisb           = q.minDisb;
          agent.target            = agent.repsTarget * monthsCount;
          agent.loanCountPct      = q.minLoans > 0 ? agent.totalLoans  / q.minLoans : 0;
          agent.disbursePct       = q.minDisb  > 0 ? agent.totalAmount / q.minDisb  : 0;
        });

        // Step 2: branch totals (incl. NEW-BUSINESS + loan-count target)
        bObj.totalAmount    = bObj.agents.reduce((s, a) => s + a.totalAmount,    0);
        bObj.totalLoans     = bObj.agents.reduce((s, a) => s + a.totalLoans,     0);
        bObj.newBizAmount   = bObj.agents.reduce((s, a) => s + a.newBizAmount,   0);
        bObj.newBizLoans    = bObj.agents.reduce((s, a) => s + a.newBizLoans,    0);
        // Loan-count target: prefer the Target sheet's per-branch "Loan Count
        // target" (monthly × months); fall back to the summed agent minimums
        // (display only — not enforced) when the sheet has no value.
        const bLoanTgt = loanCountTgtMap[normKey(branch)] ?? 0;
        bObj.loansTargetFromSheet = bLoanTgt > 0;
        bObj.loansTarget    = bLoanTgt > 0
          ? bLoanTgt * monthsCount
          : bObj.agents.reduce((s, a) => s + (a.minLoans || 0), 0);
        bObj.activeRepsTarget = activeRepsTgtMap[normKey(branch)] ?? 0;
        bObj.actualRepsTarget = actualRepsTgtMap[normKey(branch)] ?? 0;
        bObj.totalPrincipal = bObj.agents.reduce((s, a) => s + a.totalPrincipal, 0);
        bObj.par30Principal = bObj.agents.reduce((s, a) => s + a.par30Principal, 0);
        bObj.par30          = bObj.totalPrincipal > 0 ? bObj.par30Principal / bObj.totalPrincipal : 0;

        // TL name from "Branch Name (TL Name)" pattern
        const tlMatch = trim(branch).match(/\(([^)]+)\)\s*$/);
        bObj.tlName   = tlMatch ? trim(tlMatch[1]) : trim(branch);
        // TL title (from users file)
        bObj.tlTitle  = getTitle(bObj.tlName);

        // Step 3: qualify TL (4 criteria — sales %, new-biz %, loan-count %, PAR)
        const tlQual          = qualifyTL(bObj, product, region);
        bObj.tlQualified      = tlQual.qualified;
        bObj.tlReason         = tlQual.reason;
        bObj.tlAchievement    = tlQual.achievement;
        bObj.tlNewBizAchv     = tlQual.newBizAchv;
        bObj.tlLoansAchv      = tlQual.loansAchv;
        bObj.tlNewBizTarget   = tlQual.newBizTarget;
        bObj.tlPar30          = tlQual.par30;
        bObj.tlRequiredRatio  = tlQual.requiredRatio;

        // Step 3b: CASCADE — agent only "effectively qualified" if both they
        //          and their TL meet criteria (per memo: AGENT QUALIFICATION
        //          only if their TL qualifies).
        bObj.agents.forEach((agent) => {
          agent.tlQualified         = bObj.tlQualified;
          agent.qualified           = agent.selfQualified && bObj.tlQualified;
          if (!agent.qualified && agent.selfQualified && !bObj.tlQualified) {
            agent.qualReason = 'Met agent criteria but TL did not qualify';
          }
        });
        bObj.qualCount = bObj.agents.filter((a) => a.qualified).length;
      });

      // Step 4: region totals + PAR (incl. new biz + loans target)
      rObj.totalAmount    = Object.values(rObj.branches).reduce((s, b) => s + b.totalAmount,    0);
      rObj.totalLoans     = Object.values(rObj.branches).reduce((s, b) => s + b.totalLoans,     0);
      rObj.newBizAmount   = Object.values(rObj.branches).reduce((s, b) => s + b.newBizAmount,   0);
      rObj.newBizLoans    = Object.values(rObj.branches).reduce((s, b) => s + b.newBizLoans,    0);
      // Region loan-count target: use the region's own Target-sheet value when
      // present; otherwise sum the branch loan targets (display only).
      const rLoanTgt = loanCountTgtMap[regionKey] ?? 0;
      rObj.loansTargetFromSheet = rLoanTgt > 0;
      rObj.loansTarget    = rLoanTgt > 0
        ? rLoanTgt * monthsCount
        : Object.values(rObj.branches).reduce((s, b) => s + b.loansTarget,    0);
      rObj.activeRepsTarget = activeRepsTgtMap[regionKey] ?? 0;
      rObj.actualRepsTarget = actualRepsTgtMap[regionKey] ?? 0;
      rObj.totalPrincipal = Object.values(rObj.branches).reduce((s, b) => s + b.totalPrincipal, 0);
      rObj.par30Principal = Object.values(rObj.branches).reduce((s, b) => s + b.par30Principal, 0);
      rObj.par30          = rObj.totalPrincipal > 0 ? rObj.par30Principal / rObj.totalPrincipal : 0;
      rObj.qualCount      = Object.values(rObj.branches).reduce((s, b) => s + b.qualCount, 0);

      // Step 5: qualify region (same 4 criteria as TL)
      const rq                  = qualifyRegion(rObj, product, region);
      rObj.regionQualified      = rq.qualified;
      rObj.regionReason         = rq.reason;
      rObj.regionAchievement    = rq.achievement;
      rObj.regionNewBizAchv     = rq.newBizAchv;
      rObj.regionLoansAchv      = rq.loansAchv;
      rObj.regionNewBizTarget   = rq.newBizTarget;
      rObj.regionPar30          = rq.par30;
      rObj.regionRequiredRatio  = rq.requiredRatio;
    });

    // Product totals
    pObj.target        = Object.values(pObj.regions).reduce((s, r) => s + r.target,        0);
    pObj.totalAmount   = Object.values(pObj.regions).reduce((s, r) => s + r.totalAmount,   0);
    pObj.totalLoans    = Object.values(pObj.regions).reduce((s, r) => s + r.totalLoans,    0);
    pObj.newBizAmount  = Object.values(pObj.regions).reduce((s, r) => s + r.newBizAmount,  0);
    pObj.newBizLoans   = Object.values(pObj.regions).reduce((s, r) => s + r.newBizLoans,   0);
    pObj.loansTarget   = Object.values(pObj.regions).reduce((s, r) => s + r.loansTarget,   0);
    pObj.newBizTarget  = pObj.target * 0.6;
    pObj.qualCount     = Object.values(pObj.regions).reduce((s, r) => s + r.qualCount,     0);
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
    blockedByTL:     allAgents.filter((a) => a.selfQualified === true && a.tlQualified === false).length,
    selfQualified:   allAgents.filter((a) => a.selfQualified).length,
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
  };

  return { hierarchy, monthsInData, products, summary };
}
