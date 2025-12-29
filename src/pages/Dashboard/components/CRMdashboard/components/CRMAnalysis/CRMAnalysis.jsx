import React, { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { extractMetrics, getFormattedValue, formatNumber } from '../../utils/crmUtils';
import './CRMAnalysis.css';

const CRMAnalysis = ({ parsedData, department }) => {
  if (!parsedData) return null;

  const metrics = extractMetrics(parsedData.emailData || []);
  
  // Helper function to get value (matching Python get_value function)
  const getValue = (key, defaultVal = 'None') => {
    const rawValue = metrics[key.toLowerCase()] || defaultVal;
    
    if (rawValue === 'N/A' || rawValue === 'None' || rawValue === '' || rawValue === null || rawValue === undefined) {
      return 'None';
    }

    const keyLower = key.toLowerCase();
    const isPercentageKey = ['percentage', 'percent', '%', 'rate', 'ratio'].some(
      indicator => keyLower.includes(indicator)
    );

    try {
      let numValue;
      if (typeof rawValue === 'string') {
        const cleanStr = rawValue.replace('%', '').trim();
        numValue = parseFloat(cleanStr);
      } else {
        numValue = parseFloat(rawValue);
      }

      if (isNaN(numValue)) {
        return String(rawValue);
      }

      if (isPercentageKey) {
        if (numValue >= 0 && numValue <= 1) {
          return `${(numValue * 100).toFixed(2)}%`;
        } else if (numValue >= 0 && numValue <= 100) {
          return `${numValue.toFixed(2)}%`;
        } else {
          return `${numValue.toFixed(2)}%`;
        }
      } else {
        if (Number.isInteger(numValue)) {
          return String(Math.floor(numValue));
        } else {
          return `${Math.floor(numValue)}`;
        }
      }
    } catch (e) {
      return String(rawValue);
    }
  };

  // Format date
  const currentDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  const reportDate = parsedData.reportDate instanceof Date
    ? parsedData.reportDate.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
    : new Date(parsedData.reportDate).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

  // Prepare trend data for lead graph
  const prepareLeadTrendData = () => {
    if (!parsedData.historicalData || parsedData.historicalData.length === 0) return [];
    
    const trendData = parsedData.historicalData.map((hist) => {
      const histMetrics = extractMetrics(hist.emailData || []);
      const value = parseFloat(histMetrics['lead'] || histMetrics['count_leads'] || '0') || 0;
      return {
        date: hist.date instanceof Date 
          ? hist.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : new Date(hist.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        value: value,
        fullDate: hist.date
      };
    });
    
    // Add current value
    const currentValue = parseFloat(metrics['lead'] || metrics['count_leads'] || '0') || 0;
    const currentDate = parsedData.reportDate instanceof Date
      ? parsedData.reportDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : new Date(parsedData.reportDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    trendData.push({
      date: currentDate,
      value: currentValue,
      fullDate: parsedData.reportDate
    });
    
    return trendData.sort((a, b) => new Date(a.fullDate) - new Date(b.fullDate));
  };

  const leadTrendData = prepareLeadTrendData();

  // Custom tooltip for charts
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-tooltip">
          <p className="tooltip-label">{label}</p>
          <p className="tooltip-value">{formatNumber(payload[0].value)}</p>
        </div>
      );
    }
    return null;
  };

  // Render department-specific content
  const renderCSContent = () => (
    <div className="crm-analysis-container">
      <div className="crm-section">
        <h2 className="section-title">📈 LEADS SUMMARY</h2>
        <div className="content">
          <div className="stat-box">
            <p><span className="number-value">{getValue('lead')}</span> leads were generated in the system across all CS branches.</p>
          </div>
          
          <div className="stat-box">
            <p><span className="percentage-value">{getValue('percentage_accepted_lead')}</span> (<span className="number-value">{getValue('accepted_lead')}</span>) of leads generated were consented, 
            <span className="percentage-value"> {getValue('percentage_not_provided_lead')}</span> (<span className="number-value">{getValue('not_provided_lead')}</span>) were not provided and 
            <span className="percentage-value"> {getValue('percentage_rejected_lead')}</span> (<span className="number-value">{getValue('rejected_lead')}</span>) were rejected.</p>
          </div>
          
          <div className="stat-box">
            <p>Out of <span className="number-value">{getValue('lead')}</span> leads, <span className="number-value">{getValue('prospect_lead')}</span> is a prospect.</p>
          </div>
          
          {/* Lead Trend Chart */}
          {leadTrendData.length > 0 && (
            <div className="chart-section">
              <h4 className="chart-title">Leads Generated Trend</h4>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={leadTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="value" stroke="#2E75B6" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          
          {parsedData.leadsSummary && parsedData.leadsSummary.length > 0 && (
            <div className="image-container">
              <div className="image-title">Lead Summary</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(parsedData.leadsSummary[0] || {}).map(key => (
                        <th key={key}>{key.startsWith('Column_') ? '' : key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.leadsSummary.map((row, idx) => (
                      <tr key={idx}>
                        {Object.keys(parsedData.leadsSummary[0] || {}).map(key => (
                          <td key={key}>{row[key] !== null && row[key] !== undefined ? String(row[key]) : ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="crm-section">
        <h2 className="section-title">🎯 MARKETING ACTIVITIES SUMMARY</h2>
        
        <div className="subsection-title">👥 Sales Agents</div>
        <div className="content">
          <div className="stat-box">
            <p>Total count of agents in CRM stood at <span className="number-value">{getValue('total_agent')}</span>, 
            and only <span className="number-value">{getValue('total_agent_logged_in')}</span> logged in for the day.</p>
          </div>
          
          <div className="stat-box">
            <p>Out of <span className="number-value">{getValue('agent_assigned_activities')}</span> agents assigned activities for the day, 
            <span className="number-value"> {getValue('agent_completed_at_location')}</span> (<span className="percentage-value">{getValue('percentage_agent_completed_at_location')}</span>) 
            agents completed at least one activity at the assigned location.</p>
          </div>
          
          <div className="stat-box">
            <p><span className="number-value">{getValue('agent_location_planned')}</span> locations were planned for the day. 
            Only <span className="number-value">{getValue('agent_reached_location')}</span> (<span className="percentage-value">{getValue('percentage_reached_location')}</span>) 
            locations were reached on the day.</p>
          </div>
          
          <div className="highlight">
            <p><span className="number-value">{getValue('agent_count_without_planned_location')}</span> branches had no planned location visited by an agent. 
            ({getValue('agent_branch_without_planned_location')})</p>
            <p><span className="number-value">{getValue('branches_count_without_assgned_activities')}</span> branches had no assigned activities or planned locations to be visited 
            ({getValue('branches_without_assgned_activities')}).</p>
          </div>
          
          <div className="subsection-title">📅 For today : {currentDate}</div>
          <div className="stat-box">
            <p><span className="number-value">{getValue('todays_locations_planned')}</span> locations have been planned.</p>
            <p><span className="number-value">{getValue('todays_agents_assigned')}</span> (<span className="percentage-value">{getValue('percentage_todays_agents_assigned')}</span>) 
            have been assigned activities.</p>
            <p>Average locations to be visited per agent is <span className="number-value">{getValue('average_location_agent_visited')}</span>.</p>
          </div>
          
          {parsedData.agentSummary && parsedData.agentSummary.length > 0 && (
            <div className="image-container">
              <div className="image-title">Agent Summary</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(parsedData.agentSummary[0] || {}).map(key => (
                        <th key={key}>{key.startsWith('Column_') ? '' : key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.agentSummary.map((row, idx) => (
                      <tr key={idx}>
                        {Object.keys(parsedData.agentSummary[0] || {}).map(key => (
                          <td key={key}>{row[key] !== null && row[key] !== undefined ? String(row[key]) : ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        
        <div className="subsection-title">Team Leaders</div>
        <div className="content">
          <div className="stat-box">
            <p>Total count of TLs in CRM stood at <span className="number-value">{getValue('count_team_leaders')}</span>, 
            and only <span className="number-value">{getValue('logged_in_team_leaders')}</span> TLs logged in for the day.</p>
          </div>
          
          <div className="stat-box">
            <p>Out of <span className="number-value">{getValue('team_leaders_assigned_activities')}</span> TLs assigned activities for the day, 
            <span className="number-value"> {getValue('team_leaders_completed_at_location')}</span> (<span className="percentage-value">{getValue('percentage_completed_at_location')}</span>) 
            TLs completed at least one activity at the assigned location.</p>
          </div>
          
          <div className="stat-box">
            <p><span className="number-value">{getValue('team_leaders_location_planned')}</span> locations were planned for the day. 
            Only <span className="number-value">{getValue('team_leaders_location_reached')}</span> (<span className="percentage-value">{getValue('percentage_tl_location_reached')}</span>) 
            locations were reached on the day.</p>
          </div>
          
          <div className="highlight">
            <p><span className="number-value">{getValue('branches_tl_count_no_planned_location')}</span> branches had no planned location visited by a TL. 
            ({getValue('branches_tl_no_planned_location')})</p>
            <p><span className="number-value">{getValue('branches_tl_count_no_assigned_activites')}</span> branches had not assigned any activities or locations to their TLs. 
            ({getValue('branches_tl_no_assigned_activities')})</p>
          </div>
          
          <div className="subsection-title">📅 For today : {currentDate}</div>
          <div className="stat-box">
            <p><span className="number-value">{getValue('todays_tls_location_planned')}</span> locations have been planned.</p>
            <p><span className="number-value">{getValue('todays_tls_assigned_activities')}</span> (90%) TLs have been assigned activities.</p>
            <p>Average locations to be visited per TL is <span className="number-value">{getValue('average_location_visited_by_tl')}</span>.</p>
          </div>
          
          {parsedData.teamLeaderSummary && parsedData.teamLeaderSummary.length > 0 && (
            <div className="image-container">
              <div className="image-title">Team Leader Summary</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(parsedData.teamLeaderSummary[0] || {}).map(key => (
                        <th key={key}>{key.startsWith('Column_') ? '' : key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.teamLeaderSummary.map((row, idx) => (
                      <tr key={idx}>
                        {Object.keys(parsedData.teamLeaderSummary[0] || {}).map(key => (
                          <td key={key}>{row[key] !== null && row[key] !== undefined ? String(row[key]) : ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );

  const renderLBFContent = () => (
    <div className="crm-analysis-container">
      <div className="crm-section">
        <h2 className="section-title">📈 LEADS SUMMARY</h2>
        <div className="content">
          <div className="stat-box">
            <p><span className="number-value">{getValue('lead')}</span> leads were generated in the system across all LBF branches.</p>
          </div>
          
          <div className="stat-box">
            <p><span className="percentage-value">{getValue('percentage_consented_lead')}</span> (<span className="number-value">{getValue('number_consented_lead')}</span>) of leads generated were consented, 
            <span className="percentage-value"> {getValue('percentage_not_provided_lead')}</span> (<span className="number-value">{getValue('not_provided_lead')}</span>) were not provided and 
            <span className="percentage-value"> {getValue('percentage_rejected_lead')}</span> (<span className="number-value">{getValue('rejected_lead')}</span>) were rejected.</p>
          </div>
          
          <div className="stat-box">
            <p>Out of <span className="number-value">{getValue('lead')}</span> leads, <span className="number-value">{getValue('prospect_lead')}</span> is a prospect.</p>
          </div>
          
          {/* Lead Trend Chart */}
          {leadTrendData.length > 0 && (
            <div className="chart-section">
              <h4 className="chart-title">Leads Generated Trend</h4>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={leadTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="value" stroke="#2E75B6" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          
          {parsedData.leadsSummary && parsedData.leadsSummary.length > 0 && (
            <div className="image-container">
              <div className="image-title">📋 Detailed LBF Leads Summary</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(parsedData.leadsSummary[0] || {}).map(key => (
                        <th key={key}>{key.startsWith('Column_') ? '' : key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.leadsSummary.map((row, idx) => (
                      <tr key={idx}>
                        {Object.keys(parsedData.leadsSummary[0] || {}).map(key => (
                          <td key={key}>{row[key] !== null && row[key] !== undefined ? String(row[key]) : ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="crm-section">
        <h2 className="section-title">🎯 MARKETING ACTIVITIES SUMMARY</h2>
        
        <div className="subsection-title">👥 Sales Agents</div>
        <div className="content">
          <div className="stat-box">
            <p>Total count of agents in CRM stood at <span className="number-value">{getValue('total_count_agent')}</span>, 
            and only <span className="number-value">{getValue('logged_in_agent')}</span> logged in for the day.</p>
          </div>
          
          <div className="stat-box">
            <p>Out of <span className="number-value">{getValue('agent_assigned_activities')}</span> agents assigned activities for the day, 
            <span className="number-value"> {getValue('agents_completed_at_location')}</span> (<span className="percentage-value">{getValue('percentage_completed_at_location')}</span>) 
            agents completed at least one activity at the assigned location.</p>
          </div>
          
          <div className="stat-box">
            <p><span className="number-value">{getValue('agents_location_planned')}</span> locations were planned for the day. 
            Only <span className="number-value">{getValue('agents_location_reached')}</span> (<span className="percentage-value">{getValue('percentage_agents_location_reached')}</span>) 
            locations were reached on the day.</p>
          </div>
          
          <div className="highlight">
            <p><span className="number-value">{getValue('agents_no_assigned_location')}</span> had no assigned activity or planned location to their sales agents.</p>
          </div>
          
          <div className="subsection-title">📅 For today {currentDate}</div>
          <div className="stat-box">
            <p><span className="number-value">{getValue('agents_todays_location_planned')}</span> locations have been planned.</p>
            <p><span className="number-value">{getValue('todays_agents_assigned_activities')}</span> 
            have been assigned activities.</p>
            <p>Average locations to be visited per agent is <span className="number-value">{getValue('todays_average_location_visited_by_agents')}</span>.</p>
          </div>
          
          {parsedData.agentSummary && parsedData.agentSummary.length > 0 && (
            <div className="image-container">
              <div className="image-title">👤 Detailed LBF Agent Summary</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(parsedData.agentSummary[0] || {}).map(key => (
                        <th key={key}>{key.startsWith('Column_') ? '' : key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.agentSummary.map((row, idx) => (
                      <tr key={idx}>
                        {Object.keys(parsedData.agentSummary[0] || {}).map(key => (
                          <td key={key}>{row[key] !== null && row[key] !== undefined ? String(row[key]) : ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        
        <div className="subsection-title">👨‍💼 Team Leaders</div>
        <div className="content">
          <div className="stat-box">
            <p>Total count of TLs in CRM stood at <span className="number-value">{getValue('total_count_team_leaders')}</span>, 
            and only <span className="number-value">{getValue('logged_in_team_leaders')}</span> TLs logged in for the day.</p>
          </div>
          
          <div className="stat-box">
            <p>Out of <span className="number-value">{getValue('team_leaders_assigned_activities')}</span> TLs assigned activities for the day, 
            <span className="number-value"> {getValue('tl_completed_activities_at_location')}</span> (<span className="percentage-value">{getValue('percentage_tl_completed_at_location')}</span>) 
            TLs completed at least one activity at the assigned location.</p>
          </div>
          
          <div className="stat-box">
            <p><span className="number-value">{getValue('tl_location_planned')}</span> locations were planned for the day. 
            Only <span className="number-value">{getValue('tl_location_reached')}</span> (<span className="percentage-value">{getValue('percentage_tl_location_reached')}</span>) 
            locations were reached on the day.</p>
          </div>
          
          <div className="highlight">
            <p><span className="number-value">{getValue('tl_planned_visited_location')}</span> had no planned location visited by a TL.</p>
            <p><span className="number-value">{getValue('tl_no_assigned_planned_location')}</span> had not assigned activities or planned locations to be visited by a TL.</p>
          </div>
          
          <div className="subsection-title">📅 For today {currentDate}</div>
          <div className="stat-box">
            <p><span className="number-value">{getValue('today_tl_location_planned')}</span> locations have been planned.</p>
            <p><span className="number-value">{getValue('today_tl_assigned_activities')}</span> (<span className="percentage-value">{getValue('percentage_today_tl_assigned_activities')}</span>) TLs have been assigned activities.</p>
            <p>Average locations to be visited per TL is <span className="number-value">{getValue('today_average_location_visited')}</span>.</p>
          </div>
          
          {parsedData.teamLeaderSummary && parsedData.teamLeaderSummary.length > 0 && (
            <div className="image-container">
              <div className="image-title">👨‍💼 Detailed LBF Team Leader Summary</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(parsedData.teamLeaderSummary[0] || {}).map(key => (
                        <th key={key}>{key.startsWith('Column_') ? '' : key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.teamLeaderSummary.map((row, idx) => (
                      <tr key={idx}>
                        {Object.keys(parsedData.teamLeaderSummary[0] || {}).map(key => (
                          <td key={key}>{row[key] !== null && row[key] !== undefined ? String(row[key]) : ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );

  const renderSMEContent = () => (
    <div className="crm-analysis-container">
      <div className="crm-section">
        <h2 className="section-title">📈 LEADS SUMMARY</h2>
        <div className="content">
          <div className="stat-box">
            <p><span className="number-value">{getValue('count_leads', '0')}</span> leads were generated in the system across all SME branches.</p>
          </div>
          
          <div className="stat-box">
            <p><span className="percentage-value">{getValue('percentage_accepted_lead', '0%')}</span> were accepted, 
            <span className="percentage-value"> {getValue('percentage_not_provided_lead', '0%')}</span> (<span className="number-value">{getValue('not_provided_leads', '0')}</span>) were not provided with consent and 
            <span className="percentage-value"> {getValue('percentage_rejected_leads', '0%')}</span> were rejected.</p>
          </div>
          
          <div className="stat-box">
            <p>Out of <span className="number-value">{getValue('count_leads', '0')}</span> leads, <span className="number-value">{getValue('prospect_lead', '0') === '0' ? 'none' : getValue('prospect_lead', '0')}</span> is a prospect.</p>
          </div>
          
          {/* Lead Trend Chart */}
          {leadTrendData.length > 0 && (
            <div className="chart-section">
              <h4 className="chart-title">Leads Generated Trend</h4>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={leadTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                    <Line type="monotone" dataKey="value" stroke="#2E75B6" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          
          {parsedData.leadsSummary && parsedData.leadsSummary.length > 0 && (
            <div className="image-container">
              <div className="image-title">📋 Detailed SME Leads Summary</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(parsedData.leadsSummary[0] || {}).map(key => (
                        <th key={key}>{key.startsWith('Column_') ? '' : key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.leadsSummary.map((row, idx) => (
                      <tr key={idx}>
                        {Object.keys(parsedData.leadsSummary[0] || {}).map(key => (
                          <td key={key}>{row[key] !== null && row[key] !== undefined ? String(row[key]) : ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="crm-section">
        <h2 className="section-title">🎯 MARKETING ACTIVITIES SUMMARY</h2>
        
        <div className="subsection-title">👥 Sales Agents</div>
        <div className="content">
          <div className="stat-box">
            <p>Total count of agents in CRM stood at <span className="number-value">{getValue('total_count_agent', '0')}</span>, 
            and only <span className="number-value">{getValue('logged_in_agents', '0')}</span> agents logged in for the day.</p>
          </div>
          
          <div className="stat-box">
            <p>Out of <span className="number-value">{getValue('agent_assigned_activities', '0')}</span> agents assigned activities for the day, 
            <span className="number-value"> {getValue('agent_completed_at_location', '0')}</span> (<span className="percentage-value">{getValue('percentage_completed_at_location', '0%')}</span>) 
            agents completed at least one activity at the assigned location.</p>
          </div>
          
          <div className="stat-box">
            <p><span className="number-value">{getValue('agent_location_planned', '0')}</span> locations were planned for the day. 
            Only <span className="number-value">{getValue('agent_location_reached', '0')}</span> (<span className="percentage-value">{(() => {
              const reached = parseFloat(getValue('agent_location_reached', '0')) || 0;
              const planned = parseFloat(getValue('agent_location_planned', '0')) || 0;
              return planned > 0 ? `${((reached / planned) * 100).toFixed(0)}%` : '0%';
            })()}</span>) 
            locations were reached.</p>
          </div>
          
          <div className="subsection-title">📅 For today {currentDate}</div>
          <div className="stat-box">
            <p><span className="number-value">{getValue('today_location_planned', '0')}</span> locations have been planned.</p>
            <p><span className="number-value">{getValue('today_agent_assigned_activities', '0')}</span> (<span className="percentage-value">{getValue('percentage_today_agent_assigned_activities', '0%')}</span>) 
            of total agents (<span className="number-value">{getValue('today_total_agents', '0')}</span>) have been assigned activities.</p>
            <p>Average locations to be visited per agent is <span className="number-value">{getValue('average_location_to_be_visited', '0')}</span>.</p>
          </div>
          
          {parsedData.agentSummary && parsedData.agentSummary.length > 0 && (
            <div className="image-container">
              <div className="image-title">👤 Detailed SME Agent Summary</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(parsedData.agentSummary[0] || {}).map(key => (
                        <th key={key}>{key.startsWith('Column_') ? '' : key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.agentSummary.map((row, idx) => (
                      <tr key={idx}>
                        {Object.keys(parsedData.agentSummary[0] || {}).map(key => (
                          <td key={key}>{row[key] !== null && row[key] !== undefined ? String(row[key]) : ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        
        <div className="subsection-title">👨‍💼 Team Leaders</div>
        <div className="content">
          <div className="stat-box">
            <p>Total count of TLs in CRM stood at <span className="number-value">{getValue('total_count_team_leaders', '0')}</span>, 
            only <span className="number-value">{getValue('logged_in_team_leaders', '0')}</span> logged in for the day.</p>
          </div>
          
          <div className="stat-box">
            <p>Out of <span className="number-value">{getValue('tl_assigned_activities', '0')}</span> TLs assigned activities, 
            <span className="number-value"> {getValue('tl_completed_activities_at_location', '0')}</span> (<span className="percentage-value">{getValue('percentage_tl_completed_activities_at_location', '0%')}</span>) 
            completed at least one activity at the assigned location.</p>
          </div>
          
          <div className="stat-box">
            <p><span className="number-value">{getValue('tl_location_planned', '0')}</span> locations were planned for the day, 
            <span className="number-value"> {getValue('tl_location_reached', '0')}</span> (<span className="percentage-value">{(() => {
              const reached = parseFloat(getValue('tl_location_reached', '0')) || 0;
              const planned = parseFloat(getValue('tl_location_planned', '0')) || 0;
              return planned > 0 ? `${((reached / planned) * 100).toFixed(0)}%` : '0%';
            })()}</span>) were reached.</p>
          </div>
          
          <div className="highlight">
            <p><span className="number-value">{getValue('tl_no_planned_visited_location', 'None')}</span> had no planned location visited by a TL.</p>
          </div>
          
          <div className="subsection-title">📅 For today {currentDate}</div>
          <div className="stat-box">
            <p><span className="number-value">{getValue('today_tl_location_planned', '0')}</span> locations have been planned.</p>
            <p><span className="number-value">{getValue('today_tl_assigned_activities', '0')}</span> (<span className="percentage-value">{getValue('percentage_tl_assigned_activities', '0%')}</span>) of total TLs have been assigned activities.</p>
            <p>Average locations to be visited per TL is <span className="number-value">{getValue('today_average_location_visited', '0')}</span>.</p>
          </div>
          
          {parsedData.teamLeaderSummary && parsedData.teamLeaderSummary.length > 0 && (
            <div className="image-container">
              <div className="image-title">👨‍💼 Detailed SME Team Leader Summary</div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      {Object.keys(parsedData.teamLeaderSummary[0] || {}).map(key => (
                        <th key={key}>{key.startsWith('Column_') ? '' : key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.teamLeaderSummary.map((row, idx) => (
                      <tr key={idx}>
                        {Object.keys(parsedData.teamLeaderSummary[0] || {}).map(key => (
                          <td key={key}>{row[key] !== null && row[key] !== undefined ? String(row[key]) : ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="crm-footer">
      </div>
    </div>
  );

  // Render based on department
  if (department === 'CS') {
    return renderCSContent();
  } else if (department === 'LBF') {
    return renderLBFContent();
  } else if (department === 'SME') {
    return renderSMEContent();
  }

  return null;
};

export default CRMAnalysis;
