import React from 'react';
import './CustomDatePicker.css';

const CustomDatePicker = () => {
  return (
    <div className="date-picker">
      <input 
        type="date" 
        className="date-input"
      />
    </div>
  );
};

export default CustomDatePicker;