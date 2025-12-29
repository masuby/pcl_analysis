import React from 'react';
import LBFCallCenter from './components/LBFCallCenter/LBFCallCenter';
import CSCallCenter from './components/CSCallCenter/CSCallCenter';
import SMECallCenter from './components/SMECallCenter/SMECallCenter';
import './CallCenterDashboard.css';

const CallCenterDashboard = ({ reports, selectedDepartment, onDepartmentChange, userData }) => {
  // Determine which department to show
  // Priority: selectedDepartment > userData.department > 'CS' as default
  const department = selectedDepartment !== 'ALL' 
    ? selectedDepartment 
    : (userData?.department || 'CS');

  // Route to appropriate department component
  const renderDepartmentView = () => {
    switch (department.toUpperCase()) {
      case 'LBF':
        return <LBFCallCenter />;
      case 'CS':
        return <CSCallCenter />;
      case 'SME':
        return <SMECallCenter />;
      default:
        return <CSCallCenter />;
    }
  };

  return (
    <div className="dashboard-view">
      {renderDepartmentView()}
    </div>
  );
};

export default CallCenterDashboard;