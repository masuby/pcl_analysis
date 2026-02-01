import React, { useMemo, useImperativeHandle, forwardRef } from 'react';
import './ProductSalesTracker.css';
import { useMTDData } from '../../../../../MTDdashboard/hooks/useMTDData';
import { exportSingleSectionWithStyles } from '../../../../utils/excelExportStyled';
import LoadingSpinner from '../../../../../../../../components/Common/Loading/LoadingSpinner';

const ProductSalesTracker = forwardRef(({ mode, userData }, ref) => {
  const mtdCS = useMTDData('CS');
  const mtdLBF = useMTDData('LBF');
  const mtdSME = useMTDData('SME');

  const trackerData = useMemo(() => {
    const departments = ['CS', 'LBF', 'SME'];
    const hooks = { CS: mtdCS, LBF: mtdLBF, SME: mtdSME };

    return departments.map(dept => {
      const hook = hooks[dept];
      if (!hook.parsedData || !hook.parsedData.groupedData) return null;

      const columnMap = hook.parsedData.columnMap || {};
      const termCol = columnMap.term || Object.keys((hook.parsedData.listingData || [])[0] || {}).find(k => String(k).toUpperCase() === 'TERM');
      const amountCol = columnMap.amount || Object.keys((hook.parsedData.listingData || [])[0] || {}).find(k => String(k).toUpperCase().includes('DISBURSE') && String(k).toUpperCase().includes('AMOUNT'));

      let totalValue = 0;
      let totalLoans = 0;
      let totalTarget = 0;
      let totalActiveReps = 0;
      const supervisionRows = [];
      const teamLeaderRows = [];

      Object.values(hook.parsedData.groupedData).forEach(supervision => {
        const supTarget = Number(supervision.supervisionData?.['MONTH TARGET'] || supervision.supervisionData?.['Month Target'] || 0);
        const supActiveReps = Number(supervision.supervisionData?.['NUMBER OF ACTIVE REPS'] || supervision.supervisionData?.['Active Reps'] || 0);
        if (supervision.supervisionData) {
          const value = Number(supervision.supervisionData['VALUE'] || supervision.supervisionData['Value'] || 0);
          const loans = Number(supervision.supervisionData['NO. OF LOANS'] || supervision.supervisionData['No. of Loans'] || 0);
          const target = Number(supervision.supervisionData['MONTH TARGET'] || supervision.supervisionData['Month Target'] || 0);
          const activeReps = Number(supervision.supervisionData['NUMBER OF ACTIVE REPS'] || supervision.supervisionData['Active Reps'] || 0);
          totalValue += value;
          totalLoans += loans;
          totalTarget += target;
          totalActiveReps += activeReps;
          supervisionRows.push({ name: supervision.supervision || 'Unknown', value, loans, target, activeReps });
        }
        supervision.teamLeaders?.forEach(tl => {
          if (tl.data) {
            const value = Number(tl.data['VALUE'] || tl.data['Value'] || 0);
            const loans = Number(tl.data['NO. OF LOANS'] || tl.data['No. of Loans'] || 0);
            const target = Number(tl.data['MONTH TARGET'] || tl.data['Month Target'] || supTarget) || 0;
            const activeReps = Number(tl.data['NUMBER OF ACTIVE REPS'] || tl.data['Active Reps'] || 0) || 0;
            totalValue += value;
            totalLoans += loans;
            totalTarget += target;
            totalActiveReps += activeReps;
            const salesReps = tl.salesReps || [];
            const termData = {};
            salesReps.forEach(rep => {
              const term = termCol ? (rep[termCol] || rep['Term'] || rep['TERM']) : null;
              const amt = amountCol ? (Number(rep[amountCol]) || 0) : 0;
              if (term && String(term).trim()) {
                const t = String(term).trim();
                if (!termData[t]) termData[t] = { count: 0, value: 0 };
                termData[t].count += 1;
                termData[t].value += amt;
              }
            });
            const productsSold = Object.entries(termData)
              .map(([term, d]) => ({ term, count: d.count, value: d.value }))
              .sort((a, b) => b.value - a.value);
            teamLeaderRows.push({
              name: tl.name || 'Unknown',
              value,
              loans,
              target: target || supTarget,
              activeReps: activeReps || supActiveReps,
              productsSold
            });
          }
        });
      });

      supervisionRows.sort((a, b) => b.value - a.value);
      teamLeaderRows.sort((a, b) => b.value - a.value);

      const wholeTotalRow = {
        name: 'Whole Total',
        value: totalValue,
        loans: totalLoans,
        target: totalTarget,
        activeReps: totalActiveReps,
        isWholeTotal: true
      };

      return {
        product: dept,
        totalValue,
        totalLoans,
        totalTarget,
        totalActiveReps,
        percentAchieved: totalTarget > 0 ? (totalValue / totalTarget * 100) : 0,
        averageLoanSize: totalLoans > 0 ? totalValue / totalLoans : 0,
        supervisionRows,
        teamLeaderRows,
        wholeTotalRow,
        reportDate: hook.parsedData.reportDate
      };
    }).filter(Boolean);
  }, [mtdCS.parsedData, mtdLBF.parsedData, mtdSME.parsedData]);

  const isLoading = mtdCS.loading || mtdLBF.loading || mtdSME.loading;

  const handleExport = () => {
    const exportData = [];
    trackerData.forEach(row => {
      exportData.push({ 'Section': `${row.product} - SUMMARY` });
      exportData.push({
        'Product': row.product,
        'Total Value': row.totalValue,
        'Total Loans': row.totalLoans,
        'Target': row.totalTarget,
        '% Achieved': row.percentAchieved.toFixed(1) + '%',
        'Average Loan Size': row.averageLoanSize.toFixed(2),
        'Active Reps': row.totalActiveReps
      });
      exportData.push({ 'Product': 'Whole Total', 'Total Value': row.wholeTotalRow.value, 'Total Loans': row.wholeTotalRow.loans, 'Target': row.wholeTotalRow.target, '% Achieved': row.percentAchieved.toFixed(1) + '%', 'Average Loan Size': row.averageLoanSize.toFixed(2), 'Active Reps': row.wholeTotalRow.activeReps });
      exportData.push({});
      exportData.push({ 'Section': `${row.product} - SUPERVISION` });
      exportData.push({ 'Name': 'Name', 'Value': 'Value', 'Loans': 'Loans', 'Month Target': 'Month Target', 'Active Reps': 'Active Reps' });
      row.supervisionRows.forEach(r => exportData.push({ 'Name': r.name, 'Value': r.value, 'Loans': r.loans, 'Month Target': r.target, 'Active Reps': r.activeReps }));
      exportData.push({ 'Name': 'Whole Total', 'Value': row.supervisionRows.reduce((s, r) => s + r.value, 0), 'Loans': row.supervisionRows.reduce((s, r) => s + r.loans, 0), 'Month Target': row.totalTarget, 'Active Reps': row.totalActiveReps });
      exportData.push({});
      exportData.push({ 'Section': `${row.product} - TEAM LEADERS` });
      exportData.push({ 'Name': 'Name', 'Value': 'Value', '% of Target': '%', 'Month Target': 'Target', 'Active Reps': 'Reps', 'Loans': 'Loans', 'Products Sold (Term)': 'Products Sold' });
      row.teamLeaderRows.forEach(tl => {
        exportData.push({
          'Name': tl.name,
          'Value': tl.value,
          '% of Target': row.totalTarget > 0 ? (tl.value / row.totalTarget * 100).toFixed(1) + '%' : '-',
          'Month Target': tl.target,
          'Active Reps': tl.activeReps,
          'Loans': tl.loans,
          'Products Sold (Term)': tl.productsSold.map(p => `${p.term} (${p.count}, ${p.value})`).join('; ') || '-'
        });
        tl.productsSold.forEach(p => exportData.push({ 'Name': `  ${p.term}`, 'Value': p.value, '% of Target': '', 'Month Target': '', 'Active Reps': p.count, 'Loans': '', 'Products Sold (Term)': '' }));
      });
      exportData.push({ 'Name': 'Whole Total', 'Value': row.wholeTotalRow.value, '% of Target': '100%', 'Month Target': row.totalTarget, 'Active Reps': row.wholeTotalRow.activeReps, 'Loans': row.wholeTotalRow.loans, 'Products Sold (Term)': '' });
      exportData.push({});
    });
    exportToExcel(exportData, 'Product_Sales_Tracker_MTD', { colWidths: [22, 18, 14, 16, 14, 12, 45] });
  };

  const getExportSheets = () => {
    const tables = [];
    if (trackerData.length === 0) return [];
    const formatVal = (v) => {
      if (v === null || v === undefined || v === 0) return '-';
      if (typeof v === 'number') {
        if (v >= 1000000000) return (v / 1000000000).toFixed(2) + 'B';
        if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
        if (v >= 1000) return (v / 1000).toFixed(2) + 'K';
        return v.toLocaleString();
      }
      return v;
    };
    const summaryRows = trackerData.map(row => ({
      'Product': row.product,
      'Total Value': row.totalValue,
      'Total Loans': row.totalLoans,
      'Target': row.totalTarget,
      '% Achieved': row.percentAchieved.toFixed(1) + '%',
      'Average Loan Size': Math.round(row.averageLoanSize * 100) / 100,
      'Active Reps': row.totalActiveReps
    }));
    const grandTotal = {
      'Product': 'Whole Total',
      'Total Value': trackerData.reduce((s, r) => s + r.totalValue, 0),
      'Total Loans': trackerData.reduce((s, r) => s + r.totalLoans, 0),
      'Target': trackerData.reduce((s, r) => s + r.totalTarget, 0),
      '% Achieved': trackerData.reduce((s, r) => s + r.totalTarget, 0) > 0 ? (trackerData.reduce((s, r) => s + r.totalValue, 0) / trackerData.reduce((s, r) => s + r.totalTarget, 0) * 100).toFixed(1) + '%' : '-',
      'Average Loan Size': '-',
      'Active Reps': trackerData.reduce((s, r) => s + r.totalActiveReps, 0)
    };
    tables.push({
      title: 'Summary',
      data: [...summaryRows, grandTotal],
      totalRowIndices: [summaryRows.length],
      colWidths: [12, 16, 14, 14, 12, 16, 12],
      headerColors: { 'Product': '#4472C4', 'Total Value': '#70AD47', 'Target': '#ED7D31' }
    });
    trackerData.filter(r => r.product !== 'SME').forEach(row => {
      const supRows = row.supervisionRows.map(r => ({
        'Name': r.name,
        'Value': r.value,
        'Loans': r.loans,
        'Month Target': r.target,
        'Active Reps': r.activeReps
      }));
      const supTotal = { 'Name': 'Whole Total', 'Value': row.supervisionRows.reduce((s, r) => s + r.value, 0), 'Loans': row.supervisionRows.reduce((s, r) => s + r.loans, 0), 'Month Target': row.totalTarget, 'Active Reps': row.totalActiveReps };
      if (supRows.length > 0) {
        tables.push({
          title: `${row.product} - Supervision`,
          data: [...supRows, supTotal],
          totalRowIndices: [supRows.length],
          colWidths: [22, 16, 12, 14, 14],
          headerColors: { 'Name': '#4472C4', 'Value': '#70AD47', 'Month Target': '#ED7D31' }
        });
      }
      const tlRows = [];
      row.teamLeaderRows.forEach(tl => {
        tlRows.push({
          'Name': tl.name,
          'Value': tl.value,
          '% of Target': row.totalTarget > 0 ? (tl.value / row.totalTarget * 100).toFixed(1) + '%' : '-',
          'Month Target': tl.target,
          'Active Reps': tl.activeReps,
          'Loans': tl.loans,
          'Products Sold': tl.productsSold.map(p => `${p.term} (${p.count}, ${formatVal(p.value)})`).join('; ') || '-'
        });
        tl.productsSold.forEach(p => tlRows.push({ 'Name': `  ${p.term}`, 'Value': p.value, '% of Target': '', 'Month Target': '', 'Active Reps': p.count, 'Loans': '', 'Products Sold': '' }));
      });
      const tlTotal = { 'Name': 'Whole Total', 'Value': row.wholeTotalRow.value, '% of Target': '-', 'Month Target': row.totalTarget, 'Active Reps': row.wholeTotalRow.activeReps, 'Loans': row.wholeTotalRow.loans, 'Products Sold': '' };
      if (tlRows.length > 0) {
        tables.push({
          title: `${row.product} - Team Leaders`,
          data: [...tlRows, tlTotal],
          totalRowIndices: [tlRows.length],
          colWidths: [22, 16, 12, 14, 12, 12, 40],
          headerColors: { 'Name': '#4472C4', 'Value': '#70AD47', 'Products Sold': '#7030A0' }
        });
      }
    });
    trackerData.filter(r => r.product === 'SME').forEach(row => {
      const smeRows = row.supervisionRows.map(r => ({ 'Name': r.name, 'Value': r.value, 'Loans': r.loans, 'Target': r.target, 'Active Reps': r.activeReps }));
      row.teamLeaderRows.forEach(tl => smeRows.push({ 'Name': tl.name, 'Value': tl.value, 'Loans': tl.loans, 'Target': tl.target, 'Active Reps': tl.activeReps }));
      const smeTotal = { 'Name': 'Whole Total', 'Value': row.wholeTotalRow.value, 'Loans': row.wholeTotalRow.loans, 'Target': row.totalTarget, 'Active Reps': row.wholeTotalRow.activeReps };
      if (smeRows.length > 0) tables.push({ title: 'SME', data: [...smeRows, smeTotal], totalRowIndices: [smeRows.length], colWidths: [22, 16, 12, 14, 14], headerColors: { 'Name': '#4472C4', 'Value': '#70AD47' } });
    });
    if (tables.length === 0) return [];
    return [{ name: 'Product Sales Tracker (MTD)', tables, freeze: { row: 1, col: 0 } }];
  };

  useImperativeHandle(ref, () => ({ getExportSheets }), [trackerData]);

  const formatValue = (value) => {
    if (value === null || value === undefined || value === 0) return '-';
    if (typeof value === 'number') {
      if (value >= 1000000000) return (value / 1000000000).toFixed(2) + 'B';
      if (value >= 1000000) return (value / 1000000).toFixed(2) + 'M';
      if (value >= 1000) return (value / 1000).toFixed(2) + 'K';
      return value.toLocaleString();
    }
    return value;
  };

  if (isLoading) {
    return (
      <div className="mtd-container">
        <div className="mtd-header">
          <h3 className="mtd-title">PRODUCT/SALES TRACKER (MTD)</h3>
        </div>
        <div className="mtd-loading">
          <LoadingSpinner size="medium" />
        </div>
      </div>
    );
  }

  return (
    <div className="mtd-container">
      <div className="mtd-header">
        <h3 className="mtd-title">PRODUCT/SALES TRACKER (MTD)</h3>
      </div>
      
      <div className="mtd-content">
        {/* Summary Table */}
        <div className="mtd-table-wrapper">
          <table className="mtd-table">
            <thead>
              <tr>
                <th className="mtd-th-product">Product</th>
                <th className="mtd-th-value">Total Value</th>
                <th className="mtd-th-loans">Total Loans</th>
                <th className="mtd-th-value">Target</th>
                <th className="mtd-th-value">% Achieved</th>
                <th className="mtd-th-loans">Avg Loan Size</th>
                <th className="mtd-th-performer">Active Reps</th>
              </tr>
            </thead>
            <tbody>
              {trackerData.length > 0 ? (
                <>
                  {trackerData.map((row, index) => (
                    <tr key={index}>
                      <td className="mtd-td-product">{row.product}</td>
                      <td className="mtd-td-number">{formatValue(row.totalValue)}</td>
                      <td className="mtd-td-number">{formatValue(row.totalLoans)}</td>
                      <td className="mtd-td-number">{formatValue(row.totalTarget)}</td>
                      <td className="mtd-td-number">{row.percentAchieved.toFixed(1)}%</td>
                      <td className="mtd-td-number">{formatValue(row.averageLoanSize)}</td>
                      <td className="mtd-td-number">{formatValue(row.totalActiveReps)}</td>
                    </tr>
                  ))}
                  <tr className="mtd-whole-total-row">
                    <td className="mtd-td-product mtd-whole-total-cell">Whole Total</td>
                    <td className="mtd-td-number mtd-whole-total-cell">{formatValue(trackerData.reduce((s, r) => s + r.totalValue, 0))}</td>
                    <td className="mtd-td-number mtd-whole-total-cell">{formatValue(trackerData.reduce((s, r) => s + r.totalLoans, 0))}</td>
                    <td className="mtd-td-number mtd-whole-total-cell">{formatValue(trackerData.reduce((s, r) => s + r.totalTarget, 0))}</td>
                    <td className="mtd-td-number mtd-whole-total-cell">{trackerData.reduce((s, r) => s + r.totalTarget, 0) > 0 ? (trackerData.reduce((s, r) => s + r.totalValue, 0) / trackerData.reduce((s, r) => s + r.totalTarget, 0) * 100).toFixed(1) + '%' : '-'}</td>
                    <td className="mtd-td-number mtd-whole-total-cell">-</td>
                    <td className="mtd-td-number mtd-whole-total-cell">{formatValue(trackerData.reduce((s, r) => s + r.totalActiveReps, 0))}</td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td colSpan="7" className="mtd-no-data">No data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Supervision – horizontal: CS | LBF (and SME) */}
        <div className="mtd-section mtd-supervision-section">
          <h4 className="mtd-section-title">Supervision</h4>
          <div className="mtd-horizontal-tables">
            {trackerData.filter(r => r.product !== 'SME').map((row, index) => (
              <div key={index} className="mtd-product-card">
                <h5 className="mtd-product-card-title">{row.product}</h5>
                <div className="mtd-performers-table-wrapper">
                  <table className="mtd-performers-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Value</th>
                        <th>%</th>
                        <th>Target</th>
                        <th>Active Reps</th>
                        <th>Loans</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.supervisionRows.map((r, i) => (
                        <tr key={i}>
                          <td className="mtd-rank-cell">{i + 1}</td>
                          <td>{r.name}</td>
                          <td className="mtd-td-number">{formatValue(r.value)}</td>
                          <td className="mtd-td-percent">{row.totalTarget > 0 ? (r.value / row.totalTarget * 100).toFixed(1) + '%' : '-'}</td>
                          <td className="mtd-td-number">{formatValue(r.target)}</td>
                          <td className="mtd-td-number">{formatValue(r.activeReps)}</td>
                          <td className="mtd-td-number">{formatValue(r.loans)}</td>
                        </tr>
                      ))}
                      <tr className="mtd-whole-total-row">
                        <td colSpan="2" className="mtd-whole-total-cell">Whole Total</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.supervisionRows.reduce((s, r) => s + r.value, 0))}</td>
                        <td className="mtd-whole-total-cell">-</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.totalTarget)}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.totalActiveReps)}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.supervisionRows.reduce((s, r) => s + r.loans, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Team Leaders – horizontal: CS | LBF, with products sold per TL */}
        <div className="mtd-section mtd-teamleaders-section">
          <h4 className="mtd-section-title">Team Leaders</h4>
          <div className="mtd-horizontal-tables">
            {trackerData.filter(r => r.product !== 'SME').map((row, index) => (
              <div key={index} className="mtd-product-card">
                <h5 className="mtd-product-card-title">{row.product}</h5>
                <div className="mtd-performers-table-wrapper">
                  <table className="mtd-performers-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Value</th>
                        <th>%</th>
                        <th>Target</th>
                        <th>Active Reps</th>
                        <th>Loans</th>
                        <th>Products Sold</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.teamLeaderRows.map((tl, i) => (
                        <React.Fragment key={i}>
                          <tr>
                            <td className="mtd-rank-cell">{i + 1}</td>
                            <td className="mtd-td-name">{tl.name}</td>
                            <td className="mtd-td-number">{formatValue(tl.value)}</td>
                            <td className="mtd-td-percent">{row.totalTarget > 0 ? (tl.value / row.totalTarget * 100).toFixed(1) + '%' : '-'}</td>
                            <td className="mtd-td-number">{formatValue(tl.target)}</td>
                            <td className="mtd-td-number">{formatValue(tl.activeReps)}</td>
                            <td className="mtd-td-number">{formatValue(tl.loans)}</td>
                            <td className="mtd-products-cell">{tl.productsSold.length > 0 ? tl.productsSold.map(p => `${p.term} (${p.count}, ${formatValue(p.value)})`).join('; ') : '-'}</td>
                          </tr>
                          {tl.productsSold.map((p, j) => (
                            <tr key={`${i}-${j}`} className="mtd-sub-row">
                              <td></td>
                              <td colSpan="5" className="mtd-sub-indent">{p.term}: {p.count} loans, {formatValue(p.value)}</td>
                              <td className="mtd-td-number">{formatValue(p.value)}</td>
                              <td></td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                      <tr className="mtd-whole-total-row">
                        <td colSpan="2" className="mtd-whole-total-cell">Whole Total</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.wholeTotalRow.value)}</td>
                        <td className="mtd-whole-total-cell">-</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.totalTarget)}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.wholeTotalRow.activeReps)}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.wholeTotalRow.loans)}</td>
                        <td className="mtd-whole-total-cell"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
        {trackerData.some(r => r.product === 'SME') && (
          <div className="mtd-section">
            <h4 className="mtd-section-title">SME</h4>
            {trackerData.filter(r => r.product === 'SME').map((row, index) => (
              <div key={index} className="mtd-product-card mtd-sme-card">
                <h5 className="mtd-product-card-title">{row.product}</h5>
                <div className="mtd-performers-table-wrapper">
                  <table className="mtd-performers-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Value</th>
                        <th>%</th>
                        <th>Target</th>
                        <th>Active Reps</th>
                        <th>Loans</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.supervisionRows.map((r, i) => (
                        <tr key={`s-${i}`}>
                          <td className="mtd-rank-cell">{i + 1}</td>
                          <td>{r.name}</td>
                          <td className="mtd-td-number">{formatValue(r.value)}</td>
                          <td className="mtd-td-percent">{row.totalTarget > 0 ? (r.value / row.totalTarget * 100).toFixed(1) + '%' : '-'}</td>
                          <td className="mtd-td-number">{formatValue(r.target)}</td>
                          <td className="mtd-td-number">{formatValue(r.activeReps)}</td>
                          <td className="mtd-td-number">{formatValue(r.loans)}</td>
                        </tr>
                      ))}
                      {row.teamLeaderRows.map((tl, i) => (
                        <tr key={`t-${i}`}>
                          <td className="mtd-rank-cell">{row.supervisionRows.length + i + 1}</td>
                          <td>{tl.name}</td>
                          <td className="mtd-td-number">{formatValue(tl.value)}</td>
                          <td className="mtd-td-percent">{row.totalTarget > 0 ? (tl.value / row.totalTarget * 100).toFixed(1) + '%' : '-'}</td>
                          <td className="mtd-td-number">{formatValue(tl.target)}</td>
                          <td className="mtd-td-number">{formatValue(tl.activeReps)}</td>
                          <td className="mtd-td-number">{formatValue(tl.loans)}</td>
                        </tr>
                      ))}
                      <tr className="mtd-whole-total-row">
                        <td colSpan="2" className="mtd-whole-total-cell">Whole Total</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.wholeTotalRow.value)}</td>
                        <td className="mtd-whole-total-cell">-</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.totalTarget)}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.wholeTotalRow.activeReps)}</td>
                        <td className="mtd-td-number mtd-whole-total-cell">{formatValue(row.wholeTotalRow.loans)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mtd-footer">
        <button className="mtd-export-btn" onClick={handleExport} title="Download this section as Excel">
          <span className="mtd-export-icon">📥</span>
        </button>
      </div>
    </div>
  );
});

ProductSalesTracker.displayName = 'ProductSalesTracker';
export default ProductSalesTracker;
