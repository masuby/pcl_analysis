import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { updateUserDataInFirestore, updateUserPassword } from '../../services/auth';
import LoadingSpinner from '../../components/Common/Loading/LoadingSpinner';
import './Profile.css';

const Profile = () => {
  const { user, userData, loading, refreshUserData } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [displayName, setDisplayName] = useState(userData?.displayName || '');

  // Update displayName when userData changes
  useEffect(() => {
    if (userData?.displayName) {
      setDisplayName(userData.displayName);
    }
  }, [userData]);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const handleEditProfile = async () => {
    if (!displayName.trim()) {
      setMessage({ type: 'error', text: 'Display name cannot be empty' });
      return;
    }

    setIsLoading(true);
    setMessage({ type: '', text: '' });

    try {
      await updateUserDataInFirestore(user.uid, { displayName });
      await refreshUserData();
      setMessage({ type: 'success', text: 'Profile updated successfully!' });
      setIsEditing(false);
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    if (passwordData.newPassword.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters' });
      return;
    }

    setIsLoading(true);
    setMessage({ type: '', text: '' });

    try {
      const result = await updateUserPassword(passwordData.currentPassword, passwordData.newPassword);
      if (result.success) {
        setMessage({ type: 'success', text: 'Password changed successfully!' });
        setPasswordData({
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        });
        setIsChangingPassword(false);
      } else {
        setMessage({ type: 'error', text: result.error });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading state if userData is not yet loaded
  if (loading) {
    return (
      <div className="profile-page">
        <LoadingSpinner size="medium" message="Loading profile..." />
      </div>
    );
  }

  // If userData is not available but user is, try to refresh
  useEffect(() => {
    if (user && !userData && !loading) {
      refreshUserData();
    }
  }, [user, userData, loading, refreshUserData]);

  // Show loading if userData is still not available after refresh attempt
  if (!userData) {
    return (
      <div className="profile-page">
        <LoadingSpinner size="medium" message="Loading profile..." />
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="profile-page-header">
        <h2 className="profile-page-title">Profile Settings</h2>
        {message.text && (
          <div className={`profile-message ${message.type}`}>
            <span className="message-icon">
              {message.type === 'success' ? '✅' : '⚠️'}
            </span>
            <span className="message-text">{message.text}</span>
          </div>
        )}
      </div>

      <div className="profile-content">
        {/* Profile Information Card */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h3 className="profile-card-title">
              <span className="card-icon">👤</span>
              Personal Information
            </h3>
          </div>
          
          <div className="profile-compact-layout">
            <div className="profile-avatar-section">
              <div className="profile-avatar-wrapper">
                <div className="profile-avatar">
                  <span className="avatar-text">
                    {(userData?.displayName?.charAt(0) || userData?.email?.charAt(0) || '👤').toUpperCase()}
                  </span>
                </div>
                <div className="avatar-status"></div>
              </div>
              <div className="profile-header-info">
                <h3 className="profile-name">{userData?.displayName || user?.email}</h3>
                <div className="profile-meta">
                  <span className="profile-badge">{userData?.role || 'User'}</span>
                </div>
              </div>
            </div>
            
            <div className="profile-info-grid">
              <div className="info-item">
                <div className="info-label-wrapper">
                  <span className="info-icon">📝</span>
                  <label className="info-label">Display Name</label>
                </div>
                {isEditing ? (
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="profile-input compact"
                    disabled={isLoading}
                    placeholder="Enter your name"
                  />
                ) : (
                  <span className="info-value">{userData?.displayName || 'Not set'}</span>
                )}
              </div>
              
              <div className="info-item">
                <div className="info-label-wrapper">
                  <span className="info-icon">✉️</span>
                  <label className="info-label">Email</label>
                </div>
                <span className="info-value">{user?.email}</span>
              </div>
              
              <div className="info-item">
                <div className="info-label-wrapper">
                  <span className="info-icon">🔑</span>
                  <label className="info-label">Role</label>
                </div>
                <span className="info-value">{userData?.role || 'User'}</span>
              </div>
              
              <div className="info-item">
                <div className="info-label-wrapper">
                  <span className="info-icon">📅</span>
                  <label className="info-label">Created</label>
                </div>
                <span className="info-value">
                  {userData?.createdAt ? new Date(userData.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                  }) : 'N/A'}
                </span>
              </div>
            </div>

            {!isChangingPassword && (
              <div className="profile-actions">
                {isEditing ? (
                  <>
                    <button 
                      onClick={handleEditProfile} 
                      className="profile-button primary compact"
                      disabled={isLoading}
                    >
                      <span className="button-icon">💾</span>
                      {isLoading ? 'Saving...' : 'Save'}
                    </button>
                    <button 
                      onClick={() => {
                        setIsEditing(false);
                        setDisplayName(userData?.displayName || '');
                      }} 
                      className="profile-button secondary compact"
                      disabled={isLoading}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button 
                    onClick={() => setIsEditing(true)} 
                    className="profile-button secondary compact"
                  >
                    <span className="button-icon">✏️</span>
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Password Change Card */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h3 className="profile-card-title">
              <span className="card-icon">🔒</span>
              Security Settings
            </h3>
          </div>

          {isChangingPassword ? (
            <div className="password-change-form compact">
              <div className="form-row">
                <div className="form-group compact">
                  <label className="form-label">
                    <span className="form-icon">🔑</span>
                    Current Password
                  </label>
                  <input
                    type="password"
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData({...passwordData, currentPassword: e.target.value})}
                    className="profile-input compact"
                    disabled={isLoading}
                    placeholder="Current password"
                  />
                </div>
                <div className="form-group compact">
                  <label className="form-label">
                    <span className="form-icon">🆕</span>
                    New Password
                  </label>
                  <input
                    type="password"
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                    className="profile-input compact"
                    disabled={isLoading}
                    placeholder="New password"
                  />
                </div>
                <div className="form-group compact">
                  <label className="form-label">
                    <span className="form-icon">✓</span>
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                    className="profile-input compact"
                    disabled={isLoading}
                    placeholder="Confirm password"
                  />
                </div>
              </div>
              <div className="profile-actions">
                <button 
                  onClick={handleChangePassword} 
                  className="profile-button primary compact"
                  disabled={isLoading}
                >
                  <span className="button-icon">💾</span>
                  {isLoading ? 'Changing...' : 'Save Password'}
                </button>
                <button 
                  onClick={() => {
                    setIsChangingPassword(false);
                    setPasswordData({
                      currentPassword: '',
                      newPassword: '',
                      confirmPassword: ''
                    });
                  }} 
                  className="profile-button secondary compact"
                  disabled={isLoading}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="password-section-content compact">
              <p className="password-section-description">
                Keep your account secure by regularly updating your password.
              </p>
              <div className="password-button-wrapper">
                <button 
                  onClick={() => setIsChangingPassword(true)} 
                  className="profile-button primary compact auto-width"
                  disabled={isEditing}
                >
                  <span className="button-icon">🔐</span>
                  Change Password
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Profile;