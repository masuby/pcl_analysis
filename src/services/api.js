/**
 * API Service for PCL Analysis
 * This file replaces Firebase/Supabase calls with local Go API calls
 * 
 * Usage:
 * 1. Set VITE_API_URL in your .env file (defaults to http://localhost:8080)
 * 2. Replace Firebase/Supabase imports with this API service
 */

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
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    // Server returned non-JSON (e.g. HTML 404 page)
    const hint = response.status === 404
      ? ' Endpoint may not exist. Ensure the backend is rebuilt and restarted.'
      : '';
    throw new Error(`Server returned invalid response (${response.status})${hint}`);
  }
  
  // Check if token expired and try to refresh
  if ((response.status === 401 || 
       (data.error && (data.error.includes('expired') || data.error.includes('invalid')))) &&
      !isRetry && 
      endpoint !== '/api/auth/refresh' &&
      endpoint !== '/api/auth/login') {
    
    console.log('Token expired, attempting refresh...');
    
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
        console.log('Token refreshed successfully');
        setToken(refreshData.data.token);
        // Retry the original request with new token
        return apiRequest(endpoint, options, true);
      }
    } catch (e) {
      console.error('Token refresh error:', e);
    }
    
    // Refresh failed, clear auth and redirect to login
    console.log('Token refresh failed, logging out');
    removeToken();
    removeUserFromStorage();
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }
  
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
  
  return data;
};

// File upload helper
const uploadFile = async (endpoint, file, additionalData = {}) => {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);
  
  Object.entries(additionalData).forEach(([key, value]) => {
    formData.append(key, value);
  });
  
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
  });
  
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || 'Upload failed');
  }
  
  return data;
};

// ========== Authentication API ==========

export const authAPI = {
  async login(email, password) {
    const response = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    
    if (response.success && response.data.token) {
      setToken(response.data.token);
    }
    
    return response;
  },
  
  async register(email, password, displayName, role = 'user', department = '') {
    const response = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName, role, department }),
    });
    
    if (response.success && response.data.token) {
      setToken(response.data.token);
    }
    
    return response;
  },
  
  async getCurrentUser() {
    return apiRequest('/api/auth/me');
  },
  
  async updateProfile(data) {
    return apiRequest('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  
  async changePassword(currentPassword, newPassword) {
    return apiRequest('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
  
  async refreshToken() {
    const response = await apiRequest('/api/auth/refresh', {
      method: 'POST',
    });
    
    if (response.success && response.data.token) {
      setToken(response.data.token);
    }
    
    return response;
  },
  
  logout() {
    removeToken();
  },
  
  isAuthenticated() {
    return !!getToken();
  },
};

// ========== Reports API ==========

export const reportsAPI = {
  async getAll(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return apiRequest(`/api/reports${queryString ? '?' + queryString : ''}`);
  },
  
  async getById(id) {
    return apiRequest(`/api/reports/${id}`);
  },
  
  async getRecent(limit = 5) {
    return apiRequest(`/api/reports/recent?limit=${limit}`);
  },
  
  async search(query, limit = 50, offset = 0) {
    return apiRequest(`/api/reports/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`);
  },
  
  async getByDepartmentAndType(department, type) {
    return apiRequest(`/api/reports/department/${department}/type/${type}`);
  },
  
  async getData(reportId) {
    return apiRequest(`/api/reports/${reportId}/data`);
  },
  
  async upload(file, title, department, type, date) {
    return uploadFile('/api/reports', file, { title, department, type, date });
  },
  
  async update(id, data) {
    return apiRequest(`/api/reports/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  
  async delete(id) {
    return apiRequest(`/api/reports/${id}`, {
      method: 'DELETE',
    });
  },
  
  getDownloadUrl(id) {
    return `${API_URL}/api/reports/${id}/download`;
  },
};

// ========== Dashboard API ==========

export const dashboardAPI = {
  async getData(department = '', fromDate = '', toDate = '') {
    const params = new URLSearchParams();
    if (department) params.append('department', department);
    if (fromDate) params.append('fromDate', fromDate);
    if (toDate) params.append('toDate', toDate);
    
    return apiRequest(`/api/dashboard?${params.toString()}`);
  },
  
  async getStats(department = '') {
    const params = department ? `?department=${department}` : '';
    return apiRequest(`/api/dashboard/stats${params}`);
  },
  
  async getAvailableMetrics() {
    return apiRequest('/api/dashboard/metrics');
  },
  
  async getAvailableDates(department = '', type = '') {
    const params = new URLSearchParams();
    if (department) params.append('department', department);
    if (type) params.append('type', type);
    
    return apiRequest(`/api/dashboard/dates?${params.toString()}`);
  },
};

// ========== Challenges API ==========

export const challengesAPI = {
  async getAll(limit = 50, offset = 0) {
    return apiRequest(`/api/challenges?limit=${limit}&offset=${offset}`);
  },
  
  async getById(id) {
    return apiRequest(`/api/challenges/${id}`);
  },
  
  async getByDepartment(department) {
    return apiRequest(`/api/challenges/department/${department}`);
  },
  
  async search(query) {
    return apiRequest(`/api/challenges/search?q=${encodeURIComponent(query)}`);
  },
  
  async create(data) {
    return apiRequest('/api/challenges', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  
  async update(id, data) {
    return apiRequest(`/api/challenges/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  
  async delete(id) {
    return apiRequest(`/api/challenges/${id}`, {
      method: 'DELETE',
    });
  },
  
  async uploadImage(id, file) {
    const formData = new FormData();
    formData.append('image', file);
    
    const token = getToken();
    const response = await fetch(`${API_URL}/api/challenges/${id}/image`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    
    return response.json();
  },
  
  async uploadAttachment(id, file) {
    const formData = new FormData();
    formData.append('attachment', file);
    
    const token = getToken();
    const response = await fetch(`${API_URL}/api/challenges/${id}/attachment`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    
    return response.json();
  },
};

// ========== Procedures API ==========

export const proceduresAPI = {
  async getAll() {
    return apiRequest('/api/procedures');
  },
  
  async getByTypeAndDepartment(reportType, department = null) {
    const params = department ? `?department=${department}` : '';
    return apiRequest(`/api/procedures/type/${reportType}${params}`);
  },
  
  async create(data) {
    return apiRequest('/api/procedures', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  
  async update(id, data) {
    return apiRequest(`/api/procedures/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  
  async delete(id) {
    return apiRequest(`/api/procedures/${id}`, {
      method: 'DELETE',
    });
  },
  
  async uploadFile(file, fileType = 'file') {
    const formData = new FormData();
    formData.append('file', file);
    
    const token = getToken();
    const response = await fetch(`${API_URL}/api/procedures/upload?type=${fileType}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    
    // Check content type before parsing
    const contentType = response.headers.get('content-type');
    let data;
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(`Server error: ${text.substring(0, 100)}`);
      }
    }
    
    if (!response.ok) {
      throw new Error(data.error || 'Upload failed');
    }
    
    return data;
  },
  
  getFileUrl(path) {
    // Backend serves static files at /files, and path already includes "procedures/images/" or "procedures/files/"
    return `${API_URL}/files/${path}`;
  },
};

// ========== Email API ==========

export const emailAPI = {
  /**
   * Send HOD Score Card report email to managers
   * @param {Object} params - { recipients, subject, htmlBody, mode, attachmentBase64?, attachmentName?, attachments? }
   *   attachments: optional array of { base64, name } for multiple attachments (overrides single attachment when set)
   * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
   */
  async sendScoreCard({ recipients, subject, htmlBody, mode = 'WEEKLY', attachmentBase64, attachmentName, attachments }) {
    const body = {
      recipients,
      subject,
      htmlBody,
      mode,
      attachmentBase64: attachmentBase64 || '',
      attachmentName: attachmentName || '',
    };
    if (attachments && attachments.length > 0) {
      body.attachments = attachments.map((a) => ({ base64: a.base64 || '', name: a.name || '' }));
    }
    return apiRequest('/api/email/scorecard', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};

// ========== Marketing Digital Sales API ==========

export const marketingAPI = {
  /** Fetch all stored Digital Sales files (with parsed data) from the backend. */
  async getFiles() {
    const data = await apiRequest('/api/marketing/digital-sales/files');
    return data?.data ?? [];
  },

  /**
   * Upload a Digital Sales Excel file + its parsed JSON to the backend.
   * @param {File}   file       – the raw .xlsx file
   * @param {number} year       – the year this file covers (e.g. 2026)
   * @param {object} parsedData – the full YearData object from parseDigitalSalesExcel
   */
  async uploadFile(file, year, parsedData) {
    const token = localStorage.getItem('pcl_token');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('year', String(year));
    formData.append('parsed_data', JSON.stringify(parsedData));

    const response = await fetch(`${API_URL}/api/marketing/digital-sales/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`Server error (${response.status})`); }
    if (!response.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },

  /** Soft-delete the active file for a given year. */
  async deleteFile(year) {
    return apiRequest(`/api/marketing/digital-sales/files/${year}`, { method: 'DELETE' });
  },

  /** Returns the URL to download the original uploaded Excel for a year. */
  downloadUrl(year) {
    return `${API_URL}/api/marketing/digital-sales/files/${year}/download`;
  },
};

// ========== Local Trip Report API ==========

export const localTripAPI = {
  /** Fetch all currently active files (one per kind). */
  async getFiles() {
    const data = await apiRequest('/api/local-trip/files');
    return data?.data ?? [];
  },

  /**
   * Upload a file for the given kind (LOCAL_TRIP | SALES | USERS | ACTIVITIES).
   * Replaces the existing active file for that kind.
   * @param {File}   file – the raw .xlsx file
   * @param {string} kind – one of the four allowed kinds
   */
  async uploadFile(file, kind) {
    const token = localStorage.getItem('pcl_token');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('kind', kind);

    const response = await fetch(`${API_URL}/api/local-trip/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`Server error (${response.status})`); }
    if (!response.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },

  /**
   * Download a file by ID as an ArrayBuffer so it can be parsed client-side.
   * @param {string} fileId – UUID of the file record
   * @returns {Promise<ArrayBuffer>}
   */
  async downloadFileBuffer(fileId) {
    const token = localStorage.getItem('pcl_token');
    const response = await fetch(`${API_URL}/api/local-trip/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Failed to fetch file (${response.status})`);
    return response.arrayBuffer();
  },

  /** Soft-delete a file by ID. */
  async deleteFile(fileId) {
    return apiRequest(`/api/local-trip/files/${fileId}`, { method: 'DELETE' });
  },

  /** Direct download URL (for anchor href). */
  downloadUrl(fileId) {
    return `${API_URL}/api/local-trip/files/${fileId}/download`;
  },
};

// ========== LBF Call Centre Targets API ==========

export const lbfCallCenterAPI = {
  /**
   * Fetch the LBF Call Centre monthly-target tabs (raw rows) for the given
   * months. `months` is an array of 'YYYY-MM' strings; omit for all months.
   * @returns {Promise<{ success: boolean, tabs: Record<string,{tab:string,values:any[][]}> }>}
   */
  async getTargets(months = []) {
    const q = months.length ? `?months=${encodeURIComponent(months.join(','))}` : '';
    return apiRequest(`/api/lbf-callcenter-targets${q}`);
  },
};

// ========== Consent Incentive Report API ==========

export const consentIncentiveAPI = {
  /** Fetch the currently active Lead file (if any). */
  async getFiles() {
    const data = await apiRequest('/api/consent-incentive/files');
    return data?.data ?? [];
  },

  /**
   * Upload the Lead file.
   * @param {File}   file – the raw .xlsx file
   * @param {string} kind – must be "LEAD"
   */
  async uploadFile(file, kind) {
    const token = localStorage.getItem('pcl_token');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('kind', kind);

    const response = await fetch(`${API_URL}/api/consent-incentive/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch { throw new Error(`Server error (${response.status})`); }
    if (!response.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },

  /**
   * Download the Lead file as an ArrayBuffer for client-side parsing.
   * @param {string} fileId – UUID of the file record
   * @returns {Promise<ArrayBuffer>}
   */
  async downloadFileBuffer(fileId) {
    const token = localStorage.getItem('pcl_token');
    const response = await fetch(`${API_URL}/api/consent-incentive/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Failed to fetch file (${response.status})`);
    return response.arrayBuffer();
  },

  /** Soft-delete a file by ID. */
  async deleteFile(fileId) {
    return apiRequest(`/api/consent-incentive/files/${fileId}`, { method: 'DELETE' });
  },

  /** Direct download URL (for anchor href). */
  downloadUrl(fileId) {
    return `${API_URL}/api/consent-incentive/files/${fileId}/download`;
  },

  /**
   * Fetch all CS CRM report metadata, sorted by report date descending.
   * Used for cross-CRM field-activity verification (Step 5 of the procedure).
   * @returns {Promise<Array<{ id, title, fileName, date, createdAt, fileSize }>>}
   */
  async getAllCRMReports() {
    const data = await apiRequest('/api/reports/department/CS/type/CRM');
    const reports = data?.data ?? [];
    return [...reports].sort((a, b) => {
      const da = new Date(a.date || a.createdAt || 0);
      const db = new Date(b.date || b.createdAt || 0);
      return db - da;
    });
  },

  /**
   * Download any CS CRM report buffer by report ID (used for cross-CRM iteration).
   * @param {string} reportId
   * @returns {Promise<ArrayBuffer>}
   */
  async downloadCRMReportBuffer(reportId) {
    const token = localStorage.getItem('pcl_token');
    const response = await fetch(`${API_URL}/api/reports/${reportId}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Failed to fetch CRM report ${reportId} (${response.status})`);
    return response.arrayBuffer();
  },

  /**
   * Look up the latest CS CRM report metadata (without downloading the file).
   * Useful for the UI to display which report would be used.
   * @returns {Promise<{ id, title, fileName, date, createdAt, fileSize }>}
   */
  async getLatestCRMMeta() {
    const data = await apiRequest('/api/reports/department/CS/type/CRM');
    const reports = data?.data ?? [];
    if (!reports.length) throw new Error('No CS CRM reports found in the database. Upload a CRM report first.');
    const sorted = [...reports].sort((a, b) => {
      const da = new Date(a.date || a.createdAt || 0);
      const db = new Date(b.date || b.createdAt || 0);
      return db - da;
    });
    return sorted[0];
  },

  /**
   * Fetch the latest CS CRM report as an ArrayBuffer for client-side parsing.
   * @returns {Promise<{ buffer: ArrayBuffer, meta: Object }>}
   */
  async getLatestCRMBuffer() {
    const meta  = await this.getLatestCRMMeta();
    const token = localStorage.getItem('pcl_token');
    const response = await fetch(`${API_URL}/api/reports/${meta.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Failed to fetch CRM report (${response.status})`);
    const buffer = await response.arrayBuffer();
    return { buffer, meta };
  },
};

// ========== Social Media Analysis API ==========

export const socialMediaAPI = {
  /**
   * Fetch a month's data from the LBF/SME, CS and SME Google Sheets via the
   * backend (which uses the shared service account). Pass month as "YYYY-MM";
   * omit it to get the latest available month.
   *
   * Returns: { success, period, month, lbf, cs, sme }
   */
  async getData(month = '') {
    const qs = month ? `?month=${encodeURIComponent(month)}` : '';
    return apiRequest(`/api/social-media/data${qs}`);
  },

  /** List months that have data tabs: { success, months: [{ value, label }] } */
  async getMonths() {
    return apiRequest('/api/social-media/months');
  },
};

// ========== Gap Analysis API ==========
// Actual Reps: HOD fetches/saves; TL submits via token (no auth)

export const gapAnalysisAPI = {
  /** Get actual reps and recipient emails for a report (auth required) */
  async getActualReps(reportId) {
    const res = await apiRequest(`/api/gap-analysis/reports/${reportId}/actual-reps`);
    return { data: res?.data ?? {}, recipientEmails: res?.recipientEmails ?? {} };
  },

  /** Upload Excel (Branch + RSM sheets) to update actual reps and emails (auth required) */
  async uploadActualReps(reportId, file, product = 'CS') {
    const formData = new FormData();
    formData.append('file', file);
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
    const token = localStorage.getItem('pcl_token');
    const r = await fetch(`${API_URL}/api/gap-analysis/reports/${reportId}/actual-reps/upload?product=${encodeURIComponent(product)}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      if (r.status === 404) {
        throw new Error('Upload endpoint not found (404). Rebuild and restart the backend server.');
      }
      throw new Error(r.status === 401 ? 'Unauthorized. Please log in again.' : `Upload failed (${r.status}). ${text?.slice(0, 80) || 'Server returned non-JSON.'}`);
    }
    if (!r.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },

  /** Save one team leader's actual rep (HOD, auth required) */
  async saveActualRep(reportId, teamLeaderKey, value, product = 'CS') {
    return apiRequest(`/api/gap-analysis/reports/${reportId}/actual-reps`, {
      method: 'POST',
      body: JSON.stringify({ teamLeaderKey, value, product }),
    });
  },

  /** Get signed URL for TL to submit their Actual Sales Rep (auth required) */
  async getResponseLink(reportId, tlKey, product = 'CS') {
    const params = new URLSearchParams({ reportId, tlKey, product });
    const data = await apiRequest(`/api/gap-analysis/response-link?${params}`);
    return data?.data?.url ?? '';
  },

  /** Get Google Sheet URL for TLs to submit Actual Sales Rep (auth required). Prefer this over token link when set. */
  async getSheetUrl() {
    const data = await apiRequest('/api/gap-analysis/sheet-url');
    return data?.data?.url ?? '';
  },

  /** Get the uploaded Excel file for this report+product (auth required). Returns blob or null if 404. */
  async getUploadedFile(reportId, product = 'CS') {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
    const token = localStorage.getItem('pcl_token');
    const r = await fetch(`${API_URL}/api/gap-analysis/reports/${reportId}/uploaded-file?product=${encodeURIComponent(product)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(r.statusText || 'Failed to load file');
    return r.blob();
  },

  /** Remove the saved uploaded file for this report+product (auth required). */
  async deleteUploadedFile(reportId, product = 'CS') {
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
    const token = localStorage.getItem('pcl_token');
    const r = await fetch(`${API_URL}/api/gap-analysis/reports/${reportId}/uploaded-file?product=${encodeURIComponent(product)}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Failed to remove file');
    return data;
  },
};

/** Submit Actual Sales Rep as Team Leader (no auth; token in body) */
export async function submitGapActualRepWithToken(token, value) {
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
  const res = await fetch(`${API_URL}/api/gap-analysis/actual-reps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, value: Number(value) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to submit');
  return data;
}

/** Verify token (for TL response page; no auth) */
export async function verifyGapResponseToken(token) {
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
  const res = await fetch(`${API_URL}/api/gap-analysis/verify-token?token=${encodeURIComponent(token)}`);
  const data = await res.json();
  return data;
}

// ========== Admin API ==========

export const adminAPI = {
  async getUsers(limit = 50, offset = 0) {
    return apiRequest(`/api/admin/users?limit=${limit}&offset=${offset}`);
  },
  
  async getUserById(id) {
    return apiRequest(`/api/admin/users/${id}`);
  },
  
  async searchUsers(query, limit = 50, offset = 0) {
    return apiRequest(`/api/admin/users/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`);
  },
  
  async createUser(data) {
    return apiRequest('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  
  async updateUser(id, data) {
    return apiRequest(`/api/admin/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  
  async deleteUser(id) {
    return apiRequest(`/api/admin/users/${id}`, {
      method: 'DELETE',
    });
  },
  
  async resetUserPassword(id, newPassword) {
    return apiRequest(`/api/admin/users/${id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ newPassword }),
    });
  },
  
  async toggleUserStatus(id) {
    return apiRequest(`/api/admin/users/${id}/toggle-status`, {
      method: 'PUT',
    });
  },
  
  async refreshMaterializedViews() {
    return apiRequest('/api/admin/refresh-views', {
      method: 'POST',
    });
  },

  async batchParseReports() {
    return apiRequest('/api/admin/batch-parse', {
      method: 'POST',
    });
  },

  /**
   * LOCAL DEV ONLY — pull every report missing from the local DB out of
   * production so the two are equalised. Backed by backend/scripts/equalize_reports.py.
   */
  async equalizeReports() {
    return apiRequest('/api/admin/equalize-reports', {
      method: 'POST',
    });
  },
};

// ========== Utility Functions ==========

export const getFileUrl = (filePath) => {
  return `${API_URL}/files/${filePath}`;
};

export const healthCheck = async () => {
  try {
    const response = await fetch(`${API_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

// Default export for convenience
export default {
  auth: authAPI,
  reports: reportsAPI,
  dashboard: dashboardAPI,
  challenges: challengesAPI,
  email: emailAPI,
  gapAnalysis: gapAnalysisAPI,
  admin: adminAPI,
  getFileUrl,
  healthCheck,
};
