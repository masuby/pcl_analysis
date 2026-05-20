/**
 * Admin Users Service - Go Backend API
 */

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

// Get all users (admin only)
export const getAllUsers = async () => {
  try {
    const response = await apiRequest('/api/admin/users');
    
    if (response.success) {
      return { success: true, data: response.data || [] };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching users:', error);
    return { success: false, error: error.message };
  }
};

// Get user by ID (admin only)
export const getUserById = async (userId) => {
  try {
    const response = await apiRequest(`/api/admin/users/${userId}`);
    
    if (response.success) {
      return { success: true, data: response.data };
    }
    
    return { success: false, error: response.error || 'User not found' };
  } catch (error) {
    console.error('Error fetching user:', error);
    return { success: false, error: error.message };
  }
};

// Create new user (admin only)
export const createUser = async (userData) => {
  try {
    const response = await apiRequest('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: userData.email,
        password: userData.password,
        displayName: userData.displayName || userData.display_name || '',
        role: userData.role || 'user',
        department: userData.department || '',
      }),
    });
    
    return response;
  } catch (error) {
    console.error('Error creating user:', error);
    return { success: false, error: error.message };
  }
};

// Update user (admin only)
export const updateUser = async (userId, userData) => {
  try {
    const response = await apiRequest(`/api/admin/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({
        displayName: userData.displayName || userData.display_name,
        role: userData.role,
        department: userData.department,
        isActive: userData.isActive !== undefined ? userData.isActive : userData.is_active,
      }),
    });
    
    return response;
  } catch (error) {
    console.error('Error updating user:', error);
    return { success: false, error: error.message };
  }
};

// Delete user (admin only)
export const deleteUser = async (userId) => {
  try {
    const response = await apiRequest(`/api/admin/users/${userId}`, {
      method: 'DELETE',
    });
    
    return response;
  } catch (error) {
    console.error('Error deleting user:', error);
    return { success: false, error: error.message };
  }
};

// Search users (admin only)
export const searchUsers = async (searchTerm) => {
  try {
    const params = new URLSearchParams({ q: searchTerm });
    const response = await apiRequest(`/api/admin/users/search?${params}`);
    
    if (response.success) {
      return { success: true, data: response.data || [] };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error searching users:', error);
    return { success: false, error: error.message };
  }
};

// Reset user password (admin only)
export const resetUserPassword = async (userId, newPassword) => {
  try {
    const response = await apiRequest(`/api/admin/users/${userId}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password: newPassword }),
    });
    
    return response;
  } catch (error) {
    console.error('Error resetting password:', error);
    return { success: false, error: error.message };
  }
};

// Toggle user status (admin only)
export const toggleUserStatus = async (userId) => {
  try {
    const response = await apiRequest(`/api/admin/users/${userId}/toggle-status`, {
      method: 'PUT',
    });
    
    return response;
  } catch (error) {
    console.error('Error toggling user status:', error);
    return { success: false, error: error.message };
  }
};
