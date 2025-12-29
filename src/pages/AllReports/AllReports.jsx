import React from 'react';
import './AllReports.css';

const AllReports = () => {
  const departments = ['CS', 'LBF', 'SME'];
  
  return (
    <div className="all-reports-page">
      <h2>All Reports</h2>
      <div className="departments-grid">
        {departments.map(dept => (
          <div key={dept} className="department-card">
            <h3>{dept} Reports</h3>
            <div className="reports-list">
              <button className="report-item">CALL CENTER</button>
              <button className="report-item">CRM</button>
              <button className="report-item">MTD</button>
              <button className="report-item">MANAGEMENT</button>
              <button className="report-item">DEPARTMENTAL</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AllReports;