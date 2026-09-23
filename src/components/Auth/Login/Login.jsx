import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginUser, resetPassword } from '../../../services/auth';
import { useAuth } from '../../../contexts/AuthContext';
import Toast from '../../Common/Toast/Toast';
import './Login.css';

/* Inline SVG rather than an icon font or emoji: the sign-in page is the first
   thing anyone sees, and an emoji that renders differently on every machine is
   exactly what makes a product look unfinished. */
const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    <path d="m3 7 8.13 5.42a1.6 1.6 0 0 0 1.74 0L21 7" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
    <path d="M8 10.5V7.75a4 4 0 0 1 8 0v2.75" />
    <circle cx="12" cy="15.2" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3.2" />
  </svg>
);

const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M4 4.5 20 20.5" />
    <path d="M9.9 6A9.9 9.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 4" />
    <path d="M6.5 8.2A17.6 17.6 0 0 0 2.5 12S6 18.5 12 18.5a9.7 9.7 0 0 0 3.6-.68" />
    <path d="M9.9 10.1a3.2 3.2 0 0 0 4.3 4.5" />
  </svg>
);

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M12 2.8 20 6v6c0 4.6-3.3 7.9-8 9.2C7.3 19.9 4 16.6 4 12V6Z" />
    <path d="m8.8 12.2 2.2 2.2 4.2-4.6" />
  </svg>
);

const ChartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M4 19.5h16" />
    <rect x="5.5" y="11" width="3.2" height="6" rx="1" />
    <rect x="10.4" y="7" width="3.2" height="10" rx="1" />
    <rect x="15.3" y="13" width="3.2" height="4" rx="1" />
  </svg>
);

const LayersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="m12 3.2 8.2 4.3-8.2 4.3L3.8 7.5Z" />
    <path d="m4.2 12 7.8 4.1 7.8-4.1" />
    <path d="m4.2 16.3 7.8 4.1 7.8-4.1" />
  </svg>
);

const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.6v5.2" />
    <circle cx="12" cy="16.3" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="m8.2 12.3 2.6 2.6 5-5.4" />
  </svg>
);

/* Three words each. The panel is a door, not a brochure. */
const HIGHLIGHTS = [
  { icon: <ShieldIcon />, title: 'Controlled access' },
  { icon: <ChartIcon />, title: 'One set of figures' },
  { icon: <LayersIcon />, title: 'Every branch, one view' },
];

/* Typed in turn, then rubbed out and the next one typed. */
const TYPED_LINES = [
  'Sales reporting.',
  'Portfolio reporting.',
  'One place.',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* A fixed, deterministic particle field. Generated once rather than on an
   interval so the page does not keep appending nodes to the DOM for as long as
   it is open, and so nothing moves at all when the machine asks for reduced
   motion. */
const PARTICLES = Array.from({ length: 26 }, (_, i) => ({
  left: (i * 37.5) % 100,
  size: 2 + ((i * 7) % 5),
  delay: -((i * 1.9) % 22),
  duration: 16 + ((i * 3) % 14),
  drift: ((i % 5) - 2) * 26,
  opacity: 0.18 + ((i % 4) * 0.09),
}));

/* Types a line out a character at a time, holds it, rubs it out, moves on.
   One timeout at a time rather than an interval, so the speed can differ
   between typing and deleting and nothing is left running on unmount. If the
   machine asks for reduced motion the last line is simply shown, whole. */
const useTypewriter = (lines, { type = 70, erase = 34, hold = 1600 } = {}) => {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const [text, setText] = useState(reduced ? lines[lines.length - 1] : '');
  const state = useRef({ line: 0, chars: 0, erasing: false });

  useEffect(() => {
    if (reduced) return undefined;
    let timer;

    const step = () => {
      const s = state.current;
      const full = lines[s.line];

      if (!s.erasing) {
        s.chars += 1;
        setText(full.slice(0, s.chars));
        if (s.chars === full.length) {
          s.erasing = true;
          timer = setTimeout(step, hold);
          return;
        }
      } else {
        s.chars -= 1;
        setText(full.slice(0, s.chars));
        if (s.chars === 0) {
          s.erasing = false;
          s.line = (s.line + 1) % lines.length;
        }
      }
      timer = setTimeout(step, s.erasing ? erase : type);
    };

    timer = setTimeout(step, 400);
    return () => clearTimeout(timer);
  }, [lines, type, erase, hold, reduced]);

  return text;
};

const Login = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [toast, setToast] = useState(null);
  const [capsLock, setCapsLock] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const emailRef = useRef(null);
  const navigate = useNavigate();
  const typed = useTypewriter(TYPED_LINES);

  const emailLooksWrong = touched.email && email.length > 0 && !EMAIL_RE.test(email);
  const isFormValid = useMemo(
    () => EMAIL_RE.test(email) && password.length > 0,
    [email, password]
  );

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setTouched({ email: true, password: true });

    if (!email || !password) {
      setError('Enter your email address and password.');
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError('That does not look like a complete email address.');
      return;
    }

    setLoading(true);
    const result = await loginUser(email, password);

    if (result.success) {
      login(result.user);
      setToast({ type: 'success', message: 'Signed in. Taking you to your dashboard.' });
      setTimeout(() => navigate('/dashboard'), 1200);
    } else {
      setError(result.error);
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!EMAIL_RE.test(email)) {
      setTouched((t) => ({ ...t, email: true }));
      setError('Enter your email address first, then ask for a reset.');
      emailRef.current?.focus();
      return;
    }
    setResetting(true);
    const result = await resetPassword(email);
    setResetting(false);
    if (result.success) {
      setError('');
      setResetEmailSent(true);
      setTimeout(() => setResetEmailSent(false), 8000);
    } else {
      setError(result.error);
    }
  };

  const trackCaps = (e) => {
    if (typeof e.getModifierState === 'function') {
      setCapsLock(e.getModifierState('CapsLock'));
    }
  };

  const currentYear = new Date().getFullYear();

  return (
    <div className="login-page">
      {/* Ambient background: a slow aurora wash, a fine grid and a drifting
          particle field. All three are decorative and hidden from assistive
          technology. */}
      <div className="login-ambient" aria-hidden="true">
        <span className="aurora aurora-1" />
        <span className="aurora aurora-2" />
        <span className="aurora aurora-3" />
        <span className="login-grid" />
        <span className="login-vignette" />
        <div className="login-particles">
          {PARTICLES.map((p, i) => (
            <span
              key={i}
              className="particle"
              style={{
                left: p.left + '%',
                width: p.size + 'px',
                height: p.size + 'px',
                opacity: p.opacity,
                animationDelay: p.delay + 's',
                animationDuration: p.duration + 's',
                '--drift': p.drift + 'px',
              }}
            />
          ))}
        </div>
      </div>

      <main className="login-shell">
        {/* Brand panel - desktop only, so the form is never pushed off a phone. */}
        <section className="login-brand">
          <div className="brand-top">
            <img
              src="/Assets/pcl_logo2.png"
              alt="Platinum Credit Limited"
              className="brand-logo"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>

          <div className="brand-body">
            <p className="brand-eyebrow">Platinum Credit Limited</p>
            {/* aria-label carries the whole sentence: a screen reader must not
                be read a word that is halfway through being typed. */}
            <h2 className="brand-headline" aria-label="Sales and portfolio reporting, in one place.">
              <span aria-hidden="true">{typed}</span>
              <span className="type-caret" aria-hidden="true" />
            </h2>
            <ul className="brand-highlights">
              {HIGHLIGHTS.map((h, i) => (
                <li
                  key={h.title}
                  className="brand-highlight"
                  style={{ animationDelay: 0.5 + i * 0.18 + 's' }}
                >
                  <span className="highlight-icon">{h.icon}</span>
                  <strong>{h.title}</strong>
                </li>
              ))}
            </ul>
          </div>

          <p className="brand-foot">Access is logged.</p>
        </section>

        {/* Form panel */}
        <section className="login-panel">
          <div className="login-card">
            <img
              src="/Assets/pcl_logo2.png"
              alt="Platinum Credit Limited"
              className="card-logo"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />

            <header className="card-head">
              <h1 className="card-title">Welcome back</h1>
              <p className="card-sub">Sign in with your work email address.</p>
            </header>

            <form onSubmit={handleLogin} className="login-form" noValidate>
              <div className="form-messages" aria-live="polite">
                {error && (
                  <div className="form-note form-note--error" role="alert">
                    <span className="note-icon">
                      <AlertIcon />
                    </span>
                    <span>{error}</span>
                  </div>
                )}
                {resetEmailSent && (
                  <div className="form-note form-note--ok">
                    <span className="note-icon">
                      <CheckIcon />
                    </span>
                    <span>Reset email sent. Check your inbox, and your junk folder.</span>
                  </div>
                )}
              </div>

              <div className="field">
                <label htmlFor="email" className="field-label">
                  Email address
                </label>
                <div className={`field-control ${emailLooksWrong ? 'is-invalid' : ''}`}>
                  <span className="field-icon">
                    <MailIcon />
                  </span>
                  <input
                    ref={emailRef}
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                    placeholder="name@platinumcredit.co.tz"
                    className="field-input"
                    autoComplete="username"
                    spellCheck="false"
                    disabled={loading}
                    aria-invalid={emailLooksWrong || undefined}
                  />
                </div>
                {emailLooksWrong && (
                  <p className="field-hint field-hint--warn">
                    Include the full address, for example name@platinumcredit.co.tz
                  </p>
                )}
              </div>

              <div className="field">
                <label htmlFor="password" className="field-label">
                  Password
                </label>
                <div className="field-control">
                  <span className="field-icon">
                    <LockIcon />
                  </span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={trackCaps}
                    onKeyDown={trackCaps}
                    onBlur={() => {
                      setCapsLock(false);
                      setTouched((t) => ({ ...t, password: true }));
                    }}
                    placeholder="Enter your password"
                    className="field-input"
                    autoComplete="current-password"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    className="field-action"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                    disabled={loading}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                {/* The reset link sits after the password box rather than beside
                    the label, so Tab goes email -> password -> Sign in. */}
                <div className="field-foot">
                  <span className="field-hint field-hint--warn">
                    {capsLock ? 'Caps Lock is on.' : ''}
                  </span>
                  <button
                    type="button"
                    className="link-button"
                    onClick={handleResetPassword}
                    disabled={loading || resetting}
                  >
                    {resetting ? 'Sending…' : 'Forgot password?'}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="submit-button"
                disabled={loading || !isFormValid}
                aria-busy={loading}
              >
                {loading ? (
                  <>
                    <span className="button-spinner" />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </button>

              <p className="card-help">
                Trouble signing in?{' '}
                <a className="link-button" href="mailto:support@platinumcredit.co.tz">
                  Contact support
                </a>
              </p>
            </form>
          </div>

          <footer className="login-foot">
            © {currentYear} Platinum Credit Limited. All rights reserved.
          </footer>
        </section>
      </main>

      {toast && (
        <div className="login-toast">
          <Toast
            type={toast.type}
            message={toast.message}
            onClose={() => setToast(null)}
            duration={3000}
          />
        </div>
      )}
    </div>
  );
};

export default Login;
