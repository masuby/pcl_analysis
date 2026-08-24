import { useCallback, useEffect, useRef, useState } from 'react';
import { mambuAPI } from '../../../../../services/api';
import './MambuData.css';

/**
 * MAMBU DATA — the employee register behind the CS affordability run.
 *
 * The extract is ~650,000 people, so an upload is a background job: the file is
 * handed over, an id comes back, and this screen polls until it finishes. The
 * register is cumulative — an upload updates the people it recognises by check
 * number and appends the ones it does not, so nothing is lost by uploading a
 * partial extract.
 */

const fmt = (n) => Number(n || 0).toLocaleString();

const AffordabilityNote = () => (
  <div className="mambu-formula">
    <div className="mambu-formula-head">How affordability is worked out</div>
    <ol className="mambu-formula-list">
      <li>
        <strong>Allowances</strong> = gross pay − basic pay. The part of the salary
        that is not basic — it is not treated as dependable income.
      </li>
      <li>
        <strong>What they can afford each month</strong> = net pay − ⅓ of basic pay
        − allowances. A third of basic pay is protected and cannot be lent against.
        If the result is negative it counts as zero.
        <em> For a refinance, their current installment is added back</em>, because
        the new loan swallows the old one and frees that money up.
      </li>
      <li>
        <strong>How long they can borrow for</strong> = the months left until they
        turn 59½, capped at 96 months (8 years).
      </li>
      <li>
        <strong>Biggest loan they can carry</strong> — the monthly figure run
        backwards through the annuity formula at 3.5% monthly interest plus a 0.4%
        monthly admin fee.
      </li>
      <li>
        <strong>Cash before fees</strong> = that amount ÷ 1.118 (a 10% processing
        fee plus 18% VAT).
      </li>
      <li>
        <strong>For a refinance, cash in hand</strong> = that figure minus what they
        still owe. If the new loan is smaller than the balance, it is zero.
      </li>
    </ol>
    <div className="mambu-formula-foot">
      Qualifies at <strong>200,000</strong> for refinance and <strong>500,000</strong> for
      new and reactivation.
    </div>
  </div>
);

const MambuData = () => {
  const [summary, setSummary] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([
        mambuAPI.getEmployeesSummary(),
        mambuAPI.listUploads('EMPLOYEES'),
      ]);
      if (s?.success) setSummary(s);
      if (u?.success) setUploads(u.uploads || []);
    } catch (e) {
      setError(e.message || String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => clearInterval(pollRef.current), []);

  // Follow a running job until it settles, then refresh the figures.
  const watch = useCallback((id) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await mambuAPI.getUpload(id);
        setJob(s);
        if (s.status === 'DONE' || s.status === 'FAILED') {
          clearInterval(pollRef.current);
          setBusy(false);
          load();
        }
      } catch {
        /* keep polling; a dropped poll is not a failed job */
      }
    }, 4000);
  }, [load]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setError(''); setJob(null);
    try {
      const res = await mambuAPI.uploadEmployees(file);
      if (!res?.success) throw new Error(res?.error || 'Upload rejected');
      setJob({ status: 'RUNNING', fileName: file.name });
      watch(res.uploadId);
    } catch (e) {
      setError(e.message || String(e));
      setBusy(false);
    }
  };

  const emp = summary?.employees;

  return (
    <div className="mambu-wrap">
      <div className="mambu-head">
        <div>
          <h2 className="mambu-title">Employee register</h2>
          <p className="mambu-sub">
            The reference list the CS affordability run is built on. Uploading an
            extract updates the people already on file and adds the new ones —
            nothing is removed.
          </p>
        </div>
        <div className="mambu-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }}
          />
          <button className="mambu-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Uploading…' : '⬆ Upload employee data'}
          </button>
          <button className="mambu-btn mambu-btn--ghost" onClick={load} disabled={busy}>
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="mambu-error">{error}</div>}

      {job && (
        <div className={`mambu-job ${job.status === 'FAILED' ? 'is-failed' : ''}`}>
          {job.status === 'RUNNING' && (
            <>Processing <strong>{job.fileName}</strong>… a full extract takes a few minutes.</>
          )}
          {job.status === 'DONE' && (
            <>
              Finished <strong>{job.fileName}</strong> — {fmt(job.rowsRead)} rows read,{' '}
              <strong>{fmt(job.rowsInserted)}</strong> added,{' '}
              <strong>{fmt(job.rowsUpdated)}</strong> updated
              {job.columnsAdded ? <> · new columns: <code>{job.columnsAdded}</code></> : null}
            </>
          )}
          {job.status === 'FAILED' && <>Upload failed: {job.error}</>}
        </div>
      )}

      <div className="mambu-stats">
        <div className="mambu-stat">
          <span className="mambu-stat-v">{fmt(emp?.total)}</span>
          <span className="mambu-stat-k">People on file</span>
        </div>
        <div className="mambu-stat">
          <span className="mambu-stat-v">{fmt(emp?.employers)}</span>
          <span className="mambu-stat-k">Employers (votes)</span>
        </div>
        <div className="mambu-stat">
          <span className="mambu-stat-v">{fmt(emp?.withSalary)}</span>
          <span className="mambu-stat-k">With salary figures</span>
        </div>
        <div className="mambu-stat">
          <span className="mambu-stat-v">{fmt(emp?.withPhone)}</span>
          <span className="mambu-stat-k">With a phone number</span>
        </div>
        <div className="mambu-stat">
          <span className="mambu-stat-v">{fmt(emp?.withBirthDate)}</span>
          <span className="mambu-stat-k">With date of birth</span>
        </div>
        <div className="mambu-stat">
          <span className="mambu-stat-v">{fmt(emp?.columns)}</span>
          <span className="mambu-stat-k">Columns held</span>
        </div>
      </div>

      {summary?.lastFile && (
        <div className="mambu-last">
          Last refreshed from <strong>{summary.lastFile}</strong>
          {summary.lastUpdated && !summary.lastUpdated.startsWith('0001')
            ? ` on ${new Date(summary.lastUpdated).toLocaleString('en-GB')}`
            : ''}
        </div>
      )}

      <AffordabilityNote />

      {uploads.length > 0 && (
        <div className="mambu-history">
          <div className="mambu-history-head">Recent uploads</div>
          <table className="mambu-table">
            <thead>
              <tr>
                <th>File</th><th>Status</th><th>Read</th><th>Added</th>
                <th>Updated</th><th>New columns</th><th>When</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id}>
                  <td>{u.fileName}</td>
                  <td>
                    <span className={`mambu-pill mambu-pill--${String(u.status).toLowerCase()}`}>
                      {u.status}
                    </span>
                  </td>
                  <td>{fmt(u.rowsRead)}</td>
                  <td>{fmt(u.rowsInserted)}</td>
                  <td>{fmt(u.rowsUpdated)}</td>
                  <td>{u.columnsAdded || '—'}</td>
                  <td>{new Date(u.startedAt).toLocaleString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MambuData;
