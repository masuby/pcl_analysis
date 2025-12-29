import React, { useState, useEffect } from 'react';
import ExcelViewer from '../ExcelViewer/ExcelViewer';
import './ReportTable.css';

const ReportTable = ({ reports, onDownload, onViewAnalysis, selectedDate, selectedReport: propSelectedReport, onReportSelect }) => {
  const [selectedReport, setSelectedReport] = useState(null);

  // Use prop if provided, otherwise use local state
  const currentSelectedReport = propSelectedReport || selectedReport;

  useEffect(() => {
    // Update local state when reports change and no report is selected
    if (reports.length > 0 && !currentSelectedReport) {
      // Sort by date (latest first) and select the first one
      const sortedReports = [...reports].sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
      });
      const reportToSelect = sortedReports[0];
      setSelectedReport(reportToSelect);
      if (onReportSelect) {
        onReportSelect(reportToSelect);
      }
    }
  }, [reports, currentSelectedReport, onReportSelect]);

  // Sync with prop changes
  useEffect(() => {
    if (propSelectedReport) {
      setSelectedReport(propSelectedReport);
    }
  }, [propSelectedReport]);

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (error) {
      return 'Invalid Date';
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'N/A';
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileType) => {
    const type = fileType?.toLowerCase() || '';
    if (type.includes('pdf')) return '📄';
    if (type.includes('excel') || type.includes('spreadsheet') || type.includes('xlsx') || type.includes('xls')) return '📊';
    if (type.includes('csv')) return '📋';
    if (type.includes('word') || type.includes('document')) return '📝';
    return '📎';
  };

  const getDepartmentBadge = (department) => {
    const colors = {
      CS: '#38a169',
      LBF: '#d69e2e',
      SME: '#805ad5',
      ALL: '#3182ce'
    };
    
    return (
      <span 
        className="department-badge"
        style={{ backgroundColor: colors[department] || '#666' }}
      >
        {department}
      </span>
    );
  };

  const handleDownload = (e, report) => {
    e.stopPropagation();
    if (onDownload) {
      onDownload(report);
    }
  };

  const handleReportSelect = (report) => {
    setSelectedReport(report);
    if (onReportSelect) {
      onReportSelect(report);
    }
  };

  if (reports.length === 0) {
    return (
      <div className="empty-reports">
        <div className="empty-icon">📁</div>
        <p>No reports found for the selected criteria.</p>
      </div>
    );
  }

 return (
    <div className="report-table-wrapper">
      <div className="reports-container">
        {/* Reports List Sidebar */}
        <div className="reports-list-sidebar">
          {reports.map((report) => (
            <div
              key={report.id}
              className={`report-list-item ${currentSelectedReport?.id === report.id ? 'selected' : ''}`}
              onClick={() => handleReportSelect(report)}
            >
              <div className="report-item-header">
                <span className="report-icon">
                  {getFileIcon(report.fileType || report.mimeType)}
                </span>
                <div className="report-info">
                  <div className="report-title" title={report.title}>
                    {report.title}
                  </div>
                  <div className="report-details">
                    <span className="report-date">
                      {formatDate(report.date || report.createdAt)}
                    </span>
                    <span className="report-size">
                      {formatFileSize(report.fileSize)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="report-item-actions">
                <button
                  className="action-button download"
                  onClick={(e) => handleDownload(e, report)}
                  title="Download Report"
                  aria-label="Download report"
                >
                  📥
                </button>
                {getDepartmentBadge(report.department)}
              </div>
            </div>
          ))}
        </div>

        {/* Excel Preview Area */}
        <div className="excel-preview-area">
          {currentSelectedReport ? (
            <>
              <div className="preview-header">
                <h3 className="preview-title">
                  {currentSelectedReport.title}
                  <span className="preview-subtitle">
                    {currentSelectedReport.fileName}
                  </span>
                </h3>
                <div className="preview-actions">
                  <button
                    className="preview-action-button download"
                    onClick={(e) => handleDownload(e, currentSelectedReport)}
                    title="Download"
                  >
                    📥 Download
                  </button>
                </div>
              </div>
              
              <div className="excel-viewer-container">
                <ExcelViewer
                  key={`${currentSelectedReport.id}-${currentSelectedReport.fileUrl || currentSelectedReport.filePath}`}
                  fileUrl={currentSelectedReport.fileUrl} // From Firebase
                  fileName={currentSelectedReport.fileName}
                  fileType={currentSelectedReport.fileType}
                  filePath={currentSelectedReport.filePath} // From Supabase storage
                />
              </div>
            </>
          ) : (
            <div className="no-selection">
              <div className="no-selection-icon">📋</div>
              <p>Select a report to preview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportTable;

