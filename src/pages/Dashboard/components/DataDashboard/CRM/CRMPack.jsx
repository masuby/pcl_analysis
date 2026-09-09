import { useCallback, useEffect, useRef, useState } from 'react';
import crmDataService from '../../../../../services/crmData';
import DistributeModal from '../Mambu/DistributeModal';

/**
 * CRM distribution pack — the CRM counterpart of a MAMBU run.
 *
 * Once leads have been distributed to Team Leaders, this splits them into one
 * workbook per branch, per cluster and per zone (plus a FULL file per
 * product), zipped on the server for download. The same three Distribute
 * buttons as MAMBU DATA then email those files: branches get their own
 * workbook, cluster and zone managers get a zip of everything under them,
 * with the addresses read from the Zone and Clusters roster. Every send opens
 * a preview first and lets the operator Cc anyone who should see it.
 */

const PRODUCTS = [
  { key: 'CS', label: 'CS' },
  { key: 'LBF', label: 'LBF' },
  { key: 'SME', label: 'SME' },
];

const MODE_TEXT = {
  branch: {
    title: 'Send to branches',
    what: 'Each branch gets its own workbook, sent to the Team Leaders who own its leads.',
  },
  cluster: {
    title: 'Send to cluster managers',
    what: 'Each cluster manager gets one zip: the cluster workbook plus every branch workbook in the cluster.',
  },
  zone: {
    title: 'Send to zone managers',
    what: 'Each zone manager gets one zip: the zone workbook plus every branch workbook in the zone.',
  },
};

const PACK_API = {
  preview: (p) => crmDataService.previewPackSend(p),
  send: (p) => crmDataService.sendPack(p),
};

const nf = new Intl.NumberFormat('en-US');
const fmtNum = (n) => nf.format(Number(n || 0));

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

const CRMPack = ({ filters, notify }) => {
  const [products, setProducts] = useState(PRODUCTS.map((p) => p.key));
  const [pack, setPack] = useState(null);
  const [packs, setPacks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sendMode, setSendMode] = useState('');
  const pollRef = useRef(null);

  const loadPacks = useCallback(async () => {
    try {
      const r = await crmDataService.getPacks();
      if (r?.success) setPacks(r.packs || []);
    } catch { /* the history is not worth an error banner */ }
  }, []);

  useEffect(() => { loadPacks(); }, [loadPacks]);
  useEffect(() => () => clearInterval(pollRef.current), []);

  const watch = useCallback((id) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const s = await crmDataService.getPack(id);
        setPack(s);
        if (s.status === 'DONE' || s.status === 'FAILED') {
          clearInterval(pollRef.current);
          setBusy(false);
          loadPacks();
        }
      } catch { /* a dropped poll is not a failed build */ }
    }, 3000);
  }, [loadPacks]);

  const build = async () => {
    setBusy(true);
    setError('');
    setPack(null);
    try {
      const res = await crmDataService.buildPack({ products, filter: filters });
      if (!res?.success) throw new Error(res?.error || 'Could not start the build');
      setPack({ status: 'RUNNING', id: res.packId });
      watch(res.packId);
    } catch (e) {
      setError(e.message || String(e));
      setBusy(false);
    }
  };

  const download = async (id) => {
    try {
      await crmDataService.downloadPack(id, 'CRM_Distribution.zip');
    } catch (e) {
      notify?.('error', 'Download failed', e.message);
    }
  };

  const toggleProduct = (k) =>
    setProducts((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  // Sending acts on the pack on screen; if none was built this visit, the
  // most recent finished pack is the sensible target.
  const lastDone = packs.find((p) => p.status === 'DONE');
  const sendableId = (pack?.status === 'DONE' && pack.id) || lastDone?.id || '';
  const sendHint = sendableId
    ? 'Opens a preview first — nothing is emailed until you confirm'
    : 'Build the files first';

  const stats = pack?.stats?.products || [];

  return (
    <div className="crm-pack">
      <div className="dd-dist-head">
        <div>
          <h4 className="dd-h4">Branch, cluster and zone files</h4>
          <p className="dd-muted">
            Splits the distributed leads into one workbook per branch, per cluster and per
            zone — the same pack MAMBU DATA builds — using the filters above. Download the
            zip, or email the files to branches, cluster managers or zone managers, with
            their addresses taken from the Zone and Clusters roster.
          </p>
        </div>
      </div>

      <div className="dd-scope">
        <div className="dd-scope-modes">
          <span className="dd-muted dd-small">Products</span>
          {PRODUCTS.map((p) => (
            <button
              key={p.key}
              className={`dd-chip ${products.includes(p.key) ? 'is-on' : ''}`}
              onClick={() => toggleProduct(p.key)}
              disabled={busy}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="crm-pack-actions">
        <button
          className="dd-btn dd-btn--primary"
          onClick={build}
          disabled={busy || products.length === 0}
        >
          {busy ? 'Building…' : '🗂 Build files'}
        </button>
        <button
          className="dd-btn"
          onClick={() => download(sendableId)}
          disabled={!sendableId}
          title={sendableId ? 'The whole pack as one zip' : 'Build the files first'}
        >
          ⬇ Download zip
        </button>
        <span className="crm-pack-sep" />
        {/* These email real branch staff, so they stay disabled until there is
            a finished pack, and each opens a preview before anything leaves. */}
        <button className="dd-btn" onClick={() => setSendMode('branch')} disabled={!sendableId} title={sendHint}>
          ✉ Send to branches
        </button>
        <button className="dd-btn" onClick={() => setSendMode('cluster')} disabled={!sendableId} title={sendHint}>
          ✉ Send to clusters
        </button>
        <button className="dd-btn" onClick={() => setSendMode('zone')} disabled={!sendableId} title={sendHint}>
          ✉ Send to zones
        </button>
      </div>

      {!sendableId && !busy && (
        <p className="dd-muted dd-small">
          Build the files first — sending emails the workbooks the build produced.
        </p>
      )}

      {error && <div className="crm-pack-notice is-bad">{error}</div>}

      {pack && (
        <div className={`crm-pack-job ${pack.status === 'FAILED' ? 'is-failed' : ''}`}>
          {pack.status === 'RUNNING' && <>Building the workbooks on the server…</>}
          {pack.status === 'FAILED' && <>Build failed: {pack.error}</>}
          {pack.status === 'DONE' && (
            <>
              <div className="crm-pack-line">
                <strong>{fmtNum(pack.leadCount)}</strong> distributed lead{pack.leadCount === 1 ? '' : 's'} in the pack
                {pack.unrouted > 0 && <>, {fmtNum(pack.unrouted)} with no product (in CRM_UNROUTED.xlsx)</>}.
              </div>
              <table className="dd-table crm-pack-table">
                <thead>
                  <tr>
                    <th>Product</th><th>Leads</th><th>Branch files</th>
                    <th>Cluster files</th><th>Zone files</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.product}>
                      <td>{s.product}</td>
                      <td>{fmtNum(s.rows)}</td>
                      <td>{fmtNum(s.branchFiles)}</td>
                      <td>{fmtNum(s.clusterFiles)}</td>
                      <td>{fmtNum(s.zoneFiles)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="dd-btn" onClick={() => download(pack.id)}>
                ⬇ Download zip{pack.zipSize ? ` (${fmtBytes(pack.zipSize)})` : ''}
              </button>
            </>
          )}
        </div>
      )}

      {pack?.warnings?.length > 0 && (
        <div className="crm-pack-warnings">
          <div className="crm-pack-warnings-head">Worth knowing</div>
          <ul>{pack.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {sendMode && (
        <DistributeModal
          runId={sendableId}
          mode={sendMode}
          product=""
          label=""
          api={PACK_API}
          texts={MODE_TEXT}
          idKey="packId"
          onClose={() => setSendMode('')}
        />
      )}

      {packs.length > 0 && (
        <>
          <h4 className="dd-h4">Recent packs</h4>
          <div className="dd-table-wrap">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>Products</th><th>Status</th><th>Leads</th><th>When</th><th>By</th><th />
                </tr>
              </thead>
              <tbody>
                {packs.map((p) => (
                  <tr key={p.id}>
                    <td>{(p.products || []).join(', ')}</td>
                    <td>
                      <span className={`dd-pill dd-pill--${p.status === 'DONE' ? 'good' : p.status === 'FAILED' ? 'bad' : 'warn'}`}>
                        {String(p.status).toLowerCase()}
                      </span>
                    </td>
                    <td>{fmtNum(p.leadCount)}</td>
                    <td>{fmtWhen(p.startedAt)}</td>
                    <td>{p.builtBy || <span className="dd-muted">—</span>}</td>
                    <td>
                      {p.downloadUrl && (
                        <button className="dd-link" onClick={() => download(p.id)}>Download</button>
                      )}
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

export default CRMPack;
