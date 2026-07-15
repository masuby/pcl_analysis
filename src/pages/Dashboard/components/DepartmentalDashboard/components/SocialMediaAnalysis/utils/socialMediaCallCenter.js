/**
 * Social Media Analysis — Call Centre call-volume aggregator
 *
 * The Agent Performance sheet needs *real* call figures (Total calls made,
 * Calls per agent, Successful, Success rate). Those do NOT live in the social
 * media Google Sheets — they come from the daily Call Centre reports
 * (FINAL_CDR_CALL_REPORT_*.xlsx) that power the Call Center Performance Tracker
 * / Score Card. Conversion figures (Converted, Conv %, Sales, New, Repeat)
 * keep coming from the social media sheet.
 *
 * This module fetches those daily reports for CS / LBF / SME, parses each
 * workbook (All_Call_Data + Agent_Performance), and buckets the calls by
 * *week of month* so they line up with the social media weeks (week 1 = days
 * 1-7, week 2 = days 8-14, …). It exposes weekly and cumulative accessors.
 *
 * Output shape:
 *   {
 *     byProduct: {
 *       CS:  { byWeek: { 1: ccBucket, 2: ccBucket, … }, total: ccBucket },
 *       LBF: { … },
 *       SME: { … },
 *     },
 *     overall:   { byWeek: { … }, total: ccBucket },
 *   }
 *
 * where ccBucket = { totalCalls, successfulCalls, agentSet: Set<name> }.
 */

import * as XLSX from 'xlsx';
import { getReportsByDepartmentAndType, getReportFileUrl } from '../../../../../../../services/reports';
import { calculateMetrics } from '../../../../CallCenterDashboard/utils/callCenterUtils';

const CC_PRODUCTS = ['CS', 'LBF', 'SME'];
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function emptyBucket() {
  return { totalCalls: 0, successfulCalls: 0, agentSet: new Set() };
}

function weekOfMonth(d) {
  return Math.min(5, Math.ceil(d.getUTCDate() / 7));
}

// Fold one parsed daily report into a bucket.
function bumpBucket(bucket, metrics, agentPerf) {
  bucket.totalCalls += metrics.totalCalls || 0;
  bucket.successfulCalls += metrics.successfulCalls || 0;
  (agentPerf || []).forEach((a) => {
    const calls = parseInt(a['Total Calls'] || a['Total_Calls'] || 0, 10) || 0;
    if (calls <= 0) return;
    const name = normName(a['Agent Name'] || a['Agent_Name']);
    if (name) bucket.agentSet.add(name);
  });
}

/**
 * Parse "MAY 2026 SHEET" / "MAY 2026" → { month: 4, year: 2026 } (month 0-based).
 * Returns null if it can't be parsed (caller then keeps every month).
 */
export function parseMonthFromPeriod(period) {
  if (!period) return null;
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];
  const s = String(period).toLowerCase();
  const monthIdx = MONTHS.findIndex((m) => s.includes(m));
  const yearMatch = s.match(/(20\d{2})/);
  if (monthIdx === -1 || !yearMatch) return null;
  return { month: monthIdx, year: Number(yearMatch[1]) };
}

/**
 * Fetch + parse all daily Call Centre reports for CS/LBF/SME and bucket by
 * week of month. `target` (from parseMonthFromPeriod) restricts to the report
 * month; pass null to include every report found.
 *
 * Best-effort: any fetch/parse failure for a single file is skipped silently
 * so the report still generates from whatever data is available.
 */
export async function buildCallCenterAggregate(target) {
  const result = {
    byProduct: Object.fromEntries(CC_PRODUCTS.map((p) => [p, { byWeek: {}, total: emptyBucket() }])),
    overall: { byWeek: {}, total: emptyBucket() },
    effMonth: null,
  };

  // ── Pass 1: list call-centre report files per product, with dates ─────────
  // Match the common "CALL_REPORT" substring so both the old
  // (FINAL_CDR_CALL_REPORT_*) and new (CALL_REPORT_*) names are discovered.
  const perProduct = {};
  await Promise.all(CC_PRODUCTS.map(async (product) => {
    perProduct[product] = [];
    let res;
    try { res = await getReportsByDepartmentAndType(product, 'CALL CENTER'); } catch { return; }
    if (!res?.success || !Array.isArray(res.data)) return;
    perProduct[product] = res.data
      .filter((r) => (r.fileName || r.file_name || r.title || '').includes('CALL_REPORT'))
      .map((r) => {
        const raw = r.date || r.created_at || r.createdAt;
        const jd = raw ? new Date(raw) : null;
        if (!jd || Number.isNaN(jd.getTime())) return null;
        // Normalise to a UTC date so week-of-month lines up with the social side.
        return { report: r, date: new Date(Date.UTC(jd.getFullYear(), jd.getMonth(), jd.getDate())) };
      })
      .filter(Boolean);
  }));

  // ── Decide the effective month ────────────────────────────────────────────
  // Prefer the social-media report month; if no call-centre reports fall in it
  // (e.g. the only files uploaded are from another month), use the latest month
  // that DOES have reports so the call figures still populate.
  const all = CC_PRODUCTS.flatMap((p) => perProduct[p]);
  let eff = null;
  if (target && all.some((x) => x.date.getUTCMonth() === target.month && x.date.getUTCFullYear() === target.year)) {
    eff = target;
  } else if (all.length) {
    const latest = all.reduce((m, x) => (x.date > m ? x.date : m), all[0].date);
    eff = { month: latest.getUTCMonth(), year: latest.getUTCFullYear() };
  }
  result.effMonth = eff;
  if (!eff) return result;   // no call-centre reports at all

  // ── Pass 2: fetch + parse + bucket the effective month's reports ──────────
  await Promise.all(CC_PRODUCTS.map(async (product) => {
    for (const { report, date } of perProduct[product]) {
      if (date.getUTCMonth() !== eff.month || date.getUTCFullYear() !== eff.year) continue;
      const week = weekOfMonth(date);

      let url = report.fileUrl || report.file_url;
      if (!url && (report.filePath || report.file_path)) {
        try { url = await getReportFileUrl(report.filePath || report.file_path); } catch { continue; }
      }
      if (!url) continue;

      let wb;
      try {
        const rf = await fetch(url);
        if (!rf.ok) continue;
        wb = XLSX.read(await rf.arrayBuffer(), { type: 'array', raw: false });
      } catch {
        continue;
      }

      const allCall = wb.SheetNames.includes('All_Call_Data')
        ? XLSX.utils.sheet_to_json(wb.Sheets['All_Call_Data']) : [];
      const agentPerf = wb.SheetNames.includes('Agent_Performance')
        ? XLSX.utils.sheet_to_json(wb.Sheets['Agent_Performance']) : [];
      if (!allCall.length && !agentPerf.length) continue;

      const metrics = calculateMetrics(allCall);

      const prodNode = result.byProduct[product];
      bumpBucket(prodNode.byWeek[week] ??= emptyBucket(), metrics, agentPerf);
      bumpBucket(prodNode.total, metrics, agentPerf);
      bumpBucket(result.overall.byWeek[week] ??= emptyBucket(), metrics, agentPerf);
      bumpBucket(result.overall.total, metrics, agentPerf);
    }
  }));

  return result;
}

// ── Accessors used by the export ────────────────────────────────────────────

/** Flatten a bucket to plain numbers ({ totalCalls, successfulCalls, agents }). */
function flatten(bucket) {
  if (!bucket) return null;
  return {
    totalCalls: bucket.totalCalls,
    successfulCalls: bucket.successfulCalls,
    agents: bucket.agentSet ? bucket.agentSet.size : 0,
  };
}

/**
 * Get call figures for a node ({ byWeek, total }) for a given week.
 *   mode === 'cumulative' → union/sum of all weeks ≤ `week`
 *   otherwise             → that single week only
 * Returns null when there's no data for the requested slice.
 */
export function ccAgg(node, weeks, week, mode) {
  if (!node) return null;
  if (mode === 'cumulative') {
    const set = new Set();
    let tc = 0, sc = 0, seen = false;
    weeks.forEach((w) => {
      if (w > week) return;
      const b = node.byWeek[w];
      if (!b) return;
      seen = true;
      tc += b.totalCalls;
      sc += b.successfulCalls;
      b.agentSet.forEach((x) => set.add(x));
    });
    return seen ? { totalCalls: tc, successfulCalls: sc, agents: set.size } : null;
  }
  return flatten(node.byWeek[week]);
}

/** Month-total call figures for a node. */
export function ccTotal(node) {
  if (!node) return null;
  const f = flatten(node.total);
  return (f && (f.totalCalls > 0 || f.agents > 0)) ? f : null;
}

/** True when the aggregate carries any usable call data. */
export function hasCallCenterData(cc) {
  if (!cc) return false;
  const t = ccTotal(cc.overall);
  return Boolean(t && (t.totalCalls > 0 || t.agents > 0));
}
