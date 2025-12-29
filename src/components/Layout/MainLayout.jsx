import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar/Sidebar';
import Header from './Header/Header';
import './MainLayout.css';

const MainLayout = () => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile screen
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (!mobile) {
        setIsMobileMenuOpen(false);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const toggleSidebar = (collapsed) => {
    if (typeof collapsed === 'boolean') {
      setIsSidebarCollapsed(collapsed);
    } else {
      setIsSidebarCollapsed(!isSidebarCollapsed);
    }
  };

  const toggleMobileMenu = (open) => {
    if (typeof open === 'boolean') {
      setIsMobileMenuOpen(open);
    } else {
      setIsMobileMenuOpen(!isMobileMenuOpen);
    }
  };

  return (
    <div className="main-layout">
      {/* Sidebar */}
      <Sidebar 
        isCollapsed={isSidebarCollapsed}
        onToggle={toggleSidebar}
        isMobileMenuOpen={isMobileMenuOpen}
        onMobileMenuToggle={toggleMobileMenu}
      />

      {/* Main Content */}
      <div className={`main-content ${isSidebarCollapsed && !isMobile ? 'expanded' : ''}`}>
        {/* Header with Desktop Toggle Button */}
        <Header 
          onMenuToggle={isMobile ? () => toggleMobileMenu() : () => toggleSidebar()}
          isMobile={isMobile}
          isMobileMenuOpen={isMobileMenuOpen}
        />
        
        {/* Main Content Area */}
        <main className="content-area">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="main-footer">
          <div className="footer-content">
            <p className="copyright">
              © {new Date().getFullYear()} Platinum Credit Limited. All rights reserved.
            </p>
            <div className="footer-links">
              <span className="version">v1.0.0</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default MainLayout;