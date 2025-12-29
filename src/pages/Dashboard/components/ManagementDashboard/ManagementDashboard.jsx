// C:\Users\Daniel\Desktop\code\Website\pcl_analysis\src\pages\Dashboard\components\ManagementDashboard\ManagementDashboard.jsx
import './ManagementDashboard.css';
import { useManagementData } from './hooks/useManagementData';
import LoadingSpinner from '../../../../components/Common/Loading/LoadingSpinner';
import CountrywiseSection from './components/CountrywiseSection/CountrywiseSection';
import CSSection from './components/CSSection/CSSection';
import LBFSection from './components/LBFSection/LBFSection';
import SMESection from './components/SMESection/SMESection';
import CSZANZIBARSection from './components/CSZANZIBARSection/CSZANZIBARSection';

const ManagementDashboard = () => {
  const { parsedReports, loading, error } = useManagementData();

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

  // Transform parsed reports into chart-ready data
  const countrywiseData = parsedReports
    .filter(report => report.countrywise && Object.keys(report.countrywise).length > 0)
    .map(report => ({
      fileName: report.fileName || 'Unknown',
      date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
      ...report.countrywise
    }));

  // CS data - total and individual branches
  const csData = parsedReports
    .filter(report => report.cs && Object.keys(report.cs).length > 0)
    .map(report => ({
      fileName: report.fileName || 'Unknown',
      date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
      ...report.cs
    }));

  // CS individual branches data
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

  // LBF data - total and individual branches
  const lbfData = parsedReports
    .filter(report => report.lbf && Object.keys(report.lbf).length > 0)
    .map(report => ({
      fileName: report.fileName || 'Unknown',
      date: report.date ? (report.date instanceof Date ? report.date : new Date(report.date)) : new Date(),
      ...report.lbf
    }));

  // LBF individual branches data
  const lbfBranchesData = {};
  const lbfBranchNames = ['LBF', 'IPF', 'MIF', 'MIF Customs', 'Lbf Yard Finance', 'LBF QUICKCASH'];
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

  return (
    <div className="dashboard-view">
      {countrywiseData.length > 0 && (
        <>
          <CountrywiseSection data={countrywiseData} />
          <hr />
        </>
      )}
      {csData.length > 0 && (
        <>
          <CSSection data={csData} branchesData={csBranchesData} />
          <hr />
        </>
      )}
      {lbfData.length > 0 && (
        <>
          <LBFSection data={lbfData} branchesData={lbfBranchesData} />
          <hr />
        </>
      )}
      {smeData.length > 0 && (
        <>
          <SMESection data={smeData} />
          <hr />
        </>
      )}
      {zanzibarData.length > 0 && (
        <CSZANZIBARSection data={zanzibarData} />
      )}
      {countrywiseData.length === 0 && csData.length === 0 && lbfData.length === 0 && smeData.length === 0 && zanzibarData.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <p>No data available for visualization</p>
          <p className="empty-subtext">The uploaded reports may not contain the expected data structure</p>
        </div>
      )}
    </div>
  );
};

export default ManagementDashboard;