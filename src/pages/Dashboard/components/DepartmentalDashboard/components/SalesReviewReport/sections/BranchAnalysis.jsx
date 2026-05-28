import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import './BranchAnalysis.css';

const BranchAnalysis = ({ data, selectedMonth }) => {
  const [selectedMetric, setSelectedMetric] = useState('Disbursements This Month');

  // Prepare branch comparison data
  const branchData = useMemo(() => {
    const getLatestValue = (dataArray, metric) => {
      if (!dataArray || dataArray.length === 0) return 0;
      
      const sorted = [...dataArray].sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date : new Date(a.date);
        const dateB = b.date instanceof Date ? b.date : new Date(b.date);
        return dateB - dateA;
      });
      
      return sorted[0][metric] || 0;
    };

    const branches = [
      { name: 'CS', data: data.csData, color: '#3b82f6' },
      { name: 'LBF', data: data.lbfData, color: '#8b5cf6' },
      { name: 'SME', data: data.smeData, color: '#22c55e' },
      { name: 'Zanzibar', data: data.zanzibarData, color: '#f59e0b' }
    ];

    return branches.map(branch => ({
      name: branch.name,
      value: getLatestValue(branch.data, selectedMetric),
      color: branch.color
    })).filter(b => b.value > 0);
  }, [data, selectedMetric]);

  // CS sub-branches breakdown
  const csBranchesData = useMemo(() => {
    const getLatestValue = (dataArray, metric) => {
      if (!dataArray || dataArray.length === 0) return 0;
      
      const sorted = [...dataArray].sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date : new Date(a.date);
        const dateB = b.date instanceof Date ? b.date : new Date(b.date);
        return dateB - dateA;
      });
      
      return sorted[0][metric] || 0;
    };

    return Object.keys(data.csBranchesData || {}).map(branchName => ({
      name: branchName,
      value: getLatestValue(data.csBranchesData[branchName], selectedMetric)
    })).filter(b => b.value > 0);
  }, [data.csBranchesData, selectedMetric]);

  // LBF sub-branches breakdown
  const lbfBranchesData = useMemo(() => {
    const getLatestValue = (dataArray, metric) => {
      if (!dataArray || dataArray.length === 0) return 0;
      
      const sorted = [...dataArray].sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date : new Date(a.date);
        const dateB = b.date instanceof Date ? b.date : new Date(b.date);
        return dateB - dateA;
      });
      
      return sorted[0][metric] || 0;
    };

    return Object.keys(data.lbfBranchesData || {}).map(branchName => ({
      name: branchName,
      value: getLatestValue(data.lbfBranchesData[branchName], selectedMetric)
    })).filter(b => b.value > 0);
  }, [data.lbfBranchesData, selectedMetric]);

  const formatYAxis = (value) => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return value;
  };

  const formatTooltip = (value) => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return value.toFixed(0);
  };

  const metrics = [
    'Disbursements This Month',
    'Portfolio',
    'Active Reps',
    'Number of loans',
    'PAR>30',
    'New Business',
    'Repeat Business'
  ];

  return (
    <div className="sales-review-section">
      <h3 className="section-title">
        <span>🏢</span>
        Branch-wise Performance Analysis
      </h3>

      {/* Metric Selector */}
      <div className="metric-selector">
        <label>Compare Metric:</label>
        <select 
          value={selectedMetric} 
          onChange={(e) => setSelectedMetric(e.target.value)}
          className="metric-select"
        >
          {metrics.map(metric => (
            <option key={metric} value={metric}>{metric}</option>
          ))}
        </select>
      </div>

      {/* Main Branches Comparison */}
      <div className="branch-chart-section">
        <h4 className="chart-subtitle">Main Branches Comparison</h4>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={branchData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.25} />
            <XAxis 
              dataKey="name" 
              tick={{ fill: '#64748b', fontSize: 12 }}
            />
            <YAxis 
              tickFormatter={formatYAxis}
              tick={{ fill: '#64748b', fontSize: 12 }}
            />
            <Tooltip 
              formatter={formatTooltip}
              contentStyle={{
                background: 'white',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
              }}
            />
            <Bar dataKey="value" name={selectedMetric} radius={[8, 8, 0, 0]}>
              {branchData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* CS Sub-branches */}
      {csBranchesData.length > 0 && (
        <div className="branch-chart-section">
          <h4 className="chart-subtitle">CS Sub-branches Breakdown</h4>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={csBranchesData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.25} />
              <XAxis 
                dataKey="name" 
                tick={{ fill: '#64748b', fontSize: 11 }}
              />
              <YAxis 
                tickFormatter={formatYAxis}
                tick={{ fill: '#64748b', fontSize: 12 }}
              />
              <Tooltip 
                formatter={formatTooltip}
                contentStyle={{
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                }}
              />
              <Bar 
                dataKey="value" 
                name={selectedMetric} 
                fill="#3b82f6"
                radius={[8, 8, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* LBF Sub-branches */}
      {lbfBranchesData.length > 0 && (
        <div className="branch-chart-section">
          <h4 className="chart-subtitle">LBF Sub-branches Breakdown</h4>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={lbfBranchesData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.25} />
              <XAxis 
                dataKey="name" 
                tick={{ fill: '#64748b', fontSize: 11 }}
                angle={-15}
                textAnchor="end"
                height={60}
              />
              <YAxis 
                tickFormatter={formatYAxis}
                tick={{ fill: '#64748b', fontSize: 12 }}
              />
              <Tooltip 
                formatter={formatTooltip}
                contentStyle={{
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                }}
              />
              <Bar 
                dataKey="value" 
                name={selectedMetric} 
                fill="#8b5cf6"
                radius={[8, 8, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Performance Summary Table */}
      <div className="branch-summary-table">
        <h4 className="chart-subtitle">Branch Performance Summary</h4>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Branch</th>
                <th>{selectedMetric}</th>
                <th>% of Total</th>
              </tr>
            </thead>
            <tbody>
              {branchData.map((branch, index) => {
                const total = branchData.reduce((sum, b) => sum + b.value, 0);
                const percentage = total > 0 ? ((branch.value / total) * 100).toFixed(1) : 0;
                return (
                  <tr key={index}>
                    <td>
                      <span 
                        className="branch-indicator" 
                        style={{ backgroundColor: branch.color }}
                      ></span>
                      {branch.name}
                    </td>
                    <td className="value-cell">{formatTooltip(branch.value)}</td>
                    <td className="percentage-cell">{percentage}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BranchAnalysis;
