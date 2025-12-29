import React from 'react';
import { ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { calculateMetrics, getCallNotesDistribution, getStatusDistribution, getTopAgents, formatPercentage, formatNumber } from '../../utils/callCenterUtils';
import './CallCenterAnalysis.css';

const CallCenterAnalysis = ({ parsedData, department }) => {
  if (!parsedData) return null;

  const allCallData = parsedData.allCallData || [];
  const agentPerformance = parsedData.agentPerformance || [];
  
  const metrics = calculateMetrics(allCallData);
  const callNotesDist = getCallNotesDistribution(allCallData);
  const statusDist = getStatusDistribution(allCallData);
  const topAgents = getTopAgents(agentPerformance, 10);

  // Prepare chart data
  const communicationTypeData = [
    { name: 'Inbound', value: metrics.inboundCalls },
    { name: 'Outbound', value: metrics.outboundCalls },
    { name: 'Internal', value: metrics.internalCalls }
  ].filter(item => item.value > 0);

  const successData = [
    { name: 'Successful', value: metrics.successfulCalls },
    { name: 'Unsuccessful', value: metrics.unsuccessfulCalls }
  ];

  const callNotesData = Object.entries(callNotesDist)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const statusData = Object.entries(statusDist)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const topAgentsData = topAgents.map(agent => ({
    name: agent.name.length > 15 ? agent.name.substring(0, 15) + '...' : agent.name,
    fullName: agent.name,
    value: agent.successfulCalls
  }));

  // Blue color palette
  const blueColors = [
    '#2a5298', '#3182ce', '#4299e1', '#63b3ed', '#90cdf4',
    '#bee3f8', '#dbeafe', '#ebf8ff', '#1e3c72', '#1e40af'
  ];

  const COLORS = blueColors;

  // Custom tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload || {};
      const name = payload[0].name || data.name || '';
      const value = payload[0].value || data.value || 0;
      return (
        <div className="custom-tooltip">
          <p className="tooltip-label">{name}</p>
          <p className="tooltip-value">{formatNumber(value)}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="call-center-analysis">
      {/* Summary Stats */}
      <div className="summary-stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📞</div>
          <div className="stat-content">
            <div className="stat-value">{formatNumber(metrics.totalCalls)}</div>
            <div className="stat-label">Total Calls</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{formatNumber(metrics.successfulCalls)}</div>
            <div className="stat-label">Successful Calls</div>
            <div className="stat-percentage">
              {formatPercentage(metrics.successfulCalls, metrics.totalCalls)}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">❌</div>
          <div className="stat-content">
            <div className="stat-value">{formatNumber(metrics.unsuccessfulCalls)}</div>
            <div className="stat-label">Unsuccessful Calls</div>
            <div className="stat-percentage">
              {formatPercentage(metrics.unsuccessfulCalls, metrics.totalCalls)}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📱</div>
          <div className="stat-content">
            <div className="stat-value">{formatNumber(metrics.distinctCalledNumbers)}</div>
            <div className="stat-label">Unique Called Numbers</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📲</div>
          <div className="stat-content">
            <div className="stat-value">{formatNumber(metrics.distinctCallingNumbers)}</div>
            <div className="stat-label">Unique Calling Numbers</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-content">
            <div className="stat-value">{formatNumber(agentPerformance.length)}</div>
            <div className="stat-label">Active Agents</div>
          </div>
        </div>
      </div>

      {/* Communication Type Distribution */}
      {communicationTypeData.length > 0 && (
        <div className="chart-section">
          <h3 className="chart-title">📞 Communication Type Distribution</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={communicationTypeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="value" fill="#2a5298" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Success Distribution */}
      {successData.length > 0 && (
        <div className="chart-section">
          <h3 className="chart-title">✅ Call Success Distribution</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={successData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {successData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Call Notes Distribution */}
      {callNotesData.length > 0 && (
        <div className="chart-section">
          <h3 className="chart-title">📝 Call Notes Distribution</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={callNotesData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={150} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="value" fill="#2a5298" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top Agents Performance */}
      {topAgentsData.length > 0 && (
        <div className="chart-section">
          <h3 className="chart-title">👥 Top Agents by Successful Calls</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={topAgentsData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="name" 
                  angle={-45}
                  textAnchor="end"
                  height={100}
                />
                <YAxis />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="custom-tooltip">
                          <p className="tooltip-label">{data.fullName}</p>
                          <p className="tooltip-value">Successful Calls: {data.value}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend />
                <Bar dataKey="value" fill="#2a5298" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Status Distribution */}
      {statusData.length > 0 && (
        <div className="chart-section">
          <h3 className="chart-title">📊 Call Status Distribution</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={statusData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={120} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="value" fill="#2a5298" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Agent Performance Table */}
      {agentPerformance.length > 0 && (
        <div className="chart-section">
          <h3 className="chart-title">📋 Agent Performance Summary</h3>
          <div className="table-container">
            <table className="agent-performance-table">
              <thead>
                <tr>
                  <th>Agent Name</th>
                  <th>Outbound Calls</th>
                  <th>Inbound Calls</th>
                  <th>Total Calls</th>
                  <th>Successful Calls</th>
                  <th>Success Rate</th>
                </tr>
              </thead>
              <tbody>
                {agentPerformance
                  .sort((a, b) => {
                    const aSuccess = parseInt(a['Successful Calls'] || a['Successful_Calls'] || 0);
                    const bSuccess = parseInt(b['Successful Calls'] || b['Successful_Calls'] || 0);
                    return bSuccess - aSuccess;
                  })
                  .slice(0, 20)
                  .map((agent, index) => {
                    const name = agent['Agent Name'] || agent['Agent_Name'] || 'Unknown';
                    const outbound = agent['outbound_calls'] || agent['Outbound Calls'] || 0;
                    const inbound = agent['inbound_calls'] || agent['Inbound Calls'] || 0;
                    const total = agent['Total Calls'] || agent['Total_Calls'] || 0;
                    const successful = agent['Successful Calls'] || agent['Successful_Calls'] || 0;
                    const successRate = agent['Success Rate (%)'] || agent['Success_Rate'] || '0%';
                    
                    return (
                      <tr key={index}>
                        <td>{name}</td>
                        <td>{formatNumber(outbound)}</td>
                        <td>{formatNumber(inbound)}</td>
                        <td>{formatNumber(total)}</td>
                        <td>{formatNumber(successful)}</td>
                        <td>{successRate}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default CallCenterAnalysis;

