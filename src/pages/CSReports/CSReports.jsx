import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import DateFilter from './components/DateFilter/DateFilter';
import ReportTable from './components/ReportTable/ReportTable';
import LoadingSpinner from '../../components/Common/Loading/LoadingSpinner';
import Toast from '../../components/Common/Toast/Toast';
import { useCSReports } from './hooks/useCSReports';
import './CSReports.css';

const CSReports = () => {
  const { userData } = useAuth();

  const {
    reports,
    filteredReports,
    loading,
    error,
    selectedReportType,
    selectedDate,
    analysisData,
    showAnalysis,
    selectedReport,
    availableDates,
    hasReports,
    hasFilteredReports,
    handleReportTypeSelect,
    handleDateSelect,
    handleDownload,
    handleDownloadAll,
    handleViewAnalysis,
    clearFilters,
    setShowAnalysis,
    setSelectedReport
  } = useCSReports('CS');

  const [toast, setToast] = useState(null);
  const [activeButton, setActiveButton] = useState('MANAGEMENT');

  const reportTypes = ['MANAGEMENT', 'CRM', 'CALL CENTER', 'MTD', 'DEPARTMENTAL'];

  const handleReportButtonClick = (type) => {
    setActiveButton(type);
    handleReportTypeSelect(type);
  };

  const handleAnalysisClick = () => {
    if (selectedReportType) {
      setToast({ 
        type: 'info', 
        message: `Analysis for ${selectedReportType} will be available soon.`
      });
    } else {
      setToast({ 
        type: 'warning', 
        message: 'Please select a report type first.' 
      });
    }
  };

  useEffect(() => {
    if (error) {
      setToast({ type: 'error', message: error });
      setTimeout(() => setToast(null), 5000);
    }
  }, [error]);

  // Set MANAGEMENT as default on mount
  useEffect(() => {
    if (!selectedReportType) {
      handleReportTypeSelect('MANAGEMENT');
      setActiveButton('MANAGEMENT');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  return (
    <div className="cs-reports-page compact">

      {/* ===== REPORT TYPE BUTTONS ===== */}
      <div className="reports-buttons compact">
        {reportTypes.map(type => (
          <button
            key={type}
            className={`report-button ${activeButton === type ? 'active' : ''}`}
            onClick={() => handleReportButtonClick(type)}
            disabled={loading}
          >
            {type}
          </button>
        ))}
      </div>

      {/* ===== TOP ACTION BAR ===== */}
      <div className="top-action-bar">
        <div className="left-section">
          <DateFilter
            dates={availableDates}
            selectedDate={selectedDate}
            onDateSelect={handleDateSelect}
            onClear={clearFilters}
            disabled={!hasReports}
          />
        </div>
        
        <div className="right-section">
          <button
            className="action-icon"
            title="View Analysis"
            onClick={handleAnalysisClick}
            disabled={!selectedReportType}
          >
            📈
          </button>
          
          <button
            className="action-icon"
            title="Download Single Report"
            onClick={() => {
              if (selectedReport) {
                handleDownload(selectedReport);
              } else {
                setToast({ 
                  type: 'warning', 
                  message: 'Please select a report first.' 
                });
              }
            }}
            disabled={!hasReports}
          >
            📥
          </button>
          
          <button
            className="action-icon"
            title="Download All Reports"
            onClick={handleDownloadAll}
            disabled={!hasReports}
          >
            🗂️
          </button>
        </div>
      </div>

      {/* ===== CONTENT ===== */}
      <div className="reports-content">
        {loading ? (
          <LoadingSpinner size="medium" />
        ) : !selectedReportType ? (
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <p>Select a report type to view reports</p>
          </div>
        ) : !hasReports ? (
          <div className="empty-state">
            <div className="empty-icon">📁</div>
            <p>No reports available for {selectedReportType}</p>
          </div>
        ) : (
          <>
            <ReportTable
              reports={filteredReports}
              onDownload={handleDownload}
              onViewAnalysis={handleViewAnalysis}
              selectedDate={selectedDate}
              selectedReport={selectedReport}
              onReportSelect={setSelectedReport}
            />

            {selectedDate && !hasFilteredReports && (
              <div className="no-results-message">
                No reports found for the selected date.
              </div>
            )}
          </>
        )}
      </div>

      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};

export default CSReports;