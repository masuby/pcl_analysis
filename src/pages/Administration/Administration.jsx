import React, { useState } from 'react';
import UserManagement from '../../components/Administration/UserManagement/UserManagement';
import ReportManagement from '../../components/Administration/ReportManagement/ReportManagement';
import './Administration.css';

const Administration = () => {
  const [activeTab, setActiveTab] = useState('users');

  return (
    <div className="administration-page">
      <div className="page-header">
        <h1>System Administration</h1>
        <p className="page-subtitle">Manage users and system settings</p>
      </div>

      {/* Navigation Tabs */}
      <div className="admin-tabs">
        <button 
          className={`tab-button ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <span className="tab-icon">👥</span>
          <span className="tab-label">User Management</span>
        </button>
        <button 
          className={`tab-button ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          <span className="tab-icon">📊</span>
          <span className="tab-label">Report Management</span>
        </button>
      </div>

      {/* Content Area */}
      <div className="admin-content">
        {activeTab === 'users' && <UserManagement />}
        {activeTab === 'reports' && <ReportManagement />}
        {activeTab === 'settings' && (
          <div className="coming-soon">
            <div className="coming-soon-icon">🚧</div>
            <h2>Coming Soon</h2>
            <p>System Settings will be available in the next update.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Administration;