import React, { useState } from 'react';
import { useCallCenterData } from '../../hooks/useCallCenterData';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';
import CallCenterAnalysis from '../CallCenterAnalysis/CallCenterAnalysis';
import './CSCallCenter.css';

const CSCallCenter = () => {
  const [selectedDate, setSelectedDate] = useState(null);
  const { reports, parsedData, loading, error, hasData } = useCallCenterData('CS', selectedDate);

  if (loading) {
    return (
      <div className="call-center-loading-container">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="call-center-error-state">
        <div className="error-icon">⚠️</div>
        <h3>Error Loading Data</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="call-center-coming-soon">
        <div className="coming-soon-icon">📞</div>
        <h2>Call Center Analysis for CS is coming soon</h2>
        <p className="coming-soon-subtext">
          We're working on bringing you comprehensive call center analytics for the CS department.
          Check back soon!
        </p>
      </div>
    );
  }

  // Get available dates from reports
  const availableDates = reports.map(r => {
    const date = r.date instanceof Date ? r.date : new Date(r.date);
    return {
      value: date.toISOString().split('T')[0],
      label: date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      dateObj: date
    };
  }).sort((a, b) => b.dateObj - a.dateObj);

  const handleDateChange = (e) => {
    const dateValue = e.target.value;
    if (dateValue) {
      setSelectedDate(new Date(dateValue));
    } else {
      setSelectedDate(null);
    }
  };

  return (
    <div className="call-center-department-view">
      {parsedData && (
        <div className="report-date-header">
          <div className="date-selector-container">
            <select
              id="date-selector-cs-cc"
              className="date-selector"
              value={selectedDate ? selectedDate.toISOString().split('T')[0] : ''}
              onChange={handleDateChange}
            >
              <option value="">📅 Latest Report</option>
              {availableDates.map((dateOption, idx) => (
                <option key={idx} value={dateOption.value}>
                  {dateOption.label}
                </option>
              ))}
            </select>
          </div>
          <span className="report-date-text">
            📅 Report Date: {parsedData.reportDate instanceof Date
              ? parsedData.reportDate.toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })
              : new Date(parsedData.reportDate).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
          </span>
        </div>
      )}
      
      {parsedData && (
        <CallCenterAnalysis 
          parsedData={parsedData}
          department="CS"
        />
      )}
    </div>
  );
};

export default CSCallCenter;

