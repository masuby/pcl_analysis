import React, { useRef } from 'react';
import './SocialMediaAnalysis.css';

const SocialMediaAnalysis = () => {
  const uploadXlsxRef = useRef(null);
  const uploadClientRef = useRef(null);

  return (
    <div className="pen-page">
      <div className="pen-header-bar">
        <h2 className="pen-header-title">SOCIAL MEDIA ANALYSIS</h2>
        <div className="pen-header-controls">
          <button type="button" className="pen-btn">
            <span>✉</span>
            Send Email
          </button>
          <button type="button" className="pen-btn">
            <span>📥</span>
            Download XLSX
          </button>
          <button type="button" className="pen-btn" onClick={() => uploadXlsxRef.current?.click()}>
            <span>📤</span>
            Upload XLSX
          </button>
          <button type="button" className="pen-btn pen-btn-upload-client" onClick={() => uploadClientRef.current?.click()}>
            <span>📁</span>
            Upload Client File
          </button>
          <input ref={uploadXlsxRef} type="file" accept=".xlsx,.xls" className="pen-hidden-input" />
          <input ref={uploadClientRef} type="file" accept=".xlsx,.xls,.csv" className="pen-hidden-input" />
        </div>
      </div>

      <div className="pen-coming-soon-container">
        <div className="pen-coming-soon-content">
          <div className="pen-coming-soon-icon">📊</div>
          <h3 className="pen-coming-soon-title">SOCIAL MEDIA ANALYSIS</h3>
          <p className="pen-coming-soon-message">Coming Soon</p>
          <p className="pen-coming-soon-description">
            Social Media Analysis will provide insights into social media performance, engagement trends,
            and audience growth opportunities.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SocialMediaAnalysis;
