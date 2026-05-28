import { ResponsiveContainer } from 'recharts';
import { renderChart } from '../../utils/chartUtils';
import ChartDataExport from '../Common/ChartDataExport';
import SearchableDropdown from './SearchableDropdown';

const RegionalChart = ({ 
  data, 
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
  applyFilters,
  columns,
  allData,
  selectedBranch,
  selectedType,
  selectedPerson
}) => {
  const chartTypes = ['Bar', 'Line', 'Area', 'Pie', 'Scatter'];
  const dataTypes = ['daily', 'monthly'];
  // Sort by date for better visualization
  let sortedData = [...data].sort((a, b) => {
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

  // Prepare chart data - use formatted date as x-axis
  const chartData = sortedData.map(item => {
    const itemDate = item.date instanceof Date ? item.date : new Date(item.date);
    const columnValue = column && typeof item[column] === 'number' ? item[column] : 0;
    return {
      ...item,
      xLabel: dataType === 'monthly' 
        ? itemDate.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short' 
        })
        : itemDate.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        }),
      dateLabel: itemDate.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      }),
      dateValue: itemDate,
      value: columnValue,
      // Ensure the column value is directly accessible for tooltip
      [column]: columnValue
    };
  });

  if (!columns || columns.length === 0) {
    return (
      <div className="chart-box">
        <div style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>
          No numeric data available for charting
        </div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="chart-box">
        <div className="controls regional-controls">
          {/* Chart Type - Regular dropdown */}
          <div className="control-group">
            <label className="control-label">Chart</label>
            <select
              value={chartType}
              onChange={e => setChartType(e.target.value)}
              className="chart-type-selector"
            >
              {chartTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          
          {/* Metric - Searchable dropdown */}
          <SearchableDropdown
            options={columns}
            value={column}
            onChange={setColumn}
            placeholder="Select metric..."
            className="column-selector"
            label="Metric"
          />
          
          {/* Period - Regular dropdown */}
          <div className="control-group">
            <label className="control-label">Period</label>
            <select
              value={dataType}
              onChange={e => setDataType(e.target.value)}
              className="data-type-selector"
            >
              {dataTypes.map(type => (
                <option key={type} value={type}>{type === 'daily' ? 'Daily' : 'Monthly'}</option>
              ))}
            </select>
          </div>
          
          <div className="date-filters">
            <label>From:</label>
            <input 
              type="date" 
              value={from.toISOString().slice(0, 10)} 
              onChange={e => setFrom(new Date(e.target.value))} 
            />
            <label>To:</label>
            <input 
              type="date" 
              value={to.toISOString().slice(0, 10)} 
              onChange={e => setTo(new Date(e.target.value))} 
            />
            <button className="apply-btn" onClick={applyFilters}>Apply</button>
          </div>
          <button className="reset-btn" onClick={reset}>Reset</button>
        </div>
        <div style={{ padding: '2rem', textAlign: 'center', color: '#999' }}>
          No data available for the selected date range
        </div>
      </div>
    );
  }

  return (
    <div className="chart-box">
      <div className="controls regional-controls">
        {/* Chart Type - Regular dropdown */}
        <div className="control-group">
          <label className="control-label">Chart</label>
          <select
            value={chartType}
            onChange={e => setChartType(e.target.value)}
            className="chart-type-selector"
          >
            {chartTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
        
        {/* Metric - Searchable dropdown */}
        <SearchableDropdown
          options={columns}
          value={column}
          onChange={setColumn}
          placeholder="Select metric..."
          className="column-selector"
          label="Metric"
        />
        
        {/* Period - Regular dropdown */}
        <div className="control-group">
          <label className="control-label">Period</label>
          <select
            value={dataType}
            onChange={e => setDataType(e.target.value)}
            className="data-type-selector"
          >
            {dataTypes.map(type => (
              <option key={type} value={type}>{type === 'daily' ? 'Daily' : 'Monthly'}</option>
            ))}
          </select>
        </div>
        
        <div className="date-filters">
          <label>From:</label>
          <input 
            type="date" 
            value={from.toISOString().slice(0, 10)} 
            onChange={e => setFrom(new Date(e.target.value))} 
          />
          <label>To:</label>
          <input 
            type="date" 
            value={to.toISOString().slice(0, 10)} 
            onChange={e => setTo(new Date(e.target.value))} 
          />
          <button className="apply-btn" onClick={applyFilters}>Apply</button>
        </div>
        <button className="reset-btn" onClick={reset}>Reset</button>
      </div>
      <div className="chart-wrapper" style={{ position: 'relative' }}>
        <ResponsiveContainer width="100%" height={300}>
          {renderChart({
            type: chartType,
            data: chartData,
            xKey: 'xLabel',
            yKey: column,
            dateKey: 'dateLabel',
            columnName: column
          })}
        </ResponsiveContainer>
        <ChartDataExport chartData={chartData} column={column} />
      </div>
    </div>
  );
};

export default RegionalChart;
