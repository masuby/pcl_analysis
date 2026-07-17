import { useState, useEffect, useRef, useCallback } from 'react';
import './Automation.css';

// The automation orchestrator service (backend/Automation/automation_service).
// Prod: same-origin path proxied by nginx to the automation container.
// Dev:  the orchestrator running on localhost:8091.
const API = import.meta.env.VITE_AUTOMATION_API_URL
  || (import.meta.env.PROD ? '/automation-api' : 'http://localhost:8091');

const EMPTY = { date: '', send: 'no', db_update: true, deadline: '' };

const Automation = () => {
  const [pipelines, setPipelines] = useState([]);
  const [online, setOnline] = useState(false);
  const [active, setActive] = useState(null);          // pipeline id whose logs show
  const [state, setState] = useState({});              // per-pipeline job state
  const [logs, setLogs] = useState([]);                // active pipeline's log lines
  const [modal, setModal] = useState(null);            // { pid, step } wizard
  const cursorRef = useRef(0);
  const pollRef = useRef(null);
  const logEndRef = useRef(null);

  // ── load registry ──────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/pipelines`)
      .then((r) => r.json())
      .then((d) => { setPipelines(d.pipelines || []); setOnline(true); if (!active && d.pipelines?.[0]) setActive(d.pipelines[0].id); })
      .catch(() => setOnline(false));
  }, []); // eslint-disable-line

  // ── poll logs for the active pipeline ──────────────────────────────────
  const poll = useCallback((pid) => {
    fetch(`${API}/pipelines/${pid}/logs?after=${cursorRef.current}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.lines?.length) { setLogs((prev) => [...prev, ...d.lines]); cursorRef.current = d.cursor; }
        setState((s) => ({ ...s, [pid]: d.state }));
        // keep polling while running OR queued (waiting for the Windows worker)
        if (d.state !== 'running' && d.state !== 'queued' && pollRef.current) {
          clearInterval(pollRef.current); pollRef.current = null;
          if (d.state === 'done') maybeClear(pid);
        }
      })
      .catch(() => {});
  }, []);

  const watch = useCallback((pid) => {
    setActive(pid); setLogs([]); cursorRef.current = 0;
    if (pollRef.current) clearInterval(pollRef.current);
    poll(pid);
    pollRef.current = setInterval(() => poll(pid), 1000);
  }, [poll]);

  useEffect(() => () => pollRef.current && clearInterval(pollRef.current), []);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const maybeClear = (pid) => {
    // auto-clear this run's uploaded files once the pipeline finishes cleanly
    fetch(`${API}/pipelines/${pid}/clear`, { method: 'POST' }).catch(() => {});
  };

  // Manual clear: wipe the logger view AND drop this pipeline's staged uploads.
  const clearAll = (pid) => {
    setLogs([]); cursorRef.current = 0;
    if (pid) fetch(`${API}/pipelines/${pid}/clear`, { method: 'POST' }).catch(() => {});
  };

  // ── start / stop ────────────────────────────────────────────────────────
  const startPipeline = (pid, params) => {
    fetch(`${API}/pipelines/${pid}/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error === 'missing_files') { alert(`Missing files:\n• ${d.missing.join('\n• ')}`); return; }
        if (d.error) { alert(d.error); return; }
        // 'queued' = handed to the Windows worker on the PC
        setState((s) => ({ ...s, [pid]: d.state === 'queued' ? 'queued' : 'running' }));
        watch(pid);
      })
      .catch((e) => alert(`Could not start: ${e.message}`));
  };

  const stopPipeline = (pid) => {
    fetch(`${API}/pipelines/${pid}/stop`, { method: 'POST' }).catch(() => {});
  };

  // Post-run housekeeping: CRM updates masters; Call Center/Management clean row files.
  const updateFiles = (pid) => {
    fetch(`${API}/pipelines/${pid}/update-files`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { alert(d.error); return; }
        setState((s) => ({ ...s, [pid]: 'running' }));
        watch(pid);
      })
      .catch((e) => alert(`Could not update files: ${e.message}`));
  };

  // 'queued' = waiting for the Windows worker to pick it up — still "busy".
  const isRunning = (pid) => state[pid] === 'running' || state[pid] === 'queued';

  return (
    <div className="auto-page">
      <div className="auto-head">
        <h1 className="auto-title">⚙️ Automation Center</h1>
        <span className={`auto-status ${online ? 'on' : 'off'}`}>
          {online ? '● orchestrator online' : '● orchestrator offline'}
        </span>
      </div>
      {!online && (
        <div className="auto-offline">
          Start the orchestrator: <code>uvicorn app.main:app --port 8091</code> from
          <code>backend/Automation/automation_service</code>
        </div>
      )}

      <div className="auto-grid">
        {/* LEFT — logs panel */}
        <section className="auto-logs-panel">
          <div className="auto-logs-head">
            <span>📜 Logs {active ? `— ${pipelines.find((p) => p.id === active)?.label || ''}` : ''}</span>
            <div className="auto-logs-head-right">
              {active && <span className={`auto-badge auto-badge--${state[active] || 'idle'}`}>{state[active] || 'idle'}</span>}
              <button className="auto-clear-btn" onClick={() => clearAll(active)} disabled={isRunning(active)}>clear</button>
            </div>
          </div>
          <div className="auto-logs-body">
            {logs.length === 0
              ? <div className="auto-logs-empty">No output yet. Start a pipeline on the right.</div>
              : logs.map((l, i) => <div key={i} className={`auto-log-line ${lineClass(l)}`}>{l || ' '}</div>)}
            <div ref={logEndRef} />
          </div>
        </section>

        {/* RIGHT — button panel */}
        <section className="auto-btn-panel">
          {pipelines.map((p) => (
            <div className="auto-card" key={p.id} style={{ '--accent': p.color }}>
              <div className="auto-card-head">
                <span className="auto-card-icon">{p.icon}</span>
                <span className="auto-card-title">{p.label}</span>
                <span className="auto-card-head-right">
                  {isRunning(p.id) && <span className="auto-run-dot" />}
                  {p.update_files && (
                    <button className="auto-update-icon" disabled={isRunning(p.id) || !online}
                            title={`${p.update_files.label || 'Update files'} — ${p.update_files.desc || ''}`}
                            aria-label={p.update_files.label || 'Update files'}
                            onClick={() => updateFiles(p.id)}>
                      ↻
                    </button>
                  )}
                </span>
              </div>
              <div className="auto-card-actions">
                <button className="auto-start" disabled={isRunning(p.id) || !online}
                        onClick={() => setModal({ pid: p.id, spec: p, params: { ...EMPTY }, step: 'upload' })}>
                  ▶ Start
                </button>
                <button className="auto-stop" disabled={!isRunning(p.id)}
                        onClick={() => stopPipeline(p.id)}>
                  ■ Stop
                </button>
              </div>
              <button className="auto-viewlogs" onClick={() => watch(p.id)}>view logs →</button>
            </div>
          ))}
        </section>
      </div>

      {modal && (
        <Wizard
          modal={modal} setModal={setModal} api={API}
          onRun={(params) => { setModal(null); startPipeline(modal.pid, params); }}
        />
      )}
    </div>
  );
};

// ── coloured log lines ─────────────────────────────────────────────────────
const lineClass = (l) => {
  if (/✗|error|failed|traceback/i.test(l)) return 'err';
  if (/✅|✓|finished|done|uploaded|sent/i.test(l)) return 'ok';
  if (/^===|^\$|step \d/i.test(l)) return 'step';
  if (/■|stop/i.test(l)) return 'warn';
  return '';
};

// ── the Start wizard: upload → date → email/recipients → run ───────────────
const Wizard = ({ modal, setModal, api, onRun }) => {
  const { pid, spec } = modal;
  const [files, setFiles] = useState([]);
  const [valid, setValid] = useState(false);
  const [missing, setMissing] = useState([]);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState(modal.params);
  const [recips, setRecips] = useState(null);
  const [recipDept, setRecipDept] = useState((spec.recipients?.departments || ['CS'])[0]);
  const [showFiles, setShowFiles] = useState(false);

  const refresh = useCallback(() => {
    fetch(`${api}/pipelines/${pid}/files`).then((r) => r.json())
      .then((d) => { setFiles(d.files || []); setValid(d.valid); setMissing(d.missing || []); });
  }, [api, pid]);
  useEffect(() => { refresh(); }, [refresh]);
  // Pre-fill the editable message value (e.g. MTD deadline) with its default.
  useEffect(() => {
    if (spec.message && !params.deadline) setParams((p) => ({ ...p, deadline: spec.message.default }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = (fileList) => {
    if (!fileList.length) return;
    setBusy(true);
    const fd = new FormData();
    [...fileList].forEach((f) => fd.append('files', f));
    fetch(`${api}/pipelines/${pid}/upload`, { method: 'POST', body: fd })
      .then((r) => r.json())
      .then((d) => { setFiles(d.files || []); setValid(d.valid); setMissing(d.missing || []); })
      .finally(() => setBusy(false));
  };

  const removeFile = (name) => {
    fetch(`${api}/pipelines/${pid}/files/delete`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { alert(d.error); return; }
        setFiles(d.files || []); setValid(d.valid); setMissing(d.missing || []);
      })
      .catch((e) => alert(`Could not remove: ${e.message}`));
  };

  const loadRecipients = (mode) => {
    fetch(`${api}/pipelines/${pid}/recipients?mode=${mode}`).then((r) => r.json())
      .then((d) => setRecips(d.recipients || {}));
  };

  const saveRecipients = (mode, dept, emails) => {
    return fetch(`${api}/pipelines/${pid}/recipients`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, department: dept, emails }),
    }).then((r) => r.json()).then((d) => {
      if (d.recipients) setRecips(d.recipients);
      return d;   // { saved, recipients } or { error }
    });
  };

  const close = () => setModal(null);
  const dateInput = (spec.inputs || []).find((i) => i.type?.startsWith('date') || i.type === 'month');
  const needsDate = Boolean(dateInput);
  const datePlaceholder = dateInput?.type === 'month' ? 'mm/yyyy'
    : dateInput?.type === 'date_ddmm' ? 'dd/mm' : 'dd/mm/yyyy';

  return (
    <div className="auto-modal-backdrop" onClick={close}>
      <div className="auto-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auto-modal-head">
          <span>{spec.icon} {spec.label} — start</span>
          <button className="auto-x" onClick={close}>✕</button>
        </div>

        {/* Step 1: uploads */}
        <div className="auto-modal-section">
          <h4>1 · {spec.auto_source ? 'Source files' : 'Upload required files'}</h4>
          {spec.auto_source && <div className="auto-autosource">↻ {spec.auto_source}</div>}
          <label className="auto-drop">
            <input type="file" multiple onChange={(e) => upload(e.target.files)} disabled={busy} />
            <span>{busy ? 'Uploading…' : spec.auto_source ? 'Optional: choose files to override' : 'Click to choose files (multiple)'}</span>
          </label>
          <ul className="auto-filelist">
            {spec.uploads.map((u) => {
              const required = u.required !== false;
              const present = !missing.includes(u.label);
              const cls = !required ? 'opt' : present ? 'ok' : 'miss';
              const mark = !required ? '↻' : present ? '✓' : '○';
              return <li key={u.key} className={cls}>{mark} {u.label}{!required ? ' (auto)' : ''}</li>;
            })}
          </ul>
          <div className="auto-filerow">
            {files.length > 0 && (
              <button className="auto-files-note auto-files-toggle"
                      onClick={() => setShowFiles((s) => !s)}
                      title="Click to view / remove the files in the folder">
                {showFiles ? '▾' : '▸'} {files.length} file(s) in the folder
              </button>
            )}
            {spec.download_rows && (
              <a className="auto-download-rows" href={`${api}/pipelines/${pid}/download-rows`}
                 target="_blank" rel="noreferrer">⬇ Download row files (zip)</a>
            )}
          </div>
          {showFiles && files.length > 0 && (
            <ul className="auto-files-manage">
              {files.map((f) => (
                <li key={f}>
                  <span className="auto-file-name" title={f}>{f}</span>
                  <button className="auto-file-del" title={`Remove ${f}`}
                          onClick={() => removeFile(f)}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Step 2: date */}
        {needsDate && (
          <div className="auto-modal-section">
            <h4>2 · {dateInput?.label}</h4>
            <input className="auto-input" placeholder={datePlaceholder}
                   value={params.date} onChange={(e) => setParams({ ...params, date: e.target.value })} />
          </div>
        )}

        {/* Step 3: email choice + recipients */}
        <div className="auto-modal-section">
          <h4>{needsDate ? '3' : '2'} · Email</h4>
          <div className="auto-radios">
            {spec.email.modes.map((m) => (
              <label key={m.value} className={params.send === m.value ? 'sel' : ''}>
                <input type="radio" name="send" value={m.value}
                       checked={params.send === m.value}
                       onChange={() => setParams({ ...params, send: m.value })} />
                {m.label}
              </label>
            ))}
          </div>
          {spec.recipients?.editable && params.send !== 'no' && (
            <div className="auto-recips">
              <button className="auto-link" onClick={() => loadRecipients(params.send === 'specific' ? 'specific' : 'actual')}>
                {recips ? 'reload recipients' : 'view / edit recipients ▾'}
              </button>
              {recips && (
                <RecipientEditor recips={recips} dept={recipDept} setDept={setRecipDept}
                                 departments={spec.recipients.departments || Object.keys(recips)}
                                 onSave={(emails) => saveRecipients(params.send === 'specific' ? 'specific' : 'actual', recipDept, emails)} />
              )}
            </div>
          )}
        </div>

        {/* CRM: update processed files in the live server (DB) */}
        {spec.db_update_toggle && (
          <div className="auto-modal-section">
            <h4>{needsDate ? '4' : '3'} · Update files in server?</h4>
            <div className="auto-radios">
              <label className={params.db_update ? 'sel' : ''}>
                <input type="radio" name="dbupd" checked={params.db_update}
                       onChange={() => setParams({ ...params, db_update: true })} />
                Yes — upload processed reports to the live system (default)
              </label>
              <label className={!params.db_update ? 'sel' : ''}>
                <input type="radio" name="dbupd" checked={!params.db_update}
                       onChange={() => setParams({ ...params, db_update: false })} />
                No — build &amp; email only, never touch the server DB
              </label>
            </div>
          </div>
        )}

        {/* MTD: editable message time (deadline) */}
        {spec.message && params.send !== 'no' && (
          <div className="auto-modal-section">
            <h4>{needsDate ? '4' : '3'} · {spec.message.label}</h4>
            <input className="auto-input" value={params.deadline}
                   placeholder={spec.message.default}
                   onChange={(e) => setParams({ ...params, deadline: e.target.value })} />
            <div className="auto-msg-preview">
              {spec.message.before}
              <b>{(params.deadline || '').trim() || spec.message.default}</b>
              {spec.message.after}
            </div>
          </div>
        )}

        <div className="auto-modal-foot">
          {!valid && <span className="auto-warn">Missing: {missing.join(', ')}</span>}
          <button className="auto-run-btn" disabled={!valid || (needsDate && !params.date)}
                  onClick={() => onRun(params)}>
            ▶ Run pipeline
          </button>
        </div>
      </div>
    </div>
  );
};

// Extract valid email tokens from any blob — one-per-line, comma / semicolon /
// space separated, trailing commas, or a pasted mixture. Dedupes, order kept.
const parseEmails = (raw) => {
  const found = (raw || '').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [];
  return [...new Set(found.map((e) => e.trim()))];
};

const RecipientEditor = ({ recips, dept, setDept, departments, onSave }) => {
  const [text, setText] = useState((recips[dept] || []).join('\n'));
  const [msg, setMsg] = useState(null);   // { ok, text }
  const [saving, setSaving] = useState(false);
  useEffect(() => { setText((recips[dept] || []).join('\n')); setMsg(null); }, [dept, recips]);

  const save = () => {
    const emails = parseEmails(text);
    setSaving(true); setMsg(null);
    Promise.resolve(onSave(emails))
      .then((d) => {
        if (d && d.error) setMsg({ ok: false, text: `✕ ${d.error}` });
        else {
          const n = d && typeof d.saved === 'number' ? d.saved : emails.length;
          setMsg({ ok: true, text: `✓ Saved ${n} ${dept} recipient${n === 1 ? '' : 's'}` });
        }
      })
      .catch(() => setMsg({ ok: false, text: '✕ Save failed — is the service reachable?' }))
      .finally(() => { setSaving(false); setTimeout(() => setMsg(null), 3500); });
  };

  return (
    <div className="auto-recip-editor">
      <div className="auto-recip-tabs">
        {departments.map((d) => (
          <button key={d} className={d === dept ? 'sel' : ''} onClick={() => setDept(d)}>{d}</button>
        ))}
      </div>
      <textarea className="auto-recip-area" value={text} onChange={(e) => setText(e.target.value)}
                rows={6} placeholder="One per line, or comma / space separated — pasting a block is fine." />
      <div className="auto-recip-saverow">
        <button className="auto-recip-save" disabled={saving} onClick={save}>
          {saving ? 'saving…' : `save ${dept} recipients`}
        </button>
        {msg && <span className={msg.ok ? 'auto-recip-ok' : 'auto-recip-err'}>{msg.text}</span>}
      </div>
    </div>
  );
};

export default Automation;
