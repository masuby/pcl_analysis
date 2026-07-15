import { useState, useEffect, useCallback, useRef } from 'react';
import { socialMediaAPI } from '../../../../../../services/api';
import { sendScoreCardEmail } from '../../utils/emailScoreCard';
import { processSocialMediaData } from './utils/socialMediaProcessor';
import {
  downloadSocialMediaReport,
  buildSocialMediaReportBuffer,
  bufferToBase64,
} from './utils/socialMediaExport';
import { buildSocialMediaEmailHTML } from './utils/socialMediaEmailTemplate';
import { buildCallCenterAggregate, parseMonthFromPeriod, hasCallCenterData } from './utils/socialMediaCallCenter';
import { Toast, ConfirmDialog } from '../../../../../../components/feedback/Feedback';
import './SocialMediaAnalysis.css';

const SMA_RECIPIENTS_KEY = 'sma_email_recipients';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Email modal ──────────────────────────────────────────────────────────────
function EmailModal({ processedData, callCenter, onClose, showToast }) {
  const [recipients, setRecipients] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SMA_RECIPIENTS_KEY) || '[]'); } catch { return []; }
  });
  const [newEmail, setNewEmail] = useState('');
  const [pasteBox, setPasteBox] = useState('');
  const [subject, setSubject]   = useState(`SOCIAL MEDIA ANALYSIS — ${processedData.monthLabel}`);
  const [sending, setSending]   = useState(false);
  const [progress, setProgress] = useState(null);
  const [err, setErr]           = useState('');

  useEffect(() => {
    try { localStorage.setItem(SMA_RECIPIENTS_KEY, JSON.stringify(recipients)); } catch {}
  }, [recipients]);

  const parseEmails = (text) =>
    [...new Set(text.split(/[\n,;\t]+/).map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s)))];
  const addEmail = () => {
    const e = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(e))     { setErr('Enter a valid email address.'); return; }
    if (recipients.includes(e)) { setErr('Already in the list.'); return; }
    setRecipients((p) => [...p, e]); setNewEmail(''); setErr('');
  };
  const removeEmail = (e) => setRecipients((p) => p.filter((r) => r !== e));
  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      const toAdd = parseEmails(t).filter((e) => !recipients.includes(e));
      if (!toAdd.length) { setErr('No new valid emails found in clipboard.'); return; }
      setRecipients((p) => [...p, ...toAdd]); setErr('');
    } catch { setErr('Clipboard access denied — use the paste box below.'); }
  };
  const addPasted = () => {
    const toAdd = parseEmails(pasteBox).filter((e) => !recipients.includes(e));
    if (!toAdd.length) { setErr('No valid emails found.'); return; }
    setRecipients((p) => [...p, ...toAdd]); setPasteBox(''); setErr('');
  };

  const handleSend = useCallback(async () => {
    if (!recipients.length) { setErr('Add at least one recipient.'); return; }
    setSending(true); setErr('');
    setProgress(recipients.map((email) => ({ email, status: 'sending' })));
    try {
      const { buffer, fileName } = buildSocialMediaReportBuffer(processedData, { mode: 'weekly', callCenter });
      const base64   = bufferToBase64(buffer);
      const htmlBody = buildSocialMediaEmailHTML(processedData);
      const result   = await sendScoreCardEmail(recipients, subject, htmlBody, {
        mode: 'REPORT', attachmentBase64: base64, attachmentName: fileName,
      });
      const status = result.success ? 'success' : 'failed';
      const errMsg = result.success ? null : (result.error || 'Failed to send');
      setProgress((prev) => prev.map((p) => ({ ...p, status, error: errMsg })));
      if (result.success) {
        showToast?.({ type: 'success', title: 'Email sent', message: `Delivered to ${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}.` });
      }
    } catch (e) {
      const msg = e?.message || 'Unexpected error.';
      setProgress((prev) => prev.map((p) => ({ ...p, status: 'failed', error: msg })));
      showToast?.({ type: 'error', title: 'Send failed', message: msg });
    } finally { setSending(false); }
  }, [recipients, subject, processedData, callCenter, showToast]);

  const allDone    = progress && !sending;
  const allSuccess = allDone && progress.every((p) => p.status === 'success');

  return (
    <div className="sma-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
      <div className="sma-modal">
        <div className="sma-modal-header">
          <h2 className="sma-modal-title">✉️ Send Social Media Report</h2>
          <button className="sma-modal-close" onClick={onClose} disabled={sending}>×</button>
        </div>

        {progress && (
          <div className={`sma-progress-banner ${allSuccess ? 'sma-progress-banner--ok' : ''}`}>
            <div className="sma-progress-title">
              {sending ? 'Sending…' : allSuccess ? '✓ Sent successfully' : 'Send result'}
            </div>
            <ul className="sma-progress-list">
              {progress.map(({ email, status, error }) => (
                <li key={email} className={`sma-progress-item sma-progress-item--${status}`}>
                  <span className="sma-progress-email">{email}</span>
                  <span className="sma-progress-icon">
                    {status === 'sending' && '⏳'}{status === 'success' && '✓'}{status === 'failed' && '✗'}
                  </span>
                  {status === 'failed' && error && <span className="sma-progress-err">{error}</span>}
                </li>
              ))}
            </ul>
            {allDone && (
              <button className="pen-btn sma-btn-cancel" style={{ marginTop: 10 }} onClick={onClose}>Close</button>
            )}
          </div>
        )}

        {!progress && (
          <div className="sma-modal-body">
            <p className="sma-modal-label">Subject</p>
            <input className="sma-modal-input" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />

            <p className="sma-modal-label">Recipients <span className="sma-modal-hint">(saved for next time)</span></p>
            <div className="sma-recipient-row">
              <input className="sma-modal-input" type="email" placeholder="user@example.com"
                     value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && addEmail()} />
              <button className="pen-btn" onClick={addEmail}>Add</button>
              <button className="pen-btn sma-btn-secondary" onClick={pasteFromClipboard}>📋 Paste</button>
            </div>

            {recipients.length > 0 && (
              <div className="sma-recipient-chips">
                {recipients.map((e) => (
                  <span key={e} className="sma-recipient-chip">
                    {e}<button className="sma-chip-remove" onClick={() => removeEmail(e)}>×</button>
                  </span>
                ))}
              </div>
            )}

            <details className="sma-paste-details">
              <summary>Paste multiple emails at once</summary>
              <textarea className="sma-modal-textarea" rows={3}
                        placeholder="One per line, or comma / semicolon separated"
                        value={pasteBox} onChange={(e) => setPasteBox(e.target.value)} />
              <button className="pen-btn sma-btn-secondary" onClick={addPasted}>Add pasted</button>
            </details>

            <div className="sma-modal-note">
              📎 <strong>Social_Media_Report_{new Date().toISOString().slice(0,10)}.xlsx</strong>
              <br />Includes: Data · Agent Performance · Dispositions
            </div>

            {err && <div className="sma-error">{err}</div>}

            <div className="sma-modal-actions">
              <button className="pen-btn sma-btn-cancel" onClick={onClose}>Cancel</button>
              <button className="pen-btn sma-btn-email" onClick={handleSend} disabled={!recipients.length}>
                ✉️ Send to {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stat tile ────────────────────────────────────────────────────────────────
function Stat({ label, value, sub, color, hint }) {
  return (
    <div className="sma-stat" title={hint || ''}>
      <div className="sma-stat-value" style={color ? { color } : {}}>{value}</div>
      <div className="sma-stat-label">{label}</div>
      {sub && <div className="sma-stat-sub">{sub}</div>}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
const SocialMediaAnalysis = ({ autoGenerate = false }) => {
  const [loading,       setLoading]       = useState(false);
  const [processedData, setProcessedData] = useState(null);
  const [err,           setErr]           = useState('');
  const [showEmail,     setShowEmail]     = useState(false);
  const [toast,         setToast]         = useState(null);
  const [callCenter,    setCallCenter]    = useState(null);   // Call Centre call aggregate
  const [ccLoading,     setCcLoading]     = useState(false);
  const [months,        setMonths]        = useState([]);     // [{ value:'2026-06', label:'JUNE 2026' }]
  const [selectedMonth, setSelectedMonth] = useState('');     // 'YYYY-MM' (empty => latest)
  const showToast = useCallback((t) => setToast({ ...t, _id: Date.now() }), []);

  // Fetch a specific month's sheets and run the analysis. Pass an explicit
  // month ('YYYY-MM') to override the currently-selected one (used while the
  // dropdown's state update is still in flight).
  const handleGenerate = useCallback(async (monthArg) => {
    const month = monthArg !== undefined ? monthArg : selectedMonth;
    setLoading(true); setErr(''); setProcessedData(null); setCallCenter(null);
    try {
      const api = await socialMediaAPI.getData(month);
      const result = processSocialMediaData(api, api.period || 'SOCIAL MEDIA');
      setProcessedData(result);
      showToast({
        type: 'success',
        title: `Report generated — ${result.monthLabel}`,
        message: `${result.total.toLocaleString()} leads, ${result.agentCount} agents, ${Math.round(result.qualityRate*100)}% quality.`,
      });
    } catch (e) {
      const msg = e?.message || 'Failed to fetch sheet data';
      setErr(msg);
      showToast({ type: 'error', title: 'Generate failed', message: msg });
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, showToast]);

  // On mount: load the list of available months, default to the latest, and
  // (when mounted via <ReportShell>) auto-run that month's analysis.
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const res = await socialMediaAPI.getMonths();
        const list = res?.months || [];
        if (stop) return;
        setMonths(list);
        const def = list[0]?.value || '';
        setSelectedMonth(def);
        if (autoGenerate) handleGenerate(def);
      } catch {
        if (!stop && autoGenerate) handleGenerate('');  // fall back to latest tab
      }
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch month from the dropdown → fetch + analyse that month immediately.
  const handleMonthChange = useCallback((value) => {
    setSelectedMonth(value);
    handleGenerate(value);
  }, [handleGenerate]);

  // Once the social-media data is ready, pull the Call Centre call volumes for
  // the same month (best-effort) so the Agent Performance sheet shows real
  // calls. The report still downloads without it (graceful fallback).
  useEffect(() => {
    if (!processedData) { setCallCenter(null); return; }
    let stop = false;
    setCcLoading(true);
    (async () => {
      try {
        const target = parseMonthFromPeriod(processedData.period);
        const cc = await buildCallCenterAggregate(target);
        if (!stop) setCallCenter(hasCallCenterData(cc) ? cc : null);
      } catch {
        if (!stop) setCallCenter(null);
      } finally {
        if (!stop) setCcLoading(false);
      }
    })();
    return () => { stop = true; };
  }, [processedData]);

  const handleDownload = useCallback((mode) => {
    if (!processedData) return;
    downloadSocialMediaReport(processedData, { mode, callCenter });
    showToast({
      type: 'success',
      title: `${mode === 'cumulative' ? 'Cumulative' : 'Weekly'} Excel downloaded`,
      message: callCenter ? 'Includes Call Centre call volumes.' : 'Check your downloads folder.',
    });
  }, [processedData, callCenter, showToast]);

  const fmt = (n) => Math.round(n ?? 0).toLocaleString();
  const pct = (r) => `${Math.round((r ?? 0) * 100)}%`;

  return (
    <div className="pen-page">
      <div className="pen-header-bar">
        <h2 className="pen-header-title">SOCIAL MEDIA ANALYSIS</h2>
        <div className="pen-header-controls">
          <label className="sma-month-picker" title="Choose the month to analyse">
            <span className="sma-month-label">Month:</span>
            <select
              className="sma-month-select"
              value={selectedMonth}
              onChange={(e) => handleMonthChange(e.target.value)}
              disabled={loading || !months.length}
            >
              {!months.length && <option value="">Loading…</option>}
              {months.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <button type="button" className="pen-btn" onClick={() => handleGenerate()} disabled={loading}>
            <span>🔄</span>{loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {processedData && (
            <>
              <button type="button" className="pen-btn sma-btn-dl" onClick={() => handleDownload('weekly')}
                      disabled={ccLoading}
                      title={ccLoading ? 'Loading Call Centre calls…' : 'Each week shown on its own'}>
                <span>📥</span>Download Weekly
              </button>
              <button type="button" className="pen-btn sma-btn-dl" onClick={() => handleDownload('cumulative')}
                      disabled={ccLoading}
                      title={ccLoading ? 'Loading Call Centre calls…' : 'Week N = weeks 1…N combined'}>
                <span>📈</span>Download Cumulative
              </button>
              <button type="button" className="pen-btn sma-btn-email" onClick={() => setShowEmail(true)} disabled={ccLoading}>
                <span>✉</span>Send Email
              </button>
              {ccLoading && (
                <span className="sma-cc-hint" style={{ fontSize: '0.72rem', color: '#6b7280', alignSelf: 'center' }}>
                  loading call-centre calls…
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {err && (
        <div className="sma-error-banner">
          ⚠ {err}
        </div>
      )}

      {/* Landing card is now handled by the parent <ReportShell>. */}

      {loading && (
        <div className="sma-loading-card">
          <div className="sma-spinner" />
          <div className="sma-loading-text">Fetching live data from Google Sheets…</div>
        </div>
      )}

      {processedData && (
        <>
          {/* ── Headline stats ─────────────────────────────────────────────── */}
          <div className="sma-section">
            <div className="sma-section-label">Summary — {processedData.monthLabel}</div>
            <div className="sma-stats-row">
              <Stat label="Total Leads"  value={fmt(processedData.total)}                                     />
              <Stat label="Quality"      value={fmt(processedData.quality)}      color="#16a34a"
                    hint="Engaged leads — Converted, Qualified, Callback, Existing, Probation, Referred, Busy" />
              <Stat label="% Quality"    value={pct(processedData.qualityRate)}  color={processedData.qualityRate >= 0.3 ? '#16a34a' : '#b45309'} />
              <Stat label="Converted"    value={fmt(processedData.converted)}    color="#7c3aed" />
              <Stat label="Conv Rate"    value={pct(processedData.convRate)}     color={processedData.convRate >= 0.1 ? '#16a34a' : '#b45309'} />
              <Stat label="Agents"       value={fmt(processedData.agentCount)}   sub={`${processedData.callsPerAgent} calls / agent`} />
            </div>
          </div>

          {/* ── Per-product summary ────────────────────────────────────────── */}
          <div className="sma-section">
            <div className="sma-section-label">By Product</div>
            <div className="sma-table-wrap">
              <table className="sma-table">
                <thead>
                  <tr>
                    <th>PRODUCT</th>
                    <th style={{ textAlign: 'right' }}>AGENTS</th>
                    <th style={{ textAlign: 'right' }}>TOTAL</th>
                    <th style={{ textAlign: 'right' }}>QUALITY</th>
                    <th style={{ textAlign: 'right' }}>% QUALITY</th>
                    <th style={{ textAlign: 'right' }}>CONVERTED</th>
                    <th style={{ textAlign: 'right' }}>CONV %</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(processedData.byProduct).map(([p, a]) => (
                    <tr key={p}>
                      <td><span className={`sma-badge sma-badge--${p.toLowerCase()}`}>{p}</span></td>
                      <td style={{ textAlign: 'right' }}>{a.agents}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(a.total)}</td>
                      <td style={{ textAlign: 'right', color: '#16a34a' }}>{fmt(a.quality)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{a.total ? pct(a.quality / a.total) : '0%'}</td>
                      <td style={{ textAlign: 'right', color: '#7c3aed', fontWeight: 700 }}>{fmt(a.converted)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{a.total ? pct(a.converted / a.total) : '0%'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Loan amount per product (New / Repeat / Total) ────────────── */}
          <div className="sma-section">
            <div className="sma-section-label">
              Loan Amount by Product
              <span style={{ marginLeft: 8, fontSize: '0.7rem', color: '#9ca3af', fontWeight: 500 }}>
                amount (count of sales)
              </span>
            </div>
            <div className="sma-table-wrap">
              <table className="sma-table">
                <thead>
                  <tr>
                    <th>PRODUCT</th>
                    <th style={{ textAlign: 'right' }}>NEW</th>
                    <th style={{ textAlign: 'right' }}>REPEAT</th>
                    <th style={{ textAlign: 'right' }}>TOTAL LOAN AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(processedData.byProduct).map(([p, a]) => (
                    <tr key={p}>
                      <td><span className={`sma-badge sma-badge--${p.toLowerCase()}`}>{p}</span></td>
                      <td style={{ textAlign: 'right', color: '#1e40af' }}>
                        {(a.newLoanAmount || a.newSales)
                          ? <><strong>{fmt(a.newLoanAmount)}</strong> <span style={{ color: '#6b7280' }}>({fmt(a.newSales)})</span></>
                          : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', color: '#92400e' }}>
                        {(a.repeatLoanAmount || a.repeatSales)
                          ? <><strong>{fmt(a.repeatLoanAmount)}</strong> <span style={{ color: '#6b7280' }}>({fmt(a.repeatSales)})</span></>
                          : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#7c3aed' }}>
                        {a.loanAmount ? fmt(a.loanAmount) : <span style={{ color: '#d1d5db' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: '#f8fafc', fontWeight: 700, borderTop: '2px solid #e5e7eb' }}>
                    <td>TOTAL</td>
                    <td style={{ textAlign: 'right', color: '#1e40af' }}>
                      <strong>{fmt(processedData.newLoanAmount)}</strong>
                      <span style={{ color: '#6b7280', fontWeight: 500 }}> ({fmt(processedData.newSales)})</span>
                    </td>
                    <td style={{ textAlign: 'right', color: '#92400e' }}>
                      <strong>{fmt(processedData.repeatLoanAmount)}</strong>
                      <span style={{ color: '#6b7280', fontWeight: 500 }}> ({fmt(processedData.repeatSales)})</span>
                    </td>
                    <td style={{ textAlign: 'right', color: '#7c3aed' }}>
                      {fmt(processedData.loanAmount)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Per-platform preview ────────────────────────────────────────── */}
          <div className="sma-section">
            <div className="sma-section-label">By Platform</div>
            <div className="sma-table-wrap">
              <table className="sma-table">
                <thead>
                  <tr>
                    <th>PLATFORM</th>
                    <th style={{ textAlign: 'right' }}>TOTAL</th>
                    <th style={{ textAlign: 'right' }}>QUALITY</th>
                    <th style={{ textAlign: 'right' }}>% QUAL</th>
                    <th style={{ textAlign: 'right' }}>CONVERTED</th>
                    <th style={{ textAlign: 'right' }}>CONV %</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(processedData.byPlatform)
                    .sort(([, a], [, b]) => b.total - a.total)
                    .map(([name, a]) => (
                      <tr key={name}>
                        <td style={{ fontWeight: 600 }}>{name}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(a.total)}</td>
                        <td style={{ textAlign: 'right', color: '#16a34a' }}>{fmt(a.quality)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600,
                          color: a.total && a.quality/a.total >= 0.3 ? '#16a34a' : '#b45309' }}>
                          {a.total ? pct(a.quality / a.total) : '0%'}
                        </td>
                        <td style={{ textAlign: 'right', color: '#7c3aed', fontWeight: 700 }}>{fmt(a.converted)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600,
                          color: a.total && a.converted/a.total >= 0.1 ? '#16a34a' : '#b45309' }}>
                          {a.total ? pct(a.converted / a.total) : '0%'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Top agents ────────────────────────────────────────────────── */}
          <div className="sma-section">
            <div className="sma-section-label">
              Agent Ranking ({processedData.byAgent.length} agents)
            </div>
            <div className="sma-table-wrap">
              <table className="sma-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'right' }}>#</th>
                    <th>AGENT</th>
                    <th>SOURCE</th>
                    <th style={{ textAlign: 'right' }}>TOTAL CALLS</th>
                    <th style={{ textAlign: 'right' }}>QUALITY</th>
                    <th style={{ textAlign: 'right' }}>CONVERTED</th>
                    <th style={{ textAlign: 'right' }}>% QUAL</th>
                  </tr>
                </thead>
                <tbody>
                  {processedData.byAgent.slice(0, 50).map((a, i) => (
                    <tr key={i}>
                      <td style={{ textAlign: 'right', color: '#9ca3af' }}>{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{a.agent}</td>
                      <td><span className={`sma-badge sma-badge--${a.source.toLowerCase()}`}>{a.source}</span></td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(a.total)}</td>
                      <td style={{ textAlign: 'right', color: '#16a34a' }}>{fmt(a.quality)}</td>
                      <td style={{ textAlign: 'right', color: '#7c3aed', fontWeight: 700 }}>{fmt(a.converted)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{a.total ? pct(a.quality / a.total) : '0%'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {processedData.byAgent.length > 50 && (
                <p style={{ fontSize: '0.75rem', color: '#6b7280', padding: '8px 0' }}>
                  Showing top 50 of {processedData.byAgent.length}. Download Excel for full ranking.
                </p>
              )}
            </div>
          </div>

          {/* ── Dispositions — flat list with line separators ───────────── */}
          <div className="sma-section">
            <div className="sma-section-label">Dispositions</div>
            <div className="sma-disp-list">
              {processedData.byStatus.map((s) => {
                const slug = s.status.toLowerCase().replace(/\s+/g, '-');
                return (
                  <div key={s.status} className="sma-disp-row">
                    <div className="sma-disp-name">
                      <span className={`sma-disp-dot sma-disp-dot--${slug}`} />
                      {s.status}
                    </div>
                    <div className="sma-disp-bar">
                      <div className="sma-disp-bar-fill" style={{ width: `${(s.pct * 100).toFixed(1)}%` }} />
                    </div>
                    <div className="sma-disp-count">{fmt(s.count)}</div>
                    <div className="sma-disp-pct">{pct(s.pct)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {showEmail && processedData && (
        <EmailModal processedData={processedData} callCenter={callCenter} onClose={() => setShowEmail(false)} showToast={showToast} />
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

export default SocialMediaAnalysis;
