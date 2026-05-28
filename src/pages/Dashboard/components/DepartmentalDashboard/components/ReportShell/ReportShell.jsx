/**
 * <ReportShell>
 *
 * Three-stage gate for heavy report sections:
 *
 *   1. idle    — show landing card with a single "Generate Report" button.
 *                The expensive child component is NOT mounted, so no useEffects
 *                fire and no API calls happen on tab visit.
 *
 *   2. loading — show a PayPal-style cloud overlay (centred card, animated
 *                spinner, fading sub-messages). The child IS mounted behind
 *                the overlay so its data fetching kicks off immediately
 *                while the user sees the loader.
 *
 *   3. ready   — overlay fades out, the populated report comes into view.
 *
 * Tab switches unmount the shell, so the next visit always starts at idle.
 */
import { useState, useEffect } from 'react';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';
import './ReportShell.css';

const LOADING_STAGES = [
  'Connecting to data sources…',
  'Fetching latest records…',
  'Building the report…',
  'Almost ready…',
];
const MIN_OVERLAY_MS = 1600;
const STAGE_INTERVAL_MS = 420;

export default function ReportShell({
  title,
  icon         = '📊',
  description  = 'Click below to generate this report.',
  cta          = '⚙ Generate Report',
  children,
}) {
  const [stage, setStage] = useState('idle');  // 'idle' | 'loading' | 'ready'

  // While loading: time the minimum reveal. Message cycling is handled by
  // <LoadingSpinner> via its `messages` prop.
  useEffect(() => {
    if (stage !== 'loading') return undefined;
    const timer = setTimeout(() => setStage('ready'), MIN_OVERLAY_MS);
    return () => clearTimeout(timer);
  }, [stage]);

  // ── Stage 1: idle landing card ──────────────────────────────────────────
  if (stage === 'idle') {
    return (
      <div className="rs-landing">
        <div className="rs-landing-card">
          <div className="rs-landing-icon">{icon}</div>
          <h2 className="rs-landing-title">{title}</h2>
          <p className="rs-landing-desc">{description}</p>
          <button
            type="button"
            className="pen-btn rs-cta"
            onClick={() => setStage('loading')}
          >
            <span>⚙</span>
            {cta.replace(/^[⚙⚡📊🎯📈]\s*/, '')}
          </button>
        </div>
      </div>
    );
  }

  // ── Stages 2 + 3: child mounted; overlay during stage 2 only ───────────
  // The overlay is a full-viewport <div> with position:fixed so it covers the
  // whole screen (not just the section). Only a minimal centred loader
  // floats in the middle — no card frame, no extra chrome.
  return (
    <>
      <div className={stage === 'loading' ? 'rs-child-hidden' : 'rs-child-visible'}>
        {children}
      </div>

      {stage === 'loading' && (
        <LoadingSpinner
          fullScreen
          size="large"
          messages={LOADING_STAGES}
          stageMs={STAGE_INTERVAL_MS}
        />
      )}
    </>
  );
}
