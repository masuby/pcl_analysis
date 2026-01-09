import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import ReportTypeSelector from './components/ReportTypeSelector/ReportTypeSelector';
import ManagementDashboard from './components/ManagementDashboard/ManagementDashboard';
import CRMdashboard from './components/CRMdashboard/CRMdashboard';
import CallCenterDashboard from './components/CallCenterDashboard/CallCenterDashboard';
import MTDdashboard from './components/MTDdashboard/MTDdashboard';
import DepartmentalDashboard from './components/DepartmentalDashboard/DepartmentalDashboard';
import ChallengeDashboard from './components/ChallengeDashboard/ChallengeDashboard';
import LoadingSpinner from '../../components/Common/Loading/LoadingSpinner';
import Toast from '../../components/Common/Toast/Toast';
import { useDashboardData } from './hooks/useDashboardData';
import './Dashboard.css';

const Dashboard = () => {
  const { userData } = useAuth();
  const [selectedReportType, setSelectedReportType] = useState('MANAGEMENT');
  const [selectedDepartment, setSelectedDepartment] = useState(userData?.department || 'ALL');
  const [toast, setToast] = useState(null);
  
  const {
    reports,
    loading,
    error,
    refreshData
  } = useDashboardData(selectedReportType, selectedDepartment);

  const handleReportTypeChange = (reportType, preserveDepartment = false) => {
    setSelectedReportType(reportType);
    // Reset to user's department when switching report types, unless preserveDepartment is true
    if (!preserveDepartment) {
      if (reportType === 'MANAGEMENT') {
        setSelectedDepartment('ALL');
      } else {
        setSelectedDepartment(userData?.department || 'ALL');
      }
    }
  };

  const handleDepartmentChange = (department) => {
    setSelectedDepartment(department);
  };

  useEffect(() => {
    if (error) {
      setToast({ type: 'error', message: error });
      setTimeout(() => setToast(null), 5000);
    }
  }, [error]);

  const renderDashboard = () => {
    if (loading) {
      return <LoadingSpinner size="medium" message="Loading..." />;
    }

    switch (selectedReportType) {
      case 'MANAGEMENT':
        return (
          <ManagementDashboard 
            reports={reports}
            selectedDepartment={selectedDepartment}
          />
        );
      case 'CRM':
        return (
          <CRMdashboard 
            reports={reports}
            selectedDepartment={selectedDepartment}
            onDepartmentChange={handleDepartmentChange}
            userData={userData}
          />
        );
      case 'CALL CENTER':
        return (
          <CallCenterDashboard 
            reports={reports}
            selectedDepartment={selectedDepartment}
            onDepartmentChange={handleDepartmentChange}
            userData={userData}
          />
        );
      case 'MTD':
        return (
          <MTDdashboard 
            reports={reports}
            selectedDepartment={selectedDepartment}
            onDepartmentChange={handleDepartmentChange}
            userData={userData}
          />
        );
      case 'DEPARTMENTAL':
        return (
          <DepartmentalDashboard 
            reports={reports}
            selectedDepartment={selectedDepartment}
            onDepartmentChange={handleDepartmentChange}
            userData={userData}
          />
        );
      case 'CHALLENGE':
        return (
          <ChallengeDashboard 
            reports={reports}
            selectedDepartment={selectedDepartment}
            onDepartmentChange={handleDepartmentChange}
            userData={userData}
          />
        );
      default:
        return (
          <div className="no-dashboard-message">
            <p>Select a report type</p>
          </div>
        );
    }
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="header-lines">
          <div className="top-line"></div>
          <ReportTypeSelector
            selectedType={selectedReportType}
            selectedDepartment={selectedDepartment}
            onTypeChange={handleReportTypeChange}
            onDepartmentChange={handleDepartmentChange}
            userData={userData}
          />
          <div className="bottom-line"></div>
        </div>
      </div>

      <div className="dashboard-content">
        {renderDashboard()}
      </div>

      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};

export default Dashboard;