import React, { useEffect, useImperativeHandle, useMemo, useState, forwardRef } from 'react';
import * as XLSX from 'xlsx';
import './ManagementSummary.css';
import { useManagementData } from '../../../../../ManagementDashboard/hooks/useManagementData';
import { useMTDData } from '../../../../../MTDdashboard/hooks/useMTDData';
import { exportSingleSectionWithStyles } from '../../../../utils/excelExportStyled';
import { getReportsByDepartmentAndType, getReportFileUrl } from '../../../../../../../../services/reports';

const PRODUCTS = ['CS', 'LBF', 'SME', 'Agrifinance'];
const CRM_PRODUCTS = ['CS', 'LBF', 'SME'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const num = (v) => {
  if (v == null || v === '' || v === '-') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/,/g, '').replace('%', '').trim());
  return Number.isFinite(n) ? n : 0;
};
const dOf = (r) => {
  const d = new Date(r?.date || r?.createdAt || r?.created_at || '');
  return Number.isNaN(d.getTime()) ? null : d;
};
const mKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const yoy = (curr, prev) => (curr <= 0 && prev <= 0 ? null : prev <= 0 ? 100 : ((curr - prev) / prev) * 100);
const mom = (curr, prev) => (curr <= 0 && prev <= 0 ? null : prev <= 0 ? (curr > 0 ? 100 : null) : ((curr - prev) / prev) * 100);
const fmt = (v, dashZero = false) => (v == null || v === '-' || (dashZero && num(v) === 0) ? '-' : num(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
const fmtPct = (v) => (v == null ? '-' : `${num(v).toFixed(2)}%`);
const deltaText = (curr, prev) => {
  const diff = num(curr) - num(prev);
  const p = prev > 0 ? ((diff / prev) * 100) : (curr > 0 ? 100 : null);
  return p == null ? '-' : `${diff > 0 ? '+' : ''}${fmt(diff)} (${fmtPct(p)})`;
};
const deltaTextOrDash = (curr, prev, hasBase) => (hasBase ? deltaText(curr, prev) : '-');

const getPortfolio = (data = {}) => num(data.Portfolio ?? data.Portifolio ?? data['Outstanding Loan Book'] ?? data['Outstanding Portfolio'] ?? data['Loan Book'] ?? 0);
const getDisbursement = (data = {}) => num(data['Disbursements This Month'] ?? data['Disbursement This Month'] ?? data['Disbursement this Month'] ?? 0);

const extractCRMAgentCount = (wb) => {
  if (!wb?.SheetNames?.includes('Email')) return 0;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Email, { defval: '' });
  const map = {};
  rows.forEach((r) => {
    const k = String(r.Text ?? r.text ?? '').trim().toLowerCase();
    if (k) map[k] = r.Value ?? r.value ?? '';
  });
  const keys = ['total_count_agent', 'total_agent', 'today_total_agents', 'count_agent'];
  for (const k of keys) {
    const x = num(map[k]);
    if (x > 0) return x;
  }
  return 0;
};

const extractMTDActiveReps = (wb) => {
  if (!wb?.SheetNames?.length) return 0;
  let listingSheet = wb.SheetNames.find((n) => {
    const u = String(n || '').toUpperCase();
    return u.includes('LISTING') || u.includes('LISITING');
  });
  if (!listingSheet) listingSheet = wb.SheetNames[wb.SheetNames.length - 1];
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[listingSheet], { header: 1, defval: '' });
  if (!raw?.length) return 0;
  let headerIdx = 0;
  for (let i = 0; i < Math.min(8, raw.length); i++) {
    const row = raw[i] || [];
    const hasSalesRep = row.some((c) => ['SALES REP', 'SALES REP. NAME'].includes(String(c || '').toUpperCase().trim()));
    const hasTerm = row.some((c) => String(c || '').toUpperCase().trim() === 'TERM');
    if (hasSalesRep && hasTerm) {
      headerIdx = i;
      break;
    }
  }
  const headers = raw[headerIdx] || [];
  const repIdx = headers.findIndex((h) => ['SALES REP', 'SALES REP. NAME'].includes(String(h || '').toUpperCase().trim()));
  const termIdx = headers.findIndex((h) => String(h || '').toUpperCase().trim() === 'TERM');
  if (repIdx < 0 || termIdx < 0) return 0;
  const reps = new Set();
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i] || [];
    const rep = String(row[repIdx] || '').trim();
    const term = String(row[termIdx] || '').trim();
    if (rep && term) reps.add(rep.toUpperCase());
  }
  return reps.size;
};

const getMTDTotals = (parsedData) => {
  if (!parsedData) return null;
  const cm = parsedData.columnMap || {};
  const headers = Object.keys((parsedData.listingData || [])[0] || {});
  const termCol = cm.term || headers.find((h) => String(h).toUpperCase() === 'TERM');
  const salesRepCol = cm.salesRep || headers.find((h) => ['SALES REP', 'SALES REP. NAME'].includes(String(h).toUpperCase()));
  const gd = parsedData.groupedData || {};
  let allReps = [];
  Object.values(gd).forEach((sup) => sup.teamLeaders?.forEach((tl) => { allReps.push(...(tl.salesReps || [])); }));
  const activeReps = !salesRepCol ? 0 : new Set(
    allReps
      .filter((rep) => {
        const term = termCol ? (rep[termCol] ?? rep.Term ?? rep.TERM) : null;
        return term != null && String(term).trim() !== '';
      })
      .map((rep) => String(rep[salesRepCol] ?? rep['SALES REP'] ?? rep['SALES REP. NAME'] ?? '').trim())
      .filter(Boolean)
  ).size;
  const gt = parsedData.grandTotalRow || {};
  return {
    disbursement: num(gt.VALUE ?? gt.Value),
    noLoans: num(gt['NO. OF LOANS'] ?? gt['No. of Loans'] ?? gt['No. Of Loans']),
    activeReps
  };
};

const ManagementSummary = forwardRef((_, ref) => {
  const { parsedReports: managementReports } = useManagementData();
  const mtdCS = useMTDData('CS');
  const mtdLBF = useMTDData('LBF');
  const mtdSME = useMTDData('SME');
  const [crmByMonth, setCrmByMonth] = useState({ CS: {}, LBF: {}, SME: {} });
  const [mtdActiveByMonth, setMtdActiveByMonth] = useState({ CS: {}, LBF: {}, SME: {} });

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const out = { CS: {}, LBF: {}, SME: {} };
      for (const dept of CRM_PRODUCTS) {
        const res = await getReportsByDepartmentAndType(dept, 'CRM');
        if (!res?.success) continue;
        const sorted = (res.data || []).map((r) => ({ ...r, _d: dOf(r) })).filter((r) => r._d).sort((a, b) => b._d - a._d);
        const latestPerMonth = {};
        sorted.forEach((r) => {
          const k = mKey(r._d);
          if (!latestPerMonth[k]) latestPerMonth[k] = r;
        });
        for (const [mk, r] of Object.entries(latestPerMonth)) {
          try {
            const url = r.fileUrl || r.file_url || (r.filePath || r.file_path ? getReportFileUrl(r.filePath || r.file_path) : null);
            if (!url) continue;
            const rf = await fetch(url);
            if (!rf.ok) continue;
            const wb = XLSX.read(await rf.arrayBuffer(), { type: 'array', raw: false });
            out[dept][mk] = extractCRMAgentCount(wb);
          } catch {
            out[dept][mk] = 0;
          }
        }
      }
      if (!stop) setCrmByMonth(out);
    };
    load();
    return () => { stop = true; };
  }, []);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const out = { CS: {}, LBF: {}, SME: {} };
      for (const dept of CRM_PRODUCTS) {
        const res = await getReportsByDepartmentAndType(dept, 'MTD');
        if (!res?.success) continue;
        const sorted = (res.data || [])
          .map((r) => ({ ...r, _d: dOf(r) }))
          .filter((r) => r._d)
          .sort((a, b) => b._d - a._d);
        const latestPerMonth = {};
        sorted.forEach((r) => {
          const key = mKey(r._d);
          if (!latestPerMonth[key]) latestPerMonth[key] = r;
        });
        for (const [mk, r] of Object.entries(latestPerMonth)) {
          try {
            const url = r.fileUrl || r.file_url || (r.filePath || r.file_path ? getReportFileUrl(r.filePath || r.file_path) : null);
            if (!url) continue;
            const rf = await fetch(url);
            if (!rf.ok) continue;
            const wb = XLSX.read(await rf.arrayBuffer(), { type: 'array', raw: false });
            out[dept][mk] = extractMTDActiveReps(wb);
          } catch {
            out[dept][mk] = 0;
          }
        }
      }
      if (!stop) setMtdActiveByMonth(out);
    };
    load();
    return () => { stop = true; };
  }, []);

  const byYearMonth = useMemo(() => {
    const map = {};
    (managementReports || []).forEach((r) => {
      const d = dOf(r);
      if (!d) return;
      const y = d.getFullYear();
      const m = d.getMonth();
      if (!map[y]) map[y] = {};
      if (!map[y][m]) map[y][m] = r;
    });
    return map;
  }, [managementReports]);

  const latest = managementReports?.[0] || null;
  const currentYear = dOf(latest)?.getFullYear?.() ?? null;
  const previousYear = currentYear != null ? currentYear - 1 : null;

  const getProductData = (report, p) => {
    if (!report) return null;
    const data = p === 'CS' ? report.cs : p === 'LBF' ? report.lbf : p === 'SME' ? report.sme : (report.agrifinance || report.AgriFinance || {});
    if (!data || Object.keys(data).length === 0) return null;
    const active = num(data['Active clients'] ?? data['Active Clients']);
    const inactive = num(data['Inactive clients'] ?? data['Inactive Clients']);
    const total = num(data['Number of Clients'] ?? data['Number of clients'] ?? (active + inactive));
    return {
      active,
      inactive,
      total,
      target: num(data.Target ?? data['Monthly Target']),
      disbursement: getDisbursement(data),
      noLoans: num(data['Number of loans'] ?? data['Number of Loans'] ?? data['No. of Loans']),
      activeReps: num(data['Active Reps'] ?? data['Active reps']),
      portfolio: getPortfolio(data)
    };
  };

  const activeMonthIndexes = useMemo(() => {
    if (currentYear == null) return [];
    return Array.from({ length: 12 }, (_, m) => m).filter((m) => {
      const r = byYearMonth[currentYear]?.[m];
      if (!r) return false;
      const countryHas = getDisbursement(r.countrywise || {}) > 0 || getPortfolio(r.countrywise || {}) > 0;
      const productHas = PRODUCTS.some((p) => {
        const d = getProductData(r, p);
        return num(d?.disbursement) > 0 || num(d?.total) > 0 || num(d?.activeReps) > 0 || num(d?.portfolio) > 0;
      });
      return countryHas || productHas;
    });
  }, [byYearMonth, currentYear]);

  const disbursementRows = useMemo(() => {
    if (currentYear == null || previousYear == null) return [];
    return activeMonthIndexes.map((m) => {
      const prev = getDisbursement(byYearMonth[previousYear]?.[m]?.countrywise || {});
      const curr = getDisbursement(byYearMonth[currentYear]?.[m]?.countrywise || {});
      const prevMonthReport = m > 0 ? byYearMonth[currentYear]?.[m - 1] : byYearMonth[previousYear]?.[11];
      const hasPrevMonth = !!prevMonthReport;
      const prevMonthCurr = getDisbursement((prevMonthReport || {}).countrywise || {});
      return {
        Month: MONTHS[m],
        prev,
        curr,
        yoyText: deltaText(curr, prev),
        momText: deltaTextOrDash(curr, prevMonthCurr, hasPrevMonth),
        yoyValue: yoy(curr, prev),
        momValue: hasPrevMonth ? mom(curr, prevMonthCurr) : null
      };
    });
  }, [activeMonthIndexes, byYearMonth, currentYear, previousYear]);

  const salesRows = useMemo(() => {
    const report = latest;
    const rd = dOf(report);
    const mk = rd ? mKey(rd) : '';
    const mtd = { CS: getMTDTotals(mtdCS.parsedData), LBF: getMTDTotals(mtdLBF.parsedData), SME: getMTDTotals(mtdSME.parsedData) };
    return PRODUCTS.map((p) => {
      const d = getProductData(report, p);
      const disb = num(d?.disbursement);
      const target = num(d?.target);
      const noLoans = num(d?.noLoans);
      const activeReps = (p === 'CS' || p === 'LBF')
        ? num(mtd[p]?.activeReps)
        : num(d?.activeReps);
      const actual = p === 'Agrifinance' ? activeReps : num(crmByMonth[p]?.[mk]);
      return {
        Product: p,
        Target: target,
        Disbursement: disb,
        '% Achieved': target > 0 ? (disb / target) * 100 : 0,
        'No. Loans': noLoans,
        'Active Reps': activeReps,
        'Actual Reps (CRM)': actual
      };
    });
  }, [latest, mtdCS.parsedData, mtdLBF.parsedData, mtdSME.parsedData, crmByMonth]);

  const mtdByProduct = useMemo(() => ({
    CS: { totals: getMTDTotals(mtdCS.parsedData), key: mtdCS.parsedData?.reportDate ? mKey(new Date(mtdCS.parsedData.reportDate)) : '' },
    LBF: { totals: getMTDTotals(mtdLBF.parsedData), key: mtdLBF.parsedData?.reportDate ? mKey(new Date(mtdLBF.parsedData.reportDate)) : '' },
    SME: { totals: getMTDTotals(mtdSME.parsedData), key: mtdSME.parsedData?.reportDate ? mKey(new Date(mtdSME.parsedData.reportDate)) : '' }
  }), [mtdCS.parsedData, mtdLBF.parsedData, mtdSME.parsedData]);

  const activeRepsForMonth = (product, monthIndex, report) => {
    if (currentYear == null) return num(getProductData(report, product)?.activeReps);
    const mk = `${currentYear}-${String(monthIndex + 1).padStart(2, '0')}`;
    if (product === 'CS' || product === 'LBF' || product === 'SME') {
      const monthly = num(mtdActiveByMonth[product]?.[mk]);
      if (monthly > 0) return monthly;
      const fromCurrentParsed = mtdByProduct[product]?.key === mk ? num(mtdByProduct[product]?.totals?.activeReps) : 0;
      if (fromCurrentParsed > 0) return fromCurrentParsed;
      return num(getProductData(report, product)?.activeReps);
    }
    return num(getProductData(report, product)?.activeReps);
  };

  const salesTotals = useMemo(() => {
    const target = salesRows.reduce((s, r) => s + num(r.Target), 0);
    const disb = salesRows.reduce((s, r) => s + num(r.Disbursement), 0);
    return {
      Product: 'Total',
      Target: target,
      Disbursement: disb,
      '% Achieved': target > 0 ? (disb / target) * 100 : 0,
      'No. Loans': salesRows.reduce((s, r) => s + num(r['No. Loans']), 0),
      'Active Reps': salesRows.reduce((s, r) => s + num(r['Active Reps']), 0),
      'Actual Reps (CRM)': salesRows.reduce((s, r) => s + num(r['Actual Reps (CRM)']), 0)
    };
  }, [salesRows]);

  const clientRows = useMemo(() => {
    if (currentYear == null || previousYear == null) return [];
    const rows = [];
    activeMonthIndexes.forEach((m) => {
      const prevAgg = PRODUCTS.reduce((a, p) => {
        const d = getProductData(byYearMonth[previousYear]?.[m], p);
        a.active += num(d?.active); a.inactive += num(d?.inactive); a.total += num(d?.total);
        return a;
      }, { active: 0, inactive: 0, total: 0 });
      const currAgg = PRODUCTS.reduce((a, p) => {
        const d = getProductData(byYearMonth[currentYear]?.[m], p);
        a.active += num(d?.active); a.inactive += num(d?.inactive); a.total += num(d?.total);
        return a;
      }, { active: 0, inactive: 0, total: 0 });
      const prevMonthReport = m > 0 ? byYearMonth[currentYear]?.[m - 1] : byYearMonth[previousYear]?.[11];
      const hasPrevMonth = !!prevMonthReport;
      const prevMonthAgg = PRODUCTS.reduce((a, p) => {
        const d = getProductData(prevMonthReport, p);
        a.active += num(d?.active); a.inactive += num(d?.inactive); a.total += num(d?.total);
        return a;
      }, { active: 0, inactive: 0, total: 0 });
      const push = (type, key) => rows.push({
        Month: MONTHS[m],
        'Client Type': type,
        [`Count ${previousYear}`]: prevAgg[key],
        [`Count ${currentYear}`]: currAgg[key],
        yoyText: deltaText(currAgg[key], prevAgg[key]),
        momText: deltaTextOrDash(currAgg[key], prevMonthAgg[key], hasPrevMonth),
        rowType: type
      });
      push('Active', 'active');
      push('Inactive', 'inactive');
      push('Total', 'total');
    });
    return rows;
  }, [activeMonthIndexes, byYearMonth, currentYear, previousYear]);

  const repsRows = useMemo(() => {
    if (currentYear == null) return [];
    const rows = [];
    activeMonthIndexes.forEach((m) => {
      const report = byYearMonth[currentYear]?.[m];
      const prevReport = m > 0 ? byYearMonth[currentYear]?.[m - 1] : byYearMonth[previousYear]?.[11];
      const hasPrevMonth = !!prevReport;
      const mk = `${currentYear}-${String(m + 1).padStart(2, '0')}`;
      const pmk = m > 0 ? `${currentYear}-${String(m).padStart(2, '0')}` : `${previousYear}-12`;
      const active = PRODUCTS.reduce((s, p) => s + activeRepsForMonth(p, m, report), 0);
      const prevActive = PRODUCTS.reduce((s, p) => s + activeRepsForMonth(p, m - 1, prevReport), 0);
      const actual = PRODUCTS.reduce((s, p) => s + (p === 'Agrifinance' ? num(getProductData(report, p)?.activeReps) : num(crmByMonth[p]?.[mk])), 0);
      const prevActual = PRODUCTS.reduce((s, p) => s + (p === 'Agrifinance' ? num(getProductData(prevReport, p)?.activeReps) : num(crmByMonth[p]?.[pmk])), 0);
      rows.push({ Month: MONTHS[m], Category: 'Active Reps', Count: active, momText: deltaTextOrDash(active, prevActive, hasPrevMonth), rowType: 'Active Reps' });
      rows.push({ Month: MONTHS[m], Category: 'Actual Reps (CRM)', Count: actual, momText: deltaTextOrDash(actual, prevActual, hasPrevMonth), rowType: 'Actual Reps (CRM)' });
    });
    return rows;
  }, [activeMonthIndexes, byYearMonth, currentYear, crmByMonth, mtdByProduct, mtdActiveByMonth]);

  const portfolioRows = useMemo(() => {
    if (currentYear == null || previousYear == null) return [];
    return activeMonthIndexes.map((m) => {
      const prev = getPortfolio(byYearMonth[previousYear]?.[m]?.countrywise || {});
      const curr = getPortfolio(byYearMonth[currentYear]?.[m]?.countrywise || {});
      const prevMonthReport = m > 0 ? byYearMonth[currentYear]?.[m - 1] : byYearMonth[previousYear]?.[11];
      const hasPrevMonth = !!prevMonthReport;
      const prevM = getPortfolio((prevMonthReport || {}).countrywise || {});
      return {
        Month: MONTHS[m],
        prev,
        curr,
        yoyText: deltaText(curr, prev),
        momText: deltaTextOrDash(curr, prevM, hasPrevMonth)
      };
    });
  }, [activeMonthIndexes, byYearMonth, currentYear, previousYear]);

  const groupedMonthCells = (rows, groupSize) => rows.map((r, i) => ({ ...r, monthSpan: i % groupSize === 0 ? groupSize : 0, monthEnd: i % groupSize === groupSize - 1 }));
  const clientWebRows = useMemo(() => groupedMonthCells(clientRows, 3), [clientRows]);
  const repsWebRows = useMemo(() => groupedMonthCells(repsRows, 2), [repsRows]);

  const buildMonthMerge = (rows, groupSize) => {
    const out = [];
    for (let i = 0; i < rows.length; i += groupSize) {
      if (rows[i]) out.push({ startRow: i, endRow: Math.min(i + groupSize - 1, rows.length - 1), col: 0 });
    }
    return out;
  };

  const sheetRowsForProduct = (product) => {
    const client = [];
    const reps = [];
    const port = [];
    activeMonthIndexes.forEach((m) => {
      const curr = getProductData(byYearMonth[currentYear]?.[m], product);
      const prev = getProductData(byYearMonth[previousYear]?.[m], product);
      const prevMReport = m > 0 ? byYearMonth[currentYear]?.[m - 1] : byYearMonth[previousYear]?.[11];
      const hasPrevMonth = !!prevMReport;
      const prevM = getProductData(prevMReport, product);
      [['Active', 'active'], ['Inactive', 'inactive'], ['Total', 'total']].forEach(([label, key]) => {
        const cv = num(curr?.[key]);
        const pv = num(prev?.[key]);
        const pm = num(prevM?.[key]);
        client.push({ Month: MONTHS[m], 'Client Type': label, [`Count ${previousYear}`]: pv, [`Count ${currentYear}`]: cv, 'Change (YoY)': deltaText(cv, pv), 'Change (MoM)': deltaTextOrDash(cv, pm, hasPrevMonth), __rowType: label });
      });
      const mk = `${currentYear}-${String(m + 1).padStart(2, '0')}`;
      const pmk = m > 0 ? `${currentYear}-${String(m).padStart(2, '0')}` : `${previousYear}-12`;
      const active = activeRepsForMonth(product, m, byYearMonth[currentYear]?.[m]);
      const prevActive = activeRepsForMonth(product, m - 1, byYearMonth[currentYear]?.[m - 1]);
      const actual = product === 'Agrifinance' ? active : num(crmByMonth[product]?.[mk]);
      const prevActual = product === 'Agrifinance' ? prevActive : num(crmByMonth[product]?.[pmk]);
      reps.push({ Month: MONTHS[m], Category: 'Active Reps', Count: active, 'Change (MoM)': deltaTextOrDash(active, prevActive, hasPrevMonth), __rowType: 'Active' });
      reps.push({ Month: MONTHS[m], Category: 'Actual Reps (CRM)', Count: actual, 'Change (MoM)': deltaTextOrDash(actual, prevActual, hasPrevMonth), __rowType: 'Actual' });
      const pCurr = num(curr?.portfolio);
      const pPrev = num(prev?.portfolio);
      const pPrevM = num(prevM?.portfolio);
      port.push({ Month: MONTHS[m], [`Portfolio ${previousYear}`]: pPrev, [`Portfolio ${currentYear}`]: pCurr, 'Change (YoY)': deltaText(pCurr, pPrev), 'Change (MoM)': deltaTextOrDash(pCurr, pPrevM, hasPrevMonth) });
    });
    return { client, reps, port };
  };

  const getExportSheets = () => {
    const disbData = disbursementRows.map((r) => ({
      Month: r.Month,
      [`Disbursement ${previousYear}`]: r.prev || '-',
      [`Disbursement ${currentYear}`]: r.curr || '-',
      'Percentage Change (YoY)': r.yoyText,
      'Percentage Change (MoM)': r.momText
    }));
    const clientData = clientRows.map((r) => ({
      Month: r.Month,
      'Client Type': r['Client Type'],
      [`Count ${previousYear}`]: r[`Count ${previousYear}`],
      [`Count ${currentYear}`]: r[`Count ${currentYear}`],
      'Change (YoY)': r.yoyText,
      'Change (MoM)': r.momText
    }));
    const repsData = repsRows.map((r) => ({ Month: r.Month, Category: r.Category, Count: r.Count, 'Change (MoM)': r.momText }));
    const portData = portfolioRows.map((r) => ({ Month: r.Month, [`Portfolio ${previousYear}`]: r.prev || '-', [`Portfolio ${currentYear}`]: r.curr || '-', 'Change (YoY)': r.yoyText, 'Change (MoM)': r.momText }));
    const salesData = [...salesRows, { __separator: true }, { ...salesTotals, __totalRow: true }];

    const styleColor = (type) => type === 'Active' ? '#F3FBF4' : type === 'Inactive' ? '#FEF8F2' : '#F3F8FF';
    const clientRowFills = clientRows.map((r) => styleColor(r.rowType));
    const repsRowFills = repsRows.map((r) => (r.rowType === 'Active Reps' ? '#F3FBF4' : '#F3F8FF'));

    const monthSeparatorRowsClient = clientData.map((_, idx) => idx).filter((i) => (i + 1) % 3 === 0);
    const monthSeparatorRowsReps = repsData.map((_, idx) => idx).filter((i) => (i + 1) % 2 === 0);

    const sheets = [{
      name: 'Management Summary',
      tables: [
        { title: 'Sales', data: salesData, colWidths: [14, 14, 14, 12, 12, 12, 14], headerColors: { Product: '#4472C4', Target: '#ED7D31', Disbursement: '#ED7D31', '% Achieved': '#ED7D31', 'No. Loans': '#ED7D31', 'Active Reps': '#ED7D31', 'Actual Reps (CRM)': '#5B9BD5' }, accountingColumns: ['Target', 'Disbursement', 'No. Loans', 'Active Reps', 'Actual Reps (CRM)'], totalRowIndices: salesData.map((r, i) => r.__totalRow ? i : null).filter((x) => x != null) },
        { title: `Monthly Disbursement Trend ${currentYear} Vs ${previousYear}`, data: disbData, colWidths: [18, 18, 18, 22, 22], headerColors: { Month: '#4472C4', [`Disbursement ${previousYear}`]: '#ED7D31', [`Disbursement ${currentYear}`]: '#70AD47', 'Percentage Change (YoY)': '#2E5090', 'Percentage Change (MoM)': '#2E5090' }, accountingColumns: [`Disbursement ${previousYear}`, `Disbursement ${currentYear}`], pctChangeColumns: ['Percentage Change (YoY)', 'Percentage Change (MoM)'] },
        { title: `Client Growth Trend ${currentYear} Vs ${previousYear}`, data: clientData, colWidths: [14, 14, 14, 14, 18, 18], headerColors: { Month: '#4472C4', 'Client Type': '#2E5090', [`Count ${previousYear}`]: '#ED7D31', [`Count ${currentYear}`]: '#70AD47', 'Change (YoY)': '#2E5090', 'Change (MoM)': '#2E5090' }, rowFillColors: clientRowFills, mergeCells: buildMonthMerge(clientData, 3), monthSeparatorRows: monthSeparatorRowsClient, pctChangeColumns: ['Change (YoY)', 'Change (MoM)'] },
        { title: `Sales Reps Growth Trend ${currentYear}`, data: repsData, colWidths: [14, 18, 12, 22], headerColors: { Month: '#4472C4', Category: '#2E5090', Count: '#70AD47', 'Change (MoM)': '#2E5090' }, rowFillColors: repsRowFills, mergeCells: buildMonthMerge(repsData, 2), monthSeparatorRows: monthSeparatorRowsReps, pctChangeColumns: ['Change (MoM)'] },
        { title: `Outstanding Loan Book (Portfolio) Trend ${currentYear} Vs ${previousYear}`, data: portData, colWidths: [18, 20, 20, 22, 22], headerColors: { Month: '#4472C4', [`Portfolio ${previousYear}`]: '#ED7D31', [`Portfolio ${currentYear}`]: '#70AD47', 'Change (YoY)': '#2E5090', 'Change (MoM)': '#2E5090' }, accountingColumns: [`Portfolio ${previousYear}`, `Portfolio ${currentYear}`], pctChangeColumns: ['Change (YoY)', 'Change (MoM)'] }
      ]
    }];

    const clientTrackerTables = [];
    const repTrackerTables = [];
    const portTrackerTables = [];
    PRODUCTS.forEach((p) => {
      const rows = sheetRowsForProduct(p);
      const cFills = rows.client.map((r) => styleColor(r.__rowType));
      const rFills = rows.reps.map((r) => (r.__rowType === 'Active' ? '#F3FBF4' : '#F3F8FF'));
      const trackerClientData = rows.client.map(({ __rowType, ...rest }) => rest);
      const trackerRepsData = rows.reps.map(({ __rowType, ...rest }) => rest);
      clientTrackerTables.push({ title: `${p} - Client Movement`, data: trackerClientData, colWidths: [14, 14, 14, 14, 18, 18], headerColors: { Month: '#4472C4', 'Client Type': '#2E5090', [`Count ${previousYear}`]: '#ED7D31', [`Count ${currentYear}`]: '#70AD47', 'Change (YoY)': '#2E5090', 'Change (MoM)': '#2E5090' }, rowFillColors: cFills, mergeCells: buildMonthMerge(rows.client, 3), monthSeparatorRows: trackerClientData.map((_, idx) => idx).filter((i) => (i + 1) % 3 === 0), pctChangeColumns: ['Change (YoY)', 'Change (MoM)'] });
      repTrackerTables.push({ title: `${p} - Sales Reps Growth`, data: trackerRepsData, colWidths: [14, 18, 12, 22], headerColors: { Month: '#4472C4', Category: '#2E5090', Count: '#70AD47', 'Change (MoM)': '#2E5090' }, rowFillColors: rFills, mergeCells: buildMonthMerge(rows.reps, 2), monthSeparatorRows: trackerRepsData.map((_, idx) => idx).filter((i) => (i + 1) % 2 === 0), pctChangeColumns: ['Change (MoM)'] });
      portTrackerTables.push({ title: `${p} - Portfolio Breakdown`, data: rows.port, colWidths: [14, 18, 18, 22, 22], headerColors: { Month: '#4472C4', [`Portfolio ${previousYear}`]: '#ED7D31', [`Portfolio ${currentYear}`]: '#70AD47', 'Change (YoY)': '#2E5090', 'Change (MoM)': '#2E5090' }, accountingColumns: [`Portfolio ${previousYear}`, `Portfolio ${currentYear}`], pctChangeColumns: ['Change (YoY)', 'Change (MoM)'] });
    });

    sheets.push({ name: 'Client Movement Tracker', tables: clientTrackerTables });
    sheets.push({ name: 'Sales Reps Growth Tracker', tables: repTrackerTables });
    sheets.push({ name: 'Portfolio Breakdown trend', tables: portTrackerTables });
    return sheets;
  };

  useImperativeHandle(ref, () => ({ getExportSheets }), [managementReports, crmByMonth, mtdCS.parsedData, mtdLBF.parsedData, mtdSME.parsedData]);

  return (
    <div className="ms-container">
      <div className="ms-header">
        <h3 className="ms-title">MANAGEMENT SUMMARY</h3>
        <span className="ms-badge">Latest week</span>
      </div>
      <div className="ms-tables">
        <div className="ms-table-block">
          <h4 className="ms-table-title">Sales</h4>
          <table className="ms-table">
            <thead><tr><th className="ms-th-product">Product</th><th className="ms-th-orange">Target</th><th className="ms-th-orange">Disbursement</th><th className="ms-th-orange">% Achieved</th><th className="ms-th-orange">No. Loans</th><th className="ms-th-orange">Active Reps</th><th className="ms-th-source">Actual Reps (CRM)</th></tr></thead>
            <tbody>
              {salesRows.map((r, i) => <tr key={i}><td>{r.Product}</td><td>{fmt(r.Target)}</td><td>{fmt(r.Disbursement)}</td><td>{fmtPct(r['% Achieved'])}</td><td>{fmt(r['No. Loans'])}</td><td>{fmt(r['Active Reps'])}</td><td>{fmt(r['Actual Reps (CRM)'])}</td></tr>)}
              <tr className="ms-separator"><td colSpan="7"></td></tr>
              <tr className="ms-total-row"><td>{salesTotals.Product}</td><td>{fmt(salesTotals.Target)}</td><td>{fmt(salesTotals.Disbursement)}</td><td>{fmtPct(salesTotals['% Achieved'])}</td><td>{fmt(salesTotals['No. Loans'])}</td><td>{fmt(salesTotals['Active Reps'])}</td><td>{fmt(salesTotals['Actual Reps (CRM)'])}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="ms-table-block">
          <h4 className="ms-table-title">Monthly Disbursement Trend {currentYear} Vs {previousYear}</h4>
          <table className="ms-table">
            <thead><tr><th className="ms-th-product">Month</th><th className="ms-th-orange">{`Disbursement ${previousYear}`}</th><th className="ms-th-orange">{`Disbursement ${currentYear}`}</th><th className="ms-th-orange">Percentage Change (YoY)</th><th className="ms-th-orange">Percentage Change (MoM)</th></tr></thead>
            <tbody>
              {disbursementRows.map((r, i) => (
                <tr key={i} className={r.monthEnd ? 'ms-month-separator-row' : ''}>
                  <td>{r.Month}</td>
                  <td>{fmt(r.prev, true)}</td>
                  <td>{fmt(r.curr, true)}</td>
                  <td className={r.yoyText.startsWith('-') ? 'ms-pct-red' : r.yoyText === '-' ? 'ms-pct-neutral' : 'ms-pct-green'}>{r.yoyText}</td>
                  <td className={r.momText.startsWith('-') ? 'ms-pct-red' : r.momText === '-' ? 'ms-pct-neutral' : 'ms-pct-green'}>{r.momText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ms-table-block">
          <h4 className="ms-table-title">Client Growth Trend {currentYear} Vs {previousYear}</h4>
          <table className="ms-table">
            <thead><tr><th className="ms-th-product">Month</th><th className="ms-th-green">Client Type</th><th className="ms-th-orange">{`Count ${previousYear}`}</th><th className="ms-th-orange">{`Count ${currentYear}`}</th><th className="ms-th-orange">Change (YoY)</th><th className="ms-th-orange">Change (MoM)</th></tr></thead>
            <tbody>
              {clientWebRows.map((r, i) => (
                <tr key={i} className={r.monthEnd ? 'ms-month-separator-row' : ''}>
                  {r.monthSpan > 0 && <td rowSpan={r.monthSpan} className="ms-month-merged">{r.Month}</td>}
                  <td className={r.rowType === 'Active' ? 'ms-row-active' : r.rowType === 'Inactive' ? 'ms-row-inactive' : 'ms-row-total-type'}>{r['Client Type']}</td>
                  <td>{fmt(r[`Count ${previousYear}`], true)}</td>
                  <td>{fmt(r[`Count ${currentYear}`], true)}</td>
                  <td className={r.yoyText.startsWith('-') ? 'ms-pct-red' : r.yoyText === '-' ? 'ms-pct-neutral' : 'ms-pct-green'}>{r.yoyText}</td>
                  <td className={r.momText.startsWith('-') ? 'ms-pct-red' : r.momText === '-' ? 'ms-pct-neutral' : 'ms-pct-green'}>{r.momText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ms-table-block">
          <h4 className="ms-table-title">Sales Reps Growth Trend {currentYear}</h4>
          <table className="ms-table">
            <thead><tr><th className="ms-th-product">Month</th><th className="ms-th-source">Category</th><th className="ms-th-green">Count</th><th className="ms-th-orange">Change (MoM)</th></tr></thead>
            <tbody>
              {repsWebRows.map((r, i) => (
                <tr key={i} className={r.monthEnd ? 'ms-month-separator-row' : ''}>
                  {r.monthSpan > 0 && <td rowSpan={r.monthSpan} className="ms-month-merged">{r.Month}</td>}
                  <td className={r.rowType === 'Active Reps' ? 'ms-row-active' : 'ms-row-total-type'}>{r.Category}</td>
                  <td>{fmt(r.Count)}</td>
                  <td className={r.momText.startsWith('-') ? 'ms-pct-red' : r.momText === '-' ? 'ms-pct-neutral' : 'ms-pct-green'}>{r.momText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ms-table-block">
          <h4 className="ms-table-title">Outstanding Loan Book (Portfolio) Trend {currentYear} Vs {previousYear}</h4>
          <table className="ms-table">
            <thead><tr><th className="ms-th-product">Month</th><th className="ms-th-orange">{`Portfolio ${previousYear}`}</th><th className="ms-th-orange">{`Portfolio ${currentYear}`}</th><th className="ms-th-orange">Change (YoY)</th><th className="ms-th-orange">Change (MoM)</th></tr></thead>
            <tbody>
              {portfolioRows.map((r, i) => <tr key={i}><td>{r.Month}</td><td>{fmt(r.prev, true)}</td><td>{fmt(r.curr, true)}</td><td className={r.yoyText.startsWith('-') ? 'ms-pct-red' : r.yoyText === '-' ? 'ms-pct-neutral' : 'ms-pct-green'}>{r.yoyText}</td><td className={r.momText.startsWith('-') ? 'ms-pct-red' : r.momText === '-' ? 'ms-pct-neutral' : 'ms-pct-green'}>{r.momText}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <div className="ms-footer">
        <button className="ms-export-btn" onClick={() => exportSingleSectionWithStyles(getExportSheets()[0], 'Management_Summary')} title="Download as Excel">📥</button>
      </div>
    </div>
  );
});

ManagementSummary.displayName = 'ManagementSummary';
export default ManagementSummary;

