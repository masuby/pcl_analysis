// C:\Users\Daniel\Desktop\code\Website\pcl_analysis\src\pages\Dashboard\components\ManagementDashboard\components\CSSection\CSSection.jsx
import { useState, useEffect } from 'react';
import './CSSection.css';
import CSChart from './CSChart';
import CSAnalysis from './CSAnalysis';
import { getNumericColumns } from '../../utils/reportUtils';

const defaultFromDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

const CSSection = ({ data, branchesData = {} }) => {
  // Branch options: Total (default) and individual branches
  const branchOptions = ['Total', ...Object.keys(branchesData).filter(branch => branchesData[branch] && branchesData[branch].length > 0)];
  const [selectedBranch, setSelectedBranch] = useState('Total');
  
  // Get current data based on selected branch
  const currentData = selectedBranch === 'Total' ? data : (branchesData[selectedBranch] || []);
  
  const columns = getNumericColumns(currentData);
  const [chartType, setChartType] = useState('Bar');
  const [column, setColumn] = useState(columns[0] || 'Active Reps');
  const [dataType, setDataType] = useState('daily'); // 'daily' or 'monthly'
  const [from, setFrom] = useState(defaultFromDate);
  const [to, setTo] = useState(new Date());
  const [appliedFrom, setAppliedFrom] = useState(defaultFromDate);
  const [appliedTo, setAppliedTo] = useState(new Date());
  const [filteredData, setFilteredData] = useState(currentData);

  // Update filtered data when branch or date filters change
  useEffect(() => {
    const filtered = currentData.filter(d => {
      const itemDate = d.date instanceof Date ? d.date : new Date(d.date);
      return itemDate >= appliedFrom && itemDate <= appliedTo;
    });
    setFilteredData(filtered);
  }, [appliedFrom, appliedTo, currentData]);

  // Reset column when branch changes
  useEffect(() => {
    const newColumns = getNumericColumns(currentData);
    if (newColumns.length > 0) {
      setColumn(prevColumn => {
        // Keep current column if it exists in new columns, otherwise use first
        return newColumns.includes(prevColumn) ? prevColumn : newColumns[0];
      });
    }
  }, [selectedBranch, currentData]);

  const applyFilters = () => {
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
    setColumn(columns[0] || 'Active Reps');
    setDataType('daily');
    setFrom(defaultFromDate);
    setTo(new Date());
    setAppliedFrom(defaultFromDate);
    setAppliedTo(new Date());
  };

  // Get section title based on selected branch
  const getSectionTitle = () => {
    if (selectedBranch === 'Total') {
      return '👥 CS (CS & Cs Asset Finance) Analysis';
    }
    return `👥 CS (${selectedBranch}) Analysis`;
  };

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

  return (
    <div className="section-card">
      <div className="section-header">
        <h3 className="section-title">{getSectionTitle()}</h3>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <select 
            value={selectedBranch} 
            onChange={e => {
              const newBranch = e.target.value;
              setSelectedBranch(newBranch);
              // Reset date filters to show all data for the new branch
              const newData = newBranch === 'Total' ? data : (branchesData[newBranch] || []);
              if (newData.length > 0) {
                const minDate = newData.reduce((min, d) => {
                  const itemDate = d.date instanceof Date ? d.date : new Date(d.date);
                  return itemDate < min ? itemDate : min;
                }, new Date(newData[0].date));
                const maxDate = newData.reduce((max, d) => {
                  const itemDate = d.date instanceof Date ? d.date : new Date(d.date);
                  return itemDate > max ? itemDate : max;
                }, new Date(newData[0].date));
                setFrom(new Date(minDate));
                setTo(new Date(maxDate));
                setAppliedFrom(new Date(minDate));
                setAppliedTo(new Date(maxDate));
              } else {
                setFrom(defaultFromDate);
                setTo(new Date());
                setAppliedFrom(defaultFromDate);
                setAppliedTo(new Date());
              }
            }}
            style={{
              padding: '0.4rem 0.75rem',
              border: '1px solid #e1e5e9',
              borderRadius: '4px',
              fontSize: '0.85rem',
              background: 'white',
              cursor: 'pointer'
            }}
          >
            {branchOptions.map(branch => (
              <option key={branch} value={branch}>{branch}</option>
            ))}
          </select>
          <span className="section-badge">{currentData.length} files</span>
        </div>
      </div>
      <div className="section-content">
        <div className="section-container">
          <CSChart 
            data={filteredData} 
            allData={currentData}
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
            applyFilters={applyFilters}
            columns={columns}
          />
          <div className="vertical-divider" />
          <CSAnalysis data={chartData} metric={column} fromDate={appliedFrom} toDate={appliedTo} />
        </div>
      </div>
    </div>
  );
};

export default CSSection;