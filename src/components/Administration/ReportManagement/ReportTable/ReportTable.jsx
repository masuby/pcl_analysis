import React from 'react';
import { getReportFileUrl } from '../../../../services/supabase';
import './ReportTable.css';

const ReportTable = ({ reports, onReportClick }) => {
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

  const getDepartmentColor = (department) => {
    const colors = {
      CS: '#38a169',
      LBF: '#d69e2e',
      SME: '#805ad5',
      ALL: '#3182ce'
    };
    return colors[department] || '#666';
  };

  const getTypeColor = (type) => {
    const colors = {
      'CALL CENTER': '#4299e1',
      'CRM': '#ed8936',
      'DEPARTMENTAL': '#38a169',
      'MTD': '#9f7aea',
      'MANAGEMENT': '#e53e3e'
    };
    return colors[type] || '#666';
  };

  const handleDownload = async (e, report) => {
    e.stopPropagation();
    
    // Use stored fileUrl if available, otherwise generate from filePath
    if (report.fileUrl) {
      window.open(report.fileUrl, '_blank');
    } else if (report.filePath) {
      const url = getReportFileUrl(report.filePath);
      window.open(url, '_blank');
    }
  };

  return (
    <div className="report-table-wrapper">
      <div className="table-responsive">
        <table className="report-table">
          <thead>
            <tr>
              <th className="title-column">Report Title</th>
              <th className="department-column">Department</th>
              <th className="type-column">Type</th>
              <th className="date-column">Date</th>
              <th className="size-column">Size</th>
              <th className="stats-column">Stats</th>
              <th className="actions-column">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr 
                key={report.id} 
                className="report-row"
                onClick={() => onReportClick(report)}
                tabIndex={0}
                onKeyPress={(e) => e.key === 'Enter' && onReportClick(report)}
              >
                <td className="title-column">
                  <div className="report-info">
                    <div className="file-icon">
                      {report.fileType === 'pdf' ? '📄' : 
                       report.fileType === 'xlsx' || report.fileType === 'xls' ? '📊' : 
                       report.fileType === 'csv' ? '📋' : 
                       report.fileType === 'doc' || report.fileType === 'docx' ? '📝' : '📎'}
                    </div>
                    <div className="report-details">
                      <div className="report-title">
                        {report.title || 'Untitled Report'}
                      </div>
                      {report.description && (
                        <div className="report-description" title={report.description}>
                          {report.description.length > 50 
                            ? report.description.substring(0, 50) + '...' 
                            : report.description}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="department-column">
                  <span 
                    className="department-badge"
                    style={{ backgroundColor: getDepartmentColor(report.department) }}
                  >
                    {report.department}
                  </span>
                </td>
                <td className="type-column">
                  <span 
                    className="type-badge"
                    style={{ backgroundColor: getTypeColor(report.type) }}
                  >
                    {report.type}
                  </span>
                </td>
                <td className="date-column">
                  <span className="report-date">
                    {formatDate(report.date || report.createdAt)}
                  </span>
                </td>
                <td className="size-column">
                  <span className="file-size">
                    {formatFileSize(report.fileSize)}
                  </span>
                </td>
                <td className="stats-column">
                  <div className="report-stats">
                    <span className="stat-item" title="Views">
                      👁️ {report.views || 0}
                    </span>
                    <span className="stat-item" title="Downloads">
                      📥 {report.downloads || 0}
                    </span>
                  </div>
                </td>
                <td className="actions-column">
                  <div className="action-buttons">
                    <button 
                      className="download-button"
                      onClick={(e) => handleDownload(e, report)}
                      aria-label={`Download ${report.title}`}
                    >
                      📥
                    </button>
                    <button 
                      className="view-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReportClick(report);
                      }}
                      aria-label={`View details for ${report.title}`}
                    >
                      👁️
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Table Footer */}
      <div className="table-footer">
        <div className="footer-info">
          Showing <strong>{reports.length}</strong> reports
        </div>
        <div className="table-legend">
          <span className="legend-item">
            <span className="legend-dot call-center"></span> CALL CENTER
          </span>
          <span className="legend-item">
            <span className="legend-dot crm"></span> CRM
          </span>
          <span className="legend-item">
            <span className="legend-dot departmental"></span> DEPARTMENTAL
          </span>
        </div>
      </div>
    </div>
  );
};

export default ReportTable;