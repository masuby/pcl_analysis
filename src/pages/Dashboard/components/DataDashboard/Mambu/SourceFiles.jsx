import { useCallback, useEffect, useRef, useState } from 'react';
import { mambuAPI } from '../../../../../services/api';

/**
 * SOURCE FILES — the two exports every refinance / reactivation run reads.
 *
 * They are uploaded once and stay. A run never asks for a file, it uses
 * whatever is active here, which is why LBF, SME and Agrifinance are all
 * current the moment one of them is updated. Nothing replaces a file except
 * an explicit upload, so running a report can never quietly change the inputs.
 *
 * The Zone and Clusters roster is deliberately NOT here — it is read live from
 * the Google Sheet, so it cannot drift out of date against a stale local copy.
 */

const fmtBytes = (n) => {
  if (!n) return '—';
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
};

const fmtWhen = (iso) => {
  if (!iso || String(iso).startsWith('0001')) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB');
};

const fmtNum = (n) => Number(n || 0).toLocaleString();

const SourceFiles = ({ onChange }) => {
  const [kinds, setKinds] = useState([]);
  const [active, setActive] = useState({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [showCols, setShowCols] = useState('');
  const inputs = useRef({});

  const load = useCallback(async () => {
    try {
      const [k, s] = await Promise.all([mambuAPI.getSourceKinds(), mambuAPI.listSources()]);
      if (k?.success) setKinds(k.kinds || []);
      if (s?.success) {
        setActive(s.active || {});
        // The second argument says "I have actually checked" — without it the
        // run pane cannot tell "no file" from "not looked yet".
        onChange?.(s.active || {}, true);
      }
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message || String(e) });
    }
  }, [onChange]);

  useEffect(() => { load(); }, [load]);

  const upload = async (kind, file) => {
    if (!file) return;
    setBusy(kind);
    setNotice(null);
    try {
      const res = await mambuAPI.uploadSource(kind, file);
      setNotice({ kind: 'ok', text: res.message });
      await load();
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message || String(e) });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mambu-sources">
      <div className="mambu-sources-head">
        <div>
          <h3 className="mambu-sources-title">Source files</h3>
          <p className="mambu-sources-sub">
            These two exports feed LBF, SME and Agrifinance alike — upload once
            and every product uses them. A file stays in use until you replace
            it. The branch and team-leader roster is read live from the Zone and
            Clusters sheet, so there is nothing to upload for it.
          </p>
        </div>
      </div>

      {notice && (
        <div className={`mambu-notice ${notice.kind === 'bad' ? 'is-bad' : 'is-ok'}`}>
          {notice.text}
        </div>
      )}

      <div className="mambu-slots">
        {kinds.map((k) => {
          const cur = active[k.kind];
          return (
            <div key={k.kind} className="mambu-slot">
              <div className="mambu-slot-top">
                <div>
                  <div className="mambu-slot-name">{k.label}</div>
                  <div className="mambu-slot-purpose">{k.purpose}</div>
                </div>
                <span className={`mambu-pill ${cur ? 'mambu-pill--done' : 'mambu-pill--running'}`}>
                  {cur ? 'In use' : 'Not uploaded'}
                </span>
              </div>

              {cur ? (
                <div className="mambu-slot-file">
                  <div className="mambu-slot-fname" title={cur.fileName}>{cur.fileName}</div>
                  <div className="mambu-slot-meta">
                    {fmtNum(cur.rows)} rows · {cur.columns} columns · {fmtBytes(cur.fileSize)}
                    {fmtWhen(cur.uploadedAt) ? ` · uploaded ${fmtWhen(cur.uploadedAt)}` : ''}
                  </div>
                </div>
              ) : (
                <div className="mambu-slot-empty">
                  Nothing uploaded yet — the reports that need this file cannot run.
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
                  {busy === k.kind ? 'Checking…' : cur ? 'Replace file' : 'Upload file'}
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
                    The file is checked on upload and rejected if any of these are
                    missing, so a wrong export is caught here rather than part-way
                    through a run. Extra columns are fine.
                  </p>
                  <div className="mambu-slot-collist">
                    {k.requiredColumns.map((c) => <code key={c}>{c}</code>)}
                  </div>
                  <p className="mambu-slot-hint">
                    Exported from Mambu as <code>{k.filePrefix}…xlsx</code>.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SourceFiles;
