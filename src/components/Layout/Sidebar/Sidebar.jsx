import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { logoutUser } from '../../../services/auth';
import Toast from '../../Common/Toast/Toast';
import './Sidebar.css';

const Sidebar = ({ isCollapsed, onToggle, isMobileMenuOpen, onMobileMenuToggle }) => {
  const { user, userData, refreshUserData } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [toast, setToast] = useState(null);

  // Define all menu items with access permissions
  const allMenuItems = [
    { 
      path: '/dashboard', 
      label: 'DASHBOARD', 
      icon: '📊', 
      roles: ['admin', 'CS', 'LBF', 'SME', 'ALL'],
      description: 'System Overview'
    },
    { 
      path: '/cs-reports', 
      label: 'CS REPORTS', 
      icon: '🏛️', 
      roles: ['admin', 'CS', 'ALL'],
      description: 'Civil Servant Reports'
    },
    { 
      path: '/lbf-reports', 
      label: 'LBF REPORTS', 
      icon: '📚', 
      roles: ['admin', 'LBF', 'ALL'],
      description: 'Log Book Finance Reports'
    },
    { 
      path: '/sme-reports', 
      label: 'SME REPORTS', 
      icon: '🏢', 
      roles: ['admin', 'SME', 'ALL'],
      description: 'Small & Medium Enterprise Reports'
    },
    { 
      path: '/administration', 
      label: 'ADMINISTRATION', 
      icon: '⚙️', 
      roles: ['admin'],
      description: 'System Administration'
    },
    { 
      path: '/profile', 
      label: 'PROFILE', 
      icon: '👤', 
      roles: ['admin', 'CS', 'LBF', 'SME', 'ALL'],
      description: 'User Profile & Settings'
    },
  ];

  // Handle screen resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024 && !isCollapsed) {
        onToggle(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isCollapsed, onToggle]);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMobileMenuOpen && !event.target.closest('.sidebar') && !event.target.closest('.mobile-menu-toggle')) {
        onMobileMenuToggle(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isMobileMenuOpen, onMobileMenuToggle]);

  const handleLogout = async () => {
    await logoutUser();
    navigate('/login');
  };

  const handleLogoutConfirm = () => {
    setShowLogoutConfirm(true);
  };

  const handleLogoutCancel = () => {
    setShowLogoutConfirm(false);
  };

  const handleRefreshData = async () => {
    setIsRefreshing(true);
    try {
      await refreshUserData();
      setToast({ type: 'success', message: 'Data refreshed successfully.' });
      setTimeout(() => setToast(null), 3000);
    } catch (error) {
      setToast({ type: 'error', message: 'Failed to refresh data.' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Get user's accessible menu items - FIXED VERSION
  const getAccessibleMenuItems = () => {
    if (!userData || !userData.role) return [];
    
    const userRole = userData.role.toLowerCase(); // Convert to lowercase for consistency
    
    // Admin gets all menu items
    if (userRole === 'admin') {
      return allMenuItems;
    }
    
    // Filter based on user role - check if user role is in the item's roles array
    const filteredItems = allMenuItems.filter(item => {
      // Convert all roles in the array to lowercase for comparison
      const itemRoles = item.roles.map(role => role.toLowerCase());
      const hasAccess = itemRoles.includes(userRole);
      
      return hasAccess;
    });
    
    return filteredItems;
  };

  const accessibleMenuItems = getAccessibleMenuItems();

  // Get user's display name or first letter of email
  const getUserDisplay = () => {
    if (!userData) return '...';
    
    if (isCollapsed) {
      // Show first letter of display name or email
      if (userData.displayName && userData.displayName.trim()) {
        return userData.displayName.charAt(0).toUpperCase();
      } else if (userData.email) {
        return userData.email.charAt(0).toUpperCase();
      }
      return 'U';
    }
    
    // Show full display name or email
    if (userData.displayName && userData.displayName.trim()) {
      return userData.displayName;
    }
    return userData.email;
  };

  // Get user's full name for tooltip
  const getUserTooltip = () => {
    if (!userData) return '';
    
    if (userData.displayName && userData.displayName.trim()) {
      return userData.displayName;
    }
    return userData.email;
  };

  // Show loading state
  if (!userData) {
    return (
      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <img 
            src="/Assets/platnum_logo.png" 
            alt="PCL Logo" 
            className="sidebar-logo"
          />
          <div className="user-info">
            <span className="user-role">LOADING...</span>
          </div>
        </div>
        <div className="sidebar-menu">
          <div className="loading-menu">
            <p>Loading user permissions...</p>
            <button 
              onClick={handleRefreshData}
              className="refresh-button"
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <>
      {/* Refresh Blur Overlay */}
      {isRefreshing && (
        <div className="refresh-blur-overlay">
          <div className="refresh-loading">
            <div className="refresh-spinner"></div>
            <p>Refreshing...</p>
            <small>Please wait while we update your data</small>
          </div>
        </div>
      )}

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="mobile-sidebar-overlay" 
          onClick={() => onMobileMenuToggle(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        {/* Header */}
        <div className="sidebar-header">
          <div className="logo-section">
            <img 
              src="/Assets/platnum_logo.png" 
              alt="PCL Logo" 
              className="sidebar-logo"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.parentElement.innerHTML = '<div class="logo-fallback">PCL</div>';
              }}
            />
          </div>
          
          <div className="user-info">
            <div className="user-details">
              <span 
                className="user-display-name" 
                title={getUserTooltip()}
              >
                {getUserDisplay()}
              </span>
            </div>
            <button 
              onClick={handleRefreshData}
              className="refresh-user-button"
              title={isRefreshing ? 'Refreshing...' : 'Refresh user data'}
              disabled={isRefreshing}
            >
              {isRefreshing ? '🔄' : '🔄'}
            </button>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="sidebar-menu">
          <ul>
            {accessibleMenuItems.length > 0 ? (
              accessibleMenuItems.map((item) => (
                <li key={item.path}>
                  <Link 
                    to={item.path} 
                    className={`menu-item ${location.pathname === item.path ? 'active' : ''}`}
                    title={isCollapsed ? item.description : undefined}
                    onClick={() => {
                      if (window.innerWidth < 1024) {
                        onMobileMenuToggle(false);
                      }
                    }}
                  >
                    <span className="menu-icon">{item.icon}</span>
                    {!isCollapsed && (
                      <div className="menu-content">
                        <span className="menu-label">{item.label}</span>
                        <span className="menu-description">{item.description}</span>
                      </div>
                    )}
                  </Link>
                </li>
              ))
            ) : (
              <li className="no-access-message">
                <div className="menu-item">
                  <span className="menu-icon">⚠️</span>
                  {!isCollapsed && (
                    <div className="menu-content">
                      <span className="menu-label">No Access</span>
                      <span className="menu-description">Contact administrator</span>
                    </div>
                  )}
                </div>
              </li>
            )}
          </ul>
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          {!isCollapsed && (
            <div className="session-info">
              <small>Last login: {new Date().toLocaleDateString()}</small>
            </div>
          )}
          <button onClick={handleLogoutConfirm} className="logout-button">
            <span className="logout-icon">🚪</span>
            {!isCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="modal-overlay">
          <div className="logout-modal">
            <div className="modal-header">
              <h3>Confirm Logout</h3>
              <button 
                className="modal-close"
                onClick={handleLogoutCancel}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to logout?</p>
              <div className="user-info-modal">
                <span className="user-display-name-modal">
                  {userData.displayName || userData.email}
                </span>
                <span className="user-role-modal">{userData.role.toUpperCase()}</span>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                className="cancel-btn"
                onClick={handleLogoutCancel}
              >
                Cancel
              </button>
              <button 
                className="confirm-btn"
                onClick={handleLogout}
              >
                Yes, Logout
              </button>
            </div>
          </div>
        </div>
      )}

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
    </>
  );
};

export default Sidebar;