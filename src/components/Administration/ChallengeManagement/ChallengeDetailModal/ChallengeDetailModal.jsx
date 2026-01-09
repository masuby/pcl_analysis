import React, { useState } from 'react';
import { updateChallenge, deleteChallenge } from '../../../../services/challenges';
import { deleteChallengeFile, getChallengeAttachmentUrl, getChallengeImageUrl } from '../../../../services/supabase';
import { getChallengeStatus } from '../../../../services/challenges';
import LoadingSpinner from '../../../Common/Loading/LoadingSpinner';
import './ChallengeDetailModal.css';

const ChallengeDetailModal = ({ challenge, onClose, onChallengeUpdated, onChallengeDeleted, showToast }) => {
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({ 
    ...challenge,
    startDate: challenge.startDate ? (challenge.startDate.toDate ? challenge.startDate.toDate().toISOString().split('T')[0] : new Date(challenge.startDate).toISOString().split('T')[0]) : '',
    endDate: challenge.endDate ? (challenge.endDate.toDate ? challenge.endDate.toDate().toISOString().split('T')[0] : new Date(challenge.endDate).toISOString().split('T')[0]) : ''
  });

  const departments = [
    { value: 'CS', label: 'Civil Servant' },
    { value: 'LBF', label: 'Log Book Finance' },
    { value: 'SME', label: 'Small & Medium Enterprise' },
    { value: 'ALL', label: 'All Departments' }
  ];

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
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

  const getStatusColor = (status) => {
    const colors = {
      finished: '#38a169',
      incoming: '#4299e1',
      ongoing: '#ed8936',
      unknown: '#666'
    };
    return colors[status] || '#666';
  };

  const status = getChallengeStatus(challenge);

  const handleDownload = async () => {
    try {
      setLoading(true);
      
      let fileUrl = challenge.attachmentUrl;
      
      if (!fileUrl && challenge.attachmentPath) {
        fileUrl = await getChallengeAttachmentUrl(challenge.attachmentPath);
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
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditData({ 
      ...challenge,
      startDate: challenge.startDate ? (challenge.startDate.toDate ? challenge.startDate.toDate().toISOString().split('T')[0] : new Date(challenge.startDate).toISOString().split('T')[0]) : '',
      endDate: challenge.endDate ? (challenge.endDate.toDate ? challenge.endDate.toDate().toISOString().split('T')[0] : new Date(challenge.endDate).toISOString().split('T')[0]) : ''
    });
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
      
      const updateData = {
        title: editData.title || null,
        description: editData.description !== undefined ? (editData.description || null) : null,
        department: editData.department || null,
        startDate: editData.startDate ? new Date(editData.startDate).toISOString() : null,
        endDate: editData.endDate ? new Date(editData.endDate).toISOString() : null,
        updatedAt: new Date().toISOString()
      };
      
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });
      
      const result = await updateChallenge(challenge.id, updateData);

      if (result.success) {
        onChallengeUpdated({
          ...challenge,
          ...editData,
          startDate: editData.startDate ? new Date(editData.startDate) : challenge.startDate,
          endDate: editData.endDate ? new Date(editData.endDate) : challenge.endDate,
          updatedAt: new Date().toISOString()
        });
        
        setIsEditing(false);
        showToast('success', 'Challenge updated successfully');
      } else {
        throw new Error(result.error || 'Failed to update challenge');
      }
    } catch (error) {
      console.error('Error updating challenge:', error);
      showToast('error', 'Failed to update challenge');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      setLoading(true);
      
      // Delete files from storage
      if (challenge.imagePath) {
        await deleteChallengeFile(challenge.imagePath);
      }
      if (challenge.attachmentPath) {
        await deleteChallengeFile(challenge.attachmentPath);
      }
      
      // Delete challenge from Firestore
      const result = await deleteChallenge(challenge.id);
      
      if (result.success) {
        onChallengeDeleted(challenge.id);
        showToast('success', 'Challenge deleted successfully');
        onClose();
      } else {
        throw new Error(result.error || 'Failed to delete challenge');
      }
    } catch (error) {
      console.error('Error deleting challenge:', error);
      showToast('error', 'Failed to delete challenge');
    } finally {
      setLoading(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="challenge-detail-modal" onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="header-content">
            <h2>{challenge.title || 'Challenge Details'}</h2>
            <div className="header-meta">
              <span 
                className="status-badge"
                style={{ backgroundColor: getStatusColor(status) }}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </span>
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

        {/* Modal Body */}
        <div className="modal-body">
          {loading && (
            <div className="loading-overlay">
              <LoadingSpinner size="medium" />
            </div>
          )}

          {/* Image Preview */}
          {challenge.imageUrl && !isEditing && (
            <div className="image-preview">
              <img 
                src={challenge.imageUrl} 
                alt={challenge.title}
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            </div>
          )}

          {/* Challenge Details */}
          <div className="detail-section">
            {isEditing ? (
              <>
                <div className="form-group">
                  <label>Title</label>
                  <input
                    type="text"
                    name="title"
                    value={editData.title || ''}
                    onChange={handleChange}
                    className="form-input"
                    disabled={loading}
                  />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    name="description"
                    value={editData.description || ''}
                    onChange={handleChange}
                    className="form-textarea"
                    rows={4}
                    disabled={loading}
                  />
                </div>
                <div className="form-group">
                  <label>Department</label>
                  <select
                    name="department"
                    value={editData.department || ''}
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
                <div className="form-row">
                  <div className="form-group">
                    <label>Start Date</label>
                    <input
                      type="date"
                      name="startDate"
                      value={editData.startDate || ''}
                      onChange={handleChange}
                      className="form-input"
                      disabled={loading}
                    />
                  </div>
                  <div className="form-group">
                    <label>End Date</label>
                    <input
                      type="date"
                      name="endDate"
                      value={editData.endDate || ''}
                      onChange={handleChange}
                      className="form-input"
                      disabled={loading}
                      min={editData.startDate || ''}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="detail-item">
                  <span className="detail-label">Title:</span>
                  <span className="detail-value">{challenge.title || 'N/A'}</span>
                </div>
                {challenge.description && (
                  <div className="detail-item">
                    <span className="detail-label">Description:</span>
                    <span className="detail-value">{challenge.description}</span>
                  </div>
                )}
                <div className="detail-item">
                  <span className="detail-label">Department:</span>
                  <span className="detail-value">{challenge.department || 'N/A'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Start Date:</span>
                  <span className="detail-value">{formatDate(challenge.startDate)}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">End Date:</span>
                  <span className="detail-value">{formatDate(challenge.endDate)}</span>
                </div>
                {challenge.attachmentName && (
                  <div className="detail-item">
                    <span className="detail-label">Attachment:</span>
                    <span className="detail-value">
                      {challenge.attachmentName} ({formatFileSize(challenge.attachmentSize)})
                    </span>
                  </div>
                )}
                <div className="detail-item">
                  <span className="detail-label">Created:</span>
                  <span className="detail-value">{formatDate(challenge.createdAt)}</span>
                </div>
                {challenge.updatedAt && (
                  <div className="detail-item">
                    <span className="detail-label">Last Updated:</span>
                    <span className="detail-value">{formatDate(challenge.updatedAt)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          {isEditing ? (
            <>
              <button
                className="cancel-button"
                onClick={handleCancelEdit}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="save-button"
                onClick={handleSave}
                disabled={loading}
              >
                {loading ? <LoadingSpinner size="small" /> : 'Save Changes'}
              </button>
            </>
          ) : (
            <>
              <button
                className="delete-button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={loading}
              >
                Delete
              </button>
              <div className="footer-actions">
                {challenge.attachmentUrl || challenge.attachmentPath ? (
                  <button
                    className="download-button"
                    onClick={handleDownload}
                    disabled={loading}
                  >
                    📥 Download
                  </button>
                ) : null}
                <button
                  className="edit-button"
                  onClick={handleEdit}
                  disabled={loading}
                >
                  ✏️ Edit
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="confirm-modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <h3>Delete Challenge</h3>
            <p>Are you sure you want to delete "{challenge.title}"? This action cannot be undone.</p>
            <div className="confirm-actions">
              <button
                className="confirm-cancel"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="confirm-delete"
                onClick={handleDelete}
                disabled={loading}
              >
                {loading ? <LoadingSpinner size="small" /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChallengeDetailModal;

