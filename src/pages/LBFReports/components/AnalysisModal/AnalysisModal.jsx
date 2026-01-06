import React from 'react';
import './AnalysisModal.css';

const AnalysisModal = ({ report, onClose, showToast }) => {
  if (!report) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="analysis-modal-simple" onClick={e => e.stopPropagation()}>
        <div className="modal-header-simple">
          <div className="header-content">
            <h2>Analysis for {report.type}</h2>
            <p className="report-info">{report.title}</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-content-simple">
          <div className="placeholder-analysis">
            <div className="placeholder-icon">📊</div>
            <h3>Analysis Coming Soon</h3>
            <p>Detailed analysis for {report.type.toLowerCase()} reports will be implemented in a future update.</p>
            <p className="placeholder-details">
              This section will provide insights, trends, and actionable recommendations based on your Excel data.
            </p>
          </div>
        </div>
        
        <div className="modal-footer-simple">
          <button className="footer-button close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnalysisModal;






