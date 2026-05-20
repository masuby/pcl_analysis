/**
 * Dashboard Service - Go Backend API
 * Provides aggregated dashboard data
 */

import { cacheGet, cacheSet, cacheInvalidate } from './cache';

// Allow VITE_API_URL to be explicitly empty ('') to mean "use same origin".
// If VITE_API_URL is undefined (not set), fall back to localhost for local development.
const envApiUrl = import.meta.env.VITE_API_URL;
const API_URL = envApiUrl === undefined ? 'http://localhost:8080' : envApiUrl;

// Get auth token
const getToken = () => localStorage.getItem('pcl_token');

// API request helper
const apiRequest = async (endpoint, options = {}) => {
  const token = getToken();
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('API Error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get dashboard data with optional filters
 */
export const getDashboardData = async (filters = {}) => {
  try {
    // Check cache first
    const cacheParams = { ...filters };
    const cached = cacheGet('dashboard', cacheParams);
    if (cached) {
      console.log('[Cache] Dashboard data loaded from', cached.source);
      return { success: true, data: cached.data.data || [], _cached: true };
    }
    
    const params = new URLSearchParams();
    
    if (filters.department) params.append('department', filters.department);
    if (filters.reportType) params.append('report_type', filters.reportType);
    if (filters.startDate) params.append('start_date', filters.startDate);
    if (filters.endDate) params.append('end_date', filters.endDate);
    if (filters.metric) params.append('metric', filters.metric);
    
    const queryString = params.toString();
    const endpoint = `/api/dashboard${queryString ? `?${queryString}` : ''}`;
    
    const response = await apiRequest(endpoint);
    
    if (response.success) {
      // Cache the result
      cacheSet('dashboard', cacheParams, response);
      return { success: true, data: response.data || [] };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get dashboard statistics summary
 */
export const getDashboardStats = async () => {
  try {
    // Check cache first
    const cached = cacheGet('stats', { type: 'dashboard' });
    if (cached) {
      console.log('[Cache] Dashboard stats loaded from', cached.source);
      return { success: true, data: cached.data.data, _cached: true };
    }
    
    const response = await apiRequest('/api/dashboard/stats');
    
    if (response.success) {
      // Cache the result
      cacheSet('stats', { type: 'dashboard' }, response);
      return { success: true, data: response.data };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get available metrics for filtering
 */
export const getAvailableMetrics = async (department) => {
  try {
    const params = department ? `?department=${department}` : '';
    const response = await apiRequest(`/api/dashboard/metrics${params}`);
    
    if (response.success) {
      return { success: true, data: response.data || [] };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching available metrics:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get available dates for filtering
 */
export const getAvailableDates = async (department) => {
  try {
    const params = department ? `?department=${department}` : '';
    const response = await apiRequest(`/api/dashboard/dates${params}`);
    
    if (response.success) {
      return { success: true, data: response.data || [] };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching available dates:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Refresh materialized views (admin only)
 */
export const refreshDashboardViews = async () => {
  try {
    const response = await apiRequest('/api/admin/refresh-views', {
      method: 'POST',
    });
    
    // Invalidate all caches on refresh
    if (response.success) {
      cacheInvalidate('dashboard');
      cacheInvalidate('stats');
      cacheInvalidate('reports');
    }
    
    return response;
  } catch (error) {
    console.error('Error refreshing views:', error);
    return { success: false, error: error.message };
  }
};
