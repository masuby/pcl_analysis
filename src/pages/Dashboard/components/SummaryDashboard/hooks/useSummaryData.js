import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { extractMetrics } from '../../CRMdashboard/utils/crmUtils';
import { calculateMetrics, getTopAgents } from '../../CallCenterDashboard/utils/callCenterUtils';
import { useManagementData } from '../../ManagementDashboard/hooks/useManagementData';
import { useCRMData } from '../../CRMdashboard/hooks/useCRMData';
import { useCallCenterData } from '../../CallCenterDashboard/hooks/useCallCenterData';
import { useMTDData } from '../../MTDdashboard/hooks/useMTDData';
import { useReportRefresh } from '../../../../../contexts/ReportRefreshContext';

// In-memory cache that persists across component mounts
const summaryCache = new Map();

export const useSummaryData = () => {
  const { refreshTrigger } = useReportRefresh();
  const [managementData, setManagementData] = useState(() => summaryCache.get('management_summary') || null);
  const [crmData, setCrmData] = useState(() => summaryCache.get('crm_data') || {});
  const [callCenterData, setCallCenterData] = useState(() => summaryCache.get('callcenter_data') || {});
  const [mtdData, setMtdData] = useState(() => summaryCache.get('mtd_data') || {});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const processingRef = useRef(false);
  const initialProcessDone = useRef(false);

  // Listen for refresh events
  useEffect(() => {
    if (refreshTrigger > 0) {
      console.log('[SummaryDashboard] Refresh triggered, clearing cache');
      // Clear all summary caches
      summaryCache.clear();
      setManagementData(null);
      setCrmData({});
      setCallCenterData({});
      setMtdData({});
      initialProcessDone.current = false;
      processingRef.current = false;
    }
  }, [refreshTrigger]);

  // Use existing hooks for data fetching - these handle their own caching
  const { parsedReports: managementReports, loading: managementLoading } = useManagementData();
  const crmCS = useCRMData('CS');
  const crmLBF = useCRMData('LBF');
  const crmSME = useCRMData('SME');
  const callCenterCS = useCallCenterData('CS');
  const callCenterLBF = useCallCenterData('LBF');
  const callCenterSME = useCallCenterData('SME');
  const mtdCS = useMTDData('CS');
  const mtdLBF = useMTDData('LBF');
  const mtdSME = useMTDData('SME');

  // Process management data
  const processManagementData = useCallback(() => {
    // Check cache first - if we already have data, don't reprocess
    const cached = summaryCache.get('management_summary');
    if (cached && managementData && JSON.stringify(cached) === JSON.stringify(managementData)) {
      return;
    }

    if (!managementReports || managementReports.length === 0) {
      if (!managementLoading) {
        setManagementData(null);
      }
      return;
    }

    try {
      // Get latest report with Country data (same pattern as CountrywiseSummary)
      const countrywiseData = managementReports
        .filter(report => report.countrywise && Object.keys(report.countrywise).length > 0)
        .map(report => ({
          fileName: report.fileName || 'Unknown',
          date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
          ...report.countrywise
        }));

      if (countrywiseData.length === 0) {
        setManagementData(null);
        return;
      }

      // Sort by date descending
      countrywiseData.sort((a, b) => b.date - a.date);
      const latestMonth = countrywiseData[0];
      
      // Get previous month for trend
      const previousMonth = countrywiseData.length > 1 ? countrywiseData[1] : null;

      // Extract values (same pattern as CountrywiseSummary)
      const disbursements = latestMonth['Disbursements This Month'] || latestMonth['Disbursement This Month'] || latestMonth['Disbursement this Month'] || 0;
      const target = latestMonth['Target'] || latestMonth['Monthly Target'] || 0;
      const newBusiness = latestMonth['New Business'] || latestMonth['New Loans'] || 0;
      const repeatBusiness = latestMonth['Repeat Business'] || latestMonth['Refinance'] || 0;
      const numberOfLoans = latestMonth['Number of loans'] || latestMonth['Number of Loans'] || latestMonth['No. of Loans'] || 0;
      const averageLoanSize = latestMonth['Average loan size'] || latestMonth['Average Loan Size'] || latestMonth['Avg Loan Size'] || 0;
      const par30 = latestMonth['PAR>30'] || latestMonth['PAR > 30'] || latestMonth['Par>30'] || 0;
      const activeReps = latestMonth['Active Reps'] || latestMonth['Active clients'] || 0;

      // Calculate trend
      let trend = 0;
      if (previousMonth) {
        const prevDisbursements = previousMonth['Disbursements This Month'] || previousMonth['Disbursement This Month'] || 0;
        if (prevDisbursements > 0) {
          trend = ((disbursements - prevDisbursements) / prevDisbursements) * 100;
        }
      }

      // Get last 10 data points for trend graph (most recent first)
      const trendData = countrywiseData.slice(0, 10).reverse().map(item => ({
        date: item.date,
        value: item['Disbursements This Month'] || item['Disbursement This Month'] || item['Disbursement this Month'] || 0
      }));

      const summary = {
        disbursementThisMonth: disbursements,
        trend: trend,
        newBusiness: newBusiness,
        repeatBusiness: repeatBusiness,
        par30: par30,
        numberOfLoans: numberOfLoans,
        averageLoanSize: averageLoanSize,
        activeReps: activeReps,
        target: target,
        trendData: trendData,
        reportDate: latestMonth.date
      };

      summaryCache.set('management_summary', summary);
      setManagementData(summary);
    } catch (err) {
      console.error('Error processing management summary:', err);
      setManagementData(null);
    }
  }, [managementReports, managementLoading, managementData]);

  // Process CRM data
  const processCRMData = useCallback(() => {
    // Check if we already have cached data
    const cached = summaryCache.get('crm_data');
    if (cached && Object.keys(cached).length > 0) {
      // Only update if we have new data
      const hasNewData = Object.values({ CS: crmCS, LBF: crmLBF, SME: crmSME }).some(
        hook => hook.parsedData && !hook.loading
      );
      if (!hasNewData) {
        return;
      }
    }

    try {
      const departments = ['CS', 'LBF', 'SME'];
      const crmHooks = { CS: crmCS, LBF: crmLBF, SME: crmSME };
      const result = {};

      for (const dept of departments) {
        const hook = crmHooks[dept];
        
        // Skip if still loading or no data
        if (hook.loading || !hook.parsedData) {
          // Use cached data if available
          if (cached && cached[dept]) {
            result[dept] = cached[dept];
          } else {
            result[dept] = null;
          }
          continue;
        }

        const metrics = extractMetrics(hook.parsedData.emailData || []);
        
        // Helper to get value with fallbacks
        const getValue = (keys, defaultVal = 0) => {
          for (const key of keys) {
            const val = metrics[key.toLowerCase()];
            if (val !== undefined && val !== null && val !== '') {
              const num = parseInt(val) || 0;
              if (num > 0) return num;
            }
          }
          return defaultVal;
        };

        // Extract counts from summary sheets
        let totalAgents = 0;
        let totalTeamLeaders = 0;
        
        if (hook.parsedData.agentSummary && hook.parsedData.agentSummary.length > 0) {
          totalAgents = hook.parsedData.agentSummary.length;
        }
        
        if (hook.parsedData.teamLeaderSummary && hook.parsedData.teamLeaderSummary.length > 0) {
          totalTeamLeaders = hook.parsedData.teamLeaderSummary.length;
        }

        // Department-specific metric keys
        const metricKeys = dept === 'CS' ? {
          numberOfLeads: ['lead', 'count_leads', 'leads'],
          prospectLeads: ['prospect_lead', 'prospect', 'prospects'],
          totalAgents: ['total_agent', 'total_count_agent', 'total agents'],
          totalTeamLeaders: ['count_team_leaders', 'total_count_team_leaders', 'total team leaders'],
          loggedInAgents: ['total_agent_logged_in', 'logged_in_agent', 'logged_in_agents'],
          loggedInTeamLeaders: ['logged_in_team_leaders', 'logged in team leaders'],
          branchesNoActivity: ['branches_count_without_assgned_activities', 'agent_count_without_planned_location', 'branches without activities']
        } : dept === 'LBF' ? {
          numberOfLeads: ['lead', 'count_leads', 'leads'],
          prospectLeads: ['prospect_lead', 'prospect', 'prospects'],
          totalAgents: ['total_count_agent', 'total_agent', 'total agents'],
          totalTeamLeaders: ['total_count_team_leaders', 'count_team_leaders', 'total team leaders'],
          loggedInAgents: ['logged_in_agent', 'total_agent_logged_in', 'logged_in_agents'],
          loggedInTeamLeaders: ['logged_in_team_leaders', 'logged in team leaders'],
          branchesNoActivity: ['agents_no_assigned_location', 'branches_count_without_assgned_activities']
        } : {
          numberOfLeads: ['count_leads', 'lead', 'leads'],
          prospectLeads: ['prospect_lead', 'prospect', 'prospects'],
          totalAgents: ['total_count_agent', 'total_agent', 'total agents'],
          totalTeamLeaders: ['total_count_team_leaders', 'count_team_leaders', 'total team leaders'],
          loggedInAgents: ['logged_in_agents', 'logged_in_agent', 'total_agent_logged_in'],
          loggedInTeamLeaders: ['logged_in_team_leaders', 'logged in team leaders'],
          branchesNoActivity: ['tl_no_planned_visited_location', 'branches_count_without_assgned_activities']
        };

        result[dept] = {
          numberOfLeads: getValue(metricKeys.numberOfLeads),
          prospectLeads: getValue(metricKeys.prospectLeads),
          totalAgents: totalAgents || getValue(metricKeys.totalAgents),
          totalTeamLeaders: totalTeamLeaders || getValue(metricKeys.totalTeamLeaders),
          loggedInAgents: getValue(metricKeys.loggedInAgents),
          loggedInTeamLeaders: getValue(metricKeys.loggedInTeamLeaders),
          branchesNoActivity: getValue(metricKeys.branchesNoActivity),
          reportDate: hook.parsedData.reportDate
        };
      }

      summaryCache.set('crm_data', result);
      setCrmData(result);
    } catch (err) {
      console.error('Error processing CRM data:', err);
      // Keep existing data on error
      if (cached) {
        setCrmData(cached);
      }
    }
  }, [crmCS, crmLBF, crmSME]);

  // Process Call Center data
  const processCallCenterData = useCallback(() => {
    const cached = summaryCache.get('callcenter_data');
    if (cached && Object.keys(cached).length > 0) {
      const hasNewData = Object.values({ CS: callCenterCS, LBF: callCenterLBF, SME: callCenterSME }).some(
        hook => hook.parsedData && !hook.loading
      );
      if (!hasNewData) {
        return;
      }
    }

    try {
      const departments = ['CS', 'LBF', 'SME'];
      const callCenterHooks = { CS: callCenterCS, LBF: callCenterLBF, SME: callCenterSME };
      const result = {};

      for (const dept of departments) {
        const hook = callCenterHooks[dept];
        
        if (hook.loading || !hook.parsedData) {
          if (cached && cached[dept]) {
            result[dept] = cached[dept];
          } else {
            result[dept] = null;
          }
          continue;
        }

        const allCallData = hook.parsedData.allCallData || [];
        const agentPerformance = hook.parsedData.agentPerformance || [];

        // Use existing calculateMetrics utility
        const metrics = calculateMetrics(allCallData);
        const topAgents = getTopAgents(agentPerformance, 5);

        result[dept] = {
          totalCalls: metrics.totalCalls,
          successfulCalls: metrics.successfulCalls,
          unsuccessfulCalls: metrics.unsuccessfulCalls,
          uniqueCalledNumbers: metrics.distinctCalledNumbers,
          uniqueCallingNumbers: metrics.distinctCallingNumbers,
          activeAgents: agentPerformance.length || topAgents.length,
          topAgents: topAgents,
          reportDate: hook.parsedData.reportDate
        };
      }

      summaryCache.set('callcenter_data', result);
      setCallCenterData(result);
    } catch (err) {
      console.error('Error processing call center data:', err);
      if (cached) {
        setCallCenterData(cached);
      }
    }
  }, [callCenterCS, callCenterLBF, callCenterSME]);

  // Process MTD data
  const processMTDData = useCallback(() => {
    const cached = summaryCache.get('mtd_data');
    if (cached && Object.keys(cached).length > 0) {
      const hasNewData = Object.values({ CS: mtdCS, LBF: mtdLBF, SME: mtdSME }).some(
        hook => hook.parsedData && !hook.loading
      );
      if (!hasNewData) {
        return;
      }
    }

    try {
      const departments = ['CS', 'LBF', 'SME'];
      const mtdHooks = { CS: mtdCS, LBF: mtdLBF, SME: mtdSME };
      const result = {};

      for (const dept of departments) {
        const hook = mtdHooks[dept];
        
        if (hook.loading || !hook.parsedData || !hook.parsedData.groupedData) {
          if (cached && cached[dept]) {
            result[dept] = cached[dept];
          } else {
            result[dept] = null;
          }
          continue;
        }

        // Extract top performers by Value from grouped data - separate by type
        const supervisionPerformers = [];
        const teamLeaderPerformers = [];
        
        Object.values(hook.parsedData.groupedData).forEach(supervision => {
          // Add supervision if it has Value
          if (supervision.supervisionData) {
            const value = Number(supervision.supervisionData['VALUE'] || supervision.supervisionData['Value'] || 0);
            if (value > 0) {
              supervisionPerformers.push({
                name: supervision.supervision || 'Unknown',
                value: value,
                type: 'supervision'
              });
            }
          }
          
          // Add team leaders
          supervision.teamLeaders.forEach(tl => {
            if (tl.data) {
              const value = Number(tl.data['VALUE'] || tl.data['Value'] || 0);
              if (value > 0) {
                teamLeaderPerformers.push({
                  name: tl.name || 'Unknown',
                  value: value,
                  type: 'teamleader'
                });
              }
            }
          });
        });

        // Sort by value and get top 10 for each
        supervisionPerformers.sort((a, b) => b.value - a.value);
        teamLeaderPerformers.sort((a, b) => b.value - a.value);
        
        const topSupervisions = supervisionPerformers.slice(0, 10);
        const topTeamLeaders = teamLeaderPerformers.slice(0, 10);

        result[dept] = {
          supervisions: topSupervisions,
          teamLeaders: topTeamLeaders,
          totalSupervisionValue: topSupervisions.reduce((sum, p) => sum + p.value, 0),
          totalTeamLeaderValue: topTeamLeaders.reduce((sum, p) => sum + p.value, 0),
          reportDate: hook.parsedData.reportDate
        };
      }

      summaryCache.set('mtd_data', result);
      setMtdData(result);
    } catch (err) {
      console.error('Error processing MTD data:', err);
      if (cached) {
        setMtdData(cached);
      }
    }
  }, [mtdCS, mtdLBF, mtdSME]);

  // Track previous data to detect actual changes
  const prevDataRef = useRef({
    managementReports: null,
    crmCS: null,
    crmLBF: null,
    crmSME: null,
    callCenterCS: null,
    callCenterLBF: null,
    callCenterSME: null,
    mtdCS: null,
    mtdLBF: null,
    mtdSME: null
  });

  // Process all data when hooks have data - only when data actually changes
  useEffect(() => {
    if (processingRef.current) return;
    
    // Check if data actually changed
    const dataChanged = 
      prevDataRef.current.managementReports !== managementReports ||
      prevDataRef.current.crmCS !== crmCS.parsedData ||
      prevDataRef.current.crmLBF !== crmLBF.parsedData ||
      prevDataRef.current.crmSME !== crmSME.parsedData ||
      prevDataRef.current.callCenterCS !== callCenterCS.parsedData ||
      prevDataRef.current.callCenterLBF !== callCenterLBF.parsedData ||
      prevDataRef.current.callCenterSME !== callCenterSME.parsedData ||
      prevDataRef.current.mtdCS !== mtdCS.parsedData ||
      prevDataRef.current.mtdLBF !== mtdLBF.parsedData ||
      prevDataRef.current.mtdSME !== mtdSME.parsedData;

    // Check if any hooks are still loading (only on initial load)
    const anyLoading = managementLoading ||
      (crmCS.loading && !crmCS.parsedData) ||
      (crmLBF.loading && !crmLBF.parsedData) ||
      (crmSME.loading && !crmSME.parsedData) ||
      (callCenterCS.loading && !callCenterCS.parsedData) ||
      (callCenterLBF.loading && !callCenterLBF.parsedData) ||
      (callCenterSME.loading && !callCenterSME.parsedData) ||
      (mtdCS.loading && !mtdCS.parsedData) ||
      (mtdLBF.loading && !mtdLBF.parsedData) ||
      (mtdSME.loading && !mtdSME.parsedData);

    if (anyLoading && !initialProcessDone.current) {
      setLoading(true);
      return;
    }

    // Only process if data changed or we haven't processed yet
    if (!dataChanged && initialProcessDone.current) {
      setLoading(false);
      return;
    }

    // Process data
    processingRef.current = true;
    setLoading(false);
    
    processManagementData();
    processCRMData();
    processCallCenterData();
    processMTDData();
    
    // Update refs
    prevDataRef.current = {
      managementReports,
      crmCS: crmCS.parsedData,
      crmLBF: crmLBF.parsedData,
      crmSME: crmSME.parsedData,
      callCenterCS: callCenterCS.parsedData,
      callCenterLBF: callCenterLBF.parsedData,
      callCenterSME: callCenterSME.parsedData,
      mtdCS: mtdCS.parsedData,
      mtdLBF: mtdLBF.parsedData,
      mtdSME: mtdSME.parsedData
    };
    
    initialProcessDone.current = true;
    processingRef.current = false;
  }, [
    managementReports, managementLoading,
    crmCS.parsedData, crmCS.loading,
    crmLBF.parsedData, crmLBF.loading,
    crmSME.parsedData, crmSME.loading,
    callCenterCS.parsedData, callCenterCS.loading,
    callCenterLBF.parsedData, callCenterLBF.loading,
    callCenterSME.parsedData, callCenterSME.loading,
    mtdCS.parsedData, mtdCS.loading,
    mtdLBF.parsedData, mtdLBF.loading,
    mtdSME.parsedData, mtdSME.loading,
    processManagementData,
    processCRMData,
    processCallCenterData,
    processMTDData
  ]);

  const refreshData = useCallback(() => {
    summaryCache.clear();
    initialProcessDone.current = false;
    processingRef.current = false;
    setManagementData(null);
    setCrmData({});
    setCallCenterData({});
    setMtdData({});
  }, []);

  // Calculate overall loading state - only show loading if we have no cached data
  const overallLoading = useMemo(() => {
    const hasCachedData = summaryCache.has('management_summary') || 
                         Object.keys(summaryCache.get('crm_data') || {}).length > 0 ||
                         Object.keys(summaryCache.get('callcenter_data') || {}).length > 0 ||
                         Object.keys(summaryCache.get('mtd_data') || {}).length > 0;
    
    if (hasCachedData) {
      return false; // Don't show loading if we have cached data
    }
    
    return loading || managementLoading ||
      (crmCS.loading && !crmCS.parsedData) ||
      (crmLBF.loading && !crmLBF.parsedData) ||
      (crmSME.loading && !crmSME.parsedData) ||
      (callCenterCS.loading && !callCenterCS.parsedData) ||
      (callCenterLBF.loading && !callCenterLBF.parsedData) ||
      (callCenterSME.loading && !callCenterSME.parsedData) ||
      (mtdCS.loading && !mtdCS.parsedData) ||
      (mtdLBF.loading && !mtdLBF.parsedData) ||
      (mtdSME.loading && !mtdSME.parsedData);
  }, [
    loading, managementLoading,
    crmCS.loading, crmCS.parsedData,
    crmLBF.loading, crmLBF.parsedData,
    crmSME.loading, crmSME.parsedData,
    callCenterCS.loading, callCenterCS.parsedData,
    callCenterLBF.loading, callCenterLBF.parsedData,
    callCenterSME.loading, callCenterSME.parsedData,
    mtdCS.loading, mtdCS.parsedData,
    mtdLBF.loading, mtdLBF.parsedData,
    mtdSME.loading, mtdSME.parsedData
  ]);

  return {
    managementData,
    crmData,
    callCenterData,
    mtdData,
    loading: overallLoading,
    error,
    refreshData
  };
};

export default useSummaryData;
