/**
 * Firebase Service - DEPRECATED
 * This file is kept for backward compatibility but now uses Go backend
 * All Firebase functionality has been migrated to local Go API
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Get auth token
const getToken = () => localStorage.getItem('pcl_token');

// Mock auth object for backward compatibility
export const auth = {
  currentUser: null,
  onAuthStateChanged: (callback) => {
    // Check if we have a stored user
    const storedUser = localStorage.getItem('pcl_user');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        auth.currentUser = user;
        callback(user);
      } catch (e) {
        callback(null);
      }
    } else {
      callback(null);
    }
    // Return unsubscribe function
    return () => {};
  }
};

// Mock db object for backward compatibility
export const db = {
  // Add any required mock methods here if needed
};

// Mock analytics
export const analytics = null;

/**
 * Update user profile (now uses Go API)
 */
export const updateUserProfile = async (userId, data) => {
  try {
    const token = getToken();
    
    const response = await fetch(`${API_URL}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Update local storage
      const storedUser = localStorage.getItem('pcl_user');
      if (storedUser) {
        const user = JSON.parse(storedUser);
        localStorage.setItem('pcl_user', JSON.stringify({ ...user, ...data }));
      }
      return { success: true };
    }
    
    throw new Error(result.error || 'Failed to update profile');
  } catch (error) {
    console.error('Error updating profile:', error);
    throw new Error('Failed to update profile: ' + error.message);
  }
};

/**
 * Change user password (now uses Go API)
 */
export const changePassword = async (currentPassword, newPassword) => {
  try {
    const token = getToken();
    
    const response = await fetch(`${API_URL}/api/auth/password`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    
    const result = await response.json();
    
    if (result.success) {
      return { success: true };
    }
    
    throw new Error(result.error || 'Failed to change password');
  } catch (error) {
    console.error('Error changing password:', error);
    
    let errorMessage = 'Failed to change password. ';
    if (error.message.includes('incorrect')) {
      errorMessage += 'Current password is incorrect.';
    } else if (error.message.includes('weak')) {
      errorMessage += 'New password is too weak.';
    } else {
      errorMessage += error.message;
    }
    
    throw new Error(errorMessage);
  }
};

/**
 * Get current user's profile data (now uses Go API)
 */
export const getUserProfile = async (userId) => {
  try {
    const token = getToken();
    
    const response = await fetch(`${API_URL}/api/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    const result = await response.json();
    
    if (result.success && result.data) {
      return result.data;
    }
    
    throw new Error('User profile not found');
  } catch (error) {
    console.error('Error getting user profile:', error);
    throw error;
  }
};
