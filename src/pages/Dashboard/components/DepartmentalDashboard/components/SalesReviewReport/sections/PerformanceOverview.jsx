import React from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './PerformanceOverview.css';

const PerformanceOverview = ({ data, selectedMonth }) => {
  // Prepare chart data from countrywise data
  const chartData = React.useMemo(() => {
    if (!data.countrywiseData || data.countrywiseData.length === 0) return [];

    const sorted = [...data.countrywiseData].sort((a, b) => {
      const dateA = a.date instanceof Date ? a.date : new Date(a.date);
      const dateB = b.date instanceof Date ? b.date : new Date(b.date);
      return dateA - dateB;
    });

    // Take last 12 data points for trend
    const last12 = sorted.slice(-12);

    return last12.map(item => {
      const date = item.date instanceof Date ? item.date : new Date(item.date);
      return {
        month: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        disbursements: item['Disbursements This Month'] || 0,
        portfolio: item['Portfolio'] || item['Total Portfolio'] || 0,
        activeReps: item['Active Reps'] || item['Active clients'] || 0,
        loans: item['Number of loans'] || item['Number of Loans'] || 0
      };
    });
  }, [data.countrywiseData]);

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
      return `TZS ${(value / 1000000).toFixed(2)}M`;
    } else if (value >= 1000) {
      return `TZS ${(value / 1000).toFixed(0)}K`;
    }
    return `TZS ${value}`;
  };

  return (
    <div className="sales-review-section">
      <h3 className="section-title">
        <span>📈</span>
        Performance Overview
      </h3>
      
      <div className="overview-charts">
        {/* Disbursements Trend */}
        <div className="chart-container">
          <h4 className="chart-title">Monthly Disbursements Trend</h4>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.25} />
              <XAxis 
                dataKey="month" 
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
              <Legend />
              <Bar 
                dataKey="disbursements" 
                fill="#22c55e" 
                name="Disbursements"
                radius={[8, 8, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Portfolio Growth */}
        <div className="chart-container">
          <h4 className="chart-title">Portfolio Growth Trend</h4>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.25} />
              <XAxis 
                dataKey="month" 
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
              <Legend />
              <Line 
                type="monotone" 
                dataKey="portfolio" 
                stroke="#8b5cf6" 
                strokeWidth={3}
                name="Portfolio Outstanding"
                dot={{ fill: '#8b5cf6', r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Active Clients & Loans */}
        <div className="chart-container">
          <h4 className="chart-title">Active Clients & Loans Trend</h4>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" strokeOpacity={0.25} />
              <XAxis 
                dataKey="month" 
                tick={{ fill: '#64748b', fontSize: 12 }}
              />
              <YAxis 
                tick={{ fill: '#64748b', fontSize: 12 }}
              />
              <Tooltip 
                contentStyle={{
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
                }}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="activeReps" 
                stroke="#3b82f6" 
                strokeWidth={2}
                name="Active Clients"
                dot={{ fill: '#3b82f6', r: 4 }}
              />
              <Line 
                type="monotone" 
                dataKey="loans" 
                stroke="#f59e0b" 
                strokeWidth={2}
                name="Active Loans"
                dot={{ fill: '#f59e0b', r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default PerformanceOverview;
