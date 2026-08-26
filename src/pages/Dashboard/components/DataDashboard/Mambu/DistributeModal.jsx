import { useCallback, useEffect, useState } from 'react';
import { mambuAPI } from '../../../../../services/api';
import './DistributeModal.css';

/**
 * DISTRIBUTE — email a finished run out to the people who have to work it.
 *
 * This puts client lists in branch inboxes and cannot be taken back, so it is
 * deliberately two steps: the modal opens on a PREVIEW that sends nothing and
 * shows exactly which addresses would receive which file, and only the second,
 * explicit press sends. Anything the roster has no email for is listed
 * separately rather than quietly dropped.
 *
 * "Send a test copy to me instead" redirects every email to the operator, so a
 * distribution can be rehearsed before it reaches anyone.
 */

const MODE_TEXT = {
  branch: {
    title: 'Distribute to branches',
    what: 'Each branch gets its own workbook, sent to that branch’s team leaders and branch loan officers.',
  },
  cluster: {
    title: 'Distribute to clusters',
    what: 'Each cluster manager gets one zip containing the workbook for every branch in their cluster.',
  },
  unallocated: {
    title: 'Distribute unallocated clients',
    what: 'Clients nobody owns. Products with a call centre send the whole list there; the rest go back to the branch each client belongs to.',
  },
};

const fmtNum = (n) => Number(n || 0).toLocaleString();

const DistributeModal = ({ runId, mode, product, label, onClose }) => {
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [testMode, setTestMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const text = MODE_TEXT[mode] || MODE_TEXT.branch;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await mambuAPI.previewDistribution({ runId, mode, product });
      if (!res?.success) throw new Error(res?.error || 'Could not build the preview');
      setPreview(res);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [runId, mode, product]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const send = async () => {
    setSending(true);
    setError('');
    try {
      const res = await mambuAPI.sendDistribution({ runId, mode, product, testMode });
      if (!res?.success) throw new Error(res?.error || 'Send failed');
      setResult(res);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSending(false);
    }
  };

  const willSend = preview?.willSend || [];
  const cannotSend = preview?.cannotSend || [];
  const nothingToSend = !loading && willSend.length === 0;

  return (
    <div className="dist-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
      <div className="dist-modal" role="dialog" aria-modal="true" aria-label={text.title}>
        <div className="dist-head">
          <div>
            <h3 className="dist-title">{text.title} — {label}</h3>
            <p className="dist-sub">{text.what}</p>
          </div>
          <button className="dist-x" onClick={onClose} disabled={sending} aria-label="Close">×</button>
        </div>

        {loading && <div className="dist-body dist-muted">Working out who would receive what…</div>}

        {error && <div className="dist-notice is-bad">{error}</div>}

        {/* --- after sending --- */}
        {result && (
          <div className="dist-body">
            <div className={`dist-notice ${result.failed ? 'is-warn' : 'is-ok'}`}>
              {result.message}
            </div>
            <table className="dist-table">
              <thead>
                <tr><th>Product</th><th>Sent to</th><th>Status</th></tr>
              </thead>
              <tbody>
                {result.results.map((r, i) => (
                  <tr key={`${r.target}-${i}`}>
                    <td>{r.product}</td>
                    <td>{r.target}</td>
                    <td>
                      <span className={`dist-pill dist-pill--${String(r.status).toLowerCase()}`}>
                        {r.status}
                      </span>
                      {r.reason && <span className="dist-reason"> {r.reason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* --- before sending --- */}
        {!result && preview && (
          <>
            <div className="dist-body">
              {nothingToSend ? (
                <div className="dist-notice is-warn">
                  There is nothing to send. Nobody on the roster for this product has
                  an email address on the Zone and Clusters sheet.
                </div>
              ) : (
                <div className="dist-summary">
                  <div>
                    <b>{fmtNum(preview.emailCount)}</b> email{preview.emailCount === 1 ? '' : 's'} to{' '}
                    <b>{fmtNum(preview.addressCount)}</b> address{preview.addressCount === 1 ? '' : 'es'},
                    covering <b>{fmtNum(preview.rowCount)}</b> clients.
                  </div>
                  <div className="dist-from">Sent from {preview.sender}</div>
                </div>
              )}

              {preview.notes?.length > 0 && (
                <ul className="dist-notes">
                  {preview.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}

              {willSend.length > 0 && (
                <>
                  <div className="dist-sec">Will be sent</div>
                  <div className="dist-scroll">
                    <table className="dist-table">
                      <thead>
                        <tr>
                          <th>Product</th><th>To</th><th className="num">Clients</th>
                          <th className="num">Files</th><th>Addresses</th>
                        </tr>
                      </thead>
                      <tbody>
                        {willSend.map((t, i) => (
                          <tr key={`${t.product}-${t.target}-${i}`}>
                            <td>{t.product}</td>
                            <td>{t.target}</td>
                            <td className="num">{fmtNum(t.rows)}</td>
                            <td className="num">{t.files.length}</td>
                            <td className="dist-emails">{t.emails.join(', ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {cannotSend.length > 0 && (
                <>
                  <div className="dist-sec">
                    Cannot be sent — nobody on the roster has an email address
                  </div>
                  <div className="dist-scroll">
                    <table className="dist-table">
                      <thead>
                        <tr><th>Product</th><th>Who it was for</th><th className="num">Clients</th></tr>
                      </thead>
                      <tbody>
                        {cannotSend.map((t, i) => (
                          <tr key={`${t.product}-${t.target}-${i}`}>
                            <td>{t.product}</td>
                            <td>{t.target}</td>
                            <td className="num">{fmtNum(t.rows)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="dist-hint">
                    Add an email for these people on the Zone and Clusters sheet and
                    run the distribution again — the report itself does not need rebuilding.
                  </p>
                </>
              )}
            </div>

            <div className="dist-foot">
              <label className="dist-check">
                <input
                  type="checkbox"
                  checked={testMode}
                  onChange={(e) => setTestMode(e.target.checked)}
                  disabled={sending}
                />
                <span>
                  Send a test copy to me instead
                  {preview.testRecipient ? ` (${preview.testRecipient})` : ''} — nothing
                  reaches the branches
                </span>
              </label>

              <div className="dist-foot-actions">
                <button className="dist-btn dist-btn--ghost" onClick={onClose} disabled={sending}>
                  Cancel
                </button>
                <button
                  className="dist-btn"
                  onClick={send}
                  disabled={sending || nothingToSend || !preview.emailReady}
                >
                  {sending
                    ? 'Sending…'
                    : testMode
                      ? `Send ${fmtNum(preview.emailCount)} test email${preview.emailCount === 1 ? '' : 's'} to me`
                      : `Send ${fmtNum(preview.emailCount)} email${preview.emailCount === 1 ? '' : 's'} now`}
                </button>
              </div>

              {!preview.emailReady && (
                <div className="dist-notice is-bad">
                  No sending account is configured on the server, so nothing can be emailed.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DistributeModal;
