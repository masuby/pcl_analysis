import React from 'react';
import './RsmScoreCard.css';

const PLANNED_SECTIONS = [
  { icon: '📊', title: 'RSM Performance Overview', desc: 'Individual RSM target vs disbursement, achievement %, and ranking across the region.' },
  { icon: '🏆', title: 'League Table', desc: 'Ranked scorecard of all Regional Sales Managers by overall performance score.' },
  { icon: '📈', title: 'Trend Analysis', desc: 'Month-over-month and year-over-year performance trends per RSM.' },
  { icon: '👥', title: 'Team Management', desc: 'Headcount, active reps, and team productivity metrics under each RSM.' },
  { icon: '📋', title: 'KPI Compliance', desc: 'Compliance tracking across key metrics: PAR30, portfolio, CRM activity, and data consent.' },
];

const RsmScoreCard = () => (
  <div className="rsm-root">
    <div className="rsm-hero">
      <div className="rsm-hero-badge">Coming Soon</div>
      <div className="rsm-hero-icon">🏅</div>
      <h2 className="rsm-hero-title">RSM SCORE CARD</h2>
      <p className="rsm-hero-subtitle">Regional Sales Manager Performance Dashboard</p>
      <p className="rsm-hero-desc">
        A comprehensive weekly and monthly scorecard for all Regional Sales Managers —
        covering disbursement achievement, team performance, portfolio health, and KPI compliance.
      </p>
    </div>

    <div className="rsm-sections-grid">
      {PLANNED_SECTIONS.map((s, i) => (
        <div key={i} className="rsm-section-card">
          <div className="rsm-section-icon">{s.icon}</div>
          <div className="rsm-section-body">
            <h4 className="rsm-section-title">{s.title}</h4>
            <p className="rsm-section-desc">{s.desc}</p>
          </div>
        </div>
      ))}
    </div>

    <div className="rsm-footer-note">
      This module will follow the same structure as the HOD Score Card, with weekly and monthly modes,
      Excel download, and email distribution — tailored for RSM-level reporting.
    </div>
  </div>
);

export default RsmScoreCard;
