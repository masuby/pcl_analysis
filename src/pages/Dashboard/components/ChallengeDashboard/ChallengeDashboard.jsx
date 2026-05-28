import { useState } from 'react';
import './ChallengeDashboard.css';
import ConsentIncentiveReport from './ConsentIncentiveReport/ConsentIncentiveReport';
import TeamBuildingReport from './TeamBuildingReport/TeamBuildingReport';
import LocalTripReport from './LocalTripReport/LocalTripReport';
import EATripReport from './EATripReport/EATripReport';
import EATeamBuildingReport from './EATeamBuildingReport/EATeamBuildingReport';

const ChallengeDashboard = ({ reports, selectedDepartment, onDepartmentChange, userData }) => {
  // Determine which department to show
  // Priority: selectedDepartment > userData.department > userData.role > 'CS' as default
  const department = selectedDepartment !== 'ALL'
    ? selectedDepartment
    : (userData?.department || userData?.role || 'CS');

  const [activeView, setActiveView] = useState('CONSENT_INCENTIVE');

  const VIEWS = [
    { key: 'CONSENT_INCENTIVE', label: 'CONSENT INCENTIVE REPORT' },
    { key: 'TEAM_BUILDING',     label: 'TEAM BUILDING REPORT' },
    { key: 'LOCAL_TRIP',        label: 'LOCAL TRIP REPORT' },
    { key: 'EA_TEAM_BUILDING',  label: 'EA TEAM BUILDING REPORT' },
    { key: 'EA_TRIP',           label: 'EA TRIP REPORT' },
  ];

  return (
    <div className="dept-dashboard-view">
      {/* Tab bar */}
      <div className="dept-toggle-wrapper">
        <div className="dept-toggle-buttons">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              className={`dept-toggle-btn ${activeView === v.key ? 'dept-toggle-btn--active' : ''}`}
              onClick={() => setActiveView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="dept-content">
        {activeView === 'CONSENT_INCENTIVE' && <ConsentIncentiveReport />}
        {activeView === 'TEAM_BUILDING'     && <TeamBuildingReport />}
        {activeView === 'LOCAL_TRIP'        && <LocalTripReport />}
        {activeView === 'EA_TEAM_BUILDING'  && <EATeamBuildingReport />}
        {activeView === 'EA_TRIP'           && <EATripReport />}
      </div>
    </div>
  );
};

export default ChallengeDashboard;
