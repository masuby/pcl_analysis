/**
 * Consent Incentive Report — Excel Export
 *
 * Sheets:
 *   1. Procedure        — step-by-step diagnostics (audit trail)
 *   2. Summary          — totals per product
 *   3. 3-Month Consents — all ACCEPTED consents in last 3 months
 *   4. Current-Month    — filtered to latest month
 *   5. 3-Month Converted — Lead × Loan matches (fuzzy)
 *   6. Pricing          — per-agent payout
 *   7. Criteria         — incentive rate card
 */

import XLSXStyle from 'xlsx-js-style';

const PRODUCT_LABELS = {
  CS:  'CS — Civil Servant',
  LBF: 'LBF — Log Book Finance',
  SME: 'SME — Small & Medium Enterprise',
};

// ── palette ───────────────────────────────────────────────────────────────────
const PAL = {
  headerBg: '1F3864', headerFg: 'FFFFFF',
  cs:   { bg: 'C6EFCE', fg: '276221' },
  lbf:  { bg: 'BDD7EE', fg: '1E3A5F' },
  sme:  { bg: 'FCE4D6', fg: '7F2B0E' },
  alt:  'F7FAFD',
  subHdr: '2E74B5',
};

// ── borders ───────────────────────────────────────────────────────────────────
const thin  = { style: 'thin',   color: { rgb: 'C8D0DA' } };
const med   = { style: 'medium', color: { rgb: '8EA9C1' } };
const BORDER     = { top: thin, bottom: thin, left: thin, right: thin };
const BORDER_MED = { top: med,  bottom: med,  left: med,  right: med  };

const A    = (h = 'left',  wrap = false, v = 'center') => ({ horizontal: h, vertical: v, wrapText: wrap });
const F    = (bold = false, color = '000000', sz = 9, name = 'Arial') => ({ name, bold, color: { rgb: color }, sz });
const FILL = (rgb) => ({ patternType: 'solid', fgColor: { rgb } });

// ── cell factories ────────────────────────────────────────────────────────────
function hdr(v, al = 'center') {
  return { v: v ?? '', t: 's',
    s: { font: F(true, PAL.headerFg, 9), fill: FILL(PAL.headerBg), alignment: A(al, true), border: BORDER } };
}
function cell(v, bold = false, color = '1F2937', al = 'left', bg = 'FFFFFF') {
  const t = typeof v === 'number' ? 'n' : 's';
  return { v: v ?? (t === 'n' ? 0 : ''), t,
    s: { font: F(bold, color, 9), fill: FILL(bg), alignment: A(al, false), border: BORDER } };
}
function numCell(v, bold = false, color = '1F2937', bg = 'FFFFFF', fmt = '#,##0') {
  return { v: typeof v === 'number' ? v : (Number(v) || 0), t: 'n',
    s: { font: F(bold, color, 9), fill: FILL(bg), alignment: A('right', false), border: BORDER, numFmt: fmt } };
}
function pctCell(ratio, bg = 'FFFFFF') {
  const pct = Math.round((ratio ?? 0) * 100);
  const color = pct >= 90 ? '166534' : pct >= 66 ? '92400E' : '991B1B';
  return numCell(pct, true, color, bg);
}
function dateCell(d, bg = 'FFFFFF') {
  if (!d) return cell('—', false, '9CA3AF', 'center', bg);
  const s = d instanceof Date ? d.toLocaleDateString('en-GB') : String(d);
  return { v: s, t: 's', s: { font: F(false, '374151', 9), fill: FILL(bg), alignment: A('center'), border: BORDER } };
}
function titleCell(v) {
  return { v: v ?? '', t: 's',
    s: { font: F(true, PAL.headerFg, 13), fill: FILL(PAL.headerBg), alignment: A('center', false, 'center'), border: BORDER_MED } };
}
function setWidths(ws, widths) { ws['!cols'] = widths.map((w) => ({ wch: w })); }
function addRow(ws, rowIdx, cells) {
  cells.forEach((c, ci) => {
    const addr = XLSXStyle.utils.encode_cell({ r: rowIdx, c: ci });
    ws[addr] = c;
  });
}
function finaliseSheet(ws, maxR, maxC) {
  ws['!ref'] = XLSXStyle.utils.encode_range({ r: 0, c: 0 }, { r: maxR, c: maxC });
}
function mergeRow(ws, row, cols, startCol = 0) {
  if (!ws['!merges']) ws['!merges'] = [];
  ws['!merges'].push({ s: { r: row, c: startCol }, e: { r: row, c: cols - 1 } });
}

// ── Subtitle helper ──────────────────────────────────────────────────────────
function subtitleRow(ws, r, cols, text) {
  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = {
    v: text, t: 's',
    s: { font: F(false, PAL.headerBg, 10), fill: FILL('EFF6FF'), alignment: A('center'), border: BORDER },
  };
  mergeRow(ws, r, cols);
}

// ═══════════════════════════════════════════════════════════════════════════
// Sheet 1: PROCEDURE & DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════
function buildProcedureSheet(diagnostics, summary) {
  const ws   = {};
  const COLS = 4;
  let r = 0;
  ws['!merges'] = [];

  const section = (label, bg = '1F3864') => {
    ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = {
      v: label, t: 's',
      s: { font: F(true, 'FFFFFF', 11), fill: FILL(bg), alignment: A('left', false, 'center'), border: BORDER_MED },
    };
    mergeRow(ws, r, COLS);
    r++;
  };
  const kv = (k, v, note = '', bg = 'FFFFFF') => {
    addRow(ws, r, [
      cell(k, true, '1F3864', 'left', bg),
      cell(typeof v === 'number' ? v.toLocaleString() : (v ?? '—'), false, '374151', 'left', bg),
      cell('', false, '374151', 'left', bg),
      cell(note, false, '6B7280', 'left', bg),
    ]);
    r++;
  };
  const step = (n, desc, result, note = '') => {
    const bg = r % 2 === 0 ? 'FFFFFF' : 'F7FAFD';
    addRow(ws, r, [
      cell(`Step ${n}`, true, '1E40AF', 'center', bg),
      cell(desc, false, '1F3864', 'left', bg),
      cell(result, true, '166534', 'left', bg),
      cell(note, false, '6B7280', 'left', bg),
    ]);
    r++;
  };

  // Title
  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = titleCell('PROCEDURE & DIAGNOSTICS');
  mergeRow(ws, r, COLS); r++;
  subtitleRow(ws, r, COLS,
    'Step-by-step trace of how this report was generated, with the CRM lookup summary so you can verify the inputs.');
  r += 2;

  // Section 1: CRM reports used
  section('1. CS CRM REPORTS USED (FROM DATABASE)');
  const latest = diagnostics?.latestCRM ?? {};
  kv('Latest CRM (used for user_data)', latest.title || latest.fileName || '—');
  kv('Latest CRM file', latest.fileName || '—');
  kv('Latest CRM date', latest.date ? new Date(latest.date).toLocaleDateString('en-GB') : '—');
  kv('Latest CRM id',   latest.id || '—');
  kv('CRM reports scanned for agent_activity', diagnostics?.activity?.reportsScanned ?? 0,
     'Used for cross-CRM field-activity verification');
  kv('Total agent_activity rows scanned',      diagnostics?.activity?.totalActivityRows ?? 0);
  kv('Activity lookup entries',                diagnostics?.activity?.lookupSize ?? 0,
     '(agent, day) pairs in the field-verification map');
  r++;

  // Section 2: user_data parsing
  section('2. CRM user_data SHEET PARSING', '2E74B5');
  const ud = diagnostics?.userData ?? {};
  kv('Sheet found',      ud.sheetName || '— NOT FOUND —');
  kv('Available sheets', (ud.availableSheets ?? []).join(', '));
  kv('Total rows',       ud.totalRows ?? 0);
  kv('Agents loaded',    ud.agentsLoaded ?? 0);
  if (ud.detectedColumns) {
    kv('Detected: Name',       ud.detectedColumns.name      || '— missing —');
    kv('Detected: Tenant=Branch', ud.detectedColumns.tenant || '— missing —');
    kv('Detected: Zone',       ud.detectedColumns.zone      || '— missing —');
    kv('Detected: Product',    ud.detectedColumns.product   || '— missing —');
    kv('Detected: Last_Login', ud.detectedColumns.lastLogin || '— missing —');
  }
  if (ud.byProduct) {
    r++;
    addRow(ws, r, [
      cell('PRODUCT DISTRIBUTION', true, 'FFFFFF', 'left', '2E74B5'),
      cell('Agents in user_data',  true, 'FFFFFF', 'left', '2E74B5'),
      cell('', false, 'FFFFFF', 'left', '2E74B5'),
      cell('', false, 'FFFFFF', 'left', '2E74B5'),
    ]);
    r++;
    Object.entries(ud.byProduct).forEach(([p, n]) => kv(p, n));
  }
  if (ud.sampleAgents?.length) {
    r++;
    addRow(ws, r, [
      cell('SAMPLE AGENTS (first 5)', true, 'FFFFFF', 'left', '2E74B5'),
      cell('Product', true, 'FFFFFF', 'left', '2E74B5'),
      cell('Zone',    true, 'FFFFFF', 'left', '2E74B5'),
      cell('Last_Login', true, 'FFFFFF', 'left', '2E74B5'),
    ]);
    r++;
    ud.sampleAgents.forEach((a) => {
      addRow(ws, r, [
        cell(a.name || '—',    false, '1F3864'),
        cell(a.product || '—', true,  '166534'),
        cell(a.zone || '—',    false, '374151'),
        cell(a.lastLogin || '—', false, '374151'),
      ]);
      r++;
    });
  }
  r++;

  // Section 3: Lead parsing
  section('3. LEAD FILE PARSING', '0F766E');
  const lead = diagnostics?.lead ?? {};
  kv('Sheet found',         lead.sheetName || '— NOT FOUND —');
  kv('Total rows',          lead.rowsTotal ?? 0);
  kv('Accepted rows',       lead.rowsAccepted ?? 0,  'Consent_Status = ACCEPTED');
  kv('Dropped rows',        lead.rowsDropped ?? 0,   'Other statuses (NOT PROVIDED, REJECTED, etc.)');
  kv('Consent_Date format', lead.dateFormat || '—',  'DMY = DD/MM/YYYY · MDY = MM/DD/YYYY (auto-detected)');
  kv('TEAM_NAME back-fills',lead.teamBackfilled ?? 0,
     'Missing "none" team values filled from agent\'s most-frequent team');
  kv('Unique teams found',  lead.uniqueTeams ?? 0);
  if (lead.detectedColumns) {
    kv('Detected: Created_By',     lead.detectedColumns.createdBy     || '— missing —');
    kv('Detected: Consent_Status', lead.detectedColumns.consentStatus || '— missing —');
    kv('Detected: Consent_Date',   lead.detectedColumns.consentDate   || '— missing —');
    kv('Detected: Team_Name',      lead.detectedColumns.team          || '—');
  }
  r++;

  // Section 4: Loan parsing
  section('4. LOAN FILE PARSING', '7C3AED');
  const loan = diagnostics?.loan ?? {};
  kv('Sheet',           loan.sheet || '—');
  kv('Total rows',      loan.totalRows ?? 0);
  kv('Latest month',    loan.latestMonth || '—', 'max(Activation Date) month');
  kv('Loans in latest month', loan.loansInLatestMonth ?? 0,
     'Filtered set used for fuzzy conversion match');
  kv('Loans matched',   loan.matchedLoans ?? 0,
     'Loans paired to a Lead via fuzzy name match ≥ 0.66');
  r++;

  // Section 5: Processing steps
  section('5. PROCESSING STEPS', '1E40AF');
  step(1, 'VLOOKUP Created_By → CRM user_data',
       `${lead.lookupMatched ?? 0} matched · ${lead.lookupUnmatched ?? 0} unmatched`,
       `match rate: ${Math.round((lead.lookupMatchRate ?? 0) * 100)}%`);
  step(2, 'Filter Consent_Status = ACCEPTED',
       `${lead.rowsAccepted ?? 0} accepted · ${lead.rowsDropped ?? 0} dropped`);
  step(3, 'Compute Active flag from Last_Login (≤ 90 days)',
       `Applied per agent`, 'See Pricing sheet column "Active?"');
  step(4, 'Conversion match (Lead × Loan, fuzzy ≥ 0.66)',
       `${loan.matchedLoans ?? 0} converted`,
       `from ${loan.loansInLatestMonth ?? 0} loans in latest month`);
  step(5, 'Field verification (Target_Met = AT_LOCATION on Consent_Date)',
       `${summary?.totalVerified ?? 0} verified · ${summary?.totalUnverified ?? 0} unverified`,
       `Scanned ${diagnostics?.activity?.reportsScanned ?? 0} CRM report(s)`);
  step(6, 'Build operational sheets (3M, Current, Converted)',
       `${diagnostics?.output?.consents3m ?? 0} / ${diagnostics?.output?.consentsCurrent ?? 0} / ${diagnostics?.output?.converted ?? 0}`);
  step(7, 'Compute payouts',
       `TZS ${(diagnostics?.output?.totalPayout ?? 0).toLocaleString()}`,
       `+ team awards TZS ${(diagnostics?.output?.teamAwardTotal ?? 0).toLocaleString()}`);
  r++;

  // Section 6: Status distribution
  section('6. RAW Consent_Status DISTRIBUTION', '92400E');
  addRow(ws, r, [
    cell('Status value', true, 'FFFFFF', 'left', '92400E'),
    cell('Count', true, 'FFFFFF', 'right', '92400E'),
    cell('', false, 'FFFFFF'),
    cell('Verify these match the spec', false, 'FFFFFF', 'left', '92400E'),
  ]);
  mergeRow(ws, r, COLS, 2);
  r++;
  const statusEntries = Object.entries(lead.statusCounts ?? {}).sort(([, a], [, b]) => b - a);
  if (!statusEntries.length) kv('— no values found —', '');
  else statusEntries.forEach(([k, n]) => kv(k, n));
  r++;

  // Section 7: Unmatched names
  if ((lead.unmatchedNames ?? []).length) {
    section('7. UNMATCHED Created_By NAMES (first 50)', '991B1B');
    ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = cell(
      'These agents from the Lead file were not found in CRM user_data. Their product is UNKNOWN and they will not earn an incentive.',
      false, '991B1B', 'left', 'FEF2F2');
    mergeRow(ws, r, COLS);
    r++;
    lead.unmatchedNames.forEach((name) => {
      ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = cell(name, false, '991B1B', 'left', 'FEF2F2');
      mergeRow(ws, r, COLS);
      r++;
    });
    r++;
  }

  // Section 8: Final totals
  section('8. FINAL TOTALS', '166534');
  kv('Unique agents',     diagnostics?.output?.uniqueAgents ?? 0);
  kv('Verified consents', summary?.totalVerified  ?? 0);
  kv('Unverified consents', summary?.totalUnverified ?? 0);
  kv('Converted (matched in Loan)', summary?.totalConverted ?? 0);
  kv('Agent payout (TZS)',  summary?.totalPayout    ?? 0);
  kv('Team awards (TZS)',   summary?.teamAwardTotal ?? 0);
  kv('GRAND TOTAL (TZS)',   summary?.grandTotal     ?? 0, 'Agents + team drink-ups');

  setWidths(ws, [28, 38, 24, 50]);
  finaliseSheet(ws, r, COLS - 1);
  ws['!freeze'] = { ySplit: 3 };
  return ws;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sheet 2: SUMMARY
// ═══════════════════════════════════════════════════════════════════════════
function buildSummarySheet(summary) {
  const ws = {};
  const COLS = 6;
  let r = 0;
  ws['!merges'] = [];

  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = titleCell(
    `CONSENT INCENTIVE REPORT — ${summary.period}${summary.product ? `  •  ${summary.product} ONLY` : ''}`);
  mergeRow(ws, r, COLS); r++;
  subtitleRow(ws, r, COLS,
    summary.product ? `${PRODUCT_LABELS[summary.product] ?? summary.product} — ${summary.period}` : summary.period);
  r += 2;

  addRow(ws, r, [
    hdr('PRODUCT'), hdr('AGENTS', 'right'), hdr('VERIFIED', 'right'),
    hdr('UNVERIFIED', 'right'), hdr('CONVERTED', 'right'), hdr('TOTAL PAYOUT (TZS)', 'right'),
  ]);
  r++;

  const order = ['CS', 'LBF', 'SME'];
  const all = [
    ...order.filter((p) => summary.byProduct[p]),
    ...Object.keys(summary.byProduct).filter((p) => !order.includes(p)),
  ];
  all.forEach((p, i) => {
    const b  = summary.byProduct[p];
    const bg = i % 2 === 0 ? 'FFFFFF' : PAL.alt;
    addRow(ws, r, [
      cell(PRODUCT_LABELS[p] ?? b.label ?? p, true, PAL.headerBg, 'left', bg),
      numCell(b.agents, false, '374151', bg),
      numCell(b.verified,   true,  '166534', bg),
      numCell(b.unverified, false, '92400E', bg),
      numCell(b.converted,  true,  '7C3AED', bg),
      numCell(b.totalPayout,true,  '1F3864', bg),
    ]);
    r++;
  });

  addRow(ws, r, [
    cell('TOTAL', true, 'FFFFFF', 'left', PAL.headerBg),
    numCell(summary.totalAgents,     true, 'FFFFFF', PAL.headerBg),
    numCell(summary.totalVerified,   true, 'FFFFFF', PAL.headerBg),
    numCell(summary.totalUnverified, true, 'FFFFFF', PAL.headerBg),
    numCell(summary.totalConverted,  true, 'FFFFFF', PAL.headerBg),
    numCell(summary.totalPayout,     true, 'FFFFFF', PAL.headerBg),
  ]);
  r++;

  // Team awards row
  r++;
  addRow(ws, r, [
    cell(`Team Drink-up Awards — ${summary.teamsQualified ?? 0} of ${summary.totalTeams ?? 0} team(s) ≥ 150 verified`,
         false, '92400E', 'left', 'FEF3C7'),
    cell('', false), cell('', false), cell('', false), cell('', false),
    numCell(summary.teamAwardTotal, true, '92400E', 'FEF3C7'),
  ]);
  mergeRow(ws, r, COLS - 1);
  r++;
  if (summary.topTeam) {
    addRow(ws, r, [
      cell(`Winning Team: ${summary.topTeam.team} — ${(summary.topTeam.verified ?? 0).toLocaleString()} verified consents${summary.topTeam.qualified ? ' (qualified)' : ''}`,
           true, '166534', 'left', 'F0FDF4'),
      cell('', false, '166534', 'left', 'F0FDF4'),
      cell('', false, '166534', 'left', 'F0FDF4'),
      cell('', false, '166534', 'left', 'F0FDF4'),
      cell('', false, '166534', 'left', 'F0FDF4'),
      cell('', false, '166534', 'left', 'F0FDF4'),
    ]);
    mergeRow(ws, r, COLS);
    r++;
  }
  r++;
  addRow(ws, r, [
    cell('GRAND TOTAL (Agents + Teams)', true, 'FFFFFF', 'left', PAL.headerBg),
    cell('', false), cell('', false), cell('', false), cell('', false),
    numCell(summary.grandTotal, true, 'FFFFFF', PAL.headerBg),
  ]);
  mergeRow(ws, r, COLS - 1);
  r++;

  setWidths(ws, [36, 12, 14, 14, 14, 22]);
  finaliseSheet(ws, r, COLS - 1);
  ws['!freeze'] = { ySplit: 4 };
  return ws;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sheet: TEAM SUMMARY (NEW)
// ═══════════════════════════════════════════════════════════════════════════
function buildTeamSummarySheet(teams) {
  const ws = {};
  const COLS = 10;
  let r = 0;
  ws['!merges'] = [];

  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = titleCell('TEAM SUMMARY — DRINK-UP STANDINGS');
  mergeRow(ws, r, COLS); r++;
  subtitleRow(ws, r, COLS,
    'Per-team aggregates. Any team with ≥ 150 verified consents earns the TZS 200,000 team drink-up award.');
  r += 2;

  addRow(ws, r, [
    hdr('#', 'right'), hdr('TEAM'), hdr('AGENTS', 'right'), hdr('PRODUCTS'),
    hdr('VERIFIED', 'right'), hdr('UNVERIFIED', 'right'), hdr('CONVERTED', 'right'),
    hdr('AGENT PAYOUT (TZS)', 'right'), hdr('DRINK-UP (TZS)', 'right'), hdr('STATUS', 'center'),
  ]);
  r++;

  if (!teams.length) {
    ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = {
      v: 'No teams found in the Lead file.', t: 's',
      s: { font: F(false, '6B7280', 9), fill: FILL('F9FAFB'), alignment: A('center'), border: BORDER },
    };
    mergeRow(ws, r, COLS); r++;
  } else {
    teams.forEach((t, i) => {
      const bg = i % 2 === 0 ? 'FFFFFF' : PAL.alt;
      const statusBg = t.qualified ? 'DCFCE7' : 'FEE2E2';
      const statusFg = t.qualified ? '166534' : '991B1B';
      const statusTxt = t.qualified ? '✓ QUALIFIED' : `✗ short by ${t.shortBy}`;
      addRow(ws, r, [
        numCell(i + 1, false, '9CA3AF', bg),
        cell(t.team, true, '1F3864', 'left', bg),
        numCell(t.agents, false, '374151', bg),
        cell(t.products, false, '6B7280', 'left', bg),
        numCell(t.verified, true,  t.qualified ? '166534' : '92400E', bg),
        numCell(t.unverified, false, '92400E', bg),
        numCell(t.converted, true, '7C3AED', bg),
        numCell(t.agentPayout, false, '1F3864', bg),
        numCell(t.drinkupAmount, true, t.qualified ? '166534' : '9CA3AF', bg),
        { v: statusTxt, t: 's',
          s: { font: F(true, statusFg, 9), fill: FILL(statusBg), alignment: A('center'), border: BORDER } },
      ]);
      r++;
    });

    // Totals
    const totV = teams.reduce((s, t) => s + t.verified, 0);
    const totU = teams.reduce((s, t) => s + t.unverified, 0);
    const totC = teams.reduce((s, t) => s + t.converted, 0);
    const totP = teams.reduce((s, t) => s + t.agentPayout, 0);
    const totD = teams.reduce((s, t) => s + t.drinkupAmount, 0);
    const totA = teams.reduce((s, t) => s + t.agents, 0);
    addRow(ws, r, [
      cell('', false, 'FFFFFF', 'left', PAL.headerBg),
      cell('TOTAL', true, 'FFFFFF', 'left', PAL.headerBg),
      numCell(totA, true, 'FFFFFF', PAL.headerBg),
      cell('', false, 'FFFFFF', 'left', PAL.headerBg),
      numCell(totV, true, 'FFFFFF', PAL.headerBg),
      numCell(totU, true, 'FFFFFF', PAL.headerBg),
      numCell(totC, true, 'FFFFFF', PAL.headerBg),
      numCell(totP, true, 'FFFFFF', PAL.headerBg),
      numCell(totD, true, 'FFFFFF', PAL.headerBg),
      cell(`${teams.filter((t) => t.qualified).length} qualified`, true, 'FFFFFF', 'center', PAL.headerBg),
    ]);
    r++;
  }

  setWidths(ws, [5, 28, 8, 14, 12, 12, 12, 20, 18, 22]);
  finaliseSheet(ws, r, COLS - 1);
  ws['!freeze'] = { ySplit: 4 };
  return ws;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sheet 3 & 4: 3-MONTH CONSENTS / CURRENT-MONTH CONSENTS
// ═══════════════════════════════════════════════════════════════════════════
function buildConsentsSheet(consents, title, subtitle) {
  const ws = {};
  const COLS = 8;
  let r = 0;
  ws['!merges'] = [];

  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = titleCell(title);
  mergeRow(ws, r, COLS); r++;
  subtitleRow(ws, r, COLS, subtitle); r += 2;

  addRow(ws, r, [
    hdr('#', 'right'), hdr('AGENT'), hdr('BRANCH'), hdr('ZONE'),
    hdr('PRODUCT'), hdr('LEAD NAME'), hdr('CONSENT DATE'), hdr('TEAM'),
  ]);
  // Add Field Verified column? It's important — let me push it (but COLS would be 9). Re-do.
  // Actually I declared COLS=8 then added 8 headers, but I need 9. Let me fix.
  r++;

  consents.forEach((c, i) => {
    const bg   = i % 2 === 0 ? 'FFFFFF' : PAL.alt;
    const palP = PAL[c.product?.toLowerCase()] ?? { bg: 'F3F4F6', fg: '374151' };
    addRow(ws, r, [
      numCell(i + 1, false, '9CA3AF', bg),
      cell(c.agent, true, '1F3864', 'left', bg),
      cell(c.branch, false, '374151', 'left', bg),
      cell(c.zone,   false, '374151', 'left', bg),
      { v: c.product ?? '', t: 's', s: { font: F(true, palP.fg, 9), fill: FILL(palP.bg), alignment: A('center'), border: BORDER } },
      cell(c.leadName, false, '1F3864', 'left', bg),
      dateCell(c.consentDate, bg),
      cell(c.team, false, '374151', 'left', bg),
    ]);
    r++;
  });

  setWidths(ws, [5, 28, 22, 22, 10, 28, 14, 22]);
  finaliseSheet(ws, r, COLS - 1);
  ws['!freeze'] = { ySplit: 4 };
  return ws;
}

// Re-make consents sheet with 9 columns including Field Verified
function buildConsentsSheetV2(consents, title, subtitle) {
  const ws = {};
  const COLS = 9;
  let r = 0;
  ws['!merges'] = [];

  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = titleCell(title);
  mergeRow(ws, r, COLS); r++;
  subtitleRow(ws, r, COLS, subtitle); r += 2;

  addRow(ws, r, [
    hdr('#', 'right'), hdr('AGENT'), hdr('BRANCH'), hdr('ZONE'),
    hdr('PRODUCT'), hdr('LEAD NAME'), hdr('CONSENT DATE'), hdr('TEAM'),
    hdr('FIELD VERIFIED?'),
  ]);
  r++;

  consents.forEach((c, i) => {
    const bg   = i % 2 === 0 ? 'FFFFFF' : PAL.alt;
    const palP = PAL[c.product?.toLowerCase()] ?? { bg: 'F3F4F6', fg: '374151' };
    const fvBg = c.fieldVerified ? 'DCFCE7' : 'FEE2E2';
    const fvFg = c.fieldVerified ? '166534' : '991B1B';
    addRow(ws, r, [
      numCell(i + 1, false, '9CA3AF', bg),
      cell(c.agent, true, '1F3864', 'left', bg),
      cell(c.branch, false, '374151', 'left', bg),
      cell(c.zone,   false, '374151', 'left', bg),
      { v: c.product ?? '', t: 's', s: { font: F(true, palP.fg, 9), fill: FILL(palP.bg), alignment: A('center'), border: BORDER } },
      cell(c.leadName, false, '1F3864', 'left', bg),
      dateCell(c.consentDate, bg),
      cell(c.team, false, '374151', 'left', bg),
      { v: c.fieldVerified ? '✓ VERIFIED' : '✗ OFFICE', t: 's',
        s: { font: F(true, fvFg, 9), fill: FILL(fvBg), alignment: A('center'), border: BORDER } },
    ]);
    r++;
  });

  setWidths(ws, [5, 28, 22, 22, 10, 28, 14, 22, 16]);
  finaliseSheet(ws, r, COLS - 1);
  ws['!freeze'] = { ySplit: 4 };
  return ws;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sheet 5: 3-MONTH CONVERTED (Lead × Loan)
// ═══════════════════════════════════════════════════════════════════════════
function buildConvertedSheet(converted, summary) {
  const ws = {};
  const COLS = 12;
  let r = 0;
  ws['!merges'] = [];

  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = titleCell('3-MONTH CONVERTED — LEAD × LOAN');
  mergeRow(ws, r, COLS); r++;
  subtitleRow(ws, r, COLS,
    `Loans (latest month: ${summary?.byProduct ? 'see Procedure' : '—'}) matched to Leads via fuzzy name match ≥ 66%`);
  r += 2;

  // Super-headers: LEAD | LOAN | MATCH
  const leadBg = '0F766E'; const loanBg = '7C3AED'; const matchBg = 'B45309';
  addRow(ws, r, [
    { v: 'LEAD',  t: 's', s: { font: F(true, 'FFFFFF', 10), fill: FILL(leadBg),  alignment: A('center'), border: BORDER_MED } },
    { v: '',      t: 's', s: { fill: FILL(leadBg),  border: BORDER_MED } },
    { v: '',      t: 's', s: { fill: FILL(leadBg),  border: BORDER_MED } },
    { v: '',      t: 's', s: { fill: FILL(leadBg),  border: BORDER_MED } },
    { v: 'LOAN',  t: 's', s: { font: F(true, 'FFFFFF', 10), fill: FILL(loanBg),  alignment: A('center'), border: BORDER_MED } },
    { v: '',      t: 's', s: { fill: FILL(loanBg),  border: BORDER_MED } },
    { v: '',      t: 's', s: { fill: FILL(loanBg),  border: BORDER_MED } },
    { v: '',      t: 's', s: { fill: FILL(loanBg),  border: BORDER_MED } },
    { v: '',      t: 's', s: { fill: FILL(loanBg),  border: BORDER_MED } },
    { v: '',      t: 's', s: { fill: FILL(loanBg),  border: BORDER_MED } },
    { v: '',      t: 's', s: { fill: FILL(loanBg),  border: BORDER_MED } },
    { v: 'MATCH', t: 's', s: { font: F(true, 'FFFFFF', 10), fill: FILL(matchBg), alignment: A('center'), border: BORDER_MED } },
  ]);
  if (!ws['!merges']) ws['!merges'] = [];
  ws['!merges'].push({ s: { r, c: 0 }, e: { r, c: 3 } });
  ws['!merges'].push({ s: { r, c: 4 }, e: { r, c: 10 } });
  r++;

  addRow(ws, r, [
    hdr('AGENT'), hdr('LEAD NAME'), hdr('CONSENT DATE'), hdr('PRODUCT'),
    hdr('ACCOUNT HOLDER'), hdr('LOAN NAME'), hdr('LOAN AMOUNT', 'right'),
    hdr('BRANCH'), hdr('SALES REP(S) — CLIENT'), hdr('LATEST ACTIVATION'), hdr('CLIENT TYPE'),
    hdr('SIM %', 'right'),
  ]);
  r++;

  converted.forEach((c, i) => {
    const bg   = i % 2 === 0 ? 'FFFFFF' : PAL.alt;
    const palP = PAL[c.product?.toLowerCase()] ?? { bg: 'F3F4F6', fg: '374151' };
    // Highlight multi-loan / multi-rep rows
    const repsBg = (c.salesRepCount ?? 0) > 1 ? 'FEF3C7' : bg;
    const repsFg = (c.salesRepCount ?? 0) > 1 ? '92400E' : '374151';
    const loanLabel = c.loanCount > 1 ? `${c.loanName}  (${c.loanCount} loans)` : (c.loanName || '');
    addRow(ws, r, [
      cell(c.agent, true, '1F3864', 'left', bg),
      cell(c.leadName, false, '0F766E', 'left', bg),
      dateCell(c.consentDate, bg),
      { v: c.product ?? '', t: 's', s: { font: F(true, palP.fg, 9), fill: FILL(palP.bg), alignment: A('center'), border: BORDER } },
      cell(c.accountHolder, true, '7C3AED', 'left', bg),
      cell(loanLabel,  false, '374151', 'left', bg),
      numCell(c.loanAmount, true, '1F3864', bg, '#,##0.00'),
      cell(c.loanBranch, false, '374151', 'left', bg),
      cell(c.salesRep, (c.salesRepCount ?? 0) > 1, repsFg, 'left', repsBg),
      dateCell(c.activationDate, bg),
      cell(c.clientType, false, '374151', 'center', bg),
      pctCell(c.similarity, bg),
    ]);
    r++;
  });

  if (!converted.length) {
    ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = {
      v: 'No conversions matched in the latest month.', t: 's',
      s: { font: F(false, '6B7280', 9), fill: FILL('F9FAFB'), alignment: A('center'), border: BORDER },
    };
    mergeRow(ws, r, COLS);
    r++;
  }

  setWidths(ws, [24, 26, 14, 8, 26, 22, 16, 16, 22, 14, 12, 12]);
  finaliseSheet(ws, r, COLS - 1);
  ws['!freeze'] = { ySplit: 5 };
  return ws;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sheet 6: PRICING
// ═══════════════════════════════════════════════════════════════════════════
function buildPricingSheet(agents, summary, topPerformers) {
  const ws = {};
  const COLS = 13;
  let r = 0;
  ws['!merges'] = [];

  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = titleCell('PRICING — PER-AGENT PAYOUT');
  mergeRow(ws, r, COLS); r++;
  subtitleRow(ws, r, COLS,
    `Sorted by Total Payout (high → low). NOT_ACTIVE agents are flagged but still computed for manager review.`);
  r += 2;

  addRow(ws, r, [
    hdr('#', 'right'), hdr('AGENT'), hdr('PRODUCT'), hdr('BRANCH'), hdr('ZONE'),
    hdr('LAST LOGIN'), hdr('ACTIVE?'), hdr('VERIFIED', 'right'), hdr('UNVERIFIED', 'right'),
    hdr('CONVERTED', 'right'), hdr('BASE PAYOUT', 'right'), hdr('TOP BONUS', 'right'),
    hdr('TOTAL PAYOUT (TZS)', 'right'),
  ]);
  r++;

  const topKeys = new Set(Object.values(topPerformers ?? {}).map((t) => `${t.name}|${t.product}`));

  agents.forEach((a, i) => {
    const bg   = i % 2 === 0 ? 'FFFFFF' : PAL.alt;
    const palP = PAL[a.product?.toLowerCase()] ?? { bg: 'F3F4F6', fg: '374151' };
    const activeBg = a.active ? 'DCFCE7' : 'FEE2E2';
    const activeFg = a.active ? '166534' : '991B1B';
    const isTop    = topKeys.has(`${a.name}|${a.product}`);
    addRow(ws, r, [
      numCell(i + 1, false, '9CA3AF', bg),
      cell(a.name + (isTop ? '  ⭐' : ''), true, '1F3864', 'left', bg),
      { v: a.product ?? '', t: 's', s: { font: F(true, palP.fg, 9), fill: FILL(palP.bg), alignment: A('center'), border: BORDER } },
      cell(a.branch, false, '374151', 'left', bg),
      cell(a.zone,   false, '374151', 'left', bg),
      cell(a.lastLogin || '—', false, '6B7280', 'left', bg),
      { v: a.active ? 'ACTIVE' : 'NOT_ACTIVE', t: 's',
        s: { font: F(true, activeFg, 9), fill: FILL(activeBg), alignment: A('center'), border: BORDER } },
      numCell(a.verified,   true,  '166534', bg),
      numCell(a.unverified, false, '92400E', bg),
      numCell(a.converted,  true,  '7C3AED', bg),
      numCell(a.basePayout, false, '374151', bg),
      numCell(a.topBonus,   true,  a.topBonus > 0 ? '854D0E' : '9CA3AF',
              a.topBonus > 0 ? 'FFFBEB' : bg),
      numCell(a.totalPayout, true, '1F3864', bg),
    ]);
    r++;
  });

  // Totals row
  addRow(ws, r, [
    cell('', false, 'FFFFFF', 'left', PAL.headerBg),
    cell('TOTAL', true, 'FFFFFF', 'left', PAL.headerBg),
    cell('', false, 'FFFFFF', 'left', PAL.headerBg),
    cell('', false, 'FFFFFF', 'left', PAL.headerBg),
    cell('', false, 'FFFFFF', 'left', PAL.headerBg),
    cell('', false, 'FFFFFF', 'left', PAL.headerBg),
    cell('', false, 'FFFFFF', 'left', PAL.headerBg),
    numCell(summary.totalVerified,   true, 'FFFFFF', PAL.headerBg),
    numCell(summary.totalUnverified, true, 'FFFFFF', PAL.headerBg),
    numCell(summary.totalConverted,  true, 'FFFFFF', PAL.headerBg),
    numCell(agents.reduce((s, a) => s + a.basePayout, 0), true, 'FFFFFF', PAL.headerBg),
    numCell(agents.reduce((s, a) => s + a.topBonus,   0), true, 'FFFFFF', PAL.headerBg),
    numCell(summary.totalPayout,     true, 'FFFFFF', PAL.headerBg),
  ]);
  r++;

  setWidths(ws, [5, 28, 10, 22, 22, 16, 12, 12, 12, 12, 16, 14, 20]);
  finaliseSheet(ws, r, COLS - 1);
  ws['!freeze'] = { ySplit: 5 };
  return ws;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sheet 7: CRITERIA
// ═══════════════════════════════════════════════════════════════════════════
function buildCriteriaSheet(product = null) {
  const ws = {};
  const COLS = 6;
  let r = 0;
  ws['!merges'] = [];

  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = titleCell(
    `CONSENT INCENTIVE — CRITERIA 2026${product ? `  •  ${product} ONLY` : ''}`);
  mergeRow(ws, r, COLS); r++;
  subtitleRow(ws, r, COLS,
    product ? `${PRODUCT_LABELS[product] ?? product} incentive rates and qualification rules`
            : 'Per-product incentive rates and qualification rules');
  r += 2;

  // Per-product agent rates (no team column — drink-up is team-level, shown separately below)
  addRow(ws, r, [
    hdr('PRODUCT'), hdr('VERIFIED (AT_LOCATION)', 'right'), hdr('UNVERIFIED', 'right'),
    hdr('CONVERTED', 'right'), hdr('TOP PERFORMER BONUS', 'right'), hdr('NOTES'),
  ]);
  r++;

  const allRows = [
    { product: 'CS',  pal: PAL.cs,  v: 250,   u: 0, c: 750,  tb: '+TZS 100/consent', n: 'Civil Servant agents' },
    { product: 'LBF', pal: PAL.lbf, v: 1500,  u: 0, c: 3500, tb: '+TZS 500/consent', n: 'Log Book Finance agents' },
    { product: 'SME', pal: PAL.sme, v: 1500,  u: 0, c: 3500, tb: '+TZS 500/consent', n: 'SME agents' },
  ];
  // Product-specific report → only that product's criteria row.
  const rows = product ? allRows.filter((row) => row.product === product) : allRows;
  rows.forEach((row, i) => {
    const bg = i % 2 === 0 ? 'FFFFFF' : PAL.alt;
    addRow(ws, r, [
      { v: PRODUCT_LABELS[row.product], t: 's', s: { font: F(true, row.pal.fg, 9), fill: FILL(row.pal.bg), alignment: A('center', true), border: BORDER } },
      numCell(row.v, true,  '166534', bg),
      numCell(row.u, false, '6B7280', bg),
      numCell(row.c, true,  '7C3AED', bg),
      cell(row.tb,   true,  '1F3864', 'left', 'FFFBEB'),
      cell(row.n,    false, '374151', 'left', bg),
    ]);
    r++;
  });

  // ── Team Drink-up — separate section, NOT per product ──────────────────
  r++;
  ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = {
    v: 'TEAM DRINK-UP AWARD (per-team, NOT per-product)', t: 's',
    s: { font: F(true, 'FFFFFF', 11), fill: FILL('166534'), alignment: A('left', false, 'center'), border: BORDER_MED },
  };
  mergeRow(ws, r, COLS);
  r++;
  addRow(ws, r, [
    hdr('CONDITION'), hdr('THRESHOLD', 'right'), hdr('AWARD (TZS)', 'right'),
    hdr('SCOPE'), hdr(''), hdr(''),
  ]);
  r++;
  addRow(ws, r, [
    cell('Total verified consents per TEAM', true, '1F3864', 'left', 'F0FDF4'),
    numCell(150,     true, '166534', 'F0FDF4'),
    numCell(200_000, true, '166534', 'F0FDF4'),
    cell('Applies to each TEAM (not each product). A team mixing CS + LBF agents qualifies once if its total verified ≥ 150.',
         false, '374151', 'left', 'F0FDF4'),
    cell('', false, '374151', 'left', 'F0FDF4'),
    cell('', false, '374151', 'left', 'F0FDF4'),
  ]);
  mergeRow(ws, r, COLS, 3);
  r++;

  // ── Conditions ─────────────────────────────────────────────────────────
  r++;
  const conds = [
    '• Approved Consent = Consent_Status is ACCEPTED.',
    '• Verified = field-verified via CRM agent_activity (Target_Met = AT_LOCATION on Consent_Date).',
    '• Unverified = ACCEPTED but no matching AT_LOCATION activity (office-only).',
    '• Converted = Lead.Name matched to Loan.Account Holder Name via fuzzy match ≥ 0.66 in the latest activation month. If the same client has loans by multiple sales reps, ALL reps are listed in the Sales Rep (Client) column.',
    '• Active = Last_Login within the last 90 days. NOT_ACTIVE agents are flagged but payouts are still computed for manager review.',
    '• Missing TEAM_NAME values in the Lead file are auto-back-filled from the agent\'s most-frequent team elsewhere in the file (Step 0).',
    '• TEAM DRINK-UP is the only TEAM-level bonus. All other rates above are PER-CONSENT, PER-AGENT.',
  ];
  conds.forEach((c) => {
    ws[XLSXStyle.utils.encode_cell({ r, c: 0 })] = {
      v: c, t: 's',
      s: { font: F(false, '374151', 9), fill: FILL('F9FAFB'), alignment: A('left', true), border: BORDER },
    };
    mergeRow(ws, r, COLS);
    r++;
  });

  setWidths(ws, [30, 22, 18, 36, 12, 12]);
  finaliseSheet(ws, r, COLS - 1);
  ws['!freeze'] = { ySplit: 4 };
  return ws;
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

export function buildConsentIncentiveReportBuffer(processedData) {
  const { summary, agents, teams, consents3m, consentsCurrent, converted, topPerformers, diagnostics } = processedData;
  const product = summary.product || null;   // set when the report is product-scoped

  const from = summary.threeMonthsFrom?.toLocaleDateString('en-GB') ?? '—';
  const to   = summary.threeMonthsTo?.toLocaleDateString('en-GB')   ?? '—';

  const wb = XLSXStyle.utils.book_new();
  XLSXStyle.utils.book_append_sheet(wb, buildProcedureSheet(diagnostics, summary),  'Procedure');
  XLSXStyle.utils.book_append_sheet(wb, buildSummarySheet(summary),                  'Summary');
  XLSXStyle.utils.book_append_sheet(wb, buildTeamSummarySheet(teams ?? []),          'Team Summary');
  XLSXStyle.utils.book_append_sheet(wb,
    buildConsentsSheetV2(consents3m, '3-MONTH ACCEPTED CONSENTS', `From ${from} to ${to}`),
    '3-Month Consents');
  XLSXStyle.utils.book_append_sheet(wb,
    buildConsentsSheetV2(consentsCurrent, 'CURRENT-MONTH ACCEPTED CONSENTS', summary.currentMonthLabel || '—'),
    'Current-Month');
  XLSXStyle.utils.book_append_sheet(wb, buildConvertedSheet(converted, summary),     '3-Month Converted');
  XLSXStyle.utils.book_append_sheet(wb, buildPricingSheet(agents, summary, topPerformers), 'Pricing');
  XLSXStyle.utils.book_append_sheet(wb, buildCriteriaSheet(product),                 'Criteria');

  const buffer  = XLSXStyle.write(wb, { type: 'array', bookType: 'xlsx' });
  const dateStr = new Date().toISOString().slice(0, 10);
  const tag     = product ? `${product}_` : '';
  return { buffer, fileName: `Consent_Incentive_Report_${tag}${dateStr}.xlsx` };
}

export function downloadConsentIncentiveReport(processedData) {
  const { buffer, fileName } = buildConsentIncentiveReportBuffer(processedData);
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary  = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fmtSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
