import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';
import { buildCrmWorkbookData } from './utils/crmReportBuilder';
import { buildTemporaryReportEmailHTML, sendTemporaryReportEmail } from './utils/emailTemporaryReport';
import './TemporaryReports.css';

const RECIPIENTS_STORAGE_KEY = 'temporary_reports_email_recipients';
const REPORT_CACHE_KEY = 'temporary_reports_crm_report_cache_v1';

const buildWorkbookFromData = (built) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.workbook.Summary, 'Summary');
  XLSX.utils.book_append_sheet(wb, built.workbook.CS, 'CS');
  XLSX.utils.book_append_sheet(wb, built.workbook.LBF, 'LBF');
  XLSX.utils.book_append_sheet(wb, built.workbook.SME, 'SME');
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.Sheets = [
    { name: 'Summary', TabColor: { rgb: 'FF334155' } },
    { name: 'CS', TabColor: { rgb: 'FF2563EB' } },
    { name: 'LBF', TabColor: { rgb: 'FF16A34A' } },
    { name: 'SME', TabColor: { rgb: 'FFA855F7' } },
  ];
  return wb;
};

const TemporaryReports = () => {
  const [activeReport, setActiveReport] = useState('CRM_REPORT');
  const [isBuilding, setIsBuilding] = useState(false);
  const [lastBuiltAt, setLastBuiltAt] = useState(null);
  const [buildError, setBuildError] = useState('');
  const [reportData, setReportData] = useState(null);
  const [buildProgress, setBuildProgress] = useState({
    phase: 'idle',
    value: 0,
    message: 'Waiting to build report...',
  });
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [recipients, setRecipients] = useState(() => {
    try {
      const raw = localStorage.getItem(RECIPIENTS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [newRecipient, setNewRecipient] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [copyEmailsFeedback, setCopyEmailsFeedback] = useState(false);
  const [pasteBox, setPasteBox] = useState('');

  const nowLabel = useMemo(() => {
    const date = new Date('2026-04-11');
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
  }, []);

  const fileName = useMemo(() => {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `CRM_Report_2026_STYLED_${date}_${hh}${mm}${ss}.xlsx`;
  }, []);

  const persistRecipients = (next) => {
    setRecipients(next);
    try {
      localStorage.setItem(RECIPIENTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // no-op
    }
  };

  const persistReportCache = (built) => {
    if (!built) return;
    try {
      localStorage.setItem(
        REPORT_CACHE_KEY,
        JSON.stringify({
          createdAt: new Date().toISOString(),
          data: {
            uiSummaryRows: built.uiSummaryRows || [],
            uiTotals: built.uiTotals || {},
            meta: built.meta || {},
          },
        })
      );
    } catch {
      // no-op
    }
  };

  const restoreReportCache = () => {
    try {
      const raw = localStorage.getItem(REPORT_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const uiSummaryRows = parsed?.data?.uiSummaryRows || [];
      if (!uiSummaryRows.length) return;
      setReportData((prev) => (
        prev || {
          uiSummaryRows,
          uiTotals: parsed?.data?.uiTotals || {},
          meta: parsed?.data?.meta || {},
        }
      ));
      if (parsed?.createdAt) setLastBuiltAt(new Date(parsed.createdAt));
    } catch {
      // no-op
    }
  };

  const ensureReportData = async ({ force = false } = {}) => {
    if (!force && reportData?.workbook) return reportData;
    setIsBuilding(true);
    setBuildError('');
    setBuildProgress({ phase: 'starting', value: 0, message: 'Preparing report...' });
    try {
      const built = await buildCrmWorkbookData({
        onProgress: (state) => {
          setBuildProgress({
            phase: state.phase || 'loading',
            value: Number(state.value || 0),
            message: state.message || 'Building report...',
          });
        },
      });
      setReportData(built);
      setLastBuiltAt(new Date());
      persistReportCache(built);
      return built;
    } catch (err) {
      const message = err?.message || 'Failed to build CRM report';
      setBuildError(message);
      setBuildProgress({ phase: 'error', value: 0, message });
      return null;
    } finally {
      setIsBuilding(false);
    }
  };

  useEffect(() => {
    restoreReportCache();
    ensureReportData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerDownload = async () => {
    const built = await ensureReportData();
    if (!built) return;
    const wb = buildWorkbookFromData(built);
    XLSX.writeFile(wb, fileName, { bookType: 'xlsx', cellStyles: true });
  };

  const addRecipient = () => {
    const email = (newRecipient || '').trim().toLowerCase();
    if (!email || recipients.includes(email)) return;
    persistRecipients([...recipients, email]);
    setNewRecipient('');
  };

  const removeRecipient = (email) => {
    persistRecipients(recipients.filter((item) => item !== email));
  };

  const parseEmailsFromText = (text) => {
    const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return [...new Set(
      String(text || '')
        .split(/\s*[\n,;\t]\s*/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => emailLike.test(s))
    )];
  };

  const copyAllEmails = () => {
    if (recipients.length === 0) return;
    const text = recipients.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopyEmailsFeedback(true);
      setTimeout(() => setCopyEmailsFeedback(false), 2000);
    }).catch(() => setSendError('Could not copy to clipboard'));
  };

  const pasteEmails = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const toAdd = parseEmailsFromText(text).filter((e) => !recipients.includes(e));
      if (toAdd.length === 0) {
        setSendError('No new valid emails found in clipboard.');
        return;
      }
      persistRecipients([...recipients, ...toAdd]);
      setSendError('');
    } catch {
      setSendError('Clipboard denied. Paste into the box below and click Add pasted.');
    }
  };

  const addPasteBoxEmails = () => {
    const toAdd = parseEmailsFromText(pasteBox).filter((e) => !recipients.includes(e));
    if (toAdd.length === 0) {
      setSendError('No valid emails in the paste box.');
      return;
    }
    persistRecipients([...recipients, ...toAdd]);
    setPasteBox('');
    setSendError('');
  };

  const handleSendEmail = async () => {
    if (!recipients.length) {
      setSendError('Add at least one recipient.');
      return;
    }
    const built = await ensureReportData();
    if (!built) return;

    const wb = buildWorkbookFromData(built);
    const ab = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    const binary = Array.from(new Uint8Array(ab)).map((b) => String.fromCharCode(b)).join('');

    setSending(true);
    setSendError('');
    const htmlBody = buildTemporaryReportEmailHTML(nowLabel, built.uiSummaryRows || [], built.uiTotals || {});
    const result = await sendTemporaryReportEmail(
      recipients,
      'TEMPORARY CRM REPORT (2026) - SUMMARY + CS/LBF/SME',
      htmlBody,
      { attachmentBase64: btoa(binary), attachmentName: fileName }
    );
    setSending(false);
    if (!result.success) {
      setSendError(result.error || 'Failed to send');
      return;
    }
    setShowEmailModal(false);
  };

  const uiRows = reportData?.uiSummaryRows || [];
  const uiTotals = reportData?.uiTotals || {};
  const reportMeta = reportData?.meta || {};
  const grandTotalLeads = ['CS', 'LBF', 'SME'].reduce((sum, dept) => {
    const row = uiTotals[dept] || {};
    return sum + Number(row.accepted || 0) + Number(row.notProvided || 0) + Number(row.rejected || 0);
  }, 0);

  return (
    <div className="tmp-reports-container">
      <div className="tmp-reports-header-bar">
        <h1 className="tmp-reports-title">CRM REPORT FOR {nowLabel}</h1>
        <div className="tmp-reports-header-controls">
          <button
            type="button"
            className="tmp-reports-btn tmp-reports-btn-refresh"
            onClick={() => ensureReportData({ force: true })}
            disabled={isBuilding}
          >
            <span className="tmp-reports-btn-icon">↻</span>
            Refresh Data
          </button>
          <button
            type="button"
            className="tmp-reports-btn tmp-reports-btn-email"
            onClick={() => setShowEmailModal(true)}
            disabled={isBuilding}
          >
            <span className="tmp-reports-btn-icon">✉</span>
            Send Email
          </button>
          <button
            type="button"
            className="tmp-reports-btn tmp-reports-btn-download"
            onClick={triggerDownload}
            disabled={isBuilding}
          >
            <span className="tmp-reports-btn-icon">📥</span>
            Download XLSX
          </button>
        </div>
      </div>

      <div className="tmp-reports-top-buttons">
        <button
          type="button"
          className={`tmp-reports-top-btn ${activeReport === 'CRM_REPORT' ? 'tmp-reports-top-btn--active' : ''}`}
          onClick={() => setActiveReport('CRM_REPORT')}
        >
          CRM Report
        </button>
      </div>

      <div className="tmp-reports-content">
        {buildError && <p className="tmp-reports-error">{buildError}</p>}
        <p className="tmp-reports-help">
          Live report generation is on-page. Data is loaded and aggregated from all available 2026 CRM reports.
        </p>

        {(isBuilding || buildProgress.phase !== 'idle') && (
          <div className="tmp-reports-progress-card">
            <div className="tmp-reports-progress-top">
              <span className="tmp-reports-progress-label">{buildProgress.message}</span>
              <span className="tmp-reports-progress-value">{Math.max(0, Math.min(100, buildProgress.value))}%</span>
            </div>
            <div className="tmp-reports-progress-track">
              <div
                className="tmp-reports-progress-fill"
                style={{ width: `${Math.max(0, Math.min(100, buildProgress.value))}%` }}
              />
            </div>
            {isBuilding && (
              <div className="tmp-reports-progress-loading">
                <LoadingSpinner size="small" />
                <span>Building CRM report in the web page...</span>
              </div>
            )}
          </div>
        )}

        {uiRows.length > 0 && (
          <>
            <div className="tmp-reports-kpi-grid">
              {['CS', 'LBF', 'SME'].map((dept) => {
                const row = uiTotals[dept] || {};
                const total = Number(row.accepted || 0) + Number(row.notProvided || 0) + Number(row.rejected || 0);
                return (
                  <article key={dept} className="tmp-reports-kpi-card">
                    <h3>{dept}</h3>
                    <p className="tmp-reports-kpi-total">{total.toLocaleString()}</p>
                    <div className="tmp-reports-kpi-breakdown">
                      <span>Accepted: {(row.accepted || 0).toLocaleString()}</span>
                      <span>Not Provided: {(row.notProvided || 0).toLocaleString()}</span>
                      <span>Rejected: {(row.rejected || 0).toLocaleString()}</span>
                    </div>
                  </article>
                );
              })}
              <article className="tmp-reports-kpi-card tmp-reports-kpi-card--highlight">
                <h3>All Products</h3>
                <p className="tmp-reports-kpi-total">{grandTotalLeads.toLocaleString()}</p>
                <div className="tmp-reports-kpi-breakdown">
                  <span>Processed files: {reportMeta.totalPotentialReports || 0}</span>
                  <span>Valid files used: {Object.values(reportMeta.acceptedReportsByDept || {}).reduce((a, b) => a + Number(b || 0), 0)}</span>
                  <span>Lead rows: {(reportMeta.totalLeadRows || 0).toLocaleString()}</span>
                </div>
              </article>
            </div>

            <div className="tmp-reports-table-wrap tmp-reports-table-wrap--fancy">
              <table className="tmp-reports-table">
                <thead>
                  <tr className="tmp-reports-head-1">
                    <th rowSpan={2}>Month</th>
                    <th colSpan={3}>CS</th>
                    <th colSpan={3}>LBF</th>
                    <th colSpan={3}>SME</th>
                  </tr>
                  <tr className="tmp-reports-head-2">
                    <th>Accepted</th>
                    <th>Not Provided</th>
                    <th>Rejected</th>
                    <th>Accepted</th>
                    <th>Not Provided</th>
                    <th>Rejected</th>
                    <th>Accepted</th>
                    <th>Not Provided</th>
                    <th>Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {uiRows.map((row) => (
                    <tr key={row.month}>
                      <td>{row.month}</td>
                      <td>{row.CS.accepted.toLocaleString()}</td>
                      <td>{row.CS.notProvided.toLocaleString()}</td>
                      <td>{row.CS.rejected.toLocaleString()}</td>
                      <td>{row.LBF.accepted.toLocaleString()}</td>
                      <td>{row.LBF.notProvided.toLocaleString()}</td>
                      <td>{row.LBF.rejected.toLocaleString()}</td>
                      <td>{row.SME.accepted.toLocaleString()}</td>
                      <td>{row.SME.notProvided.toLocaleString()}</td>
                      <td>{row.SME.rejected.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="tmp-reports-total-row">
                    <td>Total</td>
                    <td>{(uiTotals.CS?.accepted || 0).toLocaleString()}</td>
                    <td>{(uiTotals.CS?.notProvided || 0).toLocaleString()}</td>
                    <td>{(uiTotals.CS?.rejected || 0).toLocaleString()}</td>
                    <td>{(uiTotals.LBF?.accepted || 0).toLocaleString()}</td>
                    <td>{(uiTotals.LBF?.notProvided || 0).toLocaleString()}</td>
                    <td>{(uiTotals.LBF?.rejected || 0).toLocaleString()}</td>
                    <td>{(uiTotals.SME?.accepted || 0).toLocaleString()}</td>
                    <td>{(uiTotals.SME?.notProvided || 0).toLocaleString()}</td>
                    <td>{(uiTotals.SME?.rejected || 0).toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {!isBuilding && uiRows.length === 0 && (
          <p className="tmp-reports-help">No summary data yet. Click Refresh Data to rebuild.</p>
        )}
        {lastBuiltAt && (
          <p className="tmp-reports-last-built">
            Last generated: {lastBuiltAt.toLocaleDateString()} {lastBuiltAt.toLocaleTimeString()}
          </p>
        )}
      </div>

      {showEmailModal && (
        <div className="tmp-reports-modal-overlay" onClick={() => !sending && setShowEmailModal(false)}>
          <div className="tmp-reports-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tmp-reports-modal-header">
              <h3>Send Temporary CRM Report</h3>
              <button
                type="button"
                className="tmp-reports-modal-close"
                onClick={() => !sending && setShowEmailModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="tmp-reports-modal-body">
              <div className="tmp-reports-recipient-row">
                <input
                  type="email"
                  placeholder="Enter email"
                  value={newRecipient}
                  onChange={(e) => setNewRecipient(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
                />
                <button type="button" onClick={addRecipient}>Add</button>
                <button type="button" onClick={copyAllEmails} disabled={!recipients.length}>
                  {copyEmailsFeedback ? 'Copied!' : 'Copy all'}
                </button>
                <button type="button" onClick={pasteEmails}>Paste</button>
              </div>
              <div className="tmp-reports-paste-row">
                <textarea
                  placeholder="Or paste emails here (one per line, comma or semicolon separated)"
                  value={pasteBox}
                  onChange={(e) => setPasteBox(e.target.value)}
                  rows={2}
                />
                <button type="button" onClick={addPasteBoxEmails}>Add pasted</button>
              </div>
              <ul className="tmp-reports-recipient-list">
                {recipients.map((email) => (
                  <li key={email}>
                    <span>{email}</span>
                    <button type="button" onClick={() => removeRecipient(email)}>Remove</button>
                  </li>
                ))}
              </ul>
              {sendError && <p className="tmp-reports-error">{sendError}</p>}
            </div>
            <div className="tmp-reports-modal-footer">
              <button type="button" onClick={() => !sending && setShowEmailModal(false)}>Cancel</button>
              <button type="button" onClick={handleSendEmail} disabled={sending || !recipients.length}>
                {sending ? 'Sending...' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TemporaryReports;

