import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../../services/firebase';
import { deleteReport, incrementReportDownloads } from '../../../../services/reports';
import { deleteReportFile, getReportFileUrl } from '../../../../services/supabase';
import LoadingSpinner from '../../../Common/Loading/LoadingSpinner';
import './ReportDetailModal.css';

const ReportDetailModal = ({ report, onClose, onReportUpdated, onReportDeleted, showToast }) => {
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({ ...report });

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

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return 'Invalid Date';
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'N/A';
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = () => {
    const type = report.fileType || report.mimeType;
    if (type?.includes('pdf')) return '📄';
    if (type?.includes('excel') || type?.includes('spreadsheet')) return '📊';
    if (type?.includes('csv')) return '📋';
    if (type?.includes('word') || type?.includes('document')) return '📝';
    return '📎';
  };

  const handleDownload = async () => {
    try {
      setLoading(true);
      
      // Increment download count
      await incrementReportDownloads(report.id);
      
      // Use the stored fileUrl or generate one from filePath
      let fileUrl = report.fileUrl;
      
      if (!fileUrl && report.filePath) {
        // Generate URL if not already stored
        fileUrl = getReportFileUrl(report.filePath);
      }
      
      if (fileUrl) {
        window.open(fileUrl, '_blank');
        showToast('success', 'Download started');
      } else {
        throw new Error('File URL not found');
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      showToast('error', 'Failed to download file');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
    setEditData({ ...report });
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditData({ ...report });
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
      
      const reportRef = doc(db, 'reports', report.id);
      
      // Build update object, filtering out undefined values and converting them to null
      const updateData = {
        title: editData.title || null,
        description: editData.description !== undefined ? (editData.description || null) : null,
        department: editData.department || null,
        type: editData.type || null,
        date: editData.date || null,
        updatedAt: new Date().toISOString()
      };
      
      // Remove undefined values completely
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });
      
      await updateDoc(reportRef, updateData);

      onReportUpdated({
        ...report,
        ...editData,
        updatedAt: new Date().toISOString()
      });
      
      setIsEditing(false);
      showToast('success', 'Report updated successfully');
    } catch (error) {
      console.error('Error updating report:', error);
      showToast('error', 'Failed to update report');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      setLoading(true);
      
      // Delete file from Supabase
      if (report.filePath) {
        const deleteResult = await deleteReportFile(report.filePath);
        if (!deleteResult.success) {
          console.warn('Failed to delete file from storage:', deleteResult.error);
        }
      }
      
      // Delete record from Firestore
      const deleteResult = await deleteReport(report.id);
      
      if (deleteResult.success) {
        onReportDeleted(report.id);
        onClose();
        showToast('success', 'Report deleted successfully');
      } else {
        throw new Error(deleteResult.error || 'Failed to delete report');
      }
    } catch (error) {
      console.error('Error deleting report:', error);
      showToast('error', `Failed to delete report: ${error.message}`);
    } finally {
      setLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleToggleStatus = async () => {
    try {
      setLoading(true);
      
      const reportRef = doc(db, 'reports', report.id);
      const newStatus = !report.isActive;
      
      await updateDoc(reportRef, {
        isActive: newStatus,
        updatedAt: new Date().toISOString()
      });

      onReportUpdated({
        ...report,
        isActive: newStatus,
        updatedAt: new Date().toISOString()
      });
      
      showToast('success', `Report ${newStatus ? 'activated' : 'deactivated'} successfully`);
    } catch (error) {
      console.error('Error toggling report status:', error);
      showToast('error', 'Failed to update report status');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Report Detail Modal */}
      <div className="modal-overlay" onClick={onClose}>
        <div className="rm-report-detail-modal" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="rm-modal-header">
            <div className="rm-header-left">
              <div className="rm-file-icon-large">
                {getFileIcon()}
              </div>
              <div className="rm-report-title-section">
                <h2>{report.title || 'Untitled Report'}</h2>
                <p className="rm-report-subtitle">{report.fileName}</p>
              </div>
            </div>
            <button 
              className="rm-modal-close"
              onClick={onClose}
              aria-label="Close"
              disabled={loading}
            >
              ×
            </button>
          </div>

          {/* Content */}
          <div className="rm-modal-content">
            {isEditing ? (
            /* Edit Form */
            <div className="rm-edit-form">
                <div className="rm-form-section">
                <h3>Edit Report Details</h3>
                
                {/* Note: Title is not editable - it comes from filename */}
                <div className="rm-non-editable-field">
                    <label className="rm-form-label">Report Title</label>
                    <div className="rm-non-editable-value">
                    {report.title}
                    <div className="rm-field-note">Auto-generated from filename, cannot be changed</div>
                    </div>
                </div>

                <div className="rm-form-group">
                    <label htmlFor="edit-department" className="rm-form-label">
                    Department
                    </label>
                    <select
                    id="edit-department"
                    name="department"
                    value={editData.department}
                    onChange={handleChange}
                    className="rm-form-select"
                    >
                    {departments.map(dept => (
                        <option key={dept.value} value={dept.value}>
                        {dept.label}
                        </option>
                    ))}
                    </select>
                </div>

                <div className="rm-form-group">
                    <label htmlFor="edit-type" className="rm-form-label">
                    Report Type
                    </label>
                    <select
                    id="edit-type"
                    name="type"
                    value={editData.type}
                    onChange={handleChange}
                    className="rm-form-select"
                    >
                    {reportTypes.map(type => (
                        <option key={type.value} value={type.value}>
                        {type.label}
                        </option>
                    ))}
                    </select>
                </div>

                {/* Keep date field for editing */}
                <div className="rm-form-group">
                    <label htmlFor="edit-date" className="rm-form-label">
                    Report Date
                    </label>
                    <input
                    type="date"
                    id="edit-date"
                    name="date"
                    value={editData.date ? new Date(editData.date).toISOString().split('T')[0] : ''}
                    onChange={handleChange}
                    className="rm-form-input"
                    />
                </div>
                </div>
            </div>
            ) : (
              /* View Details */
              <div className="rm-report-details">
                <div className="rm-detail-section">
                  <h3>Report Information</h3>
                  <div className="rm-detail-grid">
                    <div className="rm-detail-item">
                      <span className="rm-detail-label">File Name</span>
                      <span className="rm-detail-value">{report.fileName}</span>
                    </div>
                    <div className="rm-detail-item">
                      <span className="rm-detail-label">File Size</span>
                      <span className="rm-detail-value">{formatFileSize(report.fileSize)}</span>
                    </div>
                    <div className="rm-detail-item">
                      <span className="rm-detail-label">File Type</span>
                      <span className="rm-detail-value">{report.fileType || report.mimeType}</span>
                    </div>
                    <div className="rm-detail-item">
                      <span className="rm-detail-label">Department</span>
                      <span className="rm-detail-value rm-dept-badge">{report.department}</span>
                    </div>
                    <div className="rm-detail-item">
                      <span className="rm-detail-label">Report Type</span>
                      <span className="rm-detail-value rm-type-badge">{report.type}</span>
                    </div>
                    <div className="rm-detail-item">
                      <span className="rm-detail-label">Status</span>
                      <span className={`rm-detail-value rm-status-badge ${report.isActive ? 'active' : 'inactive'}`}>
                        {report.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="rm-detail-item">
                      <span className="rm-detail-label">Upload Date</span>
                      <span className="rm-detail-value">{formatDate(report.createdAt)}</span>
                    </div>
                    <div className="rm-detail-item">
                      <span className="rm-detail-label">Report Date</span>
                      <span className="rm-detail-value">{formatDate(report.date)}</span>
                    </div>
                    {report.updatedAt && (
                      <div className="rm-detail-item">
                        <span className="rm-detail-label">Last Updated</span>
                        <span className="rm-detail-value">{formatDate(report.updatedAt)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Description */}
                {report.description && (
                  <div className="rm-description-section">
                    <h3>Description</h3>
                    <div className="rm-description-content">
                      {report.description}
                    </div>
                  </div>
                )}

                {/* Statistics */}
                <div className="rm-stats-section">
                  <h3>Statistics</h3>
                  <div className="rm-stats-grid">
                    <div className="rm-stat-item">
                      <span className="rm-stat-icon">👁️</span>
                      <div className="rm-stat-content">
                        <div className="rm-stat-value">{report.views || 0}</div>
                        <div className="rm-stat-label">Views</div>
                      </div>
                    </div>
                    <div className="rm-stat-item">
                      <span className="rm-stat-icon">📥</span>
                      <div className="rm-stat-content">
                        <div className="rm-stat-value">{report.downloads || 0}</div>
                        <div className="rm-stat-label">Downloads</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* File Path */}
                {report.filePath && (
                  <div className="rm-filepath-section">
                    <h3>Storage Location</h3>
                    <div className="rm-filepath-content">
                      <code>{report.filePath}</code>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="rm-actions-section">
                  <h3>Actions</h3>
                  <div className="rm-action-buttons">
                    <button 
                      className="rm-action-button download"
                      onClick={handleDownload}
                      disabled={loading}
                    >
                      📥 Download File
                    </button>
                    <button 
                      className="rm-action-button edit"
                      onClick={handleEdit}
                      disabled={loading}
                    >
                      ✏️ Edit Details
                    </button>
                    <button 
                      className={`rm-action-button ${report.isActive ? 'deactivate' : 'activate'}`}
                      onClick={handleToggleStatus}
                      disabled={loading}
                    >
                      {report.isActive ? '⏸️ Deactivate' : '▶️ Activate'}
                    </button>
                    <button 
                      className="rm-action-button delete"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={loading}
                    >
                      🗑️ Delete Report
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="rm-modal-footer">
            {isEditing ? (
              <>
                <button
                  className="rm-footer-button cancel"
                  onClick={handleCancelEdit}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  className="rm-footer-button save"
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
                className="rm-footer-button close"
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
          <div className="rm-delete-confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="rm-delete-header">
              <span className="rm-delete-icon">⚠️</span>
              <h3>Delete Report</h3>
            </div>
            
            <div className="rm-delete-content">
              <p>Are you sure you want to delete this report?</p>
              <div className="rm-report-to-delete">
                <div className="rm-delete-file-icon">
                  {getFileIcon()}
                </div>
                <div className="rm-delete-report-info">
                  <strong>{report.title || 'Untitled Report'}</strong>
                  <span>{report.fileName}</span>
                  <span className="rm-delete-report-details">
                    {report.department} • {report.type} • {formatFileSize(report.fileSize)}
                  </span>
                </div>
              </div>
              
              <div className="rm-delete-warning">
                <p><strong>Warning:</strong> This action cannot be undone.</p>
                <ul>
                  <li>Report file will be deleted from storage</li>
                  <li>Report record will be removed from database</li>
                  <li>All statistics will be lost</li>
                  <li>Users will no longer have access to this report</li>
                </ul>
              </div>
            </div>

            <div className="rm-delete-footer">
              <button
                className="rm-delete-cancel"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="rm-delete-confirm"
                onClick={handleDelete}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <LoadingSpinner size="small" />
                    Deleting...
                  </>
                ) : (
                  'Yes, Delete Report'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ReportDetailModal;