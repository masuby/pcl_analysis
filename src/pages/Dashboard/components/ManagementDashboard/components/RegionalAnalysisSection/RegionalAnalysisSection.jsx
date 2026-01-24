import { useState, useEffect, useMemo } from 'react';
import './RegionalAnalysisSection.css';
import { getNumericColumns } from '../../utils/reportUtils';
import { getAvailableSheets, getRegionalDataBatch } from '../../../../../../services/reports';
import RegionalChart from './RegionalChart';
import RegionalAnalysis from './RegionalAnalysis';
import RegionalSummary from './RegionalSummary';
import ComparisonList from '../ClusterAnalysisSection/ComparisonList';
import SearchableDropdown from './SearchableDropdown';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';

// Module-level cache for all regional data (persists across component mounts)
let allRegionalDataCache = null;

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

// Default column for all sections - try multiple variations
const DEFAULT_COLUMNS = [
  'Disbursements This Month',
  'Disbursement This Month', 
  'Disbursement this Month',
  'Disbursements this Month'
];

// Find matching column (prioritize exact disbursement column, not percentages)
const findDefaultColumn = (columns) => {
  // Try exact matches first (case-sensitive)
  for (const defaultCol of DEFAULT_COLUMNS) {
    if (columns.includes(defaultCol)) return defaultCol;
  }
  
  // Try case-insensitive exact match
  for (const defaultCol of DEFAULT_COLUMNS) {
    const match = columns.find(c => c.toLowerCase() === defaultCol.toLowerCase());
    if (match) return match;
  }
  
  // Look for column that starts with "Disbursement" (not "% of")
  const disbursementCol = columns.find(c => {
    const lower = c.toLowerCase();
    return lower.startsWith('disbursement') && lower.includes('month') && !lower.includes('%');
  });
  if (disbursementCol) return disbursementCol;
  
  return columns[0];
};

const RegionalAnalysisSection = ({ parsedReports = [] }) => {
  // Data state
  const [availableSheets, setAvailableSheets] = useState([]);
  const [regionalData, setRegionalData] = useState({});
  const [loading, setLoading] = useState(true);
  
  // Selection state - hierarchical: Branch -> Type -> (Team Leader) -> Person
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedType, setSelectedType] = useState('Total'); // 'Total', 'Team Leader', 'Sales Rep'
  const [selectedTeamLeader, setSelectedTeamLeader] = useState(''); // For filtering Sales Reps
  const [selectedPerson, setSelectedPerson] = useState('');
  
  // Chart state
  const [chartType, setChartType] = useState('Bar');
  const [column, setColumn] = useState(DEFAULT_COLUMNS[0]);
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

  // Track if data has been loaded
  const [dataLoaded, setDataLoaded] = useState(false);

  // Load ALL regional data in a single batch call on mount
  useEffect(() => {
    const loadAllData = async () => {
      setLoading(true);
      try {
        // Load sheets first
        const sheetsResult = await getAvailableSheets();
        let firstSheet = '';
        if (sheetsResult.success && sheetsResult.data) {
          const branchSheets = sheetsResult.data.filter(sheet => sheet !== 'Country');
          setAvailableSheets(branchSheets);
          
          // Set default branch
          if (branchSheets.length > 0) {
            firstSheet = branchSheets[0];
            if (!selectedBranch) {
              setSelectedBranch(firstSheet);
            }
          }
        }

        // Load ALL regional data in one batch call
        if (!allRegionalDataCache) {
          console.log('[API] Loading ALL regional data in single batch call...');
          const batchResult = await getRegionalDataBatch();
          if (batchResult.success && batchResult.data) {
            allRegionalDataCache = batchResult.data;
            console.log(`[Batch] Loaded regional data for ${Object.keys(batchResult.data).length} sheets`);
          }
        } else {
          console.log('[Cache] Using cached regional batch data, sheets:', Object.keys(allRegionalDataCache).length);
        }
        
        // Set regional data for current or first branch
        const branch = selectedBranch || firstSheet;
        if (branch && allRegionalDataCache && allRegionalDataCache[branch]) {
          console.log('[Regional] Setting data for branch:', branch);
          setRegionalData(allRegionalDataCache[branch]);
        }
        setDataLoaded(true);
      } catch (error) {
        console.error('Error loading regional data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAllData();
  }, []);

  // Update regional data when branch changes (from cached batch data)
  useEffect(() => {
    if (!selectedBranch || !allRegionalDataCache) {
      console.log('[Regional] Waiting for data:', { selectedBranch, hasCache: !!allRegionalDataCache });
      return;
    }
    
    // Get data for selected branch from cached batch data
    const branchData = allRegionalDataCache[selectedBranch] || {};
    console.log('[Regional] Branch data for', selectedBranch, ':', {
      keys: Object.keys(branchData).slice(0, 5),
      totalKeys: Object.keys(branchData).length,
      sampleData: Object.keys(branchData).length > 0 ? branchData[Object.keys(branchData)[0]]?.[0] : null
    });
    setRegionalData(branchData);
    
    // Reset selections when branch changes
    setSelectedType('Total');
    setSelectedTeamLeader('');
    setSelectedPerson('');
  }, [selectedBranch, dataLoaded]);

  // Get available types based on data
  const typeOptions = useMemo(() => {
    const types = ['Total'];
    if (!regionalData || Object.keys(regionalData).length === 0) return types;
    
    // Check if we have Team Leaders and Sales Reps
    const hasTeamLeaders = Object.keys(regionalData).some(key => {
      const rows = regionalData[key];
      return rows && rows.some(r => r.rowType === 'Team Leader');
    });
    const hasSalesReps = Object.keys(regionalData).some(key => {
      const rows = regionalData[key];
      return rows && rows.some(r => r.rowType === 'Sales Rep');
    });
    
    if (hasTeamLeaders) types.push('Team Leader');
    if (hasSalesReps) types.push('Sales Rep');
    
    return types;
  }, [regionalData]);

  // Get available Team Leaders (for both Team Leader view and Sales Rep filtering)
  const teamLeaderOptions = useMemo(() => {
    if (!regionalData) return [];
    
    const teamLeaders = new Set();
    Object.keys(regionalData).forEach(key => {
      const rows = regionalData[key];
      if (rows) {
        rows.forEach(row => {
          if (row.rowType === 'Team Leader' && row.Branch) {
            teamLeaders.add(row.Branch);
          }
        });
      }
    });
    
    // Also check by key name
    Object.keys(regionalData).forEach(key => {
      const rows = regionalData[key];
      if (rows && rows.length > 0) {
        const firstRow = rows[0];
        if (firstRow.rowType === 'Team Leader') {
          teamLeaders.add(key);
        }
      }
    });
    
    return Array.from(teamLeaders).sort();
  }, [regionalData]);

  // Get available persons based on selected type
  // For Sales Rep: filter by selected Team Leader using parentTeamLeader field
  const personOptions = useMemo(() => {
    if (!regionalData || selectedType === 'Total') return [];
    
    const persons = new Set();
    
    if (selectedType === 'Team Leader') {
      // Return all Team Leaders
      return teamLeaderOptions;
    }
    
    if (selectedType === 'Sales Rep') {
      // Filter Sales Reps by selected Team Leader
      Object.keys(regionalData).forEach(key => {
        const rows = regionalData[key];
        if (rows) {
          rows.forEach(row => {
            if (row.rowType === 'Sales Rep' && row.Branch) {
              // If a Team Leader is selected, only show their Sales Reps
              if (selectedTeamLeader) {
                if (row.parentTeamLeader === selectedTeamLeader) {
                  persons.add(row.Branch);
                }
              } else {
                // No Team Leader selected, show all Sales Reps
                persons.add(row.Branch);
              }
            }
          });
        }
      });
    }
    
    return Array.from(persons).sort();
  }, [regionalData, selectedType, selectedTeamLeader, teamLeaderOptions]);

  // Reset selections when type changes
  useEffect(() => {
    setSelectedTeamLeader('');
    setSelectedPerson('');
  }, [selectedType]);

  // Reset person when team leader changes (for Sales Rep view)
  useEffect(() => {
    if (selectedType === 'Sales Rep') {
      setSelectedPerson('');
    }
  }, [selectedTeamLeader, selectedType]);

  // Get current data based on selection hierarchy
  const currentData = useMemo(() => {
    if (!regionalData || Object.keys(regionalData).length === 0) {
      console.log('[Regional] No regional data available');
      return [];
    }
    
    console.log('[Regional] Computing currentData:', {
      selectedType,
      selectedPerson,
      regionalDataKeys: Object.keys(regionalData),
      sampleRowTypes: Object.keys(regionalData).map(k => regionalData[k]?.[0]?.rowType)
    });
    
    let dataRows = [];
    
    if (selectedType === 'Total') {
      // Get Total row data (B2 - the summary row with empty A column)
      // Look for rows where Branch/name is empty or matches "Total"
      Object.keys(regionalData).forEach(key => {
        const rows = regionalData[key];
        if (rows) {
          rows.forEach(row => {
            if (row.rowType === 'Total' || row.rowType === 'Branch' || !row.rowType) {
              dataRows.push(row);
            }
          });
        }
      });
      
      // If no explicit Total rows, use the first key's data as Total
      if (dataRows.length === 0) {
        const firstKey = Object.keys(regionalData)[0];
        if (firstKey && regionalData[firstKey]) {
          dataRows = [...regionalData[firstKey]];
        }
      }
    } else if (selectedPerson) {
      // Get specific person's data
      if (regionalData[selectedPerson]) {
        dataRows = [...regionalData[selectedPerson]];
      } else {
        // Search in all data for matching Branch name
        Object.keys(regionalData).forEach(key => {
          const rows = regionalData[key];
          if (rows) {
            rows.forEach(row => {
              if (row.Branch === selectedPerson && row.rowType === selectedType) {
                dataRows.push(row);
              }
            });
          }
        });
      }
    } else {
      // No person selected yet, aggregate all of the selected type
      Object.keys(regionalData).forEach(key => {
        const rows = regionalData[key];
        if (rows) {
          rows.forEach(row => {
            if (row.rowType === selectedType) {
              dataRows.push(row);
            }
          });
        }
      });
    }
    
    console.log('[Regional] Data rows after filtering:', dataRows.length, dataRows[0] ? Object.keys(dataRows[0]) : 'no rows');
    
    // Convert to proper format with date objects and ensure numeric values are numbers
    return dataRows.map(row => {
      const processedRow = {
        ...row,
        date: row.date ? new Date(row.date) : new Date()
      };
      
      // Ensure all metric values are properly converted to numbers
      Object.keys(processedRow).forEach(key => {
        const value = processedRow[key];
        const lower = key.toLowerCase();
        const isDateLike = lower.includes('date') || 
                          lower.includes('time') || 
                          lower.includes('created') || 
                          lower.includes('updated') ||
                          lower.includes('reportid') ||
                          lower.includes('filename') ||
                          lower === 'branch' ||
                          lower === 'rowtype' ||
                          lower === 'parentteamleader' ||
                          lower === 'id';
        
        // Convert string numbers to actual numbers
        if (!isDateLike && typeof value === 'string' && value.trim() !== '' && !isNaN(parseFloat(value)) && isFinite(value)) {
          processedRow[key] = parseFloat(value);
        }
      });
      
      return processedRow;
    });
  }, [regionalData, selectedType, selectedPerson]);

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
    const cols = getNumericColumns(currentData);
    console.log('[Regional] Computed columns:', cols.length, cols.slice(0, 5));
    return cols;
  }, [currentData]);

  // Update column when columns change - default to Disbursements This Month
  useEffect(() => {
    if (columns.length > 0) {
      const defaultCol = findDefaultColumn(columns);
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

  const applyDateFilter = () => {
    const fromStart = new Date(from);
    fromStart.setHours(0, 0, 0, 0);
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);
    setAppliedFrom(fromStart);
    setAppliedTo(toEnd);
  };

  const reset = () => {
    setSelectedType('Total');
    setSelectedTeamLeader('');
    setSelectedPerson('');
    setChartType('Bar');
    setDataType('daily');
    const defaultCol = findDefaultColumn(columns);
    setColumn(defaultCol);
    const resetDateRange = getInitialDateRange(currentData);
    setFrom(resetDateRange.from);
    setTo(resetDateRange.to);
    setAppliedFrom(resetDateRange.from);
    setAppliedTo(resetDateRange.to);
  };

  // Comparison data - compare persons of the same type (Team Leaders OR Sales Reps)
  // For Sales Reps: only compare within the selected Team Leader's team
  const comparisonData = useMemo(() => {
    if (!column || !regionalData || selectedType === 'Total') return [];
    
    const items = [];
    const personsToCompare = new Set();
    
    // Collect all persons of the selected type
    Object.keys(regionalData).forEach(key => {
      const rows = regionalData[key];
      if (rows) {
        rows.forEach(row => {
          if (row.rowType === selectedType) {
            // For Sales Reps, only include those under the selected Team Leader
            if (selectedType === 'Sales Rep' && selectedTeamLeader) {
              if (row.parentTeamLeader === selectedTeamLeader) {
                personsToCompare.add(row.Branch || key);
              }
            } else {
              personsToCompare.add(row.Branch || key);
            }
          }
        });
      }
    });
    
    // Get data for each person
    personsToCompare.forEach(personName => {
      let personRows = [];
      
      if (regionalData[personName]) {
        personRows = regionalData[personName];
      } else {
        Object.keys(regionalData).forEach(key => {
          const rows = regionalData[key];
          if (rows) {
            rows.forEach(row => {
              if (row.Branch === personName && row.rowType === selectedType) {
                // For Sales Reps, filter by Team Leader
                if (selectedType === 'Sales Rep' && selectedTeamLeader) {
                  if (row.parentTeamLeader === selectedTeamLeader) {
                    personRows.push(row);
                  }
                } else {
                  personRows.push(row);
                }
              }
            });
          }
        });
      }
      
      if (personRows.length === 0) return;
      
      // Filter by date range
      const filtered = personRows.filter(d => {
        const itemDate = d.date ? new Date(d.date) : new Date();
        return itemDate >= appliedFrom && itemDate <= appliedTo;
      });
      
      if (filtered.length === 0) return;
      
      // Get latest value
      const sorted = [...filtered].sort((a, b) => {
        const dateA = a.date ? new Date(a.date) : new Date();
        const dateB = b.date ? new Date(b.date) : new Date();
        return dateB - dateA;
      });
      
      const latestValue = sorted[0][column] || 0;
      
      items.push({
        name: personName,
        value: latestValue,
        data: filtered
      });
    });
    
    return items.sort((a, b) => b.value - a.value);
  }, [regionalData, selectedType, selectedTeamLeader, column, appliedFrom, appliedTo]);

  // Get comparison level name
  const comparisonLevelName = useMemo(() => {
    if (selectedType === 'Team Leader') return 'Team Leaders';
    if (selectedType === 'Sales Rep') {
      if (selectedTeamLeader) {
        return `Sales Reps (${selectedTeamLeader}'s Team)`;
      }
      return 'Sales Reps';
    }
    return null;
  }, [selectedType, selectedTeamLeader]);

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

  if (loading && availableSheets.length === 0) {
    return (
      <div className="section-card regional-loading-container">
        <LoadingSpinner size="medium" />
      </div>
    );
  }

  if (availableSheets.length === 0) {
    return (
      <div className="section-card">
        <div className="empty-state">
          <div className="empty-icon">🗺️</div>
          <p>No regional/branch data available</p>
          <p className="empty-subtext">Upload management reports with branch sheets to see regional analysis</p>
        </div>
      </div>
    );
  }

  // Get title based on selection
  const getTitle = () => {
    let title = `🗺️ Regional Analysis - ${selectedBranch || 'Select Branch'}`;
    if (selectedType !== 'Total') {
      title += ` > ${selectedType}`;
      if (selectedType === 'Sales Rep' && selectedTeamLeader) {
        title += ` (${selectedTeamLeader})`;
      }
      if (selectedPerson) {
        title += ` > ${selectedPerson}`;
      }
    }
    return title;
  };

  return (
    <div className="section-card regional-analysis-section">
      <div className="section-header">
        <h3 className="section-title">{getTitle()}</h3>
        <div className="regional-selectors">
          {/* Branch Selector with Search */}
          <SearchableDropdown
            options={availableSheets}
            value={selectedBranch}
            onChange={setSelectedBranch}
            placeholder="Search branch..."
            className="branch-search-selector"
            label="Branch"
          />
          
          {/* Type Selector (Total / Team Leader / Sales Rep) */}
          <div className="control-group">
            <label className="control-label">View</label>
            <select
              value={selectedType}
              onChange={e => setSelectedType(e.target.value)}
              className="type-selector"
            >
              {typeOptions.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          
          {/* Team Leader Selector - show for both Team Leader view and Sales Rep filtering */}
          {selectedType === 'Team Leader' && teamLeaderOptions.length > 0 && (
            <SearchableDropdown
              options={teamLeaderOptions}
              value={selectedPerson}
              onChange={setSelectedPerson}
              placeholder="Search Team Leader..."
              className="person-selector"
              label="Team Leader"
            />
          )}
          
          {/* For Sales Rep view: First select Team Leader, then Sales Rep */}
          {selectedType === 'Sales Rep' && teamLeaderOptions.length > 0 && (
            <SearchableDropdown
              options={teamLeaderOptions}
              value={selectedTeamLeader}
              onChange={setSelectedTeamLeader}
              placeholder="Select Team Leader first..."
              className="team-leader-filter"
              label="Filter by Team Leader"
            />
          )}
          
          {/* Sales Rep Selector - only show after Team Leader is selected */}
          {selectedType === 'Sales Rep' && selectedTeamLeader && personOptions.length > 0 && (
            <SearchableDropdown
              options={personOptions}
              value={selectedPerson}
              onChange={setSelectedPerson}
              placeholder="Search Sales Rep..."
              className="person-selector"
              label="Sales Rep"
            />
          )}
          
          <span className="section-badge">{filteredData.length} data points</span>
        </div>
      </div>
      
      <div className="section-content">
        <div className="section-container">
          <div style={{ width: '100%' }}>
            <RegionalChart
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
              selectedBranch={selectedBranch}
              selectedType={selectedType}
              selectedPerson={selectedPerson}
            />
            
            {/* Summary Section */}
            <div className="summary-divider" style={{ marginTop: '1rem', marginBottom: '1rem' }} />
            <RegionalSummary 
              data={currentData}
              selectedBranch={selectedBranch}
              selectedType={selectedType}
              selectedPerson={selectedPerson}
            />
            
            {/* Comparison Section - only show when comparing Team Leaders or Sales Reps */}
            {comparisonData.length > 1 && comparisonLevelName && (
              <>
                <div className="summary-divider" style={{ marginTop: '1rem', marginBottom: '1rem' }} />
                <div className="comparison-section">
                  <h5 className="comparison-title">
                    Comparison: {comparisonLevelName} ({column})
                  </h5>
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
          <RegionalAnalysis 
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

export default RegionalAnalysisSection;
