import React, { useState } from 'react';
import { doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../../services/firebase';
import LoadingSpinner from '../../../Common/Loading/LoadingSpinner';
import './UserDetailModal.css';

const UserDetailModal = ({ user, onClose, onUserUpdated, onUserDeleted, showToast }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({ ...user });
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const roles = [
    { value: 'admin', label: 'Administrator' },
    { value: 'CS', label: 'CS User' },
    { value: 'LBF', label: 'LBF User' },
    { value: 'SME', label: 'SME User' },
    { value: 'ALL', label: 'All Access' }
  ];

  const departments = [
    { value: 'CS', label: 'Civil Servant' },
    { value: 'LBF', label: 'Log Book Finance' },
    { value: 'SME', label: 'Small & Medium Enterprise' },
    { value: 'ALL', label: 'All Departments' }
  ];

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleEdit = () => {
    setIsEditing(true);
    setEditData({ ...user });
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditData({ ...user });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setEditData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSave = async () => {
    try {
      setLoading(true);
      
      const userRef = doc(db, 'users', user.id);
      await updateDoc(userRef, {
        displayName: editData.displayName,
        role: editData.role,
        department: editData.department,
        isActive: editData.isActive,
        updatedAt: new Date().toISOString()
      });

      onUserUpdated({
        ...user,
        ...editData,
        updatedAt: new Date().toISOString()
      });
      
      setIsEditing(false);
      showToast('success', 'User updated successfully');
    } catch (error) {
      console.error('Error updating user:', error);
      showToast('error', 'Failed to update user');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      setLoading(true);
      
      const userRef = doc(db, 'users', user.id);
      await deleteDoc(userRef);
      
      onUserDeleted(user.id);
      onClose();
      showToast('success', 'User deleted successfully');
    } catch (error) {
      console.error('Error deleting user:', error);
      showToast('error', 'Failed to delete user');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async () => {
    try {
      setLoading(true);
      
      const userRef = doc(db, 'users', user.id);
      const newStatus = !user.isActive;
      
      await updateDoc(userRef, {
        isActive: newStatus,
        updatedAt: new Date().toISOString()
      });

      onUserUpdated({
        ...user,
        isActive: newStatus,
        updatedAt: new Date().toISOString()
      });
      
      showToast('success', `User ${newStatus ? 'activated' : 'deactivated'} successfully`);
    } catch (error) {
      console.error('Error toggling user status:', error);
      showToast('error', 'Failed to update user status');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* User Detail Modal */}
      <div className="modal-overlay" onClick={onClose}>
        <div className="user-detail-modal" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="modal-header">
            <div className="header-left">
              <div className="user-avatar-large">
                {user.displayName ? 
                  user.displayName.charAt(0).toUpperCase() : 
                  user.email.charAt(0).toUpperCase()
                }
              </div>
              <div className="user-title">
                <h2>{user.displayName || user.email.split('@')[0]}</h2>
                <p className="user-email">{user.email}</p>
              </div>
            </div>
            <button 
              className="modal-close"
              onClick={onClose}
              aria-label="Close"
              disabled={loading}
            >
              ×
            </button>
          </div>

          {/* Content */}
          <div className="modal-content">
            {isEditing ? (
              /* Edit Form */
              <div className="edit-form">
                <div className="form-section">
                  <h3>Edit User Details</h3>
                  
                  <div className="form-group">
                    <label htmlFor="edit-displayName" className="form-label">
                      Full Name
                    </label>
                    <input
                      type="text"
                      id="edit-displayName"
                      name="displayName"
                      value={editData.displayName || ''}
                      onChange={handleChange}
                      className="form-input"
                      placeholder="Enter full name"
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="edit-role" className="form-label">
                      Role
                    </label>
                    <select
                      id="edit-role"
                      name="role"
                      value={editData.role}
                      onChange={handleChange}
                      className="form-select"
                    >
                      {roles.map(role => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="edit-department" className="form-label">
                      Department
                    </label>
                    <select
                      id="edit-department"
                      name="department"
                      value={editData.department}
                      onChange={handleChange}
                      className="form-select"
                    >
                      {departments.map(dept => (
                        <option key={dept.value} value={dept.value}>
                          {dept.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Status</label>
                    <div className="status-toggle">
                      <button
                        type="button"
                        className={`toggle-option ${editData.isActive ? 'active' : ''}`}
                        onClick={() => setEditData(prev => ({ ...prev, isActive: true }))}
                      >
                        Active
                      </button>
                      <button
                        type="button"
                        className={`toggle-option ${!editData.isActive ? 'active' : ''}`}
                        onClick={() => setEditData(prev => ({ ...prev, isActive: false }))}
                      >
                        Inactive
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* View Details */
              <div className="user-details">
                <div className="detail-section">
                  <h3>User Information</h3>
                  <div className="detail-grid">
                    <div className="detail-item">
                      <span className="detail-label">Full Name</span>
                      <span className="detail-value">
                        {user.displayName || 'Not set'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Email</span>
                      <span className="detail-value">{user.email}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Role</span>
                      <span className="detail-value role-badge">{user.role}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Department</span>
                      <span className="detail-value dept-badge">{user.department}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Status</span>
                      <span className={`detail-value status-badge ${user.isActive ? 'active' : 'inactive'}`}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Account Created</span>
                      <span className="detail-value">{formatDate(user.createdAt)}</span>
                    </div>
                    {user.updatedAt && (
                      <div className="detail-item">
                        <span className="detail-label">Last Updated</span>
                        <span className="detail-value">{formatDate(user.updatedAt)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Account Actions */}
                <div className="actions-section">
                  <h3>Account Actions</h3>
                  <div className="action-buttons">
                    <button 
                      className="action-button edit"
                      onClick={handleEdit}
                      disabled={loading}
                    >
                      ✏️ Edit User
                    </button>
                    <button 
                      className={`action-button ${user.isActive ? 'deactivate' : 'activate'}`}
                      onClick={handleToggleStatus}
                      disabled={loading}
                    >
                      {user.isActive ? '⏸️ Deactivate' : '▶️ Activate'}
                    </button>
                    <button 
                      className="action-button delete"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={loading}
                    >
                      🗑️ Delete User
                    </button>
                  </div>
                </div>

                {/* Role Information */}
                <div className="info-section">
                  <h3>Role Permissions</h3>
                  <div className="role-info">
                    {user.role === 'admin' && (
                      <p>Administrators have full access to all system features including user management, report management, and system settings.</p>
                    )}
                    {user.role === 'CS' && (
                      <p>CS Users can access Civil Servant reports and dashboard overview.</p>
                    )}
                    {user.role === 'LBF' && (
                      <p>LBF Users can access Log Book Finance reports and dashboard overview.</p>
                    )}
                    {user.role === 'SME' && (
                      <p>SME Users can access Small & Medium Enterprise reports and dashboard overview.</p>
                    )}
                    {user.role === 'ALL' && (
                      <p>All Access Users can view reports from all departments but cannot manage users or system settings.</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="modal-footer">
            {isEditing ? (
              <>
                <button
                  className="footer-button cancel"
                  onClick={handleCancelEdit}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  className="footer-button save"
                  onClick={handleSave}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <LoadingSpinner size="small" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </button>
              </>
            ) : (
              <button
                className="footer-button close"
                onClick={onClose}
                disabled={loading}
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="delete-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="delete-header">
              <span className="delete-icon">⚠️</span>
              <h3>Delete User</h3>
            </div>
            
            <div className="delete-content">
              <p>Are you sure you want to delete this user?</p>
              <div className="user-to-delete">
                <div className="delete-avatar">
                  {user.displayName ? 
                    user.displayName.charAt(0).toUpperCase() : 
                    user.email.charAt(0).toUpperCase()
                  }
                </div>
                <div className="delete-user-info">
                  <strong>{user.displayName || user.email.split('@')[0]}</strong>
                  <span>{user.email}</span>
                  <span className="delete-user-role">{user.role} • {user.department}</span>
                </div>
              </div>
              
              <div className="delete-warning">
                <p><strong>Warning:</strong> This action cannot be undone.</p>
                <ul>
                  <li>User will lose access to the system immediately</li>
                  <li>All user data will be permanently deleted</li>
                  <li>This action is irreversible</li>
                </ul>
              </div>
            </div>

            <div className="delete-footer">
              <button
                className="delete-cancel"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="delete-confirm"
                onClick={handleDelete}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <LoadingSpinner size="small" />
                    Deleting...
                  </>
                ) : (
                  'Yes, Delete User'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default UserDetailModal;