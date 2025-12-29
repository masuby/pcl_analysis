import React from 'react';
import './CustomButton.css';

const CustomButton = ({ children, onClick, type = 'button', variant = 'primary', disabled = false }) => {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`custom-button ${variant}`}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

export default CustomButton;