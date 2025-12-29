import React from 'react';
import CRMCSC from './components/CRMCSC/CRMCSC';
import CRMLBF from './components/CRMLBF/CRMLBF';
import CRMSME from './components/CRMSME/CRMSME';
import './CRMdashboard.css';

const CRMdashboard = ({ reports, selectedDepartment, onDepartmentChange, userData }) => {
  // Determine which department to show
  // Priority: selectedDepartment > userData.department > 'CS' as default
  const department = selectedDepartment !== 'ALL' 
    ? selectedDepartment 
    : (userData?.department || 'CS');

  // Route to appropriate department component
  const renderDepartmentView = () => {
    switch (department.toUpperCase()) {
      case 'LBF':
        return <CRMLBF />;
      case 'CS':
        return <CRMCSC />;
      case 'SME':
        return <CRMSME />;
      default:
        return <CRMCSC />;
    }
  };

  return (
    <div className="dashboard-view">
      {renderDepartmentView()}
    </div>
  );
};

export default CRMdashboard;