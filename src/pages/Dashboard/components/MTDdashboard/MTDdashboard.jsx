import React from 'react';
import './MTDdashboard.css';

const MTDdashboard = ({ reports, selectedDepartment, onDepartmentChange, userData }) => {
  // Determine which department to show
  // Priority: selectedDepartment > userData.department > 'CS' as default
  const department = selectedDepartment !== 'ALL' 
    ? selectedDepartment 
    : (userData?.department || 'CS');

  return (
    <div className="dashboard-view mtd-dashboard-view">
      <div className="coming-soon-container">
        <div className="coming-soon-icon">🚧</div>
        <h2 className="coming-soon-title">MTD analysis for {department} is coming soon</h2>
        <p className="coming-soon-message">
          We're working on bringing you comprehensive Month-To-Date performance metrics and analytics for {department}.
        </p>
      </div>
    </div>
  );
};

export default MTDdashboard;