import { useCallback, useEffect, useRef, useState } from 'react';
import { mambuAPI } from '../../../../../services/api';

/**
 * REFINANCE / REACTIVATION for one product.
 *
 * Refinance reads the Loan export: who is far enough through their current
 * loan to be worth topping up. Reactivation reads the Clients export: who left
 * in a chosen window and could be brought back.
 *
 * Both produce a zip of workbooks — FULL, UNALLOCATED, and one file per branch,
 * cluster and zone — built on the server so the browser never handles 24,000
 * rows.
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

// Default the reactivation window to the last six months — the range this is
// almost always run for, while staying editable.
const defaultRange = () => {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - 5, 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
};

const MODES = [
  {
    key: 'refinance',
    label: 'Refinance',
    needs: 'LOAN',
    blurb: 'Clients at least 30% through their current loan, under 64, one row per person.',
  },
  {
    key: 'reactivation',
    label: 'Reactivation',
    needs: 'CLIENTS',
    blurb: 'Clients created in the chosen window, under 64, with anyone in Collections dropped.',
  },
];

const ProductRuns = ({ product, label, sources, sourcesLoaded }) => {
  const [mode, setMode] = useState('refinance');
  const [range, setRange] = useState(defaultRange);
  const [run, setRun] = useState(null);
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  const loadRuns = useCallback(async () => {
    try {
      const r = await mambuAPI.listRuns();
      if (r?.success) setRuns((r.runs || []).filter((x) => x.products?.includes(product)));
    } catch { /* the history is not worth an error banner */ }
  }, [product]);

  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEffect(() => () => clearInterval(pollRef.current), []);

  const current = MODES.find((m) => m.key === mode);
  const sourceReady = Boolean(sources?.[current.needs]);
  // Until the source files have actually been fetched, say nothing — claiming
  // a file is missing before checking sends people off to re-upload it.
  const sourceMissing = sourcesLoaded && !sourceReady;

  const watch = useCallback((id) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await mambuAPI.getRun(id);
        setRun(s);
        if (s.status === 'DONE' || s.status === 'FAILED') {
          clearInterval(pollRef.current);
          setBusy(false);
          loadRuns();
        }
      } catch { /* a dropped poll is not a failed run */ }
    }, 3000);
  }, [loadRuns]);

  const start = async () => {
    setBusy(true);
    setError('');
    setRun(null);
    try {
      const payload = { mode, products: [product] };
      if (mode === 'reactivation') {
        payload.dateFrom = range.from;
        payload.dateTo = range.to;
      }
      const res = await mambuAPI.runRR(payload);
      if (!res?.success) throw new Error(res?.error || 'Could not start the run');
      setRun({ status: 'RUNNING', id: res.runId, mode: res.mode });
      watch(res.runId);
    } catch (e) {
      setError(e.message || String(e));
      setBusy(false);
    }
  };

  const download = async (id) => {
    try {
      await mambuAPI.downloadRun(id, `${label}_${mode}.zip`);
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const stats = run?.stats?.products?.find((p) => p.product === product);
  const funnel = run?.stats?.funnel;

  return (
    <div className="mambu-runs">
      <div className="mambu-runs-modes">
        {MODES.map((m) => (
          <button
            key={m.key}
            className={`mambu-modebtn ${mode === m.key ? 'is-active' : ''}`}
            onClick={() => { setMode(m.key); setRun(null); setError(''); }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="mambu-runs-blurb">{current.blurb}</p>

      {mode === 'reactivation' && (
        <div className="mambu-range">
          <label>
            <span>Created from</span>
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            />
          </label>
          <label>
            <span>to</span>
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            />
          </label>
        </div>
      )}

      {sourceMissing && (
        <div className="mambu-notice is-bad">
          {current.label} needs the {current.needs === 'LOAN' ? 'Loan accounts' : 'Clients'} export.
          Upload it under Source files above — it will serve every product.
        </div>
      )}

      <div className="mambu-runs-actions">
        <button className="mambu-btn" onClick={start} disabled={busy || !sourcesLoaded || !sourceReady}>
          {busy ? 'Building…' : `Generate ${current.label.toLowerCase()} for ${label}`}
        </button>
      </div>

      {error && <div className="mambu-notice is-bad">{error}</div>}

      {run && (
        <div className={`mambu-job ${run.status === 'FAILED' ? 'is-failed' : ''}`}>
          {run.status === 'RUNNING' && <>Building the workbooks on the server…</>}
          {run.status === 'FAILED' && <>Run failed: {run.error}</>}
          {run.status === 'DONE' && (
            <>
              <div className="mambu-job-line">
                <strong>{fmtNum(stats?.rows)}</strong> {label} clients —{' '}
                {fmtNum(stats?.allocated)} with a sales rep, {fmtNum(stats?.unallocated)} unallocated
                {stats?.dncRemoved ? <>, {fmtNum(stats.dncRemoved)} removed as do-not-contact</> : null}.
              </div>
              <div className="mambu-job-line mambu-job-sub">
                {stats?.branchFiles} branch, {stats?.clusterFiles} cluster and {stats?.zoneFiles} zone
                workbooks, plus FULL and UNALLOCATED.
              </div>
              <button className="mambu-btn mambu-btn--sm" onClick={() => download(run.id)}>
                ⬇ Download zip{run.zipSize ? ` (${fmtBytes(run.zipSize)})` : ''}
              </button>
            </>
          )}
        </div>
      )}

      {run?.status === 'DONE' && funnel && (
        <div className="mambu-funnel">
          <div className="mambu-funnel-head">How the list was narrowed down</div>
          <ul>
            <li><span>Rows in the export</span><b>{fmtNum(funnel.loaded)}</b></li>
            {funnel.afterDateFilter != null && (
              <li><span>Within the chosen dates</span><b>{fmtNum(funnel.afterDateFilter)}</b></li>
            )}
            <li><span>One row per person</span><b>{fmtNum(funnel.afterDedupe)}</b></li>
            <li><span>Under 64 years old</span><b>{fmtNum(funnel.afterAge)}</b></li>
            {funnel.afterTenure != null && (
              <li><span>At least 30% through the loan</span><b>{fmtNum(funnel.afterTenure)}</b></li>
            )}
            {funnel.afterCollections != null && (
              <li><span>Not in Collections</span><b>{fmtNum(funnel.afterCollections)}</b></li>
            )}
          </ul>
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
          <div className="mambu-history-head">Recent {label} runs</div>
          <table className="mambu-table">
            <thead>
              <tr>
                <th>Report</th><th>Status</th><th className="num">Rows in</th>
                <th className="num">Selected</th><th>When</th><th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.mode === 'REFINANCE' ? 'Refinance' : 'Reactivation'}</td>
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
    </div>
  );
};

export default ProductRuns;
