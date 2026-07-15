import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { consentIncentiveAPI } from '../../../../../services/api';
import { sendScoreCardEmail } from '../../DepartmentalDashboard/utils/emailScoreCard';
import { buildConsentIncentiveEmailHTML } from './utils/consentIncentiveEmailTemplate';
import { processConsentIncentiveReport, filterReportByProduct } from './utils/consentIncentiveProcessor';
import {
  downloadConsentIncentiveReport,
  buildConsentIncentiveReportBuffer,
  bufferToBase64,
  fmtSize,
} from './utils/consentIncentiveExport';
import { Toast, ConfirmDialog } from '../../../../../components/feedback/Feedback';
import './ConsentIncentiveReport.css';

const CIR_RECIPIENTS_KEY = 'cir_email_recipients';

const FILE_TYPES = [
  {
    kind:  'LEAD',
    icon:  '📋',
    label: 'Lead Report',
    desc:  'Export from CRM. Must contain "Lead_Report" sheet with Name, Created_By, Consent_Status (ACCEPTED), Consent_Date, Team_Name.',
  },
  {
    kind:  'LOAN',
    icon:  '💰',
    label: 'Loan File',
    desc:  'Loan Accounts export. Must contain Account Holder Name, Loan Amount, Branch, Activation Date (Loan), CLIENT TYPE. Used for fuzzy conversion match.',
  },
];

const PRODUCT_LABELS = {
  CS:  'CS — Civil Servant',
  LBF: 'LBF — Log Book Finance',
  SME: 'SME — Small & Medium Enterprise',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── EmailModal ───────────────────────────────────────────────────────────────
function EmailModal({ processedData, onClose }) {
  const { summary } = processedData;

  const [recipients, setRecipients] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CIR_RECIPIENTS_KEY) || '[]'); } catch { return []; }
  });
  const [newEmail,  setNewEmail]  = useState('');
  const [pasteBox,  setPasteBox]  = useState('');
  const [subject,   setSubject]   = useState(
    `CONSENT INCENTIVE REPORT — ${summary.product ? `${summary.product} ` : ''}${summary.period}`);
  const [sending,  setSending]  = useState(false);
  const [progress, setProgress] = useState(null);
  const [err,      setErr]      = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(CIR_RECIPIENTS_KEY, JSON.stringify(recipients)); } catch {}
  }, [recipients]);

  const parseEmails = (text) =>
    [...new Set(text.split(/[\n,;\t]+/).map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s)))];

  const addEmail = () => {
    const e = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(e))     { setErr('Enter a valid email address.'); return; }
    if (recipients.includes(e)) { setErr('Already in the list.'); return; }
    setRecipients((prev) => [...prev, e]); setNewEmail(''); setErr('');
  };
  const removeEmail = (e) => setRecipients((prev) => prev.filter((r) => r !== e));
  const pasteFromClipboard = async () => {
    try {
      const text  = await navigator.clipboard.readText();
      const toAdd = parseEmails(text).filter((e) => !recipients.includes(e));
      if (!toAdd.length) { setErr('No new valid emails found in clipboard.'); return; }
      setRecipients((prev) => [...prev, ...toAdd]); setErr('');
    } catch { setErr('Clipboard access denied — use the paste box below.'); }
  };
  const addPasted = () => {
    const toAdd = parseEmails(pasteBox).filter((e) => !recipients.includes(e));
    if (!toAdd.length) { setErr('No valid emails found.'); return; }
    setRecipients((prev) => [...prev, ...toAdd]); setPasteBox(''); setErr('');
  };

  const handleSend = useCallback(async () => {
    if (!recipients.length) { setErr('Add at least one recipient.'); return; }
    setSending(true); setErr('');
    setProgress(recipients.map((email) => ({ email, status: 'sending' })));
    try {
      const { buffer, fileName } = buildConsentIncentiveReportBuffer(processedData);
      const base64   = bufferToBase64(buffer);
      const htmlBody = buildConsentIncentiveEmailHTML(summary);
      const result   = await sendScoreCardEmail(recipients, subject, htmlBody, {
        mode: 'REPORT', attachmentBase64: base64, attachmentName: fileName,
      });
      const status = result.success ? 'success' : 'failed';
      const errMsg = result.success ? null : (result.error || 'Failed to send');
      setProgress((prev) => prev.map((p) => ({ ...p, status, error: errMsg })));
    } catch (e) {
      setProgress((prev) => prev.map((p) => ({ ...p, status: 'failed', error: e?.message || 'Unexpected error.' })));
    } finally { setSending(false); }
  }, [recipients, subject, processedData, summary]);

  const allDone    = progress && !sending;
  const allSuccess = allDone && progress.every((p) => p.status === 'success');

  return (
    <div className="cir-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
      <div className="cir-modal">
        <div className="cir-modal-header">
          <h2 className="cir-modal-title">✉️ Send Report by Email</h2>
          <button className="cir-modal-close" onClick={onClose} disabled={sending}>×</button>
        </div>

        {progress && (
          <div className={`cir-progress-banner ${allSuccess ? 'cir-progress-banner--ok' : ''}`}>
            <div className="cir-progress-title">
              {sending ? 'Sending…' : allSuccess ? '✓ Sent successfully' : 'Send result'}
            </div>
            <ul className="cir-progress-list">
              {progress.map(({ email, status, error }) => (
                <li key={email} className={`cir-progress-item cir-progress-item--${status}`}>
                  <span className="cir-progress-email">{email}</span>
                  <span className="cir-progress-icon">
                    {status === 'sending' && '⏳'}
                    {status === 'success' && '✓'}
                    {status === 'failed'  && '✗'}
                  </span>
                  {status === 'failed' && error && <span className="cir-progress-err">{error}</span>}
                </li>
              ))}
            </ul>
            {allDone && (
              <button className="cir-btn cir-btn--cancel" style={{ marginTop: 10 }} onClick={onClose}>Close</button>
            )}
          </div>
        )}

        {!progress && (
          <div className="cir-modal-body">
            <p className="cir-modal-label">Subject</p>
            <input className="cir-modal-input" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />

            <p className="cir-modal-label">
              Recipients <span className="cir-modal-hint">(saved for next time)</span>
            </p>
            <div className="cir-recipient-row">
              <input ref={inputRef} className="cir-modal-input" type="email" placeholder="user@example.com"
                     value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && addEmail()} />
              <button className="cir-btn cir-btn--upload" onClick={addEmail}>Add</button>
              <button className="cir-btn cir-btn--replace" onClick={pasteFromClipboard} title="Paste from clipboard">📋 Paste</button>
            </div>

            {recipients.length > 0 && (
              <div className="cir-recipient-chips">
                {recipients.map((e) => (
                  <span key={e} className="cir-recipient-chip">
                    {e}
                    <button className="cir-chip-remove" onClick={() => removeEmail(e)}>×</button>
                  </span>
                ))}
              </div>
            )}

            <details className="cir-paste-details">
              <summary className="cir-paste-summary">Paste multiple emails at once</summary>
              <textarea className="cir-modal-textarea" rows={3}
                        placeholder="One per line, or comma / semicolon separated"
                        value={pasteBox} onChange={(e) => setPasteBox(e.target.value)} />
              <button className="cir-btn cir-btn--replace" onClick={addPasted}>Add pasted</button>
            </details>

            <div className="cir-modal-note">
              📎 <strong>Consent_Incentive_Report_{new Date().toISOString().slice(0, 10)}.xlsx</strong>
              <br />Includes: Procedure · Summary · Team Summary · 3-Month Consents · Current-Month · 3-Month Converted · Pricing · Criteria
            </div>

            {err && <div className="cir-error">{err}</div>}

            <div className="cir-modal-actions">
              <button className="cir-btn cir-btn--cancel" onClick={onClose}>Cancel</button>
              <button className="cir-btn cir-btn--email cir-btn--lg" onClick={handleSend} disabled={!recipients.length}>
                ✉️ Send to {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── UploadRow ─────────────────────────────────────────────────────────────────
function UploadRow({ typeDef, fileRecord, onUploaded, onDeleted, showToast }) {
  const inputRef                  = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [err,       setErr]       = useState('');

  const handleChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setErr('');
    try {
      const result = await consentIncentiveAPI.uploadFile(file, typeDef.kind);
      onUploaded(result.data);
      showToast?.({
        type:    'success',
        title:   `${typeDef.label} uploaded`,
        message: `${file.name} (${fmtSize(file.size)}) is now active.`,
      });
    } catch (ex) {
      const msg = ex?.message || 'Upload failed';
      setErr(msg);
      showToast?.({ type: 'error', title: 'Upload failed', message: msg });
    } finally {
      setUploading(false); e.target.value = '';
    }
  }, [typeDef.kind, typeDef.label, onUploaded, showToast]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!fileRecord) return;
    setConfirmOpen(false);
    setDeleting(true); setErr('');
    try {
      await consentIncentiveAPI.deleteFile(fileRecord.id);
      onDeleted(typeDef.kind);
      showToast?.({
        type:    'success',
        title:   `${typeDef.label} removed`,
        message: `"${fileRecord.fileName}" has been deleted. You can re-upload anytime.`,
      });
    } catch (ex) {
      const msg = ex?.message || 'Delete failed';
      setErr(msg);
      showToast?.({ type: 'error', title: 'Delete failed', message: msg });
    } finally {
      setDeleting(false);
    }
  }, [fileRecord, typeDef.kind, typeDef.label, onDeleted, showToast]);

  const hasFile = Boolean(fileRecord);
  return (
    <div className="cir-upload-row">
      <div className={`cir-dot ${hasFile ? 'cir-dot--ready' : 'cir-dot--missing'}`} />
      <div className="cir-upload-icon">{typeDef.icon}</div>
      <div className="cir-upload-info">
        <div className="cir-upload-title">{typeDef.label}</div>
        {hasFile ? (
          <>
            <div className="cir-upload-filename" title={fileRecord.fileName}>{fileRecord.fileName}</div>
            <div className="cir-upload-meta">
              {fmtSize(fileRecord.fileSize)} · {new Date(fileRecord.createdAt).toLocaleDateString('en-GB')}
            </div>
          </>
        ) : (
          <div className="cir-upload-desc">{typeDef.desc}</div>
        )}
        {err && <div className="cir-error">{err}</div>}
      </div>
      <div className="cir-btn-group">
        {hasFile ? (
          <>
            <button className="cir-btn cir-btn--replace" onClick={() => inputRef.current?.click()} disabled={uploading || deleting}>
              {uploading ? 'Uploading…' : '↩ Replace'}
            </button>
            <button className="cir-btn cir-btn--delete" onClick={() => setConfirmOpen(true)} disabled={uploading || deleting}>
              {deleting ? '…' : '🗑'}
            </button>
          </>
        ) : (
          <button className="cir-btn cir-btn--upload" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : '⬆ Upload'}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleChange} />

      <ConfirmDialog
        open={confirmOpen}
        title={`Remove ${typeDef.label}?`}
        message={`This will delete "${fileRecord?.fileName ?? ''}". You can re-upload anytime.`}
        confirmLabel="Yes, delete"
        cancelLabel="Cancel"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

// ── CRM Info Panel ────────────────────────────────────────────────────────────
function CRMInfoPanel({ crmList, crmErr }) {
  if (crmErr) {
    return (
      <div className="cir-crm-panel cir-crm-panel--err">
        <div className="cir-crm-header">🗂 CS CRM Reports (from database)</div>
        <div className="cir-crm-err">⚠ {crmErr}</div>
      </div>
    );
  }
  if (!crmList) {
    return (
      <div className="cir-crm-panel">
        <div className="cir-crm-header">🗂 CS CRM Reports (from database)</div>
        <div className="cir-crm-loading">Loading CRM reports…</div>
      </div>
    );
  }
  const latest = crmList[0];
  return (
    <div className="cir-crm-panel cir-crm-panel--ok">
      <div className="cir-crm-header">
        🗂 CS CRM Reports — <strong>{crmList.length}</strong> report{crmList.length !== 1 ? 's' : ''} in DB (will be scanned for field verification)
      </div>
      <div className="cir-crm-grid">
        <div className="cir-crm-row">
          <span className="cir-crm-key">Latest (user_data):</span>
          <strong>{latest?.title || latest?.fileName || '—'}</strong>
        </div>
        <div className="cir-crm-row">
          <span className="cir-crm-key">File:</span>
          <span>{latest?.fileName || '—'}</span>
        </div>
        <div className="cir-crm-row">
          <span className="cir-crm-key">Date:</span>
          <span>{latest?.date ? new Date(latest.date).toLocaleDateString('en-GB') : '—'}</span>
        </div>
        {crmList.length > 1 && (
          <details className="cir-crm-details">
            <summary>Show all {crmList.length} reports</summary>
            <ul className="cir-crm-history">
              {crmList.map((r) => (
                <li key={r.id}>
                  <span className="cir-crm-date">{r.date ? new Date(r.date).toLocaleDateString('en-GB') : '—'}</span>
                  <span>{r.title || r.fileName}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

// ── Diagnostics Panel ────────────────────────────────────────────────────────
function DiagnosticsPanel({ diagnostics }) {
  if (!diagnostics) return null;
  const { userData = {}, activity = {}, lead = {}, loan = {} } = diagnostics;
  const fmt = (n) => (n ?? 0).toLocaleString();
  const matchPct  = Math.round((lead.lookupMatchRate ?? 0) * 100);
  const matchColor= matchPct >= 90 ? '#16a34a' : matchPct >= 70 ? '#b45309' : '#dc2626';

  return (
    <div className="cir-diag">
      <div className="cir-diag-title">🔎 CRM Lookup &amp; Processing Summary</div>
      <div className="cir-diag-grid">
        <div className="cir-diag-card">
          <div className="cir-diag-card-label">user_data Sheet</div>
          <div className="cir-diag-card-value">{userData.sheetName || '—'}</div>
          <div className="cir-diag-card-hint">{fmt(userData.agentsLoaded)} agents loaded</div>
        </div>
        <div className="cir-diag-card">
          <div className="cir-diag-card-label">CRMs scanned for activity</div>
          <div className="cir-diag-card-value">{fmt(activity.reportsScanned)}</div>
          <div className="cir-diag-card-hint">{fmt(activity.totalActivityRows)} activity rows · {fmt(activity.lookupSize)} (agent,day) keys</div>
        </div>
        <div className="cir-diag-card">
          <div className="cir-diag-card-label">Lookup Match Rate</div>
          <div className="cir-diag-card-value" style={{ color: matchColor }}>{matchPct}%</div>
          <div className="cir-diag-card-hint">{fmt(lead.lookupMatched)} matched · {fmt(lead.lookupUnmatched)} unmatched</div>
        </div>
        <div className="cir-diag-card">
          <div className="cir-diag-card-label">Lead Rows</div>
          <div className="cir-diag-card-value">{fmt(lead.rowsTotal)}</div>
          <div className="cir-diag-card-hint">{fmt(lead.rowsAccepted)} ACCEPTED · {fmt(lead.rowsDropped)} dropped</div>
        </div>
        <div className="cir-diag-card">
          <div className="cir-diag-card-label">Loan File</div>
          <div className="cir-diag-card-value">{fmt(loan.totalRows)}</div>
          <div className="cir-diag-card-hint">latest month: {loan.latestMonth || '—'} ({fmt(loan.loansInLatestMonth)} loans) · {fmt(loan.matchedLoans)} matched</div>
        </div>
      </div>

      {userData.byProduct && (
        <div className="cir-diag-section">
          <div className="cir-diag-subhead">Agents in user_data by Product</div>
          <div className="cir-diag-chips">
            {Object.entries(userData.byProduct).map(([p, n]) => (
              <span key={p} className={`cir-badge cir-badge--${p.toLowerCase()}`} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
                {p}: {fmt(n)}
              </span>
            ))}
          </div>
        </div>
      )}

      {userData.detectedColumns && (
        <div className="cir-diag-section">
          <div className="cir-diag-subhead">Detected user_data Columns</div>
          <div className="cir-diag-cols">
            <span><strong>Name:</strong>       {userData.detectedColumns.name      || '— not found'}</span>
            <span><strong>Tenant=Branch:</strong> {userData.detectedColumns.tenant || '— not found'}</span>
            <span><strong>Zone:</strong>       {userData.detectedColumns.zone      || '— not found'}</span>
            <span><strong>Product:</strong>    {userData.detectedColumns.product   || '— not found'}</span>
            <span><strong>Last_Login:</strong> {userData.detectedColumns.lastLogin || '— not found'}</span>
          </div>
        </div>
      )}

      {userData.sampleAgents?.length > 0 && (
        <div className="cir-diag-section">
          <div className="cir-diag-subhead">Sample Agents (first 5 loaded from user_data)</div>
          <table className="cir-diag-table">
            <thead>
              <tr><th>NAME</th><th>PRODUCT</th><th>BRANCH (Tenant)</th><th>ZONE</th><th>LAST LOGIN</th></tr>
            </thead>
            <tbody>
              {userData.sampleAgents.map((a, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td><span className={`cir-badge cir-badge--${a.product?.toLowerCase()}`}>{a.product || '—'}</span></td>
                  <td>{a.branch || '—'}</td>
                  <td>{a.zone || '—'}</td>
                  <td style={{ fontSize: '0.72rem' }}>{a.lastLogin || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lead.unmatchedNames?.length > 0 && (
        <details className="cir-diag-section">
          <summary className="cir-diag-subhead" style={{ cursor: 'pointer', color: '#991b1b' }}>
            ⚠ {lead.unmatchedNames.length} Created_By name{lead.unmatchedNames.length !== 1 ? 's' : ''} not matched in CRM (click to expand)
          </summary>
          <div className="cir-diag-unmatched">
            {lead.unmatchedNames.map((n, i) => (<span key={i} className="cir-diag-unmatched-chip">{n}</span>))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Summary stats ────────────────────────────────────────────────────────────
function SummaryStats({ summary }) {
  const fmt = (n) => Math.round(n ?? 0).toLocaleString();
  return (
    <div className="cir-stats-row">
      <div className="cir-stat">
        <div className="cir-stat-value">{summary.totalAgents.toLocaleString()}</div>
        <div className="cir-stat-label">Total Agents</div>
      </div>
      <div className="cir-stat cir-stat--green">
        <div className="cir-stat-value">{fmt(summary.totalVerified)}</div>
        <div className="cir-stat-label">Verified (Field)</div>
      </div>
      <div className="cir-stat cir-stat--amber">
        <div className="cir-stat-value">{fmt(summary.totalUnverified)}</div>
        <div className="cir-stat-label">Unverified (Office)</div>
      </div>
      <div className="cir-stat cir-stat--purple">
        <div className="cir-stat-value">{fmt(summary.totalConverted)}</div>
        <div className="cir-stat-label">Converted</div>
      </div>
      <div className="cir-stat cir-stat--blue">
        <div className="cir-stat-value">{fmt(summary.totalPayout)}</div>
        <div className="cir-stat-label">Agent Payout (TZS)</div>
      </div>
      <div className="cir-stat cir-stat--green">
        <div className="cir-stat-value">{fmt(summary.grandTotal)}</div>
        <div className="cir-stat-label">Grand Total (TZS)</div>
      </div>
    </div>
  );
}

// ── Pricing table preview ───────────────────────────────────────────────────
function PricingTable({ agents, topPerformers }) {
  const fmt = (n) => Math.round(n ?? 0).toLocaleString();
  const topKeys = new Set(Object.values(topPerformers ?? {}).map((t) => `${t.name}|${t.product}`));
  return (
    <div className="cir-table-wrap">
      <table className="cir-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'right' }}>#</th>
            <th>AGENT</th>
            <th>PRODUCT</th>
            <th>BRANCH</th>
            <th>ZONE</th>
            <th>ACTIVE?</th>
            <th style={{ textAlign: 'right' }}>VERIFIED</th>
            <th style={{ textAlign: 'right' }}>UNVERIFIED</th>
            <th style={{ textAlign: 'right' }}>CONVERTED</th>
            <th style={{ textAlign: 'right' }}>BASE</th>
            <th style={{ textAlign: 'right' }}>BONUS</th>
            <th style={{ textAlign: 'right' }}>TOTAL PAYOUT (TZS)</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a, i) => {
            const isTop = topKeys.has(`${a.name}|${a.product}`);
            return (
              <tr key={i}>
                <td style={{ textAlign: 'right', color: '#9ca3af' }}>{i + 1}</td>
                <td style={{ fontWeight: 600 }}>
                  {a.name}{isTop && <span className="cir-badge cir-badge--top" style={{ marginLeft: 6 }}>⭐ TOP</span>}
                </td>
                <td><span className={`cir-badge cir-badge--${a.product?.toLowerCase()}`}>{a.product}</span></td>
                <td style={{ color: '#6b7280', fontSize: '0.74rem' }}>{a.branch || '—'}</td>
                <td style={{ color: '#6b7280', fontSize: '0.74rem' }}>{a.zone || '—'}</td>
                <td>
                  <span className={`cir-badge ${a.active ? 'cir-badge--yes' : 'cir-badge--no'}`}>
                    {a.active ? 'ACTIVE' : 'NOT_ACTIVE'}
                  </span>
                </td>
                <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>{a.verified}</td>
                <td style={{ textAlign: 'right', color: '#b45309' }}>{a.unverified}</td>
                <td style={{ textAlign: 'right', color: '#7c3aed', fontWeight: 600 }}>{a.converted}</td>
                <td style={{ textAlign: 'right' }}>{fmt(a.basePayout)}</td>
                <td style={{ textAlign: 'right', color: a.topBonus > 0 ? '#854d0e' : '#9ca3af' }}>
                  {a.topBonus > 0 ? fmt(a.topBonus) : '—'}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: '#1f3864' }}>{fmt(a.totalPayout)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
const ConsentIncentiveReport = () => {
  const [files,         setFiles]         = useState({});
  const [loading,       setLoading]       = useState(true);
  const [processing,    setProcessing]    = useState(false);
  const [progressMsg,   setProgressMsg]   = useState('');
  const [processedData, setProcessedData] = useState(null);
  const [showEmail,     setShowEmail]     = useState(false);
  const [procErr,       setProcErr]       = useState('');
  const [crmList,       setCrmList]       = useState(null);
  const [crmErr,        setCrmErr]        = useState('');
  const [selectedMonth, setSelectedMonth] = useState('');     // 'YYYY-MM'
  const [productView,   setProductView]   = useState(null);   // null=ALL | 'CS' | 'LBF' | 'SME'
  const [toast,         setToast]         = useState(null);
  const showToast = useCallback((t) => setToast({ ...t, _id: Date.now() }), []);

  // Months that actually have CRM reports — the dropdown only offers these so
  // the scan stays cheap (we only download/scan that month's CRM files).
  const monthOptions = useMemo(() => {
    if (!crmList?.length) return [];
    const seen = new Map(); // 'YYYY-MM' -> { key, label, count }
    crmList.forEach((r) => {
      const raw = r.date || r.createdAt;
      if (!raw) return;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
      const cur = seen.get(key) || { key, label, count: 0 };
      cur.count++;
      seen.set(key, cur);
    });
    return [...seen.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [crmList]);

  // Default the month picker to the latest available CRM month.
  useEffect(() => {
    if (!selectedMonth && monthOptions.length) setSelectedMonth(monthOptions[0].key);
  }, [monthOptions, selectedMonth]);

  const monthLabel = useMemo(() => {
    if (!selectedMonth) return '';
    const [y, m] = selectedMonth.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase();
  }, [selectedMonth]);

  // Product-scoped view of the processed report (cheap post-filter — no re-scan).
  const displayData = useMemo(
    () => (processedData && productView ? filterReportByProduct(processedData, productView) : processedData),
    [processedData, productView],
  );

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const list = await consentIncentiveAPI.getFiles();
      const map  = {};
      list.forEach((f) => { if (['LEAD','LOAN'].includes(f.kind)) map[f.kind] = f; });
      setFiles(map);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCRMList = useCallback(async () => {
    setCrmErr('');
    try {
      const list = await consentIncentiveAPI.getAllCRMReports();
      setCrmList(list);
    } catch (e) {
      setCrmErr(e?.message || 'Could not fetch CRM reports');
    }
  }, []);

  useEffect(() => { loadFiles(); loadCRMList(); }, [loadFiles, loadCRMList]);

  const handleUploaded = useCallback((record) => {
    setFiles((prev) => ({ ...prev, [record.kind]: record }));
    setProcessedData(null);
  }, []);
  const handleDeleted = useCallback((kind) => {
    setFiles((prev) => { const n = { ...prev }; delete n[kind]; return n; });
    setProcessedData(null);
  }, []);

  const allReady   = FILE_TYPES.every((t) => files[t.kind]);
  const readyCount = FILE_TYPES.filter((t) => files[t.kind]).length;
  const statusClass = allReady  ? 'cir-status--ready'
    : readyCount > 0            ? 'cir-status--partial'
    :                             'cir-status--missing';
  const statusLabel = allReady
    ? `✔ All ${FILE_TYPES.length} files ready`
    : `${readyCount} / ${FILE_TYPES.length} files uploaded`;

  const handleGenerate = useCallback(async () => {
    if (!allReady) return;
    if (!crmList?.length) { setProcErr('No CRM reports in database.'); return; }
    if (!selectedMonth)   { setProcErr('Select a report month first.'); return; }

    // Only scan CRM reports that fall in the selected month — keeps the scan
    // fast and focused on the files that matter for this report period.
    const crmForMonth = crmList.filter((r) => {
      const raw = r.date || r.createdAt;
      if (!raw) return false;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return false;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === selectedMonth;
    });
    if (!crmForMonth.length) {
      setProcErr(`No CRM reports found for ${monthLabel}. Pick another month or upload that month's CRM.`);
      return;
    }

    setProcessing(true); setProcErr(''); setProcessedData(null); setProductView(null);
    try {
      setProgressMsg('Downloading Lead file…');
      const leadBuf = await consentIncentiveAPI.downloadFileBuffer(files.LEAD.id);
      setProgressMsg('Downloading Loan file…');
      const loanBuf = await consentIncentiveAPI.downloadFileBuffer(files.LOAN.id);

      setProgressMsg(`Downloading ${crmForMonth.length} CRM report(s) for ${monthLabel}…`);
      const crmBuffers = [];
      for (let i = 0; i < crmForMonth.length; i++) {
        const r = crmForMonth[i];
        setProgressMsg(`Downloading CRM ${i + 1}/${crmForMonth.length}: ${r.title || r.fileName}…`);
        try {
          const buf = await consentIncentiveAPI.downloadCRMReportBuffer(r.id);
          crmBuffers.push({ buffer: buf, meta: r });
        } catch (e) {
          console.warn('Failed to download CRM', r.id, e);
        }
      }
      if (!crmBuffers.length) throw new Error('Could not download any CRM report for the selected month.');

      setProgressMsg(`Processing ${monthLabel} — running 7-step procedure…`);
      const result = processConsentIncentiveReport(leadBuf, loanBuf, crmBuffers, { periodLabel: monthLabel });
      setProcessedData(result);
      setProgressMsg('');
    } catch (e) {
      setProcErr(e?.message || 'Processing failed.');
      setProgressMsg('');
    } finally {
      setProcessing(false);
    }
  }, [allReady, files, crmList, selectedMonth, monthLabel]);

  const handleDownload = useCallback(() => {
    if (displayData) downloadConsentIncentiveReport(displayData);
  }, [displayData]);

  return (
    <div className="cir-root">

      <div className="cir-header">
        <h1 className="cir-title">Consent Incentive Report</h1>
        <p className="cir-subtitle">
          Upload the Lead &amp; Loan files. The latest CS CRM report (from the database) is used for VLOOKUP; all CRM reports are scanned for field-activity verification.
        </p>
      </div>

      {/* CRM info */}
      <CRMInfoPanel crmList={crmList} crmErr={crmErr} />

      {/* File uploads */}
      <div className="cir-section">
        <div className="cir-section-label">Source Files</div>
        {loading ? (
          <div className="cir-spinner-wrap">
            <div className="cir-spinner" /><span>Loading…</span>
          </div>
        ) : (
          <div className="cir-upload-list">
            {FILE_TYPES.map((t) => (
              <UploadRow key={t.kind} typeDef={t}
                         fileRecord={files[t.kind] ?? null}
                         onUploaded={handleUploaded} onDeleted={handleDeleted}
                         showToast={showToast} />
            ))}
          </div>
        )}
      </div>

      {/* Action bar */}
      {!loading && (
        <div className="cir-section">
          <div className="cir-action-bar">
            <span className={`cir-status ${statusClass}`}>{statusLabel}</span>

            {/* Report month — only this month's CRM files are scanned */}
            <label className="cir-month-picker">
              <span className="cir-month-label">Report month:</span>
              <select
                className="cir-month-select"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                disabled={processing || !monthOptions.length}
              >
                {!monthOptions.length && <option value="">No CRM months</option>}
                {monthOptions.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label} ({m.count} CRM{m.count !== 1 ? 's' : ''})
                  </option>
                ))}
              </select>
            </label>

            <button className="cir-btn cir-btn--gen cir-btn--lg"
                    onClick={handleGenerate} disabled={!allReady || processing || !crmList?.length || !selectedMonth}>
              {processing ? '⏳ Processing…' : '⚙ Generate Report'}
            </button>
            {processedData && (
              <>
                <button className="cir-btn cir-btn--dl cir-btn--lg" onClick={handleDownload}>
                  ⬇ Download Excel{productView ? ` (${productView})` : ''}
                </button>
                <button className="cir-btn cir-btn--email cir-btn--lg" onClick={() => setShowEmail(true)}>
                  ✉️ Send Email{productView ? ` (${productView})` : ''}
                </button>
              </>
            )}
            <span className="cir-action-note">{progressMsg || (allReady ? `${monthLabel || 'Pick a month'} · 7-step procedure will run` : 'Upload both files to proceed')}</span>
          </div>

          {/* Product split — re-scope the report to one product (same sheets) */}
          {processedData && (
            <div className="cir-product-split">
              <span className="cir-product-split-label">Report scope:</span>
              {[
                { key: null,  label: 'ALL' },
                { key: 'CS',  label: 'CS'  },
                { key: 'LBF', label: 'LBF' },
                { key: 'SME', label: 'SME' },
              ].map((opt) => (
                <button
                  key={opt.label}
                  className={`cir-btn cir-product-btn ${productView === opt.key ? 'cir-product-btn--active' : ''}`}
                  onClick={() => setProductView(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
              <span className="cir-product-split-hint">
                Download &amp; email use the selected scope — same sheets, product-specific.
              </span>
            </div>
          )}

          {procErr && <div className="cir-error" style={{ marginTop: 10 }}>⚠ {procErr}</div>}
        </div>
      )}

      {/* Results */}
      {processedData && (
        <>
          <div className="cir-section">
            <div className="cir-section-label">CRM Lookup &amp; Processing Diagnostics</div>
            <DiagnosticsPanel diagnostics={displayData.diagnostics} />
          </div>

          <div className="cir-section">
            <div className="cir-section-label">Summary — {displayData.summary.period}</div>
            <SummaryStats summary={displayData.summary} />
          </div>

          {displayData.teams?.length > 0 && (
            <div className="cir-section">
              <div className="cir-section-label">
                Team Summary ({displayData.teams.length} team{displayData.teams.length !== 1 ? 's' : ''}; {displayData.summary.teamsQualified} qualified for TZS 200,000 drink-up)
              </div>
              <div className="cir-table-wrap">
                <table className="cir-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'right' }}>#</th>
                      <th>TEAM</th>
                      <th style={{ textAlign: 'right' }}>AGENTS</th>
                      <th>PRODUCTS</th>
                      <th style={{ textAlign: 'right' }}>VERIFIED</th>
                      <th style={{ textAlign: 'right' }}>UNVERIFIED</th>
                      <th style={{ textAlign: 'right' }}>CONVERTED</th>
                      <th style={{ textAlign: 'right' }}>AGENT PAYOUT</th>
                      <th style={{ textAlign: 'right' }}>DRINK-UP</th>
                      <th style={{ textAlign: 'center' }}>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayData.teams.map((t, i) => (
                      <tr key={i}>
                        <td style={{ textAlign: 'right', color: '#9ca3af' }}>{i + 1}</td>
                        <td style={{ fontWeight: 600 }}>{t.team}</td>
                        <td style={{ textAlign: 'right' }}>{t.agents}</td>
                        <td style={{ color: '#6b7280', fontSize: '0.74rem' }}>{t.products || '—'}</td>
                        <td style={{ textAlign: 'right', color: t.qualified ? '#16a34a' : '#b45309', fontWeight: 700 }}>{t.verified}</td>
                        <td style={{ textAlign: 'right', color: '#b45309' }}>{t.unverified}</td>
                        <td style={{ textAlign: 'right', color: '#7c3aed', fontWeight: 600 }}>{t.converted}</td>
                        <td style={{ textAlign: 'right' }}>{Math.round(t.agentPayout).toLocaleString()}</td>
                        <td style={{ textAlign: 'right', color: t.qualified ? '#16a34a' : '#9ca3af', fontWeight: 700 }}>
                          {t.qualified ? Math.round(t.drinkupAmount).toLocaleString() : '—'}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className={`cir-badge ${t.qualified ? 'cir-badge--yes' : 'cir-badge--no'}`}>
                            {t.qualified ? '✓ QUALIFIED' : `✗ short ${t.shortBy}`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="cir-section">
            <div className="cir-section-label">
              Pricing — {displayData.agents.length} agent{displayData.agents.length !== 1 ? 's' : ''}, sorted by Total Payout
            </div>
            <PricingTable agents={displayData.agents} topPerformers={displayData.topPerformers} />
          </div>

          {displayData.converted.length > 0 && (
            <div className="cir-section">
              <div className="cir-section-label">
                3-Month Converted ({displayData.converted.length})
              </div>
              <div className="cir-table-wrap">
                <table className="cir-table">
                  <thead>
                    <tr>
                      <th>AGENT</th><th>LEAD NAME</th><th>ACCOUNT HOLDER</th>
                      <th>LOAN(S)</th><th style={{ textAlign: 'right' }}>TOTAL AMOUNT</th>
                      <th>BRANCH</th><th>SALES REP(S) — CLIENT</th>
                      <th>LATEST ACTIVATION</th><th style={{ textAlign: 'right' }}>SIM %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayData.converted.slice(0, 100).map((c, i) => {
                      const multi = (c.salesRepCount ?? 0) > 1;
                      return (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{c.agent}</td>
                          <td style={{ color: '#0f766e' }}>{c.leadName}</td>
                          <td style={{ color: '#7c3aed' }}>{c.accountHolder}</td>
                          <td style={{ fontSize: '0.74rem' }}>
                            {c.loanName}
                            {c.loanCount > 1 && (
                              <span style={{ marginLeft: 4, color: '#92400e', fontWeight: 700 }}>
                                ({c.loanCount} loans)
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>
                            {Math.round(c.loanAmount).toLocaleString()}
                          </td>
                          <td style={{ fontSize: '0.74rem' }}>{c.loanBranch}</td>
                          <td style={{
                            fontSize: '0.74rem',
                            background: multi ? '#fef3c7' : undefined,
                            color: multi ? '#92400e' : undefined,
                            fontWeight: multi ? 700 : undefined,
                          }}>
                            {c.salesRep}
                            {multi && (
                              <span style={{ marginLeft: 4, fontSize: '0.65rem' }}>
                                ({c.salesRepCount} reps)
                              </span>
                            )}
                          </td>
                          <td style={{ fontSize: '0.74rem' }}>{c.activationDate?.toLocaleDateString('en-GB')}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700,
                                       color: c.similarity >= 0.9 ? '#16a34a' : c.similarity >= 0.66 ? '#b45309' : '#dc2626' }}>
                            {Math.round(c.similarity * 100)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {displayData.converted.length > 100 && (
                  <p style={{ fontSize: '0.75rem', color: '#6b7280', padding: '8px 0' }}>
                    Showing first 100 of {displayData.converted.length} conversions. Download Excel for full list.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {showEmail && displayData && (
        <EmailModal processedData={displayData} onClose={() => setShowEmail(false)} />
      )}

      <Toast
        key={toast?._id}
        open={Boolean(toast)}
        type={toast?.type}
        title={toast?.title}
        message={toast?.message}
        onClose={() => setToast(null)}
      />
    </div>
  );
};

export default ConsentIncentiveReport;
