import React from 'react';
import './ChallengeDashboard.css';

const ChallengeDashboard = ({ reports, selectedDepartment, onDepartmentChange, userData }) => {
  // Determine which department to show
  // Priority: selectedDepartment > userData.department > userData.role > 'CS' as default
  const department = selectedDepartment !== 'ALL' 
    ? selectedDepartment 
    : (userData?.department || userData?.role || 'CS');

  return (
    <div className="dashboard-view challenge-dashboard-view">
      <div className="coming-soon-container">
        <div className="coming-soon-icon">🎯</div>
        <h2 className="coming-soon-title">CHALLENGE for {department} is coming soon</h2>
        <p className="coming-soon-message">
          We're working on bringing you motivational challenge. Keep visiting the page.
        </p>
      </div>
    </div>
  );
};

export default ChallengeDashboard;

