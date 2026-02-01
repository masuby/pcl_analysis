import React, { useMemo } from 'react';
import './ProductSalesTracker.css';
import { useMTDData } from '../../../../../MTDdashboard/hooks/useMTDData';
import { exportToExcel } from '../../../../utils/excelExport';
import LoadingSpinner from '../../../../../../../../components/Common/Loading/LoadingSpinner';

const ProductSalesTracker = ({ mode, userData }) => {
  const mtdCS = useMTDData('CS');
  const mtdLBF = useMTDData('LBF');
  const mtdSME = useMTDData('SME');

  const trackerData = useMemo(() => {
    const departments = ['CS', 'LBF', 'SME'];
    const hooks = { CS: mtdCS, LBF: mtdLBF, SME: mtdSME };
    
    return departments.map(dept => {
      const hook = hooks[dept];
      if (!hook.parsedData || !hook.parsedData.groupedData) return null;
      
      let totalValue = 0;
      let totalLoans = 0;
      const topPerformers = [];
      
      Object.values(hook.parsedData.groupedData).forEach(supervision => {
        if (supervision.supervisionData) {
          const value = Number(supervision.supervisionData['VALUE'] || supervision.supervisionData['Value'] || 0);
          const loans = Number(supervision.supervisionData['NO. OF LOANS'] || supervision.supervisionData['No. of Loans'] || 0);
          totalValue += value;
          totalLoans += loans;
          
          if (value > 0) {
            topPerformers.push({
              name: supervision.supervision || 'Unknown',
              value,
              loans,
              type: 'supervision'
            });
          }
        }
        
        supervision.teamLeaders.forEach(tl => {
          if (tl.data) {
            const value = Number(tl.data['VALUE'] || tl.data['Value'] || 0);
            const loans = Number(tl.data['NO. OF LOANS'] || tl.data['No. of Loans'] || 0);
            if (value > 0) {
              topPerformers.push({
                name: tl.name || 'Unknown',
                value,
                loans,
                type: 'teamleader'
              });
            }
          }
        });
      });
      
      topPerformers.sort((a, b) => b.value - a.value);
      
      return {
        product: dept,
        totalValue,
        totalLoans,
        averageLoanSize: totalLoans > 0 ? totalValue / totalLoans : 0,
        topPerformers: topPerformers.slice(0, 10),
        reportDate: hook.parsedData.reportDate
      };
    }).filter(Boolean);
  }, [mtdCS.parsedData, mtdLBF.parsedData, mtdSME.parsedData]);

  const isLoading = mtdCS.loading || mtdLBF.loading || mtdSME.loading;

  const handleExport = () => {
    const exportData = [];
    
    trackerData.forEach(row => {
      exportData.push({ [`${row.product} Summary`]: '' });
      exportData.push({
        'Product': row.product,
        'Total Value': row.totalValue,
        'Total Loans': row.totalLoans,
        'Average Loan Size': row.averageLoanSize.toFixed(2)
      });
      exportData.push({});
      exportData.push({ 'Top Performers': '' });
      exportData.push({
        'Name': 'Name',
        'Value': 'Value',
        'Loans': 'Loans',
        'Type': 'Type'
      });
      row.topPerformers.forEach(performer => {
        exportData.push({
          'Name': performer.name,
          'Value': performer.value,
          'Loans': performer.loans,
          'Type': performer.type
        });
      });
      exportData.push({});
    });

    exportToExcel(exportData, 'Product Sales Tracker', {
      colWidths: [25, 20, 15, 20, 15]
    });
  };

  if (isLoading) {
    return (
      <div className="section-container">
        <div className="section-header">
          <h3 className="section-title">PRODUCT/SALES TRACKER</h3>
        </div>
        <div className="section-loading">
          <LoadingSpinner size="medium" />
        </div>
      </div>
    );
  }

  return (
    <div className="section-container">
      <div className="section-header">
        <h3 className="section-title">PRODUCT/SALES TRACKER</h3>
      </div>
      
      <div className="section-content">
        <div className="tracker-table-container">
          <table className="tracker-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Total Value</th>
                <th>Total Loans</th>
                <th>Average Loan Size</th>
              </tr>
            </thead>
            <tbody>
              {trackerData.length > 0 ? (
                trackerData.map((row, index) => (
                  <tr key={index}>
                    <td className="product-cell">{row.product}</td>
                    <td className="number-cell">{row.totalValue.toLocaleString()}</td>
                    <td className="number-cell">{row.totalLoans.toLocaleString()}</td>
                    <td className="number-cell">{row.averageLoanSize.toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4" className="no-data">No data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Top Performers Tables */}
        <div className="performers-container">
          {trackerData.map((row, index) => (
            <div key={index} className="performers-table-wrapper">
              <h4 className="performers-title">{row.product} - Top Performers</h4>
              <table className="performers-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th>Value</th>
                    <th>Loans</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {row.topPerformers.length > 0 ? (
                    row.topPerformers.map((performer, pIndex) => (
                      <tr key={pIndex}>
                        <td className="rank-cell">{pIndex + 1}</td>
                        <td>{performer.name}</td>
                        <td className="number-cell">{performer.value.toLocaleString()}</td>
                        <td className="number-cell">{performer.loans.toLocaleString()}</td>
                        <td className="type-cell">{performer.type}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5" className="no-data">No performers data</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      <div className="section-footer">
        <button className="section-export-btn" onClick={handleExport} title="Download this section as Excel">
          <span className="export-icon">📥</span>
        </button>
      </div>
    </div>
  );
};

export default ProductSalesTracker;
