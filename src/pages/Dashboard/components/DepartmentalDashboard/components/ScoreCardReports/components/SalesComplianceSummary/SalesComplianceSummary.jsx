import { useMemo, useImperativeHandle, forwardRef } from 'react';
import './SalesComplianceSummary.css';
import { useManagementData } from '../../../../../ManagementDashboard/hooks/useManagementData';
import { useCRMData } from '../../../../../CRMdashboard/hooks/useCRMData';
import { useMTDData } from '../../../../../MTDdashboard/hooks/useMTDData';
import { useCallCenterData } from '../../../../../CallCenterDashboard/hooks/useCallCenterData';
import { extractMetrics } from '../../../../../CRMdashboard/utils/crmUtils';
import { calculateMetrics, REQUIRED_SUCCESS_CALLS_WEEKLY } from '../../../../../CallCenterDashboard/utils/callCenterUtils';
import { exportSingleSectionWithStyles } from '../../../../utils/excelExportStyled';
import LoadingSpinner from '../../../../../../../../components/Common/Loading/LoadingSpinner';

// HOD names as requested - hardcoded for now, user will edit later
const HOD_NAMES = {
  CS: 'KELVIN MWASALA',
  LBF: 'AUGUSTINE MPOLLO',
  SME: 'ABDULAKHIM KHALFANI',
  AgriFinance: 'ALLAN RUHUZA'
};

// Sub-products definitions based on management data structure
const SUB_PRODUCTS = {
  CS: ['CS', 'Cs Asset Finance'],
  LBF: ['LBF', 'IPF', 'MIF', 'MIF Customs', 'Lbf Yard Finance', 'LBF QUICKCASH', 'LBF-FLEX'],
  SME: ['SME'],
  AgriFinance: ['AgriFinance'] // Will be added when available
};

// Work days only (no Sunday); last slot is Total/Average/Movement
const WORK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_LABEL_TOTAL = 'Total/Average/Movement';

// Format date as DD/MM/YYYY
const formatDayDate = (d) => {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return null;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const SalesComplianceSummary = forwardRef(({ mode, userData }, ref) => {
  const { parsedReports: managementReports } = useManagementData();

  // Week dates (Mon–Sat) from latest week in management reports
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

  // CRM data per product per day (by date)
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

  // Legacy single-call for monthly mode and loading
  const crmCS = useCRMData('CS');
  const crmLBF = useCRMData('LBF');
  const crmSME = useCRMData('SME');
  const callCenterCS = useCallCenterData('CS');
  const callCenterLBF = useCallCenterData('LBF');
  const callCenterSME = useCallCenterData('SME');
  const mtdCS = useMTDData('CS');
  const mtdLBF = useMTDData('LBF');
  const mtdSME = useMTDData('SME');

  // Get latest week's management data (Mon–Sat only)
  const getLatestWeekData = (reports) => {
    if (!reports || reports.length === 0) return { weekData: {}, weekDates: [], latestData: null };
    const sorted = [...reports].sort((a, b) => {
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
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);
    saturday.setHours(23, 59, 59, 999);
    const weekReports = sorted.filter(report => {
      const reportDate = report.date ? new Date(report.date) : new Date(report.createdAt);
      return reportDate >= monday && reportDate <= saturday;
    });
    const dayMap = {};
    WORK_DAYS.forEach(day => { dayMap[day] = null; });
    const daysByIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    weekReports.forEach(report => {
      const reportDate = report.date ? new Date(report.date) : new Date(report.createdAt);
      const dayName = daysByIndex[reportDate.getDay()];
      if (WORK_DAYS.includes(dayName) && (!dayMap[dayName] || reportDate > new Date(dayMap[dayName].date || dayMap[dayName].createdAt))) {
        dayMap[dayName] = report;
      }
    });
    return { weekData: dayMap, latestData: sorted[0] };
  };

  // Get management data for a specific product and sub-product
  const getManagementMetrics = (report, product, subProduct) => {
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
      // AgriFinance - check if it exists in the report
      data = report.agrifinance || report.AgriFinance || {};
    }
    
    if (!data || Object.keys(data).length === 0) return null;
    
    const activeClients = data['Active clients'] ?? data['Active Clients'] ?? 0;
    const inactiveClients = data['Inactive clients'] ?? data['Inactive Clients'] ?? 0;
    const numberOFClients = data['Number of Clients'] ?? data['Number of clients'] ?? ((activeClients + inactiveClients) || 0);
    
    return {
      target: data['Target'] || data['Monthly Target'] || 0,
      disbursement: data['Disbursements This Month'] || data['Disbursement This Month'] || data['Disbursement this Month'] || 0,
      numberOfLoans: data['Number of loans'] || data['Number of Loans'] || data['No. of Loans'] || 0,
      activeReps: data['Active Reps'] || data['Active reps'] || data['ACTIVE REPS'] || 0,
      activeClients,
      inactiveClients,
      totalClients: numberOFClients,
      inArrear: data['In arrears'] ?? data['In Arrear'] ?? data['In arrear'] ?? 0,
      valueInArrears: data['Value in arrears'] ?? data['Value In Arrears'] ?? data['Value in Arrears'] ?? data['Value in arrears'] ?? 0,
      par7: data['PAR>7'] || data['PAR > 7'] || data['Par>7'] || 0,
      par30: data['PAR>30'] || data['PAR > 30'] || data['Par>30'] || 0
    };
  };

  // Get CRM metrics from parsed emailData (for a specific day's report)
  const getCRMMetricsFromParsed = (parsedData) => {
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
    const totalAgents = getValue(['total_agent', 'total_count_agent', 'total agents']);
    const loggedInAgents = getValue(['total_agent_logged_in', 'logged_in_agent', 'logged_in_agents']);
    const totalTLS = getValue(['count_team_leaders', 'total_count_team_leaders', 'total_tls']);
    const loggedInTLS = getValue(['logged_in_team_leaders', 'logged_in_tls']);
    const agentCompletedAtLocation = getValue(['agent_completed_at_location', 'agents_completed_at_location']);
    const tlsCompletedAtLocation = getValue(['team_leaders_completed_at_location', 'tl_completed_activities_at_location', 'tl_completed_at_location']);
    return {
      numberOfLeads: getValue(['lead', 'count_leads', 'leads']),
      prospect: getValue(['prospect_lead', 'prospect', 'prospects']),
      totalAgents,
      loggedInAgents,
      percentLoggedInAgents: totalAgents > 0 ? (loggedInAgents / totalAgents * 100) : 0,
      totalTLS,
      loggedInTLS,
      percentLoggedInTLS: totalTLS > 0 ? (loggedInTLS / totalTLS * 100) : 0,
      agentCompletedAtLocation,
      agentCompletedAtLocationPct: totalAgents > 0 ? (agentCompletedAtLocation / totalAgents * 100) : 0,
      tlsCompletedAtLocation,
      tlsCompletedAtLocationPct: totalTLS > 0 ? (tlsCompletedAtLocation / totalTLS * 100) : 0
    };
  };

  // Get Call Center metrics from parsed data (for a specific day's report)
  const getCallCenterMetricsFromParsed = (parsedData) => {
    if (!parsedData?.allCallData) return null;
    const metrics = calculateMetrics(parsedData.allCallData);
    const agentPerformance = parsedData.agentPerformance || [];
    const agentsWithOver50Calls = agentPerformance.filter(agent => {
      const totalCalls = (agent['Total Calls'] || agent['Total_Calls'] || agent.totalCalls || 0);
      return totalCalls > 50;
    }).length;
    const agentsWithUnder50Calls = agentPerformance.filter(agent => {
      const totalCalls = (agent['Total Calls'] || agent['Total_Calls'] || agent.totalCalls || 0);
      return totalCalls > 0 && totalCalls <= 50;
    }).length;
    const totalAgents = agentPerformance.length;
    return {
      totalCalls: metrics.totalCalls,
      successfulCalls: metrics.successfulCalls,
      unsuccessfulCalls: metrics.unsuccessfulCalls,
      percentSuccessful: metrics.totalCalls > 0 ? (metrics.successfulCalls / metrics.totalCalls * 100) : 0,
      percentUnsuccessful: metrics.totalCalls > 0 ? (metrics.unsuccessfulCalls / metrics.totalCalls * 100) : 0,
      totalAgents,
      agentsWithOver50Calls,
      agentsWithUnder50Calls,
      percentAgentsOver50: totalAgents > 0 ? (agentsWithOver50Calls / totalAgents * 100) : 0,
      percentAgentsUnder50: totalAgents > 0 ? (agentsWithUnder50Calls / totalAgents * 100) : 0
    };
  };

  // Single-hook CRM/CC (for monthly mode)
  const getCRMMetrics = (product) => getCRMMetricsFromParsed({ CS: crmCS, LBF: crmLBF, SME: crmSME }[product]?.parsedData);
  const getCallCenterMetrics = (product) => getCallCenterMetricsFromParsed({ CS: callCenterCS, LBF: callCenterLBF, SME: callCenterSME }[product]?.parsedData);

  // CRM hooks by product and day index (0=Mon..5=Sat)
  const crmByProductDay = {
    CS: [crmCS_0, crmCS_1, crmCS_2, crmCS_3, crmCS_4, crmCS_5],
    LBF: [crmLBF_0, crmLBF_1, crmLBF_2, crmLBF_3, crmLBF_4, crmLBF_5],
    SME: [crmSME_0, crmSME_1, crmSME_2, crmSME_3, crmSME_4, crmSME_5]
  };
  const ccByProductDay = {
    CS: [ccCS_0, ccCS_1, ccCS_2, ccCS_3, ccCS_4, ccCS_5],
    LBF: [ccLBF_0, ccLBF_1, ccLBF_2, ccLBF_3, ccLBF_4, ccLBF_5],
    SME: [ccSME_0, ccSME_1, ccSME_2, ccSME_3, ccSME_4, ccSME_5]
  };

  // Build summary data for Weekly mode: 6 days (Mon–Sat) per sub-product, then Total/Average/Movement per product at end
  const buildWeeklySummaryData = useMemo(() => {
    const { weekData, latestData } = getLatestWeekData(managementReports);
    const products = ['CS', 'LBF', 'SME', 'AgriFinance'];
    const rows = [];

    products.forEach(product => {
      const subProducts = SUB_PRODUCTS[product] || [product];
      const hod = HOD_NAMES[product] || 'TBD';
      const subProductTotals = [];

      subProducts.forEach((subProduct, subIndex) => {
        // 6 day rows (Mon–Sat) for this sub-product
        WORK_DAYS.forEach((day, dayIndex) => {
          const report = weekData[day];
          const mgmtData = getManagementMetrics(report, product, subProduct);
          const dayDate = weekDates[dayIndex];
          const dayLabel = dayDate ? `${day} (${formatDayDate(dayDate)})` : day;
          const showCRM = subIndex === 0 && product !== 'AgriFinance';
          const showCallCenter = subIndex === 0 && product !== 'AgriFinance';
          const crmData = showCRM && crmByProductDay[product]
            ? getCRMMetricsFromParsed(crmByProductDay[product][dayIndex]?.parsedData)
            : null;
          const callCenterData = showCallCenter && ccByProductDay[product]
            ? getCallCenterMetricsFromParsed(ccByProductDay[product][dayIndex]?.parsedData)
            : null;

          rows.push({
            product: dayIndex === 0 && subIndex === 0 ? product : '',
            hod: dayIndex === 0 && subIndex === 0 ? hod : '',
            subProduct: dayIndex === 0 ? subProduct : '',
            day: dayLabel,
            reportDate: report?.date ? formatDayDate(new Date(report.date)) : '-',
            isTotalRow: false,
            sales: {
              target: mgmtData?.target ?? '-',
              disbursement: mgmtData?.disbursement ?? '-',
              percentage: mgmtData?.target && mgmtData?.disbursement
                ? ((mgmtData.disbursement / mgmtData.target) * 100).toFixed(1) + '%'
                : '-',
              numberOfLoans: mgmtData?.numberOfLoans ?? '-',
              activeReps: mgmtData?.activeReps ?? '-',
              activeClients: mgmtData?.activeClients ?? '-',
              inactiveClients: mgmtData?.inactiveClients ?? '-',
              totalClients: mgmtData?.totalClients ?? '-'
            },
            portfolio: {
              inArrear: mgmtData?.inArrear ?? '-',
              valueInArrears: mgmtData?.valueInArrears ?? '-',
              par7: mgmtData?.par7 ?? '-',
              par30: mgmtData?.par30 ?? '-'
            },
            crm: showCRM && crmData ? {
              numberOfLeads: crmData.numberOfLeads ?? '-',
              prospect: crmData.prospect ?? '-',
              totalAgents: crmData.totalAgents ?? '-',
              loggedInAgents: crmData.loggedInAgents ?? '-',
              percentLoggedInAgents: crmData.percentLoggedInAgents != null ? crmData.percentLoggedInAgents.toFixed(1) + '%' : '-',
              totalTLS: crmData.totalTLS ?? '-',
              loggedInTLS: crmData.loggedInTLS ?? '-',
              percentLoggedInTLS: crmData.percentLoggedInTLS != null ? crmData.percentLoggedInTLS.toFixed(1) + '%' : '-',
              agentCompletedAtLocation: crmData.agentCompletedAtLocation != null ? `${crmData.agentCompletedAtLocation} (${crmData.agentCompletedAtLocationPct.toFixed(1)}%)` : '-',
              tlsCompletedAtLocation: crmData.tlsCompletedAtLocation != null ? `${crmData.tlsCompletedAtLocation} (${crmData.tlsCompletedAtLocationPct.toFixed(1)}%)` : '-'
            } : null,
            callCenter: showCallCenter && callCenterData ? (() => {
              const success = callCenterData.successfulCalls ?? 0;
              const pctReached = REQUIRED_SUCCESS_CALLS_WEEKLY > 0 ? (success / REQUIRED_SUCCESS_CALLS_WEEKLY * 100) : 0;
              const pctNotReached = 100 - pctReached;
              return {
                totalCalls: callCenterData.totalCalls ?? '-',
                successfulCalls: callCenterData.successfulCalls ?? '-',
                unsuccessfulCalls: callCenterData.unsuccessfulCalls ?? '-',
                percentSuccessful: callCenterData.percentSuccessful != null ? callCenterData.percentSuccessful.toFixed(1) + '%' : '-',
                percentUnsuccessful: callCenterData.percentUnsuccessful != null ? callCenterData.percentUnsuccessful.toFixed(1) + '%' : '-',
                percentCallsReached: pctReached.toFixed(1) + '%',
                percentCallsNotReached: pctNotReached.toFixed(1) + '%',
                totalAgents: callCenterData.totalAgents ?? '-',
                agentsWithOver50Calls: callCenterData.agentsWithOver50Calls ?? '-',
                percentAgentsOver50: callCenterData.percentAgentsOver50 != null ? callCenterData.percentAgentsOver50.toFixed(1) + '%' : '-',
                agentsWithUnder50Calls: callCenterData.agentsWithUnder50Calls ?? '-',
                percentAgentsUnder50: callCenterData.percentAgentsUnder50 != null ? callCenterData.percentAgentsUnder50.toFixed(1) + '%' : '-'
              };
            })() : null
          });
        });

        // Accumulate Total/Average/Movement for this sub-product (for product-level total later)
        const latestReport = latestData || weekData[WORK_DAYS[5]] || weekData[WORK_DAYS[4]] || weekData[WORK_DAYS[3]] || weekData[WORK_DAYS[2]] || weekData[WORK_DAYS[1]] || weekData[WORK_DAYS[0]];
        const totalMgmt = getManagementMetrics(latestReport, product, subProduct);
        subProductTotals.push({
          mgmt: totalMgmt,
          subIndex,
          product,
          showCRM: subIndex === 0 && product !== 'AgriFinance',
          showCallCenter: subIndex === 0 && product !== 'AgriFinance'
        });
      });

      // Now add ONE Total/Average/Movement row per product (aggregating sub-products)
      const latestReport = latestData || weekData[WORK_DAYS[5]] || weekData[WORK_DAYS[4]];
      let aggTarget = 0, aggDisb = 0, aggLoans = 0, aggReps = 0;
      let aggActiveClients = 0, aggInactiveClients = 0, aggTotalClients = 0;
      let aggInArrear = 0, aggValueArrears = 0;
      let par7Sum = 0, par30Sum = 0, par7Count = 0, par30Count = 0;
      subProductTotals.forEach(({ mgmt }) => {
        if (mgmt) {
          aggTarget += Number(mgmt.target) || 0;
          aggDisb += Number(mgmt.disbursement) || 0;
          aggLoans += Number(mgmt.numberOfLoans) || 0;
          aggReps += Number(mgmt.activeReps) || 0;
          aggActiveClients += Number(mgmt.activeClients) || 0;
          aggInactiveClients += Number(mgmt.inactiveClients) || 0;
          aggTotalClients += Number(mgmt.totalClients) || 0;
          aggInArrear += Number(mgmt.inArrear) || 0;
          aggValueArrears += Number(mgmt.valueInArrears) || 0;
          const p7 = Number(mgmt.par7);
          const p30 = Number(mgmt.par30);
          if (!Number.isNaN(p7) && p7 > 0) {
            par7Sum += p7;
            par7Count += 1;
          }
          if (!Number.isNaN(p30) && p30 > 0) {
            par30Sum += p30;
            par30Count += 1;
          }
        }
      });
      const aggPar7 = par7Count > 0 ? par7Sum / par7Count : 0;
      const aggPar30 = par30Count > 0 ? par30Sum / par30Count : 0;

      let totalCrm = null;
      let totalCc = null;
      if (product !== 'AgriFinance') {
        const crmHooks = crmByProductDay[product];
        const ccHooks = ccByProductDay[product];
        if (crmHooks) {
          let sumLeads = 0, sumProspect = 0;
          let lastAgents = 0, lastLoggedAgents = 0, lastTLS = 0, lastLoggedTLS = 0;
          let sumAgentAtLoc = 0, sumTlsAtLoc = 0, sumAgentPct = 0, sumTlsPct = 0, countAgentPct = 0, countTlsPct = 0;
          crmHooks.forEach((h) => {
            const m = getCRMMetricsFromParsed(h?.parsedData);
            if (m) {
              sumLeads += m.numberOfLeads || 0;
              sumProspect += m.prospect || 0;
              lastAgents = m.totalAgents ?? lastAgents;
              lastLoggedAgents = m.loggedInAgents ?? lastLoggedAgents;
              lastTLS = m.totalTLS ?? lastTLS;
              lastLoggedTLS = m.loggedInTLS ?? lastLoggedTLS;
              if (m.agentCompletedAtLocation != null) { sumAgentAtLoc += m.agentCompletedAtLocation; sumAgentPct += m.agentCompletedAtLocationPct || 0; countAgentPct += 1; }
              if (m.tlsCompletedAtLocation != null) { sumTlsAtLoc += m.tlsCompletedAtLocation; sumTlsPct += m.tlsCompletedAtLocationPct || 0; countTlsPct += 1; }
            }
          });
          const pctAgents = lastAgents > 0 ? (lastLoggedAgents / lastAgents * 100) : 0;
          const pctTLS = lastTLS > 0 ? (lastLoggedTLS / lastTLS * 100) : 0;
          const avgAgentAtLoc = countAgentPct > 0 ? sumAgentAtLoc / countAgentPct : null;
          const avgTlsAtLoc = countTlsPct > 0 ? sumTlsAtLoc / countTlsPct : null;
          const avgAgentPct = countAgentPct > 0 ? sumAgentPct / countAgentPct : 0;
          const avgTlsPct = countTlsPct > 0 ? sumTlsPct / countTlsPct : 0;
          totalCrm = {
            numberOfLeads: sumLeads,
            prospect: sumProspect,
            totalAgents: lastAgents,
            loggedInAgents: lastLoggedAgents,
            percentLoggedInAgents: pctAgents.toFixed(1) + '%',
            totalTLS: lastTLS,
            loggedInTLS: lastLoggedTLS,
            percentLoggedInTLS: pctTLS.toFixed(1) + '%',
            agentCompletedAtLocation: avgAgentAtLoc != null ? `${avgAgentAtLoc.toFixed(0)} (${avgAgentPct.toFixed(1)}%)` : '-',
            tlsCompletedAtLocation: avgTlsAtLoc != null ? `${avgTlsAtLoc.toFixed(0)} (${avgTlsPct.toFixed(1)}%)` : '-'
          };
        }
        if (ccHooks) {
          let sumCalls = 0, sumSuccess = 0, sumUnsuccess = 0;
          let lastTotalAgents = 0, lastOver50 = 0, lastUnder50 = 0;
          ccHooks.forEach((h) => {
            const m = getCallCenterMetricsFromParsed(h?.parsedData);
            if (m) {
              sumCalls += m.totalCalls || 0;
              sumSuccess += m.successfulCalls || 0;
              sumUnsuccess += m.unsuccessfulCalls || 0;
              lastTotalAgents = m.totalAgents ?? lastTotalAgents;
              lastOver50 = m.agentsWithOver50Calls ?? lastOver50;
              lastUnder50 = m.agentsWithUnder50Calls ?? lastUnder50;
            }
          });
          const pctSuccess = sumCalls > 0 ? (sumSuccess / sumCalls * 100) : 0;
          const pctUnsuccess = sumCalls > 0 ? (sumUnsuccess / sumCalls * 100) : 0;
          const pctOver50 = lastTotalAgents > 0 ? (lastOver50 / lastTotalAgents * 100) : 0;
          const pctUnder50 = lastTotalAgents > 0 ? (lastUnder50 / lastTotalAgents * 100) : 0;
          const pctReached = REQUIRED_SUCCESS_CALLS_WEEKLY > 0 ? (sumSuccess / REQUIRED_SUCCESS_CALLS_WEEKLY * 100) : 0;
          const pctNotReached = 100 - pctReached;
          totalCc = {
            totalCalls: sumCalls,
            successfulCalls: sumSuccess,
            unsuccessfulCalls: sumUnsuccess,
            percentSuccessful: pctSuccess.toFixed(1) + '%',
            percentUnsuccessful: pctUnsuccess.toFixed(1) + '%',
            percentCallsReached: pctReached.toFixed(1) + '%',
            percentCallsNotReached: pctNotReached.toFixed(1) + '%',
            totalAgents: lastTotalAgents,
            agentsWithOver50Calls: lastOver50,
            percentAgentsOver50: pctOver50.toFixed(1) + '%',
            agentsWithUnder50Calls: lastUnder50,
            percentAgentsUnder50: pctUnder50.toFixed(1) + '%'
          };
        }
      }

      rows.push({
        product,
        hod,
        subProduct: DAY_LABEL_TOTAL,
        day: DAY_LABEL_TOTAL,
        reportDate: latestReport?.date ? formatDayDate(new Date(latestReport.date)) : '-',
        isTotalRow: true,
        sales: {
          target: aggTarget || '-',
          disbursement: aggDisb || '-',
          percentage: aggTarget > 0 ? ((aggDisb / aggTarget) * 100).toFixed(1) + '%' : '-',
          numberOfLoans: aggLoans || '-',
          activeReps: aggReps || '-',
          activeClients: aggActiveClients || '-',
          inactiveClients: aggInactiveClients || '-',
          totalClients: aggTotalClients || '-'
        },
        portfolio: {
          inArrear: aggInArrear || '-',
          valueInArrears: aggValueArrears || '-',
          par7: aggPar7 || '-',
          par30: aggPar30 || '-'
        },
        crm: totalCrm,
        callCenter: totalCc
      });
    });

    return rows;
  }, [
    managementReports, weekDates,
    crmCS_0.parsedData, crmCS_1.parsedData, crmCS_2.parsedData, crmCS_3.parsedData, crmCS_4.parsedData, crmCS_5.parsedData,
    crmLBF_0.parsedData, crmLBF_1.parsedData, crmLBF_2.parsedData, crmLBF_3.parsedData, crmLBF_4.parsedData, crmLBF_5.parsedData,
    crmSME_0.parsedData, crmSME_1.parsedData, crmSME_2.parsedData, crmSME_3.parsedData, crmSME_4.parsedData, crmSME_5.parsedData,
    ccCS_0.parsedData, ccCS_1.parsedData, ccCS_2.parsedData, ccCS_3.parsedData, ccCS_4.parsedData, ccCS_5.parsedData,
    ccLBF_0.parsedData, ccLBF_1.parsedData, ccLBF_2.parsedData, ccLBF_3.parsedData, ccLBF_4.parsedData, ccLBF_5.parsedData,
    ccSME_0.parsedData, ccSME_1.parsedData, ccSME_2.parsedData, ccSME_3.parsedData, ccSME_4.parsedData, ccSME_5.parsedData,
    mode
  ]);

  // Build summary data for Monthly mode (simplified - only latest values)
  const buildMonthlySummaryData = useMemo(() => {
    const products = ['CS', 'LBF', 'SME', 'AgriFinance'];
    const rows = [];
    
    // Get latest report
    const sortedReports = [...(managementReports || [])].sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
      const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
      return dateB - dateA;
    });
    const latestReport = sortedReports[0];
    
    products.forEach(product => {
      const subProducts = SUB_PRODUCTS[product] || [product];
      const hod = HOD_NAMES[product] || 'TBD';
      const crmData = getCRMMetrics(product);
      const callCenterData = getCallCenterMetrics(product);
      
      subProducts.forEach((subProduct, subIndex) => {
        const mgmtData = getManagementMetrics(latestReport, product, subProduct);
        const showCRM = subIndex === 0;
        const showCallCenter = subIndex === 0;
        
        rows.push({
          product: subIndex === 0 ? product : '',
          hod: subIndex === 0 ? hod : '',
          subProduct,
          day: 'Monthly',
          reportDate: latestReport?.date ? new Date(latestReport.date).toLocaleDateString() : '-',
          sales: {
            target: mgmtData?.target || '-',
            disbursement: mgmtData?.disbursement || '-',
            percentage: mgmtData?.target && mgmtData?.disbursement 
              ? ((mgmtData.disbursement / mgmtData.target) * 100).toFixed(1) + '%' 
              : '-',
            numberOfLoans: mgmtData?.numberOfLoans || '-',
            activeReps: mgmtData?.activeReps || '-',
            activeClients: mgmtData?.activeClients ?? '-',
            inactiveClients: mgmtData?.inactiveClients ?? '-',
            totalClients: mgmtData?.totalClients ?? '-'
          },
          portfolio: {
            inArrear: mgmtData?.inArrear || '-',
            valueInArrears: mgmtData?.valueInArrears || '-',
            par7: mgmtData?.par7 || '-',
            par30: mgmtData?.par30 || '-'
          },
          crm: showCRM && crmData ? {
            numberOfLeads: crmData.numberOfLeads ?? '-',
            prospect: crmData.prospect ?? '-',
            totalAgents: crmData.totalAgents ?? '-',
            loggedInAgents: crmData.loggedInAgents ?? '-',
            percentLoggedInAgents: crmData.percentLoggedInAgents != null ? crmData.percentLoggedInAgents.toFixed(1) + '%' : '-',
            totalTLS: crmData.totalTLS ?? '-',
            loggedInTLS: crmData.loggedInTLS ?? '-',
            percentLoggedInTLS: crmData.percentLoggedInTLS != null ? crmData.percentLoggedInTLS.toFixed(1) + '%' : '-',
            agentCompletedAtLocation: crmData.agentCompletedAtLocation != null ? `${crmData.agentCompletedAtLocation} (${crmData.agentCompletedAtLocationPct.toFixed(1)}%)` : '-',
            tlsCompletedAtLocation: crmData.tlsCompletedAtLocation != null ? `${crmData.tlsCompletedAtLocation} (${crmData.tlsCompletedAtLocationPct.toFixed(1)}%)` : '-'
          } : null,
          callCenter: showCallCenter && callCenterData ? (() => {
            const success = callCenterData.successfulCalls ?? 0;
            const pctReached = REQUIRED_SUCCESS_CALLS_WEEKLY > 0 ? (success / REQUIRED_SUCCESS_CALLS_WEEKLY * 100) : 0;
            const pctNotReached = 100 - pctReached;
            return {
              totalCalls: callCenterData.totalCalls ?? '-',
              successfulCalls: callCenterData.successfulCalls ?? '-',
              unsuccessfulCalls: callCenterData.unsuccessfulCalls ?? '-',
              percentSuccessful: callCenterData.percentSuccessful != null ? callCenterData.percentSuccessful.toFixed(1) + '%' : '-',
              percentUnsuccessful: callCenterData.percentUnsuccessful != null ? callCenterData.percentUnsuccessful.toFixed(1) + '%' : '-',
              percentCallsReached: pctReached.toFixed(1) + '%',
              percentCallsNotReached: pctNotReached.toFixed(1) + '%',
              totalAgents: callCenterData.totalAgents ?? '-',
              agentsWithOver50Calls: callCenterData.agentsWithOver50Calls ?? '-',
              percentAgentsOver50: callCenterData.percentAgentsOver50 != null ? callCenterData.percentAgentsOver50.toFixed(1) + '%' : '-',
              agentsWithUnder50Calls: callCenterData.agentsWithUnder50Calls ?? '-',
              percentAgentsUnder50: callCenterData.percentAgentsUnder50 != null ? callCenterData.percentAgentsUnder50.toFixed(1) + '%' : '-'
            };
          })() : null,
          _productIndex: products.indexOf(product),
          _subProductIndex: subIndex
        });
      });
    });
    
    return rows;
  }, [managementReports, crmCS.parsedData, crmLBF.parsedData, crmSME.parsedData,
    callCenterCS.parsedData, callCenterLBF.parsedData, callCenterSME.parsedData, mode]);

  const summaryData = mode === 'WEEKLY' ? buildWeeklySummaryData : buildMonthlySummaryData;

  const isLoading = useMemo(() => {
    return (crmCS.loading || crmLBF.loading || crmSME.loading ||
            mtdCS.loading || mtdLBF.loading || mtdSME.loading ||
            callCenterCS.loading || callCenterLBF.loading || callCenterSME.loading);
  }, [crmCS.loading, crmLBF.loading, crmSME.loading,
    mtdCS.loading, mtdLBF.loading, mtdSME.loading,
    callCenterCS.loading, callCenterLBF.loading, callCenterSME.loading]);

  const handleExport = async () => {
    const section = getExportSheets()[0];
    if (section) await exportSingleSectionWithStyles(section, `Sales_Compliance_Summary_${mode}`);
  };

  const getExportSheets = () => {
    const exportData = summaryData.map(row => ({
      'PRODUCT': row.product,
      'HOD': row.hod,
      'SUB-PRODUCT': row.subProduct,
      'DAY': row.day,
      // Sales
      'Target': row.sales.target,
      'Disbursement': row.sales.disbursement,
      'Percentage': row.sales.percentage,
      'Number of Loans': row.sales.numberOfLoans,
      'Active Reps': row.sales.activeReps,
      'Active Clients': row.sales.activeClients,
      'Inactive Clients': row.sales.inactiveClients,
      'Total Clients': row.sales.totalClients,
      // Portfolio
      'In Arrear': row.portfolio.inArrear,
      'Value in Arrears': row.portfolio.valueInArrears,
      'PAR>7': row.portfolio.par7,
      'PAR>30': row.portfolio.par30,
      // CRM (if exists)
      'Number of Leads': row.crm?.numberOfLeads || '',
      'Prospect': row.crm?.prospect || '',
      'Total Agents (CRM)': row.crm?.totalAgents || '',
      'Logged In Agents': row.crm?.loggedInAgents || '',
      '% Logged In Agents': row.crm?.percentLoggedInAgents || '',
      'Total TLS': row.crm?.totalTLS || '',
      'Logged In TLS': row.crm?.loggedInTLS || '',
      '% Logged In TLS': row.crm?.percentLoggedInTLS || '',
      'Agent Completed at Location': row.crm?.agentCompletedAtLocation || '',
      'TLS Completed At Location': row.crm?.tlsCompletedAtLocation || '',
      // Call Center (if exists)
      'Total Calls': row.callCenter?.totalCalls || '',
      'Successful Calls': row.callCenter?.successfulCalls || '',
      'Unsuccessful Calls': row.callCenter?.unsuccessfulCalls || '',
      '% Successful': row.callCenter?.percentSuccessful || '',
      '% Unsuccessful': row.callCenter?.percentUnsuccessful || '',
      '% Calls Reached': row.callCenter?.percentCallsReached || '',
      '% Calls Not Reached': row.callCenter?.percentCallsNotReached || '',
      'Total Agents (CC)': row.callCenter?.totalAgents || '',
      'Agents >50 Calls': row.callCenter?.agentsWithOver50Calls || '',
      '% Agents >50': row.callCenter?.percentAgentsOver50 || '',
      'Agents <50 Calls': row.callCenter?.agentsWithUnder50Calls || '',
      '% Agents <50': row.callCenter?.percentAgentsUnder50 || ''
    }));
    const totalRowIndices = summaryData.map((r, i) => r.isTotalRow ? i : null).filter(x => x != null);
    const colWidths = [12, 18, 20, 12, 15, 18, 12, 15, 12, 12, 15, 12, 12, 12, 10, 10, 15, 12, 15, 15, 15, 12, 12, 15, 18, 15, 12, 12, 14, 14, 15, 15, 12, 12, 15, 15, 15];
    const headerColors = {
      'PRODUCT': '#4472C4', 'HOD': '#4472C4', 'SUB-PRODUCT': '#4472C4', 'DAY': '#4472C4',
      'Target': '#ED7D31', 'Disbursement': '#ED7D31', 'Percentage': '#ED7D31', 'Number of Loans': '#ED7D31', 'Active Reps': '#ED7D31', 'Active Clients': '#ED7D31', 'Inactive Clients': '#ED7D31', 'Total Clients': '#ED7D31',
      'In Arrear': '#A5A5A5', 'Value in Arrears': '#A5A5A5', 'PAR>7': '#A5A5A5', 'PAR>30': '#A5A5A5',
      'Number of Leads': '#FFC000', 'Prospect': '#FFC000', 'Total Agents (CRM)': '#FFC000', 'Logged In Agents': '#FFC000',
      '% Logged In Agents': '#FFC000', 'Total TLS': '#FFC000', 'Logged In TLS': '#FFC000', '% Logged In TLS': '#FFC000',
      'Agent Completed at Location': '#FFC000', 'TLS Completed At Location': '#FFC000',
      'Total Calls': '#5B9BD5', 'Successful Calls': '#5B9BD5', 'Unsuccessful Calls': '#5B9BD5', '% Successful': '#5B9BD5',
      '% Unsuccessful': '#5B9BD5', '% Calls Reached': '#5B9BD5', '% Calls Not Reached': '#5B9BD5',
      'Total Agents (CC)': '#5B9BD5', 'Agents >50 Calls': '#5B9BD5', '% Agents >50': '#5B9BD5',
      'Agents <50 Calls': '#5B9BD5', '% Agents <50': '#5B9BD5'
    };
    const accountingColumns = ['Target', 'Disbursement', 'Number of Loans', 'Active Reps', 'Active Clients', 'Inactive Clients', 'Total Clients', 'In Arrear', 'Value in Arrears', 'PAR>7', 'PAR>30', 'Number of Leads', 'Prospect', 'Total Agents (CRM)', 'Logged In Agents', 'Total TLS', 'Logged In TLS', 'Total Calls', 'Successful Calls', 'Unsuccessful Calls', 'Total Agents (CC)', 'Agents >50 Calls', 'Agents <50 Calls'];
    if (exportData.length === 0) return [];
    return [{
      name: 'Sales Compliance Summary',
      tables: [{ data: exportData, totalRowIndices, colWidths, headerColors, accountingColumns }],
      freeze: { row: 1, col: 4 }
    }];
  };

  useImperativeHandle(ref, () => ({ getExportSheets }), [summaryData]);

  // Format number for display (accounting format)
  const formatValue = (value) => {
    if (value === '-' || value === null || value === undefined) return '-';
    if (typeof value === 'number') {
      return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
    return value;
  };

  if (isLoading) {
    return (
      <div className="scs-container">
        <div className="scs-header">
          <h3 className="scs-title">SALES AND COMPLIANCE SUMMARY</h3>
        </div>
        <div className="scs-loading">
          <LoadingSpinner size="medium" />
        </div>
      </div>
    );
  }

  return (
    <div className="scs-container">
      <div className="scs-header">
        <h3 className="scs-title">SALES AND COMPLIANCE SUMMARY</h3>
        <span className="scs-mode-badge">{mode === 'WEEKLY' ? 'Weekly View' : 'Monthly View'}</span>
      </div>
      
      <div className="scs-content">
        <div className="scs-table-wrapper">
          <table className="scs-table">
            <thead>
              {/* Main header row */}
              <tr className="scs-header-main">
                <th className="scs-th-product" rowSpan="2">PRODUCT</th>
                <th className="scs-th-hod" rowSpan="2">HOD</th>
                <th className="scs-th-subproduct" rowSpan="2">SUB-PRODUCT</th>
                <th className="scs-th-day" rowSpan="2">DAY</th>
                <th className="scs-th-sales" colSpan="8">SALES</th>
                <th className="scs-th-portfolio" colSpan="4">PORTFOLIO</th>
                <th className="scs-th-crm" colSpan="10">CRM</th>
                <th className="scs-th-callcenter" colSpan="12">CALL CENTER</th>
              </tr>
              {/* Sub-header row */}
              <tr className="scs-header-sub">
                {/* Sales sub-headers */}
                <th className="scs-th-sales-sub">Target</th>
                <th className="scs-th-sales-sub">Disbursement</th>
                <th className="scs-th-sales-sub">%</th>
                <th className="scs-th-sales-sub">No. Loans</th>
                <th className="scs-th-sales-sub">Active Reps</th>
                <th className="scs-th-sales-sub">Active Clients</th>
                <th className="scs-th-sales-sub">Inactive Clients</th>
                <th className="scs-th-sales-sub">Total Clients</th>
                {/* Portfolio sub-headers */}
                <th className="scs-th-portfolio-sub">In Arrear</th>
                <th className="scs-th-portfolio-sub">Value</th>
                <th className="scs-th-portfolio-sub">PAR&gt;7</th>
                <th className="scs-th-portfolio-sub">PAR&gt;30</th>
                {/* CRM sub-headers */}
                <th className="scs-th-crm-sub">Leads</th>
                <th className="scs-th-crm-sub">Prospect</th>
                <th className="scs-th-crm-sub">Total Agents</th>
                <th className="scs-th-crm-sub">Logged In</th>
                <th className="scs-th-crm-sub">% Logged</th>
                <th className="scs-th-crm-sub">Total TLS</th>
                <th className="scs-th-crm-sub">TLS Logged</th>
                <th className="scs-th-crm-sub">% TLS</th>
                <th className="scs-th-crm-sub">Agent At Loc</th>
                <th className="scs-th-crm-sub">TLS At Loc</th>
                {/* Call Center sub-headers */}
                <th className="scs-th-cc-sub">Total Calls</th>
                <th className="scs-th-cc-sub">Success</th>
                <th className="scs-th-cc-sub">Unsuccess</th>
                <th className="scs-th-cc-sub">% Success</th>
                <th className="scs-th-cc-sub">% Unsuccess</th>
                <th className="scs-th-cc-sub">% Reached</th>
                <th className="scs-th-cc-sub">% Not Reached</th>
                <th className="scs-th-cc-sub">Agents</th>
                <th className="scs-th-cc-sub">&gt;50 Calls</th>
                <th className="scs-th-cc-sub">% &gt;50</th>
                <th className="scs-th-cc-sub">&lt;50 Calls</th>
                <th className="scs-th-cc-sub">% &lt;50</th>
              </tr>
            </thead>
            <tbody>
              {summaryData.length > 0 ? (
                summaryData.map((row, index) => (
                  <tr key={index} className={`scs-row ${row.product ? 'scs-row-product-start' : ''} ${row.isTotalRow ? 'scs-row-total' : ''}`}>
                    <td className="scs-td-product">{row.product}</td>
                    <td className="scs-td-hod">{row.hod}</td>
                    <td className="scs-td-subproduct">{row.subProduct}</td>
                    <td className="scs-td-day">{row.day}</td>
                    {/* Sales */}
                    <td className="scs-td-sales">{formatValue(row.sales.target)}</td>
                    <td className="scs-td-sales">{formatValue(row.sales.disbursement)}</td>
                    <td className="scs-td-sales">{row.sales.percentage}</td>
                    <td className="scs-td-sales">{formatValue(row.sales.numberOfLoans)}</td>
                    <td className="scs-td-sales">{formatValue(row.sales.activeReps)}</td>
                    <td className="scs-td-sales">{formatValue(row.sales.activeClients)}</td>
                    <td className="scs-td-sales">{formatValue(row.sales.inactiveClients)}</td>
                    <td className="scs-td-sales">{formatValue(row.sales.totalClients)}</td>
                    {/* Portfolio */}
                    <td className="scs-td-portfolio">{formatValue(row.portfolio.inArrear)}</td>
                    <td className="scs-td-portfolio">{formatValue(row.portfolio.valueInArrears)}</td>
                    <td className="scs-td-portfolio">{row.portfolio.par7}</td>
                    <td className="scs-td-portfolio">{row.portfolio.par30}</td>
                    {/* CRM */}
                    <td className="scs-td-crm">{row.crm?.numberOfLeads ?? '-'}</td>
                    <td className="scs-td-crm">{row.crm?.prospect ?? '-'}</td>
                    <td className="scs-td-crm">{row.crm?.totalAgents ?? '-'}</td>
                    <td className="scs-td-crm">{row.crm?.loggedInAgents ?? '-'}</td>
                    <td className="scs-td-crm">{row.crm?.percentLoggedInAgents ?? '-'}</td>
                    <td className="scs-td-crm">{row.crm?.totalTLS ?? '-'}</td>
                    <td className="scs-td-crm">{row.crm?.loggedInTLS ?? '-'}</td>
                    <td className="scs-td-crm">{row.crm?.percentLoggedInTLS ?? '-'}</td>
                    <td className="scs-td-crm">{row.crm?.agentCompletedAtLocation ?? '-'}</td>
                    <td className="scs-td-crm">{row.crm?.tlsCompletedAtLocation ?? '-'}</td>
                    {/* Call Center */}
                    <td className="scs-td-cc">{row.callCenter?.totalCalls ?? '-'}</td>
                    <td className="scs-td-cc">{row.callCenter?.successfulCalls ?? '-'}</td>
                    <td className="scs-td-cc">{row.callCenter?.unsuccessfulCalls ?? '-'}</td>
                    <td className="scs-td-cc">{row.callCenter?.percentSuccessful ?? '-'}</td>
                    <td className="scs-td-cc">{row.callCenter?.percentUnsuccessful ?? '-'}</td>
                    <td className="scs-td-cc">{row.callCenter?.percentCallsReached ?? '-'}</td>
                    <td className="scs-td-cc">{row.callCenter?.percentCallsNotReached ?? '-'}</td>
                    <td className="scs-td-cc">{row.callCenter?.totalAgents ?? '-'}</td>
                    <td className="scs-td-cc">{row.callCenter?.agentsWithOver50Calls ?? '-'}</td>
                    <td className="scs-td-cc">{row.callCenter?.percentAgentsOver50 ?? '-'}</td>
                    <td className="scs-td-cc">{row.callCenter?.agentsWithUnder50Calls ?? '-'}</td>
                    <td className="scs-td-cc">{row.callCenter?.percentAgentsUnder50 ?? '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="39" className="scs-no-data">No data available</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="scs-footer">
        <button className="scs-export-btn" onClick={handleExport} title="Download this section as Excel">
          <span className="scs-export-icon">📥</span>
        </button>
      </div>
    </div>
  );
});

SalesComplianceSummary.displayName = 'SalesComplianceSummary';
export default SalesComplianceSummary;
