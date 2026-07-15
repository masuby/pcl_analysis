import { useState, useEffect, useRef, useCallback } from 'react';
import './Automation.css';

// The automation orchestrator service (backend/Automation/automation_service).
const API = import.meta.env.VITE_AUTOMATION_API_URL || 'http://localhost:8091';

const EMPTY = { date: '', send: 'no', db_update: true };

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
        if (d.state !== 'running' && pollRef.current) {
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
        setState((s) => ({ ...s, [pid]: 'running' }));
        watch(pid);
      })
      .catch((e) => alert(`Could not start: ${e.message}`));
  };

  const stopPipeline = (pid) => {
    fetch(`${API}/pipelines/${pid}/stop`, { method: 'POST' }).catch(() => {});
  };

  const isRunning = (pid) => state[pid] === 'running';

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
                {isRunning(p.id) && <span className="auto-run-dot" />}
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

  const refresh = useCallback(() => {
    fetch(`${api}/pipelines/${pid}/files`).then((r) => r.json())
      .then((d) => { setFiles(d.files || []); setValid(d.valid); setMissing(d.missing || []); });
  }, [api, pid]);
  useEffect(() => { refresh(); }, [refresh]);

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

  const loadRecipients = (mode) => {
    fetch(`${api}/pipelines/${pid}/recipients?mode=${mode}`).then((r) => r.json())
      .then((d) => setRecips(d.recipients || {}));
  };

  const saveRecipients = (mode, dept, emails) => {
    fetch(`${api}/pipelines/${pid}/recipients`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, department: dept, emails }),
    }).then((r) => r.json()).then((d) => setRecips(d.recipients || {}));
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
          <h4>1 · Upload required files</h4>
          <label className="auto-drop">
            <input type="file" multiple onChange={(e) => upload(e.target.files)} disabled={busy} />
            <span>{busy ? 'Uploading…' : 'Click to choose files (multiple)'}</span>
          </label>
          <ul className="auto-filelist">
            {spec.uploads.map((u) => {
              const present = !missing.includes(u.label);
              return <li key={u.key} className={present ? 'ok' : 'miss'}>{present ? '✓' : '○'} {u.label}</li>;
            })}
          </ul>
          {files.length > 0 && <div className="auto-files-note">{files.length} file(s) in the folder</div>}
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

const RecipientEditor = ({ recips, dept, setDept, departments, onSave }) => {
  const [text, setText] = useState((recips[dept] || []).join('\n'));
  useEffect(() => { setText((recips[dept] || []).join('\n')); }, [dept, recips]);
  return (
    <div className="auto-recip-editor">
      <div className="auto-recip-tabs">
        {departments.map((d) => (
          <button key={d} className={d === dept ? 'sel' : ''} onClick={() => setDept(d)}>{d}</button>
        ))}
      </div>
      <textarea className="auto-recip-area" value={text} onChange={(e) => setText(e.target.value)}
                rows={6} placeholder="one email per line" />
      <button className="auto-recip-save"
              onClick={() => onSave(text.split('\n').map((s) => s.trim()).filter((s) => s.includes('@')))}>
        save {dept} recipients
      </button>
    </div>
  );
};

export default Automation;
