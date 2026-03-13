import React, { useState, useEffect, useRef, useMemo } from 'react';
import './ScoreCardReports.css';
import ManagementSummary from './components/ManagementSummary/ManagementSummary';
import SalesComplianceSummary from './components/SalesComplianceSummary/SalesComplianceSummary';
import ProductionSalesTracker from './components/ProductionSalesTracker/ProductionSalesTracker';
import LeadsMarketingTracker from './components/LeadsMarketingTracker/LeadsMarketingTracker';
import ProductSalesTracker from './components/ProductSalesTracker/ProductSalesTracker';
import CallCenterPerformanceTracker from './components/CallCenterPerformanceTracker/CallCenterPerformanceTracker';
import { useManagementData } from '../../../ManagementDashboard/hooks/useManagementData';
import { exportMultipleSheetsWithStyles, buildWorkbookBuffer } from '../../utils/excelExportStyled';
import { sendScoreCardEmail } from '../../utils/emailScoreCard';
import { buildScoreCardEmailHTML } from '../../utils/emailTemplate';

const RECIPIENTS_STORAGE_KEY = 'scorecard_email_recipients';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const getOrdinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const formatDateForSubject = (d) => {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  const day = d.getDate();
  const ord = day === 1 || day === 21 || day === 31 ? day + 'ST' : day === 2 || day === 22 ? day + 'ND' : day === 3 || day === 23 ? day + 'RD' : day + 'TH';
  return `${ord} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

const formatDateForFile = (d) => {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
};

const formatDateForHeader = (d) => {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  return `${getOrdinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

const ScoreCardReports = ({ reports, selectedDepartment, userData }) => {
  const managementSummaryRef = useRef(null);
  const salesComplianceRef = useRef(null);
  const productionRef = useRef(null);
  const leadsRef = useRef(null);
  const productRef = useRef(null);
  const callCenterRef = useRef(null);
  const { parsedReports: managementReports } = useManagementData();

  const [mode, setMode] = useState('WEEKLY'); // 'WEEKLY' or 'MONTHLY'

  const { dateFrom, dateTo, dateFromStr, dateToStr, dateFromFile, dateToFile, subjectDateStr, headerDateStr } = useMemo(() => {
    const now = new Date();
    let from = null;
    let to = null;
    if (mode === 'WEEKLY') {
      if (managementReports && managementReports.length > 0) {
        const sorted = [...managementReports].sort((a, b) => {
          const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
          const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
          return dateB - dateA;
        });
        const latestDate = sorted[0].date ? new Date(sorted[0].date) : new Date(sorted[0].createdAt);
        const dayOfWeek = latestDate.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(latestDate);
        monday.setDate(latestDate.getDate() + diff);
        monday.setHours(0, 0, 0, 0);
        from = monday;
        to = new Date(monday);
        to.setDate(monday.getDate() + 5);
        to.setHours(23, 59, 59, 999);
      } else {
        const dayOfWeek = now.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        from = new Date(now);
        from.setDate(now.getDate() + diff);
        from.setHours(0, 0, 0, 0);
        to = new Date(from);
        to.setDate(from.getDate() + 5);
        to.setHours(23, 59, 59, 999);
      }
    } else {
      if (managementReports && managementReports.length > 0) {
        const sorted = [...managementReports].sort((a, b) => {
          const dateA = a.date ? new Date(a.date) : new Date(a.createdAt);
          const dateB = b.date ? new Date(b.date) : new Date(b.createdAt);
          return dateB - dateA;
        });
        const latestDate = sorted[0].date ? new Date(sorted[0].date) : new Date(sorted[0].createdAt);
        from = new Date(latestDate.getFullYear(), latestDate.getMonth(), 1);
        to = new Date(latestDate.getFullYear(), latestDate.getMonth() + 1, 0);
        to.setHours(23, 59, 59, 999);
      } else {
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        to.setHours(23, 59, 59, 999);
      }
    }
    const fromStr = formatDateForSubject(from);
    const toStr = formatDateForSubject(to);
    return {
      dateFrom: from,
      dateTo: to,
      dateFromStr: fromStr,
      dateToStr: toStr,
      dateFromFile: formatDateForFile(from),
      dateToFile: formatDateForFile(to),
      subjectDateStr: fromStr && toStr ? `FROM ${fromStr} TO ${toStr}` : formatDateForSubject(now),
      headerDateStr: from && to ? `From ${formatDateForHeader(from)} to ${formatDateForHeader(to)}` : formatDateForHeader(now)
    };
  }, [mode, managementReports]);
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
  const [pasteBox, setPasteBox] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendProgress, setSendProgress] = useState(null); // { email, status: 'pending'|'sending'|'success'|'failed', error? }[]
  const [showPreview, setShowPreview] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [copiedList, setCopiedList] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);

  const copyRecipientList = () => {
    if (recipients.length === 0) return;
    const list = recipients.join('\n');
    navigator.clipboard.writeText(list).then(() => {
      setCopiedList(true);
      setTimeout(() => setCopiedList(false), 2000);
    }).catch(() => {});
  };

  const copyMessageBody = () => {
    const html = emailBody || buildScoreCardEmailHTML(mode, headerDateStr, mode === 'WEEKLY');
    const div = document.createElement('div');
    div.innerHTML = html;
    const text = (div.innerText || div.textContent || '').trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedBody(true);
      setTimeout(() => setCopiedBody(false), 2000);
    }).catch(() => {});
  };

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

  const parseEmailsFromText = (text) => {
    const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return [...new Set(text.split(/\s*[\n,;\t]\s*/).map((s) => s.trim().toLowerCase()).filter((s) => emailLike.test(s)))];
  };

  const pasteEmails = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const toAdd = parseEmailsFromText(text).filter((e) => !recipients.includes(e));
      if (toAdd.length === 0) {
        setSendError(recipients.length === 0 ? 'No valid emails in clipboard. Paste lines or comma-separated addresses.' : 'No new valid emails to add.');
        return;
      }
      setRecipients((prev) => [...prev, ...toAdd]);
      setSendError('');
    } catch {
      setSendError('Clipboard access denied. Paste into the box below and click "Add pasted".');
    }
  };

  const addPasteBoxEmails = () => {
    const toAdd = parseEmailsFromText(pasteBox).filter((e) => !recipients.includes(e));
    if (toAdd.length === 0) {
      setSendError(pasteBox.trim() ? 'No valid emails in the box.' : 'Paste emails above (one per line or comma/semicolon separated), then click Add pasted.');
      return;
    }
    setRecipients((prev) => [...prev, ...toAdd]);
    setPasteBox('');
    setSendError('');
  };

  // Generate email preview
  const generatePreview = () => {
    const reportType = mode === 'WEEKLY' ? 'WEEKLY' : 'MONTHLY';
    const subject = `HOD SCORE CARD ${reportType} REPORT - ${subjectDateStr}`;
    const html = buildScoreCardEmailHTML(mode, headerDateStr, mode === 'WEEKLY');
    setEmailSubject(subject);
    setEmailBody(html);
    setShowPreview(true);
  };

  const buildSheetsForExport = () => {
    const sheetNames = [
      'Management Summary',
      'Sales Compliance Summary',
      'Production Sales Tracker',
      'Leads Marketing Tracker',
      'Product Sales Tracker (MTD)',
      'Call Center Performance'
    ];
    const refs = [managementSummaryRef, salesComplianceRef, productionRef, leadsRef, productRef, callCenterRef];
    const allSheets = [];
    refs.forEach((sectionRef, idx) => {
      const sheets = sectionRef.current?.getExportSheets?.();
      const sheet = Array.isArray(sheets) && sheets.length > 0 ? sheets[0] : null;
      const hasActualData = sheet?.tables?.length > 0 && sheet.tables.some((t) => t.data && t.data.length > 0);
      if (hasActualData) {
        allSheets.push(sheet);
      } else {
        allSheets.push({
          name: sheetNames[idx],
          tables: [{ data: [{ Message: 'No data available for this section.' }], headerColors: { Message: '#4472C4' }, colWidths: [40] }],
          freeze: { row: 2, col: 0 }
        });
      }
    });
    return allSheets;
  };

  const handleSendEmail = async () => {
    if (recipients.length === 0) {
      setSendError('Add at least one recipient.');
      return;
    }
    setSending(true);
    setSendError('');
    setSendProgress(recipients.map((email) => ({ email, status: 'sending', error: null })));

    const reportType = mode === 'WEEKLY' ? 'WEEKLY' : 'MONTHLY';
    const defaultSubject = `HOD SCORE CARD ${reportType} REPORT - ${subjectDateStr}`;
    const subject = emailSubject || defaultSubject;
    const htmlBody = emailBody || buildScoreCardEmailHTML(mode, headerDateStr, mode === 'WEEKLY');

    let attachmentBase64 = '';
    let attachmentName = '';
    if (mode === 'WEEKLY') {
      const sheets = buildSheetsForExport();
      const fileName = `HOD_SCORE_CARD_WEEKLY_FROM_${dateFromFile}_TO_${dateToFile}.xlsx`;
      const result = await buildWorkbookBuffer(sheets, fileName);
      if (result?.buffer) {
        const binary = Array.from(result.buffer)
          .map((b) => String.fromCharCode(b))
          .join('');
        attachmentBase64 = btoa(binary);
        attachmentName = result.fileName;
      }
    }

    const emailResult = await sendScoreCardEmail(recipients, subject, htmlBody, {
      mode,
      attachmentBase64,
      attachmentName
    });

    const status = emailResult.success ? 'success' : 'failed';
    const error = emailResult.success ? null : (emailResult.error || 'Failed to send');
    setSendProgress((prev) => prev.map((p) => ({ ...p, status, error })));
    setSending(false);
  };

  const handleExportAll = async () => {
    const sheetNames = [
      'Management Summary',
      'Sales Compliance Summary',
      'Production Sales Tracker',
      'Leads Marketing Tracker',
      'Product Sales Tracker (MTD)',
      'Call Center Performance'
    ];
    const refs = [managementSummaryRef, salesComplianceRef, productionRef, leadsRef, productRef, callCenterRef];
    const allSheets = [];
    refs.forEach((sectionRef, idx) => {
      const sheets = sectionRef.current?.getExportSheets?.();
      const sheet = Array.isArray(sheets) && sheets.length > 0 ? sheets[0] : null;
      const hasActualData = sheet?.tables?.length > 0 && sheet.tables.some((t) => t.data && t.data.length > 0);
      if (hasActualData) {
        allSheets.push(sheet);
      } else {
        allSheets.push({
          name: sheetNames[idx],
          tables: [{ data: [{ Message: 'No data available for this section.' }], headerColors: { Message: '#4472C4' }, colWidths: [40] }],
          freeze: { row: 2, col: 0 }
        });
      }
    });
    const fileName = mode === 'WEEKLY'
      ? `HOD_SCORE_CARD_WEEKLY_FROM_${dateFromFile}_TO_${dateToFile}.xlsx`
      : `HOD_SCORE_CARD_MONTHLY_FROM_${dateFromFile}_TO_${dateToFile}.xlsx`;
    await exportMultipleSheetsWithStyles(allSheets, fileName);
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
        <ManagementSummary ref={managementSummaryRef} mode={mode} userData={userData} />
        
        <div className="scorecard-divider"></div>
        
        <SalesComplianceSummary ref={salesComplianceRef} mode={mode} userData={userData} />
        
        <div className="scorecard-divider"></div>
        
        <ProductionSalesTracker ref={productionRef} mode={mode} userData={userData} />
        
        <div className="scorecard-divider"></div>
        
        <LeadsMarketingTracker ref={leadsRef} mode={mode} userData={userData} />
        
        <div className="scorecard-divider"></div>
        
        <ProductSalesTracker ref={productRef} mode={mode} userData={userData} targetMonth={dateFrom ? `${dateFrom.getFullYear()}-${String(dateFrom.getMonth() + 1).padStart(2, '0')}` : null} />
        
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
            Download ({mode === 'WEEKLY' ? 'Weekly' : 'Monthly'})
          </button>
        </div>
      </div>

      {/* Email modal */}
      {showEmailModal && (
        <div className="scorecard-modal-overlay" onClick={() => { if (!sending) { setShowEmailModal(false); setSendProgress(null); } }}>
          <div className={`scorecard-modal ${showPreview ? 'scorecard-modal--wide' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="scorecard-modal-header">
              <h3 className="scorecard-modal-title">Send Score Card Report by Email</h3>
              <button
                type="button"
                className="scorecard-modal-close"
                onClick={() => { if (!sending) { setShowEmailModal(false); setShowPreview(false); setSendProgress(null); } }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Progress popup: sticky banner when sending or when result is shown */}
            {sendProgress && sendProgress.length > 0 && (
              <div className="scorecard-progress-popup">
                <h4 className="scorecard-send-progress-title">
                  {sending ? 'Sending email to all recipients…' : 'Send result'}
                </h4>
                <ul className="scorecard-send-progress-list">
                  {sendProgress.map(({ email, status, error }) => (
                    <li key={email} className={`scorecard-send-progress-item scorecard-send-progress-item--${status}`}>
                      <span className="scorecard-send-progress-email">{email}</span>
                      <span className="scorecard-send-progress-status">
                        {status === 'sending' && <span className="scorecard-send-progress-spinner" aria-hidden>⏳</span>}
                        {status === 'success' && <span className="scorecard-send-progress-ok" title="Received">✓</span>}
                        {status === 'failed' && <span className="scorecard-send-progress-fail" title={error || 'Failed'}>✗</span>}
                      </span>
                      {status === 'failed' && error && (
                        <span className="scorecard-send-progress-error">{error}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
                <button
                  type="button"
                  className="scorecard-copy-list-btn scorecard-paste-btn"
                  onClick={pasteEmails}
                  disabled={sending}
                  title="Paste emails from clipboard (one per line or comma/semicolon separated)"
                >
                  Paste
                </button>
              </div>
              <div className="scorecard-paste-box-wrap">
                <textarea
                  className="scorecard-paste-box"
                  placeholder="Or paste many emails here (one per line or comma/semicolon separated)"
                  value={pasteBox}
                  onChange={(e) => setPasteBox(e.target.value)}
                  rows={3}
                />
                <button type="button" className="scorecard-copy-list-btn" onClick={addPasteBoxEmails}>
                  Add pasted
                </button>
              </div>
              <div className="scorecard-recipient-list-actions">
                <button
                  type="button"
                  className="scorecard-copy-list-btn"
                  onClick={copyRecipientList}
                  disabled={sending || recipients.length === 0}
                  title="Copy all emails (one per line) to paste manually"
                >
                  {copiedList ? '✓ Copied!' : 'Copy email list'}
                </button>
                <button
                  type="button"
                  className="scorecard-copy-list-btn scorecard-copy-body-btn"
                  onClick={copyMessageBody}
                  disabled={sending}
                  title="Copy email message (plain text) to paste into your email"
                >
                  {copiedBody ? '✓ Copied!' : 'Copy message'}
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
                <p className="scorecard-modal-empty">No recipients yet. Add one above or paste many emails in the box and click Add pasted.</p>
              )}

              {/* Email Preview Section */}
              <div className="scorecard-preview-section">
                <button
                  type="button"
                  className="scorecard-preview-toggle"
                  onClick={() => showPreview ? setShowPreview(false) : generatePreview()}
                >
                  {showPreview ? '▼ Hide Email Preview' : '▶ Preview Email'}
                </button>
                {showPreview && (
                  <div className="scorecard-preview-container">
                    <div className="scorecard-preview-subject">
                      <label>Subject:</label>
                      <input
                        type="text"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        className="scorecard-subject-input"
                      />
                    </div>
                    <div className="scorecard-preview-body">
                      <label>Email Body:</label>
                      <div
                        className="scorecard-preview-html"
                        dangerouslySetInnerHTML={{ __html: emailBody }}
                      />
                    </div>
                    {mode === 'WEEKLY' && (
                      <p className="scorecard-preview-attachment">
                        📎 Attachment: HOD_SCORE_CARD_WEEKLY_FROM_{dateFromFile}_TO_{dateToFile}.xlsx
                      </p>
                    )}
                  </div>
                )}
              </div>

              {sendError && <p className="scorecard-modal-error">{sendError}</p>}
            </div>
            <div className="scorecard-modal-footer">
              <button
                type="button"
                className="scorecard-modal-cancel"
                onClick={() => { !sending && setShowEmailModal(false); setShowPreview(false); setSendProgress(null); }}
              >
                {sendProgress && !sending ? 'Close' : 'Cancel'}
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
