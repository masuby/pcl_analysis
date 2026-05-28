import { useState } from 'react';
import { useMTDData } from '../../hooks/useMTDData';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';
import MTDAnalysis from '../MTDAnalysis/MTDAnalysis';
import '../MTDCS/MTDCS.css';

const MTDSME = () => {
  const [selectedDate, setSelectedDate] = useState(null);
  const { reports, parsedData, loading, error, hasData } = useMTDData('SME', selectedDate);

  if (loading && !parsedData) {
    return (
      <div className="mtd-loading-wrap">
        <LoadingSpinner size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mtd-error-wrap">
        <div className="error-icon">⚠️</div>
        <h3>Error Loading Data</h3>
        <p>{error}</p>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="mtd-empty-wrap">
        <div className="mtd-empty-icon">📊</div>
        <h2>No SME MTD Reports Found</h2>
        <p className="mtd-empty-sub">
          Upload SME MTD reports in the Administration page to see analysis.
        </p>
      </div>
    );
  }

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
    <div className="mtd-dept-view">
      {parsedData && (
        <div className="mtd-date-header">
          <div className="mtd-date-select-wrap">
            <select
              className="mtd-date-select"
              value={selectedDate ? selectedDate.toISOString().split('T')[0] : ''}
              onChange={handleDateChange}
            >
              <option value="">Latest Report</option>
              {availableDates.map((dateOption, idx) => (
                <option key={idx} value={dateOption.value}>
                  {dateOption.label}
                </option>
              ))}
            </select>
          </div>
          <span className="mtd-date-text">
            SME MTD - {parsedData.reportDate instanceof Date
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
        <MTDAnalysis 
          parsedData={parsedData}
          department="SME"
        />
      )}
    </div>
  );
};

export default MTDSME;
