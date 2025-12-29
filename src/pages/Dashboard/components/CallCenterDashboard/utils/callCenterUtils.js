/**
 * Utility functions for Call Center Dashboard
 */

/**
 * Calculate metrics from call data
 */
export const calculateMetrics = (allCallData) => {
  if (!allCallData || allCallData.length === 0) {
    return {
      totalCalls: 0,
      inboundCalls: 0,
      outboundCalls: 0,
      internalCalls: 0,
      successfulCalls: 0,
      unsuccessfulCalls: 0,
      distinctCalledNumbers: 0,
      distinctCallingNumbers: 0
    };
  }

  const totalCalls = allCallData.length;
  
  // Communication type counts
  const communicationTypeCounts = {};
  allCallData.forEach(call => {
    const type = call['Communication Type'] || call['Communication_Type'] || 'Unknown';
    communicationTypeCounts[type] = (communicationTypeCounts[type] || 0) + 1;
  });

  const inboundCalls = communicationTypeCounts['Inbound'] || 0;
  const outboundCalls = communicationTypeCounts['Outbound'] || 0;
  const internalCalls = communicationTypeCounts['Internal'] || 0;

  // Success classification
  const successfulCalls = allCallData.filter(call => {
    const success = call['Successful ?'] || call['Successful'] || '';
    return success === 'Successful';
  }).length;

  const unsuccessfulCalls = totalCalls - successfulCalls;

  // Distinct numbers
  const outboundData = allCallData.filter(call => {
    const type = call['Communication Type'] || call['Communication_Type'] || '';
    return type === 'Outbound';
  });
  const distinctCalledNumbers = new Set(
    outboundData.map(call => call['Call To'] || call['Call_To'] || '').filter(Boolean)
  ).size;

  const inboundData = allCallData.filter(call => {
    const type = call['Communication Type'] || call['Communication_Type'] || '';
    return type === 'Inbound';
  });
  const distinctCallingNumbers = new Set(
    inboundData.map(call => call['Call From'] || call['Call_From'] || '').filter(Boolean)
  ).size;

  return {
    totalCalls,
    inboundCalls,
    outboundCalls,
    internalCalls,
    successfulCalls,
    unsuccessfulCalls,
    distinctCalledNumbers,
    distinctCallingNumbers,
    communicationTypeCounts
  };
};

/**
 * Get call notes distribution
 */
export const getCallNotesDistribution = (allCallData) => {
  if (!allCallData || allCallData.length === 0) return {};

  const notesCount = {};
  allCallData.forEach(call => {
    const note = call['Call Notes'] || call['Call_Notes'] || 'Unknown';
    notesCount[note] = (notesCount[note] || 0) + 1;
  });

  return notesCount;
};

/**
 * Get status distribution
 */
export const getStatusDistribution = (allCallData) => {
  if (!allCallData || allCallData.length === 0) return {};

  const statusCount = {};
  allCallData.forEach(call => {
    const status = call['Status'] || 'Unknown';
    statusCount[status] = (statusCount[status] || 0) + 1;
  });

  return statusCount;
};

/**
 * Get top agents by successful calls
 */
export const getTopAgents = (agentPerformance, limit = 10) => {
  if (!agentPerformance || agentPerformance.length === 0) return [];

  return agentPerformance
    .map(agent => {
      // Handle success rate - could be a string with % or a number
      let successRate = 0;
      const successRateValue = agent['Success Rate (%)'] || agent['Success_Rate'] || '0';
      if (typeof successRateValue === 'string') {
        // Remove % sign and parse
        successRate = parseFloat(successRateValue.replace('%', '')) || 0;
      } else {
        successRate = parseFloat(successRateValue) || 0;
      }

      return {
        name: agent['Agent Name'] || agent['Agent_Name'] || 'Unknown',
        successfulCalls: parseInt(agent['Successful Calls'] || agent['Successful_Calls'] || 0),
        totalCalls: parseInt(agent['Total Calls'] || agent['Total_Calls'] || 0),
        successRate: successRate
      };
    })
    .sort((a, b) => b.successfulCalls - a.successfulCalls)
    .slice(0, limit);
};

/**
 * Format percentage
 */
export const formatPercentage = (value, total) => {
  if (!total || total === 0) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
};

/**
 * Format number with commas
 */
export const formatNumber = (num) => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

