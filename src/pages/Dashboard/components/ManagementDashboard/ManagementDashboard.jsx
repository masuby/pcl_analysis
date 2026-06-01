// ManagementDashboard.jsx - Combined Analysis Section with dropdown selector
import { useState } from 'react';
import './ManagementDashboard.css';
import { useManagementData } from './hooks/useManagementData';
import LoadingSpinner from '../../../../components/Common/Loading/LoadingSpinner';
import UnifiedSection from './components/UnifiedSection/UnifiedSection';
import ClusterAnalysisSection from './components/ClusterAnalysisSection/ClusterAnalysisSection';
import RegionalAnalysisSection from './components/RegionalAnalysisSection/RegionalAnalysisSection';

const ManagementDashboard = () => {
  const { parsedReports, loading, error } = useManagementData();
  const [analysisView, setAnalysisView] = useState('country'); // 'country', 'cluster', 'regional'

  if (loading) {
    return (
      <div className="management-loading-container">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-state">
        <div className="error-icon">⚠️</div>
        <h3>Error Loading Data</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (!parsedReports || parsedReports.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📊</div>
        <p>No management reports found</p>
        <p className="empty-subtext">Upload management reports to see analytics here</p>
      </div>
    );
  }

  // Transform parsed reports into chart-ready data (ALL data, not limited)
  const countrywiseData = parsedReports
    .filter(report => report.countrywise && Object.keys(report.countrywise).length > 0)
    .map(report => ({
      fileName: report.fileName || 'Unknown',
      date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
      ...report.countrywise
    }));

  // CS data - total and individual branches (ALL data)
  const csData = parsedReports
    .filter(report => report.cs && Object.keys(report.cs).length > 0)
    .map(report => ({
      fileName: report.fileName || 'Unknown',
      date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
      ...report.cs
    }));

  // CS individual branches data (ALL data)
  const csBranchesData = {};
  const csBranchNames = ['CS', 'Cs Asset Finance'];
  csBranchNames.forEach(branchName => {
    csBranchesData[branchName] = parsedReports
      .filter(report => report.csBranches && report.csBranches[branchName] && Object.keys(report.csBranches[branchName]).length > 0)
      .map(report => ({
        fileName: report.fileName || 'Unknown',
        date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
        ...report.csBranches[branchName]
      }));
  });

  // LBF data - total and individual branches (ALL data)
  const lbfData = parsedReports
    .filter(report => report.lbf && Object.keys(report.lbf).length > 0)
    .map(report => ({
      fileName: report.fileName || 'Unknown',
      date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
      ...report.lbf
    }));

  // LBF individual branches data (ALL data)
  const lbfBranchesData = {};
  const lbfBranchNames = ['LBF', 'IPF', 'MIF', 'MIF Customs', 'Lbf Yard Finance', 'LBF QUICKCASH', 'LBF-FLEX'];
  lbfBranchNames.forEach(branchName => {
    lbfBranchesData[branchName] = parsedReports
      .filter(report => report.lbfBranches && report.lbfBranches[branchName] && Object.keys(report.lbfBranches[branchName]).length > 0)
      .map(report => ({
        fileName: report.fileName || 'Unknown',
        date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
        ...report.lbfBranches[branchName]
      }));
  });

  const smeData = parsedReports
    .filter(report => report.sme && Object.keys(report.sme).length > 0)
    .map(report => ({
      fileName: report.fileName || 'Unknown',
      date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
      ...report.sme
    }));

  const zanzibarData = parsedReports
    .filter(report => report.zanzibar && Object.keys(report.zanzibar).length > 0)
    .map(report => ({
      fileName: report.fileName || 'Unknown',
      date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
      ...report.zanzibar
    }));

  // AgriFinance data — single branch pulled from the Country sheet's "Agrifinance" row.
  // No sub-branches; structured the same way as SME.
  const agrifinanceData = parsedReports
    .filter(report => report.agrifinance && Object.keys(report.agrifinance).length > 0)
    .map(report => ({
      fileName: report.fileName || 'Unknown',
      date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
      ...report.agrifinance
    }));

  // View options for the dropdown
  const viewOptions = [
    { value: 'country', label: '🌍 Country Analysis', icon: '🌍' },
    { value: 'cluster', label: '📊 Cluster Analysis', icon: '📊' },
    { value: 'regional', label: '🏢 Regional Analysis', icon: '🏢' }
  ];

  const currentViewLabel = viewOptions.find(v => v.value === analysisView)?.label || 'Analysis';

  return (
    <div className="dashboard-view">
      {/* Combined Analysis Section with View Selector */}
      <div className="combined-analysis-section">
        <div className="analysis-view-header">
          <h2 className="analysis-view-title">
            {currentViewLabel}
          </h2>
          <div className="analysis-view-actions">
            <div className="analysis-view-selector">
              <label className="view-selector-label">View:</label>
              <select 
                value={analysisView} 
                onChange={e => setAnalysisView(e.target.value)}
                className="view-selector-dropdown"
              >
                {viewOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Render the selected analysis section */}
        <div className="analysis-view-content">
          {analysisView === 'country' && (
            <UnifiedSection
              countrywiseData={countrywiseData}
              csData={csData}
              csBranchesData={csBranchesData}
              lbfData={lbfData}
              lbfBranchesData={lbfBranchesData}
              smeData={smeData}
              zanzibarData={zanzibarData}
              agrifinanceData={agrifinanceData}
            />
          )}
          
          {analysisView === 'cluster' && (
            <ClusterAnalysisSection parsedReports={parsedReports} />
          )}
          
          {analysisView === 'regional' && (
            <RegionalAnalysisSection parsedReports={parsedReports} />
          )}
        </div>
      </div>
    </div>
  );
};

export default ManagementDashboard;
