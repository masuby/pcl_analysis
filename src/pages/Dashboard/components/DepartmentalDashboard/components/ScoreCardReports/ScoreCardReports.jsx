import React, { useState, useEffect, useRef } from 'react';
import './ScoreCardReports.css';
import SalesComplianceSummary from './components/SalesComplianceSummary/SalesComplianceSummary';
import ProductionSalesTracker from './components/ProductionSalesTracker/ProductionSalesTracker';
import LeadsMarketingTracker from './components/LeadsMarketingTracker/LeadsMarketingTracker';
import ProductSalesTracker from './components/ProductSalesTracker/ProductSalesTracker';
import CallCenterPerformanceTracker from './components/CallCenterPerformanceTracker/CallCenterPerformanceTracker';
import { exportMultipleSheetsWithStyles } from '../../utils/excelExportStyled';
import { sendScoreCardEmail } from '../../utils/emailScoreCard';

const RECIPIENTS_STORAGE_KEY = 'scorecard_email_recipients';

const ScoreCardReports = ({ reports, selectedDepartment, userData }) => {
  const salesComplianceRef = useRef(null);
  const productionRef = useRef(null);
  const leadsRef = useRef(null);
  const productRef = useRef(null);
  const callCenterRef = useRef(null);

  const [mode, setMode] = useState('WEEKLY'); // 'WEEKLY' or 'MONTHLY'
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [recipients, setRecipients] = useState(() => {
    try {
      const saved = localStorage.getItem(RECIPIENTS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [newRecipient, setNewRecipient] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  useEffect(() => {
    try {
      localStorage.setItem(RECIPIENTS_STORAGE_KEY, JSON.stringify(recipients));
    } catch (e) {
      console.warn('Could not save recipients', e);
    }
  }, [recipients]);

  const addRecipient = () => {
    const email = (newRecipient || '').trim().toLowerCase();
    if (!email) return;
    if (recipients.includes(email)) return;
    setRecipients((prev) => [...prev, email]);
    setNewRecipient('');
  };

  const removeRecipient = (email) => {
    setRecipients((prev) => prev.filter((r) => r !== email));
  };

  const handleSendEmail = async () => {
    if (recipients.length === 0) {
      setSendError('Add at least one recipient.');
      return;
    }
    setSending(true);
    setSendError('');
    const subject = `HOD Score Card Report (${mode}) - ${new Date().toISOString().split('T')[0]}`;
    const result = await sendScoreCardEmail(recipients, subject, '');
    setSending(false);
    if (result.success) {
      setShowEmailModal(false);
    } else {
      setSendError(result.error || 'Failed to send');
    }
  };

  const handleExportAll = () => {
    const allSheets = [];
    [salesComplianceRef, productionRef, leadsRef, productRef, callCenterRef].forEach((sectionRef) => {
      const sheets = sectionRef.current?.getExportSheets?.();
      if (Array.isArray(sheets) && sheets.length > 0) {
        allSheets.push(...sheets);
      }
    });
    if (allSheets.length > 0) {
      const fileName = mode === 'WEEKLY'
        ? `HOD_ScoreCard_Weekly_${new Date().toISOString().split('T')[0]}.xlsx`
        : `HOD_ScoreCard_Monthly_${new Date().toISOString().split('T')[0]}.xlsx`;
      exportMultipleSheetsWithStyles(allSheets, fileName);
    }
  };

  return (
    <div className="scorecard-container">
      {/* Mode Toggle */}
      <div className="scorecard-header">
        <h2 className="scorecard-main-title">HOD SCORE CARD</h2>
        <div className="scorecard-mode-toggle">
          <button
            className={`scorecard-mode-btn ${mode === 'WEEKLY' ? 'scorecard-mode-btn--active' : ''}`}
            onClick={() => setMode('WEEKLY')}
          >
            Weekly Mode
          </button>
          <button
            className={`scorecard-mode-btn ${mode === 'MONTHLY' ? 'scorecard-mode-btn--active' : ''}`}
            onClick={() => setMode('MONTHLY')}
          >
            Monthly Mode
          </button>
        </div>
      </div>

      {/* Sections */}
      <div className="scorecard-sections">
        <SalesComplianceSummary ref={salesComplianceRef} mode={mode} userData={userData} />
        
        <div className="scorecard-divider"></div>
        
        <ProductionSalesTracker ref={productionRef} mode={mode} userData={userData} />
        
        <div className="scorecard-divider"></div>
        
        <LeadsMarketingTracker ref={leadsRef} mode={mode} userData={userData} />
        
        <div className="scorecard-divider"></div>
        
        <ProductSalesTracker ref={productRef} mode={mode} userData={userData} />
        
        <div className="scorecard-divider"></div>
        
        <CallCenterPerformanceTracker ref={callCenterRef} mode={mode} userData={userData} />
      </div>

      {/* Footer: Send Email (left) + Download Excel (center) */}
      <div className="scorecard-footer">
        <button
          type="button"
          className="scorecard-email-btn"
          onClick={() => setShowEmailModal(true)}
          title="Send report by email"
        >
          <span className="scorecard-email-icon">✉</span>
          Send Email
        </button>
        <div className="scorecard-export-container">
          <button className="scorecard-export-btn" onClick={handleExportAll}>
            <span className="scorecard-export-icon">📥</span>
            Download Complete Excel Report ({mode === 'WEEKLY' ? 'Weekly' : 'Monthly'})
          </button>
        </div>
      </div>

      {/* Email modal */}
      {showEmailModal && (
        <div className="scorecard-modal-overlay" onClick={() => !sending && setShowEmailModal(false)}>
          <div className="scorecard-modal" onClick={(e) => e.stopPropagation()}>
            <div className="scorecard-modal-header">
              <h3 className="scorecard-modal-title">Send Score Card Report by Email</h3>
              <button
                type="button"
                className="scorecard-modal-close"
                onClick={() => !sending && setShowEmailModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="scorecard-modal-body">
              <p className="scorecard-modal-hint">Recipients (saved for next time):</p>
              <div className="scorecard-recipients-input">
                <input
                  type="email"
                  placeholder="Enter email address"
                  value={newRecipient}
                  onChange={(e) => setNewRecipient(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
                  className="scorecard-recipient-input"
                />
                <button type="button" className="scorecard-add-recipient-btn" onClick={addRecipient}>
                  Add
                </button>
              </div>
              <ul className="scorecard-recipients-list">
                {recipients.map((email) => (
                  <li key={email} className="scorecard-recipient-item">
                    <span className="scorecard-recipient-email">{email}</span>
                    <button
                      type="button"
                      className="scorecard-remove-recipient"
                      onClick={() => removeRecipient(email)}
                      title="Remove"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              {recipients.length === 0 && (
                <p className="scorecard-modal-empty">No recipients yet. Add one above.</p>
              )}
              {sendError && <p className="scorecard-modal-error">{sendError}</p>}
            </div>
            <div className="scorecard-modal-footer">
              <button
                type="button"
                className="scorecard-modal-cancel"
                onClick={() => !sending && setShowEmailModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="scorecard-modal-send"
                onClick={handleSendEmail}
                disabled={sending || recipients.length === 0}
              >
                {sending ? 'Sending…' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScoreCardReports;
