/**
 * <LoadingSpinner>
 *
 * Project-wide loading indicator. Same visual language as the
 * DepartmentalDashboard ReportShell — a dual-ring spinner (gradient stroke
 * with a pulsing centre dot) and an optional fading message.
 *
 * Modes
 *   inline   (default)  — centred in its parent.  Drop-in replacement for
 *                          the legacy battery-bars spinner. All existing
 *                          callers keep working with no code changes.
 *   fullScreen          — frosted "cloud" overlay covering the entire
 *                          viewport (PayPal-style).  Used by ReportShell
 *                          and any "the whole page is loading" scenario.
 *
 * Props
 *   size        'small' | 'medium' | 'large'   (default 'medium')
 *   message     string                          — single static message
 *   messages    string[]                        — cycles through them,
 *                                                  fading between each
 *   stageMs     number                          — cycle interval (default 420)
 *   fullScreen  boolean                         — wrap in cloud overlay
 *   overlay     alias for fullScreen
 */
import { useState, useEffect } from 'react';
import './LoadingSpinner.css';

const LoadingSpinner = ({
  size       = 'medium',
  message    = 'Loading…',
  messages,
  stageMs    = 420,
  fullScreen = false,
  overlay    = false,
}) => {
  const [msgIdx, setMsgIdx] = useState(0);
  const hasMessages = Array.isArray(messages) && messages.length > 0;
  const current = hasMessages ? messages[msgIdx] : message;
  const useOverlay = fullScreen || overlay;

  useEffect(() => {
    if (!hasMessages) return undefined;
    setMsgIdx(0);
    const id = setInterval(() => {
      setMsgIdx((i) => Math.min(i + 1, messages.length - 1));
    }, stageMs);
    return () => clearInterval(id);
  }, [hasMessages, messages, stageMs]);

  const inner = (
    <div className={`ls-content ls-content--${size}`}>
      <div className="ls-spinner-wrap">
        <div className="ls-spinner-ring" />
        <div className="ls-spinner-dot" />
      </div>
      {current && <p className="ls-message" key={msgIdx}>{current}</p>}
    </div>
  );

  if (useOverlay) {
    return (
      <div className="ls-overlay" role="status" aria-live="polite">
        {inner}
      </div>
    );
  }

  return (
    <div className="ls-inline" role="status" aria-live="polite">
      {inner}
    </div>
  );
};

export default LoadingSpinner;
