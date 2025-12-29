import React from 'react';
import './UploadProgress.css';

const UploadProgress = ({ progress }) => {
  return (
    <div className="upload-progress">
      <div className="progress-header">
        <span className="progress-icon">📤</span>
        <span className="progress-title">Uploading File</span>
      </div>
      <div className="progress-bar">
        <div 
          className="progress-fill"
          style={{ width: `${progress}%` }}
        ></div>
      </div>
      <div className="progress-info">
        <span className="progress-percentage">{progress}%</span>
        <span className="progress-status">
          {progress < 100 ? 'Uploading...' : 'Processing...'}
        </span>
      </div>
    </div>
  );
};

export default UploadProgress;