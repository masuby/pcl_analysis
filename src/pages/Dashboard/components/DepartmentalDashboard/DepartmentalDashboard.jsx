import React, { useState } from 'react';
import './DepartmentalDashboard.css';
import ScoreCardReports from './components/ScoreCardReports/ScoreCardReports';
import Marketing from './components/Marketing/Marketing';
import Credit from './components/Credit/Credit';
import GapAnalysis from './components/GapAnalysis/GapAnalysis';

const DepartmentalDashboard = ({ reports, selectedDepartment, onDepartmentChange, userData }) => {
  const [activeView, setActiveView] = useState('SCORE_CARD_REPORTS'); // 'SCORE_CARD_REPORTS', 'GAP_ANALYSIS', 'MARKETING', 'CREDIT'

  return (
    <div className="dept-dashboard-view">
      {/* Toggle Buttons */}
      <div className="dept-toggle-buttons">
        <button
          className={`dept-toggle-btn ${activeView === 'SCORE_CARD_REPORTS' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('SCORE_CARD_REPORTS')}
        >
          SCORE CARD REPORTS
        </button>
        <button
          className={`dept-toggle-btn ${activeView === 'GAP_ANALYSIS' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('GAP_ANALYSIS')}
        >
          GAP ANALYSIS REPORTS
        </button>
        <button
          className={`dept-toggle-btn ${activeView === 'MARKETING' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('MARKETING')}
        >
          MARKETING ANALYSIS
        </button>
        <button
          className={`dept-toggle-btn ${activeView === 'CREDIT' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('CREDIT')}
        >
          CREDIT ANALYSIS
        </button>
      </div>

      {/* Content Area */}
      <div className="dept-content">
        {activeView === 'SCORE_CARD_REPORTS' && (
          <ScoreCardReports
            reports={reports}
            selectedDepartment={selectedDepartment}
            userData={userData}
          />
        )}
        {activeView === 'GAP_ANALYSIS' && <GapAnalysis />}
        {activeView === 'MARKETING' && <Marketing />}
        {activeView === 'CREDIT' && <Credit />}
      </div>
    </div>
  );
};

export default DepartmentalDashboard;
