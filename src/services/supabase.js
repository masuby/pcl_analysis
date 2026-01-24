/**
 * File Storage Service - Go Backend API
 * Replaces Supabase Storage
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Get auth token
const getToken = () => localStorage.getItem('pcl_token');

// Bucket name (for backward compatibility)
export const REPORTS_BUCKET = 'reports';
export const CHALLENGES_BUCKET = 'challenges';

// Get report file URL (now local)
export const getReportFileUrl = async (filePath) => {
  try {
    // Return direct URL to static files served by Go
    const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    return `${API_URL}/files/${cleanPath}`;
  } catch (err) {
    console.error('Failed to get file URL:', err);
    return null;
  }
};

// Upload report file with all required fields
export const uploadReportFile = async (file, filePath, reportData = {}) => {
  try {
    const token = getToken();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', filePath);
    
    // Add required fields for backend
    if (reportData.title) formData.append('title', reportData.title);
    if (reportData.department) formData.append('department', reportData.department);
    if (reportData.type) formData.append('type', reportData.type);
    if (reportData.date) formData.append('date', reportData.date);
    
    const response = await fetch(`${API_URL}/api/reports`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error uploading file:', error);
    return { success: false, error: error.message };
  }
};

// Check if file is accessible
export const checkFileAccessibility = async (filePath) => {
  try {
    const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    const response = await fetch(`${API_URL}/files/${cleanPath}`, {
      method: 'HEAD',
    });
    
    return { success: response.ok };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// List files (not directly supported, use reports API)
export const listReportFiles = async (folderPath = '') => {
  return { success: true, data: [] };
};

// Download report file
export const downloadReportFile = async (filePath) => {
  try {
    const token = getToken();
    const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    
    const response = await fetch(`${API_URL}/files/${cleanPath}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    if (!response.ok) throw new Error('Download failed');
    
    const data = await response.blob();
    return { success: true, data };
  } catch (error) {
    console.error('Error downloading file:', error);
    return { success: false, error: error.message };
  }
};

// Delete report file (handled through reports API)
export const deleteReportFile = async (filePath) => {
  return { success: true };
};

// ============ Challenge Storage Functions ============

// Upload challenge image
export const uploadChallengeImage = async (file, department, challengeId) => {
  try {
    const token = getToken();
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(`${API_URL}/api/challenges/${challengeId}/image`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });
    
    const data = await response.json();
    if (data.success) {
      return { success: true, filePath: data.data?.image_url };
    }
    return data;
  } catch (error) {
    console.error('Error uploading challenge image:', error);
    return { success: false, error: error.message };
  }
};

// Get challenge image URL
export const getChallengeImageUrl = async (filePath) => {
  try {
    if (!filePath) return null;
    const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    return `${API_URL}/files/${cleanPath}`;
  } catch (err) {
    console.error('Failed to get challenge image URL:', err);
    return null;
  }
};

// Upload challenge attachment
export const uploadChallengeAttachment = async (file, department, challengeId) => {
  try {
    const token = getToken();
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(`${API_URL}/api/challenges/${challengeId}/attachment`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });
    
    const data = await response.json();
    if (data.success) {
      return { success: true, filePath: data.data?.attachment_url };
    }
    return data;
  } catch (error) {
    console.error('Error uploading challenge attachment:', error);
    return { success: false, error: error.message };
  }
};

// Get challenge attachment URL
export const getChallengeAttachmentUrl = async (filePath) => {
  try {
    if (!filePath) return null;
    const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    return `${API_URL}/files/${cleanPath}`;
  } catch (err) {
    console.error('Failed to get challenge attachment URL:', err);
    return null;
  }
};

// Delete challenge file
export const deleteChallengeFile = async (filePath) => {
  // Handled through challenges API
  return { success: true };
};

// Create a mock supabase client for backward compatibility
export const supabase = {
  storage: {
    from: (bucket) => ({
      upload: uploadReportFile,
      download: downloadReportFile,
      createSignedUrl: async (path) => ({ data: { signedUrl: await getReportFileUrl(path) } }),
      remove: async () => ({ success: true }),
      list: async () => ({ data: [] }),
    }),
  },
};
