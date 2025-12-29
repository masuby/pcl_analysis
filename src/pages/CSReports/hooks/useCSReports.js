import { useState, useEffect, useCallback } from 'react';
import { 
  getReportsByDepartmentAndType, 
  downloadAllReportsAsZip,
  getReportAnalysis,
  incrementReportViews,
  incrementReportDownloads
} from '../../../services/reports';
import { getReportFileUrl } from '../../../services/supabase';

export const useCSReports = (department = 'CS') => {
  const [reports, setReports] = useState([]);
  const [filteredReports, setFilteredReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedReportType, setSelectedReportType] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [analysisData, setAnalysisData] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);

  // Fetch reports when report type changes
  useEffect(() => {
    if (selectedReportType) {
      fetchReports(selectedReportType);
    } else {
      setReports([]);
      setFilteredReports([]);
      setLoading(false);
    }
  }, [selectedReportType, department]);

  // Filter reports when date changes
  useEffect(() => {
    if (!selectedDate) {
      setFilteredReports(reports);
      // Select latest report when no date filter
      if (reports.length > 0) {
        const latestReport = reports.sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;
          return dateB - dateA;
        })[0];
        setSelectedReport(latestReport);
      }
    } else {
      const filtered = reports.filter(report => {
        const reportDate = report.date ? new Date(report.date).toISOString().split('T')[0] : null;
        return reportDate === selectedDate;
      });
      setFilteredReports(filtered);
      // Select latest report from filtered results
      if (filtered.length > 0) {
        const latestReport = filtered.sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;
          return dateB - dateA;
        })[0];
        setSelectedReport(latestReport);
      } else {
        setSelectedReport(null);
      }
    }
  }, [selectedDate, reports]);

  const fetchReports = async (reportType) => {
    try {
      setLoading(true);
      setError(null);
      
      const result = await getReportsByDepartmentAndType(department, reportType);
      
      if (result.success) {
        // Process reports to ensure we have valid URLs
        const processedReports = await Promise.all(
          result.data.map(async (report) => {
            let finalFileUrl = null;
            
            // Option 1: Use stored fileUrl from Firebase
            if (report.fileUrl && isValidUrl(report.fileUrl)) {
              finalFileUrl = report.fileUrl;
            }
            // Option 2: Generate URL from filePath in Supabase
            else if (report.filePath) {
              try {
                finalFileUrl = await getReportFileUrl(report.filePath);
              } catch (urlError) {
                console.warn(`Failed to generate URL for ${report.filePath}:`, urlError);
              }
            }
            
            return {
              ...report,
              fileUrl: finalFileUrl,
              // Ensure date is properly formatted
              date: report.date?.toDate ? report.date.toDate() : new Date(report.date)
            };
          })
        );
        
        // Sort reports by date (latest first)
        const sortedReports = processedReports.sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;
          return dateB - dateA; // Latest first
        });
        
        setReports(sortedReports);
        setFilteredReports(sortedReports);
        
        // Select first report (latest) by default
        if (sortedReports.length > 0) {
          setSelectedReport(sortedReports[0]);
        } else {
          setSelectedReport(null);
        }
      } else {
        setError(result.error);
        setReports([]);
        setFilteredReports([]);
        setSelectedReport(null);
      }
    } catch (err) {
      setError(err.message);
      setReports([]);
      setFilteredReports([]);
      setSelectedReport(null);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to validate URLs
  const isValidUrl = (urlString) => {
    try {
      const url = new URL(urlString);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (err) {
      return false;
    }
  };

  const handleReportTypeSelect = (reportType) => {
    setSelectedReportType(reportType);
    setSelectedDate(null); // Reset date filter when report type changes
  };

  const handleDateSelect = (date) => {
    setSelectedDate(date);
  };

  const handleDownload = async (report) => {
    try {
      let downloadUrl = null;
      
      // Try multiple sources for the download URL
      if (report.fileUrl && isValidUrl(report.fileUrl)) {
        downloadUrl = report.fileUrl;
      } else if (report.filePath) {
        // Generate signed URL for download
        downloadUrl = await getReportFileUrl(report.filePath);
      }
      
      if (!downloadUrl) {
        throw new Error('No valid download URL available');
      }
      
      // Create a temporary anchor element for download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      
      // Add timestamp to prevent caching issues
      const timestamp = new Date().getTime();
      const finalUrl = downloadUrl.includes('?') 
        ? `${downloadUrl}&_t=${timestamp}`
        : `${downloadUrl}?_t=${timestamp}`;
      
      link.href = finalUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Increment download count
      await incrementReportDownloads(report.id);
      
    } catch (error) {
      console.error('Download error:', error);
      setError(`Download failed: ${error.message}`);
    }
  };

  const handleDownloadAll = async () => {
    if (reports.length === 0) return;
    
    try {
      // Filter reports that have valid URLs
      const downloadableReports = reports.filter(report => 
        (report.fileUrl && isValidUrl(report.fileUrl)) || report.filePath
      );
      
      if (downloadableReports.length === 0) {
        setError('No downloadable reports available');
        return;
      }
      
      await downloadAllReportsAsZip(downloadableReports);
    } catch (error) {
      console.error('Error downloading all reports:', error);
      setError(error.message);
    }
  };

  const handleViewAnalysis = async (report) => {
    try {
      setSelectedReport(report);
      
      // For now, just show a simple analysis modal
      setAnalysisData({
        summary: `Analysis for ${report.type} will be available soon.`,
        metrics: [],
        insights: [],
        generatedAt: new Date().toISOString()
      });
      setShowAnalysis(true);
      
      // Increment view count
      await incrementReportViews(report.id);
      
    } catch (error) {
      setError(error.message);
    }
  };

  const clearFilters = () => {
    setSelectedDate(null);
    setFilteredReports(reports);
  };

  const getAvailableDates = useCallback(() => {
    return [...new Set(
      reports
        .map(report => {
          const date = report.date;
          return date ? new Date(date).toISOString().split('T')[0] : null;
        })
        .filter(date => date !== null)
        .sort((a, b) => new Date(b) - new Date(a))
    )];
  }, [reports]);

  return {
    // State
    reports,
    filteredReports,
    loading,
    error,
    selectedReportType,
    selectedDate,
    analysisData,
    showAnalysis,
    selectedReport,
    
    // Computed
    availableDates: getAvailableDates(),
    hasReports: reports.length > 0,
    hasFilteredReports: filteredReports.length > 0,
    
    // Actions
    handleReportTypeSelect,
    handleDateSelect,
    handleDownload,
    handleDownloadAll,
    handleViewAnalysis,
    clearFilters,
    setShowAnalysis,
    setSelectedReport
  };
};