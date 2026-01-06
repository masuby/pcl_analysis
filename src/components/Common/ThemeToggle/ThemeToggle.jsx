import React from 'react';
import { useTheme } from '../../../contexts/ThemeContext';
import './ThemeToggle.css';

const ThemeToggle = () => {
  const { theme, toggleTheme, isDark } = useTheme();

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleTheme();
  };

  return (
    <div className="theme-toggle-container">
      <div
        className={`theme-toggle-wrapper ${isDark ? 'dark' : 'light'}`}
        onClick={handleClick}
        role="switch"
        aria-checked={isDark}
        aria-label="Toggle dark mode"
      >
        <div className={`theme-icon-wrapper ${!isDark ? 'active' : ''}`}>
          <span className="theme-icon sun-icon">☀️</span>
        </div>
        <div className={`theme-icon-wrapper ${isDark ? 'active' : ''}`}>
          <span className="theme-icon moon-icon">🌙</span>
        </div>
      </div>
    </div>
  );
};

export default ThemeToggle;
