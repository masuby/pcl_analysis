import React, { useMemo, useImperativeHandle, forwardRef } from 'react';
import './CallCenterPerformanceTracker.css';
import { useManagementData } from '../../../../../ManagementDashboard/hooks/useManagementData';
import { useCallCenterData } from '../../../../../CallCenterDashboard/hooks/useCallCenterData';
import { calculateMetrics, getTopAgents, REQUIRED_SUCCESS_CALLS_WEEKLY } from '../../../../../CallCenterDashboard/utils/callCenterUtils';
import { exportSingleSectionWithStyles } from '../../../../utils/excelExportStyled';
import LoadingSpinner from '../../../../../../../../components/Common/Loading/LoadingSpinner';

const WORK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const CallCenterPerformanceTracker = forwardRef(({ mode, userData }, ref) => {
  const { parsedReports: managementReports } = useManagementData();

  // Week dates from latest week in management reports (same as Sales Compliance)
  const weekDates = useMemo(() => {
    if (!managementReports || managementReports.length === 0) return [null, null, null, null, null, null];
    const sorted = [...managementReports].sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
      const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
      return dateB - dateA;
    });
    const latestDate = sorted[0].date ? new Date(sorted[0].date) : new Date(sorted[0].createdAt);
    const dayOfWeek = latestDate.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(latestDate);
    monday.setDate(latestDate.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    const out = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      out.push(d);
    }
    return out;
  }, [managementReports]);

  const ccCS_0 = useCallCenterData('CS', weekDates[0]);
  const ccCS_1 = useCallCenterData('CS', weekDates[1]);
  const ccCS_2 = useCallCenterData('CS', weekDates[2]);
  const ccCS_3 = useCallCenterData('CS', weekDates[3]);
  const ccCS_4 = useCallCenterData('CS', weekDates[4]);
  const ccCS_5 = useCallCenterData('CS', weekDates[5]);
  const ccLBF_0 = useCallCenterData('LBF', weekDates[0]);
  const ccLBF_1 = useCallCenterData('LBF', weekDates[1]);
  const ccLBF_2 = useCallCenterData('LBF', weekDates[2]);
  const ccLBF_3 = useCallCenterData('LBF', weekDates[3]);
  const ccLBF_4 = useCallCenterData('LBF', weekDates[4]);
  const ccLBF_5 = useCallCenterData('LBF', weekDates[5]);
  const ccSME_0 = useCallCenterData('SME', weekDates[0]);
  const ccSME_1 = useCallCenterData('SME', weekDates[1]);
  const ccSME_2 = useCallCenterData('SME', weekDates[2]);
  const ccSME_3 = useCallCenterData('SME', weekDates[3]);
  const ccSME_4 = useCallCenterData('SME', weekDates[4]);
  const ccSME_5 = useCallCenterData('SME', weekDates[5]);

  const ccCS = useCallCenterData('CS');
  const ccLBF = useCallCenterData('LBF');
  const ccSME = useCallCenterData('SME');

  const ccByProductDay = {
    CS: [ccCS_0, ccCS_1, ccCS_2, ccCS_3, ccCS_4, ccCS_5],
    LBF: [ccLBF_0, ccLBF_1, ccLBF_2, ccLBF_3, ccLBF_4, ccLBF_5],
    SME: [ccSME_0, ccSME_1, ccSME_2, ccSME_3, ccSME_4, ccSME_5]
  };

  const trackerData = useMemo(() => {
    const departments = ['CS', 'LBF', 'SME'];

    if (mode === 'MONTHLY') {
      const hooks = { CS: ccCS, LBF: ccLBF, SME: ccSME };
      return departments.map(dept => {
        const hook = hooks[dept];
        if (!hook.parsedData || !hook.parsedData.allCallData) return null;
        const metrics = calculateMetrics(hook.parsedData.allCallData);
        const agentPerformance = hook.parsedData.agentPerformance || [];
        const topAgents = getTopAgents(agentPerformance, 999);
        const successRate = metrics.totalCalls > 0 ? (metrics.successfulCalls / metrics.totalCalls) * 100 : 0;
        const failRate = metrics.totalCalls > 0 ? (metrics.unsuccessfulCalls / metrics.totalCalls) * 100 : 0;
        const agentsWithOver50Calls = agentPerformance.filter(a => (a['Total Calls'] || a['Total_Calls'] || a.totalCalls || 0) > 50).length;
        const agentsWithUnder50Calls = agentPerformance.filter(a => {
          const t = (a['Total Calls'] || a['Total_Calls'] || a.totalCalls || 0);
          return t > 0 && t <= 50;
        }).length;
        const totalAgents = agentPerformance.length;
        return {
          product: dept,
          totalCalls: metrics.totalCalls,
          successfulCalls: metrics.successfulCalls,
          unsuccessfulCalls: metrics.unsuccessfulCalls,
          successRate,
          failRate,
          totalAgents,
          agentsWithOver50Calls,
          percentAgentsOver50: totalAgents > 0 ? (agentsWithOver50Calls / totalAgents * 100) : 0,
          agentsWithUnder50Calls,
          percentAgentsUnder50: totalAgents > 0 ? (agentsWithUnder50Calls / totalAgents * 100) : 0,
          topAgents,
          reportDate: hook.parsedData.reportDate
        };
      }).filter(Boolean);
    }

    // WEEKLY: aggregate 6 days
    return departments.map(dept => {
      const dayHooks = ccByProductDay[dept] || [];
      let sumCalls = 0, sumSuccess = 0, sumUnsuccess = 0;
      const allAgentData = {};
      let lastOver50 = 0, lastUnder50 = 0, lastTotalAgents = 0;

      dayHooks.forEach((h) => {
        if (!h?.parsedData?.allCallData) return;
        const m = calculateMetrics(h.parsedData.allCallData);
        sumCalls += m.totalCalls || 0;
        sumSuccess += m.successfulCalls || 0;
        sumUnsuccess += m.unsuccessfulCalls || 0;
        const agentPerf = h.parsedData.agentPerformance || [];
        lastTotalAgents = agentPerf.length || lastTotalAgents;
        lastOver50 = agentPerf.filter(a => (a['Total Calls'] || a['Total_Calls'] || a.totalCalls || 0) > 50).length || lastOver50;
        lastUnder50 = agentPerf.filter(a => {
          const t = (a['Total Calls'] || a['Total_Calls'] || a.totalCalls || 0);
          return t > 0 && t <= 50;
        }).length || lastUnder50;
        agentPerf.forEach(agent => {
          const name = agent['Agent Name'] || agent['Agent_Name'] || 'Unknown';
          if (!allAgentData[name]) allAgentData[name] = { 'Agent Name': name, successfulCalls: 0, totalCalls: 0 };
          allAgentData[name].successfulCalls += parseInt(agent['Successful Calls'] || agent['Successful_Calls'] || 0);
          allAgentData[name].totalCalls += parseInt(agent['Total Calls'] || agent['Total_Calls'] || 0);
        });
      });

      const mergedAgents = Object.values(allAgentData).map(a => ({
        'Agent Name': a['Agent Name'],
        'Successful Calls': a.successfulCalls,
        'Total Calls': a.totalCalls,
        successRate: a.totalCalls > 0 ? (a.successfulCalls / a.totalCalls) * 100 : 0
      }));
      const topAgents = getTopAgents(mergedAgents, 999);
      const successRate = sumCalls > 0 ? (sumSuccess / sumCalls) * 100 : 0;
      const failRate = sumCalls > 0 ? (sumUnsuccess / sumCalls) * 100 : 0;

      return {
        product: dept,
        totalCalls: sumCalls,
        successfulCalls: sumSuccess,
        unsuccessfulCalls: sumUnsuccess,
        successRate,
        failRate,
        totalAgents: lastTotalAgents,
        agentsWithOver50Calls: lastOver50,
        percentAgentsOver50: lastTotalAgents > 0 ? (lastOver50 / lastTotalAgents * 100) : 0,
        agentsWithUnder50Calls: lastUnder50,
        percentAgentsUnder50: lastTotalAgents > 0 ? (lastUnder50 / lastTotalAgents * 100) : 0,
        topAgents,
        reportDate: weekDates[0]
      };
    }).filter(d => d && (d.totalCalls > 0 || d.topAgents?.length > 0));
  }, [mode, weekDates,
    ccCS.parsedData, ccLBF.parsedData, ccSME.parsedData,
    ccCS_0.parsedData, ccCS_1.parsedData, ccCS_2.parsedData, ccCS_3.parsedData, ccCS_4.parsedData, ccCS_5.parsedData,
    ccLBF_0.parsedData, ccLBF_1.parsedData, ccLBF_2.parsedData, ccLBF_3.parsedData, ccLBF_4.parsedData, ccLBF_5.parsedData,
    ccSME_0.parsedData, ccSME_1.parsedData, ccSME_2.parsedData, ccSME_3.parsedData, ccSME_4.parsedData, ccSME_5.parsedData]);

  const isLoading = ccCS.loading || ccLBF.loading || ccSME.loading;

  const handleExport = async () => {
    const section = getExportSheets()[0];
    if (section) await exportSingleSectionWithStyles(section, 'Call_Center_Performance');
  };

  const getExportSheets = () => {
    const tables = [];
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
      tables.push({
        title: mode === 'WEEKLY' ? 'Call Center Performance Summary (6 Days)' : 'Call Center Performance Summary',
        data: summaryRows,
        colWidths: [12, 15, 18, 18, 14, 14, 14, 14, 14, 14, 14, 14],
        headerColors: { 'Product': '#4472C4', 'Total Calls': '#70AD47', 'Successful Calls': '#ED7D31', 'Total Agents': '#FFC000' },
        accountingColumns: ['Total Calls', 'Successful Calls', 'Unsuccessful Calls', 'Total Agents', '>50 Calls', '<50 Calls']
      });
    }
    trackerData.filter(r => r.product === 'CS' || r.product === 'LBF').forEach(row => {
      const agentRows = row.topAgents.map((agent, idx) => {
        const success = agent.successfulCalls ?? agent['Successful Calls'] ?? 0;
        const total = agent.totalCalls ?? agent['Total Calls'] ?? agent['Total_Calls'] ?? 0;
        const pctSuccess = total > 0 ? (success / total * 100) : 0;
        const pctUnsuccess = total > 0 ? (100 - pctSuccess) : 0;
        const pctReached = REQUIRED_SUCCESS_CALLS_WEEKLY > 0 ? (success / REQUIRED_SUCCESS_CALLS_WEEKLY * 100) : 0;
        const pctNotReached = 100 - pctReached;
        return {
          'Agent Name': agent.name || agent['Agent Name'] || agent['Agent_Name'] || 'Unknown',
          'Total Calls': total,
          'Success Calls': success,
          '% Success': pctSuccess.toFixed(1) + '%',
          '% Unsuccess': pctUnsuccess.toFixed(1) + '%',
          'Required Calls': REQUIRED_SUCCESS_CALLS_WEEKLY,
          '% Calls Reached': pctReached.toFixed(1) + '%',
          '% Calls Not Reached': pctNotReached.toFixed(1) + '%'
        };
      });
      if (agentRows.length > 0) {
        tables.push({
          title: `${row.product} Agents`,
          data: agentRows,
          colWidths: [22, 14, 14, 12, 12, 14, 14, 14],
          headerColors: { 'Agent Name': '#4472C4', 'Total Calls': '#70AD47', 'Success Calls': '#ED7D31', 'Required Calls': '#FFC000', '% Calls Reached': '#5B9BD5' },
          accountingColumns: ['Total Calls', 'Success Calls', 'Required Calls']
        });
      }
    });
    if (tables.length === 0) return [];
    return [{ name: 'Call Center Performance', tables }];
  };

  useImperativeHandle(ref, () => ({ getExportSheets }), [trackerData, mode]);

  const formatValue = (value) => {
    if (value === null || value === undefined || value === 0) return '-';
    if (typeof value === 'number') return value.toLocaleString();
    return value;
  };

  const csRow = trackerData.find(r => r.product === 'CS');
  const lbfRow = trackerData.find(r => r.product === 'LBF');
  const smeRow = trackerData.find(r => r.product === 'SME');

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
        {mode === 'WEEKLY' && <span className="cct-mode-badge">Weekly (6 Days)</span>}
      </div>

      <div className="cct-content">
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
                    <td className="cct-td-percent cct-negative">{row.failRate.toFixed(1)}%</td>
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

        <div className="cct-agents-section">
          <div className="cct-agents-grid cct-agents-cs-lbf">
            <div className="cct-agents-card">
              <h4 className="cct-agents-title">CS Agents</h4>
              <table className="cct-agents-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Agent Name</th>
                    <th>Total Calls</th>
                    <th>Success Calls</th>
                    <th>% Success</th>
                    <th>% Unsuccess</th>
                    <th>Required (275)</th>
                    <th>% Reached</th>
                    <th>% Not Reached</th>
                  </tr>
                </thead>
                <tbody>
                  {(csRow?.topAgents || []).length > 0 ? (
                    csRow.topAgents.map((agent, aIndex) => {
                      const success = agent.successfulCalls ?? agent['Successful Calls'] ?? 0;
                      const total = agent.totalCalls ?? agent['Total Calls'] ?? 0;
                      const pctSuccess = total > 0 ? (success / total * 100) : 0;
                      const pctUnsuccess = total > 0 ? (100 - pctSuccess) : 0;
                      const pctReached = REQUIRED_SUCCESS_CALLS_WEEKLY > 0 ? (success / REQUIRED_SUCCESS_CALLS_WEEKLY * 100) : 0;
                      const pctNotReached = 100 - pctReached;
                      return (
                        <tr key={aIndex}>
                          <td className="cct-rank-cell">{aIndex + 1}</td>
                          <td>{agent.name || agent['Agent Name'] || 'Unknown'}</td>
                          <td className="cct-td-number">{formatValue(total)}</td>
                          <td className="cct-td-number cct-positive">{formatValue(success)}</td>
                          <td className={`cct-td-percent ${pctSuccess >= 70 ? 'cct-positive' : pctSuccess >= 50 ? 'cct-warning' : 'cct-negative'}`}>{pctSuccess.toFixed(1)}%</td>
                          <td className="cct-td-percent cct-negative">{pctUnsuccess.toFixed(1)}%</td>
                          <td className="cct-td-number">{REQUIRED_SUCCESS_CALLS_WEEKLY}</td>
                          <td className={`cct-td-percent ${pctReached >= 100 ? 'cct-positive' : pctReached >= 80 ? 'cct-warning' : 'cct-negative'}`}>{pctReached.toFixed(1)}%</td>
                          <td className="cct-td-percent">{pctNotReached.toFixed(1)}%</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr><td colSpan="9" className="cct-no-data">No agents data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="cct-agents-card">
              <h4 className="cct-agents-title">LBF Agents</h4>
              <table className="cct-agents-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Agent Name</th>
                    <th>Total Calls</th>
                    <th>Success Calls</th>
                    <th>% Success</th>
                    <th>% Unsuccess</th>
                    <th>Required (275)</th>
                    <th>% Reached</th>
                    <th>% Not Reached</th>
                  </tr>
                </thead>
                <tbody>
                  {(lbfRow?.topAgents || []).length > 0 ? (
                    lbfRow.topAgents.map((agent, aIndex) => {
                      const success = agent.successfulCalls ?? agent['Successful Calls'] ?? 0;
                      const total = agent.totalCalls ?? agent['Total Calls'] ?? 0;
                      const pctSuccess = total > 0 ? (success / total * 100) : 0;
                      const pctUnsuccess = total > 0 ? (100 - pctSuccess) : 0;
                      const pctReached = REQUIRED_SUCCESS_CALLS_WEEKLY > 0 ? (success / REQUIRED_SUCCESS_CALLS_WEEKLY * 100) : 0;
                      const pctNotReached = 100 - pctReached;
                      return (
                        <tr key={aIndex}>
                          <td className="cct-rank-cell">{aIndex + 1}</td>
                          <td>{agent.name || agent['Agent Name'] || 'Unknown'}</td>
                          <td className="cct-td-number">{formatValue(total)}</td>
                          <td className="cct-td-number cct-positive">{formatValue(success)}</td>
                          <td className={`cct-td-percent ${pctSuccess >= 70 ? 'cct-positive' : pctSuccess >= 50 ? 'cct-warning' : 'cct-negative'}`}>{pctSuccess.toFixed(1)}%</td>
                          <td className="cct-td-percent cct-negative">{pctUnsuccess.toFixed(1)}%</td>
                          <td className="cct-td-number">{REQUIRED_SUCCESS_CALLS_WEEKLY}</td>
                          <td className={`cct-td-percent ${pctReached >= 100 ? 'cct-positive' : pctReached >= 80 ? 'cct-warning' : 'cct-negative'}`}>{pctReached.toFixed(1)}%</td>
                          <td className="cct-td-percent">{pctNotReached.toFixed(1)}%</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr><td colSpan="9" className="cct-no-data">No agents data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {smeRow && (smeRow.topAgents?.length > 0) && (
            <div className="cct-agents-card cct-agents-sme">
              <h4 className="cct-agents-title">SME Agents</h4>
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
                  {smeRow.topAgents.map((agent, aIndex) => (
                    <tr key={aIndex}>
                      <td className="cct-rank-cell">{aIndex + 1}</td>
                      <td>{agent.name || agent['Agent Name'] || 'Unknown'}</td>
                      <td className="cct-td-number">{formatValue(agent.totalCalls || agent['Total Calls'] || 0)}</td>
                      <td className={`cct-td-percent ${(agent.successRate || 0) >= 70 ? 'cct-positive' : (agent.successRate || 0) >= 50 ? 'cct-warning' : 'cct-negative'}`}>
                        {agent.successRate ? `${agent.successRate.toFixed(1)}%` : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
