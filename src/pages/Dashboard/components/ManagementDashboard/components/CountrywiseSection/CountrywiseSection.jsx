// C:\Users\Daniel\Desktop\code\Website\pcl_analysis\src\pages\Dashboard\components\ManagementDashboard\components\CountrywiseSection\CountrywiseSection.jsx
import { useState, useEffect } from 'react';
import './CountrywiseSection.css';
import CountrywiseChart from './CountrywiseChart';
import CountrywiseAnalysis from './CountrywiseAnalysis';
import { getNumericColumns } from '../../utils/reportUtils';

const CountrywiseSection = ({ data }) => {
  const columns = getNumericColumns(data);
  // Set default column to "Disbursements This Month" if available, otherwise use first column
  const defaultColumn = columns.includes('Disbursements This Month') 
    ? 'Disbursements This Month' 
    : (columns[0] || 'Active Reps');
  
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
  
  const initialDateRange = getInitialDateRange(data);
  const [chartType, setChartType] = useState('Bar');
  const [column, setColumn] = useState(defaultColumn);
  const [dataType, setDataType] = useState('daily'); // 'daily' or 'monthly'
  const [from, setFrom] = useState(initialDateRange.from);
  const [to, setTo] = useState(initialDateRange.to);
  const [appliedFrom, setAppliedFrom] = useState(initialDateRange.from);
  const [appliedTo, setAppliedTo] = useState(initialDateRange.to);
  const [filteredData, setFilteredData] = useState(data);

  useEffect(() => {
    const filtered = data.filter(d => {
      const itemDate = d.date instanceof Date ? d.date : new Date(d.date);
      return itemDate >= appliedFrom && itemDate <= appliedTo;
    });
    setFilteredData(filtered);
  }, [appliedFrom, appliedTo, data]);

  const applyDateFilter = () => {
    const fromStart = new Date(from);
    fromStart.setHours(0, 0, 0, 0);
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);
    setAppliedFrom(fromStart);
    setAppliedTo(toEnd);
  };

  const reset = () => {
    const resetDateRange = getInitialDateRange(data);
    setChartType('Bar');
    setColumn(defaultColumn);
    setDataType('daily');
    setFrom(resetDateRange.from);
    setTo(resetDateRange.to);
    setAppliedFrom(resetDateRange.from);
    setAppliedTo(resetDateRange.to);
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
        <h3 className="section-title">🌍 Countrywise (Country Total) Analysis</h3>
        <span className="section-badge">{data.length} files</span>
      </div>
      <div className="section-content">
        <div className="section-container">
          <CountrywiseChart 
            data={filteredData} 
            allData={data}
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
          />
          <div className="vertical-divider" />
          <CountrywiseAnalysis data={chartData} metric={column} fromDate={appliedFrom} toDate={appliedTo} />
        </div>
      </div>
    </div>
  );
};

export default CountrywiseSection;