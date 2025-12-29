import React from 'react';
import './DepartmentFilter.css';

const DepartmentFilter = ({ departments, selectedDepartment, onDepartmentChange, userDepartment }) => {
  const handleDepartmentChange = (e) => {
    onDepartmentChange(e.target.value);
  };

  return (
    <div className="department-filter">
      <select 
        className="department-select"
        value={selectedDepartment}
        onChange={handleDepartmentChange}
        title="Select Department"
      >
        {departments.map((dept) => (
          <option key={dept} value={dept}>
            {dept}
          </option>
        ))}
      </select>
    </div>
  );
};

export default DepartmentFilter;