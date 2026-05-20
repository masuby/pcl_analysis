import React, { useState } from 'react';
import './DepartmentalDashboard.css';
import ScoreCardReports from './components/ScoreCardReports/ScoreCardReports';
import PenetrationAnalysis from './components/PenetrationAnalysis/PenetrationAnalysis';
import SettlementsAnalysis from './components/SettlementsAnalysis/SettlementsAnalysis';
import GapAnalysis from './components/GapAnalysis/GapAnalysis';
import SalesReviewReport from './components/SalesReviewReport/SalesReviewReport';
import KpiAnalysisReport from './components/KpiAnalysisReport/KpiAnalysisReportShell';
import TemporaryReports from './components/TemporaryReports/TemporaryReports';
import Marketing from './components/Marketing/Marketing';
import RsmScoreCard from './components/RsmScoreCard/RsmScoreCard';

const DepartmentalDashboard = ({ reports, selectedDepartment, onDepartmentChange, userData }) => {
  const [activeView, setActiveView] = useState('SCORE_CARD_REPORTS');

  return (
    <div className="dept-dashboard-view">
      {/* Tab bar: sticky when scrolling, smaller professional buttons, CS/LBF/SME on right */}
      <div className="dept-toggle-wrapper">
        <div className="dept-toggle-buttons">
        <button
          className={`dept-toggle-btn ${activeView === 'SCORE_CARD_REPORTS' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('SCORE_CARD_REPORTS')}
        >
          SCORE CARD REPORTS
        </button>
        <button
          className={`dept-toggle-btn ${activeView === 'SALES_REVIEW' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('SALES_REVIEW')}
        >
          SALES REVIEW REPORT
        </button>
        <button
          className={`dept-toggle-btn ${activeView === 'GAP_ANALYSIS' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('GAP_ANALYSIS')}
        >
          GAP ANALYSIS REPORTS
        </button>
        <button
          className={`dept-toggle-btn ${activeView === 'KPI_ANALYSIS' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('KPI_ANALYSIS')}
        >
          KPI ANALYSIS REPORT
        </button>
        <button
          className={`dept-toggle-btn ${activeView === 'PENETRATION_ANALYSIS' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('PENETRATION_ANALYSIS')}
        >
          SOCIAL MEDIA ANALYSIS
        </button>
        <button
          className={`dept-toggle-btn ${activeView === 'SETTLEMENTS_ANALYSIS' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('SETTLEMENTS_ANALYSIS')}
        >
          SETTLEMENTS ANALYSIS
        </button>
        <button
          className={`dept-toggle-btn ${activeView === 'TEMPORARY_REPORTS' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('TEMPORARY_REPORTS')}
        >
          TEMPORARY REPORTS
        </button>
        <button
          className={`dept-toggle-btn ${activeView === 'MARKETING' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('MARKETING')}
        >
          MARKETING ANALYSIS
        </button>
        <button
          className={`dept-toggle-btn ${activeView === 'RSM_SCORE_CARD' ? 'dept-toggle-btn--active' : ''}`}
          onClick={() => setActiveView('RSM_SCORE_CARD')}
        >
          RSM SCORE CARD
        </button>
      </div>
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
        {activeView === 'SALES_REVIEW' && (
          <SalesReviewReport userData={userData} />
        )}
        {activeView === 'GAP_ANALYSIS' && <GapAnalysis />}
        {activeView === 'KPI_ANALYSIS' && <KpiAnalysisReport />}
        {activeView === 'PENETRATION_ANALYSIS' && <PenetrationAnalysis />}
        {activeView === 'SETTLEMENTS_ANALYSIS' && <SettlementsAnalysis />}
        {activeView === 'TEMPORARY_REPORTS' && <TemporaryReports />}
        {activeView === 'MARKETING' && <Marketing />}
        {activeView === 'RSM_SCORE_CARD' && <RsmScoreCard />}
      </div>
    </div>
  );
};

export default DepartmentalDashboard;
