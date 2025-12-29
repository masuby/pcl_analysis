import React from 'react';
import './LoadingSpinner.css';

const LoadingSpinner = ({ size = 'medium', message = 'Please Wait...' }) => {
  const sizeClass = `spinner-${size}`;
  
  return (
    <div className={`loading-spinner battery-loading-spinner ${sizeClass}`}>
      <p className="loading-message">{message}</p>
    </div>
  );
};

export default LoadingSpinner;