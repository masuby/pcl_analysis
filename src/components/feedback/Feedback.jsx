/**
 * Shared feedback primitives:
 *   • <Toast/>        — top-right slide-in success/error/info/warning banner with auto-dismiss
 *   • <ConfirmDialog/> — centred modal that replaces window.confirm with a styled prompt
 *
 * Both are render-when-open components: pass `open` as a boolean.
 */

import { useEffect } from 'react';
import './Feedback.css';

const TOAST_ICONS = {
  success: '✓',
  error:   '✗',
  info:    'ℹ',
  warning: '⚠',
};

export function Toast({
  open,
  type = 'success',
  title,
  message,
  duration = 3500,
  onClose,
}) {
  useEffect(() => {
    if (!open || !duration) return undefined;
    const t = setTimeout(() => onClose?.(), duration);
    return () => clearTimeout(t);
  }, [open, duration, onClose]);

  if (!open) return null;
  return (
    <div className={`fb-toast fb-toast--${type}`} role="status" aria-live="polite">
      <span className="fb-toast-icon">{TOAST_ICONS[type] ?? 'ℹ'}</span>
      <div className="fb-toast-body">
        {title   && <div className="fb-toast-title">{title}</div>}
        {message && <div className="fb-toast-msg">{message}</div>}
      </div>
      <button className="fb-toast-close" onClick={onClose} aria-label="Close">×</button>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel  = 'Cancel',
  danger       = false,
  onConfirm,
  onCancel,
}) {
  // ESC to cancel
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fb-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}>
      <div className="fb-modal" role="dialog" aria-modal="true" aria-labelledby="fb-modal-title">
        <div className={`fb-modal-icon fb-modal-icon--${danger ? 'danger' : 'info'}`}>
          {danger ? '⚠' : '?'}
        </div>
        <div className="fb-modal-title" id="fb-modal-title">{title}</div>
        {message && <div className="fb-modal-msg">{message}</div>}
        <div className="fb-modal-actions">
          <button className="fb-btn fb-btn--cancel" onClick={onCancel} autoFocus>
            {cancelLabel}
          </button>
          <button
            className={`fb-btn ${danger ? 'fb-btn--danger' : 'fb-btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
