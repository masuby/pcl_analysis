/**
 * Parse CRM upload workbooks (CS_CRM_*.xlsx, LBF_CRM_*.xlsx) "summary" sheet:
 * Branch or Zone column + "Actual Agent(s)" column — authoritative Actual Reps for Sales Review supervision table.
 */
import * as XLSX from 'xlsx';

function normKey(s) {
  return String(s ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Strip dept prefix and collapse synonyms so e.g. "LBF - Call Centre" matches "CALL CENTER".
 * @param {string} s
 * @returns {string} alphanumeric-only comparable token
 */
export function canonicalLocationKey(s) {
  let x = normKey(s);
  x = x.replace(/^(cs|lbf|sme)\s*[-–—]\s*/i, '');
  x = x.replace(/^lbf\s+/i, '').replace(/^cs\s+/i, '').replace(/^sme\s+/i, '');
  x = x.replace(/\b(call\s+centre|call\s+center|callcentre|call\s*center)\b/gi, 'callcenter');
  x = x.replace(/\bzanzibar\s*zone\b/gi, 'zanzibar');
  x = x.replace(/\bcentre\b/g, 'center');
  x = x.replace(/\s+/g, '');
  x = x.replace(/[^a-z0-9]+/g, '');
  return x;
}

function stripDeptPrefix(x) {
  return String(x ?? '')
    .replace(/^(cs|lbf|sme)\s*[-–—]\s*/i, '')
    .replace(/^lbf\s+/i, '')
    .replace(/^cs\s+/i, '')
    .replace(/^sme\s+/i, '')
    .trim();
}

/**
 * @param {ArrayBuffer} ab
 * @returns {{ branch: string, actual: number }[]}
 */
export function parseCrmSummaryActualAgents(ab) {
  if (!ab) return [];
  let wb;
  try {
    wb = XLSX.read(ab, { type: 'array', cellDates: false });
  } catch {
    return [];
  }
  const sheetName = wb.SheetNames.find((n) => String(n).toLowerCase() === 'summary');
  if (!sheetName) return [];

  const allData = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  if (!allData?.length) return [];

  let headerRowIdx = -1;
  let branchCol = -1;
  let actualCol = -1;

  const scanLimit = Math.min(allData.length, 30);
  for (let r = 0; r < scanLimit; r++) {
    const row = allData[r] || [];
    const cells = row.map((c) => String(c ?? '').trim());
    const upper = cells.map((c) => c.toUpperCase());

    const branchIdx = upper.findIndex(
      (h) => h === 'BRANCH' || h === 'ZONE' || (h.includes('BRANCH') && h.length < 40) || (h.includes('ZONE') && h.length < 40)
    );
    const actualIdx = upper.findIndex(
      (h) => h === 'ACTUAL AGENTS' || h === 'ACTUAL AGENT' || (h.includes('ACTUAL') && h.includes('AGENT'))
    );

    if (branchIdx >= 0 && actualIdx >= 0) {
      headerRowIdx = r;
      branchCol = branchIdx;
      actualCol = actualIdx;
      break;
    }
  }

  if (headerRowIdx < 0 || branchCol < 0 || actualCol < 0) return [];

  const out = [];
  for (let r = headerRowIdx + 1; r < allData.length; r++) {
    const row = allData[r] || [];
    const branchRaw = row[branchCol];
    const branch = branchRaw != null ? String(branchRaw).replace(/\u00a0/g, ' ').trim() : '';
    if (!branch) continue;

    const bLower = branch.toLowerCase();
    if (bLower === 'total' || bLower === 'grand total' || bLower === 'sum') break;

    const rawVal = row[actualCol];
    const n = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal ?? '').replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;

    out.push({ branch, actual: Math.round(n) });
  }

  return out;
}

/**
 * Build a matcher: supervision name (MTD) -> CRM Actual Agents count.
 * @param {{ branch: string, actual: number }[]} entries
 * @returns {(supervisionName: string) => number | null}
 */
export function buildCrmActualAgentsLookup(entries) {
  if (!entries?.length) {
    return () => null;
  }

  const list = entries.map((e) => ({
    branch: e.branch,
    norm: normKey(e.branch),
    canon: canonicalLocationKey(e.branch),
    actual: e.actual
  }));

  const byNorm = new Map();
  /** @type {Map<string, number>} */
  const byCanonical = new Map();
  list.forEach((e) => {
    if (e.norm) byNorm.set(e.norm, e.actual);
    if (e.canon) {
      const prev = byCanonical.get(e.canon);
      byCanonical.set(e.canon, prev == null ? e.actual : Math.max(prev, e.actual));
    }
  });

  return (supervisionName) => {
    const s = normKey(supervisionName);
    if (!s) return null;
    if (byNorm.has(s)) return byNorm.get(s);

    const sCanon = canonicalLocationKey(supervisionName);
    if (sCanon && byCanonical.has(sCanon)) return byCanonical.get(sCanon);

    const sStripped = stripDeptPrefix(s);
    if (sStripped && byNorm.has(sStripped)) return byNorm.get(sStripped);
    const strippedCanon = canonicalLocationKey(sStripped);
    if (strippedCanon && byCanonical.has(strippedCanon)) return byCanonical.get(strippedCanon);

    for (const e of list) {
      if (!e.norm) continue;
      if (s === e.norm || sStripped === e.norm) return e.actual;
      if (e.canon && sCanon && (e.canon === sCanon || e.canon === strippedCanon)) return e.actual;
      if (s.includes(e.norm) || e.norm.includes(s)) return e.actual;
      const eb = stripDeptPrefix(e.norm);
      if (eb && (s.includes(eb) || eb.includes(s) || sStripped.includes(eb) || eb.includes(sStripped))) {
        return e.actual;
      }
      const eCanon = e.canon;
      if (eCanon && sCanon && (sCanon.includes(eCanon) || eCanon.includes(sCanon)) && Math.min(sCanon.length, eCanon.length) >= 6) {
        return e.actual;
      }
    }

    let best = null;
    let bestScore = 0;
    for (const e of list) {
      if (!e.norm) continue;
      const a = sStripped || s;
      const b = e.norm;
      let score = 0;
      if (a.length >= 4 && b.length >= 4) {
        if (a.includes(b) || b.includes(a)) score = Math.min(a.length, b.length);
      }
      if (score > bestScore) {
        bestScore = score;
        best = e.actual;
      }
    }
    return bestScore > 0 ? best : null;
  };
}
