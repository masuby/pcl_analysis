import { useState, useEffect, useRef } from 'react';
import { getAllReports, searchReports } from '../../../services/reports';
import { proceduresAPI, adminAPI } from '../../../services/api';
import { useReportRefresh } from '../../../contexts/ReportRefreshContext';
import ReportTable from './ReportTable/ReportTable';
import AddReportModal from './AddReportModal/AddReportModal';
import ReportDetailModal from './ReportDetailModal/ReportDetailModal';
import ProcedureEditor from './Procedures/ProcedureEditor';
import ProcedureViewer from './Procedures/ProcedureViewer';
import Toast from '../../Common/Toast/Toast';
import LoadingSpinner from '../../Common/Loading/LoadingSpinner';
import SearchBar from '../UserManagement/SearchBar/SearchBar';
import './ReportManagement.css';

const ReportManagement = () => {
  const { triggerRefresh } = useReportRefresh();
  const [reports, setReports] = useState([]);
  const [filteredReports, setFilteredReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [toast, setToast] = useState(null);
  const [viewMode, setViewMode] = useState('all'); // 'all', 'recent', 'department'
  const [showAllReports, setShowAllReports] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const reportsPerPage = 15;
  
  // Procedures view state
  const [activeView, setActiveView] = useState('reports'); // 'reports' or 'procedures'
  const [selectedProcedureType, setSelectedProcedureType] = useState(null);
  const [selectedProcedureDepartment, setSelectedProcedureDepartment] = useState(null);
  
  // Set MANAGEMENT as default when switching to Procedures view
  useEffect(() => {
    if (activeView === 'procedures' && !selectedProcedureType) {
      setSelectedProcedureType('MANAGEMENT');
      setSelectedProcedureDepartment(null);
    }
  }, [activeView]);
  const [hoveredProcedureButton, setHoveredProcedureButton] = useState(null);
  const [showProcedureDepartmentMenu, setShowProcedureDepartmentMenu] = useState(false);
  const [procedureMenuPosition, setProcedureMenuPosition] = useState({ x: 0, y: 0 });
  const [isProcedureMenuHovered, setIsProcedureMenuHovered] = useState(false);
  const procedureButtonRefs = useRef({});
  const procedureMenuRef = useRef(null);
  const procedureHoverTimeoutRef = useRef(null);
  const procedureContainerRef = useRef(null);
  
  // Procedure data state
  const [currentProcedure, setCurrentProcedure] = useState(null);
  const [loadingProcedure, setLoadingProcedure] = useState(false);
  const [procedureError, setProcedureError] = useState(null);
  const [parsingReports, setParsingReports] = useState(false);
  
  const procedureTypes = ['MANAGEMENT', 'CRM', 'CALL CENTER', 'MTD', 'GAP ANALYSIS', 'COMMISSION'];
  const departments = ['CS', 'SME', 'LBF'];

  // Fetch reports
  useEffect(() => {
    fetchReports();
  }, [viewMode]);

  // Filter reports based on search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredReports(getDisplayReports());
      setCurrentPage(1); // Reset to first page when filtering changes
      return;
    }

    const filterReports = async () => {
      const result = await searchReports(searchTerm);
      if (result.success) {
        setFilteredReports(result.data);
        setCurrentPage(1); // Reset to first page when search changes
      } else {
        setFilteredReports([]);
      }
    };

    filterReports();
  }, [searchTerm, reports, viewMode, showAllReports]);

  const fetchReports = async () => {
    try {
      setLoading(true);
      // Fetch all reports (no limit or very high limit)
      const result = await getAllReports({ limit: 10000 });
      
      if (result.success) {
        setReports(result.data);
        setFilteredReports(getDisplayReports(result.data));
        setCurrentPage(1); // Reset to first page when fetching new data
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

  // Calculate pagination
  const getPaginatedReports = () => {
    const startIndex = (currentPage - 1) * reportsPerPage;
    const endIndex = startIndex + reportsPerPage;
    return filteredReports.slice(startIndex, endIndex);
  };

  const totalPages = Math.ceil(filteredReports.length / reportsPerPage);
  const paginatedReports = getPaginatedReports();

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      // Scroll to top of table
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
      // Scroll to top of table
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
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
    triggerRefresh(); // Notify Management/Summary/Departmental dashboards to refetch
  };

  const handleReportDeleted = (reportId) => {
    const updatedReports = reports.filter(report => report.id !== reportId);
    setReports(updatedReports);
    setFilteredReports(updatedReports);
    showToast('success', 'Report deleted successfully');
    triggerRefresh(); // Notify dashboards to drop deleted report from data
  };

  const handleParseReports = async () => {
    setParsingReports(true);
    try {
      const result = await adminAPI.batchParseReports();
      if (result.success) {
        const details = result.details || {};
        showToast('success', 
          `Parsing complete: ${details.parsed || 0} parsed, ${details.skipped || 0} skipped, ${details.failed || 0} failed. Dashboard will refresh.`
        );
        triggerRefresh();
      } else {
        showToast('error', result.error || 'Failed to parse reports');
      }
    } catch (err) {
      showToast('error', err.message || 'Failed to parse reports');
    } finally {
      setParsingReports(false);
    }
  };

  const handleReportClick = (report) => {
    setSelectedReport(report);
  };

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  };

  const getStats = () => {
    // Use all reports, not filtered ones, for stats
    const totalReports = reports.length;
    const activeReports = reports.filter(r => r.isActive !== false).length;
    const totalViews = reports.reduce((sum, r) => sum + (r.views || 0), 0);
    const totalDownloads = reports.reduce((sum, r) => sum + (r.downloads || 0), 0);

    return { totalReports, activeReports, totalViews, totalDownloads };
  };

  // Load procedure when type/department changes
  useEffect(() => {
    if (selectedProcedureType) {
      loadProcedure();
    } else {
      setCurrentProcedure(null);
    }
  }, [selectedProcedureType, selectedProcedureDepartment]);

  const loadProcedure = async () => {
    if (!selectedProcedureType) return;
    
    setLoadingProcedure(true);
    setProcedureError(null);
    
    try {
      const result = await proceduresAPI.getByTypeAndDepartment(
        selectedProcedureType,
        selectedProcedureType === 'MANAGEMENT' ? null : selectedProcedureDepartment
      );
      
      if (result.success) {
        setCurrentProcedure(result.data);
      } else {
        setCurrentProcedure(null);
        setProcedureError(result.error || 'Procedure not found');
      }
    } catch (error) {
      setCurrentProcedure(null);
      setProcedureError(error.message || 'Failed to load procedure');
    } finally {
      setLoadingProcedure(false);
    }
  };

  const handleSaveProcedure = async (content) => {
    try {
      const procedureData = {
        reportType: selectedProcedureType,
        department: selectedProcedureType === 'MANAGEMENT' ? null : selectedProcedureDepartment,
        content,
      };

      let result;
      if (currentProcedure) {
        // Update existing
        result = await proceduresAPI.update(currentProcedure.id, { content });
      } else {
        // Create new
        result = await proceduresAPI.create(procedureData);
      }

      if (result.success) {
        setCurrentProcedure(result.data);
        showToast('success', 'Procedure saved successfully');
      } else {
        throw new Error(result.error || 'Failed to save procedure');
      }
    } catch (error) {
      showToast('error', error.message || 'Failed to save procedure');
      throw error;
    }
  };

  // Procedures handlers
  const handleProcedureButtonClick = (type) => {
    setSelectedProcedureType(type);
    // For MANAGEMENT, don't require department selection
    if (type === 'MANAGEMENT') {
      setSelectedProcedureDepartment(null);
    }
    setShowProcedureDepartmentMenu(false);
    setHoveredProcedureButton(null);
  };

  const handleProcedureButtonHover = (type, event) => {
    // Skip hover menu for MANAGEMENT (only one management report)
    if (type === 'MANAGEMENT') {
      return;
    }

    if (procedureHoverTimeoutRef.current) {
      clearTimeout(procedureHoverTimeoutRef.current);
    }

    const button = procedureButtonRefs.current[type];
    if (button && procedureContainerRef.current) {
      const rect = button.getBoundingClientRect();
      const containerRect = procedureContainerRef.current.getBoundingClientRect();
      
      setHoveredProcedureButton(type);
      
      setProcedureMenuPosition({
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.bottom - containerRect.top + 5
      });
      
      setShowProcedureDepartmentMenu(true);
    }
  };

  const handleProcedureButtonLeave = () => {
    procedureHoverTimeoutRef.current = setTimeout(() => {
      if (!isProcedureMenuHovered) {
        setShowProcedureDepartmentMenu(false);
        setHoveredProcedureButton(null);
      }
    }, 200);
  };

  const handleProcedureMenuEnter = () => {
    if (procedureHoverTimeoutRef.current) {
      clearTimeout(procedureHoverTimeoutRef.current);
    }
    setIsProcedureMenuHovered(true);
  };

  const handleProcedureMenuLeave = () => {
    setIsProcedureMenuHovered(false);
    procedureHoverTimeoutRef.current = setTimeout(() => {
      setShowProcedureDepartmentMenu(false);
      setHoveredProcedureButton(null);
    }, 150);
  };

  const handleProcedureDepartmentSelect = (dept) => {
    setSelectedProcedureDepartment(dept);
    setShowProcedureDepartmentMenu(false);
    setHoveredProcedureButton(null);
  };

  useEffect(() => {
    return () => {
      if (procedureHoverTimeoutRef.current) {
        clearTimeout(procedureHoverTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (procedureMenuRef.current && !procedureMenuRef.current.contains(event.target)) {
        const isButtonClick = Array.from(document.querySelectorAll('.procedure-selector-button')).some(
          button => button.contains(event.target)
        );
        
        if (!isButtonClick) {
          setShowProcedureDepartmentMenu(false);
          setHoveredProcedureButton(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
          <div className="view-mode-toggle">
            <button 
              className={`view-mode-button ${activeView === 'reports' ? 'active' : ''}`}
              onClick={() => setActiveView('reports')}
            >
              Reports
            </button>
            <button 
              className={`view-mode-button ${activeView === 'procedures' ? 'active' : ''}`}
              onClick={() => setActiveView('procedures')}
            >
              Procedures
            </button>
          </div>
          {activeView === 'reports' && (
            <div className="report-actions">
              <button 
                className="parse-reports-button"
                onClick={handleParseReports}
                disabled={parsingReports || reports.length === 0}
                aria-label="Parse all reports for Dashboard"
                title="Parse Excel files to populate Dashboard analytics"
              >
                <span className="button-icon">{parsingReports ? '⏳' : '🔄'}</span>
                <span className="button-text">{parsingReports ? 'Parsing...' : 'Parse Reports'}</span>
              </button>
              <button 
                className="add-report-button"
                onClick={handleAddReport}
                aria-label="Upload new report"
              >
                <span className="button-icon">📤</span>
                <span className="button-text">Upload Report</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Procedures View */}
      {activeView === 'procedures' && (
        <div className="procedures-view">
          <div className="procedures-selector-container" ref={procedureContainerRef}>
            <div className="procedure-selector-scroll-wrapper">
              <div className="procedure-selector-buttons">
                {procedureTypes.map((type, index) => (
                  <Fragment key={type}>
                    <button
                      ref={el => procedureButtonRefs.current[type] = el}
                      className={`procedure-selector-button ${selectedProcedureType === type ? 'active' : ''} ${
                        hoveredProcedureButton === type && type !== 'MANAGEMENT' ? 'hovered' : ''
                      }`}
                      onClick={() => handleProcedureButtonClick(type)}
                      onMouseEnter={(e) => handleProcedureButtonHover(type, e)}
                      onMouseLeave={type !== 'MANAGEMENT' ? handleProcedureButtonLeave : undefined}
                      data-type={type}
                    >
                      <span className="button-text">{type}</span>
                      {selectedProcedureType === type && selectedProcedureDepartment && type !== 'MANAGEMENT' && (
                        <span className="department-indicator">{selectedProcedureDepartment}</span>
                      )}
                      {showProcedureDepartmentMenu && hoveredProcedureButton === type && type !== 'MANAGEMENT' && (
                        <div className="hover-indicator"></div>
                      )}
                    </button>
                    {index < procedureTypes.length - 1 && (
                      <div className="button-divider"></div>
                    )}
                  </Fragment>
                ))}
              </div>
            </div>

            {showProcedureDepartmentMenu && hoveredProcedureButton && hoveredProcedureButton !== 'MANAGEMENT' && (
              <div 
                className="procedure-department-menu"
                ref={procedureMenuRef}
                style={{
                  left: `${procedureMenuPosition.x}px`,
                  top: `${procedureMenuPosition.y}px`,
                  transform: 'translateX(-50%)'
                }}
                onMouseEnter={handleProcedureMenuEnter}
                onMouseLeave={handleProcedureMenuLeave}
              >
                <div className="dashboard-menu-header">
                  <span className="menu-report-type">{hoveredProcedureButton}</span>
                </div>
                <div className="department-options">
                  {departments.map(dept => (
                    <button
                      key={dept}
                      className={`department-option ${selectedProcedureDepartment === dept && selectedProcedureType === hoveredProcedureButton ? 'selected' : ''}`}
                      onClick={() => handleProcedureDepartmentSelect(dept)}
                    >
                      <span className="department-name">{dept}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Procedure Content */}
          <div className="procedure-content-wrapper">
            {loadingProcedure ? (
              <div className="procedure-loading">
                <LoadingSpinner size="large" />
                <p>Loading procedure...</p>
              </div>
            ) : selectedProcedureType ? (
              currentProcedure ? (
                <ProcedureEditor
                  reportType={selectedProcedureType}
                  department={selectedProcedureDepartment}
                  initialContent={currentProcedure.content}
                  onSave={handleSaveProcedure}
                  onCancel={() => loadProcedure()}
                />
              ) : (
                <ProcedureEditor
                  reportType={selectedProcedureType}
                  department={selectedProcedureDepartment}
                  initialContent={[]}
                  onSave={handleSaveProcedure}
                  onCancel={() => {
                    setSelectedProcedureType(null);
                    setSelectedProcedureDepartment(null);
                  }}
                />
              )
            ) : (
              <div className="procedure-message">
                <div className="procedure-message-icon">📋</div>
                <h3>Select a Report Procedure</h3>
                <p className="procedure-placeholder">
                  Click on MANAGEMENT to view its procedure, or hover over other procedure types and select a department (CS, SME, or LBF) to view the report procedure.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reports View */}
      {activeView === 'reports' && (
        <>
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
                  reports={paginatedReports}
                  onReportClick={handleReportClick}
                />
            
                {/* Pagination Controls */}
                {filteredReports.length > reportsPerPage && (
                  <div className="rm-report-pagination">
                    <button 
                      className="rm-pagination-button"
                      onClick={handlePreviousPage}
                      disabled={currentPage === 1}
                      aria-label="Previous page"
                    >
                      <span className="rm-pagination-arrow">←</span>
                      <span className="rm-pagination-text">Previous</span>
                    </button>
                
                    <div className="rm-pagination-info">
                      <span className="rm-pagination-current">
                    Page {currentPage} of {totalPages}
                      </span>
                      <span className="rm-pagination-count">
                    Showing {((currentPage - 1) * reportsPerPage) + 1} - {Math.min(currentPage * reportsPerPage, filteredReports.length)} of {filteredReports.length} reports
                      </span>
                    </div>
                
                    <button 
                      className="rm-pagination-button"
                      onClick={handleNextPage}
                      disabled={currentPage === totalPages}
                      aria-label="Next page"
                    >
                      <span className="rm-pagination-text">Next</span>
                      <span className="rm-pagination-arrow">→</span>
                    </button>
                  </div>
                )}
            
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
        </>
      )}

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