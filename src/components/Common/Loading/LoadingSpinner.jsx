import React from 'react';
import './LoadingSpinner.css';

const LoadingSpinner = ({ size = 'medium', message = 'Loading...' }) => {
  const sizeClass = `spinner-${size}`;
  
  return (
    <div className={`loading-spinner battery-loading-spinner ${sizeClass}`}>
      <div className="loading-bars-container">
        <div className="loading-bars">
          <div className="loading-bar bar-1"></div>
          <div className="loading-bar bar-2"></div>
          <div className="loading-bar bar-3"></div>
          <div className="loading-bar bar-4"></div>
          <div className="loading-bar bar-5"></div>
        </div>
        <div className="loading-text">{message}</div>
      </div>
    </div>
  );
};

export default LoadingSpinner;
