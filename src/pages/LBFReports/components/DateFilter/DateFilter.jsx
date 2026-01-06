import React, { useRef, useEffect } from 'react';
import { useDateFilter } from '../../hooks/useDateFilter';
import './DateFilter.css';

const DateFilter = ({ dates, selectedDate, onDateSelect, onClear, disabled = false }) => {
  const dropdownRef = useRef(null);
  const { 
    filteredDates, 
    searchTerm, 
    isOpen, 
    handleSearch, 
    toggleDropdown, 
    closeDropdown 
  } = useDateFilter(dates);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        closeDropdown();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeDropdown]);

  const formatDateForDisplay = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const handleDateClick = (date) => {
    onDateSelect(date);
    closeDropdown();
  };

  const handleClear = () => {
    onClear();
    closeDropdown();
  };

  return (
    <div className="date-filter compact" ref={dropdownRef}>
      <div className="date-filter-header compact">
        <button
          className={`date-filter-toggle compact ${selectedDate ? 'has-selection' : ''}`}
          onClick={toggleDropdown}
          disabled={disabled || dates.length === 0}
          aria-label={selectedDate ? `Filtered by ${formatDateForDisplay(selectedDate)}` : 'Select date'}
        >
          <span className="filter-icon compact">📅</span>
          <span className="filter-text compact">
            {selectedDate ? formatDateForDisplay(selectedDate) : 'Select Date'}
          </span>
          <span className={`dropdown-arrow compact ${isOpen ? 'open' : ''}`}>▼</span>
        </button>
        
        {selectedDate && (
          <button
            className="clear-filter-button compact"
            onClick={handleClear}
            aria-label="Clear date filter"
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && (
        <div className="date-filter-dropdown compact">
          <div className="dropdown-search compact">
            <div className="search-icon compact">🔍</div>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search dates..."
              className="search-input compact"
              autoFocus
            />
            {searchTerm && (
              <button
                className="clear-search compact"
                onClick={() => handleSearch('')}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="dropdown-content compact">
            {filteredDates.length === 0 ? (
              <div className="no-results compact">
                <p>No dates found</p>
              </div>
            ) : (
              <div className="dates-list compact">
                {filteredDates.map((date) => (
                  <button
                    key={date}
                    className={`date-item compact ${selectedDate === date ? 'selected' : ''}`}
                    onClick={() => handleDateClick(date)}
                    aria-label={`Select ${formatDateForDisplay(date)}`}
                  >
                    <span className="date-icon compact">
                      {selectedDate === date ? '✅' : '📅'}
                    </span>
                    <span className="date-text compact">
                      {formatDateForDisplay(date)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="dropdown-footer compact">
              <div className="dates-count compact">
                {filteredDates.length} dates
              </div>
              <button
                className="reset-all-button compact"
                onClick={handleClear}
                disabled={!selectedDate}
              >
                Clear Filter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DateFilter;







