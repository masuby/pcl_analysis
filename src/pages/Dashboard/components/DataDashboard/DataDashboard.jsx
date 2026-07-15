import { useState } from 'react';
// Reuse the Departmental dashboard's toggle-bar styling so DATA looks identical.
import '../DepartmentalDashboard/DepartmentalDashboard.css';
import './DataDashboard.css';
import AISalesManager from './AISalesManager';

// Data sources + the AI Sales Manager agent tab.
const DATA_VIEWS = [
  { key: 'MAMBU',  label: 'MAMBU DATA',        icon: '🏦' },
  { key: 'CRM',    label: 'CRM DATA',          icon: '🗂' },
  { key: 'SOCIAL', label: 'SOCIAL MEDIA DATA', icon: '📡' },
  { key: 'AISM',   label: 'AI SALES MANAGER',  icon: '🤖' },
];

const ComingSoon = ({ label, icon }) => (
  <div className="data-coming-soon">
    <div className="data-coming-soon-icon">{icon}</div>
    <h2 className="data-coming-soon-title">{label}</h2>
    <p className="data-coming-soon-text">Coming soon</p>
  </div>
);

const DataDashboard = () => {
  const [activeView, setActiveView] = useState('MAMBU');
  const current = DATA_VIEWS.find((v) => v.key === activeView) || DATA_VIEWS[0];

  return (
    <div className="dept-dashboard-view">
      {/* Tab bar — same look/behaviour as DepartmentalDashboard */}
      <div className="dept-toggle-wrapper">
        <div className="dept-toggle-buttons">
          {DATA_VIEWS.map((v) => (
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

      <div className="dept-content">
        {activeView === 'AISM'
          ? <AISalesManager />
          : <ComingSoon label={current.label} icon={current.icon} />}
      </div>
    </div>
  );
};

export default DataDashboard;
