/**
 * Authentication Service - Go Backend API
 * Replaces Firebase Authentication
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Token management
const getToken = () => localStorage.getItem('pcl_token');
const setToken = (token) => localStorage.setItem('pcl_token', token);
const removeToken = () => localStorage.removeItem('pcl_token');

// Store user data
const getUserFromStorage = () => {
  const data = localStorage.getItem('pcl_user');
  return data ? JSON.parse(data) : null;
};
const setUserToStorage = (user) => localStorage.setItem('pcl_user', JSON.stringify(user));
const removeUserFromStorage = () => localStorage.removeItem('pcl_user');

const REQUEST_TIMEOUT_MS = 15000; // 15 seconds

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
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  
  try {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      const hint = response.status === 404 ? ' Is the backend running?' : '';
      throw new Error(`Invalid response (${response.status})${hint}`);
    }
    
    // If token expired and this is not a retry, try to refresh
    if (!data.success && 
        (data.error?.includes('expired') || data.error?.includes('invalid') || response.status === 401) &&
        !isRetry && 
        endpoint !== '/api/auth/refresh' &&
        endpoint !== '/api/auth/login') {
      
      console.log('Token expired, attempting refresh...');
      
      // Try to refresh the token
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
      } else {
        // Refresh failed, clear auth and redirect to login
        console.log('Token refresh failed, logging out');
        removeToken();
        removeUserFromStorage();
        // Trigger a page reload to show login
        window.location.href = '/login';
        return { success: false, error: 'Session expired. Please log in again.' };
      }
    }
    
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      return { success: false, error: 'Connection timed out. Is the backend API running at ' + API_URL + '?' };
    }
    console.error('API Error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Login user with email and password
 */
export const loginUser = async (email, password) => {
  try {
    const response = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    
    if (response.success && response.data) {
      setToken(response.data.token);
      setUserToStorage(response.data.user);
      return { success: true, user: response.data.user };
    }
    
    return { success: false, error: response.error || 'Login failed' };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Logout user
 */
export const logoutUser = async () => {
  try {
    // Call logout endpoint (optional, JWT is stateless)
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    // Ignore errors, clear local storage anyway
  }
  
  removeToken();
  removeUserFromStorage();
  return { success: true };
};

/**
 * Register new user
 */
export const createUser = async (email, password, userData) => {
  try {
    const response = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        displayName: userData.displayName || '',
        role: userData.role || 'user',
        department: userData.department || '',
      }),
    });
    
    if (response.success && response.data) {
      setToken(response.data.token);
      setUserToStorage(response.data.user);
      return { success: true, user: response.data.user };
    }
    
    return { success: false, error: response.error || 'Registration failed' };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Get current user data
 */
export const getUserData = async (userId) => {
  try {
    // First check local storage
    const storedUser = getUserFromStorage();
    if (storedUser) {
      return { success: true, data: storedUser };
    }
    
    // Fetch from API
    const response = await apiRequest('/api/auth/me');
    
    if (response.success && response.data) {
      setUserToStorage(response.data);
      return { success: true, data: response.data };
    }
    
    return { success: false, error: response.error || 'Failed to get user data' };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Update user profile
 */
export const updateUserDataInFirestore = async (userId, userData) => {
  try {
    const response = await apiRequest('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
    
    if (response.success && response.data) {
      setUserToStorage(response.data);
      return { success: true, data: response.data };
    }
    
    return { success: false, error: response.error || 'Failed to update profile' };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Reset password (sends email to admin for now)
 */
export const resetPassword = async (email) => {
  // In a real implementation, this would send a reset email
  // For now, show a message to contact admin
  return { 
    success: true, 
    message: 'Please contact admin@pcl.com to reset your password.' 
  };
};

/**
 * Update user password
 */
export const updateUserPassword = async (currentPassword, newPassword) => {
  try {
    const response = await apiRequest('/api/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    
    if (response.success) {
      return { success: true };
    }
    
    return { success: false, error: response.error || 'Failed to update password' };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Check if user is authenticated
 */
export const isAuthenticated = () => {
  return !!getToken();
};

/**
 * Get current token
 */
export const getAuthToken = () => getToken();

/**
 * Refresh token
 */
export const refreshToken = async () => {
  try {
    const response = await apiRequest('/api/auth/refresh', { method: 'POST' });
    
    if (response.success && response.data?.token) {
      setToken(response.data.token);
      return { success: true };
    }
    
    return { success: false, error: response.error || 'Failed to refresh token' };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
