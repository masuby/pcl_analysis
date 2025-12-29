import React, { useState } from 'react';
import { createUser } from '../../../../services/auth';
import LoadingSpinner from '../../../Common/Loading/LoadingSpinner';
import './AddUserModal.css';

const AddUserModal = ({ onClose, onUserAdded, showToast }) => {
  const [formData, setFormData] = useState({
    displayName: '',
    email: '',
    password: '',
    role: 'CS',
    department: 'CS'
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);

  const roles = [
    { value: 'admin', label: 'Administrator', description: 'Full system access' },
    { value: 'CS', label: 'CS User', description: 'Civil Servant reports access' },
    { value: 'LBF', label: 'LBF User', description: 'Log Book Finance reports access' },
    { value: 'SME', label: 'SME User', description: 'SME reports access' },
    { value: 'ALL', label: 'All Access', description: 'All reports access' }
  ];

  const departments = [
    { value: 'CS', label: 'Civil Servant' },
    { value: 'LBF', label: 'Log Book Finance' },
    { value: 'SME', label: 'Small & Medium Enterprise' },
    { value: 'ALL', label: 'All Departments' }
  ];

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.displayName.trim()) {
      newErrors.displayName = 'Name is required';
    }
    
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email';
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    
    try {
      const result = await createUser(formData.email, formData.password, {
        displayName: formData.displayName,
        email: formData.email,
        role: formData.role,
        department: formData.department,
        isActive: true
      });

      if (result.success) {
        onUserAdded({
          id: result.user.uid,
          ...formData,
          isActive: true,
          createdAt: new Date().toISOString()
        });
        onClose();
      } else {
        showToast('error', result.error);
      }
    } catch (error) {
      showToast('error', 'Failed to create user. Please try again.');
      console.error('Error creating user:', error);
    } finally {
      setLoading(false);
    }
  };

  const getRoleDescription = () => {
    const selectedRole = roles.find(r => r.value === formData.role);
    return selectedRole ? selectedRole.description : '';
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="add-user-modal" onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="header-content">
            <h2>Add New User</h2>
            <p className="modal-subtitle">Create a new user account for the system</p>
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

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="modal-body" noValidate>
          {/* Name Field */}
          <div className="form-group">
            <label htmlFor="displayName" className="form-label">
              <span className="label-text">Full Name</span>
              <span className="required-asterisk">*</span>
            </label>
            <div className="input-wrapper">
              <input
                type="text"
                id="displayName"
                name="displayName"
                value={formData.displayName}
                onChange={handleChange}
                placeholder="Enter user's full name"
                className={`form-input ${errors.displayName ? 'error' : ''}`}
                disabled={loading}
              />
            </div>
            {errors.displayName && (
              <span className="error-message">{errors.displayName}</span>
            )}
          </div>

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
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="Enter user's email address"
                className={`form-input ${errors.email ? 'error' : ''}`}
                disabled={loading}
              />
            </div>
            {errors.email && (
              <span className="error-message">{errors.email}</span>
            )}
          </div>

          {/* Password Field */}
          <div className="form-group">
            <label htmlFor="password" className="form-label">
              <span className="label-text">Initial Password</span>
              <span className="required-asterisk">*</span>
            </label>
            <div className="input-wrapper password-input-wrapper">
              <input
                type={showPassword ? "text" : "password"}
                id="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="Set initial password"
                className={`form-input ${errors.password ? 'error' : ''}`}
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={0}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
            {errors.password && (
              <span className="error-message">{errors.password}</span>
            )}
            <div className="password-hint">
              Minimum 6 characters. User can change this later.
            </div>
          </div>

          {/* Role Selection */}
          <div className="form-group">
            <label htmlFor="role" className="form-label">
              <span className="label-text">User Role</span>
              <span className="required-asterisk">*</span>
            </label>
            <div className="select-wrapper">
              <select
                id="role"
                name="role"
                value={formData.role}
                onChange={handleChange}
                className="form-select"
                disabled={loading}
              >
                {roles.map(role => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="role-description">
              {getRoleDescription()}
            </div>
          </div>

          {/* Department Selection */}
          <div className="form-group">
            <label htmlFor="department" className="form-label">
              <span className="label-text">Department</span>
              <span className="required-asterisk">*</span>
            </label>
            <div className="select-wrapper">
              <select
                id="department"
                name="department"
                value={formData.department}
                onChange={handleChange}
                className="form-select"
                disabled={loading}
              >
                {departments.map(dept => (
                  <option key={dept.value} value={dept.value}>
                    {dept.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </form>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button
            type="button"
            className="cancel-button"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="submit-button"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <>
                <LoadingSpinner size="small" />
                Creating User...
              </>
            ) : (
              'Create User'
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default AddUserModal;