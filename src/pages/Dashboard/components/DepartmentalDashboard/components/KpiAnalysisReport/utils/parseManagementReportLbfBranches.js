import * as XLSX from 'xlsx';

const SKIP_SHEETS = new Set(['country', 'kpi', 'summary', 'cover', 'contents']);

/* Column A says "Team Leader" on three different kinds of row, and only one of
   them is a team leader.

   On LBFCityMall, for instance:

     Team Leader | Thobias uchungu     45,000,000   <- a team leader
     Team Leader | LBF City Mall      620,000,000   <- the BRANCH's own total
     Team Leader | CS Call center      75,000,000   <- belongs to CS, not LBF

   Adding all three gave a branch target of 1,080,000,000 against a real
   620,000,000: the branch counted once as itself and again as the sum of its
   parts, plus 75m of someone else's product. Across the 23 LBF sheets that
   inflated the LBF target from 4,735,000,000 to 9,156,000,002, and it halved
   every branch's achievement - City Mall read 41.7% where the MTD said 72.6%.

   The branch's own row carries the branch target, and it is the only candidate
   that agrees with the MTD (6 of the 14 branches the MTD names individually;
   summing the team leaders agrees with none of them). */
const normKey = (v) => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');

// Names a different product and does not name this one.
const OTHER_PRODUCT = /\b(cs|sme)\b/i;
const isForeignRow = (name) =>
  OTHER_PRODUCT.test(String(name ?? '')) && !/lbf/i.test(String(name ?? ''));

function toNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/,/g, '').replace(/%/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export async function parseManagementReportLbfBranches(fileUrl) {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Failed to fetch management report: ${response.statusText}`);
  const arrayBuffer = await response.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, raw: true });

  const branches = [];
  const teamLeaders = [];
  let totalTarget = 0;
  let totalDisbursement = 0;
  let achieved100Count = 0;
  let notAchieved100Count = 0;
  let totalLoans = 0;
  let totalActiveAgents = 0;

  for (const sheetName of wb.SheetNames) {
    const s = String(sheetName || '').trim();
    if (!s || SKIP_SHEETS.has(s.toLowerCase()) || !s.toUpperCase().startsWith('LBF')) continue;

    const ws = wb.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    // Follow the same logic as find_management_lbf_sheet.py:
    // parse each "Team Leader" row and aggregate per branch.
    const tlRows = [];
    for (let i = 0; i < raw.length; i++) {
      const row = raw[i] || [];
      const a = String(row[0] ?? '').trim();
      if (a !== 'Team Leader') continue;

      const tlName = String(row[1] ?? '').trim();
      const target = toNum(row[2]);
      const newBusiness = toNum(row[3]);
      const repeatBusiness = toNum(row[4]);
      const disbursement = toNum(row[8]);
      const loans = toNum(row[19]);
      const avgLoanSize = toNum(row[20]);
      const activeClients = toNum(row[37]);

      let activeAgents = 0;
      for (let j = i + 1; j < raw.length; j++) {
        const r = raw[j] || [];
        const marker = String(r[0] ?? '').trim();
        if (marker === 'Team Leader') break;
        if (marker === 'Sales Rep') {
          const repLoans = toNum(r[19]);
          if (repLoans > 0) activeAgents += 1;
        }
      }

      const pct = target > 0 ? (disbursement / target) * 100 : 0;
      tlRows.push({
        branch: s,
        isBranchTotal: normKey(tlName) === normKey(s),
        isForeign: isForeignRow(tlName),
        teamLeader: tlName,
        target,
        newBusiness,
        repeatBusiness,
        disbursement,
        loans,
        avgLoanSize,
        activeClients,
        activeAgents,
        pct
      });
    }

    if (tlRows.length === 0) continue;

    const ownRows = tlRows.filter((tl) => !tl.isForeign);
    const realTls = ownRows.filter((tl) => !tl.isBranchTotal);

    /* Disbursement still sums every row of this branch, including its own
       total row - checked against the 30-09-2026 MTD, where that sum equals
       the branch's VALUE for 12 of the 14 branches the MTD names. Only the
       TARGET was being double counted. */
    const branchAgg = ownRows.reduce((acc, tl) => {
      acc.disbursement += tl.disbursement;
      acc.loans += tl.loans;
      acc.activeAgentApprox += tl.activeAgents;
      return acc;
    }, { target: 0, disbursement: 0, loans: 0, activeAgentApprox: 0 });

    // The branch's own row is the target. A few sheets have no such row
    // (LBFKigomaBranch), so the team leaders are the fallback rather than zero,
    // which would make the percentage meaningless.
    const ownTarget = ownRows
      .filter((tl) => tl.isBranchTotal)
      .reduce((n, tl) => n + tl.target, 0);
    branchAgg.target = ownTarget > 0
      ? ownTarget
      : realTls.reduce((n, tl) => n + tl.target, 0);

    const pct = branchAgg.target > 0 ? (branchAgg.disbursement / branchAgg.target) * 100 : 0;

    branches.push({
      branch: s,
      target: branchAgg.target,
      disbursement: branchAgg.disbursement,
      loans: branchAgg.loans,
      activeAgentApprox: branchAgg.activeAgentApprox,
      pct
    });
    teamLeaders.push(...realTls);

    totalTarget += branchAgg.target;
    totalDisbursement += branchAgg.disbursement;
    totalLoans += branchAgg.loans;
    totalActiveAgents += branchAgg.activeAgentApprox;
    if (pct >= 100) achieved100Count += 1;
    else notAchieved100Count += 1;
  }

  return {
    branches,
    teamLeaders,
    totalTarget,
    totalDisbursement,
    totalLoans,
    totalActiveAgents,
    achieved100Count,
    notAchieved100Count
  };
}

