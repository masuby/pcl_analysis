import { useState } from 'react';
import { useMTDData } from '../../hooks/useMTDData';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';
import MTDAnalysis from '../MTDAnalysis/MTDAnalysis';
import './MTDDepartment.css';

/**
 * One department's MTD view: a report-date picker plus the analysis.
 *
 * CS, LBF, SME and AGRI all read the same MTD workbook shape, so they share
 * this component rather than each keeping a copy that drifts. `label` is the
 * name shown to the reader when it should differ from the department code.
 */
const MTDDepartment = ({ department, label }) => {
  const [selectedDate, setSelectedDate] = useState(null);
  const { reports, parsedData, loading, error, hasData } = useMTDData(department, selectedDate);
  const name = label || department;

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
        <h2>No {name} MTD Reports Found</h2>
        <p className="mtd-empty-sub">
          Upload {name} MTD reports in the Administration page to see analysis.
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

  const formatDate = (d) => (d instanceof Date ? d : new Date(d)).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

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
            {name} MTD - {formatDate(parsedData.reportDate)}
          </span>
        </div>
      )}

      {parsedData && (
        <MTDAnalysis
          parsedData={parsedData}
          department={department}
        />
      )}
    </div>
  );
};

export default MTDDepartment;
