import { useState } from 'react';
import './DepartmentalDashboard.css';
import ScoreCardReports from './components/ScoreCardReports/ScoreCardReports';

import SettlementsAnalysis from './components/SettlementsAnalysis/SettlementsAnalysis';
import GapAnalysis from './components/GapAnalysis/GapAnalysis';
import SalesReviewReport from './components/SalesReviewReport/SalesReviewReport';
import KpiAnalysisReport from './components/KpiAnalysisReport/KpiAnalysisReportShell';
import TemporaryReports from './components/TemporaryReports/TemporaryReports';
import Marketing from './components/Marketing/Marketing';
import SocialMediaAnalysis from './components/SocialMediaAnalysis/SocialMediaAnalysis';
import RsmScoreCard from './components/RsmScoreCard/RsmScoreCard';
import ReportShell from './components/ReportShell/ReportShell';

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

      {/* Content Area — every auto-loading section is wrapped in <ReportShell>
          so the heavy component (and its useEffects / API calls) only mounts
          AFTER the user clicks "Generate Report". This makes tab switching
          instant. Sections that already have their own internal Generate
          (SocialMediaAnalysis) or are static (RsmScoreCard) are not wrapped. */}
      <div className="dept-content">
        {activeView === 'SCORE_CARD_REPORTS' && (
          <ReportShell
            title="SCORE CARD REPORTS"
            icon="📈"
            description="Weekly and monthly score-card across the department — disbursement actuals vs targets, top performers, and recipient lists."
          >
            <ScoreCardReports
              reports={reports}
              selectedDepartment={selectedDepartment}
              userData={userData}
            />
          </ReportShell>
        )}

        {activeView === 'SALES_REVIEW' && (
          <ReportShell
            title="SALES REVIEW REPORT"
            icon="🔎"
            description="Sales review pack — period-over-period performance, agent/branch/region drill-downs, and qualification call-outs."
          >
            <SalesReviewReport userData={userData} />
          </ReportShell>
        )}

        {activeView === 'GAP_ANALYSIS' && (
          <ReportShell
            title="GAP ANALYSIS REPORTS"
            icon="📋"
            description="Planned vs actual Sales Reps for the period — compare roster counts, identify gaps, and capture TL feedback."
          >
            <GapAnalysis />
          </ReportShell>
        )}

        {activeView === 'KPI_ANALYSIS' && (
          <ReportShell
            title="KPI ANALYSIS REPORT"
            icon="🎯"
            description="KPI dashboard per product (CS / LBF / SME) — cluster targets, achievement rates, CRM compliance, and PAR30."
          >
            <KpiAnalysisReport />
          </ReportShell>
        )}

        {activeView === 'PENETRATION_ANALYSIS' && (
          <ReportShell
            title="SOCIAL MEDIA ANALYSIS"
            icon="📡"
            description="Live call-centre stats from the LBF/SME and CS Google Sheets — by platform, by agent, by disposition."
          >
            <SocialMediaAnalysis autoGenerate />
          </ReportShell>
        )}

        {activeView === 'SETTLEMENTS_ANALYSIS' && (
          <ReportShell
            title="SETTLEMENTS ANALYSIS"
            icon="💳"
            description="Settlements coverage — paid vs outstanding, by branch and product, with version-history audit."
          >
            <SettlementsAnalysis />
          </ReportShell>
        )}

        {activeView === 'TEMPORARY_REPORTS' && (
          <ReportShell
            title="TEMPORARY REPORTS"
            icon="🗂"
            description="Ad-hoc analyses staged for review — pulled from current data and ready for one-off distribution."
          >
            <TemporaryReports />
          </ReportShell>
        )}

        {activeView === 'MARKETING' && (
          <ReportShell
            title="MARKETING ANALYSIS"
            icon="📣"
            description="Digital-sales and CS cluster marketing rollup — lead origin, conversion funnel, and per-channel ROI."
          >
            <Marketing />
          </ReportShell>
        )}

        {/* RsmScoreCard is currently a static placeholder — no need to gate. */}
        {activeView === 'RSM_SCORE_CARD' && <RsmScoreCard />}
      </div>
    </div>
  );
};

export default DepartmentalDashboard;
