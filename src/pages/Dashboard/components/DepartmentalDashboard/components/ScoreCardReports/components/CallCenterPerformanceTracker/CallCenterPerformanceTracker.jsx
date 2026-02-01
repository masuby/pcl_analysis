import React, { useMemo } from 'react';
import './CallCenterPerformanceTracker.css';
import { useCallCenterData } from '../../../../../CallCenterDashboard/hooks/useCallCenterData';
import { calculateMetrics, getTopAgents } from '../../../../../CallCenterDashboard/utils/callCenterUtils';
import { exportToExcel } from '../../../../utils/excelExport';
import LoadingSpinner from '../../../../../../../../components/Common/Loading/LoadingSpinner';

const CallCenterPerformanceTracker = ({ mode, userData }) => {
  const callCenterCS = useCallCenterData('CS');
  const callCenterLBF = useCallCenterData('LBF');
  const callCenterSME = useCallCenterData('SME');

  const trackerData = useMemo(() => {
    const departments = ['CS', 'LBF', 'SME'];
    const hooks = { CS: callCenterCS, LBF: callCenterLBF, SME: callCenterSME };
    
    return departments.map(dept => {
      const hook = hooks[dept];
      if (!hook.parsedData || !hook.parsedData.allCallData) return null;
      
      const metrics = calculateMetrics(hook.parsedData.allCallData);
      const topAgents = getTopAgents(hook.parsedData.agentPerformance || [], 5);
      
      const successRate = metrics.totalCalls > 0 ? (metrics.successfulCalls / metrics.totalCalls) * 100 : 0;
      
      return {
        product: dept,
        totalCalls: metrics.totalCalls,
        successfulCalls: metrics.successfulCalls,
        unsuccessfulCalls: metrics.unsuccessfulCalls,
        successRate,
        uniqueCalledNumbers: metrics.distinctCalledNumbers,
        uniqueCallingNumbers: metrics.distinctCallingNumbers,
        activeAgents: hook.parsedData.agentPerformance?.length || 0,
        topAgents,
        reportDate: hook.parsedData.reportDate
      };
    }).filter(Boolean);
  }, [callCenterCS.parsedData, callCenterLBF.parsedData, callCenterSME.parsedData]);

  const isLoading = callCenterCS.loading || callCenterLBF.loading || callCenterSME.loading;

  const handleExport = () => {
    const exportData = [];
    
    trackerData.forEach(row => {
      exportData.push({ [`${row.product} Performance`]: '' });
      exportData.push({
        'Product': row.product,
        'Total Calls': row.totalCalls,
        'Successful Calls': row.successfulCalls,
        'Unsuccessful Calls': row.unsuccessfulCalls,
        'Success Rate (%)': row.successRate.toFixed(2),
        'Unique Called Numbers': row.uniqueCalledNumbers,
        'Unique Calling Numbers': row.uniqueCallingNumbers,
        'Active Agents': row.activeAgents
      });
      exportData.push({});
      exportData.push({ 'Top 5 Agents': '' });
      exportData.push({
        'Rank': 'Rank',
        'Agent Name': 'Agent Name',
        'Calls': 'Calls',
        'Success Rate': 'Success Rate'
      });
      row.topAgents.forEach((agent, index) => {
        exportData.push({
          'Rank': index + 1,
          'Agent Name': agent.name || 'Unknown',
          'Calls': agent.totalCalls || 0,
          'Success Rate': agent.successRate ? `${agent.successRate.toFixed(2)}%` : 'N/A'
        });
      });
      exportData.push({});
    });

    exportToExcel(exportData, 'Call Center Performance Tracker', {
      colWidths: [20, 15, 18, 20, 18, 20, 20, 15, 15, 20, 15, 18]
    });
  };

  if (isLoading) {
    return (
      <div className="section-container">
        <div className="section-header">
          <h3 className="section-title">CALL CENTER PERFORMANCE TRACKER</h3>
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
        <h3 className="section-title">CALL CENTER PERFORMANCE TRACKER</h3>
      </div>
      
      <div className="section-content">
        <div className="tracker-table-container">
          <table className="tracker-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Total Calls</th>
                <th>Successful Calls</th>
                <th>Unsuccessful Calls</th>
                <th>Success Rate</th>
                <th>Unique Called Numbers</th>
                <th>Unique Calling Numbers</th>
                <th>Active Agents</th>
              </tr>
            </thead>
            <tbody>
              {trackerData.length > 0 ? (
                trackerData.map((row, index) => (
                  <tr key={index}>
                    <td className="product-cell">{row.product}</td>
                    <td className="number-cell">{row.totalCalls.toLocaleString()}</td>
                    <td className="number-cell positive">{row.successfulCalls.toLocaleString()}</td>
                    <td className="number-cell negative">{row.unsuccessfulCalls.toLocaleString()}</td>
                    <td className={`number-cell ${row.successRate >= 70 ? 'positive' : row.successRate >= 50 ? 'warning' : 'negative'}`}>
                      {row.successRate.toFixed(1)}%
                    </td>
                    <td className="number-cell">{row.uniqueCalledNumbers.toLocaleString()}</td>
                    <td className="number-cell">{row.uniqueCallingNumbers.toLocaleString()}</td>
                    <td className="number-cell">{row.activeAgents.toLocaleString()}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="8" className="no-data">No data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Top Agents Tables */}
        <div className="agents-container">
          {trackerData.map((row, index) => (
            <div key={index} className="agents-table-wrapper">
              <h4 className="agents-title">{row.product} - Top 5 Agents</h4>
              <table className="agents-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Agent Name</th>
                    <th>Calls</th>
                    <th>Success Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {row.topAgents.length > 0 ? (
                    row.topAgents.map((agent, aIndex) => (
                      <tr key={aIndex}>
                        <td className="rank-cell">{aIndex + 1}</td>
                        <td>{agent.name || 'Unknown'}</td>
                        <td className="number-cell">{agent.totalCalls?.toLocaleString() || '0'}</td>
                        <td className={`number-cell ${agent.successRate >= 70 ? 'positive' : agent.successRate >= 50 ? 'warning' : 'negative'}`}>
                          {agent.successRate ? `${agent.successRate.toFixed(1)}%` : 'N/A'}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="4" className="no-data">No agents data</td>
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

export default CallCenterPerformanceTracker;
