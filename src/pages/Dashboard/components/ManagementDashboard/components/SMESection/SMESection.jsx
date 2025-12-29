// C:\Users\Daniel\Desktop\code\Website\pcl_analysis\src\pages\Dashboard\components\ManagementDashboard\components\SMESection\SMESection.jsx
import { useState, useEffect } from 'react';
import './SMESection.css';
import SMEChart from './SMEChart';
import SMEAnalysis from './SMEAnalysis';
import { getNumericColumns } from '../../utils/reportUtils';

const defaultFromDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

const SMESection = ({ data }) => {
  const columns = getNumericColumns(data);
  const [chartType, setChartType] = useState('Bar');
  const [column, setColumn] = useState(columns[0] || 'Active Reps');
  const [dataType, setDataType] = useState('daily'); // 'daily' or 'monthly'
  const [from, setFrom] = useState(defaultFromDate);
  const [to, setTo] = useState(new Date());
  const [appliedFrom, setAppliedFrom] = useState(defaultFromDate);
  const [appliedTo, setAppliedTo] = useState(new Date());
  const [filteredData, setFilteredData] = useState(data);

  useEffect(() => {
    const filtered = data.filter(d => {
      const itemDate = d.date instanceof Date ? d.date : new Date(d.date);
      return itemDate >= appliedFrom && itemDate <= appliedTo;
    });
    setFilteredData(filtered);
  }, [appliedFrom, appliedTo, data]);

  const applyFilters = () => {
    const fromStart = new Date(from);
    fromStart.setHours(0, 0, 0, 0);
    const toEnd = new Date(to);
    toEnd.setHours(23, 59, 59, 999);
    setAppliedFrom(fromStart);
    setAppliedTo(toEnd);
  };

  const reset = () => {
    setChartType('Bar');
    setColumn(columns[0] || 'Active Reps');
    setDataType('daily');
    setFrom(defaultFromDate);
    setTo(new Date());
    setAppliedFrom(defaultFromDate);
    setAppliedTo(new Date());
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
        <h3 className="section-title">🏢 SME (SME branch) Analysis</h3>
        <span className="section-badge">{data.length} files</span>
      </div>
      <div className="section-content">
        <div className="section-container">
          <SMEChart 
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
            applyFilters={applyFilters}
            columns={columns}
          />
          <div className="vertical-divider" />
          <SMEAnalysis data={chartData} metric={column} fromDate={appliedFrom} toDate={appliedTo} />
        </div>
      </div>
    </div>
  );
};

export default SMESection;