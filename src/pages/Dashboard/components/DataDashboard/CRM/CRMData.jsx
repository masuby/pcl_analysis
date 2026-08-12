/**
 * CRM — the accumulating client store, distributed to branch Team Leaders.
 *
 * How it differs from DIGITAL DATA: that section rebuilds itself from Google
 * Sheets on every ingest. This one ACCUMULATES. Each uploaded Lead_Report is
 * merged into the store on the client's phone number — new numbers append,
 * numbers already held are updated in place — so the server keeps one current
 * row per client no matter how often the report is re-uploaded.
 *
 * Four sections: Overview, Leads, Upload, Distribution.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import crmDataService from '../../../../../services/crmData';
import LoadingSpinner from '../../../../../components/Common/Loading/LoadingSpinner';
import { Toast, ConfirmDialog } from '../../../../../components/feedback/Feedback';
import { downloadCRMReport } from './utils/crmExport';
import '../DigitalData/DigitalData.css';   // shared visual language
import './CRMData.css';

const SECTIONS = [
  { key: 'OVERVIEW',     label: 'Overview',     icon: '📊' },
  { key: 'LEADS',        label: 'Leads',        icon: '📇' },
  { key: 'UPLOAD',       label: 'Upload',       icon: '⬆' },
  { key: 'DISTRIBUTION', label: 'Distribution', icon: '📤' },
];

const nf = new Intl.NumberFormat('en-US');

const STATUS_TONE = {
  Active: 'good', Converted: 'good', Rejected: 'bad', Inactive: 'muted',
};

const CRMData = () => {
  const [section, setSection] = useState('OVERVIEW');
  const [toast, setToast] = useState(null);
  const notify = (type, title, message) => setToast({ type, title, message });

  const [filters, setFilters] = useState({ status: '', branch: '', region: '', team: '' });
  const [options, setOptions] = useState({ statuses: [], branches: [], regions: [], teams: [] });
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, f] = await Promise.all([
        crmDataService.getSummary(filters),
        crmDataService.getFilters(),
      ]);
      setSummary(s);
      setOptions(f);
    } catch (e) {
      notify('error', 'Could not load CRM data', e.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => setFilters((p) => ({ ...p, [k]: v }));
  const t = summary?.totals;

  return (
    <div className="dd-root">
      <div className="dd-header">
        <div>
          <h2 className="dd-title">🗂 CRM Data</h2>
          <p className="dd-sub">
            One row per client, accumulated across every uploaded Lead_Report and
            distributed to the Team Leader of each client&apos;s branch.
          </p>
        </div>
        <div className="dd-header-actions">
          {t && <span className="dd-lastrun">{nf.format(t.leads)} clients in the store</span>}
        </div>
      </div>

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

      {section !== 'UPLOAD' && (
        <div className="dd-filters">
          <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            {options.statuses.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.branch} onChange={(e) => setFilter('branch', e.target.value)}>
            <option value="">All branches</option>
            {options.branches.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.region} onChange={(e) => setFilter('region', e.target.value)}>
            <option value="">All regions</option>
            {options.regions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filters.team} onChange={(e) => setFilter('team', e.target.value)}>
            <option value="">All teams</option>
            {options.teams.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      )}

      {section === 'OVERVIEW'     && <Overview summary={summary} loading={loading} totals={t} />}
      {section === 'LEADS'        && <Leads filters={filters} notify={notify} />}
      {section === 'UPLOAD'       && <Upload notify={notify} onDone={load} />}
      {section === 'DISTRIBUTION' && <Distribution filters={filters} notify={notify} onDone={load} />}

      <Toast
        open={!!toast} type={toast?.type} title={toast?.title}
        message={toast?.message} duration={6000} onClose={() => setToast(null)}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ Overview */

const Overview = ({ summary, loading, totals }) => {
  if (loading && !summary) return <LoadingSpinner message="Loading CRM summary…" />;
  if (!summary) return null;

  if (!totals?.leads) {
    return (
      <div className="dd-empty">
        <div className="dd-empty-icon">🗂</div>
        <h3>No CRM data yet</h3>
        <p>Go to <strong>Upload</strong> and add a Lead_Report file to build the store.</p>
      </div>
    );
  }

  const cards = [
    { label: 'Clients', value: nf.format(totals.leads) },
    { label: 'Callable numbers', value: nf.format(totals.validPhones),
      hint: `${((totals.validPhones / totals.leads) * 100).toFixed(1)}% valid` },
    { label: 'Has a Team Leader', value: nf.format(totals.routable),
      hint: `${((totals.routable / totals.leads) * 100).toFixed(0)}% routable` },
    { label: 'No Team Leader', value: nf.format(totals.unroutable),
      hint: 'branch missing or unmatched' },
    { label: 'Distributed', value: nf.format(totals.assigned) },
    { label: 'Converted', value: nf.format(totals.converted) },
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
        <Breakdown title="By status" rows={summary.byStatus} total={totals.leads} />
        <Breakdown title="By branch" rows={summary.byBranch} total={totals.leads} />
        <Breakdown title="By region" rows={summary.byRegion} total={totals.leads} />
        <Breakdown title="By team"   rows={summary.byTeam}   total={totals.leads} />
      </div>
    </div>
  );
};

const Breakdown = ({ title, rows = [], total }) => (
  <div className="dd-breakdown">
    <h4>{title}</h4>
    {rows.length === 0 && <p className="dd-muted">No data</p>}
    {rows.map((r) => (
      <div key={r.key} className="dd-bar-row">
        <span className="dd-bar-key" title={r.key}>{r.key}</span>
        <span className="dd-bar-track">
          <span className="dd-bar-fill" style={{ width: `${total ? (r.count / total) * 100 : 0}%` }} />
        </span>
        <span className="dd-bar-val">{nf.format(r.count)}</span>
      </div>
    ))}
  </div>
);

/* --------------------------------------------------------------------- Leads */

const Leads = ({ filters, notify }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const pageSize = 50;

  useEffect(() => { setPage(1); }, [filters, search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    crmDataService.getLeads({ ...filters, search, page, pageSize })
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
          className="dd-search" placeholder="Search phone or client name…"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        {data && <span className="dd-count">{nf.format(data.total)} clients</span>}
      </div>

      {loading && !data && <LoadingSpinner message="Loading clients…" />}

      {data && (
        <>
          <div className="dd-table-wrap">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>Client</th><th>Phone</th><th>Branch</th><th>Region</th>
                  <th>Team</th><th>Status</th><th>Consent</th>
                  <th>Team Leader</th><th>Updates</th>
                </tr>
              </thead>
              <tbody>
                {data.leads.map((l) => (
                  <tr key={l.id} className={l.phoneValid ? '' : 'dd-row--warn'}>
                    <td>{l.name || <span className="dd-muted">—</span>}</td>
                    <td className="dd-mono">
                      {l.phone}
                      {!l.phoneValid && <span className="dd-flag" title="Not a valid TZ mobile">!</span>}
                    </td>
                    <td>{l.branch || <span className="dd-muted">no branch</span>}</td>
                    <td>{l.region || <span className="dd-muted">—</span>}</td>
                    <td>{l.team || <span className="dd-muted">—</span>}</td>
                    <td>
                      <span className={`dd-pill dd-pill--${STATUS_TONE[l.status] || 'muted'}`}>
                        {l.status || '—'}
                      </span>
                    </td>
                    <td>{l.consentDate || <span className="dd-muted">—</span>}</td>
                    <td>
                      {l.assignee
                        ? (
                          <span title={l.assignee.email}>
                            {l.assignee.name}
                            {l.assignee.sentAt && <span className="crm-sent" title={`Sent ${l.assignee.sentAt}`}>✉</span>}
                          </span>
                        )
                        : <span className="dd-muted">not distributed</span>}
                    </td>
                    <td>{l.updateCount > 0
                      ? <span className="crm-updates" title="Times this client was re-uploaded">{l.updateCount}</span>
                      : <span className="dd-muted">—</span>}</td>
                  </tr>
                ))}
                {data.leads.length === 0 && (
                  <tr><td colSpan={9} className="dd-muted dd-center">No clients match these filters.</td></tr>
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

/* -------------------------------------------------------------------- Upload */

const Upload = ({ notify, onDone }) => {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [dragging, setDragging] = useState(false);

  const loadHistory = useCallback(() => {
    crmDataService.getUploads(10)
      .then((r) => setUploads(r.uploads || []))
      .catch(() => { /* history is advisory */ });
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const pick = (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      notify('error', 'Wrong file type', 'Please choose the .xlsx Lead_Report export.');
      return;
    }
    setFile(f);
    setResult(null);
  };

  const doUpload = async () => {
    if (!file) return;
    setBusy(true);
    setProgress(0);
    try {
      const r = await crmDataService.upload(file, setProgress);
      setResult(r.result);
      notify('success', 'File merged',
        `${nf.format(r.result.inserted)} new client${r.result.inserted === 1 ? '' : 's'} added, `
        + `${nf.format(r.result.updated)} updated. Store now holds ${nf.format(r.result.totalInStore)}.`);
      setFile(null);
      loadHistory();
      onDone?.();
    } catch (e) {
      notify('error', 'Upload failed', e.message);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <div className="dd-panel">
      {busy && <LoadingSpinner fullScreen messages={['Uploading…', 'Merging into the store…']} />}

      <h4 className="dd-h4">Upload a Lead_Report</h4>
      <p className="dd-muted dd-small">
        The file is merged into the existing store, not replaced. A phone number that is
        already held has its row <strong>updated</strong>; a number not seen before is
        <strong> appended</strong>. Blank cells never erase data we already have.
      </p>

      <label
        className={`crm-drop ${dragging ? 'is-drag' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
      >
        <input
          type="file" accept=".xlsx" hidden disabled={busy}
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <span className="crm-drop-icon">{file ? '📄' : '⬆'}</span>
        <span className="crm-drop-main">
          {file ? file.name : 'Drop the Lead_Report .xlsx here, or click to choose'}
        </span>
        {file && <span className="crm-drop-sub">{(file.size / 1024 / 1024).toFixed(1)} MB</span>}
      </label>

      {busy && progress > 0 && (
        <div className="crm-progress">
          <span className="crm-progress-fill" style={{ width: `${progress}%` }} />
          <span className="crm-progress-label">{progress}%</span>
        </div>
      )}

      <div className="dd-dist-footer" style={{ borderTop: 'none', paddingTop: 0 }}>
        <button className="dd-btn dd-btn--primary" disabled={!file || busy} onClick={doUpload}>
          ⬆ Merge into store
        </button>
        {file && !busy && (
          <button className="dd-btn" onClick={() => setFile(null)}>Clear</button>
        )}
      </div>

      {result && (
        <div className="crm-result">
          <h5>Merge complete</h5>
          <div className="dd-cards">
            <div className="dd-card">
              <div className="dd-card-value">{nf.format(result.inserted)}</div>
              <div className="dd-card-label">New clients appended</div>
            </div>
            <div className="dd-card">
              <div className="dd-card-value">{nf.format(result.updated)}</div>
              <div className="dd-card-label">Existing clients updated</div>
            </div>
            <div className="dd-card">
              <div className="dd-card-value">{nf.format(result.totalInStore)}</div>
              <div className="dd-card-label">Total in store</div>
            </div>
            {result.badPhones > 0 && (
              <div className="dd-card">
                <div className="dd-card-value">{nf.format(result.badPhones)}</div>
                <div className="dd-card-label">Kept, but not a valid TZ mobile</div>
              </div>
            )}
            {result.skipped > 0 && (
              <div className="dd-card">
                <div className="dd-card-value">{nf.format(result.skipped)}</div>
                <div className="dd-card-label">Skipped — no phone number at all</div>
              </div>
            )}
          </div>
        </div>
      )}

      {uploads.length > 0 && (
        <>
          <h4 className="dd-h4">Recent uploads</h4>
          <div className="dd-table-wrap">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>File</th><th>When</th><th>By</th><th>Read</th>
                  <th>Appended</th><th>Updated</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr key={u.id}>
                    <td>{u.fileName}</td>
                    <td>{new Date(u.createdAt).toLocaleString()}</td>
                    <td>{u.uploadedBy || <span className="dd-muted">—</span>}</td>
                    <td>{nf.format(u.rowsRead)}</td>
                    <td>{nf.format(u.inserted)}</td>
                    <td>{nf.format(u.updated)}</td>
                    <td>
                      <span className={`dd-pill dd-pill--${u.status === 'SUCCESS' ? 'good' : u.status === 'FAILED' ? 'bad' : 'warn'}`}>
                        {u.status.toLowerCase()}
                      </span>
                      {u.error && <div className="crm-err" title={u.error}>{u.error.slice(0, 60)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

/* -------------------------------------------------------------- Distribution */

const Distribution = ({ filters, notify, onDone }) => {
  const [tls, setTls] = useState([]);
  const [selected, setSelected] = useState([]);
  const [method, setMethod] = useState('BY_BRANCH');
  const [scope, setScope] = useState({ count: 0, routable: 0 });
  const [note, setNote] = useState('');
  const [batches, setBatches] = useState([]);
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendPreview, setSendPreview] = useState(null);
  const [lastBatchId, setLastBatchId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportPct, setExportPct] = useState(0);

  // BY_BRANCH can only place a lead whose branch maps to a TL, so the scope is
  // narrowed to routable leads; ROUND_ROBIN can place anything.
  const scopeFilter = useMemo(() => ({
    ...filters,
    unassigned: '1',
    ...(method === 'BY_BRANCH' ? { routable: '1' } : {}),
  }), [filters, method]);

  const loadTLs = useCallback(() => {
    crmDataService.getTeamLeaders()
      .then((r) => setTls(r.teamLeaders || []))
      .catch((e) => notify('error', 'Could not load Team Leaders', e.message));
  }, [notify]);

  const loadScope = useCallback(async () => {
    try {
      const [all, routable] = await Promise.all([
        crmDataService.getLeads({ ...filters, unassigned: '1', page: 1, pageSize: 1 }),
        crmDataService.getLeads({ ...filters, unassigned: '1', routable: '1', page: 1, pageSize: 1 }),
      ]);
      setScope({ count: all.total || 0, routable: routable.total || 0 });
    } catch { /* advisory */ }
  }, [filters]);

  const loadBatches = useCallback(() => {
    crmDataService.getDistributions(10)
      .then((r) => setBatches(r.batches || []))
      .catch(() => {});
  }, []);

  useEffect(() => { loadTLs(); }, [loadTLs]);
  useEffect(() => { loadScope(); }, [loadScope]);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  const targetCount = method === 'BY_BRANCH' ? scope.routable : scope.count;
  const perPerson = selected.length ? Math.ceil(targetCount / selected.length) : 0;

  const doDistribute = async () => {
    setConfirm(false);
    setWorking(true);
    try {
      const r = await crmDataService.distribute({
        filter: scopeFilter,
        method,
        assigneeIds: method === 'BY_BRANCH' ? [] : selected,
        note,
      });
      setLastBatchId(r.batchId);
      notify('success', 'Leads distributed',
        `${nf.format(r.assigned)} lead${r.assigned === 1 ? '' : 's'} assigned`
        + (r.unroutable > 0 ? ` — ${nf.format(r.unroutable)} had no Team Leader for their branch.` : '.')
        + ' Nobody has been emailed yet — use “Send to Team Leaders”.');
      setNote('');
      await Promise.all([loadScope(), loadBatches(), loadTLs()]);
      onDone?.();
    } catch (e) {
      notify('error', 'Distribution failed', e.message);
    } finally {
      setWorking(false);
    }
  };

  const previewSend = async () => {
    setSending(true);
    try {
      const r = await crmDataService.send({
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
      const r = await crmDataService.send({
        ...(lastBatchId ? { batchId: lastBatchId } : { filter: { ...filters, assigned: '1' } }),
        note,
      });
      setSendPreview(null);
      if (r.failed > 0) {
        const first = r.recipients.find((x) => x.status === 'FAILED')?.error;
        notify('warning', `Sent to ${r.sent}, failed for ${r.failed}`,
          first ? `First failure: ${first}` : 'See the send log for details.');
      } else {
        notify('success', 'Sent', `${r.sent} Team Leader${r.sent === 1 ? '' : 's'} emailed their leads.`);
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
        const r = await crmDataService.getLeads({ ...filters, page, pageSize });
        total = r.total || 0;
        all.push(...(r.leads || []));
        setExportPct(total ? Math.round((all.length / total) * 100) : 0);
        if (all.length >= total || !r.leads?.length) break;
      }
      if (!all.length) {
        notify('info', 'Nothing to export', 'No clients match the current filters.');
        return;
      }
      downloadCRMReport(all, filters);
      const assigned = all.filter((l) => l.assignee?.name).length;
      notify('success', 'Export ready',
        `${nf.format(all.length)} clients downloaded — ${nf.format(assigned)} distributed.`);
    } catch (e) {
      notify('error', 'Export failed', e.message);
    } finally {
      setExporting(false);
      setExportPct(0);
    }
  };

  const toggle = (id) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="dd-panel">
      {(working || sending) && (
        <LoadingSpinner
          fullScreen
          messages={working
            ? ['Matching branches to Team Leaders…', 'Assigning leads…']
            : ['Building each Team Leader’s file…', 'Sending emails…']}
        />
      )}

      <div className="dd-dist-head">
        <div>
          <h4 className="dd-h4">Distribute to Team Leaders</h4>
          <p className="dd-muted">
            Each client goes to a Team Leader of their own branch. Branch names are matched
            across the CRM export and the Zone &amp; Clusters directory, and the product must
            agree — a CS call-centre client never reaches an LBF Team Leader.
          </p>
        </div>
        <div className="dd-dist-head-actions">
          <button className="dd-btn" disabled={exporting} onClick={exportExcel}>
            {exporting ? `Preparing… ${exportPct}%` : '⬇ Download Excel'}
          </button>
        </div>
      </div>

      <div className="dd-scope">
        <div className="dd-scope-modes">
          <button
            className={`dd-chip ${method === 'BY_BRANCH' ? 'is-on' : ''}`}
            onClick={() => setMethod('BY_BRANCH')}
          >
            By branch (recommended)
          </button>
          <button
            className={`dd-chip ${method === 'ROUND_ROBIN' ? 'is-on' : ''}`}
            onClick={() => setMethod('ROUND_ROBIN')}
          >
            Round-robin across chosen TLs
          </button>
        </div>
        <p className="dd-scope-line">
          {method === 'BY_BRANCH' ? (
            <>
              <strong>{nf.format(scope.routable)}</strong> undistributed client
              {scope.routable === 1 ? '' : 's'} can be matched to a Team Leader
              {scope.count > scope.routable && (
                <> — {nf.format(scope.count - scope.routable)} cannot, because their branch is
                missing or has no Team Leader in the directory</>
              )}.
            </>
          ) : (
            <>
              <strong>{nf.format(scope.count)}</strong> undistributed client
              {scope.count === 1 ? '' : 's'} will be spread evenly across the Team Leaders
              you tick below, regardless of branch.
            </>
          )}
        </p>
      </div>

      <div className="dd-dist-col" style={{ marginBottom: 16 }}>
        <h5>
          Team Leaders
          <span className="dd-count">
            {method === 'BY_BRANCH' ? `${tls.length} in directory` : `${selected.length} of ${tls.length}`}
          </span>
        </h5>
        {tls.length === 0 && (
          <p className="dd-muted">
            No Team Leaders found. Sync the directory from{' '}
            <strong>Digital Data → Distribution → Sync directory</strong> first.
          </p>
        )}
        <div className="dd-people">
          {tls.map((p) => (
            <label
              key={p.id}
              className={`dd-person ${selected.includes(p.id) ? 'is-on' : ''}`}
              title={p.email || 'no email on file'}
            >
              <input
                type="checkbox"
                disabled={method === 'BY_BRANCH'}
                checked={selected.includes(p.id)}
                onChange={() => toggle(p.id)}
              />
              <span className="dd-person-main">
                <span className="dd-person-name">{p.name}</span>
                <span className="dd-person-meta">
                  {p.branches || '—'}
                  {!p.email && ' · no email'}
                  {p.leadsInBranch > 0 && ` · ${nf.format(p.leadsInBranch)} in branch`}
                </span>
              </span>
              <span className="dd-person-load" title="Leads already assigned">{p.currentLoad}</span>
            </label>
          ))}
        </div>
        {method === 'BY_BRANCH' && tls.length > 0 && (
          <p className="dd-muted dd-small" style={{ marginTop: 8 }}>
            Ticking is disabled in branch mode — each lead is routed automatically by its own branch.
          </p>
        )}
      </div>

      <div className="dd-dist-footer">
        <input
          className="dd-search dd-note"
          placeholder="Note for this batch — also shown in the email (optional)…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="dd-dist-summary">
          {method === 'ROUND_ROBIN' && selected.length > 0 && targetCount > 0
            ? <>≈ <strong>{nf.format(perPerson)}</strong> leads each</>
            : method === 'BY_BRANCH'
              ? <span className="dd-muted">Routed automatically by branch</span>
              : <span className="dd-muted">Select at least one Team Leader</span>}
        </div>
        <button
          className="dd-btn dd-btn--primary"
          disabled={working || targetCount === 0 || (method === 'ROUND_ROBIN' && !selected.length)}
          onClick={() => setConfirm(true)}
        >
          📤 Distribute {targetCount ? nf.format(targetCount) : ''}
        </button>
        <button className="dd-btn" disabled={sending} onClick={previewSend}>
          {sending ? 'Working…' : '✉ Send to Team Leaders'}
        </button>
      </div>

      {sendPreview && (
        <div className="dd-sendbox">
          <h5>Ready to send</h5>
          {sendPreview.length === 0 && (
            <p className="dd-muted">
              Nobody to send to — either nothing is assigned in this scope, it has all been
              sent already, or the Team Leaders have no email address on file.
            </p>
          )}
          {sendPreview.length > 0 && (
            <>
              <p className="dd-muted dd-small">
                Each Team Leader receives only their own clients, as an Excel attachment.
                Leads already sent to the same person are skipped.
              </p>
              <div className="dd-table-wrap">
                <table className="dd-table">
                  <thead><tr><th>Team Leader</th><th>Email</th><th>Branch</th><th>Leads</th></tr></thead>
                  <tbody>
                    {sendPreview.map((r) => (
                      <tr key={r.email}>
                        <td>{r.name}</td><td>{r.email}</td><td>{r.branch}</td>
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

      {batches.length > 0 && (
        <>
          <h4 className="dd-h4">Recent distributions</h4>
          <div className="dd-batches">
            {batches.map((b) => (
              <div key={b.id} className="dd-batch">
                <div className="dd-batch-head">
                  <strong>{nf.format(b.leadCount)} leads</strong>
                  <span className="dd-muted">
                    {b.method.replace('_', ' ').toLowerCase()} · {b.assigneeCount} team leaders ·{' '}
                    {nf.format(b.sentCount)} sent · {new Date(b.createdAt).toLocaleString()}
                    {b.createdBy && ` · by ${b.createdBy}`}
                  </span>
                </div>
                {b.note && <div className="dd-batch-note">{b.note}</div>}
                <div className="dd-batch-breakdown">
                  {b.breakdown?.slice(0, 20).map((x) => (
                    <span key={x.name + x.branch} className="dd-batch-chip">
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
        title="Distribute these clients?"
        message={
          method === 'BY_BRANCH'
            ? `${nf.format(targetCount)} clients will be assigned to a Team Leader of their own `
              + 'branch. Clients whose branch has no Team Leader are left undistributed. '
              + 'Nobody is emailed by this step.'
            : `${nf.format(targetCount)} clients will be spread across ${selected.length} `
              + `Team Leader${selected.length === 1 ? '' : 's'} (about ${nf.format(perPerson)} each), `
              + 'ignoring branch. Nobody is emailed by this step.'
        }
        confirmLabel="Distribute"
        cancelLabel="Cancel"
        onConfirm={doDistribute}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
};

export default CRMData;
