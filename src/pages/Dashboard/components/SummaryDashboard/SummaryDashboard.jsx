import { useState, useMemo } from 'react';
import { useSummaryData } from './hooks/useSummaryData';
import LoadingSpinner from '../../../../components/Common/Loading/LoadingSpinner';
import './SummaryDashboard.css';

// Format number with commas
const formatNumber = (num) => {
  if (num === null || num === undefined) return '0';
  return new Intl.NumberFormat('en-US').format(Math.round(num));
};

// Format currency
const formatCurrency = (num) => {
  if (num === null || num === undefined) return 'TZS 0';
  if (num >= 1000000000) {
    return `TZS ${(num / 1000000000).toFixed(2)}B`;
  }
  if (num >= 1000000) {
    return `TZS ${(num / 1000000).toFixed(2)}M`;
  }
  if (num >= 1000) {
    return `TZS ${(num / 1000).toFixed(2)}K`;
  }
  return `TZS ${formatNumber(num)}`;
};

// Format percentage
const formatPercent = (num) => {
  if (num === null || num === undefined) return '0%';
  return `${num.toFixed(1)}%`;
};

// Circular progress component
const CircularProgress = ({ value, max, label, color, size = 100 }) => {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="sd-circular-progress" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          className="sd-progress-bg"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <circle
          className="sd-progress-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ stroke: color }}
        />
      </svg>
      <div className="sd-progress-content">
        <span className="sd-progress-value">{formatNumber(value)}</span>
        <span className="sd-progress-label">{label}</span>
      </div>
    </div>
  );
};

// Area chart component for trend visualization with hover tooltips
const AreaChart = ({ data, height = 120 }) => {
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  if (!data || data.length === 0) {
    return (
      <div className="sd-area-chart-empty">
        <span>No trend data available</span>
      </div>
    );
  }

  const width = 100;
  const padding = { top: 15, right: 5, bottom: 25, left: 5 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const values = data.map(d => d.value);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);

  // Format date for display (day and month only)
  const formatDateLabel = (date) => {
    try {
      const d = date instanceof Date ? date : new Date(date);
      return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short'
      });
    } catch {
      return '';
    }
  };

  // Format date for tooltip (full date)
  const formatDateTooltip = (date) => {
    try {
      const d = date instanceof Date ? date : new Date(date);
      return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return '';
    }
  };

  // Create SVG path for area
  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1 || 1)) * chartWidth;
    const y = padding.top + chartHeight - ((d.value - minValue) / (maxValue - minValue || 1)) * chartHeight;
    return { x, y, value: d.value, date: d.date };
  });

  // Create path string for area
  let pathData = `M ${points[0].x} ${chartHeight + padding.top}`;
  points.forEach(p => {
    pathData += ` L ${p.x} ${p.y}`;
  });
  pathData += ` L ${points[points.length - 1].x} ${chartHeight + padding.top} Z`;

  // Create path for line
  let linePath = `M ${points[0].x} ${points[0].y}`;
  points.slice(1).forEach(p => {
    linePath += ` L ${p.x} ${p.y}`;
  });

  const handleMouseLeave = () => {
    setHoveredIndex(null);
  };

  return (
    <div className="sd-area-chart" onMouseLeave={handleMouseLeave}>
      {/* Plot only: fixed height so global svg rules cannot stretch the chart to viewport width */}
      <div className="sd-area-chart-plot" style={{ height: `${height}px` }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#2a5298" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#2a5298" stopOpacity="0.05" />
            </linearGradient>
          </defs>
          {/* Area */}
          <path d={pathData} fill="url(#areaGradient)" />
          {/* Line */}
          <path d={linePath} fill="none" stroke="#2a5298" strokeWidth="2" />
          {/* Points */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={hoveredIndex === i ? '4' : '2.5'}
              fill={hoveredIndex === i ? '#1e3c72' : '#2a5298'}
              stroke="white"
              strokeWidth={hoveredIndex === i ? '2' : '1'}
              style={{ transition: 'all 0.2s ease' }}
            />
          ))}
        </svg>
        {/* Hover overlay areas */}
        <div className="sd-area-hover-overlay">
          {points.map((p, i) => {
            const percentX = (p.x / width) * 100;
            const percentY = (p.y / height) * 100;
            return (
              <div
                key={i}
                className="sd-area-hover-zone"
                style={{
                  left: `${percentX}%`,
                  top: `${percentY}%`,
                  transform: 'translate(-50%, -50%)'
                }}
                onMouseEnter={(e) => {
                  const root = e.currentTarget.closest('.sd-area-chart');
                  if (!root) return;
                  const rect = root.getBoundingClientRect();
                  const zoneRect = e.currentTarget.getBoundingClientRect();
                  setTooltipPosition({
                    x: zoneRect.left - rect.left + (zoneRect.width / 2),
                    y: zoneRect.top - rect.top - 10
                  });
                  setHoveredIndex(i);
                }}
              />
            );
          })}
        </div>
      </div>
      {/* Tooltip: anchored to full chart root so it works for plot + date labels */}
      {hoveredIndex !== null && (
        <div
          className="sd-area-tooltip"
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y - 50}px`,
            transform: 'translateX(-50%)'
          }}
        >
          <div className="sd-tooltip-date">{formatDateTooltip(points[hoveredIndex].date)}</div>
          <div className="sd-tooltip-value">{formatCurrency(points[hoveredIndex].value)}</div>
        </div>
      )}
      {/* Date labels at bottom */}
      <div className="sd-area-chart-labels">
        {data.map((d, i) => {
          const pointX = padding.left + (i / (data.length - 1 || 1)) * chartWidth;
          return (
            <span 
              key={i} 
              className={`sd-area-label ${hoveredIndex === i ? 'sd-area-label-highlight' : ''}`}
              style={{ position: 'relative' }}
              onMouseEnter={(e) => {
                const chartContainer = e.currentTarget.closest('.sd-area-chart');
                if (!chartContainer) return;
                const rect = chartContainer.getBoundingClientRect();
                const labelRect = e.currentTarget.getBoundingClientRect();
                setTooltipPosition({
                  x: labelRect.left - rect.left + (labelRect.width / 2),
                  y: labelRect.top - rect.top - 10
                });
                setHoveredIndex(i);
              }}
              onMouseLeave={handleMouseLeave}
            >
              {formatDateLabel(d.date)}
            </span>
          );
        })}
      </div>
    </div>
  );
};

// Horizontal bar chart for MTD
const HorizontalBarChart = ({ data, title }) => {
  if (!data || data.length === 0) {
    return (
      <div className="sd-chart-empty">
        <span>No data available</span>
      </div>
    );
  }
  
  const maxValue = Math.max(...data.map(d => d.value));
  // Use darker colors for better visibility
  const colors = [
    '#1e40af', '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd',
    '#1e3a8a', '#1e40af', '#2563eb', '#3b82f6', '#60a5fa'
  ];
  
  return (
    <div className="sd-horizontal-chart">
      <h4 className="sd-chart-title">{title}</h4>
      <div className="sd-chart-bars">
        {data.map((item, index) => (
          <div key={index} className="sd-horizontal-bar-row">
            <div className="sd-bar-rank">{index + 1}</div>
            <div className="sd-bar-name" title={item.name}>
              {item.name.length > 15 ? item.name.substring(0, 15) + '...' : item.name}
            </div>
            <div className="sd-bar-track">
              <div 
                className="sd-bar-fill"
                style={{ 
                  width: `${maxValue > 0 ? (item.value / maxValue) * 100 : 0}%`,
                  backgroundColor: colors[index % colors.length]
                }}
              >
                <span className="sd-bar-value-inside">{formatCurrency(item.value)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Department Selector Component
const DepartmentSelector = ({ departments, activeDept, onDeptChange, isAdmin }) => {
  if (!isAdmin && departments.length === 1) {
    return null; // Don't show selector if user only has access to one department
  }

  return (
    <div className="sd-dept-selector">
      {departments.map(dept => (
        <button
          key={dept}
          className={`sd-dept-btn ${activeDept === dept ? 'sd-active' : ''}`}
          onClick={() => onDeptChange(dept)}
        >
          {dept}
        </button>
      ))}
    </div>
  );
};

// Format date helper
const formatReportDate = (date) => {
  if (!date) return '';
  try {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return '';
  }
};

const SummaryDashboard = ({ selectedDepartment = 'ALL', userData }) => {
  const isAdmin = userData?.role === 'admin' || userData?.role === 'ALL';
  const userDept = userData?.department?.toUpperCase() || 'CS';
  
  // Department states for each section
  // For admin/ALL users: default to CS, for regular users: default to their department
  const [managementDept, setManagementDept] = useState('Country'); // 'Country', 'CS', 'LBF', 'SME'
  const [crmDept, setCrmDept] = useState(isAdmin ? 'CS' : userDept);
  const [callCenterDept, setCallCenterDept] = useState(isAdmin ? 'CS' : userDept);
  const [mtdDept, setMtdDept] = useState(isAdmin ? 'CS' : userDept);
  const [mtdViewType, setMtdViewType] = useState('supervision'); // 'supervision' or 'teamleader'
  
  const availableDepts = isAdmin ? ['CS', 'LBF', 'SME'] : [userDept];

  const { 
    managementData, 
    crmData, 
    callCenterData, 
    mtdData, 
    loading, 
    error 
  } = useSummaryData();
  
  // Get current management data based on selected department
  const currentManagementData = managementData?.[managementDept] || managementData?.Country || null;

  // Get data for active departments
  const currentCrmData = crmData[crmDept] || null;
  const currentCallCenterData = callCenterData[callCenterDept] || null;
  const currentMtdData = mtdData[mtdDept] || null;
  
  // Get MTD data based on view type
  const mtdDisplayData = useMemo(() => {
    if (!currentMtdData) return null;
    if (mtdViewType === 'supervision') {
      return {
        topPerformers: currentMtdData.supervisions || [],
        totalValue: currentMtdData.totalSupervisionValue || 0,
        reportDate: currentMtdData.reportDate
      };
    } else {
      return {
        topPerformers: currentMtdData.teamLeaders || [],
        totalValue: currentMtdData.totalTeamLeaderValue || 0,
        reportDate: currentMtdData.reportDate
      };
    }
  }, [currentMtdData, mtdViewType]);

  // Calculate success rate for call center
  const callSuccessRate = useMemo(() => {
    if (!currentCallCenterData || currentCallCenterData.totalCalls === 0) return 0;
    return (currentCallCenterData.successfulCalls / currentCallCenterData.totalCalls) * 100;
  }, [currentCallCenterData]);

  if (loading && Object.keys(managementData || {}).length === 0 && Object.keys(crmData).length === 0 && Object.keys(callCenterData).length === 0 && Object.keys(mtdData).length === 0) {
    return (
      <div className="sd-loading-container">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="sd-error-state">
        <div className="sd-error-icon">⚠️</div>
        <h3>Error Loading Data</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="sd-dashboard">
      {/* Header */}
      <div className="sd-header">
        <h1 className="sd-title">Dashboard Summary</h1>
      </div>

      {/* Management Section - Full width */}
      <div className="sd-section sd-management-section sd-full-width">
        <div className="sd-section-header">
          <div className="sd-section-icon sd-management-icon">📈</div>
          <h2>Management Overview</h2>
          <div className="sd-header-right">
            {currentManagementData?.reportDate && (
              <span className="sd-report-date">{formatReportDate(currentManagementData.reportDate)}</span>
            )}
            <div className="sd-mgmt-dept-selector">
              <button
                className={`sd-mgmt-dept-btn ${managementDept === 'Country' ? 'sd-active' : ''}`}
                onClick={() => setManagementDept('Country')}
              >
                Country
              </button>
              <button
                className={`sd-mgmt-dept-btn ${managementDept === 'CS' ? 'sd-active' : ''}`}
                onClick={() => setManagementDept('CS')}
              >
                CS
              </button>
              <button
                className={`sd-mgmt-dept-btn ${managementDept === 'LBF' ? 'sd-active' : ''}`}
                onClick={() => setManagementDept('LBF')}
              >
                LBF
              </button>
              <button
                className={`sd-mgmt-dept-btn ${managementDept === 'SME' ? 'sd-active' : ''}`}
                onClick={() => setManagementDept('SME')}
              >
                SME
              </button>
            </div>
          </div>
        </div>
        
        {currentManagementData ? (
          <div className="sd-management-content">
            {/* Main KPIs Row - Disbursement and Trend Graph */}
            <div className="sd-main-kpis-row">
              {/* Main KPI - Disbursement */}
              <div className="sd-main-kpi-card">
                <div className="sd-kpi-header">
                  <span className="sd-kpi-label">Disbursement This Month</span>
                  <span className={`sd-kpi-trend ${currentManagementData.trend >= 0 ? 'sd-positive' : 'sd-negative'}`}>
                    {currentManagementData.trend >= 0 ? '↑' : '↓'} {formatPercent(Math.abs(currentManagementData.trend))}
                  </span>
                </div>
                <div className="sd-kpi-value">{formatCurrency(currentManagementData.disbursementThisMonth)}</div>
              </div>

              {/* Trend Graph */}
              <div className="sd-trend-graph-card">
                <div className="sd-kpi-header">
                  <span className="sd-kpi-label">Sales Trend</span>
                </div>
                {currentManagementData.trendData && currentManagementData.trendData.length > 0 ? (
                  <AreaChart data={currentManagementData.trendData} height={100} />
                ) : (
                  <div className="sd-area-chart-empty">No trend data</div>
                )}
              </div>
            </div>

            {/* Secondary KPIs */}
            <div className="sd-secondary-kpis">
              <div className="sd-kpi-box">
                <div className="sd-kpi-box-icon">🆕</div>
                <div className="sd-kpi-box-content">
                  <span className="sd-kpi-box-value">{formatCurrency(currentManagementData.newBusiness)}</span>
                  <span className="sd-kpi-box-label">New Business</span>
                </div>
              </div>
              <div className="sd-kpi-box">
                <div className="sd-kpi-box-icon">🔄</div>
                <div className="sd-kpi-box-content">
                  <span className="sd-kpi-box-value">{formatCurrency(currentManagementData.repeatBusiness)}</span>
                  <span className="sd-kpi-box-label">Repeat Business</span>
                </div>
              </div>
              <div className="sd-kpi-box">
                <div className="sd-kpi-box-icon">📝</div>
                <div className="sd-kpi-box-content">
                  <span className="sd-kpi-box-value">{formatNumber(currentManagementData.numberOfLoans)}</span>
                  <span className="sd-kpi-box-label">Number of Loans</span>
                </div>
              </div>
              <div className="sd-kpi-box">
                <div className="sd-kpi-box-icon">👥</div>
                <div className="sd-kpi-box-content">
                  <span className="sd-kpi-box-value">{formatNumber(currentManagementData.activeReps)}</span>
                  <span className="sd-kpi-box-label">Active Reps</span>
                </div>
              </div>
              <div className="sd-kpi-box sd-warning">
                <div className="sd-kpi-box-icon">⚠️</div>
                <div className="sd-kpi-box-content">
                  <span className="sd-kpi-box-value">{formatPercent(currentManagementData.par30)}</span>
                  <span className="sd-kpi-box-label">PAR &gt; 30</span>
                </div>
              </div>
            </div>

            {/* Average Loan Size */}
            <div className="sd-avg-loan-card">
              <span className="sd-avg-label">Average Loan Size</span>
              <span className="sd-avg-value">{formatCurrency(currentManagementData.averageLoanSize)}</span>
            </div>
          </div>
        ) : (
          <div className="sd-section-no-data">
            <span>No management data available for {managementDept}</span>
          </div>
        )}
      </div>

      {/* Horizontal Divider */}
      <div className="sd-horizontal-divider"></div>

      {/* Bottom Row - CRM, Call Center, MTD */}
      <div className="sd-grid sd-bottom-row">
        {/* CRM Section */}
        <div className="sd-section sd-crm-section">
          <div className="sd-section-header">
            <div className="sd-section-icon sd-crm-icon">👥</div>
            <h2>CRM Overview</h2>
            <div className="sd-header-right">
              {currentCrmData?.reportDate && (
                <span className="sd-report-date">{formatReportDate(currentCrmData.reportDate)}</span>
              )}
              <DepartmentSelector 
                departments={availableDepts}
                activeDept={crmDept}
                onDeptChange={setCrmDept}
                isAdmin={isAdmin}
              />
            </div>
          </div>
          
          {currentCrmData ? (
            <div className="sd-crm-content">
              {/* Lead Metrics */}
              <div className="sd-crm-leads-row">
                <CircularProgress 
                  value={currentCrmData.numberOfLeads} 
                  max={currentCrmData.numberOfLeads + currentCrmData.prospectLeads}
                  label="Total Leads"
                  color="#2a5298"
                  size={90}
                />
                <CircularProgress 
                  value={currentCrmData.prospectLeads} 
                  max={currentCrmData.numberOfLeads + currentCrmData.prospectLeads}
                  label="Prospects"
                  color="#38a169"
                  size={90}
                />
              </div>

              {/* Agent/TL Counts */}
              <div className="sd-crm-counts-grid">
                <div className="sd-count-card sd-agents">
                  <div className="sd-count-icon">👤</div>
                  <div className="sd-count-details">
                    <span className="sd-count-value">{currentCrmData.totalAgents}</span>
                    <span className="sd-count-label">Total Agents</span>
                  </div>
                </div>
                <div className="sd-count-card sd-team-leaders">
                  <div className="sd-count-icon">👔</div>
                  <div className="sd-count-details">
                    <span className="sd-count-value">{currentCrmData.totalTeamLeaders}</span>
                    <span className="sd-count-label">Team Leaders</span>
                  </div>
                </div>
                <div className="sd-count-card sd-logged-agents">
                  <div className="sd-count-icon">✅</div>
                  <div className="sd-count-details">
                    <span className="sd-count-value">{currentCrmData.loggedInAgents}</span>
                    <span className="sd-count-label">Logged In Agents</span>
                  </div>
                </div>
                <div className="sd-count-card sd-logged-tls">
                  <div className="sd-count-icon">✅</div>
                  <div className="sd-count-details">
                    <span className="sd-count-value">{currentCrmData.loggedInTeamLeaders}</span>
                    <span className="sd-count-label">Logged In TLs</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="sd-section-no-data">
              <span>No CRM data for {crmDept}</span>
            </div>
          )}
        </div>

        {/* Vertical Divider */}
        <div className="sd-vertical-divider"></div>

        {/* Call Center Section */}
        <div className="sd-section sd-callcenter-section">
          <div className="sd-section-header">
            <div className="sd-section-icon sd-callcenter-icon">📞</div>
            <h2>Call Center Overview</h2>
            <div className="sd-header-right">
              {currentCallCenterData?.reportDate && (
                <span className="sd-report-date">{formatReportDate(currentCallCenterData.reportDate)}</span>
              )}
              <DepartmentSelector 
                departments={availableDepts}
                activeDept={callCenterDept}
                onDeptChange={setCallCenterDept}
                isAdmin={isAdmin}
              />
            </div>
          </div>
          
          {currentCallCenterData ? (
            <div className="sd-callcenter-content">
              {/* Main Call Stats */}
              <div className="sd-call-stats-row">
                <div className="sd-call-stat-card sd-total">
                  <div className="sd-stat-icon">📱</div>
                  <div className="sd-stat-value">{formatNumber(currentCallCenterData.totalCalls)}</div>
                  <div className="sd-stat-label">Total Calls</div>
                </div>
                <div className="sd-call-stat-card sd-success">
                  <div className="sd-stat-icon">✅</div>
                  <div className="sd-stat-value">{formatNumber(currentCallCenterData.successfulCalls)}</div>
                  <div className="sd-stat-label">Successful</div>
                  <div className="sd-stat-percent">{formatPercent(callSuccessRate)}</div>
                </div>
                <div className="sd-call-stat-card sd-failed">
                  <div className="sd-stat-icon">❌</div>
                  <div className="sd-stat-value">{formatNumber(currentCallCenterData.unsuccessfulCalls)}</div>
                  <div className="sd-stat-label">Unsuccessful</div>
                  <div className="sd-stat-percent">{formatPercent(100 - callSuccessRate)}</div>
                </div>
              </div>

              {/* Secondary Stats */}
              <div className="sd-call-secondary-stats">
                <div className="sd-secondary-stat">
                  <span className="sd-secondary-icon">📲</span>
                  <span className="sd-secondary-value">{formatNumber(currentCallCenterData.uniqueCalledNumbers)}</span>
                  <span className="sd-secondary-label">Unique Called Numbers</span>
                </div>
                <div className="sd-secondary-stat">
                  <span className="sd-secondary-icon">📱</span>
                  <span className="sd-secondary-value">{formatNumber(currentCallCenterData.uniqueCallingNumbers)}</span>
                  <span className="sd-secondary-label">Unique Calling Numbers</span>
                </div>
                <div className="sd-secondary-stat sd-highlight">
                  <span className="sd-secondary-icon">👥</span>
                  <span className="sd-secondary-value">{formatNumber(currentCallCenterData.activeAgents)}</span>
                  <span className="sd-secondary-label">Active Agents</span>
                </div>
              </div>

              {/* Success Rate Bar */}
              <div className="sd-success-rate-bar">
                <div className="sd-rate-label">Success Rate</div>
                <div className="sd-rate-track">
                  <div 
                    className="sd-rate-fill sd-success"
                    style={{ width: `${callSuccessRate}%` }}
                  />
                  <div 
                    className="sd-rate-fill sd-failed"
                    style={{ width: `${100 - callSuccessRate}%` }}
                  />
                </div>
                <div className="sd-rate-labels">
                  <span className="sd-rate-success">{formatPercent(callSuccessRate)}</span>
                  <span className="sd-rate-failed">{formatPercent(100 - callSuccessRate)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="sd-section-no-data">
              <span>No call center data for {callCenterDept}</span>
            </div>
          )}
        </div>

        {/* Vertical Divider */}
        <div className="sd-vertical-divider"></div>

        {/* MTD Section */}
        <div className="sd-section sd-mtd-section">
          <div className="sd-section-header">
            <div className="sd-section-icon sd-mtd-icon">🏆</div>
            <h2>MTD Top Performers</h2>
            <div className="sd-header-right">
              {currentMtdData?.reportDate && (
                <span className="sd-report-date">{formatReportDate(currentMtdData.reportDate)}</span>
              )}
              <DepartmentSelector 
                departments={availableDepts}
                activeDept={mtdDept}
                onDeptChange={setMtdDept}
                isAdmin={isAdmin}
              />
            </div>
          </div>
          
          {mtdDisplayData && mtdDisplayData.topPerformers && mtdDisplayData.topPerformers.length > 0 ? (
            <div className="sd-mtd-content">
              <div className="sd-mtd-header-controls">
                <h4 className="sd-chart-title">Top 10 by Value</h4>
                <select 
                  className="sd-mtd-view-selector"
                  value={mtdViewType}
                  onChange={(e) => setMtdViewType(e.target.value)}
                >
                  <option value="supervision">Supervision</option>
                  <option value="teamleader">Team Leader</option>
                </select>
              </div>
              <HorizontalBarChart 
                data={mtdDisplayData.topPerformers} 
                title=""
              />
            </div>
          ) : (
            <div className="sd-section-no-data">
              <span>No MTD data for {mtdDept}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SummaryDashboard;
