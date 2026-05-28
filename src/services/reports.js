/**
 * Reports Service - Go Backend API
 * Replaces Firebase Firestore
 */

import { cacheGet, cacheSet, cacheInvalidate } from './cache';

// Allow VITE_API_URL to be explicitly empty ('') to mean "use same origin".
// If VITE_API_URL is undefined (not set), fall back to localhost for local development.
const envApiUrl = import.meta.env.VITE_API_URL;
const API_URL = envApiUrl === undefined ? 'http://localhost:8080' : envApiUrl;

// Token management
const getToken = () => localStorage.getItem('pcl_token');
const setToken = (token) => localStorage.setItem('pcl_token', token);
const removeToken = () => localStorage.removeItem('pcl_token');
const removeUserFromStorage = () => localStorage.removeItem('pcl_user');

// API request helper with automatic token refresh
const apiRequest = async (endpoint, options = {}, isRetry = false) => {
  const token = getToken();
  
  const headers = {
    ...options.headers,
  };
  
  // Don't set Content-Type for FormData
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });
    
    const data = await response.json();
    
    // Check if token expired and try to refresh
    if ((response.status === 401 || 
         (data.error && (data.error.includes('expired') || data.error.includes('invalid') || data.error.includes('Invalid')))) &&
        !isRetry) {

      // Try to refresh the token
      try {
        const refreshResponse = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        });
        
        const refreshData = await refreshResponse.json();
        
        if (refreshData.success && refreshData.data?.token) {

          setToken(refreshData.data.token);
          // Retry the original request with new token
          return apiRequest(endpoint, options, true);
        }
      } catch (e) {
        console.error('Token refresh error:', e);
      }
      
      // Refresh failed, clear auth and redirect to login

      removeToken();
      removeUserFromStorage();
      window.location.href = '/login';
      return { success: false, error: 'Session expired. Please log in again.' };
    }
    
    return data;
  } catch (error) {
    console.error('API Error:', error);
    return { success: false, error: error.message };
  }
};

// Create a new report (with file upload)
export const createReport = async (reportData, file) => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', reportData.title || '');
    formData.append('description', reportData.description || '');
    formData.append('department', reportData.department || '');
    formData.append('type', reportData.type || '');
    formData.append('date', reportData.date || new Date().toISOString());
    
    const response = await apiRequest('/api/reports', {
      method: 'POST',
      body: formData,
    });
    
    // Invalidate reports cache on success
    if (response.success) {
      cacheInvalidate('reports');
    }
    
    return response;
  } catch (error) {
    console.error('Error creating report:', error);
    return { success: false, error: error.message };
  }
};

// Get all reports
export const getAllReports = async (options = {}) => {
  try {
    const { limit = 100, orderBy = 'created_at', orderDir = 'desc', department = '', type = '' } = options;
    
    // Check cache first
    const cacheParams = { limit, department, type };
    const cached = cacheGet('reports', cacheParams);
    if (cached) {

      return { success: true, data: cached.data.data || [], _cached: true };
    }
    
    const params = new URLSearchParams({
      limit: String(limit),
      sort: orderBy,
      order: orderDir,
    });
    if (department) params.append('department', department);
    if (type) params.append('type', type);
    
    const response = await apiRequest(`/api/reports?${params}`);
    
    if (response.success) {
      // Cache the result
      cacheSet('reports', cacheParams, response);
      return { success: true, data: response.data || [] };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching reports:', error);
    return { success: false, error: error.message };
  }
};

// Get recent reports (limit 3 for dashboard)
export const getRecentReports = async (limitNum = 3) => {
  try {
    const response = await apiRequest(`/api/reports/recent?limit=${limitNum}`);
    
    if (response.success) {
      return { success: true, data: response.data || [] };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching recent reports:', error);
    return { success: false, error: error.message };
  }
};

// Get report by ID
export const getReportById = async (reportId) => {
  try {
    const response = await apiRequest(`/api/reports/${reportId}`);
    
    if (response.success) {
      return { success: true, data: response.data };
    }
    
    return { success: false, error: response.error || 'Report not found' };
  } catch (error) {
    console.error('Error fetching report:', error);
    return { success: false, error: error.message };
  }
};

// Update report
export const updateReport = async (reportId, reportData) => {
  try {
    const response = await apiRequest(`/api/reports/${reportId}`, {
      method: 'PUT',
      body: JSON.stringify(reportData),
    });
    
    // Invalidate reports cache on success
    if (response.success) {
      cacheInvalidate('reports');
    }
    
    return response;
  } catch (error) {
    console.error('Error updating report:', error);
    return { success: false, error: error.message };
  }
};

// Delete report
export const deleteReport = async (reportId) => {
  try {
    const response = await apiRequest(`/api/reports/${reportId}`, {
      method: 'DELETE',
    });
    
    // Invalidate reports cache on success
    if (response.success) {
      cacheInvalidate('reports');
    }
    
    return response;
  } catch (error) {
    console.error('Error deleting report:', error);
    return { success: false, error: error.message };
  }
};

// Search reports
export const searchReports = async (searchTerm) => {
  try {
    const params = new URLSearchParams({ q: searchTerm });
    const response = await apiRequest(`/api/reports/search?${params}`);
    
    if (response.success) {
      return { success: true, data: response.data || [] };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error searching reports:', error);
    return { success: false, error: error.message };
  }
};

// Get reports by department
export const getReportsByDepartment = async (department) => {
  try {
    const params = new URLSearchParams({ department });
    const response = await apiRequest(`/api/reports?${params}`);
    
    if (response.success) {
      return { success: true, data: response.data || [] };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching department reports:', error);
    return { success: false, error: error.message };
  }
};

// Increment report views (handled automatically by download endpoint)
export const incrementReportViews = async (reportId) => {
  // View count is automatically incremented when fetching report
  return { success: true };
};

// Increment report downloads (handled automatically by download endpoint)
export const incrementReportDownloads = async (reportId) => {
  // Download count is automatically incremented when downloading
  return { success: true };
};

// Get cluster data for management reports (pre-parsed from database)
export const getClusterData = async (department = '') => {
  try {
    // Check cache first
    const cacheKey = `cluster_${department || 'all'}`;
    const cached = cacheGet('dashboard', { key: cacheKey });
    if (cached) {

      return { success: true, data: cached.data, _cached: true };
    }

    const params = department ? `?department=${department}` : '';
    const response = await apiRequest(`/api/reports/cluster-data${params}`);
    
    if (response.success) {
      // Cache for 10 minutes
      cacheSet('dashboard', { key: cacheKey }, response.data, 10 * 60 * 1000);
      return { success: true, data: response.data || {} };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching cluster data:', error);
    return { success: false, error: error.message };
  }
};

// Get reports by department and type
export const getReportsByDepartmentAndType = async (department, reportType) => {
  try {
    // Check cache first
    const cacheParams = { department, type: reportType };
    const cached = cacheGet('reports', cacheParams);
    if (cached) {

      return { success: true, data: cached.data.data || [], _cached: true };
    }
    
    const response = await apiRequest(`/api/reports/department/${department}/type/${reportType}`);
    
    if (response.success) {
      // Cache the result
      cacheSet('reports', cacheParams, response);
      return { success: true, data: response.data || [] };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching department reports:', error);
    return { success: false, error: error.message };
  }
};

// Get unique dates from reports for filtering
export const getUniqueDatesFromReports = async (department, reportType) => {
  try {
    const result = await getReportsByDepartmentAndType(department, reportType);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    // Extract unique dates
    const dates = [...new Set(
      result.data
        .map(report => {
          const date = report.date || report.created_at;
          return date ? new Date(date).toISOString().split('T')[0] : null;
        })
        .filter(date => date !== null)
        .sort((a, b) => new Date(b) - new Date(a))
    )];
    
    return { success: true, data: dates };
  } catch (error) {
    console.error('Error extracting dates:', error);
    return { success: false, error: error.message };
  }
};

// Download report file
export const downloadReportFile = async (reportId, fileName) => {
  try {
    const token = getToken();
    const response = await fetch(`${API_URL}/api/reports/${reportId}/download`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    if (!response.ok) {
      throw new Error('Download failed');
    }
    
    const blob = await response.blob();
    
    // Create download link
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'report';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    return { success: true };
  } catch (error) {
    console.error('Error downloading report:', error);
    return { success: false, error: error.message };
  }
};

// Get report file URL (static files)
export const getReportFileUrl = (filePath) => {
  return `${API_URL}/files/${filePath}`;
};

// Get API download URL for a report (for fetching blob with auth)
export const getReportDownloadUrl = (reportId) => {
  return `${API_URL}/api/reports/${reportId}/download`;
};

/** Safe segment for filenames (matches selected report-type button label, e.g. MANAGEMENT, CALL_CENTER). */
function sanitizeZipNameSegment(s) {
  const t = String(s || 'REPORT')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[/\\?%*:|"<>]/g, '')
    .replace(/_+/g, '_');
  return t || 'REPORT';
}

function reportDateForZipFilename(report) {
  const raw = report?.date ?? report?.created_at;
  const d = raw ? new Date(raw) : null;
  if (!d || Number.isNaN(d.getTime())) return 'UNKNOWN_DATE';
  return d.toISOString().split('T')[0];
}

function fileExtensionFromReportName(report) {
  const name = report?.file_name || report?.fileName || '';
  const base = String(name).split(/[/\\]/).pop() || '';
  const m = base.match(/(\.[a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : '.xlsx';
}

/**
 * Download all reports as one ZIP. Each file is named: {buttonName}_REPORT_{YYYY-MM-DD}.ext
 * (same pattern as the report-type button, e.g. MANAGEMENT — not storage ids).
 * @param {Array} reports
 * @param {{ buttonName?: string }} [options] — label of the active report-type button (MANAGEMENT, CRM, …)
 */
export const downloadAllReportsAsZip = async (reports, options = {}) => {
  try {
    const JSZip = await import('jszip');
    const { saveAs } = await import('file-saver');

    const buttonSeg = sanitizeZipNameSegment(options.buttonName || options.reportTypeLabel || 'REPORT');
    const zip = new JSZip.default();
    const folder = zip.folder('Reports');

    const usedPerBase = {};

    // Add each report to zip
    for (const report of reports) {
      try {
        const token = getToken();
        const response = await fetch(`${API_URL}/api/reports/${report.id}/download`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) throw new Error(`Failed to fetch ${report.file_name || report.id}`);

        const blob = await response.blob();
        const dateStr = reportDateForZipFilename(report);
        const ext = fileExtensionFromReportName(report);
        const base = `${buttonSeg}_REPORT_${dateStr}`;
        usedPerBase[base] = (usedPerBase[base] || 0) + 1;
        const n = usedPerBase[base];
        const entryName = n === 1 ? `${base}${ext}` : `${base}_${n}${ext}`;
        folder.file(entryName, blob);
      } catch (error) {
        console.error(`Error adding ${report.file_name || report.id} to zip:`, error);
      }
    }

    const bundleDay = new Date().toISOString().split('T')[0];
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${buttonSeg}_ALL_REPORTS_${bundleDay}.zip`);

    return { success: true };
  } catch (error) {
    console.error('Error creating zip file:', error);
    return { success: false, error: error.message };
  }
};

// Get report parsed data (for dashboard)
export const getReportData = async (reportId) => {
  try {
    const response = await apiRequest(`/api/reports/${reportId}/data`);
    
    if (response.success) {
      return { success: true, data: response.data || [] };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching report data:', error);
    return { success: false, error: error.message };
  }
};

// Get ALL management report data in a single batch call (much faster than individual calls)
export const getBatchReportData = async () => {
  try {
    // Check cache first
    const cacheKey = 'batch_report_data';
    const cached = cacheGet('dashboard', { key: cacheKey });
    if (cached) {

      return { success: true, data: cached.data, _cached: true };
    }

    const response = await apiRequest('/api/reports/batch-data');
    
    if (response.success) {
      cacheSet('dashboard', { key: cacheKey }, response.data || {});
      return { success: true, data: response.data || {}, cached: response.cached };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching batch report data:', error);
    return { success: false, error: error.message };
  }
};

// Get report analysis data
export const getReportAnalysis = async (reportId) => {
  try {
    const response = await getReportData(reportId);
    
    if (response.success) {
      return { 
        success: true, 
        data: {
          summary: 'Analysis complete.',
          metrics: response.data,
          insights: []
        }
      };
    }
    
    return response;
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Get available sheets for regional analysis
export const getAvailableSheets = async () => {
  try {
    // Check cache first
    const cacheKey = 'sheets_list';
    const cached = cacheGet('dashboard', { key: cacheKey });
    if (cached) {

      return { success: true, data: cached.data, _cached: true };
    }

    const response = await apiRequest('/api/reports/sheets');
    
    if (response.success) {
      // Cache for 10 minutes
      cacheSet('dashboard', { key: cacheKey }, response.data, 10 * 60 * 1000);
      return { success: true, data: response.data || [] };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching sheets:', error);
    return { success: false, error: error.message };
  }
};

// Get regional data for branch analysis
export const getRegionalData = async (sheetName = '') => {
  try {
    // Check cache first
    const cacheKey = `regional_${sheetName || 'all'}`;
    const cached = cacheGet('dashboard', { key: cacheKey });
    if (cached) {

      return { success: true, data: cached.data, _cached: true };
    }

    const params = sheetName ? `?sheet=${encodeURIComponent(sheetName)}` : '';
    const response = await apiRequest(`/api/reports/regional-data${params}`);
    
    if (response.success) {
      // Cache for 10 minutes
      cacheSet('dashboard', { key: cacheKey }, response.data, 10 * 60 * 1000);
      return { success: true, data: response.data || {} };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching regional data:', error);
    return { success: false, error: error.message };
  }
};

// In-memory cache for regional batch data (too large for localStorage)
let regionalBatchMemoryCache = null;
let regionalBatchCacheTime = 0;
const REGIONAL_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Get ALL regional data in a single batch call (much faster!)
export const getRegionalDataBatch = async () => {
  try {
    // Check in-memory cache first (localStorage is too small for this data)
    const now = Date.now();
    if (regionalBatchMemoryCache && (now - regionalBatchCacheTime) < REGIONAL_CACHE_TTL) {

      return { success: true, data: regionalBatchMemoryCache, _cached: true };
    }

    const response = await apiRequest('/api/reports/regional-batch');
    
    if (response.success) {
      // Cache in memory only (data is too large for localStorage)
      regionalBatchMemoryCache = response.data;
      regionalBatchCacheTime = now;
      return { success: true, data: response.data || {}, cached: response.cached };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching regional batch data:', error);
    return { success: false, error: error.message };
  }
};
