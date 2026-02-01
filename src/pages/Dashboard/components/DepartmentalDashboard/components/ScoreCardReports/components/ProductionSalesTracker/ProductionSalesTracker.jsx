import React, { useMemo, useImperativeHandle, forwardRef } from 'react';
import './ProductionSalesTracker.css';
import { useManagementData } from '../../../../../ManagementDashboard/hooks/useManagementData';
import { exportSingleSectionWithStyles } from '../../../../utils/excelExportStyled';
import LoadingSpinner from '../../../../../../../../components/Common/Loading/LoadingSpinner';

// Sub-products definitions
const SUB_PRODUCTS = {
  CS: ['CS', 'Cs Asset Finance'],
  LBF: ['LBF', 'IPF', 'MIF', 'MIF Customs', 'Lbf Yard Finance', 'LBF QUICKCASH'],
  SME: ['SME'],
  AgriFinance: ['AgriFinance']
};

const ProductionSalesTracker = forwardRef(({ mode, userData }, ref) => {
  const { parsedReports: managementReports } = useManagementData();

  // Get metrics from report data
  const getMetrics = (report, product, subProduct) => {
    if (!report) return null;
    
    let data = null;
    
    if (product === 'CS') {
      if (subProduct === 'Total') {
        data = report.cs || {};
      } else {
        data = report.csBranches?.[subProduct] || {};
      }
    } else if (product === 'LBF') {
      if (subProduct === 'Total') {
        data = report.lbf || {};
      } else {
        data = report.lbfBranches?.[subProduct] || {};
      }
    } else if (product === 'SME') {
      data = report.sme || {};
    } else if (product === 'AgriFinance') {
      data = report.agrifinance || {};
    }
    
    if (!data || Object.keys(data).length === 0) return null;
    
    const target = data['Target'] || data['Monthly Target'] || 0;
    const disbursement = data['Disbursements This Month'] || data['Disbursement This Month'] || data['Disbursement this Month'] || 0;
    
    return {
      target,
      disbursement,
      requiredToEndMonth: Math.max(0, target - disbursement),
      percentageAchieved: target > 0 ? (disbursement / target * 100) : 0,
      percentageUnachieved: target > 0 ? ((target - disbursement) / target * 100) : 0,
      loanCount: data['Number of loans'] || data['Number of Loans'] || data['No. of Loans'] || 0,
      activeReps: data['Active Reps'] || data['Active reps'] || 0
    };
  };

  // Table 1: Current Status
  const currentStatusData = useMemo(() => {
    if (!managementReports || managementReports.length === 0) return [];
    
    // Get latest report
    const sorted = [...managementReports].sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
      const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
      return dateB - dateA;
    });
    const latestReport = sorted[0];
    
    const products = ['CS', 'LBF', 'SME', 'AgriFinance'];
    const rows = [];
    
    products.forEach(product => {
      const subProducts = SUB_PRODUCTS[product] || [product];
      
      // Add total row first
      const totalMetrics = getMetrics(latestReport, product, 'Total');
      if (totalMetrics) {
        rows.push({
          product,
          subProduct: 'Total',
          ...totalMetrics,
          isTotal: true
        });
      }
      
      // Add sub-product rows
      subProducts.forEach(subProduct => {
        const metrics = getMetrics(latestReport, product, subProduct);
        if (metrics) {
          rows.push({
            product: '',
            subProduct,
            ...metrics,
            isTotal: false
          });
        }
      });
    });
    
    return rows;
  }, [managementReports]);

  // Table 2: Month to Month – latest report (current month) vs latest report from previous calendar month
  const monthComparisonData = useMemo(() => {
    if (!managementReports || managementReports.length === 0) return [];
    
    const sorted = [...managementReports].sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
      const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
      return dateB - dateA;
    });
    
    const currentReport = sorted[0];
    const currentDate = currentReport.date ? new Date(currentReport.date) : new Date(currentReport.createdAt);
    const currMonth = currentDate.getMonth();
    const currYear = currentDate.getFullYear();
    const prevMonth = currMonth === 0 ? 11 : currMonth - 1;
    const prevYear = currMonth === 0 ? currYear - 1 : currYear;
    const previousMonthReports = sorted.filter(r => {
      const d = r.date ? new Date(r.date) : (r.createdAt ? new Date(r.createdAt) : null);
      if (!d) return false;
      return d.getMonth() === prevMonth && d.getFullYear() === prevYear;
    });
    const previousReport = previousMonthReports.length > 0
      ? previousMonthReports.sort((a, b) => {
          const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
          const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
          return dateB - dateA;
        })[0]
      : null;
    
    const products = ['CS', 'LBF', 'SME', 'AgriFinance'];
    const rows = [];
    
    products.forEach(product => {
      const currentMetrics = getMetrics(currentReport, product, 'Total');
      const previousMetrics = previousReport ? getMetrics(previousReport, product, 'Total') : null;
      
      if (currentMetrics || previousMetrics || product === 'AgriFinance') {
        rows.push({
          product,
          current: {
            target: currentMetrics?.target ?? '-',
            disbursement: currentMetrics?.disbursement ?? '-',
            percentAchieved: currentMetrics?.percentageAchieved ?? '-',
            loanCount: currentMetrics?.loanCount ?? '-',
            activeReps: currentMetrics?.activeReps ?? '-'
          },
          previous: {
            target: previousMetrics?.target ?? '-',
            disbursement: previousMetrics?.disbursement ?? '-',
            percentAchieved: previousMetrics?.percentageAchieved ?? '-',
            loanCount: previousMetrics?.loanCount ?? '-',
            activeReps: previousMetrics?.activeReps ?? '-'
          },
          change: previousMetrics?.disbursement != null && typeof previousMetrics.disbursement === 'number' && previousMetrics.disbursement > 0
            ? ((currentMetrics?.disbursement ?? 0) - previousMetrics.disbursement) / previousMetrics.disbursement * 100
            : '-'
        });
      }
    });
    
    return rows;
  }, [managementReports]);

  // Table 3: Year to Year – latest report's month vs same month last year (latest in that month)
  const yearComparisonData = useMemo(() => {
    if (!managementReports || managementReports.length === 0) return [];
    
    const sorted = [...managementReports].sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
      const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
      return dateB - dateA;
    });
    
    const latestReport = sorted[0];
    const latestDate = latestReport.date ? new Date(latestReport.date) : new Date(latestReport.createdAt);
    const currentYear = latestDate.getFullYear();
    const currentMonth = latestDate.getMonth();
    const currentYearReports = sorted.filter(r => {
      const d = r.date ? new Date(r.date) : (r.createdAt ? new Date(r.createdAt) : null);
      if (!d) return false;
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });
    const lastYearReports = sorted.filter(r => {
      const d = r.date ? new Date(r.date) : (r.createdAt ? new Date(r.createdAt) : null);
      if (!d) return false;
      return d.getFullYear() === currentYear - 1 && d.getMonth() === currentMonth;
    });
    const currentYearReport = currentYearReports.length > 0 ? currentYearReports[0] : null;
    const lastYearReport = lastYearReports.length > 0
      ? lastYearReports.sort((a, b) => {
          const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
          const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
          return dateB - dateA;
        })[0]
      : null;
    
    const products = ['CS', 'LBF', 'SME', 'AgriFinance'];
    const rows = [];
    
    products.forEach(product => {
      const currentMetrics = currentYearReport ? getMetrics(currentYearReport, product, 'Total') : null;
      const lastYearMetrics = lastYearReport ? getMetrics(lastYearReport, product, 'Total') : null;
      
      if (currentMetrics || lastYearMetrics || product === 'AgriFinance') {
        const change = lastYearMetrics?.disbursement != null && typeof lastYearMetrics.disbursement === 'number' && lastYearMetrics.disbursement > 0
          ? ((currentMetrics?.disbursement ?? 0) - lastYearMetrics.disbursement) / lastYearMetrics.disbursement * 100
          : '-';
        rows.push({
          product,
          currentYear: {
            target: currentMetrics?.target ?? '-',
            disbursement: currentMetrics?.disbursement ?? '-',
            percentAchieved: currentMetrics?.percentageAchieved ?? '-',
            loanCount: currentMetrics?.loanCount ?? '-'
          },
          lastYear: {
            target: lastYearMetrics?.target ?? '-',
            disbursement: lastYearMetrics?.disbursement ?? '-',
            percentAchieved: lastYearMetrics?.percentageAchieved ?? '-',
            loanCount: lastYearMetrics?.loanCount ?? '-'
          },
          change
        });
      }
    });
    
    return rows;
  }, [managementReports]);

  const isLoading = !managementReports;

  const handleExport = () => {
    const section = getExportSheets()[0];
    if (section) exportSingleSectionWithStyles(section, 'Production_Sales_Tracker');
  };

  const getExportSheets = () => {
    const tables = [];
    const currentStatusRows = currentStatusData.map(row => ({
      'Product': row.product,
      'Sub-Product': row.subProduct,
      'Target': row.target,
      'Disbursement': row.disbursement,
      'Required to End': row.requiredToEndMonth,
      '% Achieved': row.percentageAchieved.toFixed(1) + '%',
      '% Unachieved': row.percentageUnachieved > 0 ? row.percentageUnachieved.toFixed(1) + '%' : '-'
    }));
    if (currentStatusRows.length > 0) {
      const totalIndices = currentStatusData.map((r, i) => r.isTotal ? i : null).filter(x => x != null);
      tables.push({ title: 'Current Status', data: currentStatusRows, totalRowIndices: totalIndices, colWidths: [12, 18, 15, 18, 18, 12, 15], headerColors: { 'Product': '#4472C4', 'Sub-Product': '#4472C4', 'Target': '#ED7D31', 'Disbursement': '#70AD47' } });
    }
    const monthRows = monthComparisonData.map(row => ({
      'Product': row.product,
      'Current Target': row.current.target,
      'Current Disbursement': row.current.disbursement,
      'Current % Achieved': typeof row.current.percentAchieved === 'number' ? row.current.percentAchieved.toFixed(1) + '%' : row.current.percentAchieved,
      'Previous Target': row.previous.target,
      'Previous Disbursement': row.previous.disbursement,
      'Change %': typeof row.change === 'number' ? row.change.toFixed(1) + '%' : row.change
    }));
    if (monthRows.length > 0) tables.push({ title: 'Month to Month Comparison', data: monthRows, colWidths: [12, 16, 18, 16, 16, 18, 14], headerColors: { 'Product': '#4472C4', 'Current Disbursement': '#70AD47', 'Previous Disbursement': '#ED7D31' } });
    const yearRows = yearComparisonData.map(row => ({
      'Product': row.product,
      'This Year Disbursement': row.currentYear.disbursement,
      'Last Year Disbursement': row.lastYear.disbursement,
      'Change %': typeof row.change === 'number' ? row.change.toFixed(1) + '%' : row.change
    }));
    if (yearRows.length > 0) tables.push({ title: 'Year to Year Comparison', data: yearRows, colWidths: [12, 22, 22, 14], headerColors: { 'Product': '#4472C4', 'This Year Disbursement': '#70AD47', 'Last Year Disbursement': '#ED7D31' } });
    if (tables.length === 0) return [];
    return [{ name: 'Production Sales Tracker', tables, freeze: { row: 1, col: 0 } }];
  };

  useImperativeHandle(ref, () => ({ getExportSheets }), [currentStatusData, monthComparisonData, yearComparisonData]);

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
      <div className="pst-container">
        <div className="pst-header">
          <h3 className="pst-title">PRODUCTION/SALES TRACKER</h3>
        </div>
        <div className="pst-loading">
          <LoadingSpinner size="medium" />
        </div>
      </div>
    );
  }

  return (
    <div className="pst-container">
      <div className="pst-header">
        <h3 className="pst-title">PRODUCTION/SALES TRACKER</h3>
      </div>
      
      <div className="pst-content">
        {/* Table 1: Current Status */}
        <div className="pst-table-section">
          <h4 className="pst-section-title">Current Status</h4>
          <div className="pst-table-wrapper">
            <table className="pst-table">
              <thead>
                <tr>
                  <th className="pst-th-product">Product</th>
                  <th className="pst-th-subproduct">Sub-Product</th>
                  <th className="pst-th-number">Target</th>
                  <th className="pst-th-number">Disbursement</th>
                  <th className="pst-th-number">Required to End</th>
                  <th className="pst-th-percent">% Achieved</th>
                  <th className="pst-th-percent">% Unachieved</th>
                </tr>
              </thead>
              <tbody>
                {currentStatusData.length > 0 ? currentStatusData.map((row, idx) => (
                  <tr key={idx} className={row.isTotal ? 'pst-row-total' : ''}>
                    <td className="pst-td-product">{row.product}</td>
                    <td className="pst-td-subproduct">{row.subProduct}</td>
                    <td className="pst-td-number">{formatValue(row.target)}</td>
                    <td className="pst-td-number">{formatValue(row.disbursement)}</td>
                    <td className="pst-td-number">{formatValue(row.requiredToEndMonth)}</td>
                    <td className={`pst-td-percent ${row.percentageAchieved >= 100 ? 'pst-positive' : row.percentageAchieved >= 80 ? 'pst-warning' : 'pst-negative'}`}>
                      {row.percentageAchieved.toFixed(1)}%
                    </td>
                    <td className="pst-td-percent pst-negative">
                      {row.percentageUnachieved > 0 ? row.percentageUnachieved.toFixed(1) + '%' : '-'}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan="7" className="pst-no-data">No data available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Table 2: Month to Month Comparison */}
        <div className="pst-table-section">
          <h4 className="pst-section-title">Month to Month Comparison</h4>
          <div className="pst-table-wrapper">
            <table className="pst-table">
              <thead>
                <tr>
                  <th className="pst-th-product">Product</th>
                  <th colSpan="4" className="pst-th-group-current">Current Month</th>
                  <th colSpan="4" className="pst-th-group-previous">Previous Month</th>
                  <th className="pst-th-change">Change</th>
                </tr>
                <tr className="pst-subheader">
                  <th></th>
                  <th>Target</th>
                  <th>Disbursement</th>
                  <th>% Achieved</th>
                  <th>Loan Count</th>
                  <th>Target</th>
                  <th>Disbursement</th>
                  <th>% Achieved</th>
                  <th>Loan Count</th>
                  <th>Disb. %</th>
                </tr>
              </thead>
              <tbody>
                {monthComparisonData.length > 0 ? monthComparisonData.map((row, idx) => (
                  <tr key={idx}>
                    <td className="pst-td-product">{row.product}</td>
                    <td className="pst-td-number">{formatValue(row.current.target)}</td>
                    <td className="pst-td-number">{formatValue(row.current.disbursement)}</td>
                    <td className="pst-td-percent">{typeof row.current.percentAchieved === 'number' ? row.current.percentAchieved.toFixed(1) + '%' : row.current.percentAchieved}</td>
                    <td className="pst-td-number">{formatValue(row.current.loanCount)}</td>
                    <td className="pst-td-number">{formatValue(row.previous.target)}</td>
                    <td className="pst-td-number">{formatValue(row.previous.disbursement)}</td>
                    <td className="pst-td-percent">{typeof row.previous.percentAchieved === 'number' ? row.previous.percentAchieved.toFixed(1) + '%' : row.previous.percentAchieved}</td>
                    <td className="pst-td-number">{formatValue(row.previous.loanCount)}</td>
                    <td className={`pst-td-change ${typeof row.change === 'number' ? (row.change >= 0 ? 'pst-positive' : 'pst-negative') : ''}`}>
                      {typeof row.change === 'number' ? (row.change >= 0 ? '+' : '') + row.change.toFixed(1) + '%' : row.change}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan="10" className="pst-no-data">No comparison data available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Table 3: Year to Year Comparison */}
        <div className="pst-table-section">
          <h4 className="pst-section-title">Year to Year Comparison (Same Month)</h4>
          <div className="pst-table-wrapper">
            <table className="pst-table">
              <thead>
                <tr>
                  <th className="pst-th-product">Product</th>
                  <th colSpan="3" className="pst-th-group-current">This Year</th>
                  <th colSpan="3" className="pst-th-group-previous">Last Year</th>
                  <th className="pst-th-change">YoY Change</th>
                </tr>
                <tr className="pst-subheader">
                  <th></th>
                  <th>Target</th>
                  <th>Disbursement</th>
                  <th>% Achieved</th>
                  <th>Target</th>
                  <th>Disbursement</th>
                  <th>% Achieved</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {yearComparisonData.length > 0 ? yearComparisonData.map((row, idx) => (
                  <tr key={idx}>
                    <td className="pst-td-product">{row.product}</td>
                    <td className="pst-td-number">{formatValue(row.currentYear.target)}</td>
                    <td className="pst-td-number">{formatValue(row.currentYear.disbursement)}</td>
                    <td className="pst-td-percent">{typeof row.currentYear.percentAchieved === 'number' ? row.currentYear.percentAchieved.toFixed(1) + '%' : row.currentYear.percentAchieved}</td>
                    <td className="pst-td-number">{formatValue(row.lastYear.target)}</td>
                    <td className="pst-td-number">{formatValue(row.lastYear.disbursement)}</td>
                    <td className="pst-td-percent">{typeof row.lastYear.percentAchieved === 'number' ? row.lastYear.percentAchieved.toFixed(1) + '%' : row.lastYear.percentAchieved}</td>
                    <td className={`pst-td-change ${typeof row.change === 'number' ? (row.change >= 0 ? 'pst-positive' : 'pst-negative') : ''}`}>
                      {typeof row.change === 'number' ? (row.change >= 0 ? '+' : '') + row.change.toFixed(1) + '%' : row.change}
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan="8" className="pst-no-data">No year comparison data available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <div className="pst-footer">
        <button className="pst-export-btn" onClick={handleExport} title="Download this section as Excel">
          <span className="pst-export-icon">📥</span>
        </button>
      </div>
    </div>
  );
});

ProductionSalesTracker.displayName = 'ProductionSalesTracker';
export default ProductionSalesTracker;
