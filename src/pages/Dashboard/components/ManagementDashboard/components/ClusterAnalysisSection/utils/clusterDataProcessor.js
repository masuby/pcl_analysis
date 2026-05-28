/**
 * Processes pre-parsed report data and organizes them by cluster structure
 * Now uses data from the database instead of re-parsing Excel files
 */

import { getBranchMapping } from './clusterDataMapper';
import { getClusterData } from '../../../../../../../services/reports';

// In-memory cache for cluster data
let clusterDataCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Process cluster data from API (pre-parsed from database)
 */
export const processClusterData = async (parsedReports) => {
  // Check if we have valid cached data
  const now = Date.now();
  if (clusterDataCache && (now - cacheTimestamp) < CACHE_TTL) {

    return clusterDataCache;
  }

  // Fetch pre-parsed cluster data from API
  const result = await getClusterData();
  
  if (!result.success || !result.data) {
    console.warn('Failed to fetch cluster data from API, falling back to parsedReports');
    return processFromParsedReports(parsedReports);
  }

  const clusterData = {
    CS: {},
    LBF: {},
    SME: {}
  };

  // The API returns data grouped by branch: { "Branch Name": [{ metrics }, ...] }
  const branchData = result.data;

  // Process each branch
  Object.keys(branchData).forEach(branchName => {
    if (!branchName) return;

    const rows = branchData[branchName];
    if (!rows || rows.length === 0) return;

    // Check if this is a zone row
    const isZoneRow = branchName.includes('Zone') && (
      branchName === 'Northern Zone' || branchName === 'Pwani Zone' || branchName === 'Central Zone' ||
      branchName === 'Western Zone' || branchName === 'Lake Victoria Zone' || branchName === 'Highland Zone' ||
      branchName === 'Southern Highland Zone' || branchName === 'Nyasa Zone'
    );

    // Check if this is a cluster row
    const isClusterRow = branchName === 'Cluster 1' || branchName === 'Cluster 2' || branchName === 'Cluster 3' ||
      branchName === 'ZANZIBAR' || branchName === 'CS Call center' || branchName === 'Lbf Call Center' ||
      branchName === 'Lbf Cluster' || branchName === 'SMEs';

    let type = null;
    let cluster = null;
    let zone = null;

    if (isZoneRow) {
      // Determine cluster and type from zone name
      if (['Northern Zone', 'Pwani Zone', 'Central Zone'].includes(branchName)) {
        type = 'CS';
        cluster = 'Cluster 1';
        zone = branchName;
      } else if (['Western Zone', 'Lake Victoria Zone', 'Highland Zone'].includes(branchName)) {
        type = 'CS';
        cluster = 'Cluster 2';
        zone = branchName;
      } else if (['Southern Highland Zone', 'Nyasa Zone'].includes(branchName)) {
        type = 'CS';
        cluster = 'Cluster 3';
        zone = branchName;
      }
    } else if (isClusterRow) {
      // Determine type from cluster name
      if (branchName === 'Cluster 1' || branchName === 'Cluster 2' || branchName === 'Cluster 3' || 
          branchName === 'ZANZIBAR' || branchName === 'CS Call center') {
        type = 'CS';
        cluster = branchName;
      } else if (branchName === 'Lbf Call Center' || branchName === 'Lbf Cluster') {
        type = 'LBF';
        cluster = branchName;
      } else if (branchName === 'SMEs') {
        type = 'SME';
        cluster = branchName;
      }
    } else {
      // Regular branch - get mapping
      const normalizedBranchName = branchName.trim().replace(/\s+/g, ' ');
      const mapping = getBranchMapping(normalizedBranchName) || getBranchMapping(branchName);
      if (mapping) {
        type = mapping.type;
        cluster = mapping.cluster;
        zone = mapping.zone;
      }
    }

    if (!type || !cluster) return;

    // Initialize structure if needed
    if (!clusterData[type][cluster]) {
      clusterData[type][cluster] = {
        rows: [],
        zones: {},
        branches: []
      };
    }

    // Process each row for this branch
    rows.forEach(row => {
      const rowData = {
        ...row,
        branchName: branchName,
        type: type,
        cluster: cluster,
        zone: zone,
        date: row.date ? new Date(row.date) : new Date()
      };

      // Add to cluster rows
      clusterData[type][cluster].rows.push(rowData);

      // Handle zones
      if (isZoneRow && zone) {
        if (!clusterData[type][cluster].zones[zone]) {
          clusterData[type][cluster].zones[zone] = {
            rows: [],
            branches: []
          };
        }
        clusterData[type][cluster].zones[zone].rows.push(rowData);
      } else if (!isZoneRow && !isClusterRow) {
        // Regular branch
        if (zone) {
          if (!clusterData[type][cluster].zones[zone]) {
            clusterData[type][cluster].zones[zone] = {
              rows: [],
              branches: []
            };
          }
          if (!clusterData[type][cluster].zones[zone].branches.includes(branchName)) {
            clusterData[type][cluster].zones[zone].branches.push(branchName);
          }
        } else {
          if (!clusterData[type][cluster].branches.includes(branchName)) {
            clusterData[type][cluster].branches.push(branchName);
          }
        }
      }
    });
  });

  // Cache the result
  clusterDataCache = clusterData;
  cacheTimestamp = now;

  return clusterData;
};

/**
 * Fallback: Process from parsedReports if API fails
 */
const processFromParsedReports = (parsedReports) => {
  if (!parsedReports || parsedReports.length === 0) {
    return { CS: {}, LBF: {}, SME: {} };
  }

  const clusterData = {
    CS: {},
    LBF: {},
    SME: {}
  };

  // Use the already parsed data from parsedReports
  parsedReports.forEach(report => {
    const reportDate = report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date();
    const fileName = report.fileName || 'Unknown';
    const reportId = report.id;

    // Process CS branches
    if (report.csBranches) {
      Object.keys(report.csBranches).forEach(branchName => {
        const branchData = report.csBranches[branchName];
        if (!branchData || Object.keys(branchData).length === 0) return;

        const mapping = getBranchMapping(branchName);
        if (!mapping) return;

        const { type, cluster, zone } = mapping;
        
        if (!clusterData[type][cluster]) {
          clusterData[type][cluster] = { rows: [], zones: {}, branches: [] };
        }

        const rowData = {
          ...branchData,
          Branch: branchName,
          branchName,
          type, cluster, zone,
          date: reportDate,
          fileName, reportId
        };

        clusterData[type][cluster].rows.push(rowData);

        if (zone) {
          if (!clusterData[type][cluster].zones[zone]) {
            clusterData[type][cluster].zones[zone] = { rows: [], branches: [] };
          }
          if (!clusterData[type][cluster].zones[zone].branches.includes(branchName)) {
            clusterData[type][cluster].zones[zone].branches.push(branchName);
          }
        }
      });
    }

    // Process LBF branches
    if (report.lbfBranches) {
      Object.keys(report.lbfBranches).forEach(branchName => {
        const branchData = report.lbfBranches[branchName];
        if (!branchData || Object.keys(branchData).length === 0) return;

        const mapping = getBranchMapping(branchName);
        if (!mapping) return;

        const { type, cluster } = mapping;
        
        if (!clusterData[type][cluster]) {
          clusterData[type][cluster] = { rows: [], zones: {}, branches: [] };
        }

        const rowData = {
          ...branchData,
          Branch: branchName,
          branchName,
          type, cluster,
          date: reportDate,
          fileName, reportId
        };

        clusterData[type][cluster].rows.push(rowData);

        if (!clusterData[type][cluster].branches.includes(branchName)) {
          clusterData[type][cluster].branches.push(branchName);
        }
      });
    }
  });

  return clusterData;
};

/**
 * Aggregate rows by date
 */
const aggregateByDate = (rows, branchName = null) => {
  if (!rows || rows.length === 0) return [];
  
  const isSpecialCase = branchName === 'CS Call center' || branchName === 'ZANZIBAR';
  const dateGroups = {};
  
  rows.forEach(row => {
    const dateKey = row.date instanceof Date 
      ? row.date.toISOString().split('T')[0] 
      : new Date(row.date).toISOString().split('T')[0];
    
    if (isSpecialCase) {
      if (!dateGroups[dateKey]) {
        dateGroups[dateKey] = { ...row, date: row.date, fileName: row.fileName, reportId: row.reportId };
      }
      return;
    }
    
    if (!dateGroups[dateKey]) {
      dateGroups[dateKey] = {
        date: row.date,
        fileName: row.fileName,
        reportId: row.reportId,
        aggregated: {},
        rowCount: 0
      };
    }
    
    dateGroups[dateKey].rowCount++;
    
    Object.keys(row).forEach(key => {
      if (key !== 'Branch' && key !== 'fileName' && key !== 'reportId' && key !== 'date' && 
          key !== 'branchName' && key !== 'type' && key !== 'cluster' && key !== 'zone') {
        const value = row[key];
        if (typeof value === 'number' && !isNaN(value)) {
          if (!dateGroups[dateKey].aggregated[key]) {
            dateGroups[dateKey].aggregated[key] = 0;
          }
          dateGroups[dateKey].aggregated[key] += value;
        } else if (value !== undefined && value !== null) {
          dateGroups[dateKey].aggregated[key] = value;
        }
      }
    });
  });
  
  if (isSpecialCase) {
    return Object.values(dateGroups);
  }
  
  return Object.values(dateGroups).map(group => ({
    ...group.aggregated,
    date: group.date,
    fileName: group.fileName,
    reportId: group.reportId
  }));
};

/**
 * Get data for a specific selection path
 */
export const getDataForSelection = (clusterData, type, cluster, zone, branch) => {
  if (!clusterData[type] || !clusterData[type][cluster]) {
    return [];
  }

  const clusterInfo = clusterData[type][cluster];
  let rows = [];
  let branchNameForAggregation = null;

  if (branch && branch !== 'Total') {
    rows = clusterInfo.rows.filter(row => row.branchName === branch);
    branchNameForAggregation = branch;
  } else if (zone && zone !== 'Total') {
    if (clusterInfo.zones && clusterInfo.zones[zone]) {
      rows = clusterInfo.zones[zone].rows;
    } else {
      return [];
    }
  } else {
    rows = clusterInfo.rows.filter(row => row.branchName === cluster);
    branchNameForAggregation = cluster;
    
    if (rows.length === 0) {
      rows = clusterInfo.rows;
      branchNameForAggregation = null;
    }
  }
  
  return aggregateByDate(rows, branchNameForAggregation);
};

/**
 * Get aggregated data for type level
 */
export const getTypeLevelData = (clusterData, type) => {
  if (!clusterData[type]) return [];

  const clusterRows = [];
  Object.keys(clusterData[type]).forEach(clusterName => {
    const clusterInfo = clusterData[type][clusterName];
    if (clusterInfo && clusterInfo.rows) {
      const rows = clusterInfo.rows.filter(row => row.branchName === clusterName);
      clusterRows.push(...rows);
    }
  });

  const dateGroups = {};
  clusterRows.forEach(row => {
    const dateKey = row.date instanceof Date 
      ? row.date.toISOString().split('T')[0] 
      : new Date(row.date).toISOString().split('T')[0];
    
    if (!dateGroups[dateKey]) {
      dateGroups[dateKey] = {
        date: row.date,
        fileName: row.fileName,
        reportId: row.reportId,
        aggregated: {}
      };
    }

    Object.keys(row).forEach(key => {
      if (key !== 'Branch' && key !== 'fileName' && key !== 'reportId' && key !== 'date' && 
          key !== 'branchName' && key !== 'type' && key !== 'cluster' && key !== 'zone') {
        const value = row[key];
        if (typeof value === 'number' && !isNaN(value)) {
          if (!dateGroups[dateKey].aggregated[key]) {
            dateGroups[dateKey].aggregated[key] = 0;
          }
          dateGroups[dateKey].aggregated[key] += value;
        }
      }
    });
  });

  return Object.values(dateGroups).map(group => ({
    ...group.aggregated,
    date: group.date,
    fileName: group.fileName,
    reportId: group.reportId
  }));
};

/**
 * Clear the cluster data cache
 */
export const clearClusterCache = () => {
  clusterDataCache = null;
  cacheTimestamp = 0;
};
