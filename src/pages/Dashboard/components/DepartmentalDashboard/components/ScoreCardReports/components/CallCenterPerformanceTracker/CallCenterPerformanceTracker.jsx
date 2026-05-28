import { useMemo, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import './CallCenterPerformanceTracker.css';
import { useManagementData } from '../../../../../ManagementDashboard/hooks/useManagementData';
import { useCallCenterData } from '../../../../../CallCenterDashboard/hooks/useCallCenterData';
import { calculateMetrics, getTopAgents, REQUIRED_SUCCESS_CALLS_WEEKLY } from '../../../../../CallCenterDashboard/utils/callCenterUtils';
import { exportSingleSectionWithStyles } from '../../../../utils/excelExportStyled';
import LoadingSpinner from '../../../../../../../../components/Common/Loading/LoadingSpinner';
import { getReportsByDepartmentAndType, getReportFileUrl } from '../../../../../../../../services/reports';

const WORK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const normalizeName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const tokenizeName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const levenshtein = (a, b) => {
  const s = String(a || '');
  const t = String(b || '');
  if (!s) return t.length;
  if (!t) return s.length;
  const dp = Array.from({ length: s.length + 1 }, () => Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i++) dp[i][0] = i;
  for (let j = 0; j <= t.length; j++) dp[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[s.length][t.length];
};
const tokenSimilarity = (a, b) => {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  const dist = levenshtein(a, b);
  return maxLen > 0 ? 1 - (dist / maxLen) : 0;
};
const nameSimilarity = (nameA, nameB) => {
  const ta = tokenizeName(nameA);
  const tb = tokenizeName(nameB);
  if (!ta.length || !tb.length) return 0;
  let best = 0;
  ta.forEach((x) => tb.forEach((y) => { best = Math.max(best, tokenSimilarity(x, y)); }));
  const fullSim = tokenSimilarity(normalizeName(nameA), normalizeName(nameB));
  return Math.max(best, fullSim * 0.9);
};

const extractCallCenterSheetMetrics = (wb, sheetName) => {
  if (!wb?.SheetNames?.includes(sheetName)) return {};
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  if (!rows?.length) return {};
  const headers = rows[0] || [];
  const col = (name) => headers.findIndex((h) => String(h || '').trim().toLowerCase() === name.toLowerCase());
  const idxName = 1;
  const idxNumberOfLoans = col('Number of loans');
  const idxDisb = col('Disbursement this Month');
  const idxActiveClients = col('Active clients');
  const idxAvgLoan = col('Average loan size');
  const idxTarget = col('Target');
  const idxPctAchieved = col('% of Target Achieved');
  const idxPortfolio = col('Portfolio');
  const idxPar30 = col('PAR>30');
  const out = {};
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (String(row[0] || '').trim().toLowerCase() !== 'sales rep') continue;
    const agentName = String(row[idxName] || '').trim();
    if (!agentName) continue;
    out[normalizeName(agentName)] = {
      rawName: agentName,
      noLoans: Number(row[idxNumberOfLoans] || 0) || 0,
      disbursement: Number(row[idxDisb] || 0) || 0,
      activeAgents: (Number(row[idxDisb] || 0) || 0) !== 0 ? 1 : 0,
      avgLoanPerAgent: Number(row[idxAvgLoan] || 0) || 0,
      target: Number(row[idxTarget] || 0) || 0,
      pctAchieved: Number(row[idxPctAchieved] || 0) || 0,
      portfolio: Number(row[idxPortfolio] || 0) || 0,
      par30: Number(row[idxPar30] || 0) || 0
    };
  }
  return out;
};

const findBestAgentMetrics = (name, map) => {
  const key = normalizeName(name);
  if (!key) return null;
  if (map[key]) return map[key];
  const keys = Object.keys(map || {});
  const incl = keys.find((k) => key.includes(k) || k.includes(key));
  if (incl) return map[incl];
  let bestKey = null;
  let bestScore = 0;
  keys.forEach((k) => {
    const raw = map[k]?.rawName || k;
    const score = Math.max(nameSimilarity(name, raw), nameSimilarity(name, k));
    if (score > bestScore) {
      bestScore = score;
      bestKey = k;
    }
  });
  if (bestKey && bestScore >= 0.6) return map[bestKey];
  return null;
};

const CallCenterPerformanceTracker = forwardRef(({ mode, userData }, ref) => {
  const { parsedReports: managementReports } = useManagementData();
  const [callCenterMgmtMetrics, setCallCenterMgmtMetrics] = useState({ CS: {}, LBF: {} });

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await getReportsByDepartmentAndType('ALL', 'MANAGEMENT');
        if (!res?.success || !(res.data || []).length) return;
        const sorted = [...res.data].sort((a, b) => new Date(b.date || b.created_at || b.createdAt || 0) - new Date(a.date || a.created_at || a.createdAt || 0));
        const latest = sorted[0];
        const url = latest.fileUrl || latest.file_url || (latest.filePath || latest.file_path ? getReportFileUrl(latest.filePath || latest.file_path) : null);
        if (!url) return;
        const rf = await fetch(url);
        if (!rf.ok) return;
        const wb = XLSX.read(await rf.arrayBuffer(), { type: 'array', raw: false });
        const csMap = extractCallCenterSheetMetrics(wb, 'CSCallcenter');
        const lbfMap = extractCallCenterSheetMetrics(wb, 'LBFCallCenter');
        if (!stop) setCallCenterMgmtMetrics({ CS: csMap, LBF: lbfMap });
      } catch {
        // best effort only
      }
    };
    load();
    return () => { stop = true; };
  }, []);

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
    const summaryRows = trackerData.map(row => {
      const map = callCenterMgmtMetrics[row.product] || {};
      const vals = Object.values(map);
      const sumLoans = vals.reduce((s, v) => s + (Number(v.noLoans) || 0), 0);
      const sumDisb = vals.reduce((s, v) => s + (Number(v.disbursement) || 0), 0);
      const sumActive = vals.reduce((s, v) => s + (Number(v.activeAgents) || 0), 0);
      const avgLoanAgent = sumActive > 0 ? (sumDisb / sumActive) : 0;
      return {
        'Product': row.product,
        'Total Calls': row.totalCalls,
        'Successful Calls': row.successfulCalls,
        'Unsuccessful Calls': row.unsuccessfulCalls,
        '% Successful': row.successRate.toFixed(1) + '%',
        'Total Agents': row.totalAgents,
        'No of Loan': sumLoans || '',
        'Disbursement': sumDisb || '',
        'Active agents': sumActive || '',
        'Average Loan per Agent': avgLoanAgent || ''
      };
    });
    if (summaryRows.length > 0) {
      tables.push({
        title: mode === 'WEEKLY' ? 'Call Center Performance Summary (6 Days)' : 'Call Center Performance Summary',
        data: summaryRows,
        colWidths: [12, 15, 18, 18, 14, 14, 14, 16, 14, 18],
        headerColors: { 'Product': '#4472C4', 'Total Calls': '#70AD47', 'Successful Calls': '#ED7D31', 'Total Agents': '#FFC000' },
        accountingColumns: ['Total Calls', 'Successful Calls', 'Unsuccessful Calls', 'Total Agents', 'No of Loan', 'Disbursement', 'Active agents', 'Average Loan per Agent']
      });
    }
    trackerData.filter(r => r.product === 'CS' || r.product === 'LBF').forEach(row => {
      const mgmtMap = callCenterMgmtMetrics[row.product] || {};
      const agentRows = row.topAgents.map((agent, idx) => {
        const success = agent.successfulCalls ?? agent['Successful Calls'] ?? 0;
        const total = agent.totalCalls ?? agent['Total Calls'] ?? agent['Total_Calls'] ?? 0;
        const pctSuccess = total > 0 ? (success / total * 100) : 0;
        const pctUnsuccess = total > 0 ? (100 - pctSuccess) : 0;
        const agentName = agent.name || agent['Agent Name'] || agent['Agent_Name'] || 'Unknown';
        const mgmt = findBestAgentMetrics(agentName, mgmtMap) || {};
        return {
          'Agent Name': agentName,
          'Total Calls': total,
          'Success Calls': success,
          '% Success': pctSuccess.toFixed(1) + '%',
          'No of Loan': mgmt.noLoans ?? '',
          'Disbursement': mgmt.disbursement ?? '',
          'Target': mgmt.target ?? '',
          '% Achieved': mgmt.pctAchieved != null ? `${(mgmt.pctAchieved * 100).toFixed(1)}%` : '',
          'Portfolio': mgmt.portfolio ?? '',
          'PAR > 30': mgmt.par30 != null ? `${(mgmt.par30 * 100).toFixed(2)}%` : ''
        };
      });
      if (agentRows.length > 0) {
        tables.push({
          title: `${row.product} Agents`,
          data: agentRows,
          colWidths: [22, 14, 14, 12, 12, 16, 12, 12, 14, 12],
          headerColors: { 'Agent Name': '#4472C4', 'Total Calls': '#70AD47', 'Success Calls': '#ED7D31', 'No of Loan': '#FFC000', 'Disbursement': '#ED7D31', 'Portfolio': '#A5A5A5' },
          accountingColumns: ['Total Calls', 'Success Calls', 'No of Loan', 'Disbursement', 'Target', 'Portfolio']
        });
      }
    });
    if (tables.length === 0) return [];
    return [{ name: 'Call Center Performance', tables }];
  };

  useImperativeHandle(ref, () => ({ getExportSheets }), [trackerData, mode]);

  const formatValue = (value) => {
    if (value === null || value === undefined || value === 0) return '-';
    if (typeof value === 'number') return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
                <th className="cct-th-agents">Total Agents</th>
                <th className="cct-th-agents">No of Loan</th>
                <th className="cct-th-agents">Disbursement</th>
                <th className="cct-th-agents">Active agents</th>
                <th className="cct-th-agents">Avg Loan/Agent</th>
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
                    <td className="cct-td-number">{formatValue(row.totalAgents)}</td>
                    <td className="cct-td-number">{formatValue((Object.values(callCenterMgmtMetrics[row.product] || {}).reduce((s, v) => s + (Number(v.noLoans) || 0), 0)))}</td>
                    <td className="cct-td-number">{formatValue((Object.values(callCenterMgmtMetrics[row.product] || {}).reduce((s, v) => s + (Number(v.disbursement) || 0), 0)))}</td>
                    <td className="cct-td-number">{formatValue((Object.values(callCenterMgmtMetrics[row.product] || {}).reduce((s, v) => s + (Number(v.activeAgents) || 0), 0)))}</td>
                    <td className="cct-td-number">{formatValue((() => {
                      const vals = Object.values(callCenterMgmtMetrics[row.product] || {});
                      const disb = vals.reduce((s, v) => s + (Number(v.disbursement) || 0), 0);
                      const active = vals.reduce((s, v) => s + (Number(v.activeAgents) || 0), 0);
                      return active > 0 ? (disb / active) : 0;
                    })())}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="10" className="cct-no-data">No data available</td>
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
                    <th>No of Loan</th>
                    <th>Disbursement</th>
                    <th>Target</th>
                    <th>% Achieved</th>
                    <th>Portfolio</th>
                    <th>PAR &gt; 30</th>
                  </tr>
                </thead>
                <tbody>
                  {(csRow?.topAgents || []).length > 0 ? (
                    csRow.topAgents.map((agent, aIndex) => {
                      const success = agent.successfulCalls ?? agent['Successful Calls'] ?? 0;
                      const total = agent.totalCalls ?? agent['Total Calls'] ?? 0;
                      const pctSuccess = total > 0 ? (success / total * 100) : 0;
                      const pctUnsuccess = total > 0 ? (100 - pctSuccess) : 0;
                      const mgmt = findBestAgentMetrics(agent.name || agent['Agent Name'] || 'Unknown', callCenterMgmtMetrics.CS || {}) || {};
                      return (
                        <tr key={aIndex}>
                          <td className="cct-rank-cell">{aIndex + 1}</td>
                          <td>{agent.name || agent['Agent Name'] || 'Unknown'}</td>
                          <td className="cct-td-number">{formatValue(total)}</td>
                          <td className="cct-td-number cct-positive">{formatValue(success)}</td>
                          <td className={`cct-td-percent ${pctSuccess >= 70 ? 'cct-positive' : pctSuccess >= 50 ? 'cct-warning' : 'cct-negative'}`}>{pctSuccess.toFixed(1)}%</td>
                          <td className="cct-td-number">{formatValue(mgmt.noLoans)}</td>
                          <td className="cct-td-number">{formatValue(mgmt.disbursement)}</td>
                          <td className="cct-td-number">{formatValue(mgmt.target)}</td>
                          <td className="cct-td-percent">{mgmt.pctAchieved != null ? `${(mgmt.pctAchieved * 100).toFixed(1)}%` : '-'}</td>
                          <td className="cct-td-number">{formatValue(mgmt.portfolio)}</td>
                          <td className="cct-td-percent">{mgmt.par30 != null ? `${(mgmt.par30 * 100).toFixed(2)}%` : '-'}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr><td colSpan="11" className="cct-no-data">No agents data</td></tr>
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
                    <th>No of Loan</th>
                    <th>Disbursement</th>
                    <th>Target</th>
                    <th>% Achieved</th>
                    <th>Portfolio</th>
                    <th>PAR &gt; 30</th>
                  </tr>
                </thead>
                <tbody>
                  {(lbfRow?.topAgents || []).length > 0 ? (
                    lbfRow.topAgents.map((agent, aIndex) => {
                      const success = agent.successfulCalls ?? agent['Successful Calls'] ?? 0;
                      const total = agent.totalCalls ?? agent['Total Calls'] ?? 0;
                      const pctSuccess = total > 0 ? (success / total * 100) : 0;
                      const pctUnsuccess = total > 0 ? (100 - pctSuccess) : 0;
                      const mgmt = findBestAgentMetrics(agent.name || agent['Agent Name'] || 'Unknown', callCenterMgmtMetrics.LBF || {}) || {};
                      return (
                        <tr key={aIndex}>
                          <td className="cct-rank-cell">{aIndex + 1}</td>
                          <td>{agent.name || agent['Agent Name'] || 'Unknown'}</td>
                          <td className="cct-td-number">{formatValue(total)}</td>
                          <td className="cct-td-number cct-positive">{formatValue(success)}</td>
                          <td className={`cct-td-percent ${pctSuccess >= 70 ? 'cct-positive' : pctSuccess >= 50 ? 'cct-warning' : 'cct-negative'}`}>{pctSuccess.toFixed(1)}%</td>
                          <td className="cct-td-number">{formatValue(mgmt.noLoans)}</td>
                          <td className="cct-td-number">{formatValue(mgmt.disbursement)}</td>
                          <td className="cct-td-number">{formatValue(mgmt.target)}</td>
                          <td className="cct-td-percent">{mgmt.pctAchieved != null ? `${(mgmt.pctAchieved * 100).toFixed(1)}%` : '-'}</td>
                          <td className="cct-td-number">{formatValue(mgmt.portfolio)}</td>
                          <td className="cct-td-percent">{mgmt.par30 != null ? `${(mgmt.par30 * 100).toFixed(2)}%` : '-'}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr><td colSpan="11" className="cct-no-data">No agents data</td></tr>
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
