import React, { useState, useRef } from 'react';
import { uploadReportFile } from '../../../../services/supabase';
import LoadingSpinner from '../../../Common/Loading/LoadingSpinner';
import UploadProgress from '../UploadProgress/UploadProgress';
import './AddReportModal.css';

// Helper to convert YYYY-MM-DD to dd/mm/yyyy
const formatDateForDisplay = (isoDate) => {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
};

// Helper to convert dd/mm/yyyy to YYYY-MM-DD
const parseDateFromDisplay = (displayDate) => {
  if (!displayDate) return '';
  const parts = displayDate.split('/');
  if (parts.length !== 3) return displayDate;
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

// Get today's date in dd/mm/yyyy format
const getTodayFormatted = () => {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  return `${day}/${month}/${year}`;
};

const AddReportModal = ({ onClose, onReportAdded, showToast }) => {
  const [formData, setFormData] = useState({
    department: 'CS',
    type: 'CALL CENTER',
    date: getTodayFormatted(),
    file: null
  });
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errors, setErrors] = useState({});
  const fileInputRef = useRef(null);

  const departments = [
    { value: 'CS', label: 'Civil Servant' },
    { value: 'LBF', label: 'Log Book Finance' },
    { value: 'SME', label: 'Small & Medium Enterprise' },
    { value: 'ALL', label: 'All Departments' }
  ];

  const reportTypes = [
    { value: 'CALL CENTER', label: 'Call Center' },
    { value: 'CRM', label: 'CRM' },
    { value: 'DEPARTMENTAL', label: 'Departmental' },
    { value: 'MTD', label: 'MTD' },
    { value: 'MANAGEMENT', label: 'Management' }
  ];

  const validateForm = () => {
    const newErrors = {};
    
    // Validate date format (dd/mm/yyyy)
    if (!formData.date) {
      newErrors.date = 'Please enter a date';
    } else {
      const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
      const match = formData.date.match(dateRegex);
      if (!match) {
        newErrors.date = 'Invalid date format. Use dd/mm/yyyy';
      } else {
        const [, day, month, year] = match;
        const dateObj = new Date(year, month - 1, day);
        if (dateObj.getDate() !== parseInt(day) || 
            dateObj.getMonth() !== parseInt(month) - 1 || 
            dateObj.getFullYear() !== parseInt(year)) {
          newErrors.date = 'Invalid date';
        }
      }
    }
    
    if (!formData.file) {
      newErrors.file = 'Please select a file to upload';
    } else {
      const allowedTypes = [
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      
      if (!allowedTypes.includes(formData.file.type)) {
        newErrors.file = 'Please upload a valid file (PDF, Excel, CSV, Word)';
      }
      
      if (formData.file.size > 50 * 1024 * 1024) { // 50MB limit
        newErrors.file = 'File size must be less than 50MB';
      }
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
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFormData(prev => ({
        ...prev,
        file
      }));
      
      if (errors.file) {
        setErrors(prev => ({
          ...prev,
          file: ''
        }));
      }
    }
  };

  const getFilePath = () => {
    const timestamp = Date.now();
    const fileName = formData.file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileExtension = formData.file.name.split('.').pop().toLowerCase();
    
    // Generate file path based on department and type
    let filePath = '';
    
    if (formData.department === 'ALL') {
      // Upload to all department folders
      filePath = `ALL/${formData.type}/${timestamp}_${fileName}`;
    } else {
      filePath = `${formData.department}/${formData.type}/${timestamp}_${fileName}`;
    }
    
    return filePath;
  };

  // Extract title from filename (remove extension)
  const extractTitleFromFilename = (filename) => {
    // Remove file extension
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
    
    // Remove timestamp prefix if it exists in the format "timestamp_"
    const timestampRegex = /^\d+_/;
    const cleanName = nameWithoutExt.replace(timestampRegex, '');
    
    // Replace underscores and hyphens with spaces
    const spacedName = cleanName.replace(/[_-]/g, ' ');
    
    // Capitalize first letter of each word
    const title = spacedName
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    
    return title;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setUploadProgress(0);
    
    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      // Extract title from filename
      const reportTitle = extractTitleFromFilename(formData.file.name);
      
      // Convert date from dd/mm/yyyy to ISO format for backend
      const isoDate = parseDateFromDisplay(formData.date);
      const fullIsoDate = new Date(isoDate + 'T00:00:00').toISOString();
      
      // Upload file with all required data (backend creates the report record)
      const filePath = getFilePath();
      const uploadResult = await uploadReportFile(formData.file, filePath, {
        title: reportTitle,
        department: formData.department,
        type: formData.type,
        date: fullIsoDate
      });
      
      clearInterval(progressInterval);
      setUploadProgress(100);

      if (!uploadResult.success) {
        throw new Error(uploadResult.error || 'File upload failed');
      }

      // Backend already created the report, use the returned data
      if (uploadResult.data) {
        onReportAdded(uploadResult.data);
        onClose();
        showToast('success', 'Report uploaded successfully');
      } else {
        throw new Error('Failed to create report record');
      }
    } catch (error) {
      console.error('Error uploading report:', error);
      showToast('error', `Upload failed: ${error.message}`);
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      setFormData(prev => ({
        ...prev,
        file
      }));
      
      if (errors.file) {
        setErrors(prev => ({
          ...prev,
          file: ''
        }));
      }
    }
  };

  const getFileIcon = () => {
    if (!formData.file) return '📎';
    
    const type = formData.file.type;
    if (type === 'application/pdf') return '📄';
    if (type.includes('excel') || type.includes('spreadsheet')) return '📊';
    if (type === 'text/csv') return '📋';
    if (type.includes('word') || type.includes('document')) return '📝';
    return '📎';
  };

  const getAutoGeneratedTitle = () => {
    if (!formData.file) return '';
    return extractTitleFromFilename(formData.file.name);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="add-report-modal" onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="header-content">
            <h2>Upload New Report</h2>
            <p className="modal-subtitle">Add a new report to the system</p>
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

        {/* Upload Progress */}
        {uploadProgress > 0 && (
          <UploadProgress progress={uploadProgress} />
        )}

        {/* Auto-generated Title Preview */}
        {formData.file && (
          <div className="title-preview">
            <div className="title-preview-header">
              <span className="title-icon">📝</span>
              <span className="title-label">Report Title (Auto-generated):</span>
            </div>
            <div className="title-preview-content">
              {getAutoGeneratedTitle()}
            </div>
            <div className="title-note">
              Title is automatically generated from the filename
            </div>
          </div>
        )}

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="modal-body" noValidate>
          {/* Department Selection */}
          <div className="form-group">
            <label htmlFor="department" className="form-label">
              <span className="label-text">Upload To</span>
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
            {formData.department === 'ALL' && (
              <div className="info-note">
                Note: This report will be available in ALL department folders
              </div>
            )}
          </div>

          {/* Report Type Selection */}
          <div className="form-group">
            <label htmlFor="type" className="form-label">
              <span className="label-text">Report Type</span>
              <span className="required-asterisk">*</span>
            </label>
            <div className="select-wrapper">
              <select
                id="type"
                name="type"
                value={formData.type}
                onChange={handleChange}
                className="form-select"
                disabled={loading}
              >
                {reportTypes.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Date Field */}
          <div className="form-group">
            <label htmlFor="date" className="form-label">
              <span className="label-text">Report Date</span>
              <span className="required-asterisk">*</span>
            </label>
            <div className="input-wrapper">
              <input
                type="text"
                id="date"
                name="date"
                value={formData.date}
                onChange={handleChange}
                className="form-input"
                disabled={loading}
                placeholder="dd/mm/yyyy"
                pattern="\d{2}/\d{2}/\d{4}"
              />
              <span className="input-hint">Format: dd/mm/yyyy</span>
            </div>
            {errors.date && (
              <span className="error-message">{errors.date}</span>
            )}
          </div>

          {/* File Upload */}
          <div className="form-group">
            <label className="form-label">
              <span className="label-text">Upload File</span>
              <span className="required-asterisk">*</span>
            </label>
            
            <div 
              className={`file-upload-area ${errors.file ? 'error' : ''} ${formData.file ? 'has-file' : ''}`}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => !loading && fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="file-input"
                accept=".pdf,.xlsx,.xls,.csv,.doc,.docx"
                disabled={loading}
              />
              
              {formData.file ? (
                <div className="file-preview">
                  <div className="file-icon-large">
                    {getFileIcon()}
                  </div>
                  <div className="file-info">
                    <div className="file-name">{formData.file.name}</div>
                    <div className="file-size">
                      {(formData.file.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                    <div className="file-auto-title">
                      <strong>Auto Title:</strong> {getAutoGeneratedTitle()}
                    </div>
                    <button 
                      type="button"
                      className="remove-file"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFormData(prev => ({ ...prev, file: null }));
                        if (fileInputRef.current) {
                          fileInputRef.current.value = '';
                        }
                      }}
                      disabled={loading}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div className="upload-placeholder">
                  <div className="upload-icon">📤</div>
                  <div className="upload-text">
                    <p className="upload-title">Click to upload or drag and drop</p>
                    <p className="upload-subtitle">
                      PDF, Excel, CSV, or Word files (Max 50MB)
                    </p>
                    <p className="upload-note">
                      Report title will be auto-generated from filename
                    </p>
                  </div>
                </div>
              )}
            </div>
            
            {errors.file && (
              <span className="error-message">{errors.file}</span>
            )}
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
            disabled={loading || !formData.file}
          >
            {loading ? (
              <>
                <LoadingSpinner size="small" />
                Uploading...
              </>
            ) : (
              'Upload Report'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddReportModal;
