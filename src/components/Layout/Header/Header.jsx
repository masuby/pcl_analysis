import React from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import './Header.css';

const Header = ({ onMenuToggle, isMobile, isMobileMenuOpen }) => {
  const { userData } = useAuth();

  const handleToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (onMenuToggle) {
      onMenuToggle();
    }
  };

  return (
    <header className="layout-header">
      <div className="layout-header-left">
        <button 
          className={`layout-header-menu-toggle ${isMobileMenuOpen ? 'sidebar-open' : ''}`}
          onClick={handleToggle}
          onTouchStart={handleToggle}
          aria-label="Toggle menu"
          type="button"
        >
          <span className="layout-toggle-icon">
            {isMobile ? '☰' : '≡'}
          </span>
        </button>
      </div>
      
      <div className="layout-header-right">
        <div className="layout-header-date">
          <span className="layout-current-date">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </span>
        </div>
      </div>
    </header>
  );
};

export default Header;