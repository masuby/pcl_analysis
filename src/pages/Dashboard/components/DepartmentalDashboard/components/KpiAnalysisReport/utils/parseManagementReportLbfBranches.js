import * as XLSX from 'xlsx';

const SKIP_SHEETS = new Set(['country', 'kpi', 'summary', 'cover', 'contents']);

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

    const branchAgg = tlRows.reduce((acc, tl) => {
      acc.target += tl.target;
      acc.disbursement += tl.disbursement;
      acc.loans += tl.loans;
      acc.activeAgentApprox += tl.activeAgents;
      return acc;
    }, { target: 0, disbursement: 0, loans: 0, activeAgentApprox: 0 });
    const pct = branchAgg.target > 0 ? (branchAgg.disbursement / branchAgg.target) * 100 : 0;

    branches.push({
      branch: s,
      target: branchAgg.target,
      disbursement: branchAgg.disbursement,
      loans: branchAgg.loans,
      activeAgentApprox: branchAgg.activeAgentApprox,
      pct
    });
    teamLeaders.push(...tlRows);

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

