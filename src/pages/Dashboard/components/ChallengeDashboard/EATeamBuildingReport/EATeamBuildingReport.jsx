import { useState, useEffect, useCallback, useRef } from 'react';
// NOTE: `localTripAPI` is the existing /api/local-trip/* backend endpoint that
// stores the four source files (SALES / USERS / ACTIVITIES / LOAN). It is
// shared across all challenge reports (Team Building, Local Trip, EA Team
// Building, EA Trip) since they all consume the same four data files. The
// backend route name is legacy and should be renamed to e.g. /api/challenge/*
// in a follow-up server-side migration; the frontend identifier here is kept
// untouched on purpose so this rename PR stays purely cosmetic.
import { localTripAPI } from '../../../../../services/api';
import { sendScoreCardEmail } from '../../DepartmentalDashboard/utils/emailScoreCard';
import { buildEATeamBuildingEmailHTML } from './utils/eaTeamBuildingEmailTemplate';
import { processEATeamBuildingReport } from './utils/eaTeamBuildingProcessor';
import {
  downloadEATeamBuildingReport,
  buildEATeamBuildingReportBuffer,
  bufferToBase64,
  fmtSize,
} from './utils/eaTeamBuildingExport';
import { Toast, ConfirmDialog } from '../../../../../components/feedback/Feedback';
import CriteriaFileManager from '../shared/CriteriaFileManager';
import './EATeamBuildingReport.css';

const EATBR_RECIPIENTS_KEY = 'eatbr_email_recipients';

// ── file-type definitions ─────────────────────────────────────────────────────
const FILE_TYPES = [
  {
    kind:  'SALES',
    icon:  '📊',
    label: 'Sales File',
    desc:  'Must have two sheets: "Sales" (loan data) and "Target" (TL & region targets)',
  },
  {
    kind:  'USERS',
    icon:  '👥',
    label: 'Users File',
    desc:  'Agent roles and branch mapping',
  },
  {
    kind:  'ACTIVITIES',
    icon:  '📋',
    label: 'Activities File',
    desc:  'Agent activity creation dates — used to classify Old vs New agents',
  },
  {
    kind:  'LOAN',
    icon:  '📑',
    label: 'Loan File',
    desc:  'Loan Accounts sheet — used to calculate PAR>30 for TL & Region qualification',
  },
];

const PRODUCT_LABELS = {
  CS:  'CS — Civil Servant',
  LBF: 'LBF — Log Book Finance',
  SME: 'SME — Small & Medium Enterprise',
};

// ── EmailModal ────────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EmailModal({ processedData, onClose }) {
  const { summary, monthsInData } = processedData;

  const [recipients, setRecipients] = useState(() => {
    try { return JSON.parse(localStorage.getItem(EATBR_RECIPIENTS_KEY) || '[]'); } catch { return []; }
  });
  const [newEmail,  setNewEmail]  = useState('');
  const [pasteBox,  setPasteBox]  = useState('');
  const [subject,   setSubject]   = useState(
    `EAST AFRICA TEAM BUILDING REPORT — ALL PCL STAFF (KE & UG) — ${monthsInData.join(' · ')}`
  );
  const [sending,  setSending]  = useState(false);
  const [progress, setProgress] = useState(null);
  const [err,      setErr]      = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(EATBR_RECIPIENTS_KEY, JSON.stringify(recipients)); } catch {}
  }, [recipients]);

  const parseEmails = (text) =>
    [...new Set(
      text.split(/[\n,;\t]+/).map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s))
    )];

  const addEmail = () => {
    const e = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) { setErr('Enter a valid email address.'); return; }
    if (recipients.includes(e)) { setErr('Already in the list.'); return; }
    setRecipients((prev) => [...prev, e]);
    setNewEmail('');
    setErr('');
  };

  const removeEmail = (e) => setRecipients((prev) => prev.filter((r) => r !== e));

  const pasteFromClipboard = async () => {
    try {
      const text  = await navigator.clipboard.readText();
      const toAdd = parseEmails(text).filter((e) => !recipients.includes(e));
      if (!toAdd.length) { setErr('No new valid emails found in clipboard.'); return; }
      setRecipients((prev) => [...prev, ...toAdd]);
      setErr('');
    } catch {
      setErr('Clipboard access denied — use the paste box below.');
    }
  };

  const addPasted = () => {
    const toAdd = parseEmails(pasteBox).filter((e) => !recipients.includes(e));
    if (!toAdd.length) { setErr('No valid emails found.'); return; }
    setRecipients((prev) => [...prev, ...toAdd]);
    setPasteBox('');
    setErr('');
  };

  const handleSend = useCallback(async () => {
    if (!recipients.length) { setErr('Add at least one recipient.'); return; }
    setSending(true);
    setErr('');
    setProgress(recipients.map((email) => ({ email, status: 'sending' })));
    try {
      const { buffer, fileName } = buildEATeamBuildingReportBuffer(processedData);
      const base64   = bufferToBase64(buffer);
      const htmlBody = buildEATeamBuildingEmailHTML(summary, monthsInData);
      const result   = await sendScoreCardEmail(recipients, subject, htmlBody, {
        mode: 'REPORT', attachmentBase64: base64, attachmentName: fileName,
      });
      const status = result.success ? 'success' : 'failed';
      const errMsg = result.success ? null : (result.error || 'Failed to send');
      setProgress((prev) => prev.map((p) => ({ ...p, status, error: errMsg })));
    } catch (e) {
      const msg = e?.message || 'Unexpected error.';
      setProgress((prev) => prev.map((p) => ({ ...p, status: 'failed', error: msg })));
    } finally {
      setSending(false);
    }
  }, [recipients, subject, processedData, summary, monthsInData]);

  const allDone    = progress && !sending;
  const allSuccess = allDone && progress.every((p) => p.status === 'success');

  return (
    <div className="eatbr-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
      <div className="eatbr-modal eatbr-modal--email">

        {/* header */}
        <div className="eatbr-modal-header">
          <h2 className="eatbr-modal-title">✉️ Send Report by Email</h2>
          <button className="eatbr-modal-close" onClick={onClose} disabled={sending}>×</button>
        </div>

        {/* progress banner */}
        {progress && (
          <div className={`eatbr-progress-banner ${allSuccess ? 'eatbr-progress-banner--ok' : ''}`}>
            <div className="eatbr-progress-title">
              {sending ? 'Sending…' : allSuccess ? '✓ Sent successfully' : 'Send result'}
            </div>
            <ul className="eatbr-progress-list">
              {progress.map(({ email, status, error }) => (
                <li key={email} className={`eatbr-progress-item eatbr-progress-item--${status}`}>
                  <span className="eatbr-progress-email">{email}</span>
                  <span className="eatbr-progress-icon">
                    {status === 'sending' && '⏳'}
                    {status === 'success' && '✓'}
                    {status === 'failed'  && '✗'}
                  </span>
                  {status === 'failed' && error && <span className="eatbr-progress-err">{error}</span>}
                </li>
              ))}
            </ul>
            {allDone && (
              <button className="eatbr-btn eatbr-btn--cancel" style={{ marginTop: 10 }} onClick={onClose}>
                Close
              </button>
            )}
          </div>
        )}

        {!progress && (
          <div className="eatbr-modal-body">

            {/* subject */}
            <p className="eatbr-modal-label">Subject</p>
            <input
              className="eatbr-modal-input"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />

            {/* add recipient */}
            <p className="eatbr-modal-label">
              Recipients <span className="eatbr-modal-hint">(saved for next time)</span>
            </p>
            <div className="eatbr-recipient-row">
              <input
                ref={inputRef}
                className="eatbr-modal-input"
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addEmail()}
              />
              <button className="eatbr-btn eatbr-btn--upload" onClick={addEmail}>Add</button>
              <button className="eatbr-btn eatbr-btn--replace" onClick={pasteFromClipboard} title="Paste from clipboard">
                📋 Paste
              </button>
            </div>

            {/* chips */}
            {recipients.length > 0 && (
              <div className="eatbr-recipient-chips">
                {recipients.map((e) => (
                  <span key={e} className="eatbr-recipient-chip">
                    {e}
                    <button className="eatbr-chip-remove" onClick={() => removeEmail(e)}>×</button>
                  </span>
                ))}
              </div>
            )}

            {/* paste box */}
            <details className="eatbr-paste-details">
              <summary className="eatbr-paste-summary">Paste multiple emails at once</summary>
              <textarea
                className="eatbr-modal-textarea"
                rows={3}
                placeholder="One per line, or comma / semicolon separated"
                value={pasteBox}
                onChange={(e) => setPasteBox(e.target.value)}
              />
              <button className="eatbr-btn eatbr-btn--replace" onClick={addPasted}>Add pasted</button>
            </details>

            {/* attachment note */}
            <div className="eatbr-modal-note">
              📎 <strong>EA_Team_Building_Report_{new Date().toISOString().slice(0, 10)}.xlsx</strong>
              <br />Includes: Summary · All Agents · Qualified · Not Qualified sheets.
            </div>

            {err && <div className="eatbr-error">{err}</div>}

            {/* actions */}
            <div className="eatbr-modal-actions">
              <button className="eatbr-btn eatbr-btn--cancel" onClick={onClose}>Cancel</button>
              <button
                className="eatbr-btn eatbr-btn--email eatbr-btn--lg"
                onClick={handleSend}
                disabled={!recipients.length}
              >
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
      const result = await localTripAPI.uploadFile(file, typeDef.kind);
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
      setUploading(false);
      e.target.value = '';
    }
  }, [typeDef.kind, typeDef.label, onUploaded, showToast]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!fileRecord) return;
    setConfirmOpen(false);
    setDeleting(true); setErr('');
    try {
      await localTripAPI.deleteFile(fileRecord.id);
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
    <div className="eatbr-upload-row">
      <div className={`eatbr-dot ${hasFile ? 'eatbr-dot--ready' : 'eatbr-dot--missing'}`} />
      <div className="eatbr-upload-icon">{typeDef.icon}</div>
      <div className="eatbr-upload-info">
        <div className="eatbr-upload-title">{typeDef.label}</div>
        {hasFile ? (
          <>
            <div className="eatbr-upload-filename" title={fileRecord.fileName}>{fileRecord.fileName}</div>
            <div className="eatbr-upload-meta">
              {fmtSize(fileRecord.fileSize)} · {new Date(fileRecord.createdAt).toLocaleDateString('en-GB')}
            </div>
          </>
        ) : (
          <div className="eatbr-upload-desc">{typeDef.desc}</div>
        )}
        {err && <div className="eatbr-error">{err}</div>}
      </div>

      <div className="eatbr-btn-group">
        {hasFile ? (
          <>
            <button className="eatbr-btn eatbr-btn--replace" onClick={() => inputRef.current?.click()} disabled={uploading || deleting}>
              {uploading ? 'Uploading…' : '↩ Replace'}
            </button>
            <button className="eatbr-btn eatbr-btn--delete" onClick={() => setConfirmOpen(true)} disabled={uploading || deleting}>
              {deleting ? '…' : '🗑'}
            </button>
          </>
        ) : (
          <button className="eatbr-btn eatbr-btn--upload" onClick={() => inputRef.current?.click()} disabled={uploading}>
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

// ── In-page preview table (merged cells via rowSpan) ─────────────────────────
function PreviewTable({ hierarchy, monthsInData }) {
  const pct      = (amt, tgt) => tgt > 0 ? `${Math.round((amt / tgt) * 100)}%` : '—';
  const pctRatio = (amt, tgt) => tgt > 0 ? amt / tgt : 0;
  const cmpAmt   = (aAmt, aTgt, bAmt, bTgt) => {
    const d = pctRatio(bAmt, bTgt) - pctRatio(aAmt, aTgt);
    return d !== 0 ? d : bAmt - aAmt;
  };
  const pctColor = (amt, tgt) => {
    if (!tgt) return undefined;
    const v = amt / tgt;
    return v >= 1 ? '#16a34a' : v >= 0.75 ? '#b45309' : '#dc2626';
  };

  const months = monthsInData;
  const productOrder = ['CS', 'LBF', 'SME'];
  const products = [
    ...productOrder.filter((p) => hierarchy[p]),
    ...Object.keys(hierarchy).filter((p) => !productOrder.includes(p)),
  ].sort((a, b) => cmpAmt(hierarchy[a].totalAmount, hierarchy[a].target, hierarchy[b].totalAmount, hierarchy[b].target));

  // ── Build flat row list so we can apply rowSpan correctly ──────────────────
  const flatRows = [];
  products.forEach((product) => {
    const pObj = hierarchy[product];
    const sortedRegions = Object.entries(pObj.regions)
      .sort(([, a], [, b]) => cmpAmt(a.totalAmount, a.target, b.totalAmount, b.target));
    const productTotal = sortedRegions
      .reduce((s, [, r]) => s + Object.values(r.branches).reduce((s2, b) => s2 + b.agents.length, 0), 0);
    let pFirst = true;

    sortedRegions.forEach(([region, rObj]) => {
      const sortedBranches = Object.entries(rObj.branches)
        .sort(([, a], [, b]) => cmpAmt(a.totalAmount, a.target, b.totalAmount, b.target));
      const regionTotal = sortedBranches.reduce((s, [, b]) => s + b.agents.length, 0);
      let rFirst = true;

      sortedBranches.forEach(([branch, bObj]) => {
        const branchTotal = bObj.agents.length;
        const sortedAgents = [...bObj.agents].sort((a, b) => cmpAmt(a.totalAmount, a.target, b.totalAmount, b.target));
        let bFirst = true;

        sortedAgents.forEach((agent, idx) => {
          flatRows.push({
            product, pObj, productTotal, pFirst,
            region,  rObj, regionTotal,  rFirst,
            branch,  bObj, branchTotal,  bFirst,
            agent, idx,
          });
          pFirst = false;
          rFirst = false;
          bFirst = false;
        });
      });
    });
  });

  // ── Merged-cell content renderers ──────────────────────────────────────────
  const ProductCell = ({ product, pObj, rowSpan }) => (
    <td rowSpan={rowSpan} className="eatbr-merged-product">
      <div className="eatbr-merged-name">
        <span className={`eatbr-badge eatbr-badge--${product.toLowerCase()}`}>{product}</span>
        {' '}{PRODUCT_LABELS[product] ?? product}
      </div>
      <div className="eatbr-merged-meta">
        Tgt: {Math.round(pObj.target / 1_000_000).toLocaleString()}M
        &nbsp;·&nbsp;Act: {Math.round(pObj.totalAmount / 1_000_000).toLocaleString()}M
      </div>
      <div className="eatbr-merged-meta" style={{ fontWeight: 700, color: pctColor(pObj.totalAmount, pObj.target) }}>
        {pct(pObj.totalAmount, pObj.target)}
        &nbsp;·&nbsp;{pObj.totalLoans.toLocaleString()} loans
      </div>
      <div className="eatbr-merged-meta">
        {pObj.qualCount} qualified
      </div>
    </td>
  );

  const RegionCell = ({ region, rObj, rowSpan }) => {
    const regPct = rObj.target > 0 ? Math.round((rObj.totalAmount / rObj.target) * 100) : 0;
    return (
      <td rowSpan={rowSpan} className="eatbr-merged-region">
        <div className="eatbr-merged-name">{region}</div>
        <div className="eatbr-merged-meta">
          Tgt: {Math.round(rObj.target / 1_000_000).toLocaleString()}M
          &nbsp;·&nbsp;Act: {Math.round(rObj.totalAmount / 1_000_000).toLocaleString()}M
        </div>
        <div className="eatbr-merged-meta">{rObj.totalLoans.toLocaleString()} loans</div>
        <div className="eatbr-merged-meta">
          Achv: <strong style={{ color: regPct >= 100 ? '#16a34a' : '#dc2626' }}>{regPct}%</strong>
          &nbsp;·&nbsp;PAR&gt;30: <strong style={{ color: (rObj.regionPar30 ?? 0) <= 0.04 ? '#16a34a' : '#dc2626' }}>
            {((rObj.regionPar30 ?? 0) * 100).toFixed(1)}%
          </strong>
        </div>
        <div className={`eatbr-qual-badge ${rObj.regionQualified ? 'eatbr-qual--yes' : 'eatbr-qual--no'}`}>
          {rObj.regionQualified ? '✓ QUALIFIED' : '✗ NOT QUALIFIED'}
        </div>
        {!rObj.regionQualified && rObj.regionReason && (
          <div className="eatbr-qual-reason">{rObj.regionReason}</div>
        )}
      </td>
    );
  };

  const BranchCell = ({ branch, bObj, rowSpan }) => {
    const tlPct = bObj.target > 0 ? Math.round((bObj.totalAmount / bObj.target) * 100) : 0;
    return (
      <td rowSpan={rowSpan} className="eatbr-merged-branch">
        <div className="eatbr-merged-name">{branch}</div>
        {bObj.tlName && <div className="eatbr-merged-meta" style={{ fontStyle: 'italic' }}>TL: {bObj.tlName}</div>}
        <div className="eatbr-merged-meta">
          Tgt: {Math.round(bObj.target / 1_000_000).toLocaleString()}M
          &nbsp;·&nbsp;Act: {Math.round(bObj.totalAmount / 1_000_000).toLocaleString()}M
        </div>
        <div className="eatbr-merged-meta">
          Achv: <strong style={{ color: tlPct >= 100 ? '#16a34a' : '#dc2626' }}>{tlPct}%</strong>
          &nbsp;·&nbsp;PAR&gt;30: <strong style={{ color: (bObj.tlPar30 ?? 0) <= 0.04 ? '#16a34a' : '#dc2626' }}>
            {((bObj.tlPar30 ?? 0) * 100).toFixed(1)}%
          </strong>
        </div>
        <div className={`eatbr-qual-badge ${bObj.tlQualified ? 'eatbr-qual--yes' : 'eatbr-qual--no'}`}>
          {bObj.tlQualified ? '✓ QUALIFIED' : '✗ NOT QUAL.'}
        </div>
        {!bObj.tlQualified && bObj.tlReason && (
          <div className="eatbr-qual-reason">{bObj.tlReason}</div>
        )}
      </td>
    );
  };

  return (
    <div className="eatbr-table-wrap">
      <table className="eatbr-table">
        <thead>
          <tr>
            <th>PRODUCT</th>
            <th>REGION</th>
            <th>BRANCH / TL</th>
            <th>#</th>
            <th>SALES REP.</th>
            <th>TITLE</th>
            <th>CAT.</th>
            <th>PERIOD JOINED</th>
            <th>FLAG</th>
            {months.map((m) => (
              <th key={m} style={{ textAlign: 'right' }}>{m.slice(0, 3).toUpperCase()}</th>
            ))}
            <th style={{ textAlign: 'right' }}>LOANS</th>
            <th style={{ textAlign: 'right' }}>AMOUNT (TZS)</th>
            <th style={{ textAlign: 'right' }}>TARGET</th>
            <th style={{ textAlign: 'right' }}>%</th>
            <th style={{ textAlign: 'center' }}>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {flatRows.map((row, i) => (
            <tr key={i} className="eatbr-row--agent">
              {row.pFirst && <ProductCell product={row.product} pObj={row.pObj} rowSpan={row.productTotal} />}
              {row.rFirst && <RegionCell  region={row.region}  rObj={row.rObj}  rowSpan={row.regionTotal}  />}
              {row.bFirst && <BranchCell  branch={row.branch}  bObj={row.bObj}  rowSpan={row.branchTotal}  />}

              <td style={{ textAlign: 'right', color: 'var(--eatbr-text-muted,#9ca3af)' }}>{row.idx + 1}</td>
              <td style={{ fontWeight: 600 }}>{row.agent.repName}</td>
              <td style={{ color: 'var(--eatbr-text-muted,#6b7280)', fontSize: '0.74rem' }}
                  title={row.agent.role || ''}>
                {row.agent.title || row.agent.role || '—'}
              </td>
              <td>
                <span className={`eatbr-badge eatbr-badge--${row.agent.flag === 'Yes' ? 'old' : 'new'}`}>
                  {row.agent.flag === 'Yes' ? 'Old' : 'New'}
                </span>
              </td>
              <td style={{ fontSize: '0.74rem' }}>{row.agent.period || 'Unknown'}</td>
              <td>
                <span className={`eatbr-badge eatbr-badge--${row.agent.flag === 'Yes' ? 'yes' : 'no'}`}>
                  {row.agent.flag}
                </span>
              </td>

              {months.map((m) => {
                const mo = row.agent.monthly[m] ?? { amt: 0, loans: 0 };
                return (
                  <td key={m} style={{ textAlign: 'right', color: mo.amt > 0 ? 'inherit' : 'var(--eatbr-text-muted,#9ca3af)' }}>
                    {mo.amt > 0
                      ? <>{Math.round(mo.amt).toLocaleString()}<span style={{ fontSize: '0.65rem', marginLeft: 3, opacity: 0.6 }}>({mo.loans})</span></>
                      : '—'}
                  </td>
                );
              })}

              <td style={{ textAlign: 'right', fontWeight: 600 }}>{row.agent.totalLoans}</td>
              <td style={{ textAlign: 'right' }}>{Math.round(row.agent.totalAmount).toLocaleString()}</td>
              <td style={{ textAlign: 'right', color: 'var(--eatbr-text-muted,#9ca3af)' }}>
                {row.agent.target ? row.agent.target.toLocaleString() : '—'}
              </td>
              <td style={{ textAlign: 'right', fontWeight: 700, color: pctColor(row.agent.totalAmount, row.agent.target) }}>
                {pct(row.agent.totalAmount, row.agent.target)}
              </td>
              <td style={{ textAlign: 'center' }}>
                <span className={`eatbr-badge ${row.agent.qualified ? 'eatbr-badge--yes' : 'eatbr-badge--no'}`}>
                  {row.agent.qualified ? 'QUALIFIED' : 'NOT QUALIFIED'}
                </span>
                {!row.agent.qualified && row.agent.qualReason && (
                  <div className="eatbr-qual-reason">{row.agent.qualReason}</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Summary stats ─────────────────────────────────────────────────────────────
function SummaryStats({ summary }) {
  const { totalAgents, totalLoans, totalAmount, qualified, notQualified,
          qualifiedTLs, qualifiedRegions, oldAgents, newAgents, byProduct } = summary;
  return (
    <div className="eatbr-stats-row">
      <div className="eatbr-stat">
        <div className="eatbr-stat-value">{totalAgents.toLocaleString()}</div>
        <div className="eatbr-stat-label">Total Agents</div>
      </div>
      <div className="eatbr-stat eatbr-stat--green">
        <div className="eatbr-stat-value">{(qualified ?? 0).toLocaleString()}</div>
        <div className="eatbr-stat-label">Qualified Reps</div>
      </div>
      <div className="eatbr-stat" style={{ '--stat-color': '#dc2626' }}>
        <div className="eatbr-stat-value" style={{ color: '#dc2626' }}>{(notQualified ?? 0).toLocaleString()}</div>
        <div className="eatbr-stat-label">Not Qualified</div>
      </div>
      <div className="eatbr-stat eatbr-stat--green">
        <div className="eatbr-stat-value">{(qualifiedTLs ?? 0).toLocaleString()}</div>
        <div className="eatbr-stat-label">Qualified TLs</div>
      </div>
      <div className="eatbr-stat eatbr-stat--green">
        <div className="eatbr-stat-value">{(qualifiedRegions ?? 0).toLocaleString()}</div>
        <div className="eatbr-stat-label">Qualified Regions</div>
      </div>
      <div className="eatbr-stat eatbr-stat--blue">
        <div className="eatbr-stat-value">{totalLoans.toLocaleString()}</div>
        <div className="eatbr-stat-label">Total Loans</div>
      </div>
      <div className="eatbr-stat eatbr-stat--purple">
        <div className="eatbr-stat-value">{Math.round(totalAmount / 1_000_000).toLocaleString()}M</div>
        <div className="eatbr-stat-label">Disbursed (TZS)</div>
      </div>
      <div className="eatbr-stat">
        <div className="eatbr-stat-value">{oldAgents}</div>
        <div className="eatbr-stat-label">Old Agents</div>
      </div>
      <div className="eatbr-stat">
        <div className="eatbr-stat-value">{newAgents}</div>
        <div className="eatbr-stat-label">New Agents</div>
      </div>
      {Object.entries(byProduct).map(([p, b]) => (
        <div key={p} className="eatbr-stat">
          <div className="eatbr-stat-value">
            {Math.round(b.totalAmount / 1_000_000).toLocaleString()}M
            {b.target > 0 && (
              <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--eatbr-text-muted,#6b7280)' }}>
                {' '}/ {Math.round(b.target / 1_000_000)}M
              </span>
            )}
          </div>
          <div className="eatbr-stat-label">{p} · {b.qualified ?? 0} qualified</div>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
const EATeamBuildingReport = () => {
  const [files,         setFiles]         = useState({});
  const [loading,       setLoading]       = useState(true);
  const [processing,    setProcessing]    = useState(false);
  const [processedData, setProcessedData] = useState(null);
  const [showEmail,     setShowEmail]     = useState(false);
  const [procErr,       setProcErr]       = useState('');
  const [toast,         setToast]         = useState(null);
  const showToast = useCallback((t) => setToast({ ...t, _id: Date.now() }), []);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const list = await localTripAPI.getFiles();
      const map  = {};
      list.forEach((f) => { if (['SALES','USERS','ACTIVITIES','LOAN'].includes(f.kind)) map[f.kind] = f; });
      setFiles(map);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

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

  const statusClass = allReady  ? 'eatbr-status--ready'
    : readyCount > 0            ? 'eatbr-status--partial'
    :                             'eatbr-status--missing';
  const statusLabel = allReady
    ? '✔ All files ready'
    : `${readyCount} / ${FILE_TYPES.length} files uploaded`;

  const handleGenerate = useCallback(async () => {
    if (!allReady) return;
    setProcessing(true);
    setProcErr('');
    setProcessedData(null);
    try {
      const [sBuf, uBuf, aBuf, lBuf] = await Promise.all([
        localTripAPI.downloadFileBuffer(files.SALES.id),
        localTripAPI.downloadFileBuffer(files.USERS.id),
        localTripAPI.downloadFileBuffer(files.ACTIVITIES.id),
        localTripAPI.downloadFileBuffer(files.LOAN.id),
      ]);
      const result = processEATeamBuildingReport(sBuf, uBuf, aBuf, lBuf);
      setProcessedData(result);
    } catch (e) {
      setProcErr(e?.message || 'Processing failed. Check the uploaded files.');
    } finally {
      setProcessing(false);
    }
  }, [allReady, files]);

  const handleDownload = useCallback(() => {
    if (processedData) downloadEATeamBuildingReport(processedData);
  }, [processedData]);

  return (
    <div className="eatbr-root">

      {/* ── header ── */}
      <div className="eatbr-header">
        <h1 className="eatbr-title">EA Team Building Report</h1>
        <div className="eatbr-audience">ALL PCL STAFF (KE & UG)</div>
        <p className="eatbr-subtitle">
          Upload the four source files, generate the report, then download or email.
        </p>
      </div>

      {/* ── Criteria file (admin-managed) ────────────────────────────────── */}
      <CriteriaFileManager
        reportType="EA_TEAM_BUILDING_CRITERIA"
        title="EA Team Building Criteria — All PCL Staff (KE & UG)"
      />

      {/* ── file uploads ── */}
      <div className="eatbr-section">
        <div className="eatbr-section-label">Source Files</div>
        {loading ? (
          <div className="eatbr-spinner-wrap">
            <div className="eatbr-spinner" />
            <span>Loading…</span>
          </div>
        ) : (
          <div className="eatbr-upload-list">
            {FILE_TYPES.map((t) => (
              <UploadRow
                key={t.kind}
                typeDef={t}
                fileRecord={files[t.kind] ?? null}
                onUploaded={handleUploaded}
                onDeleted={handleDeleted}
                showToast={showToast}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── action bar ── */}
      {!loading && (
        <div className="eatbr-section">
          <div className="eatbr-action-bar">
            <span className={`eatbr-status ${statusClass}`}>{statusLabel}</span>

            <button
              className="eatbr-btn eatbr-btn--gen eatbr-btn--lg"
              onClick={handleGenerate}
              disabled={!allReady || processing}
            >
              {processing ? '⏳ Processing…' : '⚙ Generate Report'}
            </button>

            {processedData && (
              <>
                <button className="eatbr-btn eatbr-btn--dl eatbr-btn--lg" onClick={handleDownload}>
                  ⬇ Download Excel
                </button>
                <button className="eatbr-btn eatbr-btn--email eatbr-btn--lg" onClick={() => setShowEmail(true)}>
                  ✉️ Send Email
                </button>
              </>
            )}

            <span className="eatbr-action-note">
              {allReady ? `Months covered once generated` : `${FILE_TYPES.length - readyCount} file(s) still needed`}
            </span>
          </div>

          {procErr && <div className="eatbr-error" style={{ marginTop: 10 }}>⚠ {procErr}</div>}
        </div>
      )}

      {/* ── results ── */}
      {processedData && (
        <div className="eatbr-section">
          <div className="eatbr-section-label">
            Results — {processedData.summary.monthsInData.join(', ')}
          </div>

          <SummaryStats summary={processedData.summary} />

          <PreviewTable
            hierarchy={processedData.hierarchy}
            monthsInData={processedData.monthsInData}
          />
        </div>
      )}

      {/* ── email modal ── */}
      {showEmail && processedData && (
        <EmailModal processedData={processedData} onClose={() => setShowEmail(false)} />
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

export default EATeamBuildingReport;
