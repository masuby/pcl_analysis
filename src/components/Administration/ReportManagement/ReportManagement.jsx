import React, { useState, useEffect } from 'react';
import { getAllReports, searchReports } from '../../../services/reports';
import ReportTable from './ReportTable/ReportTable';
import AddReportModal from './AddReportModal/AddReportModal';
import ReportDetailModal from './ReportDetailModal/ReportDetailModal';
import Toast from '../../Common/Toast/Toast';
import LoadingSpinner from '../../Common/Loading/LoadingSpinner';
import SearchBar from '../UserManagement/SearchBar/SearchBar';
import './ReportManagement.css';

const ReportManagement = () => {
  const [reports, setReports] = useState([]);
  const [filteredReports, setFilteredReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [toast, setToast] = useState(null);
  const [viewMode, setViewMode] = useState('all'); // 'all', 'recent', 'department'
  const [showAllReports, setShowAllReports] = useState(false);

  // Fetch reports
  useEffect(() => {
    fetchReports();
  }, [viewMode]);

  // Filter reports based on search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredReports(getDisplayReports());
      return;
    }

    const filterReports = async () => {
      const result = await searchReports(searchTerm);
      if (result.success) {
        setFilteredReports(result.data);
      } else {
        setFilteredReports([]);
      }
    };

    filterReports();
  }, [searchTerm, reports, viewMode, showAllReports]);

  const fetchReports = async () => {
    try {
      setLoading(true);
      const result = await getAllReports();
      
      if (result.success) {
        setReports(result.data);
        setFilteredReports(getDisplayReports(result.data));
      } else {
        showToast('error', 'Failed to load reports');
      }
    } catch (error) {
      console.error('Error fetching reports:', error);
      showToast('error', 'Error loading reports');
    } finally {
      setLoading(false);
    }
  };

  const getDisplayReports = (reportList = reports) => {
    if (viewMode === 'recent' && !showAllReports) {
      return reportList.slice(0, 3);
    }
    return reportList;
  };

  const handleSearch = (term) => {
    setSearchTerm(term);
  };

  const handleAddReport = () => {
    setShowAddModal(true);
  };

  const handleReportAdded = (newReport) => {
    setReports([newReport, ...reports]);
    setFilteredReports([newReport, ...filteredReports]);
    showToast('success', 'Report uploaded successfully');
  };

  const handleReportUpdated = (updatedReport) => {
    const updatedReports = reports.map(report => 
      report.id === updatedReport.id ? updatedReport : report
    );
    setReports(updatedReports);
    setFilteredReports(updatedReports);
    showToast('success', 'Report updated successfully');
  };

  const handleReportDeleted = (reportId) => {
    const updatedReports = reports.filter(report => report.id !== reportId);
    setReports(updatedReports);
    setFilteredReports(updatedReports);
    showToast('success', 'Report deleted successfully');
  };

  const handleReportClick = (report) => {
    setSelectedReport(report);
  };

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  };

  const getStats = () => {
    const totalReports = reports.length;
    const activeReports = reports.filter(r => r.isActive).length;
    const totalViews = reports.reduce((sum, r) => sum + (r.views || 0), 0);
    const totalDownloads = reports.reduce((sum, r) => sum + (r.downloads || 0), 0);

    return { totalReports, activeReports, totalViews, totalDownloads };
  };

  const stats = getStats();

  return (
    <div className="report-management">
      {/* Header with Stats */}
      <div className="report-header">
        <div className="header-left">
          <h2>Report Management</h2>
          <p className="report-subtitle">Upload and manage reports in the system</p>
        </div>
        <div className="header-right">
          <button 
            className="add-report-button"
            onClick={handleAddReport}
            aria-label="Upload new report"
          >
            <span className="button-icon">📤</span>
            <span className="button-text">Upload Report</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats-cards">
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalReports}</div>
            <div className="stat-label">Total Reports</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.activeReports}</div>
            <div className="stat-label">Active</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">👁️</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalViews}</div>
            <div className="stat-label">Total Views</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📥</div>
          <div className="stat-content">
            <div className="stat-value">{stats.totalDownloads}</div>
            <div className="stat-label">Downloads</div>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="report-controls">
        <div className="view-toggles">
          <button 
            className={`view-toggle ${viewMode === 'all' ? 'active' : ''}`}
            onClick={() => setViewMode('all')}
          >
            All Reports
          </button>
          <button 
            className={`view-toggle ${viewMode === 'recent' ? 'active' : ''}`}
            onClick={() => setViewMode('recent')}
          >
            Recent
          </button>
        </div>
        
        <div className="search-section">
          <SearchBar 
            onSearch={handleSearch}
            placeholder="Search reports by title, department, or type..."
          />
          <div className="search-info">
            {searchTerm && (
              <span className="search-results">
                Found {filteredReports.length} results for "{searchTerm}"
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Reports Table */}
      <div className="report-table-container">
        {loading ? (
          <div className="loading-container">
            <LoadingSpinner size="large" />
            <p>Loading reports...</p>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📂</div>
            <h3>No reports found</h3>
            <p>
              {searchTerm 
                ? 'No reports match your search. Try a different term.'
                : 'No reports in the system yet. Upload your first report!'
              }
            </p>
            {!searchTerm && (
              <button 
                className="empty-action-button"
                onClick={handleAddReport}
              >
                Upload First Report
              </button>
            )}
          </div>
        ) : (
          <>
            <ReportTable 
              reports={filteredReports}
              onReportClick={handleReportClick}
            />
            
            {viewMode === 'recent' && !showAllReports && reports.length > 3 && (
              <div className="view-more-section">
                <button 
                  className="view-more-button"
                  onClick={() => setShowAllReports(true)}
                >
                  View All Reports ({reports.length})
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Add Report Modal */}
      {showAddModal && (
        <AddReportModal
          onClose={() => setShowAddModal(false)}
          onReportAdded={handleReportAdded}
          showToast={showToast}
        />
      )}

      {/* Report Detail Modal */}
      {selectedReport && (
        <ReportDetailModal
          report={selectedReport}
          onClose={() => setSelectedReport(null)}
          onReportUpdated={handleReportUpdated}
          onReportDeleted={handleReportDeleted}
          showToast={showToast}
        />
      )}

      {/* Toast Notification */}
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

export default ReportManagement;