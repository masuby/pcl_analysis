import React, { useState, useRef } from 'react';
import { createChallenge } from '../../../../services/challenges';
import { uploadChallengeImage, uploadChallengeAttachment, getChallengeImageUrl, getChallengeAttachmentUrl } from '../../../../services/supabase';
import LoadingSpinner from '../../../Common/Loading/LoadingSpinner';
import UploadProgress from '../../ReportManagement/UploadProgress/UploadProgress';
import './AddChallengeModal.css';

const AddChallengeModal = ({ onClose, onChallengeAdded, showToast }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    department: 'CS',
    image: null,
    attachment: null
  });
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errors, setErrors] = useState({});
  const imageInputRef = useRef(null);
  const attachmentInputRef = useRef(null);

  const departments = [
    { value: 'CS', label: 'Civil Servant' },
    { value: 'LBF', label: 'Log Book Finance' },
    { value: 'SME', label: 'Small & Medium Enterprise' },
    { value: 'ALL', label: 'All Departments' }
  ];

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    }
    
    if (!formData.startDate) {
      newErrors.startDate = 'Start date is required';
    }
    
    if (!formData.endDate) {
      newErrors.endDate = 'End date is required';
    } else if (formData.startDate && new Date(formData.endDate) < new Date(formData.startDate)) {
      newErrors.endDate = 'End date must be after start date';
    }
    
    if (!formData.department) {
      newErrors.department = 'Department is required';
    }
    
    if (!formData.attachment) {
      newErrors.attachment = 'Attachment is required';
    } else {
      const allowedTypes = [
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ];
      
      if (!allowedTypes.includes(formData.attachment.type)) {
        newErrors.attachment = 'Please upload a valid file (PDF, Excel, Word, PowerPoint)';
      }
      
      if (formData.attachment.size > 50 * 1024 * 1024) { // 50MB limit
        newErrors.attachment = 'File size must be less than 50MB';
      }
    }
    
    if (formData.image) {
      const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedImageTypes.includes(formData.image.type)) {
        newErrors.image = 'Please upload a valid image (JPEG, PNG, GIF, WebP)';
      }
      
      if (formData.image.size > 10 * 1024 * 1024) { // 10MB limit for images
        newErrors.image = 'Image size must be less than 10MB';
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
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFormData(prev => ({
        ...prev,
        image: file
      }));
      
      if (errors.image) {
        setErrors(prev => ({
          ...prev,
          image: ''
        }));
      }
    }
  };

  const handleAttachmentChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFormData(prev => ({
        ...prev,
        attachment: file
      }));
      
      if (errors.attachment) {
        setErrors(prev => ({
          ...prev,
          attachment: ''
        }));
      }
    }
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

      let imagePath = null;
      let imageUrl = null;
      let attachmentPath = null;
      let attachmentUrl = null;

      // Upload image if provided
      if (formData.image) {
        const imageUploadResult = await uploadChallengeImage(formData.image, formData.department);
        if (!imageUploadResult.success) {
          throw new Error(imageUploadResult.error || 'Image upload failed');
        }
        imagePath = imageUploadResult.filePath;
        imageUrl = await getChallengeImageUrl(imagePath);
      }

      // Upload attachment
      const attachmentUploadResult = await uploadChallengeAttachment(formData.attachment, formData.department);
      if (!attachmentUploadResult.success) {
        throw new Error(attachmentUploadResult.error || 'Attachment upload failed');
      }
      attachmentPath = attachmentUploadResult.filePath;
      attachmentUrl = await getChallengeAttachmentUrl(attachmentPath);

      clearInterval(progressInterval);
      setUploadProgress(100);

      // Create challenge record in Firestore
      const challengeData = {
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        startDate: new Date(formData.startDate).toISOString(),
        endDate: new Date(formData.endDate).toISOString(),
        department: formData.department,
        imagePath: imagePath,
        imageUrl: imageUrl,
        attachmentPath: attachmentPath,
        attachmentUrl: attachmentUrl,
        attachmentName: formData.attachment.name,
        attachmentSize: formData.attachment.size,
        attachmentType: formData.attachment.type,
        uploader: 'Admin', // TODO: Get from auth context
        isActive: true
      };

      const challengeResult = await createChallenge(challengeData);
      
      if (challengeResult.success) {
        onChallengeAdded(challengeResult.data);
        onClose();
        showToast('success', 'Challenge created successfully');
      } else {
        throw new Error(challengeResult.error || 'Failed to create challenge record');
      }
    } catch (error) {
      console.error('Error creating challenge:', error);
      showToast('error', `Creation failed: ${error.message}`);
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e, type) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (type === 'image') {
        setFormData(prev => ({ ...prev, image: file }));
        if (errors.image) {
          setErrors(prev => ({ ...prev, image: '' }));
        }
      } else if (type === 'attachment') {
        setFormData(prev => ({ ...prev, attachment: file }));
        if (errors.attachment) {
          setErrors(prev => ({ ...prev, attachment: '' }));
        }
      }
    }
  };

  const getFileIcon = (file) => {
    if (!file) return '📎';
    
    const type = file.type;
    if (type === 'application/pdf') return '📄';
    if (type.includes('excel') || type.includes('spreadsheet')) return '📊';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('powerpoint') || type.includes('presentation')) return '📽️';
    if (type.startsWith('image/')) return '🖼️';
    return '📎';
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="add-challenge-modal" onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="header-content">
            <h2>Create New Challenge</h2>
            <p className="modal-subtitle">Add a new motivational challenge</p>
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

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="modal-body" noValidate>
          {/* Title */}
          <div className="form-group">
            <label htmlFor="title" className="form-label">
              <span className="label-text">Title of the Challenge</span>
              <span className="required-asterisk">*</span>
            </label>
            <div className="input-wrapper">
              <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                className={`form-input ${errors.title ? 'error' : ''}`}
                placeholder="Enter challenge title"
                disabled={loading}
              />
            </div>
            {errors.title && (
              <span className="error-message">{errors.title}</span>
            )}
          </div>

          {/* Description */}
          <div className="form-group">
            <label htmlFor="description" className="form-label">
              <span className="label-text">Description</span>
              <span className="optional-label">(Optional)</span>
            </label>
            <div className="input-wrapper">
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                className="form-textarea"
                placeholder="Enter challenge description"
                rows={4}
                disabled={loading}
              />
            </div>
          </div>

          {/* Start Date */}
          <div className="form-group">
            <label htmlFor="startDate" className="form-label">
              <span className="label-text">Start Date</span>
              <span className="required-asterisk">*</span>
            </label>
            <div className="input-wrapper">
              <input
                type="date"
                id="startDate"
                name="startDate"
                value={formData.startDate}
                onChange={handleChange}
                className={`form-input ${errors.startDate ? 'error' : ''}`}
                disabled={loading}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            {errors.startDate && (
              <span className="error-message">{errors.startDate}</span>
            )}
          </div>

          {/* End Date */}
          <div className="form-group">
            <label htmlFor="endDate" className="form-label">
              <span className="label-text">End Date</span>
              <span className="required-asterisk">*</span>
            </label>
            <div className="input-wrapper">
              <input
                type="date"
                id="endDate"
                name="endDate"
                value={formData.endDate}
                onChange={handleChange}
                className={`form-input ${errors.endDate ? 'error' : ''}`}
                disabled={loading}
                min={formData.startDate || new Date().toISOString().split('T')[0]}
              />
            </div>
            {errors.endDate && (
              <span className="error-message">{errors.endDate}</span>
            )}
          </div>

          {/* Upload To (Department) */}
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
                className={`form-select ${errors.department ? 'error' : ''}`}
                disabled={loading}
              >
                {departments.map(dept => (
                  <option key={dept.value} value={dept.value}>
                    {dept.label}
                  </option>
                ))}
              </select>
            </div>
            {errors.department && (
              <span className="error-message">{errors.department}</span>
            )}
            {formData.department === 'ALL' && (
              <div className="info-note">
                Note: This challenge will be available for ALL departments
              </div>
            )}
          </div>

          {/* Image Upload */}
          <div className="form-group">
            <label className="form-label">
              <span className="label-text">Choose Image</span>
              <span className="optional-label">(Optional)</span>
            </label>
            
            <div 
              className={`file-upload-area ${errors.image ? 'error' : ''} ${formData.image ? 'has-file' : ''}`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'image')}
              onClick={() => !loading && imageInputRef.current?.click()}
            >
              <input
                type="file"
                ref={imageInputRef}
                onChange={handleImageChange}
                className="file-input"
                accept="image/*"
                disabled={loading}
              />
              
              {formData.image ? (
                <div className="file-preview">
                  <div className="file-icon-large">
                    {getFileIcon(formData.image)}
                  </div>
                  <div className="file-info">
                    <div className="file-name">{formData.image.name}</div>
                    <div className="file-size">
                      {(formData.image.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                    <button 
                      type="button"
                      className="remove-file"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFormData(prev => ({ ...prev, image: null }));
                        if (imageInputRef.current) {
                          imageInputRef.current.value = '';
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
                  <div className="upload-icon">🖼️</div>
                  <div className="upload-text">
                    <p className="upload-title">Click to upload or drag and drop</p>
                    <p className="upload-subtitle">
                      Image files (JPEG, PNG, GIF, WebP - Max 10MB)
                    </p>
                  </div>
                </div>
              )}
            </div>
            
            {errors.image && (
              <span className="error-message">{errors.image}</span>
            )}
          </div>

          {/* Attachment Upload */}
          <div className="form-group">
            <label className="form-label">
              <span className="label-text">Attachment</span>
              <span className="required-asterisk">*</span>
            </label>
            
            <div 
              className={`file-upload-area ${errors.attachment ? 'error' : ''} ${formData.attachment ? 'has-file' : ''}`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, 'attachment')}
              onClick={() => !loading && attachmentInputRef.current?.click()}
            >
              <input
                type="file"
                ref={attachmentInputRef}
                onChange={handleAttachmentChange}
                className="file-input"
                accept=".pdf,.xlsx,.xls,.doc,.docx,.ppt,.pptx"
                disabled={loading}
              />
              
              {formData.attachment ? (
                <div className="file-preview">
                  <div className="file-icon-large">
                    {getFileIcon(formData.attachment)}
                  </div>
                  <div className="file-info">
                    <div className="file-name">{formData.attachment.name}</div>
                    <div className="file-size">
                      {(formData.attachment.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                    <button 
                      type="button"
                      className="remove-file"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFormData(prev => ({ ...prev, attachment: null }));
                        if (attachmentInputRef.current) {
                          attachmentInputRef.current.value = '';
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
                  <div className="upload-icon">📎</div>
                  <div className="upload-text">
                    <p className="upload-title">Click to upload or drag and drop</p>
                    <p className="upload-subtitle">
                      PDF, Excel, Word, or PowerPoint files (Max 50MB)
                    </p>
                  </div>
                </div>
              )}
            </div>
            
            {errors.attachment && (
              <span className="error-message">{errors.attachment}</span>
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
            disabled={loading || !formData.title || !formData.startDate || !formData.endDate || !formData.attachment}
          >
            {loading ? (
              <>
                <LoadingSpinner size="small" />
                Creating...
              </>
            ) : (
              'Create Challenge'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddChallengeModal;

