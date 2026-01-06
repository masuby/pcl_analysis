import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginUser, resetPassword } from '../../../services/auth';
import Toast from '../../Common/Toast/Toast';
import './Login.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [toast, setToast] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [buttonPosition, setButtonPosition] = useState({ x: 0, y: 0 });
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const buttonRef = useRef(null);
  const navigate = useNavigate();

  // Form validation
  const isFormValid = email && password;

  // Check screen size for responsive adjustments
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Create snowfall effect
  useEffect(() => {
    const snowflakes = ['❄', '❅', '❆', '✻', '✼', '✽', '✾', '✿'];
    
    const createSnowflake = () => {
      const snowflake = document.createElement('div');
      snowflake.className = 'snowflake';
      snowflake.textContent = snowflakes[Math.floor(Math.random() * snowflakes.length)];
      snowflake.style.left = Math.random() * 100 + '%';
      snowflake.style.animationDuration = (Math.random() * 3 + 2) + 's';
      snowflake.style.opacity = Math.random() * 0.4 + 0.6;
      snowflake.style.fontSize = (Math.random() * 10 + 10) + 'px';
      document.querySelector('.login-background')?.appendChild(snowflake);

      setTimeout(() => {
        snowflake.remove();
      }, 5000);
    };

    const snowInterval = setInterval(createSnowflake, 250);
    
    return () => clearInterval(snowInterval);
  }, []);

  // Move button when form is invalid and user tries to submit
  useEffect(() => {
    if (attemptedSubmit && !isFormValid && buttonRef.current) {
      const moveButton = () => {
        if (buttonRef.current) {
          const wrapper = buttonRef.current.parentElement;
          if (wrapper) {
            const buttonWidth = buttonRef.current.offsetWidth;
            const buttonHeight = buttonRef.current.offsetHeight;
            const wrapperWidth = wrapper.offsetWidth;
            const maxX = Math.max(0, wrapperWidth - buttonWidth - 10);
            const maxY = 50; // Limit vertical movement
            const newX = Math.random() * maxX;
            const newY = (Math.random() - 0.5) * maxY;
            setButtonPosition({ x: newX, y: newY });
          }
        }
      };

      moveButton();
      const moveInterval = setInterval(moveButton, 600);
      
      return () => clearInterval(moveInterval);
    } else {
      setButtonPosition({ x: 0, y: 0 });
    }
  }, [attemptedSubmit, isFormValid]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setAttemptedSubmit(true);

    if (!email || !password) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }

    setAttemptedSubmit(false);
    const result = await loginUser(email, password);
    
    if (result.success) {
      setToast({ type: 'success', message: 'Login successful! Welcome back.' });
      // Keep loading true to show "Authenticating..." until navigation
      setTimeout(() => {
        navigate('/dashboard');
      }, 2000);
    } else {
      setError(result.error);
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email) {
      setError('Please enter your email address first');
      return;
    }

    const result = await resetPassword(email);
    if (result.success) {
      setResetEmailSent(true);
      setTimeout(() => setResetEmailSent(false), 5000);
      setError('');
    } else {
      setError(result.error);
    }
  };

  // Reset attempted submit when form becomes valid
  useEffect(() => {
    if (isFormValid && attemptedSubmit) {
      setAttemptedSubmit(false);
    }
  }, [isFormValid, attemptedSubmit]);

  // Get current year for footer
  const currentYear = new Date().getFullYear();

  return (
    <div className="login-container">
      {/* Background Elements */}
      <div className="login-background">
        <div className="bg-shape bg-shape-1"></div>
        <div className="bg-shape bg-shape-2"></div>
        <div className="bg-shape bg-shape-3"></div>
        <div className="bg-shape bg-shape-4"></div>
        {/* Snowfall will be added here via JavaScript */}
      </div>

      {/* Main Login Card */}
      <div className="login-wrapper">
        <div className="login-card">
          {/* Logo Section */}
          <div className="login-header">
            <div className="logo-container">
              <img 
                src="/Assets/pcl_logo2.png" 
                alt="PCL Logo" 
                className="login-logo"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.parentElement.innerHTML = '<div class="logo-fallback">PCL</div>';
                }}
              />
            </div>
            <div className="login-title-section">
              <h1 className="login-title">Welcome Back</h1>
            </div>
          </div>

          {/* Login Form */}
          <form onSubmit={handleLogin} className="login-form" noValidate>
            {/* Error Messages */}
            {error && (
              <div className="error-message" role="alert">
                <span className="error-icon">⚠️</span>
                {error}
              </div>
            )}

            {resetEmailSent && (
              <div className="success-message" role="alert">
                <span className="success-icon">✅</span>
                Password reset email sent! Check your inbox.
              </div>
            )}

            {/* Email Field */}
            <div className="form-group">
              <label htmlFor="email" className="form-label">
                <span className="label-text">Email Address</span>
                <span className="required-asterisk">*</span>
              </label>
              <div className="input-wrapper">
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your work email"
                  className="form-input"
                  required
                  autoComplete="email"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="form-group">
              <label htmlFor="password" className="form-label">
                <span className="label-text">Password</span>
                <span className="required-asterisk">*</span>
              </label>
              <div className="input-wrapper">
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="form-input"
                  required
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  disabled={loading}
                >
                  {showPassword ? (
                    <span className="toggle-icon" role="img" aria-label="Hide">🙈</span>
                  ) : (
                    <span className="toggle-icon" role="img" aria-label="Show">👁️</span>
                  )}
                </button>
              </div>
            </div>

            {/* Login Button */}
            <div className="login-button-wrapper">
              <button
                ref={buttonRef}
                type="submit"
                className={`login-button ${!isFormValid || loading ? 'disabled' : ''} ${attemptedSubmit && !isFormValid ? 'moving' : ''}`}
                disabled={loading}
                aria-busy={loading}
                onMouseEnter={(e) => {
                  if (attemptedSubmit && !isFormValid) {
                    const wrapper = e.target.parentElement;
                    if (wrapper) {
                      const buttonWidth = e.target.offsetWidth;
                      const wrapperWidth = wrapper.offsetWidth;
                      const maxX = Math.max(0, wrapperWidth - buttonWidth - 10);
                      const maxY = 50;
                      const newX = Math.random() * maxX;
                      const newY = (Math.random() - 0.5) * maxY;
                      setButtonPosition({ x: newX, y: newY });
                    }
                  }
                }}
                style={
                  attemptedSubmit && !isFormValid
                    ? {
                        transform: `translate(${buttonPosition.x}px, ${buttonPosition.y}px)`,
                        transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                      }
                    : {
                        transform: 'translate(0, 0)',
                        transition: 'transform 0.3s ease-out'
                      }
                }
              >
                {loading ? (
                  <>
                    <span className="button-spinner"></span>
                    Authenticating...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </div>

            {/* Forgot Password and Login Links */}
            <div className="form-footer">
              <button
                type="button"
                className="forgot-password"
                onClick={handleResetPassword}
                disabled={loading || !email}
              >
                Forgot Password?
              </button>
              <div className="divider">•</div>
              <button
                type="button"
                className="help-link"
                onClick={() => window.open('mailto:support@platinumcredit.co.tz', '_blank')}
              >
                Need Help?
              </button>
            </div>

          </form>
        </div>

        {/* Footer */}
        <footer className="login-footer">
          <div className="footer-content">
            <p className="copyright">
              © {currentYear} Platinum Credit Limited. All rights reserved.
            </p>
          </div>
        </footer>
      </div>

      {/* Toast Notification */}
      {toast && (
        <div style={{ position: 'fixed', bottom: '1rem', right: '1rem', zIndex: 10000 }}>
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