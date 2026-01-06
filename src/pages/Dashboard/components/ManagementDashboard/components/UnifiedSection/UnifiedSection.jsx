// C:\Users\Daniel\Desktop\code\Website\pcl_analysis\src\pages\Dashboard\components\ManagementDashboard\components\UnifiedSection\UnifiedSection.jsx
import { useState, useEffect } from 'react';
import './UnifiedSection.css';
import { getNumericColumns } from '../../utils/reportUtils';

// Import all chart components
import CountrywiseChart from '../CountrywiseSection/CountrywiseChart';
import CountrywiseAnalysis from '../CountrywiseSection/CountrywiseAnalysis';
import CSChart from '../CSSection/CSChart';
import CSAnalysis from '../CSSection/CSAnalysis';
import LBFChart from '../LBFSection/LBFChart';
import LBFAnalysis from '../LBFSection/LBFAnalysis';
import SMEChart from '../SMESection/SMEChart';
import SMEAnalysis from '../SMESection/SMEAnalysis';
import CSZANZIBARChart from '../CSZANZIBARSection/CSZANZIBARChart';
import CSZANZIBARAnalysis from '../CSZANZIBARSection/CSZANZIBARAnalysis';

const UnifiedSection = ({ 
  countrywiseData = [],
  csData = [],
  csBranchesData = {},
  lbfData = [],
  lbfBranchesData = {},
  smeData = [],
  zanzibarData = []
}) => {
  // Section type options
  const sectionOptions = [
    { value: 'countrywise', label: 'Countrywise', data: countrywiseData, icon: '🌍' },
    { value: 'cs', label: 'CS', data: csData, icon: '👥', hasBranches: true, branchesData: csBranchesData },
    { value: 'lbf', label: 'LBF', data: lbfData, icon: '🏦', hasBranches: true, branchesData: lbfBranchesData },
    { value: 'sme', label: 'SME', data: smeData, icon: '💼' },
    { value: 'zanzibar', label: 'Zanzibar', data: zanzibarData, icon: '🏝️' }
  ].filter(option => option.data && option.data.length > 0);

  // Default to first available section
  const defaultSection = sectionOptions.length > 0 ? sectionOptions[0].value : null;
  const [selectedSection, setSelectedSection] = useState(defaultSection);
  const [selectedBranch, setSelectedBranch] = useState('Total');

  // Get current section config
  const currentSectionConfig = sectionOptions.find(opt => opt.value === selectedSection);
  
  // Get current data based on section and branch
  const getCurrentData = () => {
    if (!currentSectionConfig) return [];
    
    if (currentSectionConfig.hasBranches && selectedBranch !== 'Total') {
      return currentSectionConfig.branchesData[selectedBranch] || [];
    }
    return currentSectionConfig.data || [];
  };

  const currentData = getCurrentData();

  // Calculate initial date range from 18 latest data points (default view)
  const getInitialDateRange = (dataArray) => {
    if (!dataArray || dataArray.length === 0) {
      const defaultFromDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      return { from: defaultFromDate, to: new Date() };
    }
    // Sort by date (newest first) and take the latest 18 points
    const sorted = [...dataArray].sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateB - dateA; // Descending order (newest first)
    });
    const latest18 = sorted.slice(0, 18); // Get 18 latest points
    if (latest18.length === 0) {
      const defaultFromDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      return { from: defaultFromDate, to: new Date() };
    }
    // Get min and max dates from the 18 latest points
    const dates = latest18.map(item => {
      return item.date instanceof Date ? item.date : new Date(item.date);
    });
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    return { from: new Date(minDate), to: new Date(maxDate) };
  };

  const columns = getNumericColumns(currentData);
  const getDefaultColumn = (cols) => {
    return cols.includes('Disbursements This Month') 
      ? 'Disbursements This Month' 
      : (cols[0] || 'Active Reps');
  };

  const [chartType, setChartType] = useState('Bar');
  const [column, setColumn] = useState(() => getDefaultColumn(columns));
  const [dataType, setDataType] = useState('daily');
  const [from, setFrom] = useState(() => getInitialDateRange(currentData).from);
  const [to, setTo] = useState(() => getInitialDateRange(currentData).to);
  const [appliedFrom, setAppliedFrom] = useState(() => getInitialDateRange(currentData).from);
  const [appliedTo, setAppliedTo] = useState(() => getInitialDateRange(currentData).to);
  const [filteredData, setFilteredData] = useState(currentData);

  // Reset branch when section changes
  useEffect(() => {
    setSelectedBranch('Total');
  }, [selectedSection]);

  // Update column and date range when section or branch changes
  useEffect(() => {
    const newColumns = getNumericColumns(currentData);
    if (newColumns.length > 0) {
      setColumn(getDefaultColumn(newColumns));
    }
    const newDateRange = getInitialDateRange(currentData);
    setFrom(newDateRange.from);
    setTo(newDateRange.to);
    setAppliedFrom(newDateRange.from);
    setAppliedTo(newDateRange.to);
  }, [selectedSection, selectedBranch, currentData]);

  // Update filtered data when date filters or current data change
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
    setSelectedBranch('Total');
    setChartType('Bar');
    const resetColumns = getNumericColumns(currentData);
    setColumn(getDefaultColumn(resetColumns));
    setDataType('daily');
    const resetDateRange = getInitialDateRange(currentData);
    setFrom(resetDateRange.from);
    setTo(resetDateRange.to);
    setAppliedFrom(resetDateRange.from);
    setAppliedTo(resetDateRange.to);
  };

  // Get section title based on selection
  const getSectionTitle = () => {
    if (!currentSectionConfig) return 'Management Dashboard';
    
    const icon = currentSectionConfig.icon;
    const sectionName = currentSectionConfig.label;
    
    if (selectedSection === 'countrywise') {
      return `${icon} Countrywise (Country Total) Analysis`;
    } else if (selectedSection === 'cs') {
      if (selectedBranch === 'Total') {
        return `${icon} CS (CS & Cs Asset Finance) Analysis`;
      }
      return `${icon} CS (${selectedBranch}) Analysis`;
    } else if (selectedSection === 'lbf') {
      if (selectedBranch === 'Total') {
        return `${icon} LBF (LBF & All Sub-branches) Analysis`;
      }
      return `${icon} LBF (${selectedBranch}) Analysis`;
    } else if (selectedSection === 'sme') {
      return `${icon} SME Analysis`;
    } else if (selectedSection === 'zanzibar') {
      return `${icon} CS ZANZIBAR (ZANZIBAR branch) Analysis`;
    }
    return `${icon} ${sectionName} Analysis`;
  };

  // Get branch options for CS and LBF
  const getBranchOptions = () => {
    if (!currentSectionConfig || !currentSectionConfig.hasBranches) return [];
    const branches = Object.keys(currentSectionConfig.branchesData || {}).filter(
      branch => currentSectionConfig.branchesData[branch] && currentSectionConfig.branchesData[branch].length > 0
    );
    return ['Total', ...branches];
  };

  const branchOptions = getBranchOptions();

  // Process data the same way the chart does (for monthly filtering)
  const getChartData = () => {
    let sortedData = [...filteredData].sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateA - dateB;
    });

    // If monthly, group by month and take the latest data point for each month
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
  };

  const chartData = getChartData();

  // Render appropriate chart and analysis components
  const renderChart = () => {
    const chartProps = {
      data: filteredData,
      allData: currentData,
      chartType,
      column,
      dataType,
      setChartType,
      setColumn,
      setDataType,
      from,
      to,
      setFrom,
      setTo,
      reset,
      applyFilters: applyDateFilter,
      columns
    };

    switch (selectedSection) {
      case 'countrywise':
        return <CountrywiseChart {...chartProps} />;
      case 'cs':
        return <CSChart {...chartProps} />;
      case 'lbf':
        return <LBFChart {...chartProps} />;
      case 'sme':
        return <SMEChart {...chartProps} />;
      case 'zanzibar':
        return <CSZANZIBARChart {...chartProps} />;
      default:
        return null;
    }
  };

  const renderAnalysis = () => {
    const analysisProps = {
      data: chartData,
      metric: column,
      fromDate: appliedFrom,
      toDate: appliedTo
    };

    switch (selectedSection) {
      case 'countrywise':
        return <CountrywiseAnalysis {...analysisProps} />;
      case 'cs':
        return <CSAnalysis {...analysisProps} />;
      case 'lbf':
        return <LBFAnalysis {...analysisProps} />;
      case 'sme':
        return <SMEAnalysis {...analysisProps} />;
      case 'zanzibar':
        return <CSZANZIBARAnalysis {...analysisProps} />;
      default:
        return null;
    }
  };

  if (!defaultSection || sectionOptions.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📊</div>
        <p>No data available for visualization</p>
        <p className="empty-subtext">Upload management reports to see analytics here</p>
      </div>
    );
  }

  return (
    <div className="section-card">
      <div className="section-header">
        <h3 className="section-title">{getSectionTitle()}</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select 
            value={selectedSection} 
            onChange={e => {
              setSelectedSection(e.target.value);
            }}
            className="section-type-selector"
          >
            {sectionOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.icon} {option.label}
              </option>
            ))}
          </select>
          {currentSectionConfig?.hasBranches && branchOptions.length > 1 && (
            <select 
              value={selectedBranch} 
              onChange={e => {
                const newBranch = e.target.value;
                setSelectedBranch(newBranch);
                // Reset date filters to show all data for the new branch
                const newData = newBranch === 'Total' 
                  ? currentSectionConfig.data 
                  : (currentSectionConfig.branchesData[newBranch] || []);
                const newDateRange = getInitialDateRange(newData);
                setFrom(newDateRange.from);
                setTo(newDateRange.to);
                setAppliedFrom(newDateRange.from);
                setAppliedTo(newDateRange.to);
              }}
              className="branch-selector"
            >
              {branchOptions.map(branch => (
                <option key={branch} value={branch}>{branch}</option>
              ))}
            </select>
          )}
          <span className="section-badge">{currentData.length} files</span>
        </div>
      </div>
      <div className="section-content">
        <div className="section-container">
          {renderChart()}
          <div className="vertical-divider" />
          {renderAnalysis()}
        </div>
      </div>
    </div>
  );
};

export default UnifiedSection;

