import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './PrivateRoute.css';

const PrivateRoute = () => {
  const { user, loading, userData } = useAuth();

  if (loading) {
    return (
      <>
        <div className="blur-overlay">
          <div className="auth-loading">
            <div className="auth-loading-spinner"></div>
            <p>Authenticating...</p>
          </div>
        </div>
        <Outlet />
      </>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  // Check if user data is loaded
  if (!userData) {
    return (
      <>
        <div className="blur-overlay">
          <div className="auth-loading">
            <div className="auth-loading-spinner"></div>
            <p>Refreshing...</p>
          </div>
        </div>
        <Outlet />
      </>
    );
  }

  return <Outlet />;
};

export default PrivateRoute;