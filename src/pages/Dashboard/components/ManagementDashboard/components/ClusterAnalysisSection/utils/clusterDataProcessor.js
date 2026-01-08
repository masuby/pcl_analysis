/**
 * Processes raw Excel rows and organizes them by cluster structure
 */

import { getBranchMapping } from './clusterDataMapper';
import { readCountrySheet } from '../../../utils/reportUtils';
import { getReportFileUrl } from '../../../../../../../services/supabase';

/**
 * Process raw rows from Excel and organize by cluster structure
 */
export const processClusterData = async (parsedReports) => {
  if (!parsedReports || parsedReports.length === 0) {
    return { CS: {}, LBF: {}, SME: {} };
  }

  const clusterData = {
    CS: {},
    LBF: {},
    SME: {}
  };

  // Process each report
  for (const report of parsedReports) {
    try {
      let fileUrl = report.fileUrl;
      if (!fileUrl && report.filePath) {
        fileUrl = await getReportFileUrl(report.filePath);
      }

      if (!fileUrl) continue;

      // Read raw rows from Excel
      const rows = await readCountrySheet(fileUrl);
      if (!rows || rows.length === 0) continue;

      // Process each row
      rows.forEach(row => {
        const branchName = row.Branch;
        if (!branchName) return;

        // Check if this is a zone row (zone names are actual Branch values in Excel)
        const isZoneRow = branchName.includes('Zone') && (
          branchName === 'Northern Zone' || branchName === 'Pwani Zone' || branchName === 'Central Zone' ||
          branchName === 'Western Zone' || branchName === 'Lake Victoria Zone' || branchName === 'Highland Zone' ||
          branchName === 'Southern Highland Zone' || branchName === 'Nyasa Zone'
        );

        // Check if this is a cluster row (cluster names are actual Branch values in Excel)
        const isClusterRow = branchName === 'Cluster 1' || branchName === 'Cluster 2' || branchName === 'Cluster 3' ||
          branchName === 'ZANZIBAR' || branchName === 'CS Call center' || branchName === 'Lbf Call Center' ||
          branchName === 'Lbf Cluster' || branchName === 'SMEs';

        // If it's a zone or cluster row, handle it separately
        if (isZoneRow || isClusterRow) {
          // Find which type/cluster/zone this belongs to
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
          }

          if (type && cluster) {
            // Initialize structure if needed
            if (!clusterData[type]) clusterData[type] = {};
            if (!clusterData[type][cluster]) {
              clusterData[type][cluster] = {
                rows: [],
                zones: {}
              };
            }

            // For CS Call center and ZANZIBAR, check if we already have a row for this date
            // Only keep one row per date (don't add duplicates)
            if (branchName === 'CS Call center' || branchName === 'ZANZIBAR') {
              const reportDate = report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date();
              const dateKey = reportDate.toISOString().split('T')[0];
              
              // Check if we already have a row for this date
              const existingRow = clusterData[type][cluster].rows.find(r => {
                const rDate = r.date instanceof Date ? r.date : new Date(r.date);
                return rDate.toISOString().split('T')[0] === dateKey && r.branchName === branchName;
              });
              
              // If we already have a row for this date, skip it (use only first one)
              if (existingRow) {
                return; // Skip this duplicate row
              }
            }

            // Add row data with report metadata
            const rowData = {
              ...row,
              fileName: report.fileName,
              reportId: report.id,
              date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
              branchName: branchName,
              type: type,
              cluster: cluster,
              zone: zone
            };

            // Add to cluster rows (this is the zone/cluster row itself)
            clusterData[type][cluster].rows.push(rowData);

            // If it's a zone row, also add to zones (this is the zone's own row data)
            if (isZoneRow && zone) {
              if (!clusterData[type][cluster].zones[zone]) {
                clusterData[type][cluster].zones[zone] = {
                  rows: [], // Will contain zone's own row (where Branch = zone name)
                  branches: [] // Will contain branch names in this zone
                };
              }
              // Add the zone's own row data
              clusterData[type][cluster].zones[zone].rows.push(rowData);
            }
          }
        } else {
          // This is a branch row - process normally
          // Normalize branch name (trim and handle double spaces)
          const normalizedBranchName = branchName.trim().replace(/\s+/g, ' ');
          const mapping = getBranchMapping(normalizedBranchName) || getBranchMapping(branchName);
          if (!mapping) return; // Skip unmapped branches

          const { type, cluster, zone } = mapping;

          // Initialize structure if needed
          if (!clusterData[type]) clusterData[type] = {};
          if (!clusterData[type][cluster]) {
            clusterData[type][cluster] = {
              rows: [],
              zones: {}
            };
          }

          // Add row data with report metadata
          const rowData = {
            ...row,
            fileName: report.fileName,
            reportId: report.id,
            date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
            branchName: branchName,
            type: type,
            cluster: cluster,
            zone: zone
          };

          // Add to cluster rows (for branch rows, we still track them)
          clusterData[type][cluster].rows.push(rowData);

          // If has zone, add to zone branches list (for branch dropdown)
          if (zone) {
            if (!clusterData[type][cluster].zones[zone]) {
              clusterData[type][cluster].zones[zone] = {
                rows: [], // Zone rows (where Branch = zone name) - set when processing zone rows
                branches: [] // Branch names in this zone
              };
            }
            // Don't add branch row to zone.rows - zones have their own rows
            // Only add to branches list for dropdown
            if (!clusterData[type][cluster].zones[zone].branches.includes(branchName)) {
              clusterData[type][cluster].zones[zone].branches.push(branchName);
            }
          } else {
            // No zone, add to branches list directly
            if (!clusterData[type][cluster].branches) {
              clusterData[type][cluster].branches = [];
            }
            if (!clusterData[type][cluster].branches.includes(branchName)) {
              clusterData[type][cluster].branches.push(branchName);
            }
          }
        }
      });

      // After processing all rows, ensure branches list is deduplicated
      // Only include branches that actually have data (no hardcoded additions)
      Object.keys(clusterData).forEach(type => {
        Object.keys(clusterData[type]).forEach(cluster => {
          const clusterInfo = clusterData[type][cluster];
          
          // Deduplicate branches list (normalize names)
          if (clusterInfo.branches) {
            const uniqueBranches = [];
            const seen = new Set();
            clusterInfo.branches.forEach(branch => {
              const normalized = branch.trim().replace(/\s+/g, ' ');
              if (!seen.has(normalized)) {
                seen.add(normalized);
                uniqueBranches.push(branch); // Keep original name
              }
            });
            clusterInfo.branches = uniqueBranches;
          }
          
          // Deduplicate zone branches as well
          if (clusterInfo.zones) {
            Object.keys(clusterInfo.zones).forEach(zoneName => {
              const zoneInfo = clusterInfo.zones[zoneName];
              if (zoneInfo.branches) {
                const uniqueBranches = [];
                const seen = new Set();
                zoneInfo.branches.forEach(branch => {
                  const normalized = branch.trim().replace(/\s+/g, ' ');
                  if (!seen.has(normalized)) {
                    seen.add(normalized);
                    uniqueBranches.push(branch); // Keep original name
                  }
                });
                zoneInfo.branches = uniqueBranches;
              }
            });
          }
        });
      });
    } catch (error) {
      console.error(`Error processing cluster data for ${report.fileName}:`, error);
    }
  }

  return clusterData;
};

/**
 * Aggregate rows by date
 * For CS Call center and ZANZIBAR: use only first row per date (no summing)
 * For others: sum numeric columns, keep latest for non-numeric
 */
const aggregateByDate = (rows, branchName = null) => {
  if (!rows || rows.length === 0) return [];
  
  // Check if this is CS Call center or ZANZIBAR - use only first row per date
  const isSpecialCase = branchName === 'CS Call center' || branchName === 'ZANZIBAR';
  
  const dateGroups = {};
  
  rows.forEach(row => {
    const dateKey = row.date instanceof Date 
      ? row.date.toISOString().split('T')[0] 
      : new Date(row.date).toISOString().split('T')[0];
    
    // For special cases, use only the first row per date
    if (isSpecialCase) {
      if (!dateGroups[dateKey]) {
        // Use the first row's data directly (no summing)
        dateGroups[dateKey] = {
          ...row,
          date: row.date,
          fileName: row.fileName,
          reportId: row.reportId
        };
      }
      // Skip subsequent rows with same date for special cases
      return;
    }
    
    // For normal cases, aggregate by summing
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
    
    // Aggregate numeric columns
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
          // For non-numeric, keep the latest value
          dateGroups[dateKey].aggregated[key] = value;
        }
      }
    });
  });
  
  // Convert to array format
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
 * Uses direct row data for zones/clusters (they are actual rows in Excel)
 * Only aggregates by date to avoid duplicates
 */
export const getDataForSelection = (clusterData, type, cluster, zone, branch) => {
  if (!clusterData[type] || !clusterData[type][cluster]) {
    return [];
  }

  const clusterInfo = clusterData[type][cluster];
  let rows = [];
  let branchNameForAggregation = null;

  // If branch is selected - use branch row data directly
  if (branch && branch !== 'Total') {
    rows = clusterInfo.rows.filter(row => row.branchName === branch);
    branchNameForAggregation = branch;
  }
  // If zone is selected - use zone row data directly (zone is a Branch in Excel)
  else if (zone && zone !== 'Total') {
    if (clusterInfo.zones && clusterInfo.zones[zone]) {
      // Use the zone's own row data (zone is a Branch name in Excel)
      rows = clusterInfo.zones[zone].rows;
    } else {
      return [];
    }
  }
  // If cluster is selected - use cluster row data directly (cluster is a Branch in Excel)
  else {
    // Filter for rows where branchName matches the cluster name
    // This gets the cluster's own row data
    rows = clusterInfo.rows.filter(row => row.branchName === cluster);
    branchNameForAggregation = cluster;
    
    // If no cluster row found, fall back to all rows (for backward compatibility)
    if (rows.length === 0) {
      rows = clusterInfo.rows;
      branchNameForAggregation = null;
    }
  }
  
  // Aggregate by date to avoid duplicates (same date from different reports)
  // Pass branchName to handle special cases (CS Call center, ZANZIBAR)
  return aggregateByDate(rows, branchNameForAggregation);
};

/**
 * Get aggregated data for type level (sum of all cluster rows)
 * Only sums cluster rows (where Branch = cluster name), not branch rows
 */
export const getTypeLevelData = (clusterData, type) => {
  if (!clusterData[type]) return [];

  // Get only cluster rows (where branchName matches cluster name)
  const clusterRows = [];
  Object.keys(clusterData[type]).forEach(clusterName => {
    const clusterInfo = clusterData[type][clusterName];
    if (clusterInfo && clusterInfo.rows) {
      // Filter for rows where branchName matches the cluster name
      // These are the cluster's own row data
      const rows = clusterInfo.rows.filter(row => row.branchName === clusterName);
      clusterRows.push(...rows);
    }
  });

  // Group by date and aggregate (sum cluster values)
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

    // Aggregate numeric columns (sum cluster values)
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

  // Convert to array format
  return Object.values(dateGroups).map(group => ({
    ...group.aggregated,
    date: group.date,
    fileName: group.fileName,
    reportId: group.reportId
  }));
};

/**
 * Get the latest value for a column from a set of rows
 */
const getLatestValue = (rows, column) => {
  if (!rows || rows.length === 0) return 0;
  
  // Sort by date (newest first)
  const sorted = [...rows].sort((a, b) => {
    const dateA = a.date instanceof Date ? a.date : new Date(a.date);
    const dateB = b.date instanceof Date ? b.date : new Date(b.date);
    return dateB - dateA;
  });
  
  // Get the latest row's value for the column
  const latestRow = sorted[0];
  return latestRow && typeof latestRow[column] === 'number' ? latestRow[column] : 0;
};

/**
 * Get comparison data for a level (types, clusters, zones, or branches)
 * Uses latest value instead of sum
 */
export const getComparisonData = (clusterData, type, cluster, zone, selectedColumn, selectedBranch) => {
  const items = [];

  // If branch is selected, compare branches in zone (only for CS)
  if (selectedBranch && selectedBranch !== 'Total' && zone && zone !== 'Total') {
    // This shouldn't happen, but handle it
    return [];
  } else if (zone && zone !== 'Total') {
    // Compare branches in zone (only for CS, not LBF/SME)
    if (type === 'CS') {
      const clusterInfo = clusterData[type]?.[cluster];
      if (clusterInfo?.zones[zone]) {
        const branchNames = clusterInfo.zones[zone].branches;
        branchNames.forEach(branchName => {
          const branchRows = clusterInfo.rows.filter(r => r.branchName === branchName);
          if (branchRows.length > 0) {
            const latestValue = getLatestValue(branchRows, selectedColumn);
            items.push({
              name: branchName,
              value: latestValue,
              data: branchRows
            });
          }
        });
      }
    }
  } else if (cluster && cluster !== 'Total') {
    // Compare zones in cluster (only for CS)
    if (type === 'CS') {
      const clusterInfo = clusterData[type]?.[cluster];
      if (clusterInfo?.zones) {
        Object.keys(clusterInfo.zones).forEach(zoneName => {
          const zoneRows = clusterInfo.zones[zoneName].rows;
          if (zoneRows.length > 0) {
            const latestValue = getLatestValue(zoneRows, selectedColumn);
            items.push({
              name: zoneName,
              value: latestValue,
              data: zoneRows
            });
          }
        });
      }
    } else {
      // For LBF and SME, compare branches in cluster (no zones)
      const clusterInfo = clusterData[type]?.[cluster];
      if (clusterInfo?.branches) {
        clusterInfo.branches.forEach(branchName => {
          const branchRows = clusterInfo.rows.filter(r => r.branchName === branchName);
          if (branchRows.length > 0) {
            const latestValue = getLatestValue(branchRows, selectedColumn);
            items.push({
              name: branchName,
              value: latestValue,
              data: branchRows
            });
          }
        });
      }
    }
  } else if (type) {
    // Compare clusters in type
    const typeData = clusterData[type];
    if (typeData) {
      Object.keys(typeData).forEach(clusterName => {
        const clusterRows = typeData[clusterName].rows;
        if (clusterRows.length > 0) {
          const latestValue = getLatestValue(clusterRows, selectedColumn);
          items.push({
            name: clusterName,
            value: latestValue,
            data: clusterRows
          });
        }
      });
    }
  } else if (!type) {
    // Compare types (CS, LBF, SME) - when Total is selected at cluster level
    Object.keys(clusterData).forEach(typeName => {
      const typeData = clusterData[typeName];
      if (typeData) {
        // Get all rows for this type
        const allTypeRows = [];
        Object.values(typeData).forEach(clusterInfo => {
          if (clusterInfo.rows) {
            allTypeRows.push(...clusterInfo.rows);
          }
        });
        if (allTypeRows.length > 0) {
          const latestValue = getLatestValue(allTypeRows, selectedColumn);
          items.push({
            name: typeName,
            value: latestValue,
            data: allTypeRows
          });
        }
      }
    });
  }

  // Sort by value descending
  return items.sort((a, b) => b.value - a.value);
};

