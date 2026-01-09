import React, { useState, useRef, useEffect } from 'react';
import './ReportTypeSelector.css';

const ReportTypeSelector = ({ 
  selectedType, 
  selectedDepartment,
  onTypeChange, 
  onDepartmentChange,
  userData 
}) => {
  // Create a wrapper function that handles the preserveDepartment parameter
  const handleTypeChange = (type, preserveDepartment = false) => {
    onTypeChange(type, preserveDepartment);
  };
  const [hoveredButton, setHoveredButton] = useState(null);
  const [showDepartmentMenu, setShowDepartmentMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isMenuHovered, setIsMenuHovered] = useState(false);
  const reportTypes = ['MANAGEMENT', 'CRM', 'CALL CENTER', 'MTD', 'DEPARTMENTAL', 'CHALLENGE'];
  const departments = ['CS', 'LBF', 'SME']; // Removed 'ALL' as it has no pages to render
  const containerRef = useRef(null);
  const buttonRefs = useRef({});
  const menuRef = useRef(null);
  const hoverTimeoutRef = useRef(null);

  const isAdmin = userData?.role === 'admin' || userData?.role === 'ALL';
  
  // Get available departments for Challenge based on user role
  const getChallengeDepartments = () => {
    if (isAdmin) {
      return ['CS', 'LBF', 'SME', 'ALL'];
    }
    // Normal user: show their role + ALL (if challenge was marked ALL on server)
    const userDept = userData?.department?.toUpperCase() || userData?.role?.toUpperCase();
    if (userData?.challenge === 'ALL' || userData?.role === 'ALL') {
      return [userDept, 'ALL'];
    }
    return [userDept];
  };

  const handleButtonClick = (type) => {
    handleTypeChange(type);
    setShowDepartmentMenu(false);
    setHoveredButton(null);
  };

  const handleButtonHover = (type, event) => {
    // Clear any existing timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    // Show menu for CHALLENGE and other non-MANAGEMENT types
    if (type !== 'MANAGEMENT' && (isAdmin || type === 'CHALLENGE')) {
      const button = buttonRefs.current[type];
      if (button) {
        const rect = button.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();
        
        setHoveredButton(type);
        
        // Set menu position with offset for better access
        setMenuPosition({
          x: rect.left - containerRect.left + rect.width / 2,
          y: rect.bottom - containerRect.top + 5 // Add 5px gap
        });
        
        // Show menu immediately
        setShowDepartmentMenu(true);
      }
    }
  };

  const handleButtonLeave = () => {
    // Delay hiding menu to allow user to move to it
    hoverTimeoutRef.current = setTimeout(() => {
      if (!isMenuHovered) {
        setShowDepartmentMenu(false);
        setHoveredButton(null);
      }
    }, 200); // 200ms delay
  };

  const handleMenuEnter = () => {
    // Clear the hide timeout when entering menu
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setIsMenuHovered(true);
  };

  const handleMenuLeave = () => {
    setIsMenuHovered(false);
    // Hide menu after leaving
    hoverTimeoutRef.current = setTimeout(() => {
      setShowDepartmentMenu(false);
      setHoveredButton(null);
    }, 150);
  };

  const handleDepartmentSelect = (dept) => {
    // If we're not currently on the hovered report type, switch to it
    // and set the department at the same time to avoid reset
    if (hoveredButton && hoveredButton !== selectedType) {
      // Set department first, then change type with preserveDepartment flag
      onDepartmentChange(dept);
      // Pass true to preserveDepartment to prevent reset
      handleTypeChange(hoveredButton, true);
    } else {
      // Just update the department if we're already on the right type
      onDepartmentChange(dept);
    }
    
    // Close the menu
    setShowDepartmentMenu(false);
    setHoveredButton(null);
  };

  useEffect(() => {
    return () => {
      // Cleanup timeouts on unmount
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        // Check if click is not on any of the report type buttons
        const isButtonClick = Array.from(document.querySelectorAll('.selector-button')).some(
          button => button.contains(event.target)
        );
        
        if (!isButtonClick) {
          setShowDepartmentMenu(false);
          setHoveredButton(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="report-type-selector-container" ref={containerRef}>
      <div className="selector-scroll-wrapper">
        <div className="selector-buttons">
          {reportTypes.map((type, index) => (
            <React.Fragment key={type}>
              <button
                ref={el => buttonRefs.current[type] = el}
                className={`selector-button ${selectedType === type ? 'active' : ''} ${
                  hoveredButton === type && ((isAdmin && type !== 'MANAGEMENT') || type === 'CHALLENGE') ? 'hovered' : ''
                }`}
                onClick={() => handleButtonClick(type)}
                onMouseEnter={(e) => handleButtonHover(type, e)}
                onMouseLeave={handleButtonLeave}
                data-type={type}
              >
                <span className="button-text">{type}</span>
                {selectedType === type && selectedDepartment !== 'ALL' && type !== 'MANAGEMENT' && (
                  <span className="department-indicator">{selectedDepartment}</span>
                )}
                {((isAdmin && type !== 'MANAGEMENT') || type === 'CHALLENGE') && showDepartmentMenu && hoveredButton === type && (
                  <div className="hover-indicator"></div>
                )}
              </button>
              {index < reportTypes.length - 1 && (
                <div className="button-divider"></div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {showDepartmentMenu && hoveredButton && ((isAdmin && hoveredButton !== 'MANAGEMENT') || hoveredButton === 'CHALLENGE') && (
        <div 
          className="department-menu"
          ref={menuRef}
          style={{
            left: `${menuPosition.x}px`,
            top: `${menuPosition.y}px`,
            transform: 'translateX(-50%)'
          }}
          onMouseEnter={handleMenuEnter}
          onMouseLeave={handleMenuLeave}
        >
          <div className="dashboard-menu-header">
            <span className="menu-report-type">{hoveredButton}</span>
          </div>
          <div className="department-options">
            {(hoveredButton === 'CHALLENGE' ? getChallengeDepartments() : departments).map(dept => (
              <button
                key={dept}
                className={`department-option ${selectedDepartment === dept && selectedType === hoveredButton ? 'selected' : ''}`}
                onClick={() => handleDepartmentSelect(dept)}
              >
                <span className="department-name">{dept}</span>
                <span className="department-actions">
                  {dept === (userData?.department || 'ALL') && hoveredButton !== 'CHALLENGE' && (
                    <span className="default-badge">Your Dept</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportTypeSelector;