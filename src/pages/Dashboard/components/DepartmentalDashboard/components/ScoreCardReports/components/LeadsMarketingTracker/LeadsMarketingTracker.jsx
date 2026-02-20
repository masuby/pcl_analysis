import React, { useMemo, useImperativeHandle, forwardRef } from 'react';
import './LeadsMarketingTracker.css';
import { useManagementData } from '../../../../../ManagementDashboard/hooks/useManagementData';
import { useCRMData } from '../../../../../CRMdashboard/hooks/useCRMData';
import { extractMetrics } from '../../../../../CRMdashboard/utils/crmUtils';
import { exportSingleSectionWithStyles } from '../../../../utils/excelExportStyled';
import LoadingSpinner from '../../../../../../../../components/Common/Loading/LoadingSpinner';

const WORK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const formatDayDate = (d) => {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const LeadsMarketingTracker = forwardRef(({ mode, userData }, ref) => {
  const { parsedReports: managementReports } = useManagementData();
  const crmCS = useCRMData('CS');
  const crmLBF = useCRMData('LBF');
  const crmSME = useCRMData('SME');

  // Week dates from latest week in management reports (same as Sales Compliance Summary)
  const weekDates = useMemo(() => {
    if (!managementReports || managementReports.length === 0) {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diff);
      monday.setHours(0, 0, 0, 0);
      const out = [];
      for (let i = 0; i < 6; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        out.push(d);
      }
      return out;
    }
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

  const crmCS_0 = useCRMData('CS', weekDates[0]);
  const crmCS_1 = useCRMData('CS', weekDates[1]);
  const crmCS_2 = useCRMData('CS', weekDates[2]);
  const crmCS_3 = useCRMData('CS', weekDates[3]);
  const crmCS_4 = useCRMData('CS', weekDates[4]);
  const crmCS_5 = useCRMData('CS', weekDates[5]);
  const crmLBF_0 = useCRMData('LBF', weekDates[0]);
  const crmLBF_1 = useCRMData('LBF', weekDates[1]);
  const crmLBF_2 = useCRMData('LBF', weekDates[2]);
  const crmLBF_3 = useCRMData('LBF', weekDates[3]);
  const crmLBF_4 = useCRMData('LBF', weekDates[4]);
  const crmLBF_5 = useCRMData('LBF', weekDates[5]);
  const crmSME_0 = useCRMData('SME', weekDates[0]);
  const crmSME_1 = useCRMData('SME', weekDates[1]);
  const crmSME_2 = useCRMData('SME', weekDates[2]);
  const crmSME_3 = useCRMData('SME', weekDates[3]);
  const crmSME_4 = useCRMData('SME', weekDates[4]);
  const crmSME_5 = useCRMData('SME', weekDates[5]);

  const crmByProductDay = {
    CS: [crmCS_0, crmCS_1, crmCS_2, crmCS_3, crmCS_4, crmCS_5],
    LBF: [crmLBF_0, crmLBF_1, crmLBF_2, crmLBF_3, crmLBF_4, crmLBF_5],
    SME: [crmSME_0, crmSME_1, crmSME_2, crmSME_3, crmSME_4, crmSME_5]
  };

  const getMetricsFromParsed = (parsedData) => {
    if (!parsedData?.emailData) return null;
    const metrics = extractMetrics(parsedData.emailData);
    const getValue = (keys, defaultVal = 0) => {
      for (const key of keys) {
        const val = metrics[key.toLowerCase()];
        if (val !== undefined && val !== null && val !== '') {
          const num = parseFloat(val) || 0;
          if (num >= 0) return num;
        }
      }
      return defaultVal;
    };
    const numberOfLeads = getValue(['lead', 'count_leads', 'leads']);
    const prospectLeads = getValue(['prospect_lead', 'prospect', 'prospects']);
    const totalAgents = getValue(['total_agent', 'total_count_agent', 'total agents']);
    const loggedInAgents = getValue(['total_agent_logged_in', 'logged_in_agent', 'logged_in_agents']);
    const agentsCompletedAtLocation = getValue(['agent_completed_at_location', 'agents_completed_at_location']);
    const totalTLS = getValue(['count_team_leaders', 'total_count_team_leaders', 'total_tls']);
    const loggedInTLS = getValue(['logged_in_team_leaders', 'logged_in_tls']);
    const tlsCompletedAtLocation = getValue(['team_leaders_completed_at_location', 'tl_completed_activities_at_location']);
    return {
      numberOfLeads,
      prospectLeads,
      conversionRate: numberOfLeads > 0 ? (prospectLeads / numberOfLeads) * 100 : 0,
      totalAgents,
      loggedInAgents,
      agentLoginRate: totalAgents > 0 ? (loggedInAgents / totalAgents) * 100 : 0,
      agentsCompletedAtLocation,
      agentCompletionRate: totalAgents > 0 ? (agentsCompletedAtLocation / totalAgents) * 100 : 0,
      totalTLS,
      loggedInTLS,
      tlsLoginRate: totalTLS > 0 ? (loggedInTLS / totalTLS) * 100 : 0,
      tlsCompletedAtLocation,
      tlsCompletionRate: totalTLS > 0 ? (tlsCompletedAtLocation / totalTLS) * 100 : 0,
      totalFieldForce: totalAgents + totalTLS
    };
  };

  const trackerData = useMemo(() => {
    const departments = ['CS', 'LBF', 'SME'];
    if (mode === 'MONTHLY') {
      const hooks = { CS: crmCS, LBF: crmLBF, SME: crmSME };
      return departments.map(dept => {
        const hook = hooks[dept];
        const m = getMetricsFromParsed(hook?.parsedData);
        if (!m) return null;
        return {
          product: dept,
          day: 'Monthly',
          dayDate: null,
          isTotalRow: false,
          ...m
        };
      }).filter(Boolean);
    }
    const rows = [];
    departments.forEach(product => {
      WORK_DAYS.forEach((day, dayIndex) => {
        const hook = crmByProductDay[product]?.[dayIndex];
        const m = getMetricsFromParsed(hook?.parsedData);
        const dayDate = weekDates[dayIndex];
        const dayLabel = dayDate ? `${day} (${formatDayDate(dayDate)})` : day;
        rows.push({
          product,
          day: dayLabel,
          dayDate: dayDate ? formatDayDate(dayDate) : '-',
          isTotalRow: false,
          numberOfLeads: m?.numberOfLeads ?? '-',
          prospectLeads: m?.prospectLeads ?? '-',
          conversionRate: m?.conversionRate ?? '-',
          totalAgents: m?.totalAgents ?? '-',
          loggedInAgents: m?.loggedInAgents ?? '-',
          agentLoginRate: m?.agentLoginRate ?? '-',
          agentsCompletedAtLocation: m?.agentsCompletedAtLocation ?? '-',
          agentCompletionRate: m?.agentCompletionRate ?? '-',
          totalTLS: m?.totalTLS ?? '-',
          loggedInTLS: m?.loggedInTLS ?? '-',
          tlsLoginRate: m?.tlsLoginRate ?? '-',
          tlsCompletedAtLocation: m?.tlsCompletedAtLocation ?? '-',
          tlsCompletionRate: m?.tlsCompletionRate ?? '-',
          totalFieldForce: m?.totalFieldForce ?? '-'
        });
      });
      const dayHooks = crmByProductDay[product] || [];
      let sumLeads = 0, sumProspect = 0, sumAgentLoc = 0, sumTlsLoc = 0;
      let lastAgents = 0, lastLoggedAgents = 0, lastTLS = 0, lastLoggedTLS = 0;
      dayHooks.forEach(h => {
        const m = getMetricsFromParsed(h?.parsedData);
        if (m) {
          sumLeads += m.numberOfLeads || 0;
          sumProspect += m.prospectLeads || 0;
          sumAgentLoc += m.agentsCompletedAtLocation || 0;
          sumTlsLoc += m.tlsCompletedAtLocation || 0;
          lastAgents = m.totalAgents ?? lastAgents;
          lastLoggedAgents = m.loggedInAgents ?? lastLoggedAgents;
          lastTLS = m.totalTLS ?? lastTLS;
          lastLoggedTLS = m.loggedInTLS ?? lastLoggedTLS;
        }
      });
      const convRate = sumLeads > 0 ? (sumProspect / sumLeads) * 100 : 0;
      const agentRate = lastAgents > 0 ? (lastLoggedAgents / lastAgents) * 100 : 0;
      const tlsRate = lastTLS > 0 ? (lastLoggedTLS / lastTLS) * 100 : 0;
      const agentCompRate = lastAgents > 0 ? (sumAgentLoc / lastAgents) * 100 : 0;
      const tlsCompRate = lastTLS > 0 ? (sumTlsLoc / lastTLS) * 100 : 0;
      rows.push({
        product,
        day: 'Total/Average/Movement',
        dayDate: '-',
        isTotalRow: true,
        numberOfLeads: sumLeads,
        prospectLeads: sumProspect,
        conversionRate: convRate,
        totalAgents: lastAgents,
        loggedInAgents: lastLoggedAgents,
        agentLoginRate: agentRate,
        agentsCompletedAtLocation: sumAgentLoc,
        agentCompletionRate: agentCompRate,
        totalTLS: lastTLS,
        loggedInTLS: lastLoggedTLS,
        tlsLoginRate: tlsRate,
        tlsCompletedAtLocation: sumTlsLoc,
        tlsCompletionRate: tlsCompRate,
        totalFieldForce: lastAgents + lastTLS
      });
    });
    return rows;
  }, [mode, crmCS.parsedData, crmLBF.parsedData, crmSME.parsedData, weekDates,
    crmCS_0.parsedData, crmCS_1.parsedData, crmCS_2.parsedData, crmCS_3.parsedData, crmCS_4.parsedData, crmCS_5.parsedData,
    crmLBF_0.parsedData, crmLBF_1.parsedData, crmLBF_2.parsedData, crmLBF_3.parsedData, crmLBF_4.parsedData, crmLBF_5.parsedData,
    crmSME_0.parsedData, crmSME_1.parsedData, crmSME_2.parsedData, crmSME_3.parsedData, crmSME_4.parsedData, crmSME_5.parsedData]);

  const isLoading = crmCS.loading || crmLBF.loading || crmSME.loading;

  const toExportVal = (v) => {
    if (v === '-' || v == null || v === undefined) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? v : (v.toFixed ? v.toFixed(2) : v);
    return v;
  };

  const handleExport = async () => {
    const section = getExportSheets()[0];
    if (section) await exportSingleSectionWithStyles(section, 'Leads_Marketing_Tracker');
  };

  const getExportSheets = () => {
    const exportData = trackerData.map(row => ({
      'Product': row.product,
      ...(mode === 'WEEKLY' ? { 'Day': row.day, 'Date': row.dayDate } : {}),
      'Number of Leads': toExportVal(row.numberOfLeads),
      'Prospect Leads': toExportVal(row.prospectLeads),
      'Conversion Rate (%)': typeof row.conversionRate === 'number' ? row.conversionRate.toFixed(2) : row.conversionRate,
      'Total Agents': toExportVal(row.totalAgents),
      'Logged In Agents': toExportVal(row.loggedInAgents),
      'Agent Login Rate (%)': typeof row.agentLoginRate === 'number' ? row.agentLoginRate.toFixed(2) : row.agentLoginRate,
      'Agents at Location': toExportVal(row.agentsCompletedAtLocation),
      'Agent Completion (%)': typeof row.agentCompletionRate === 'number' ? row.agentCompletionRate.toFixed(2) : row.agentCompletionRate,
      'Total TLS': toExportVal(row.totalTLS),
      'Logged In TLS': toExportVal(row.loggedInTLS),
      'TLS Login Rate (%)': typeof row.tlsLoginRate === 'number' ? row.tlsLoginRate.toFixed(2) : row.tlsLoginRate,
      'TLS at Location': toExportVal(row.tlsCompletedAtLocation),
      'TLS Completion (%)': typeof row.tlsCompletionRate === 'number' ? row.tlsCompletionRate.toFixed(2) : row.tlsCompletionRate,
      'Total Field Force': toExportVal(row.totalFieldForce)
    }));
    if (exportData.length === 0) return [];
    const totalRowIndices = trackerData.map((r, i) => r.isTotalRow ? i : null).filter(x => x != null);
    const colWidths = mode === 'WEEKLY' ? [12, 22, 12, 15, 15, 18, 15, 18, 18, 18, 18, 12, 15, 18, 15, 18, 18] : [12, 15, 15, 18, 15, 18, 18, 18, 18, 12, 15, 18, 15, 18, 18];
    const headerColors = { 'Product': '#4472C4', 'Day': '#70AD47', 'Number of Leads': '#70AD47', 'Total Agents': '#ED7D31', 'Total TLS': '#FFC000' };
    const freezeCol = mode === 'WEEKLY' ? 3 : 1;
    return [{ name: 'Leads Marketing Tracker', tables: [{ data: exportData, totalRowIndices, colWidths, headerColors }], freeze: { row: 1, col: freezeCol } }];
  };

  useImperativeHandle(ref, () => ({ getExportSheets }), [trackerData, mode]);

  const formatValue = (value) => {
    if (value === null || value === undefined || value === 0) return '-';
    if (typeof value === 'number') return value.toLocaleString();
    return value;
  };

  if (isLoading) {
    return (
      <div className="lmt-container">
        <div className="lmt-header">
          <h3 className="lmt-title">LEADS AND MARKETING TRACKER</h3>
        </div>
        <div className="lmt-loading">
          <LoadingSpinner size="medium" />
        </div>
      </div>
    );
  }

  const renderPercent = (val) => (typeof val === 'number' ? val.toFixed(1) + '%' : val);
  const colSpan = mode === 'WEEKLY' ? 15 : 13;

  return (
    <div className="lmt-container">
      <div className="lmt-header">
        <h3 className="lmt-title">LEADS AND MARKETING TRACKER</h3>
        {mode === 'WEEKLY' && <span className="lmt-mode-badge">Weekly View</span>}
      </div>
      
      <div className="lmt-content">
        <div className="lmt-table-wrapper">
          <table className="lmt-table">
            <thead>
              <tr>
                <th className="lmt-th-product" rowSpan="2">Product</th>
                {mode === 'WEEKLY' && (
                  <>
                    <th className="lmt-th-day" rowSpan="2">Day</th>
                    <th className="lmt-th-day" rowSpan="2">Date</th>
                  </>
                )}
                <th className="lmt-th-leads" colSpan="3">LEADS</th>
                <th className="lmt-th-agents" colSpan="4">AGENTS</th>
                <th className="lmt-th-tls" colSpan="4">TEAM LEADERS</th>
                <th className="lmt-th-activity" rowSpan="2">Total Field Force</th>
              </tr>
              <tr>
                <th className="lmt-th-leads">Leads</th>
                <th className="lmt-th-leads">Prospect</th>
                <th className="lmt-th-leads">Conv. %</th>
                <th className="lmt-th-agents">Total</th>
                <th className="lmt-th-agents">Logged In</th>
                <th className="lmt-th-agents">Login %</th>
                <th className="lmt-th-agents">At Location</th>
                <th className="lmt-th-tls">Total</th>
                <th className="lmt-th-tls">Logged In</th>
                <th className="lmt-th-tls">Login %</th>
                <th className="lmt-th-tls">At Location</th>
              </tr>
            </thead>
            <tbody>
              {trackerData.length > 0 ? (
                trackerData.map((row, index) => (
                  <tr key={index} className={row.isTotalRow ? 'lmt-row-total' : ''}>
                    <td className="lmt-td-product">{row.product}</td>
                    {mode === 'WEEKLY' && (
                      <>
                        <td className="lmt-td-day">{row.day}</td>
                        <td className="lmt-td-day">{row.dayDate}</td>
                      </>
                    )}
                    <td className="lmt-td-number">{formatValue(row.numberOfLeads)}</td>
                    <td className="lmt-td-number">{formatValue(row.prospectLeads)}</td>
                    <td className={`lmt-td-percent ${typeof row.conversionRate === 'number' ? (row.conversionRate >= 50 ? 'lmt-positive' : row.conversionRate >= 30 ? 'lmt-warning' : 'lmt-negative') : ''}`}>
                      {renderPercent(row.conversionRate)}
                    </td>
                    <td className="lmt-td-number">{formatValue(row.totalAgents)}</td>
                    <td className="lmt-td-number">{formatValue(row.loggedInAgents)}</td>
                    <td className={`lmt-td-percent ${typeof row.agentLoginRate === 'number' ? (row.agentLoginRate >= 80 ? 'lmt-positive' : row.agentLoginRate >= 60 ? 'lmt-warning' : 'lmt-negative') : ''}`}>
                      {renderPercent(row.agentLoginRate)}
                    </td>
                    <td className="lmt-td-number">{formatValue(row.agentsCompletedAtLocation)}</td>
                    <td className="lmt-td-number">{formatValue(row.totalTLS)}</td>
                    <td className="lmt-td-number">{formatValue(row.loggedInTLS)}</td>
                    <td className={`lmt-td-percent ${typeof row.tlsLoginRate === 'number' ? (row.tlsLoginRate >= 80 ? 'lmt-positive' : row.tlsLoginRate >= 60 ? 'lmt-warning' : 'lmt-negative') : ''}`}>
                      {renderPercent(row.tlsLoginRate)}
                    </td>
                    <td className="lmt-td-number">{formatValue(row.tlsCompletedAtLocation)}</td>
                    <td className="lmt-td-number">{formatValue(row.totalFieldForce)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={colSpan} className="lmt-no-data">No data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="lmt-footer">
        <button className="lmt-export-btn" onClick={handleExport} title="Download this section as Excel">
          <span className="lmt-export-icon">📥</span>
        </button>
      </div>
    </div>
  );
});

LeadsMarketingTracker.displayName = 'LeadsMarketingTracker';
export default LeadsMarketingTracker;
