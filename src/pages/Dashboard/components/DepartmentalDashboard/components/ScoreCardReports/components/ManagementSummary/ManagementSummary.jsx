import React, { useMemo, useImperativeHandle, forwardRef } from 'react';
import './ManagementSummary.css';
import { useManagementData } from '../../../../../ManagementDashboard/hooks/useManagementData';
import { useMTDData } from '../../../../../MTDdashboard/hooks/useMTDData';
import { exportSingleSectionWithStyles } from '../../../../utils/excelExportStyled';

const MAIN_PRODUCTS = ['CS', 'LBF', 'SME', 'Agrifinance'];

/** Get disbursement, no. of loans, and active reps from MTD parsedData. Target is not from MTD (use management). */
const getMTDTotals = (parsedData) => {
  if (!parsedData) return null;
  const columnMap = parsedData.columnMap || {};
  const listingHeadersArr = Object.keys((parsedData.listingData || [])[0] || {});
  const termCol = columnMap.term || listingHeadersArr.find(k => String(k).toUpperCase() === 'TERM');
  const salesRepCol = columnMap.salesRep || listingHeadersArr.find(k => {
    const u = String(k).toUpperCase();
    return u === 'SALES REP' || u === 'SALES REP. NAME';
  });
  const countActiveReps = (salesReps) => {
    if (!salesReps?.length || !salesRepCol) return 0;
    const withTerm = salesReps.filter(rep => {
      const term = termCol ? (rep[termCol] ?? rep['Term'] ?? rep['TERM']) : null;
      return term != null && String(term).trim() !== '';
    });
    const unique = new Set(withTerm.map(rep => {
      const name = rep[salesRepCol] ?? rep['SALES REP'] ?? rep['SALES REP. NAME'];
      return name != null ? String(name).trim() : null;
    }).filter(Boolean));
    return unique.size;
  };

  const gd = parsedData.groupedData || {};
  let allReps = [];
  Object.values(gd).forEach((sup) => {
    sup.teamLeaders?.forEach(tl => { allReps.push(...(tl.salesReps || [])); });
  });
  const activeReps = countActiveReps(allReps);

  const gt = parsedData.grandTotalRow;
  if (gt) {
    const value = Number(gt['VALUE'] ?? gt['Value'] ?? 0) || 0;
    const loans = Number(gt['NO. OF LOANS'] ?? gt['No. of Loans'] ?? gt['No. Of Loans'] ?? 0) || 0;
    return { disbursement: value, noLoans: loans, activeReps };
  }
  let disbursement = 0, noLoans = 0;
  Object.values(gd).forEach((sup) => {
    const d = sup.supervisionData;
    if (d) {
      disbursement += Number(d['VALUE'] ?? d['Value'] ?? 0) || 0;
      noLoans += Number(d['NO. OF LOANS'] ?? d['No. of Loans'] ?? 0) || 0;
    }
    (sup.teamLeaders || []).forEach((tl) => {
      if (tl.data) {
        disbursement += Number(tl.data['VALUE'] ?? tl.data['Value'] ?? 0) || 0;
        noLoans += Number(tl.data['NO. OF LOANS'] ?? tl.data['No. of Loans'] ?? 0) || 0;
      }
    });
  });
  return { disbursement, noLoans, activeReps };
};

const ManagementSummary = forwardRef(({ mode, userData }, ref) => {
  const { parsedReports: managementReports } = useManagementData();
  const mtdCS = useMTDData('CS');
  const mtdLBF = useMTDData('LBF');
  const mtdSME = useMTDData('SME');

  const getLatestWeekReport = () => {
    if (!managementReports || managementReports.length === 0) return null;
    const sorted = [...managementReports].sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
      const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
      return dateB - dateA;
    });
    return sorted[0];
  };

  /** Get client metrics: Active = "Active clients", Inactive = "Inactive clients", Total = "Number of Clients" from management report row */
  const getClientMetricsFromData = (data, product) => {
    if (!data || typeof data !== 'object') return { activeClients: 0, inactiveClients: 0, totalClients: 0 };
    // Use exact keys from management report (Active clients, Inactive clients, Number of Clients)
    let activeClients = Number(data['Active clients'] ?? data['Active Clients'] ?? 0) || 0;
    let inactiveClients = Number(data['Inactive clients'] ?? data['Inactive Clients'] ?? 0) || 0;
    const numberOFClients = data['Number of Clients'] ?? data['Number of clients'] ?? null;
    // Total must come from "Number of Clients" when present
    const totalClients = numberOFClients != null && numberOFClients !== ''
      ? Number(numberOFClients)
      : (product === 'Agrifinance' ? 0 : activeClients + inactiveClients);
    let total = totalClients || 0;
    // Agrifinance: backend sometimes swaps or mis-stores Active/Inactive; Total is correct from "Number of Clients".
    // If active + inactive !== total, derive Active = total - Inactive so display matches the report (15, 1, 16).
    if (product === 'Agrifinance' && total > 0 && activeClients + inactiveClients !== total) {
      activeClients = Math.max(0, total - inactiveClients);
    }
    // SME: backend sometimes sends "Number of Clients" equal to Inactive, so Total shows same as Inactive.
    // If Total === Inactive but Active > 0, use Total = Active + Inactive so row shows 527, 2,007, 2,534.
    if (product === 'SME' && total === inactiveClients && activeClients > 0) {
      total = activeClients + inactiveClients;
    }
    return {
      activeClients,
      inactiveClients,
      totalClients: total
    };
  };

  const getProductData = (report, product) => {
    if (!report) return null;
    let data = null;
    if (product === 'CS') data = report.cs || {};
    else if (product === 'LBF') data = report.lbf || {};
    else if (product === 'SME') data = report.sme || {};
    else if (product === 'Agrifinance') data = report.agrifinance || report.AgriFinance || {};
    if (!data || Object.keys(data).length === 0) return null;
    const target = data['Target'] || data['Monthly Target'] || 0;
    const disbursement = data['Disbursements This Month'] || data['Disbursement This Month'] || data['Disbursement this Month'] || 0;
    const { activeClients, inactiveClients, totalClients } = getClientMetricsFromData(data, product);
    return {
      activeClients,
      inactiveClients,
      totalClients,
      target,
      disbursement,
      pctAchieved: target > 0 ? (disbursement / target * 100) : 0,
      noLoans: data['Number of loans'] || data['Number of Loans'] || data['No. of Loans'] || 0,
      activeReps: data['Active Reps'] || data['Active reps'] || 0
    };
  };

  const table1Data = useMemo(() => {
    const report = getLatestWeekReport();
    if (!report) return [];
    return MAIN_PRODUCTS.map(product => {
      const d = getProductData(report, product);
      return {
        Product: product,
        'Active Client': d ? d.activeClients : 0,
        'Inactive Client': d ? d.inactiveClients : 0,
        'Total Clients': d ? d.totalClients : 0
      };
    });
  }, [managementReports]);

  const table1Totals = useMemo(() => {
    if (table1Data.length === 0) return null;
    return {
      Product: 'Total',
      'Active Client': table1Data.reduce((s, r) => s + (Number(r['Active Client']) || 0), 0),
      'Inactive Client': table1Data.reduce((s, r) => s + (Number(r['Inactive Client']) || 0), 0),
      'Total Clients': table1Data.reduce((s, r) => s + (Number(r['Total Clients']) || 0), 0)
    };
  }, [table1Data]);

  const table2Data = useMemo(() => {
    const report = getLatestWeekReport();
    const refDate = report ? (report.date ? new Date(report.date) : new Date(report.createdAt)) : null;
    const sameMonthAsRef = (mtdReportDate) => {
      if (!refDate || !mtdReportDate) return false;
      const m = mtdReportDate instanceof Date ? mtdReportDate : new Date(mtdReportDate);
      if (isNaN(m.getTime())) return false;
      return refDate.getFullYear() === m.getFullYear() && refDate.getMonth() === m.getMonth();
    };
    const mtdCSOk = sameMonthAsRef(mtdCS.parsedData?.reportDate);
    const mtdLBFOk = sameMonthAsRef(mtdLBF.parsedData?.reportDate);
    const mtdSMEOk = sameMonthAsRef(mtdSME.parsedData?.reportDate);
    const mtdCSTotals = mtdCSOk ? getMTDTotals(mtdCS.parsedData) : null;
    const mtdLBFTotals = mtdLBFOk ? getMTDTotals(mtdLBF.parsedData) : null;
    const mtdSMETotals = mtdSMEOk ? getMTDTotals(mtdSME.parsedData) : null;
    if (!report && !mtdCSTotals && !mtdLBFTotals && !mtdSMETotals) return [];
    return MAIN_PRODUCTS.map(product => {
      const d = getProductData(report, product);
      const mgmtDisb = d ? Number(d.disbursement) || 0 : 0;
      const target = d ? d.target : 0;
      let mtdTotals = null;
      if (product === 'CS') mtdTotals = mtdCSTotals;
      else if (product === 'LBF') mtdTotals = mtdLBFTotals;
      else if (product === 'SME') mtdTotals = mtdSMETotals;
      const mtdDisb = mtdTotals ? (Number(mtdTotals.disbursement) || 0) : 0;
      const useMTD = mtdDisb >= mgmtDisb && mtdTotals;
      const disbursement = useMTD ? mtdDisb : mgmtDisb;
      const noLoans = useMTD ? (mtdTotals.noLoans ?? (d ? d.noLoans : 0)) : (d ? d.noLoans : 0);
      const activeReps = useMTD ? (mtdTotals.activeReps ?? (d ? d.activeReps : 0)) : (d ? d.activeReps : 0);
      const source = useMTD ? 'MTD' : 'Management';
      return {
        Product: product,
        Target: target,
        Disbursement: disbursement,
        '% Achieved': target > 0 ? (disbursement / target * 100) : 0,
        'No. Loans': noLoans,
        'Active Reps': activeReps,
        Source: source
      };
    });
  }, [managementReports, mtdCS.parsedData, mtdLBF.parsedData, mtdSME.parsedData]);

  const table2Totals = useMemo(() => {
    if (table2Data.length === 0) return null;
    const sumTarget = table2Data.reduce((s, r) => s + (Number(r.Target) || 0), 0);
    const sumDisb = table2Data.reduce((s, r) => s + (Number(r.Disbursement) || 0), 0);
    return {
      Product: 'Total',
      Target: sumTarget,
      Disbursement: sumDisb,
      '% Achieved': sumTarget > 0 ? (sumDisb / sumTarget * 100) : 0,
      'No. Loans': table2Data.reduce((s, r) => s + (Number(r['No. Loans']) || 0), 0),
      'Active Reps': table2Data.reduce((s, r) => s + (Number(r['Active Reps']) || 0), 0)
    };
  }, [table2Data]);

  const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const getReportDisbursement = (report) => {
    const cw = report.countrywise || {};
    const total = cw['Disbursements This Month'] ?? cw['Disbursement This Month'] ?? cw['Disbursement this Month'];
    if (total != null && (typeof total === 'number' || !Number.isNaN(parseFloat(total)))) return Number(total);
    let sum = 0;
    MAIN_PRODUCTS.forEach(product => {
      const pd = getProductData(report, product);
      if (pd) sum += Number(pd.disbursement) || 0;
    });
    return sum;
  };
  const monthlyDisbursementTrendData = useMemo(() => {
    if (!managementReports || managementReports.length === 0) return { rows: [], prevYearTotal: 0, currYearTotal: 0, currentYear: null, previousYear: null };
    const sorted = [...managementReports].sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
      const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
      return dateB - dateA;
    });
    const latestDate = sorted[0].date ? new Date(sorted[0].date) : new Date(sorted[0].createdAt);
    const currentYear = latestDate.getFullYear();
    const previousYear = currentYear - 1;
    const byYearMonth = {};
    [currentYear, previousYear].forEach(y => {
      byYearMonth[y] = {};
      for (let m = 0; m < 12; m++) byYearMonth[y][m] = null;
    });
    sorted.forEach(report => {
      const d = report.date ? new Date(report.date) : (report.createdAt ? new Date(report.createdAt) : null);
      if (!d) return;
      const y = d.getFullYear();
      const m = d.getMonth();
      if (y !== currentYear && y !== previousYear) return;
      if (byYearMonth[y][m] == null) {
        byYearMonth[y][m] = getReportDisbursement(report);
      }
    });
    const rows = [];
    let prevYearTotal = 0;
    let currYearTotal = 0;
    for (let m = 0; m < 12; m++) {
      const prevDisb = byYearMonth[previousYear]?.[m] ?? 0;
      const currDisb = byYearMonth[currentYear]?.[m] ?? 0;
      prevYearTotal += prevDisb || 0;
      currYearTotal += currDisb || 0;
      const pctChange = currDisb > 0 ? (prevDisb > 0 ? ((currDisb - prevDisb) / prevDisb * 100) : 100) : null;
      rows.push({
        Month: MONTH_NAMES_FULL[m],
        prevDisb,
        currDisb,
        'Percentage Change': pctChange
      });
    }
    return { rows, prevYearTotal, currYearTotal, currentYear, previousYear };
  }, [managementReports]);

  const formatVal = (v, dashZero = false) => {
    if (v === '-' || v == null) return '-';
    if (dashZero && typeof v === 'number' && v === 0) return '-';
    if (typeof v === 'number') return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return v;
  };

  const handleExport = async () => {
    const section = getExportSheets()[0];
    if (section) await exportSingleSectionWithStyles(section, 'Management_Summary');
  };

  const getExportSheets = () => {
    const t1 = [...table1Data.map(r => ({ ...r }))];
    if (table1Totals) {
      t1.push({ __separator: true });
      t1.push({ ...table1Totals, __totalRow: true });
    }
    const t2 = [...table2Data.map(r => {
      const { Source, ...rest } = r;
      return {
        ...rest,
        '% Achieved': typeof r['% Achieved'] === 'number' ? r['% Achieved'] : r['% Achieved']
      };
    })];
    if (table2Totals) {
      t2.push({ __separator: true });
      t2.push({
        ...table2Totals,
        '% Achieved': typeof table2Totals['% Achieved'] === 'number' ? table2Totals['% Achieved'] : table2Totals['% Achieved'],
        __totalRow: true
      });
    }
    const { rows: trendRows, prevYearTotal, currYearTotal, currentYear, previousYear } = monthlyDisbursementTrendData;
    const prevHdr = previousYear != null ? `Disbursement ${previousYear}` : 'Disbursement (Prev Year)';
    const currHdr = currentYear != null ? `Disbursement ${currentYear}` : 'Disbursement (Current Year)';
    const toExportVal = (v) => (v === 0 || v == null ? '-' : v);
    const t3 = trendRows.map(r => ({
      Month: r.Month,
      [prevHdr]: toExportVal(r.prevDisb),
      [currHdr]: toExportVal(r.currDisb),
      'Percentage Change': r['Percentage Change'] != null ? r['Percentage Change'] : '-'
    }));
    if (t3.length > 0 && currentYear != null) {
      const pctChange = currYearTotal > 0 ? (prevYearTotal > 0 ? ((currYearTotal - prevYearTotal) / prevYearTotal * 100) : 100) : '-';
      t3.push({ __separator: true });
      t3.push({
        Month: 'Total Yearly Disbursement',
        [prevHdr]: prevYearTotal === 0 ? '-' : prevYearTotal,
        [currHdr]: currYearTotal === 0 ? '-' : currYearTotal,
        'Percentage Change': pctChange,
        __totalRow: true
      });
    }
    const tables = [
      { data: t1, headerColors: { Product: '#4472C4', 'Active Client': '#70AD47', 'Inactive Client': '#70AD47', 'Total Clients': '#70AD47' }, colWidths: [14, 14, 14, 14], totalRowIndices: t1.map((r, i) => r.__totalRow ? i : null).filter(x => x != null), accountingColumns: ['Active Client', 'Inactive Client', 'Total Clients'] },
      { data: t2, headerColors: { Product: '#4472C4', Target: '#ED7D31', Disbursement: '#ED7D31', '% Achieved': '#ED7D31', 'No. Loans': '#ED7D31', 'Active Reps': '#ED7D31' }, colWidths: [14, 14, 14, 12, 12, 12], totalRowIndices: t2.map((r, i) => r.__totalRow ? i : null).filter(x => x != null), accountingColumns: ['Target', 'Disbursement', 'No. Loans', 'Active Reps'] }
    ];
    if (t3.length > 0) {
      const trendTitle = `Monthly Disbursement Trend ${currentYear} Vs ${previousYear}`;
      tables.push({
        title: trendTitle,
        data: t3,
        colWidths: [18, 20, 22, 18],
        headerColors: { Month: '#4472C4', [prevHdr]: '#ED7D31', [currHdr]: '#70AD47', 'Percentage Change': '#2E5090' },
        totalRowIndices: t3.map((r, i) => r.__totalRow ? i : null).filter(x => x != null),
        accountingColumns: [prevHdr, currHdr],
        pctChangeColumn: 'Percentage Change',
        totalRowFillColor: '#C5CAE9'
      });
    }
    return [{ name: 'Management Summary', tables }];
  };

  useImperativeHandle(ref, () => ({ getExportSheets }), [table1Data, table2Data, monthlyDisbursementTrendData]);

  return (
    <div className="ms-container">
      <div className="ms-header">
        <h3 className="ms-title">MANAGEMENT SUMMARY</h3>
        <span className="ms-badge">Latest week</span>
      </div>
      <div className="ms-tables">
        <div className="ms-table-block">
          <h4 className="ms-table-title">Clients</h4>
          <table className="ms-table">
            <thead>
              <tr>
                <th className="ms-th-product">Product</th>
                <th className="ms-th-green">Active Client</th>
                <th className="ms-th-green">Inactive Client</th>
                <th className="ms-th-green">Total Clients</th>
              </tr>
            </thead>
            <tbody>
              {table1Data.map((row, i) => (
                <tr key={i}>
                  <td>{row.Product}</td>
                  <td>{formatVal(row['Active Client'])}</td>
                  <td>{formatVal(row['Inactive Client'])}</td>
                  <td>{formatVal(row['Total Clients'])}</td>
                </tr>
              ))}
              {table1Totals && (
                <>
                  <tr className="ms-separator"><td colSpan="4"></td></tr>
                  <tr className="ms-total-row">
                    <td>{table1Totals.Product}</td>
                    <td>{formatVal(table1Totals['Active Client'])}</td>
                    <td>{formatVal(table1Totals['Inactive Client'])}</td>
                    <td>{formatVal(table1Totals['Total Clients'])}</td>
                  </tr>
                </>
              )}
              {table1Data.length === 0 && !table1Totals && (
                <tr><td colSpan="4">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ms-table-block">
          <h4 className="ms-table-title">Monthly Disbursement Trend {monthlyDisbursementTrendData.currentYear != null ? `${monthlyDisbursementTrendData.currentYear} Vs ${monthlyDisbursementTrendData.previousYear}` : ''}</h4>
          <table className="ms-table">
            <thead>
              <tr>
                <th className="ms-th-product">Month</th>
                <th className="ms-th-orange">{monthlyDisbursementTrendData.previousYear != null ? `Disbursement ${monthlyDisbursementTrendData.previousYear}` : 'Disbursement (Prev Year)'}</th>
                <th className="ms-th-orange">{monthlyDisbursementTrendData.currentYear != null ? `Disbursement ${monthlyDisbursementTrendData.currentYear}` : 'Disbursement (Current Year)'}</th>
                <th className="ms-th-orange">Percentage Change</th>
              </tr>
            </thead>
            <tbody>
              {monthlyDisbursementTrendData.rows.map((row, i) => {
                const hasPct = row['Percentage Change'] != null;
                const pctClass = !hasPct ? 'ms-pct-neutral' : (row['Percentage Change'] >= 0 ? 'ms-pct-green' : 'ms-pct-red');
                return (
                  <tr key={i}>
                    <td>{row.Month}</td>
                    <td>{formatVal(row.prevDisb, true)}</td>
                    <td>{formatVal(row.currDisb, true)}</td>
                    <td className={pctClass}>
                      {hasPct ? row['Percentage Change'].toFixed(1) + '%' : '-'}
                    </td>
                  </tr>
                );
              })}
              {monthlyDisbursementTrendData.rows.length > 0 && (
                <>
                  <tr className="ms-separator"><td colSpan="4"></td></tr>
                  <tr className="ms-total-row">
                    <td>Total Yearly Disbursement</td>
                    <td>{formatVal(monthlyDisbursementTrendData.prevYearTotal, true)}</td>
                    <td>{formatVal(monthlyDisbursementTrendData.currYearTotal, true)}</td>
                    <td className={monthlyDisbursementTrendData.currYearTotal === 0 ? 'ms-pct-neutral' : ''}>
                      {monthlyDisbursementTrendData.currYearTotal > 0
                        ? (monthlyDisbursementTrendData.prevYearTotal > 0
                          ? (((monthlyDisbursementTrendData.currYearTotal - monthlyDisbursementTrendData.prevYearTotal) / monthlyDisbursementTrendData.prevYearTotal * 100).toFixed(1) + '%')
                          : '100.0%')
                        : '-'}
                    </td>
                  </tr>
                </>
              )}
              {monthlyDisbursementTrendData.rows.length === 0 && (
                <tr><td colSpan="4">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="ms-table-block">
          <h4 className="ms-table-title">Sales</h4>
          <table className="ms-table">
            <thead>
              <tr>
                <th className="ms-th-product">Product</th>
                <th className="ms-th-orange">Target</th>
                <th className="ms-th-orange">Disbursement</th>
                <th className="ms-th-orange">% Achieved</th>
                <th className="ms-th-orange">No. Loans</th>
                <th className="ms-th-orange">Active Reps</th>
                <th className="ms-th-source">Source</th>
              </tr>
            </thead>
            <tbody>
              {table2Data.map((row, i) => (
                <tr key={i}>
                  <td>{row.Product}</td>
                  <td>{formatVal(row.Target)}</td>
                  <td>{formatVal(row.Disbursement)}</td>
                  <td>{typeof row['% Achieved'] === 'number' ? (row['% Achieved'].toFixed(1) + '%') : formatVal(row['% Achieved'])}</td>
                  <td>{formatVal(row['No. Loans'])}</td>
                  <td>{formatVal(row['Active Reps'])}</td>
                  <td className="ms-td-source">{row.Source ?? '—'}</td>
                </tr>
              ))}
              {table2Totals && (
                <>
                  <tr className="ms-separator"><td colSpan="7"></td></tr>
                  <tr className="ms-total-row">
                    <td>{table2Totals.Product}</td>
                    <td>{formatVal(table2Totals.Target)}</td>
                    <td>{formatVal(table2Totals.Disbursement)}</td>
                    <td>{typeof table2Totals['% Achieved'] === 'number' ? (table2Totals['% Achieved'].toFixed(1) + '%') : formatVal(table2Totals['% Achieved'])}</td>
                    <td>{formatVal(table2Totals['No. Loans'])}</td>
                    <td>{formatVal(table2Totals['Active Reps'])}</td>
                    <td className="ms-td-source">—</td>
                  </tr>
                </>
              )}
              {table2Data.length === 0 && !table2Totals && (
                <tr><td colSpan="7">No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="ms-footer">
        <button className="ms-export-btn" onClick={handleExport} title="Download as Excel">📥</button>
      </div>
    </div>
  );
});

ManagementSummary.displayName = 'ManagementSummary';
export default ManagementSummary;
