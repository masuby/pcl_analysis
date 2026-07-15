import { useState, useEffect, useCallback } from 'react';
import './AISalesManager.css';

// The standalone FastAPI agent service (ai_sales_manager). Configurable so it
// can point at localhost in dev or a proxied path in production.
const API = import.meta.env.VITE_AISM_API_URL || 'http://localhost:8090';

const SCORE_STYLE = {
  Hot:  { bg: '#dcfce7', fg: '#166534' },
  Warm: { bg: '#fef3c7', fg: '#92400e' },
  Cold: { bg: '#f3f4f6', fg: '#6b7280' },
};

// All 31 Tanzanian regions (26 mainland + 5 Zanzibar) plus a nationwide option.
const TZ_REGIONS = [
  'Arusha', 'Dar es Salaam', 'Dodoma', 'Geita', 'Iringa', 'Kagera', 'Katavi',
  'Kigoma', 'Kilimanjaro', 'Lindi', 'Manyara', 'Mara', 'Mbeya', 'Morogoro',
  'Mtwara', 'Mwanza', 'Njombe', 'Pwani (Coast)', 'Rukwa', 'Ruvuma', 'Shinyanga',
  'Simiyu', 'Singida', 'Songwe', 'Tabora', 'Tanga',
  'Kaskazini Unguja', 'Kusini Unguja', 'Mjini Magharibi (Zanzibar City)',
  'Kaskazini Pemba', 'Kusini Pemba',
];

const DB_PREVIEW = 20;   // rows shown before "View more"

const ScoreBadge = ({ score }) => {
  const s = SCORE_STYLE[score] || SCORE_STYLE.Cold;
  return (
    <span style={{ background: s.bg, color: s.fg, fontWeight: 700, fontSize: 11,
                   padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap' }}>
      {score || 'Cold'}
    </span>
  );
};

const FlagBadge = ({ flag }) => {
  const isNew = /new/i.test(flag || '');
  return <span className={`aism-flagcell ${isNew ? 'aism-flagcell--new' : 'aism-flagcell--old'}`}>{flag || '—'}</span>;
};

// The scraping pipeline stages, mirrored from scraper/run_pipeline.py.
const STEPS = [
  { key: 'trigger', title: 'Run trigger', sub: 'start pipeline',        icon: '⚡' },
  { key: 'crawl',   title: 'Crawl pages', sub: 'unique links only',     icon: '🕸️' },
  { key: 'clean',   title: 'AI clean',    sub: 'process unique data',   icon: '🤖' },
  { key: 'flag',    title: 'De-dupe',     sub: 'flag NEW / EXISTING',   icon: '🔀' },
  { key: 'upload',  title: 'Upload',      sub: 'DB + Google Sheet',      icon: '📊' },
];

// Map the pipeline log to per-node status (works live while running too).
const nodeStatusFromLog = (log = []) => {
  const j = log.join(' ');
  const scraped = /raw store now/i.test(j);
  const cleaned = /cleaned store now/i.test(j);
  return {
    crawl:  scraped ? 'done' : /crawl|links/i.test(j) ? 'run' : 'idle',
    clean:  cleaned ? 'done' : /to clean/i.test(j) ? 'run' : 'idle',
    flag:   cleaned ? 'done' : 'idle',
    upload: /upload failed/i.test(j) ? 'fail' : /uploaded \d+ leads/i.test(j) ? 'done' : 'idle',
  };
};

const FlowDiagram = ({ running, statuses }) => (
  <div className={`aism-flow ${running ? 'aism-flow--running' : ''}`}>
    {STEPS.map((step, i) => {
      const st = step.key === 'trigger' ? 'done' : (statuses?.[step.key] || 'idle');
      return (
        <div className="aism-flow-unit" key={step.key}>
          <div className={`aism-node aism-node--${st} ${running ? 'aism-node--live' : ''}`}
               style={{ animationDelay: `${i * 0.35}s` }}>
            <span className="aism-node-icon">{step.icon}</span>
            <div className="aism-node-body">
              <span className="aism-node-title">{step.title}</span>
              <span className="aism-node-sub">{step.sub}</span>
            </div>
            {st === 'done' && <span className="aism-node-flag aism-node-flag--ok">✓</span>}
            {st === 'fail' && <span className="aism-node-flag aism-node-flag--bad">✕</span>}
          </div>
          {i < STEPS.length - 1 && (
            <div className="aism-connector">
              <span className="aism-connector-line" />
              <span className="aism-connector-pulse" style={{ animationDelay: `${i * 0.35}s` }} />
            </div>
          )}
        </div>
      );
    })}
  </div>
);

const LeadsTable = ({ leads }) => (
  <table className="aism-table">
    <thead>
      <tr>
        <th>#</th><th>Flag</th><th>Date</th><th>Seller / Vehicle</th><th>Location</th>
        <th style={{ textAlign: 'right' }}>Est. Value</th><th>Phone</th>
        <th style={{ textAlign: 'center' }}>Score</th>
        <th style={{ textAlign: 'right' }}>Est. Loan</th><th>Source</th>
      </tr>
    </thead>
    <tbody>
      {leads.map((p, i) => (
        <tr key={i}>
          <td className="aism-idx">{i + 1}</td>
          <td><FlagBadge flag={p.flag} /></td>
          <td className="aism-date">{p.date_obtained || '—'}</td>
          <td className="aism-name">
            {[p.car_make, p.car_model, p.car_year].filter(Boolean).join(' ') || '—'}
            {p.seller_name ? <span className="aism-biz"> · {p.seller_name}</span> : ''}
          </td>
          <td>{p.location || '—'}</td>
          <td style={{ textAlign: 'right' }}>{p.price_text || p.est_value_tzs || '—'}</td>
          <td>{p.phone || <span className="aism-muted">—</span>}</td>
          <td style={{ textAlign: 'center' }}><ScoreBadge score={p.score} /></td>
          <td style={{ textAlign: 'right' }}>{p.est_loan_tzs || '—'}</td>
          <td>{p.source_url
            ? <a href={p.source_url} target="_blank" rel="noreferrer">link ↗</a>
            : <span className="aism-muted">—</span>}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const AISalesManager = () => {
  const [health, setHealth] = useState(null);
  const [healthErr, setHealthErr] = useState('');
  const [product, setProduct] = useState('LBF');
  const [region, setRegion] = useState('');
  const [maxLeads, setMaxLeads] = useState(30);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [jobLog, setJobLog] = useState([]);
  const [stopping, setStopping] = useState(false);
  const [allLeads, setAllLeads] = useState([]);
  const [dbTotal, setDbTotal] = useState(0);
  const [showAllDb, setShowAllDb] = useState(false);
  const [uniqueLeads, setUniqueLeads] = useState([]);
  const [uniqueTotal, setUniqueTotal] = useState(0);
  const [showAllUnique, setShowAllUnique] = useState(false);

  const checkHealth = useCallback(() => {
    setHealthErr('');
    fetch(`${API}/health`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHealth)
      .catch((e) => { setHealth(null); setHealthErr(e.message || String(e)); });
  }, []);

  const loadModels = useCallback(() => {
    fetch(`${API}/models`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setModels(d.models || []);
        setModel((cur) => cur || d.default || (d.models && d.models[0]) || '');
      })
      .catch(() => { /* health banner already conveys offline state */ });
  }, []);

  const loadLeads = useCallback(() => {
    fetch(`${API}/leads`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { setAllLeads(d.leads || []); setDbTotal(d.total || 0); })
      .catch(() => { /* offline banner covers this */ });
    fetch(`${API}/unique`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { setUniqueLeads(d.leads || []); setUniqueTotal(d.total || 0); })
      .catch(() => {});
  }, []);

  useEffect(() => { checkHealth(); loadModels(); loadLeads(); }, [checkHealth, loadModels, loadLeads]);

  const run = useCallback(async () => {
    setRunning(true); setStopping(false); setError(''); setResult(null); setJobLog([]);
    try {
      // Start the background pipeline job.
      const start = await fetch(`${API}/scrape`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ max_listings: Number(maxLeads) || 0, max_pages: 0, model }),
      });
      if (!start.ok) throw new Error(`Service returned ${start.status}`);

      // Poll status until the job finishes (crawls can take a while).
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await (await fetch(`${API}/scrape/status`)).json();
        setJobLog(s.log || []);
        if (s.state === 'done' || s.state === 'cancelled') { setResult(s.summary); break; }
        if (s.state === 'error') {
          setError((s.log || []).slice(-1)[0] || 'Pipeline failed'); break;
        }
      }
    } catch (e) {
      const msg = String(e?.message || e);
      setError(/failed to fetch|networkerror/i.test(msg)
        ? `Agent service not reachable at ${API}. Start it:  python -m uvicorn app.main:app --port 8090`
        : msg);
    } finally {
      setRunning(false);
      checkHealth();
      loadLeads();
    }
  }, [maxLeads, model, checkHealth, loadLeads]);

  const stop = useCallback(async () => {
    setStopping(true);
    try { await fetch(`${API}/scrape/stop`, { method: 'POST' }); }
    catch { /* the poll loop will settle the state */ }
  }, []);

  const online = Boolean(health?.ok);
  const statuses = nodeStatusFromLog(running ? jobLog : (result?.log || []));
  const failLine = (result?.log || []).find((l) => /failed/i.test(l));
  const saEmail = health?.service_account_email;

  // Region is a client-side filter on location (backend stores every region).
  const applyRegion = useCallback((arr) => {
    const q = (region || '').trim().toLowerCase();
    if (!q) return arr;
    const w = q.split(' ')[0];
    return arr.filter((l) => (l.location || '').toLowerCase().includes(w));
  }, [region]);

  const leads = applyRegion(result?.leads || []);
  const uniqueView = applyRegion(uniqueLeads);
  const allView = applyRegion(allLeads);
  const uniqueCount = region ? uniqueView.length : uniqueTotal;
  const dbCount = region ? allView.length : dbTotal;

  return (
    <div className="aism-panel">
      {/* Header */}
      <div className="aism-header">
        <div>
          <h2 className="aism-title">🤖 AI Sales Manager</h2>
          <p className="aism-sub">Scrapes cartanzania.com for car owners, AI-cleans &amp; de-dupes them (by link and phone), then writes LBF leads to your Google Sheet.</p>
        </div>
        <span className={`aism-status ${online ? 'aism-status--on' : 'aism-status--off'}`}>
          {online ? '● service online' : '● service offline'}
        </span>
      </div>

      {/* Provider readiness */}
      {online && health?.providers && (
        <div className="aism-providers">
          {Object.entries(health.providers).map(([k, v]) => (
            <span key={k} className={`aism-chip ${v ? 'aism-chip--ok' : 'aism-chip--no'}`}>
              {v ? '✓' : '✕'} {k}
            </span>
          ))}
          {health?.budget && (
            <span className="aism-chip aism-chip--budget">
              tokens {Number(health.budget.used).toLocaleString()} / {Number(health.budget.limit).toLocaleString()}
            </span>
          )}
        </div>
      )}
      {!online && (
        <div className="aism-offline">
          {healthErr ? `Can't reach the agent service at ${API} (${healthErr}). ` : ''}
          Start it from <code>ai_sales_manager/</code>: <code>python -m uvicorn app.main:app --port 8090</code>
          <button className="aism-retry" onClick={() => { checkHealth(); loadModels(); }}>retry</button>
        </div>
      )}

      {/* Agentic flow diagram */}
      <FlowDiagram running={running} statuses={statuses} />

      {/* Controls */}
      <div className="aism-controls">
        <label className="aism-field">
          <span>Product</span>
          <select value={product} onChange={(e) => setProduct(e.target.value)} disabled={running}>
            <option value="LBF">LBF — car owners</option>
            <option value="SME" disabled>SME — businesses (soon)</option>
          </select>
        </label>
        <label className="aism-field aism-field--grow">
          <span>Region (filters results)</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)} disabled={running}>
            <option value="">All regions (nationwide)</option>
            {TZ_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="aism-field">
          <span>Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}
                  disabled={running || models.length === 0}>
            {models.length === 0 && <option value="">no models available</option>}
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="aism-field">
          <span>Max new (0 = all)</span>
          <input type="number" min="0" max="5000" value={maxLeads}
                 onChange={(e) => setMaxLeads(e.target.value)} disabled={running} />
        </label>
        {running ? (
          <button className="aism-stop" onClick={stop} disabled={stopping}>
            {stopping ? '■ Stopping…' : '■ Stop'}
          </button>
        ) : (
          <button className="aism-run" onClick={run} disabled={!online}>
            🔍 Run discovery
          </button>
        )}
      </div>

      {running && jobLog.length > 0 && (
        <div className="aism-live">🔄 {jobLog[jobLog.length - 1]}</div>
      )}

      {error && <div className="aism-error">⚠ {error}</div>}

      {/* Results */}
      {result && (
        <div className="aism-results">
          {failLine && (
            <div className="aism-error">
              ⚠ {failLine}
              {/permission|quota|create|sheet_id/i.test(failLine) && saEmail && (
                <div className="aism-error-hint">
                  Share your Leads sheet with <code>{saEmail}</code> as Editor, copy its ID
                  from the URL, set <code>AISM_LEADS_SHEET_ID</code> in <code>DataDashboard/.env</code>, then restart the service.
                </div>
              )}
            </div>
          )}
          <div className="aism-result-bar">
            <strong>{result.new_raw}</strong> new listing{result.new_raw === 1 ? '' : 's'} scraped
            &nbsp;·&nbsp; <strong>{result.cleaned_new}</strong> cleaned
            (<span className="aism-count-new">{result.new_data} NEW</span> ·
            <span className="aism-count-old"> {result.existing_data} EXISTING</span>)
            &nbsp;·&nbsp; {result.total_cleaned} total in store
            {typeof result.unique_total === 'number' && <> &nbsp;·&nbsp; <strong>{result.unique_total}</strong> unique people</>}
            {result.cancelled && <> &nbsp;·&nbsp; <span className="aism-stopped">■ stopped early (progress saved)</span></>}
            {result.model && <> &nbsp;·&nbsp; <span className="aism-model-tag">{result.model}</span></>}
            {result.sheet_url && (
              <a className="aism-sheet-link" href={result.sheet_url} target="_blank" rel="noreferrer">📊 Open Leads sheet</a>
            )}
            {result.log?.length > 0 && (
              <button className="aism-log-toggle" onClick={() => setShowLog((s) => !s)}>
                {showLog ? 'hide log' : 'run log'}
              </button>
            )}
          </div>

          {showLog && (
            <ul className="aism-log">
              {result.log.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}

          {leads.length === 0 ? (
            <div className="aism-empty">
              No new leads this run{region ? ` in ${region}` : ''} — everything found was already in the store,
              or try a higher “Max new”.
            </div>
          ) : (
            <div className="aism-table-wrap"><LeadsTable leads={leads} /></div>
          )}
        </div>
      )}

      {/* Unique leads — one row per phone (people we can actually call) */}
      {uniqueView.length > 0 && (
        <div className="aism-db aism-db--unique">
          <div className="aism-db-head">
            <span className="aism-db-title">🌟 Unique leads — people to call</span>
            <span className="aism-db-count aism-db-count--unique">{uniqueCount.toLocaleString()} unique{region ? ` · ${region}` : ''}</span>
            <button className="aism-db-refresh" onClick={loadLeads}>refresh</button>
          </div>
          <div className={`aism-db-wrap ${showAllUnique ? 'aism-db-wrap--all' : ''}`}>
            <LeadsTable leads={showAllUnique ? uniqueView : uniqueView.slice(0, DB_PREVIEW)} />
          </div>
          {uniqueView.length > DB_PREVIEW && (
            <button className="aism-viewmore" onClick={() => setShowAllUnique((s) => !s)}>
              {showAllUnique ? '▲ View less' : `▼ View more (${(uniqueView.length - DB_PREVIEW).toLocaleString()} more)`}
            </button>
          )}
        </div>
      )}

      {/* Full AI-cleaned lead database — fixed-height, scrollable, View more */}
      {allView.length > 0 && (
        <div className="aism-db">
          <div className="aism-db-head">
            <span className="aism-db-title">🗃 AI-cleaned lead database</span>
            <span className="aism-db-count">{dbCount.toLocaleString()} lead{dbCount === 1 ? '' : 's'}{region ? ` · ${region}` : ''}</span>
            <button className="aism-db-refresh" onClick={loadLeads}>refresh</button>
          </div>
          <div className={`aism-db-wrap ${showAllDb ? 'aism-db-wrap--all' : ''}`}>
            <LeadsTable leads={showAllDb ? allView : allView.slice(0, DB_PREVIEW)} />
          </div>
          {allView.length > DB_PREVIEW && (
            <button className="aism-viewmore" onClick={() => setShowAllDb((s) => !s)}>
              {showAllDb ? '▲ View less' : `▼ View more (${(allView.length - DB_PREVIEW).toLocaleString()} more)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default AISalesManager;
