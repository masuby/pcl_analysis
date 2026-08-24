import { useCallback, useEffect, useState } from 'react';
import { mambuAPI } from '../../../../../services/api';
import './DoNotContactModal.css';

/**
 * DO NOT CONTACT — numbers that must never appear in a distributed lead file.
 *
 * Whoever takes the complaint types the number the way they have it written
 * down, so anything goes in: 0712317849, +255 712 317 849, 255-712-317-849.
 * The server reduces it to one canonical form (255XXXXXXXXX) before storing,
 * which is what makes the list work — a number added as 07… still has to be
 * caught when a loan export writes it as 255…. The normalised form is shown
 * back after saving so it is obvious which number was actually recorded.
 *
 * Removing somebody means they can be called again, so a delete asks first.
 */

const fmtWhen = (iso) => {
  if (!iso || String(iso).startsWith('0001')) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB');
};

// Display only — 255712317849 reads as 0712 317 849 to a Tanzanian eye.
const pretty = (p) => {
  const m = /^255(\d{3})(\d{3})(\d{3})$/.exec(p || '');
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : p;
};

const DoNotContactModal = ({ onClose }) => {
  const [numbers, setNumbers] = useState([]);
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState(null);   // { kind: 'ok'|'bad', text }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await mambuAPI.listDoNotContact();
      if (res?.success) setNumbers(res.numbers || []);
    } catch (e) {
      setNotice({ kind: 'bad', text: e.message || String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Esc closes, so the list does not trap somebody mid-task.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const add = async (e) => {
    e.preventDefault();
    if (!phone.trim() || saving) return;
    setSaving(true); setNotice(null);
    try {
      const res = await mambuAPI.addDoNotContact(phone.trim(), reason.trim());
      setNotice({
        kind: 'ok',
        text: res.existed
          ? `${pretty(res.phone)} was already on the list — saved as ${res.phone}.`
          : `${pretty(res.phone)} added — saved as ${res.phone}.`,
      });
      setPhone(''); setReason('');
      await load();
    } catch (err) {
      setNotice({ kind: 'bad', text: err.message || String(err) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p) => {
    setConfirming(null); setNotice(null);
    try {
      await mambuAPI.removeDoNotContact(p);
      setNotice({ kind: 'ok', text: `${pretty(p)} removed — they can be contacted again.` });
      await load();
    } catch (err) {
      setNotice({ kind: 'bad', text: err.message || String(err) });
    }
  };

  const q = filter.replace(/\D/g, '');
  const shown = q
    ? numbers.filter((n) => n.phone.includes(q) || (n.rawInput || '').replace(/\D/g, '').includes(q))
    : numbers;

  return (
    <div className="dnc-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dnc-modal" role="dialog" aria-modal="true" aria-label="Do not contact list">
        <div className="dnc-head">
          <div>
            <h3 className="dnc-title">Do not contact</h3>
            <p className="dnc-sub">
              These numbers are stripped from every lead file before it is
              distributed. Type the number however you have it — it is stored in
              one standard form so it is matched wherever it appears.
            </p>
          </div>
          <button className="dnc-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form className="dnc-form" onSubmit={add}>
          <div className="dnc-field">
            <label htmlFor="dnc-phone">Phone number</label>
            <input
              id="dnc-phone"
              className="dnc-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0712317849 · +255 712 317 849 · 255712317849"
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="dnc-field">
            <label htmlFor="dnc-reason">Reason (optional)</label>
            <input
              id="dnc-reason"
              className="dnc-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. asked not to be called"
              autoComplete="off"
            />
          </div>
          <button className="dnc-btn" type="submit" disabled={!phone.trim() || saving}>
            {saving ? 'Saving…' : 'Add to list'}
          </button>
        </form>

        {notice && (
          <div className={`dnc-notice ${notice.kind === 'bad' ? 'is-bad' : 'is-ok'}`}>
            {notice.text}
          </div>
        )}

        <div className="dnc-listhead">
          <span>
            {loading ? 'Loading…' : `${numbers.length} number${numbers.length === 1 ? '' : 's'} on the list`}
          </span>
          {numbers.length > 8 && (
            <input
              className="dnc-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search a number"
            />
          )}
        </div>

        <div className="dnc-scroll">
          {!loading && shown.length === 0 && (
            <div className="dnc-empty">
              {numbers.length ? 'No number matches that search.' : 'Nothing on the list yet.'}
            </div>
          )}
          {shown.length > 0 && (
            <table className="dnc-table">
              <thead>
                <tr>
                  <th>Number</th><th>Stored as</th><th>Reason</th><th>Added</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((n) => (
                  <tr key={n.phone}>
                    <td className="dnc-num">{pretty(n.phone)}</td>
                    <td><code>{n.phone}</code></td>
                    <td>{n.reason || '—'}</td>
                    <td>{fmtWhen(n.createdAt) || '—'}</td>
                    <td className="dnc-rowact">
                      {confirming === n.phone ? (
                        <>
                          <button className="dnc-link is-danger" onClick={() => remove(n.phone)}>
                            Confirm
                          </button>
                          <button className="dnc-link" onClick={() => setConfirming(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button className="dnc-link" onClick={() => setConfirming(n.phone)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default DoNotContactModal;
