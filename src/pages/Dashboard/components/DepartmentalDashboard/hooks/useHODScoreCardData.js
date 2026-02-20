import { useMemo } from 'react';
import { useManagementData } from '../../ManagementDashboard/hooks/useManagementData';
import { useCRMData } from '../../CRMdashboard/hooks/useCRMData';
import { useMTDData } from '../../MTDdashboard/hooks/useMTDData';
import { useCallCenterData } from '../../CallCenterDashboard/hooks/useCallCenterData';
import { extractMetrics } from '../../CRMdashboard/utils/crmUtils';
import { calculateMetrics, getTopAgents } from '../../CallCenterDashboard/utils/callCenterUtils';

// HOD names - hardcoded as requested
const HOD_NAMES = {
  CS: 'KELVIN MWASALA',
  LBF: 'AUGUSTINE MPOLLO',
  SME: 'ABDULAKHIM KHALFANI',
  AgriFinance: 'ALLAN RUHUZA'
};

// Sub-products definitions
const SUB_PRODUCTS = {
  CS: ['CS', 'Cs Asset Finance'],
  LBF: ['LBF', 'IPF', 'MIF', 'MIF Customs', 'Lbf Yard Finance', 'LBF QUICKCASH', 'LBF-FLEX'],
  SME: ['SME'],
  AgriFinance: ['AgriFinance']
};

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const useHODScoreCardData = (mode = 'MONTHLY') => {
  const { parsedReports: managementReports } = useManagementData();
  const crmCS = useCRMData('CS');
  const crmLBF = useCRMData('LBF');
  const crmSME = useCRMData('SME');
  const mtdCS = useMTDData('CS');
  const mtdLBF = useMTDData('LBF');
  const mtdSME = useMTDData('SME');
  const callCenterCS = useCallCenterData('CS');
  const callCenterLBF = useCallCenterData('LBF');
  const callCenterSME = useCallCenterData('SME');

  // Helper: Get latest week's data
  const getLatestWeekData = (reports) => {
    if (!reports || reports.length === 0) return { weekData: {}, latestData: null };
    
    const sorted = [...reports].sort((a, b) => {
      const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
      const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
      return dateB - dateA;
    });

    const latestDate = sorted[0].date ? new Date(sorted[0].date) : new Date(sorted[0].createdAt);
    
    // Find Monday of that week
    const dayOfWeek = latestDate.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(latestDate);
    monday.setDate(latestDate.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const weekReports = sorted.filter(report => {
      const reportDate = report.date ? new Date(report.date) : new Date(report.createdAt);
      return reportDate >= monday && reportDate <= sunday;
    });

    const dayMap = {};
    DAYS_OF_WEEK.forEach(day => { dayMap[day] = null; });
    
    weekReports.forEach(report => {
      const reportDate = report.date ? new Date(report.date) : new Date(report.createdAt);
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = days[reportDate.getDay()];
      if (!dayMap[dayName] || reportDate > new Date(dayMap[dayName].date || dayMap[dayName].createdAt)) {
        dayMap[dayName] = report;
      }
    });

    return { weekData: dayMap, latestData: sorted[0] };
  };

  // Helper: Get management metrics for a product and sub-product
  const getManagementMetrics = (report, product, subProduct) => {
    if (!report) return null;
    
    let data = null;
    
    if (product === 'CS') {
      data = subProduct === 'Total' ? report.cs : report.csBranches?.[subProduct];
    } else if (product === 'LBF') {
      data = subProduct === 'Total' ? report.lbf : report.lbfBranches?.[subProduct];
    } else if (product === 'SME') {
      data = report.sme;
    } else if (product === 'AgriFinance') {
      data = report.agrifinance || report.AgriFinance;
    }
    
    if (!data || Object.keys(data).length === 0) return null;
    
    return {
      target: data['Target'] || data['Monthly Target'] || 0,
      disbursement: data['Disbursements This Month'] || data['Disbursement This Month'] || data['Disbursement this Month'] || 0,
      numberOfLoans: data['Number of loans'] || data['Number of Loans'] || data['No. of Loans'] || 0,
      activeReps: data['Active Reps'] || data['Active reps'] || 0,
      inArrear: data['In arrears'] ?? data['In Arrear'] ?? data['In arrear'] ?? 0,
      valueInArrears: data['Value in arrears'] ?? data['Value In Arrears'] ?? data['Value in Arrears'] ?? data['Value in arrears'] ?? 0,
      par7: data['PAR>7'] || data['PAR > 7'] || 0,
      par30: data['PAR>30'] || data['PAR > 30'] || 0
    };
  };

  // Helper: Get CRM metrics
  const getCRMMetrics = (product) => {
    const hookMap = { CS: crmCS, LBF: crmLBF, SME: crmSME };
    const hook = hookMap[product];
    
    if (!hook?.parsedData?.emailData) return null;
    
    const metrics = extractMetrics(hook.parsedData.emailData);
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
    
    return {
      numberOfLeads: getValue(['lead', 'count_leads', 'leads']),
      prospect: getValue(['prospect_lead', 'prospect', 'prospects']),
      totalAgents: getValue(['total_agent', 'total_count_agent']),
      loggedInAgents: getValue(['total_agent_logged_in', 'logged_in_agent']),
      totalTLS: getValue(['count_team_leaders', 'total_count_team_leaders']),
      loggedInTLS: getValue(['logged_in_team_leaders']),
      completedAtLocation: getValue(['agent_completed_at_location', 'agents_completed_at_location'])
    };
  };

  // Helper: Get Call Center metrics
  const getCallCenterMetrics = (product) => {
    const hookMap = { CS: callCenterCS, LBF: callCenterLBF, SME: callCenterSME };
    const hook = hookMap[product];
    
    if (!hook?.parsedData?.allCallData) return null;
    
    const metrics = calculateMetrics(hook.parsedData.allCallData);
    const agentPerformance = hook.parsedData.agentPerformance || [];
    
    const agentsWithOver50Calls = agentPerformance.filter(agent => {
      const totalCalls = agent['Total Calls'] || agent['Total_Calls'] || agent.totalCalls || 0;
      return totalCalls > 50;
    }).length;
    
    return {
      totalCalls: metrics.totalCalls,
      successfulCalls: metrics.successfulCalls,
      unsuccessfulCalls: metrics.unsuccessfulCalls,
      percentSuccessful: metrics.totalCalls > 0 ? (metrics.successfulCalls / metrics.totalCalls * 100) : 0,
      percentUnsuccessful: metrics.totalCalls > 0 ? (metrics.unsuccessfulCalls / metrics.totalCalls * 100) : 0,
      totalAgents: agentPerformance.length,
      agentsWithOver50Calls,
      percentAgentsOver50: agentPerformance.length > 0 ? (agentsWithOver50Calls / agentPerformance.length * 100) : 0
    };
  };

  // Helper: Get MTD metrics
  const getMTDMetrics = (product) => {
    const hookMap = { CS: mtdCS, LBF: mtdLBF, SME: mtdSME };
    const hook = hookMap[product];
    
    if (!hook?.parsedData?.groupedData) return null;
    
    let totalValue = 0;
    let totalLoans = 0;
    let totalTarget = 0;
    let totalActiveReps = 0;
    
    Object.values(hook.parsedData.groupedData).forEach(supervision => {
      if (supervision.supervisionData) {
        totalValue += Number(supervision.supervisionData['VALUE'] || supervision.supervisionData['Value'] || 0);
        totalLoans += Number(supervision.supervisionData['NO. OF LOANS'] || supervision.supervisionData['No. of Loans'] || 0);
        totalTarget += Number(supervision.supervisionData['MONTH TARGET'] || supervision.supervisionData['Month Target'] || 0);
        totalActiveReps += Number(supervision.supervisionData['NUMBER OF ACTIVE REPS'] || supervision.supervisionData['Active Reps'] || 0);
      }
    });
    
    return { totalValue, totalLoans, totalTarget, totalActiveReps };
  };

  // Collect all data for export
  const allData = useMemo(() => {
    const products = ['CS', 'LBF', 'SME', 'AgriFinance'];
    const { weekData, latestData } = getLatestWeekData(managementReports);

    // Sales and Compliance Summary (for export)
    const salesComplianceData = [];
    
    products.forEach(product => {
      const subProducts = SUB_PRODUCTS[product] || [product];
      const hod = HOD_NAMES[product] || 'TBD';
      const crmData = getCRMMetrics(product);
      const callCenterData = getCallCenterMetrics(product);
      
      if (mode === 'WEEKLY') {
        subProducts.forEach((subProduct, subIndex) => {
          DAYS_OF_WEEK.forEach((day, dayIndex) => {
            const report = weekData[day];
            const mgmtData = getManagementMetrics(report, product, subProduct);
            
            salesComplianceData.push({
              'PRODUCT': dayIndex === 0 && subIndex === 0 ? product : '',
              'HOD': dayIndex === 0 && subIndex === 0 ? hod : '',
              'SUB-PRODUCT': dayIndex === 0 ? subProduct : '',
              'DAY': day,
              'Target': mgmtData?.target || '-',
              'Disbursement': mgmtData?.disbursement || '-',
              '% Achieved': mgmtData?.target && mgmtData?.disbursement 
                ? ((mgmtData.disbursement / mgmtData.target) * 100).toFixed(1) + '%' 
                : '-',
              'No. Loans': mgmtData?.numberOfLoans || '-',
              'Active Reps': mgmtData?.activeReps || '-',
              'In Arrear': mgmtData?.inArrear || '-',
              'Value Arrears': mgmtData?.valueInArrears || '-',
              'PAR>7': mgmtData?.par7 || '-',
              'PAR>30': mgmtData?.par30 || '-',
              'Leads': subIndex === 0 && dayIndex === 0 ? (crmData?.numberOfLeads || '-') : '',
              'Prospect': subIndex === 0 && dayIndex === 0 ? (crmData?.prospect || '-') : '',
              'Total Agents': subIndex === 0 && dayIndex === 0 ? (crmData?.totalAgents || '-') : '',
              'Total Calls': subIndex === 0 && dayIndex === 0 ? (callCenterData?.totalCalls || '-') : '',
              'Success Calls': subIndex === 0 && dayIndex === 0 ? (callCenterData?.successfulCalls || '-') : '',
              '% Success': subIndex === 0 && dayIndex === 0 ? (callCenterData?.percentSuccessful?.toFixed(1) + '%' || '-') : ''
            });
          });
        });
      } else {
        // Monthly mode - simplified
        subProducts.forEach((subProduct, subIndex) => {
          const latestReport = (managementReports || []).sort((a, b) => {
            const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
            const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
            return dateB - dateA;
          })[0];
          
          const mgmtData = getManagementMetrics(latestReport, product, subProduct);
          
          salesComplianceData.push({
            'PRODUCT': subIndex === 0 ? product : '',
            'HOD': subIndex === 0 ? hod : '',
            'SUB-PRODUCT': subProduct,
            'Target': mgmtData?.target || '-',
            'Disbursement': mgmtData?.disbursement || '-',
            '% Achieved': mgmtData?.target && mgmtData?.disbursement 
              ? ((mgmtData.disbursement / mgmtData.target) * 100).toFixed(1) + '%' 
              : '-',
            'No. Loans': mgmtData?.numberOfLoans || '-',
            'Active Reps': mgmtData?.activeReps || '-',
            'In Arrear': mgmtData?.inArrear || '-',
            'Value Arrears': mgmtData?.valueInArrears || '-',
            'PAR>7': mgmtData?.par7 || '-',
            'PAR>30': mgmtData?.par30 || '-',
            'Leads': subIndex === 0 ? (crmData?.numberOfLeads || '-') : '',
            'Prospect': subIndex === 0 ? (crmData?.prospect || '-') : '',
            'Total Agents': subIndex === 0 ? (crmData?.totalAgents || '-') : '',
            'Total Calls': subIndex === 0 ? (callCenterData?.totalCalls || '-') : '',
            'Success Calls': subIndex === 0 ? (callCenterData?.successfulCalls || '-') : '',
            '% Success': subIndex === 0 ? (callCenterData?.percentSuccessful?.toFixed(1) + '%' || '-') : ''
          });
        });
      }
    });

    // Production Sales Tracker
    const productionSalesData = products.map(product => {
      const deptKey = product === 'CS' ? 'cs' : product === 'LBF' ? 'lbf' : product === 'SME' ? 'sme' : 'agrifinance';
      const deptReports = (managementReports || [])
        .filter(r => r[deptKey] && Object.keys(r[deptKey]).length > 0)
        .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
      
      const latest = deptReports[0];
      const previous = deptReports[1] || null;
      
      if (!latest) return null;
      
      const latestData = latest[deptKey];
      const prevData = previous ? previous[deptKey] : {};
      
      const disbursement = latestData['Disbursements This Month'] || latestData['Disbursement This Month'] || 0;
      const target = latestData['Target'] || latestData['Monthly Target'] || 0;
      const prevDisbursement = prevData['Disbursements This Month'] || prevData['Disbursement This Month'] || 0;
      
      return {
        'Product': product,
        'Target': target,
        'Disbursement': disbursement,
        'Required to End': Math.max(0, target - disbursement),
        '% Achieved': target > 0 ? ((disbursement / target) * 100).toFixed(1) + '%' : '-',
        'Previous Month': prevDisbursement,
        'Change %': prevDisbursement > 0 ? (((disbursement - prevDisbursement) / prevDisbursement) * 100).toFixed(1) + '%' : '-'
      };
    }).filter(Boolean);

    // Leads and Marketing Tracker
    const leadsMarketingData = products.slice(0, 3).map(product => {
      const crm = getCRMMetrics(product);
      if (!crm) return null;
      return {
        'Product': product,
        'Leads': crm.numberOfLeads,
        'Prospect': crm.prospect,
        'Conv %': crm.numberOfLeads > 0 ? ((crm.prospect / crm.numberOfLeads) * 100).toFixed(1) + '%' : '-',
        'Total Agents': crm.totalAgents,
        'Logged In Agents': crm.loggedInAgents,
        'Total TLS': crm.totalTLS,
        'Logged In TLS': crm.loggedInTLS
      };
    }).filter(Boolean);

    // Product Sales Tracker (MTD)
    const productSalesData = products.slice(0, 3).map(product => {
      const mtd = getMTDMetrics(product);
      if (!mtd) return null;
      return {
        'Product': product,
        'Total Value': mtd.totalValue,
        'Total Loans': mtd.totalLoans,
        'Target': mtd.totalTarget,
        '% Achieved': mtd.totalTarget > 0 ? ((mtd.totalValue / mtd.totalTarget) * 100).toFixed(1) + '%' : '-',
        'Avg Loan': mtd.totalLoans > 0 ? (mtd.totalValue / mtd.totalLoans).toFixed(0) : '-',
        'Active Reps': mtd.totalActiveReps
      };
    }).filter(Boolean);

    // Call Center Performance
    const callCenterData = products.slice(0, 3).map(product => {
      const cc = getCallCenterMetrics(product);
      if (!cc) return null;
      return {
        'Product': product,
        'Total Calls': cc.totalCalls,
        'Success': cc.successfulCalls,
        'Fail': cc.unsuccessfulCalls,
        '% Success': cc.percentSuccessful.toFixed(1) + '%',
        '% Fail': cc.percentUnsuccessful.toFixed(1) + '%',
        'Total Agents': cc.totalAgents,
        '>50 Calls': cc.agentsWithOver50Calls,
        '% >50': cc.percentAgentsOver50.toFixed(1) + '%'
      };
    }).filter(Boolean);

    return {
      salesComplianceData,
      productionSalesData,
      leadsMarketingData,
      productSalesData,
      callCenterData
    };
  }, [managementReports, crmCS.parsedData, crmLBF.parsedData, crmSME.parsedData,
      mtdCS.parsedData, mtdLBF.parsedData, mtdSME.parsedData,
      callCenterCS.parsedData, callCenterLBF.parsedData, callCenterSME.parsedData, mode]);

  return allData;
};
