import React, { useState } from 'react';
import { useCRMData } from '../../hooks/useCRMData';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';
import CRMAnalysis from '../CRMAnalysis/CRMAnalysis';
import './CRMLBF.css';

const CRMLBF = () => {
  const [selectedDate, setSelectedDate] = useState(null);
  const { reports, parsedData, loading, error, hasData } = useCRMData('LBF', selectedDate);

  if (loading) {
    return (
      <div className="crm-loading-container">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="crm-error-state">
        <div className="error-icon">⚠️</div>
        <h3>Error Loading Data</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="crm-coming-soon">
        <div className="coming-soon-icon">📊</div>
        <h2>CRM Analysis for LBF is coming soon</h2>
        <p className="coming-soon-subtext">
          We're working on bringing you comprehensive CRM analytics for the LBF department.
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
    <div className="crm-department-view">
      {parsedData && (
        <div className="report-date-header">
          <div className="date-selector-container">
            <select
              id="date-selector-lbf"
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
            {parsedData.reportDate instanceof Date
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
        <CRMAnalysis 
          parsedData={parsedData}
          department="LBF"
        />
      )}
    </div>
  );
};

export default CRMLBF;

