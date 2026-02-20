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

  const getLatestWeekReport = () => {
    if (!managementReports || managementReports.length === 0) return null;
    const sorted = [...managementReports].sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
      const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
      return dateB - dateA;
    });
    return sorted[0];
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
    const activeClients = data['Active clients'] ?? data['Active Clients'] ?? 0;
    const inactiveClients = data['Inactive clients'] ?? data['Inactive Clients'] ?? 0;
    const numberOFClients = data['Number of Clients'] ?? ((activeClients + inactiveClients) || 0);
    return {
      activeClients,
      inactiveClients,
      totalClients: numberOFClients,
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
    const mtdCSTotals = getMTDTotals(mtdCS.parsedData);
    const mtdLBFTotals = getMTDTotals(mtdLBF.parsedData);
    if (!report && !mtdCSTotals && !mtdLBFTotals) return [];
    return MAIN_PRODUCTS.map(product => {
      const d = getProductData(report, product);
      if (product === 'CS' && mtdCSTotals) {
        const target = d ? d.target : 0;
        const disbursement = mtdCSTotals.disbursement;
        return {
          Product: product,
          Target: target,
          Disbursement: disbursement,
          '% Achieved': target > 0 ? (disbursement / target * 100) : 0,
          'No. Loans': mtdCSTotals.noLoans,
          'Active Reps': mtdCSTotals.activeReps ?? (d ? d.activeReps : 0)
        };
      }
      if (product === 'LBF' && mtdLBFTotals) {
        const target = d ? d.target : 0;
        const disbursement = mtdLBFTotals.disbursement;
        return {
          Product: product,
          Target: target,
          Disbursement: disbursement,
          '% Achieved': target > 0 ? (disbursement / target * 100) : 0,
          'No. Loans': mtdLBFTotals.noLoans,
          'Active Reps': mtdLBFTotals.activeReps ?? (d ? d.activeReps : 0)
        };
      }
      return {
        Product: product,
        Target: d ? d.target : 0,
        Disbursement: d ? d.disbursement : 0,
        '% Achieved': d ? d.pctAchieved : 0,
        'No. Loans': d ? d.noLoans : 0,
        'Active Reps': d ? d.activeReps : 0
      };
    });
  }, [managementReports, mtdCS.parsedData, mtdLBF.parsedData]);

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

  const formatVal = (v) => {
    if (v === '-' || v == null) return '-';
    if (typeof v === 'number') return v % 1 === 0 ? v.toLocaleString() : v.toFixed(2);
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
    const t2 = [...table2Data.map(r => ({
      ...r,
      '% Achieved': typeof r['% Achieved'] === 'number' ? r['% Achieved'] : r['% Achieved']
    }))];
    if (table2Totals) {
      t2.push({ __separator: true });
      t2.push({
        ...table2Totals,
        '% Achieved': typeof table2Totals['% Achieved'] === 'number' ? table2Totals['% Achieved'].toFixed(1) + '%' : table2Totals['% Achieved'],
        __totalRow: true
      });
    }
    return [{
      name: 'Management Summary',
      tables: [
        { data: t1, headerColors: { Product: '#4472C4', 'Active Client': '#70AD47', 'Inactive Client': '#70AD47', 'Total Clients': '#70AD47' }, colWidths: [14, 14, 14, 14], totalRowIndices: t1.map((r, i) => r.__totalRow ? i : null).filter(x => x != null) },
        { data: t2, headerColors: { Product: '#4472C4', Target: '#ED7D31', Disbursement: '#ED7D31', '% Achieved': '#ED7D31', 'No. Loans': '#ED7D31', 'Active Reps': '#ED7D31' }, colWidths: [14, 14, 14, 12, 12, 12], totalRowIndices: t2.map((r, i) => r.__totalRow ? i : null).filter(x => x != null), accountingColumns: ['Target', 'Disbursement', 'No. Loans', 'Active Reps'] }
      ]
    }];
  };

  useImperativeHandle(ref, () => ({ getExportSheets }), [table1Data, table2Data]);

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
              </tr>
            </thead>
            <tbody>
              {table2Data.map((row, i) => (
                <tr key={i}>
                  <td>{row.Product}</td>
                  <td>{formatVal(row.Target)}</td>
                  <td>{formatVal(row.Disbursement)}</td>
                  <td>{typeof row['% Achieved'] === 'number' ? row['% Achieved'].toFixed(1) + '%' : formatVal(row['% Achieved'])}</td>
                  <td>{formatVal(row['No. Loans'])}</td>
                  <td>{formatVal(row['Active Reps'])}</td>
                </tr>
              ))}
              {table2Totals && (
                <>
                  <tr className="ms-separator"><td colSpan="6"></td></tr>
                  <tr className="ms-total-row">
                    <td>{table2Totals.Product}</td>
                    <td>{formatVal(table2Totals.Target)}</td>
                    <td>{formatVal(table2Totals.Disbursement)}</td>
                    <td>{typeof table2Totals['% Achieved'] === 'number' ? table2Totals['% Achieved'].toFixed(1) + '%' : formatVal(table2Totals['% Achieved'])}</td>
                    <td>{formatVal(table2Totals['No. Loans'])}</td>
                    <td>{formatVal(table2Totals['Active Reps'])}</td>
                  </tr>
                </>
              )}
              {table2Data.length === 0 && !table2Totals && (
                <tr><td colSpan="6">No data</td></tr>
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
