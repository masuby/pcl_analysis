import { useCallback, useEffect, useRef, useState } from 'react';
import { mambuAPI } from '../../../../../services/api';
import DistributeModal from './DistributeModal';

/**
 * CS AFFORDABILITY — the deductions and loan extracts, and the run built on them.
 *
 * Three inputs feed it: the employee register (uploaded above), the deductions
 * (Inst) extract, and the CS loan extract. Deductions and loans arrive as
 * several files each, so they upload into a BATCH and only count once the batch
 * is activated — a half-uploaded extract must never be picked up by a report.
 *
 * Unlike the register, these two REPLACE rather than accumulate. A settled loan
 * simply drops out of the next extract, and carrying it forward would make
 * somebody look permanently poorer than they are.
 */

const fmtNum = (n) => Number(n || 0).toLocaleString();

const fmtBytes = (n) => {
  if (!n) return '';
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
};

const fmtWhen = (iso) => {
  if (!iso || String(iso).startsWith('0001')) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB');
};

const GROUPS = [
  { key: 'Refinance', blurb: 'They have a live loan running now.' },
  { key: 'Reactivation', blurb: 'They had a loan and have finished paying it off.' },
  { key: 'New', blurb: 'They are not in the loan file at all.' },
];

const CSAffordability = () => {
  const [kinds, setKinds] = useState([]);
  const [batches, setBatches] = useState({ active: {}, open: {} });
  const [summary, setSummary] = useState(null);
  const [groups, setGroups] = useState(['Refinance', 'Reactivation', 'New']);
  const [run, setRun] = useState(null);
  const [runs, setRuns] = useState([]);
  const [distMode, setDistMode] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [showCols, setShowCols] = useState('');
  const inputs = useRef({});
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const [k, b, s, r] = await Promise.all([
        mambuAPI.getCSKinds(),
        mambuAPI.listCSBatches(),
        mambuAPI.getCSSummary(),
        mambuAPI.listRuns(),
      ]);
      if (k?.success) setKinds(k.kinds || []);
      if (b?.success) setBatches({ active: b.active || {}, open: b.open || {} });
      if (s?.success) setSummary(s);
      if (r?.success) setRuns((r.runs || []).filter((x) => x.mode === 'CS_AFFORDABILITY'));
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message || String(e) });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => clearInterval(pollRef.current), []);

  const upload = async (kind, file) => {
    if (!file) return;
    setBusy(kind);
    setNotice(null);
    try {
      const res = await mambuAPI.uploadCSFile(kind, file);
      setNotice({ kind: 'ok', text: res.message });
      await load();
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message || String(e) });
    } finally {
      setBusy('');
    }
  };

  const activate = async (id) => {
    setNotice(null);
    try {
      const res = await mambuAPI.activateCSBatch(id);
      setNotice({ kind: 'ok', text: res.message });
      await load();
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message || String(e) });
    }
  };

  const discard = async (id) => {
    try {
      await mambuAPI.deleteCSBatch(id);
      await load();
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message || String(e) });
    }
  };

  const watch = useCallback((id) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await mambuAPI.getRun(id);
        setRun(s);
        if (s.status === 'DONE' || s.status === 'FAILED') {
          clearInterval(pollRef.current);
          setBusy('');
          load();
        }
      } catch { /* a dropped poll is not a failed run */ }
    }, 4000);
  }, [load]);

  const start = async () => {
    setBusy('run');
    setNotice(null);
    setRun(null);
    try {
      const res = await mambuAPI.runCSAffordability(groups);
      if (!res?.success) throw new Error(res?.error || 'Could not start the run');
      setRun({ status: 'RUNNING', id: res.runId });
      watch(res.runId);
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message || String(e) });
      setBusy('');
    }
  };

  const download = async (id) => {
    try {
      await mambuAPI.downloadRun(id, 'CS_Affordability.zip');
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message || String(e) });
    }
  };

  const toggleGroup = (g) =>
    setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));

  const lastDone = runs.find((r) => r.status === 'DONE');
  const distributableRunId = (run?.status === 'DONE' && run.id) || lastDone?.id || '';
  const canRun = summary?.ready && groups.length > 0 && busy !== 'run';

  return (
    <div className="mambu-cs">
      <div className="mambu-sources-head">
        <h3 className="mambu-sources-title">Affordability inputs</h3>
        <p className="mambu-sources-sub">
          Three things feed the calculation: the employee register above, what is
          already being deducted from each salary, and the loan accounts that say
          who currently owes us money. The last two arrive as several files, so
          they upload into a batch and only count once you activate it.
        </p>
      </div>

      {notice && (
        <div className={`mambu-notice ${notice.kind === 'bad' ? 'is-bad' : 'is-ok'}`}>
          {notice.text}
        </div>
      )}

      <div className="mambu-slots">
        {kinds.map((k) => {
          const act = batches.active[k.kind];
          const open = batches.open[k.kind];
          return (
            <div key={k.kind} className="mambu-slot">
              <div className="mambu-slot-top">
                <div>
                  <div className="mambu-slot-name">{k.label}</div>
                  <div className="mambu-slot-purpose">{k.purpose}</div>
                </div>
                <span className={`mambu-pill ${act ? 'mambu-pill--done' : 'mambu-pill--running'}`}>
                  {act ? 'In use' : 'None active'}
                </span>
              </div>

              {act ? (
                <div className="mambu-slot-file">
                  <div className="mambu-slot-fname">
                    {fmtNum(act.rows)} rows from {act.fileCount} file
                    {act.fileCount === 1 ? '' : 's'}
                  </div>
                  <div className="mambu-slot-meta">
                    {act.files.join(', ')}
                    {fmtWhen(act.activatedAt) ? ` · in use since ${fmtWhen(act.activatedAt)}` : ''}
                  </div>
                </div>
              ) : (
                <div className="mambu-slot-empty">
                  Nothing active yet.
                  {k.kind === 'CS_LOAN'
                    ? ' Without it everyone would come out as New.'
                    : ' Without it existing deductions are ignored and affordability is overstated.'}
                </div>
              )}

              {open && (
                <div className="mambu-batch-open">
                  <div>
                    <b>Batch being built</b> — {fmtNum(open.rows)} rows from{' '}
                    {open.fileCount} file{open.fileCount === 1 ? '' : 's'}
                    <div className="mambu-slot-meta">{open.files.join(', ')}</div>
                  </div>
                  <div className="mambu-batch-actions">
                    <button className="mambu-btn mambu-btn--sm" onClick={() => activate(open.id)}>
                      Use this batch
                    </button>
                    <button className="mambu-link" onClick={() => discard(open.id)}>
                      Discard
                    </button>
                  </div>
                </div>
              )}

              <div className="mambu-slot-actions">
                <input
                  ref={(el) => { inputs.current[k.kind] = el; }}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={(e) => { upload(k.kind, e.target.files?.[0]); e.target.value = ''; }}
                />
                <button
                  className="mambu-btn"
                  disabled={busy === k.kind}
                  onClick={() => inputs.current[k.kind]?.click()}
                >
                  {busy === k.kind ? 'Reading…' : open ? 'Add another file' : 'Upload file'}
                </button>
                <button
                  className="mambu-btn mambu-btn--ghost"
                  onClick={() => setShowCols(showCols === k.kind ? '' : k.kind)}
                >
                  {showCols === k.kind ? 'Hide' : 'Required columns'}
                </button>
              </div>

              {showCols === k.kind && (
                <div className="mambu-slot-cols">
                  <p>
                    Read from the <code>{k.sheet}</code> sheet. The file is rejected
                    on upload if any of these are missing.
                  </p>
                  <div className="mambu-slot-collist">
                    {k.requiredColumns.map((c) => <code key={c}>{c}</code>)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {summary && (
        <div className="mambu-stats mambu-stats--tight">
          <div className="mambu-stat">
            <span className="mambu-stat-v">{fmtNum(summary.employees)}</span>
            <span className="mambu-stat-k">People on the register</span>
          </div>
          <div className="mambu-stat">
            <span className="mambu-stat-v">{fmtNum(summary.installments)}</span>
            <span className="mambu-stat-k">Deductions in use</span>
          </div>
          <div className="mambu-stat">
            <span className="mambu-stat-v">{fmtNum(summary.loanRows)}</span>
            <span className="mambu-stat-k">Loan rows in use</span>
          </div>
        </div>
      )}

      <div className="mambu-prodhead">
        <h3 className="mambu-title">Calculate affordability</h3>
        <p className="mambu-sub">
          Everyone on the register is sorted by whether they owe us anything, then
          the same affordability chain runs for each group. Qualifying means
          200,000 left in hand after settling for a refinance, or a 500,000 loan
          for new and reactivation.
        </p>
      </div>

      <div className="mambu-groupchecks">
        {GROUPS.map((g) => (
          <label key={g.key} className="mambu-groupcheck">
            <input
              type="checkbox"
              checked={groups.includes(g.key)}
              onChange={() => toggleGroup(g.key)}
            />
            <span>
              <b>{g.key}</b>
              <em>{g.blurb}</em>
            </span>
          </label>
        ))}
      </div>

      {summary && !summary.loanReady && (
        <div className="mambu-notice is-bad">
          No CS loan batch is active, so nobody can be told apart — everyone would
          come out as New. Upload and activate one first.
        </div>
      )}
      {summary && summary.loanReady && !summary.instReady && (
        <div className="mambu-notice is-warn">
          No deductions batch is active. The run will work, but nobody's existing
          deductions are counted and affordability will be overstated.
        </div>
      )}

      <div className="mambu-runs-actions">
        <button className="mambu-btn" onClick={start} disabled={!canRun}>
          {busy === 'run' ? 'Calculating…' : 'Calculate affordability'}
        </button>
        <button
          className="mambu-btn mambu-btn--ghost"
          onClick={() => setDistMode('cluster')}
          disabled={!distributableRunId}
        >
          Distribute to Cluster
        </button>
        <button
          className="mambu-btn mambu-btn--ghost"
          onClick={() => setDistMode('branch')}
          disabled={!distributableRunId}
        >
          Distribute to Branch
        </button>
      </div>

      {run && (
        <div className={`mambu-job ${run.status === 'FAILED' ? 'is-failed' : ''}`}>
          {run.status === 'RUNNING' && (
            <>Working through the register — this takes a couple of minutes.</>
          )}
          {run.status === 'FAILED' && <>Run failed: {run.error}</>}
          {run.status === 'DONE' && (
            <>
              <div className="mambu-job-line">
                <strong>{fmtNum(run.rowsIn)}</strong> people processed,{' '}
                <strong>{fmtNum(run.rowsOut)}</strong> qualified.
              </div>
              <button className="mambu-btn mambu-btn--sm" onClick={() => download(run.id)}>
                ⬇ Download zip{run.zipSize ? ` (${fmtBytes(run.zipSize)})` : ''}
              </button>
            </>
          )}
        </div>
      )}

      {run?.status === 'DONE' && run.stats?.products?.length > 0 && (
        <div className="mambu-history">
          <div className="mambu-history-head">Result by group</div>
          <table className="mambu-table">
            <thead>
              <tr>
                <th>Group</th><th className="num">People</th><th className="num">Qualified</th>
                <th className="num">Branch files</th><th className="num">Cluster files</th>
              </tr>
            </thead>
            <tbody>
              {run.stats.products.map((p) => (
                <tr key={p.product}>
                  <td>{p.product}</td>
                  <td className="num">{fmtNum(p.rows)}</td>
                  <td className="num">{fmtNum(p.allocated)}</td>
                  <td className="num">{p.branchFiles}</td>
                  <td className="num">{p.clusterFiles}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {run?.warnings?.length > 0 && (
        <div className="mambu-warnings">
          <div className="mambu-warnings-head">Worth knowing</div>
          <ul>{run.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {runs.length > 0 && (
        <div className="mambu-history">
          <div className="mambu-history-head">Recent affordability runs</div>
          <table className="mambu-table">
            <thead>
              <tr>
                <th>Groups</th><th>Status</th><th className="num">People</th>
                <th className="num">Qualified</th><th>When</th><th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.products.join(', ')}</td>
                  <td>
                    <span className={`mambu-pill mambu-pill--${String(r.status).toLowerCase()}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="num">{fmtNum(r.rowsIn)}</td>
                  <td className="num">{fmtNum(r.rowsOut)}</td>
                  <td>{fmtWhen(r.startedAt)}</td>
                  <td className="num">
                    {r.downloadUrl && (
                      <button className="mambu-link" onClick={() => download(r.id)}>
                        Download
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {distMode && (
        <DistributeModal
          runId={distributableRunId}
          mode={distMode}
          product=""
          label="CS"
          onClose={() => setDistMode('')}
        />
      )}
    </div>
  );
};

export default CSAffordability;
