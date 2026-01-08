import { useState, useEffect, useMemo } from 'react';
import './ClusterAnalysisSection.css';
import { getNumericColumns } from '../../utils/reportUtils';
import { processClusterData, getDataForSelection, getTypeLevelData } from './utils/clusterDataProcessor';
import ClusterChart from './ClusterChart';
import ClusterAnalysis from './ClusterAnalysis';
import ClusterSummary from './ClusterSummary';
import ComparisonList from './ComparisonList';

// Helper function to aggregate rows by date
const aggregateByDate = (rows) => {
  if (!rows || rows.length === 0) return [];
  
  const dateGroups = {};
  
  rows.forEach(row => {
    const dateKey = row.date instanceof Date 
      ? row.date.toISOString().split('T')[0] 
      : new Date(row.date).toISOString().split('T')[0];
    
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
  return Object.values(dateGroups).map(group => ({
    ...group.aggregated,
    date: group.date,
    fileName: group.fileName,
    reportId: group.reportId
  }));
};

// Format number with K, M, B suffixes
const formatNumber = (num) => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  
  const absNum = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  
  if (absNum >= 1000000000) {
    return sign + (absNum / 1000000000).toFixed(2) + 'B';
  } else if (absNum >= 1000000) {
    return sign + (absNum / 1000000).toFixed(2) + 'M';
  } else if (absNum >= 1000) {
    return sign + (absNum / 1000).toFixed(2) + 'K';
  }
  return sign + absNum.toLocaleString();
};

const ClusterAnalysisSection = ({ parsedReports = [] }) => {
  const [clusterData, setClusterData] = useState({ CS: {}, LBF: {}, SME: {} });
  const [loading, setLoading] = useState(true);
  
  // Selection state
  const [selectedType, setSelectedType] = useState('CS');
  const [selectedCluster, setSelectedCluster] = useState('Total');
  const [selectedZone, setSelectedZone] = useState('Total');
  const [selectedBranch, setSelectedBranch] = useState('Total');
  
  // Chart state
  const [chartType, setChartType] = useState('Bar');
  const [column, setColumn] = useState('Disbursements This Month');
  const [dataType, setDataType] = useState('daily');
  const [from, setFrom] = useState(() => {
    const defaultFromDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    return defaultFromDate;
  });
  const [to, setTo] = useState(new Date());
  const [appliedFrom, setAppliedFrom] = useState(() => {
    const defaultFromDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    return defaultFromDate;
  });
  const [appliedTo, setAppliedTo] = useState(new Date());
  const [filteredData, setFilteredData] = useState([]);
  

  // Process cluster data on mount and when reports change
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const processed = await processClusterData(parsedReports);
        setClusterData(processed);
      } catch (error) {
        console.error('Error processing cluster data:', error);
      } finally {
        setLoading(false);
      }
    };

    if (parsedReports.length > 0) {
      loadData();
    }
  }, [parsedReports]);

  // Get available types
  const availableTypes = useMemo(() => {
    return ['CS', 'LBF', 'SME'].filter(type => 
      clusterData[type] && Object.keys(clusterData[type]).length > 0
    );
  }, [clusterData]);

  // Get available clusters for selected type
  const availableClusters = useMemo(() => {
    if (!clusterData[selectedType]) return [];
    return ['Total', ...Object.keys(clusterData[selectedType])];
  }, [clusterData, selectedType]);

  // Get available zones for selected cluster
  const availableZones = useMemo(() => {
    if (!clusterData[selectedType] || !clusterData[selectedType][selectedCluster]) return [];
    const clusterInfo = clusterData[selectedType][selectedCluster];
    if (clusterInfo.zones && Object.keys(clusterInfo.zones).length > 0) {
      return ['Total', ...Object.keys(clusterInfo.zones)];
    }
    return ['Total'];
  }, [clusterData, selectedType, selectedCluster]);

  // Get available branches for selected zone
  const availableBranches = useMemo(() => {
    if (!clusterData[selectedType] || !clusterData[selectedType][selectedCluster]) return ['Total'];
    const clusterInfo = clusterData[selectedType][selectedCluster];
    
    if (selectedZone !== 'Total' && clusterInfo.zones && clusterInfo.zones[selectedZone]) {
      const branches = clusterInfo.zones[selectedZone].branches || [];
      return ['Total', ...branches];
    }
    
    if (clusterInfo.branches && clusterInfo.branches.length > 0) {
      return ['Total', ...clusterInfo.branches];
    }
    
    return ['Total'];
  }, [clusterData, selectedType, selectedCluster, selectedZone]);

  // Get current data based on selection
  const currentData = useMemo(() => {
    if (loading || !clusterData[selectedType]) return [];

    // Type level - aggregated
    if (selectedCluster === 'Total') {
      return getTypeLevelData(clusterData, selectedType);
    }

    // Cluster/Zone/Branch level - raw rows
    return getDataForSelection(clusterData, selectedType, selectedCluster, selectedZone, selectedBranch);
  }, [clusterData, selectedType, selectedCluster, selectedZone, selectedBranch, loading]);

  // Calculate initial date range from 18 latest data points
  const getInitialDateRange = (dataArray) => {
    if (!dataArray || dataArray.length === 0) {
      const defaultFromDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      return { from: defaultFromDate, to: new Date() };
    }
    const sorted = [...dataArray].sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateB - dateA;
    });
    const latest18 = sorted.slice(0, 18);
    if (latest18.length === 0) {
      const defaultFromDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      return { from: defaultFromDate, to: new Date() };
    }
    const dates = latest18.map(item => item.date instanceof Date ? item.date : new Date(item.date));
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    return { from: new Date(minDate), to: new Date(maxDate) };
  };

  // Update date range when data changes
  useEffect(() => {
    if (currentData.length > 0) {
      const newDateRange = getInitialDateRange(currentData);
      setFrom(newDateRange.from);
      setTo(newDateRange.to);
      setAppliedFrom(newDateRange.from);
      setAppliedTo(newDateRange.to);
    }
  }, [currentData.length]);

  // Get columns from current data
  const columns = useMemo(() => {
    return getNumericColumns(currentData);
  }, [currentData]);

  // Update column when columns change
  useEffect(() => {
    if (columns.length > 0) {
      const defaultCol = columns.includes('Disbursements This Month') 
        ? 'Disbursements This Month' 
        : columns[0];
      setColumn(defaultCol);
    }
  }, [columns]);

  // Filter data by date range
  useEffect(() => {
    const filtered = currentData.filter(d => {
      const itemDate = d.date instanceof Date ? d.date : new Date(d.date);
      return itemDate >= appliedFrom && itemDate <= appliedTo;
    });
    setFilteredData(filtered);
  }, [appliedFrom, appliedTo, currentData]);

  // Reset selections when type changes
  useEffect(() => {
    setSelectedCluster('Total');
    setSelectedZone('Total');
    setSelectedBranch('Total');
  }, [selectedType]);

  // Reset zone and branch when cluster changes
  useEffect(() => {
    setSelectedZone('Total');
    setSelectedBranch('Total');
  }, [selectedCluster]);

  // Reset branch when zone changes
  useEffect(() => {
    setSelectedBranch('Total');
  }, [selectedZone]);

  const applyDateFilter = () => {
    const fromStart = new Date(from);
    fromStart.setHours(0, 0, 0, 0);
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);
    setAppliedFrom(fromStart);
    setAppliedTo(toEnd);
  };

  const reset = () => {
    setSelectedCluster('Total');
    setSelectedZone('Total');
    setSelectedBranch('Total');
    setChartType('Bar');
    setDataType('daily');
    const resetDateRange = getInitialDateRange(currentData);
    setFrom(resetDateRange.from);
    setTo(resetDateRange.to);
    setAppliedFrom(resetDateRange.from);
    setAppliedTo(resetDateRange.to);
  };

  // Get comparison data - dynamic based on selection level
  // Use filtered chart data to get latest values
  const comparisonData = useMemo(() => {
    if (!column) return [];
    
    // If Total is selected at cluster level, compare types (CS, LBF, SME)
    if (selectedCluster === 'Total') {
      // Get latest value from filtered data for each type
      const items = [];
      ['CS', 'LBF', 'SME'].forEach(typeName => {
        if (clusterData[typeName]) {
          // Get type-level data
          const typeData = getTypeLevelData(clusterData, typeName);
          if (typeData && typeData.length > 0) {
            // Filter by date range
            const filtered = typeData.filter(d => {
              const itemDate = d.date instanceof Date ? d.date : new Date(d.date);
              return itemDate >= appliedFrom && itemDate <= appliedTo;
            });
            if (filtered.length > 0) {
              // Get latest value
              const sorted = [...filtered].sort((a, b) => {
                const dateA = a.date instanceof Date ? a.date : new Date(a.date);
                const dateB = b.date instanceof Date ? b.date : new Date(b.date);
                return dateB - dateA;
              });
              const latestValue = sorted[0][column] || 0;
              items.push({
                name: typeName,
                value: latestValue,
                data: filtered
              });
            }
          }
        }
      });
      return items.sort((a, b) => b.value - a.value);
    }
    
    // If branch is selected, compare branches
    if (selectedBranch && selectedBranch !== 'Total') {
      // Compare branches in the selected zone (CS) or cluster (LBF/SME/ZANZIBAR/CS Call center)
      const items = [];
      const clusterInfo = clusterData[selectedType]?.[selectedCluster];
      if (!clusterInfo) return [];
      
      let branchesToCompare = [];
      if (selectedType === 'CS' && selectedZone !== 'Total' && clusterInfo.zones && clusterInfo.zones[selectedZone]) {
        // CS with zone - compare branches in that zone
        branchesToCompare = clusterInfo.zones[selectedZone].branches || [];
      } else if (selectedType === 'CS' && (selectedCluster === 'ZANZIBAR' || selectedCluster === 'CS Call center')) {
        // CS ZANZIBAR or CS Call center - compare branches in that cluster
        branchesToCompare = clusterInfo.branches || [];
      } else if ((selectedType === 'LBF' || selectedType === 'SME') && clusterInfo.branches) {
        // LBF or SME - compare branches in that cluster
        branchesToCompare = clusterInfo.branches || [];
      }
      
      branchesToCompare.forEach(branchName => {
        const branchRows = clusterInfo.rows.filter(r => r.branchName === branchName);
        if (branchRows.length > 0) {
          // Aggregate by date and filter by date range
          const aggregated = aggregateByDate(branchRows, branchName);
          const filtered = aggregated.filter(d => {
            const itemDate = d.date instanceof Date ? d.date : new Date(d.date);
            return itemDate >= appliedFrom && itemDate <= appliedTo;
          });
          if (filtered.length > 0) {
            const sorted = [...filtered].sort((a, b) => {
              const dateA = a.date instanceof Date ? a.date : new Date(a.date);
              const dateB = b.date instanceof Date ? b.date : new Date(b.date);
              return dateB - dateA;
            });
            const latestValue = sorted[0][column] || 0;
            items.push({
              name: branchName,
              value: latestValue,
              data: filtered
            });
          }
        }
      });
      return items.sort((a, b) => b.value - a.value);
    }
    
    // If zone is selected (and branch is Total), compare zones (CS only)
    if (selectedZone && selectedZone !== 'Total' && selectedType === 'CS') {
      const items = [];
      const clusterInfo = clusterData[selectedType]?.[selectedCluster];
      if (clusterInfo?.zones) {
        Object.keys(clusterInfo.zones).forEach(zoneName => {
          // Use zone's own row data (zone is a Branch in Excel)
          const zoneRows = clusterInfo.zones[zoneName].rows;
          if (zoneRows.length > 0) {
            const aggregated = aggregateByDate(zoneRows);
            const filtered = aggregated.filter(d => {
              const itemDate = d.date instanceof Date ? d.date : new Date(d.date);
              return itemDate >= appliedFrom && itemDate <= appliedTo;
            });
            if (filtered.length > 0) {
              const sorted = [...filtered].sort((a, b) => {
                const dateA = a.date instanceof Date ? a.date : new Date(a.date);
                const dateB = b.date instanceof Date ? b.date : new Date(b.date);
                return dateB - dateA;
              });
              const latestValue = sorted[0][column] || 0;
              items.push({
                name: zoneName,
                value: latestValue,
                data: filtered
              });
            }
          }
        });
      }
      return items.sort((a, b) => b.value - a.value);
    }
    
    // If cluster is selected (and zone/branch are Total), compare clusters
    if (selectedCluster !== 'Total' && selectedZone === 'Total' && selectedBranch === 'Total') {
      const items = [];
      const typeData = clusterData[selectedType];
      if (typeData) {
        Object.keys(typeData).forEach(clusterName => {
          // Use cluster's own row data (cluster is a Branch in Excel)
          const clusterRows = typeData[clusterName].rows.filter(row => row.branchName === clusterName);
          if (clusterRows.length > 0) {
            const aggregated = aggregateByDate(clusterRows);
            const filtered = aggregated.filter(d => {
              const itemDate = d.date instanceof Date ? d.date : new Date(d.date);
              return itemDate >= appliedFrom && itemDate <= appliedTo;
            });
            if (filtered.length > 0) {
              const sorted = [...filtered].sort((a, b) => {
                const dateA = a.date instanceof Date ? a.date : new Date(a.date);
                const dateB = b.date instanceof Date ? b.date : new Date(b.date);
                return dateB - dateA;
              });
              const latestValue = sorted[0][column] || 0;
              items.push({
                name: clusterName,
                value: latestValue,
                data: filtered
              });
            }
          }
        });
      }
      return items.sort((a, b) => b.value - a.value);
    }
    
    return [];
  }, [clusterData, selectedType, selectedCluster, selectedZone, selectedBranch, column, appliedFrom, appliedTo]);

  // Get level name for comparison display
  const comparisonLevelName = useMemo(() => {
    if (selectedCluster === 'Total') return 'Types';
    if (selectedBranch !== 'Total') {
      // Check if we're comparing branches (including ZANZIBAR and CS Call center)
      const clusterInfo = clusterData[selectedType]?.[selectedCluster];
      if (clusterInfo) {
        if (selectedType === 'CS' && selectedZone !== 'Total' && clusterInfo.zones && clusterInfo.zones[selectedZone]) {
          return 'Branches'; // CS with zone - comparing branches in zone
        } else if (selectedType === 'CS' && (selectedCluster === 'ZANZIBAR' || selectedCluster === 'CS Call center')) {
          return 'Branches'; // ZANZIBAR or CS Call center - comparing branches
        } else if (selectedType === 'LBF' || selectedType === 'SME') {
          return 'Branches'; // LBF or SME - comparing branches
        }
      }
      return 'Branches';
    }
    if (selectedZone !== 'Total' && selectedType === 'CS') return 'Zones';
    if (selectedCluster !== 'Total' && selectedZone === 'Total' && selectedBranch === 'Total') return 'Clusters';
    return null;
  }, [clusterData, selectedType, selectedZone, selectedCluster, selectedBranch]);

  // Process chart data (for monthly filtering)
  const chartData = useMemo(() => {
    let sortedData = [...filteredData].sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateA - dateB;
    });

    if (dataType === 'monthly') {
      const monthlyData = {};
      sortedData.forEach(item => {
        const itemDate = item.date instanceof Date ? item.date : new Date(item.date);
        const monthKey = `${itemDate.getFullYear()}-${String(itemDate.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthlyData[monthKey] || itemDate > new Date(monthlyData[monthKey].date)) {
          monthlyData[monthKey] = item;
        }
      });
      sortedData = Object.values(monthlyData).sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date : new Date(a.date);
        const dateB = b.date instanceof Date ? b.date : new Date(b.date);
        return dateA - dateB;
      });
    }

    return sortedData;
  }, [filteredData, dataType]);

  if (loading) {
    return (
      <div className="section-card">
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p>Loading cluster data...</p>
        </div>
      </div>
    );
  }

  if (availableTypes.length === 0) {
    return (
      <div className="section-card">
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <p>No cluster data available</p>
          <p className="empty-subtext">Upload management reports to see cluster analysis</p>
        </div>
      </div>
    );
  }

  // Get title based on selection
  const getTitle = () => {
    let title = `📊 Cluster Analysis`;
    if (selectedType) {
      title += ` - ${selectedType}`;
      if (selectedCluster !== 'Total') {
        title += ` > ${selectedCluster}`;
        if (selectedZone !== 'Total') {
          title += ` > ${selectedZone}`;
          if (selectedBranch !== 'Total') {
            title += ` > ${selectedBranch}`;
          }
        }
      }
    }
    return title;
  };

  return (
    <div className="section-card">
      <div className="section-header">
        <h3 className="section-title">{getTitle()}</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select 
            value={selectedType} 
            onChange={e => setSelectedType(e.target.value)}
            className="section-type-selector"
          >
            {availableTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          
          {availableClusters.length > 1 && (
            <select 
              value={selectedCluster} 
              onChange={e => setSelectedCluster(e.target.value)}
              className="cluster-selector"
            >
              {availableClusters.map(cluster => (
                <option key={cluster} value={cluster}>{cluster}</option>
              ))}
            </select>
          )}
          
          {availableZones.length > 1 && (
            <select 
              value={selectedZone} 
              onChange={e => setSelectedZone(e.target.value)}
              className="zone-selector"
            >
              {availableZones.map(zone => (
                <option key={zone} value={zone}>{zone}</option>
              ))}
            </select>
          )}
          
          {availableBranches.length > 1 && (
            <select 
              value={selectedBranch} 
              onChange={e => setSelectedBranch(e.target.value)}
              className="branch-selector"
            >
              {availableBranches.map(branch => (
                <option key={branch} value={branch}>{branch}</option>
              ))}
            </select>
          )}
          
          <span className="section-badge">{filteredData.length} data points</span>
        </div>
      </div>
      
      <div className="section-content">
        <div className="section-container">
          <div style={{ width: '100%' }}>
            <ClusterChart
              data={filteredData}
              chartType={chartType}
              column={column}
              dataType={dataType}
              setChartType={setChartType}
              setColumn={setColumn}
              setDataType={setDataType}
              from={from}
              to={to}
              setFrom={setFrom}
              setTo={setTo}
              reset={reset}
              applyFilters={applyDateFilter}
              columns={columns}
              allData={currentData}
              selectedType={selectedType}
              selectedCluster={selectedCluster}
              selectedZone={selectedZone}
              selectedBranch={selectedBranch}
            />
            
            {/* Summary Section */}
            <div className="summary-divider" style={{ marginTop: '1rem', marginBottom: '1rem' }} />
            <ClusterSummary 
              data={currentData}
              selectedType={selectedType}
              selectedCluster={selectedCluster}
              selectedZone={selectedZone}
              selectedBranch={selectedBranch}
            />
            
            {/* Comparison Section */}
            {comparisonData.length > 0 && comparisonLevelName && (
              <>
                <div className="summary-divider" style={{ marginTop: '1rem', marginBottom: '1rem' }} />
                <div className="comparison-section">
                  <h5 className="comparison-title">Comparison: {comparisonLevelName} ({column})</h5>
                  <ComparisonList 
                    data={comparisonData} 
                    column={column}
                    formatNumber={formatNumber}
                  />
                </div>
              </>
            )}
          </div>
          <div className="vertical-divider" />
          <ClusterAnalysis 
            data={chartData} 
            metric={column} 
            fromDate={appliedFrom} 
            toDate={appliedTo} 
          />
        </div>
      </div>
    </div>
  );
};

export default ClusterAnalysisSection;

