import React, { useMemo, useImperativeHandle, forwardRef } from 'react';
import './CallCenterPerformanceTracker.css';
// Call Center Performance Tracker Component
import { useCallCenterData } from '../../../../../CallCenterDashboard/hooks/useCallCenterData';
import { calculateMetrics, getTopAgents } from '../../../../../CallCenterDashboard/utils/callCenterUtils';
import { exportSingleSectionWithStyles } from '../../../../utils/excelExportStyled';
import LoadingSpinner from '../../../../../../../../components/Common/Loading/LoadingSpinner';

const CallCenterPerformanceTracker = forwardRef(({ mode, userData }, ref) => {
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
      const failRate = metrics.totalCalls > 0 ? (metrics.unsuccessfulCalls / metrics.totalCalls) * 100 : 0;
      
      // Count agents with > 50 calls
      const agentPerformance = hook.parsedData.agentPerformance || [];
      const agentsWithOver50Calls = agentPerformance.filter(agent => {
        const totalCalls = agent['Total Calls'] || agent['Total_Calls'] || agent.totalCalls || 0;
        return totalCalls > 50;
      }).length;
      const agentsWithUnder50Calls = agentPerformance.filter(agent => {
        const totalCalls = agent['Total Calls'] || agent['Total_Calls'] || agent.totalCalls || 0;
        return totalCalls > 0 && totalCalls <= 50;
      }).length;
      
      const totalAgents = agentPerformance.length;
      
      return {
        product: dept,
        totalCalls: metrics.totalCalls,
        successfulCalls: metrics.successfulCalls,
        unsuccessfulCalls: metrics.unsuccessfulCalls,
        successRate,
        failRate,
        uniqueCalledNumbers: metrics.distinctCalledNumbers,
        uniqueCallingNumbers: metrics.distinctCallingNumbers,
        totalAgents,
        agentsWithOver50Calls,
        percentAgentsOver50: totalAgents > 0 ? (agentsWithOver50Calls / totalAgents * 100) : 0,
        agentsWithUnder50Calls,
        percentAgentsUnder50: totalAgents > 0 ? (agentsWithUnder50Calls / totalAgents * 100) : 0,
        topAgents,
        reportDate: hook.parsedData.reportDate
      };
    }).filter(Boolean);
  }, [callCenterCS.parsedData, callCenterLBF.parsedData, callCenterSME.parsedData]);

  const isLoading = callCenterCS.loading || callCenterLBF.loading || callCenterSME.loading;

  const handleExport = () => {
    const section = getExportSheets()[0];
    if (section) exportSingleSectionWithStyles(section, 'Call_Center_Performance');
  };

  const getExportSheets = () => {
    const sheets = [];
    const summaryRows = trackerData.map(row => ({
      'Product': row.product,
      'Total Calls': row.totalCalls,
      'Successful Calls': row.successfulCalls,
      'Unsuccessful Calls': row.unsuccessfulCalls,
      '% Successful': row.successRate.toFixed(1) + '%',
      '% Unsuccessful': row.failRate.toFixed(1) + '%',
      'Total Agents': row.totalAgents,
      '>50 Calls': row.agentsWithOver50Calls,
      '% >50': row.percentAgentsOver50.toFixed(1) + '%',
      '<50 Calls': row.agentsWithUnder50Calls,
      '% <50': row.percentAgentsUnder50.toFixed(1) + '%'
    }));
    if (summaryRows.length > 0) {
      sheets.push({
        name: 'Call Center Performance',
        data: summaryRows,
        colWidths: [12, 15, 18, 18, 14, 14, 14, 14, 14, 14, 14, 14],
        headerColors: { 'Product': '#4472C4', 'Total Calls': '#70AD47', 'Successful Calls': '#ED7D31', 'Total Agents': '#FFC000' }
      });
    }
    trackerData.forEach(row => {
      const agentRows = row.topAgents.map((agent, idx) => ({
        'Rank': idx + 1,
        'Agent Name': agent.name || agent['Agent Name'] || agent['Agent_Name'] || 'Unknown',
        'Total Calls': agent.totalCalls || agent['Total Calls'] || agent['Total_Calls'] || 0,
        'Success Rate': agent.successRate ? agent.successRate.toFixed(1) + '%' : 'N/A'
      }));
      if (agentRows.length > 0) sheets.push({ name: `Call Center ${row.product} Top Agents`, data: agentRows, colWidths: [8, 22, 14, 14], headerColors: { 'Rank': '#4472C4', 'Agent Name': '#70AD47', 'Total Calls': '#ED7D31' } });
    });
    return sheets;
  };

  useImperativeHandle(ref, () => ({ getExportSheets }), [trackerData]);

  const formatValue = (value) => {
    if (value === null || value === undefined || value === 0) return '-';
    if (typeof value === 'number') return value.toLocaleString();
    return value;
  };

  if (isLoading) {
    return (
      <div className="cct-container">
        <div className="cct-header">
          <h3 className="cct-title">CALL CENTER PERFORMANCE TRACKER</h3>
        </div>
        <div className="cct-loading">
          <LoadingSpinner size="medium" />
        </div>
      </div>
    );
  }

  return (
    <div className="cct-container">
      <div className="cct-header">
        <h3 className="cct-title">CALL CENTER PERFORMANCE TRACKER</h3>
      </div>
      
      <div className="cct-content">
        {/* Summary Table */}
        <div className="cct-table-wrapper">
          <table className="cct-table">
            <thead>
              <tr>
                <th className="cct-th-product">Product</th>
                <th className="cct-th-calls">Total Calls</th>
                <th className="cct-th-success">Successful</th>
                <th className="cct-th-fail">Unsuccessful</th>
                <th className="cct-th-success">% Success</th>
                <th className="cct-th-fail">% Fail</th>
                <th className="cct-th-agents">Total Agents</th>
                <th className="cct-th-agents">&gt;50 Calls</th>
                <th className="cct-th-agents">% &gt;50</th>
                <th className="cct-th-agents">&lt;50 Calls</th>
                <th className="cct-th-agents">% &lt;50</th>
              </tr>
            </thead>
            <tbody>
              {trackerData.length > 0 ? (
                trackerData.map((row, index) => (
                  <tr key={index}>
                    <td className="cct-td-product">{row.product}</td>
                    <td className="cct-td-number">{formatValue(row.totalCalls)}</td>
                    <td className="cct-td-number cct-positive">{formatValue(row.successfulCalls)}</td>
                    <td className="cct-td-number cct-negative">{formatValue(row.unsuccessfulCalls)}</td>
                    <td className={`cct-td-percent ${row.successRate >= 70 ? 'cct-positive' : row.successRate >= 50 ? 'cct-warning' : 'cct-negative'}`}>
                      {row.successRate.toFixed(1)}%
                    </td>
                    <td className="cct-td-percent cct-negative">
                      {row.failRate.toFixed(1)}%
                    </td>
                    <td className="cct-td-number">{formatValue(row.totalAgents)}</td>
                    <td className="cct-td-number">{formatValue(row.agentsWithOver50Calls)}</td>
                    <td className={`cct-td-percent ${row.percentAgentsOver50 >= 80 ? 'cct-positive' : row.percentAgentsOver50 >= 50 ? 'cct-warning' : 'cct-negative'}`}>
                      {row.percentAgentsOver50.toFixed(1)}%
                    </td>
                    <td className="cct-td-number">{formatValue(row.agentsWithUnder50Calls)}</td>
                    <td className="cct-td-percent">{row.percentAgentsUnder50.toFixed(1)}%</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="11" className="cct-no-data">No data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Top Agents Section */}
        <div className="cct-agents-section">
          <div className="cct-agents-grid">
            {trackerData.map((row, index) => (
              <div key={index} className="cct-agents-card">
                <h4 className="cct-agents-title">{row.product} - Top 5 Agents</h4>
                <table className="cct-agents-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Agent Name</th>
                      <th>Calls</th>
                      <th>Success Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.topAgents.length > 0 ? (
                      row.topAgents.map((agent, aIndex) => {
                        const agentName = agent.name || agent['Agent Name'] || agent['Agent_Name'] || 'Unknown';
                        const totalCalls = agent.totalCalls || agent['Total Calls'] || agent['Total_Calls'] || 0;
                        const sRate = agent.successRate || 0;
                        
                        return (
                          <tr key={aIndex}>
                            <td className="cct-rank-cell">{aIndex + 1}</td>
                            <td>{agentName}</td>
                            <td className="cct-td-number">{formatValue(totalCalls)}</td>
                            <td className={`cct-td-percent ${sRate >= 70 ? 'cct-positive' : sRate >= 50 ? 'cct-warning' : 'cct-negative'}`}>
                              {sRate ? `${sRate.toFixed(1)}%` : 'N/A'}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan="4" className="cct-no-data">No agents data</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="cct-footer">
        <button className="cct-export-btn" onClick={handleExport} title="Download this section as Excel">
          <span className="cct-export-icon">📥</span>
        </button>
      </div>
    </div>
  );
});

CallCenterPerformanceTracker.displayName = 'CallCenterPerformanceTracker';
export default CallCenterPerformanceTracker;
