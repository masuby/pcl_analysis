/**
 * DIGITAL DATA — cleaned inbound-lead warehouse.
 *
 * The LBF / CS / SME call-centre workbooks were kept by hand for 14+ months:
 * headers drift, some tabs have no header at all, phones and dates come in a
 * dozen formats, and 11-23% of numbers repeat. The backend cleans all of that
 * into `digital_leads`; this view is where you run the clean, inspect what it
 * found, and hand the leads to the people who will call them.
 *
 * Four sections:
 *   Overview      — headline counts + breakdowns
 *   Leads         — the cleaned records, filterable
 *   Data Quality  — exactly what the source data got wrong, per issue and per tab
 *   Distribution  — route leads to LBF/CS call centres and SME branch managers
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import digitalDataService from '../../../../../services/digitalData';
import LoadingSpinner from '../../../../../components/Common/Loading/LoadingSpinner';
import { Toast, ConfirmDialog } from '../../../../../components/feedback/Feedback';
import { downloadDistributionReport } from './utils/digitalDataExport';
import './DigitalData.css';

const SECTIONS = [
  { key: 'OVERVIEW',     label: 'Overview',     icon: '📊' },
  { key: 'LEADS',        label: 'Leads',        icon: '📇' },
  { key: 'QUALITY',      label: 'Data Quality', icon: '🩺' },
  { key: 'DISTRIBUTION', label: 'Distribution', icon: '📤' },
];

// Human wording for the issue codes the cleaner attaches to a row.
const ISSUE_LABELS = {
  NO_PHONE:           'No phone number',
  BAD_PHONE:          'Malformed phone number',
  NO_DATE:            'Missing / unparseable date',
  AMBIGUOUS_DATE:     'Ambiguous date (read as dd/mm)',
  NO_NAME:            'No customer name',
  NO_STATUS:          'No disposition recorded',
  CONTAMINATED_FIELD: 'Wrong data in a column',
  DATE_OUT_OF_RANGE:  'Impossible date (source typo)',
};

const STATUS_TONE = {
  CONVERTED: 'good',
  INTERESTED: 'good',
  CALLBACK: 'warn',
  PENDING: 'warn',
  NOT_REACHABLE: 'muted',
  NOT_INTERESTED: 'bad',
  NOT_QUALIFIED: 'bad',
  WRONG_NUMBER: 'bad',
  DUPLICATE: 'muted',
  EXISTING_CUSTOMER: 'muted',
  OUT_OF_REGION: 'muted',
  UNKNOWN: 'muted',
};

const nf = new Intl.NumberFormat('en-US');
const pretty = (s) => String(s ?? '').replace(/_/g, ' ').toLowerCase();

/**
 * Who receives a product's leads. The rule itself is enforced by the backend
 * (`forDistribution=1`); these strings only explain it on screen. Branch staff
 * — LBF_Branches, CS_Mainland, CS_Zanzibar — are never digital-lead assignees.
 */
const ROUTING_HINT = {
  LBF: 'LBF leads go to the LBF call centre',
  CS:  'CS leads go to the CS call centre',
  SME: 'SME leads go to SME branch managers only',
  MIF: 'MIF leads go to the LBF call centre',
};
const ROUTING_HINT_ALL =
  'Showing every eligible team: the LBF and CS call centres, plus SME branch managers. '
  + 'Pick a product above to narrow it to one team.';

const DigitalData = () => {
  const [section, setSection] = useState('OVERVIEW');
  const [toast, setToast] = useState(null);

  // shared filters
  const [filters, setFilters] = useState({ product: '', platform: '', status: '', month: '', unique: '1' });
  const [options, setOptions] = useState({ products: [], platforms: [], statuses: [], months: [], books: [] });

  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const [ingesting, setIngesting] = useState(false);
  const [confirmIngest, setConfirmIngest] = useState(false);
  const [lastRun, setLastRun] = useState(null);

  const notify = (type, title, message) => setToast({ type, title, message });

  // ------------------------------------------------------------- data loading

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const [s, f] = await Promise.all([
        digitalDataService.getSummary(filters),
        digitalDataService.getFilters(),
      ]);
      setSummary(s);
      setOptions(f);
    } catch (e) {
      notify('error', 'Could not load summary', e.message);
    } finally {
      setLoadingSummary(false);
    }
  }, [filters]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  useEffect(() => {
    digitalDataService.getRuns(1)
      .then((r) => setLastRun(r.runs?.[0] ?? null))
      .catch(() => {});
  }, []);

  // ------------------------------------------------------------------- ingest

  const runIngest = async (includePayroll) => {
    setConfirmIngest(false);
    setIngesting(true);
    try {
      const res = await digitalDataService.ingest({ includePayroll, dayFirst: true });
      const run = res.run;
      setLastRun({ ...run, startedAt: new Date().toISOString() });
      notify(
        'success',
        'Clean & ingest complete',
        `${nf.format(run.rowsInserted)} new rows from ${run.tabsIngested} tabs ` +
        `(${nf.format(run.rowsRead)} read, ${nf.format(run.rowsSkipped)} blank rows skipped).`,
      );
      await loadSummary();
    } catch (e) {
      notify('error', 'Ingest failed', e.message);
    } finally {
      setIngesting(false);
    }
  };

  const setFilter = (k, v) => setFilters((p) => ({ ...p, [k]: v }));

  // ---------------------------------------------------------------- rendering

  const t = summary?.totals;

  return (
    <div className="dd-root">
      {ingesting && (
        <LoadingSpinner
          fullScreen
          messages={[
            'Reading the workbooks…',
            'Repairing header rows…',
            'Normalising phones and dates…',
            'Writing cleaned leads…',
          ]}
        />
      )}

      {/* ------------------------------------------------------------ header */}
      <div className="dd-header">
        <div>
          <h2 className="dd-title">📡 Digital Data</h2>
          <p className="dd-sub">
            Cleaned inbound leads from the LBF, CS and SME workbooks — deduplicated,
            normalised, and ready to distribute.
          </p>
        </div>
        <div className="dd-header-actions">
          {lastRun && (
            <span className="dd-lastrun">
              Last clean:{' '}
              {lastRun.startedAt ? new Date(lastRun.startedAt).toLocaleString() : '—'}
              {typeof lastRun.rowsInserted === 'number' && ` · ${nf.format(lastRun.rowsInserted)} rows`}
            </span>
          )}
          <button className="dd-btn dd-btn--primary" disabled={ingesting} onClick={() => setConfirmIngest(true)}>
            {ingesting ? 'Cleaning…' : '🧹 Clean & Ingest'}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------- section tabs */}
      <div className="dd-sections">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            className={`dd-section-btn ${section === s.key ? 'is-active' : ''}`}
            onClick={() => setSection(s.key)}
          >
            <span className="dd-section-icon">{s.icon}</span> {s.label}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------ filters */}
      <div className="dd-filters">
        <select value={filters.product} onChange={(e) => setFilter('product', e.target.value)}>
          <option value="">All products</option>
          {options.products.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filters.platform} onChange={(e) => setFilter('platform', e.target.value)}>
          <option value="">All platforms</option>
          {options.platforms.map((p) => <option key={p} value={p}>{pretty(p)}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {options.statuses.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
        </select>
        <select value={filters.month} onChange={(e) => setFilter('month', e.target.value)}>
          <option value="">All months</option>
          {options.months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <label className="dd-check" title="Show only the first record for each phone number">
          <input
            type="checkbox"
            checked={filters.unique === '1'}
            onChange={(e) => setFilter('unique', e.target.checked ? '1' : '')}
          />
          Unique numbers only
        </label>
      </div>

      {/* ----------------------------------------------------------- sections */}
      {section === 'OVERVIEW' && (
        <OverviewSection summary={summary} loading={loadingSummary} totals={t} />
      )}
      {section === 'LEADS' && <LeadsSection filters={filters} notify={notify} />}
      {section === 'QUALITY' && <QualitySection filters={filters} notify={notify} />}
      {section === 'DISTRIBUTION' && (
        <DistributionSection filters={filters} notify={notify} onDone={loadSummary} />
      )}

      <ConfirmDialog
        open={confirmIngest}
        title="Clean & ingest all workbooks?"
        message={
          'Reads every tab of the LBF, CS and SME books (~93,000 rows), repairs the ' +
          'headers, normalises phones/dates/statuses and writes the cleaned leads. ' +
          'Rows already ingested are skipped, so this is safe to re-run. Takes a few minutes.'
        }
        confirmLabel="Clean leads only"
        cancelLabel="Cancel"
        onConfirm={() => runIngest(false)}
        onCancel={() => setConfirmIngest(false)}
      />

      <Toast
        open={!!toast}
        type={toast?.type}
        title={toast?.title}
        message={toast?.message}
        duration={6000}
        onClose={() => setToast(null)}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ Overview */

const OverviewSection = ({ summary, loading, totals }) => {
  if (loading && !summary) return <LoadingSpinner message="Loading summary…" />;
  if (!summary) return null;

  if (!totals?.rows) {
    return (
      <div className="dd-empty">
        <div className="dd-empty-icon">🧹</div>
        <h3>No cleaned data yet</h3>
        <p>Run <strong>Clean &amp; Ingest</strong> to read the workbooks and build the lead warehouse.</p>
      </div>
    );
  }

  const cards = [
    { label: 'Cleaned rows',    value: nf.format(totals.rows) },
    { label: 'Unique numbers',  value: nf.format(totals.uniquePhones) },
    { label: 'Valid phones',    value: nf.format(totals.validPhones),
      hint: `${((totals.validPhones / totals.rows) * 100).toFixed(1)}% usable` },
    { label: 'Duplicate rate',  value: `${totals.duplicateRate.toFixed(1)}%`,
      hint: 'repeat touches on the same number' },
    { label: 'Converted',       value: nf.format(totals.converted) },
    { label: 'Unassigned',      value: nf.format(totals.unassigned),
      hint: 'not yet distributed' },
  ];

  return (
    <div className="dd-panel">
      <div className="dd-cards">
        {cards.map((c) => (
          <div key={c.label} className="dd-card">
            <div className="dd-card-value">{c.value}</div>
            <div className="dd-card-label">{c.label}</div>
            {c.hint && <div className="dd-card-hint">{c.hint}</div>}
          </div>
        ))}
      </div>

      <div className="dd-breakdowns">
        <Breakdown title="By product"  rows={summary.byProduct}  total={totals.rows} />
        <Breakdown title="By platform" rows={summary.byPlatform} total={totals.rows} />
        <Breakdown title="By status"   rows={summary.byStatus}   total={totals.rows} pretty />
        <Breakdown title="By workbook" rows={summary.byBook}     total={totals.rows} />
      </div>

      <div className="dd-breakdowns">
        <Breakdown title="By month" rows={summary.byMonth} total={totals.rows} wide />
      </div>
    </div>
  );
};

const Breakdown = ({ title, rows = [], total, pretty: doPretty, wide }) => (
  <div className={`dd-breakdown ${wide ? 'dd-breakdown--wide' : ''}`}>
    <h4>{title}</h4>
    {rows.length === 0 && <p className="dd-muted">No data</p>}
    {rows.map((r) => {
      const pct = total ? (r.count / total) * 100 : 0;
      return (
        <div key={r.key} className="dd-bar-row">
          <span className="dd-bar-key">{doPretty ? pretty(r.key) : (r.key || '—')}</span>
          <span className="dd-bar-track"><span className="dd-bar-fill" style={{ width: `${pct}%` }} /></span>
          <span className="dd-bar-val">{nf.format(r.count)}</span>
        </div>
      );
    })}
  </div>
);

/* --------------------------------------------------------------------- Leads */

const LeadsSection = ({ filters, notify }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const pageSize = 50;

  useEffect(() => { setPage(1); }, [filters, search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    digitalDataService.getLeads({ ...filters, search, page, pageSize })
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) notify('error', 'Could not load leads', e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters, search, page, notify]);

  const pages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <div className="dd-panel">
      <div className="dd-toolbar">
        <input
          className="dd-search"
          placeholder="Search phone or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {data && <span className="dd-count">{nf.format(data.total)} leads</span>}
      </div>

      {loading && !data && <LoadingSpinner message="Loading leads…" />}

      {data && (
        <>
          <div className="dd-table-wrap">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>Date</th><th>Name</th><th>Phone</th><th>Product</th>
                  <th>Platform</th><th>Status</th><th>Assigned to</th>
                  <th>Source</th><th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {data.leads.map((l) => (
                  <tr key={l.id} className={l.phoneValid ? '' : 'dd-row--warn'}>
                    <td>{l.date || <span className="dd-muted">—</span>}</td>
                    <td>{l.name || <span className="dd-muted">—</span>}</td>
                    <td className="dd-mono">
                      {l.phone || <span className="dd-muted">—</span>}
                      {!l.phoneValid && l.phone && <span className="dd-flag" title="Not a valid TZ mobile">!</span>}
                    </td>
                    <td>{l.product}</td>
                    <td>{pretty(l.platform)}</td>
                    <td>
                      <span className={`dd-pill dd-pill--${STATUS_TONE[l.status] || 'muted'}`}>
                        {pretty(l.status)}
                      </span>
                    </td>
                    <td>
                      {l.assignee
                        ? <span title={l.assignee.email}>{l.assignee.name}</span>
                        : (l.assignedTo || <span className="dd-muted">unassigned</span>)}
                    </td>
                    <td className="dd-src" title={`${l.sourceBook} / ${l.sourceTab} row ${l.sourceRow}`}>
                      {l.sourceBook} · {l.sourceTab}
                    </td>
                    <td>
                      {l.issues?.length
                        ? l.issues.map((i) => (
                            <span key={i} className="dd-issue" title={ISSUE_LABELS[i] || i}>
                              {(ISSUE_LABELS[i] || i).split(' ')[0]}
                            </span>
                          ))
                        : <span className="dd-ok">clean</span>}
                    </td>
                  </tr>
                ))}
                {data.leads.length === 0 && (
                  <tr><td colSpan={9} className="dd-muted dd-center">No leads match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="dd-pager">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <span>Page {page} of {nf.format(pages)}</span>
              <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------- Data Quality */

const QualitySection = ({ filters, notify }) => {
  const [q, setQ] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    digitalDataService.getQuality(filters)
      .then((r) => { if (!cancelled) setQ(r); })
      .catch((e) => { if (!cancelled) notify('error', 'Could not load quality report', e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters, notify]);

  if (loading && !q) return <LoadingSpinner message="Analysing data quality…" />;
  if (!q) return null;

  const usablePct = q.total ? (q.usable / q.total) * 100 : 0;
  const cleanPct  = q.total ? (q.clean / q.total) * 100 : 0;
  const blocking  = q.issues.filter((i) => i.blocking);
  const gaps      = q.issues.filter((i) => !i.blocking);

  return (
    <div className="dd-panel">
      <div className="dd-quality-hero">
        <div className="dd-quality-score">
          <div className="dd-quality-num">{usablePct.toFixed(1)}%</div>
          <div className="dd-quality-cap">callable — valid phone number</div>
        </div>
        <p className="dd-quality-note">
          {nf.format(q.usable)} of {nf.format(q.total)} rows have a number that can actually be
          dialled — that is what decides whether a lead is worth distributing.{' '}
          {nf.format(q.clean)} ({cleanPct.toFixed(1)}%) have no gaps of any kind; that figure is
          low mainly because several tabs never recorded a customer name at all.
          Nothing is deleted — every problem row is kept and flagged so it can be fixed at source.
        </p>
      </div>

      <h4 className="dd-h4">Blocking — these leads cannot be worked</h4>
      <div className="dd-issue-grid">
        {blocking.map((i) => (
          <div key={i.code} className="dd-issue-card">
            <div className="dd-issue-count">{nf.format(i.count)}</div>
            <div className="dd-issue-name">{ISSUE_LABELS[i.code] || i.code}</div>
            <div className="dd-issue-pct">{q.total ? ((i.count / q.total) * 100).toFixed(1) : 0}% of rows</div>
          </div>
        ))}
        {blocking.length === 0 && <p className="dd-muted">None — every row has a usable number.</p>}
      </div>

      <h4 className="dd-h4">Gaps — worth fixing at source, still workable</h4>
      <div className="dd-issue-grid">
        {gaps.map((i) => (
          <div key={i.code} className="dd-issue-card">
            <div className="dd-issue-count">{nf.format(i.count)}</div>
            <div className="dd-issue-name">{ISSUE_LABELS[i.code] || i.code}</div>
            <div className="dd-issue-pct">{q.total ? ((i.count / q.total) * 100).toFixed(1) : 0}% of rows</div>
          </div>
        ))}
        {gaps.length === 0 && <p className="dd-muted">No gaps recorded.</p>}
      </div>

      <h4 className="dd-h4">Per-tab health</h4>
      <div className="dd-table-wrap">
        <table className="dd-table">
          <thead>
            <tr><th>Workbook</th><th>Tab</th><th>Rows</th><th>No gaps</th><th>Callable</th><th>% callable</th></tr>
          </thead>
          <tbody>
            {q.tabs.map((t) => {
              // Health is measured by callable numbers, not by "no gaps" —
              // otherwise tabs that never captured a name all read as 0%.
              const pct = t.rows ? (t.validPhones / t.rows) * 100 : 0;
              return (
                <tr key={`${t.book}|${t.tab}`}>
                  <td>{t.book}</td>
                  <td>{t.tab}</td>
                  <td>{nf.format(t.rows)}</td>
                  <td>{nf.format(t.clean)}</td>
                  <td>{nf.format(t.validPhones)}</td>
                  <td>
                    <span className="dd-bar-track dd-bar-track--sm">
                      <span
                        className={`dd-bar-fill ${pct < 40 ? 'dd-bar-fill--bad' : pct < 75 ? 'dd-bar-fill--warn' : ''}`}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="dd-bar-val">{pct.toFixed(0)}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* --------------------------------------------------------------- Distribution */

/**
 * Hand leads to the people who will call them.
 *
 * Two ways to choose what to hand out:
 *   Scope mode  — everything matching the dropdowns, however many that is.
 *                 The filter goes to the server, so a 20,000-lead distribution
 *                 does not mean posting 20,000 ids.
 *   Pick mode   — tick individual leads, including ones already assigned.
 *
 * Re-assigning is the same action: a lead that already has an owner moves to
 * the new one, and the button says "Update distribution" to make that explicit.
 *
 * Assigning is only a database record — "Send to agents" is what actually
 * emails each person their own leads.
 */
const DistributionSection = ({ filters, notify, onDone }) => {
  const [people, setPeople] = useState([]);
  const [selectedPeople, setSelectedPeople] = useState([]);
  const [batches, setBatches] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState('');

  // what to distribute
  const [mode, setMode] = useState('SCOPE');          // SCOPE | PICK
  const [includeAssigned, setIncludeAssigned] = useState(false);
  const [scopeCount, setScopeCount] = useState(0);
  const [scopeAssigned, setScopeAssigned] = useState(0);

  // pick mode
  const [picker, setPicker] = useState(null);
  const [pickerPage, setPickerPage] = useState(1);
  const [pickedIds, setPickedIds] = useState([]);
  const [loadingPicker, setLoadingPicker] = useState(false);
  const PICK_SIZE = 100;

  // actions
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [sendPreview, setSendPreview] = useState(null);
  const [sending, setSending] = useState(false);
  const [lastBatchId, setLastBatchId] = useState(null);

  const product = filters.product || '';

  /** The filter that defines "what I am distributing", sent to the server. */
  const scopeFilter = useMemo(() => ({
    ...filters,
    validOnly: '1',
    ...(includeAssigned ? {} : { unassigned: '1' }),
  }), [filters, includeAssigned]);

  // --------------------------------------------------------------- loading

  const loadPeople = useCallback(async () => {
    try {
      const r = await digitalDataService.getDirectory({
        product: product || undefined,
        forDistribution: '1',
      });
      setPeople(r.people || []);
      setSelectedPeople([]);
    } catch (e) {
      notify('error', 'Could not load directory', e.message);
    }
  }, [product, notify]);

  const loadBatches = useCallback(async () => {
    try {
      const r = await digitalDataService.getDistributions(10);
      setBatches(r.batches || []);
    } catch { /* history is non-critical */ }
  }, []);

  // How many leads the current scope covers, and how many of those already
  // have an owner (so the button can say distribute vs update).
  const loadScope = useCallback(async () => {
    try {
      const [all, assigned] = await Promise.all([
        digitalDataService.getLeads({ ...scopeFilter, page: 1, pageSize: 1 }),
        digitalDataService.getLeads({ ...scopeFilter, assigned: '1', page: 1, pageSize: 1 }),
      ]);
      setScopeCount(all.total || 0);
      setScopeAssigned(assigned.total || 0);
    } catch (e) {
      notify('error', 'Could not size the selection', e.message);
    }
  }, [scopeFilter, notify]);

  const loadPicker = useCallback(async () => {
    if (mode !== 'PICK') return;
    setLoadingPicker(true);
    try {
      const r = await digitalDataService.getLeads({
        ...scopeFilter, page: pickerPage, pageSize: PICK_SIZE,
      });
      setPicker(r);
    } catch (e) {
      notify('error', 'Could not load leads', e.message);
    } finally {
      setLoadingPicker(false);
    }
  }, [mode, scopeFilter, pickerPage, notify]);

  useEffect(() => { loadPeople(); }, [loadPeople]);
  useEffect(() => { loadBatches(); }, [loadBatches]);
  useEffect(() => { loadScope(); }, [loadScope]);
  useEffect(() => { loadPicker(); }, [loadPicker]);
  useEffect(() => { setPickerPage(1); setPickedIds([]); }, [scopeFilter]);

  // ------------------------------------------------------------- selection

  const selectedCount = mode === 'PICK' ? pickedIds.length : scopeCount;

  // Whether this action changes an existing owner — drives the "Update" wording.
  const isUpdate = mode === 'PICK'
    ? (picker?.leads ?? []).some((l) => pickedIds.includes(l.id) && l.assignee?.name)
    : scopeAssigned > 0;

  const perPerson = selectedPeople.length
    ? Math.ceil(selectedCount / selectedPeople.length)
    : 0;

  const togglePerson = (id) =>
    setSelectedPeople((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const toggleLead = (id) =>
    setPickedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  // ---------------------------------------------------------------- actions

  const syncDirectory = async () => {
    setSyncing(true);
    try {
      const r = await digitalDataService.syncDirectory();
      notify('success', 'Directory synced', `${r.people} people loaded from Zone & Clusters.`);
      await loadPeople();
    } catch (e) {
      notify('error', 'Sync failed', e.message);
    } finally {
      setSyncing(false);
    }
  };

  const doDistribute = async () => {
    setConfirm(false);
    setWorking(true);
    try {
      // Scope mode sends the filter, not the ids — that is what lifts the old
      // 500-lead ceiling.
      const payload = {
        assigneeIds: selectedPeople,
        product: product || undefined,
        note,
        ...(mode === 'PICK' ? { leadIds: pickedIds } : { filter: scopeFilter }),
      };
      const r = await digitalDataService.distribute(payload);
      setLastBatchId(r.batchId);
      notify('success', r.reassigned > 0 ? 'Distribution updated' : 'Leads distributed',
        `${nf.format(r.assigned)} leads across ${r.assignees} people`
        + (r.reassigned > 0 ? ` — ${nf.format(r.reassigned)} moved to a new owner.` : '.')
        + ' Nobody has been emailed yet — use “Send to agents”.');
      setNote('');
      setPickedIds([]);
      await Promise.all([loadScope(), loadPicker(), loadBatches(), loadPeople()]);
      onDone?.();
    } catch (e) {
      notify('error', 'Distribution failed', e.message);
    } finally {
      setWorking(false);
    }
  };

  /** Ask the server who would receive what, before anything is sent. */
  const previewSend = async () => {
    setSending(true);
    try {
      const r = await digitalDataService.sendDistribution({
        ...(lastBatchId ? { batchId: lastBatchId } : { filter: { ...filters, assigned: '1' } }),
        dryRun: true,
      });
      setSendPreview(r.recipients || []);
    } catch (e) {
      notify('error', 'Could not prepare the send', e.message);
    } finally {
      setSending(false);
    }
  };

  const doSend = async () => {
    setSending(true);
    try {
      const r = await digitalDataService.sendDistribution({
        ...(lastBatchId ? { batchId: lastBatchId } : { filter: { ...filters, assigned: '1' } }),
        note,
      });
      setSendPreview(null);
      if (r.failed > 0) {
        const firstError = r.recipients.find((x) => x.status === 'FAILED')?.error;
        notify('warning', `Sent to ${r.sent}, failed for ${r.failed}`,
          firstError ? `First failure: ${firstError}` : 'See the send log for details.');
      } else {
        notify('success', 'Sent', `${r.sent} agents emailed their leads.`);
      }
      await Promise.all([loadBatches(), loadScope()]);
    } catch (e) {
      notify('error', 'Send failed', e.message);
    } finally {
      setSending(false);
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const pageSize = 2000;
      const all = [];
      let total = 0;
      for (let page = 1; ; page += 1) {
        const r = await digitalDataService.getLeads({ ...filters, page, pageSize });
        total = r.total || 0;
        all.push(...(r.leads || []));
        setExportProgress(total ? Math.round((all.length / total) * 100) : 0);
        if (all.length >= total || !r.leads?.length) break;
      }
      if (all.length === 0) {
        notify('info', 'Nothing to export', 'No leads match the current filters.');
        return;
      }
      downloadDistributionReport(all, filters);
      const assigned = all.filter((l) => l.assignee?.name).length;
      notify('success', 'Export ready',
        `${nf.format(all.length)} leads downloaded — ${nf.format(assigned)} distributed, `
        + `${nf.format(all.length - assigned)} not yet assigned.`);
    } catch (e) {
      notify('error', 'Export failed', e.message);
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  const pickerPages = picker ? Math.ceil(picker.total / PICK_SIZE) : 0;

  // -------------------------------------------------------------- rendering

  return (
    <div className="dd-panel">
      {(working || sending) && (
        <LoadingSpinner
          fullScreen
          messages={working
            ? ['Assigning leads…', 'Recording the batch…']
            : ['Building each agent’s file…', 'Sending emails…']}
        />
      )}

      <div className="dd-dist-head">
        <div>
          <h4 className="dd-h4">Distribute leads</h4>
          <p className="dd-muted">{ROUTING_HINT[product] ?? ROUTING_HINT_ALL}</p>
        </div>
        <div className="dd-dist-head-actions">
          <button className="dd-btn" disabled={exporting} onClick={exportExcel}>
            {exporting ? `Preparing… ${exportProgress}%` : '⬇ Download Excel'}
          </button>
          <button className="dd-btn" disabled={syncing} onClick={syncDirectory}>
            {syncing ? 'Syncing…' : '🔄 Sync directory'}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------- what to distribute */}
      <div className="dd-scope">
        <div className="dd-scope-modes">
          <button
            className={`dd-chip ${mode === 'SCOPE' ? 'is-on' : ''}`}
            onClick={() => setMode('SCOPE')}
          >
            Everything matching the filter
          </button>
          <button
            className={`dd-chip ${mode === 'PICK' ? 'is-on' : ''}`}
            onClick={() => setMode('PICK')}
          >
            Pick specific leads
          </button>
          <label className="dd-check" title="Include leads that already have an owner, so they can be moved">
            <input
              type="checkbox"
              checked={includeAssigned}
              onChange={(e) => setIncludeAssigned(e.target.checked)}
            />
            Include already-distributed
          </label>
        </div>

        <p className="dd-scope-line">
          {mode === 'SCOPE' ? (
            <>
              <strong>{nf.format(scopeCount)}</strong> callable lead
              {scopeCount === 1 ? '' : 's'} match the filters above
              {scopeAssigned > 0 && <> — <strong>{nf.format(scopeAssigned)}</strong> already have an owner and will be moved</>}
              .
            </>
          ) : (
            <>
              <strong>{nf.format(pickedIds.length)}</strong> selected of{' '}
              {nf.format(picker?.total ?? 0)} matching.
            </>
          )}
        </p>
      </div>

      <div className="dd-dist-grid">
        {/* ------------------------------------------------------ lead picker */}
        <div className="dd-dist-col">
          <h5>
            Leads
            {mode === 'PICK' && picker && (
              <span className="dd-count">page {pickerPage} of {nf.format(pickerPages)}</span>
            )}
          </h5>

          {mode === 'SCOPE' && (
            <p className="dd-muted dd-small">
              All {nf.format(scopeCount)} leads matching the dropdowns will be shared out —
              there is no cap. Switch to <em>Pick specific leads</em> to choose individually.
            </p>
          )}

          {mode === 'PICK' && (
            <>
              {loadingPicker && <LoadingSpinner size="small" message="Loading…" />}
              <div className="dd-person-actions">
                <button
                  className="dd-link"
                  onClick={() => setPickedIds((p) => [
                    ...new Set([...p, ...(picker?.leads ?? []).map((l) => l.id)]),
                  ])}
                >
                  Select page
                </button>
                <button className="dd-link" onClick={() => setPickedIds([])}>Clear all</button>
              </div>
              <div className="dd-people dd-leadpick">
                {(picker?.leads ?? []).map((l) => (
                  <label
                    key={l.id}
                    className={`dd-person ${pickedIds.includes(l.id) ? 'is-on' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={pickedIds.includes(l.id)}
                      onChange={() => toggleLead(l.id)}
                    />
                    <span className="dd-person-main">
                      <span className="dd-person-name dd-mono">{l.phone}</span>
                      <span className="dd-person-meta">
                        {l.name || 'no name'} · {l.product}
                        {l.assignee?.name && ` · now: ${l.assignee.name}`}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {pickerPages > 1 && (
                <div className="dd-pager">
                  <button disabled={pickerPage <= 1} onClick={() => setPickerPage((p) => p - 1)}>← Prev</button>
                  <span>{pickerPage} / {nf.format(pickerPages)}</span>
                  <button disabled={pickerPage >= pickerPages} onClick={() => setPickerPage((p) => p + 1)}>Next →</button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ------------------------------------------------------- assignees */}
        <div className="dd-dist-col">
          <h5>
            Assign to
            <span className="dd-count">{selectedPeople.length} of {people.length}</span>
          </h5>
          {people.length === 0 && (
            <p className="dd-muted">
              No eligible people loaded. Click <strong>Sync directory</strong> to pull them
              from the Zone &amp; Clusters workbook.
            </p>
          )}
          <div className="dd-people">
            {people.map((p) => (
              <label key={p.id} className={`dd-person ${selectedPeople.includes(p.id) ? 'is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={selectedPeople.includes(p.id)}
                  onChange={() => togglePerson(p.id)}
                />
                <span className="dd-person-main">
                  <span className="dd-person-name">{p.name}</span>
                  <span className="dd-person-meta">
                    {[p.role, p.branch].filter(Boolean).join(' · ') || '—'}
                    {!p.email && ' · no email'}
                  </span>
                </span>
                <span className="dd-person-load" title="Leads already assigned">{p.currentLoad}</span>
              </label>
            ))}
          </div>
          {people.length > 0 && (
            <div className="dd-person-actions">
              <button className="dd-link" onClick={() => setSelectedPeople(people.map((p) => p.id))}>
                Select all
              </button>
              <button className="dd-link" onClick={() => setSelectedPeople([])}>Clear</button>
            </div>
          )}
        </div>
      </div>

      <div className="dd-dist-footer">
        <input
          className="dd-search dd-note"
          placeholder="Note for this batch — also shown in the email (optional)…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="dd-dist-summary">
          {selectedPeople.length > 0 && selectedCount > 0
            ? <>≈ <strong>{nf.format(perPerson)}</strong> leads each, round-robin</>
            : <span className="dd-muted">Select leads and at least one person</span>}
        </div>
        <button
          className="dd-btn dd-btn--primary"
          disabled={working || !selectedPeople.length || !selectedCount}
          onClick={() => setConfirm(true)}
        >
          {isUpdate ? '♻ Update distribution' : '📤 Distribute'}
          {selectedCount ? ` — ${nf.format(selectedCount)}` : ''}
        </button>
        <button
          className="dd-btn"
          disabled={sending}
          onClick={previewSend}
          title="Email each agent their own leads as an Excel attachment"
        >
          {sending ? 'Working…' : '✉ Send to agents'}
        </button>
      </div>

      {/* ------------------------------------------------------ send preview */}
      {sendPreview && (
        <div className="dd-sendbox">
          <h5>Ready to send</h5>
          {sendPreview.length === 0 && (
            <p className="dd-muted">
              Nobody to send to — either nothing is assigned in this scope, it has all been
              sent already, or the assignees have no email address on file.
            </p>
          )}
          {sendPreview.length > 0 && (
            <>
              <p className="dd-muted dd-small">
                Each person gets their own leads as an Excel attachment. Leads already sent
                to the same person are skipped.
              </p>
              <div className="dd-table-wrap">
                <table className="dd-table">
                  <thead><tr><th>Agent</th><th>Email</th><th>Branch</th><th>Leads</th></tr></thead>
                  <tbody>
                    {sendPreview.map((r) => (
                      <tr key={r.email}>
                        <td>{r.name}</td>
                        <td>{r.email}</td>
                        <td>{r.branch}</td>
                        <td>{nf.format(r.leads)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="dd-person-actions">
            <button
              className="dd-btn dd-btn--primary"
              disabled={sending || sendPreview.length === 0}
              onClick={doSend}
            >
              ✉ Send {sendPreview.length ? `to ${sendPreview.length}` : ''}
            </button>
            <button className="dd-btn" onClick={() => setSendPreview(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- history */}
      {batches.length > 0 && (
        <>
          <h4 className="dd-h4">Recent distributions</h4>
          <div className="dd-batches">
            {batches.map((b) => (
              <div key={b.id} className="dd-batch">
                <div className="dd-batch-head">
                  <strong>{nf.format(b.leadCount)} leads</strong>
                  <span className="dd-muted">
                    {b.product || 'all'} · {b.assigneeCount} people ·{' '}
                    {new Date(b.createdAt).toLocaleString()}
                    {b.createdBy && ` · by ${b.createdBy}`}
                  </span>
                </div>
                {b.note && <div className="dd-batch-note">{b.note}</div>}
                <div className="dd-batch-breakdown">
                  {b.breakdown?.map((x) => (
                    <span key={x.name} className="dd-batch-chip">
                      {x.name} <strong>{x.leads}</strong>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirm}
        title={isUpdate ? 'Update this distribution?' : 'Distribute these leads?'}
        message={
          `${nf.format(selectedCount)} leads will be shared across `
          + `${selectedPeople.length} ${selectedPeople.length === 1 ? 'person' : 'people'} `
          + `(about ${nf.format(perPerson)} each). `
          + (isUpdate
            ? 'Leads that already have an owner will move to the new one, and will need sending again. '
            : '')
          + 'Nobody is emailed by this step — use “Send to agents” afterwards.'
        }
        confirmLabel={isUpdate ? 'Update' : 'Distribute'}
        cancelLabel="Cancel"
        onConfirm={doDistribute}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
};

export default DigitalData;
