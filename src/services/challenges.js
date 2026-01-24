/**
 * Challenges Service - Go Backend API
 * Replaces Firebase Firestore
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Get auth token
const getToken = () => localStorage.getItem('pcl_token');

// API request helper
const apiRequest = async (endpoint, options = {}) => {
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
    return data;
  } catch (error) {
    console.error('API Error:', error);
    return { success: false, error: error.message };
  }
};

// Create a new challenge
export const createChallenge = async (challengeData) => {
  try {
    const response = await apiRequest('/api/challenges', {
      method: 'POST',
      body: JSON.stringify({
        title: challengeData.title,
        description: challengeData.description,
        department: challengeData.department,
        start_date: challengeData.startDate,
        end_date: challengeData.endDate,
        priority: challengeData.priority || 'medium',
        image_url: challengeData.imageUrl || '',
        attachment_url: challengeData.attachmentUrl || '',
      }),
    });
    
    return response;
  } catch (error) {
    console.error('Error creating challenge:', error);
    return { success: false, error: error.message };
  }
};

// Get all challenges
export const getAllChallenges = async (options = {}) => {
  try {
    const { limit = 100 } = options;
    const params = new URLSearchParams({ limit: String(limit) });
    
    const response = await apiRequest(`/api/challenges?${params}`);
    
    if (response.success) {
      // Map backend fields to frontend expected fields
      const challenges = (response.data || []).map(mapChallengeFromBackend);
      return { success: true, data: challenges };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching challenges:', error);
    return { success: false, error: error.message };
  }
};

// Get challenge by ID
export const getChallengeById = async (challengeId) => {
  try {
    const response = await apiRequest(`/api/challenges/${challengeId}`);
    
    if (response.success && response.data) {
      return { success: true, data: mapChallengeFromBackend(response.data) };
    }
    
    return { success: false, error: response.error || 'Challenge not found' };
  } catch (error) {
    console.error('Error fetching challenge:', error);
    return { success: false, error: error.message };
  }
};

// Update challenge
export const updateChallenge = async (challengeId, challengeData) => {
  try {
    const response = await apiRequest(`/api/challenges/${challengeId}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: challengeData.title,
        description: challengeData.description,
        department: challengeData.department,
        start_date: challengeData.startDate,
        end_date: challengeData.endDate,
        priority: challengeData.priority,
        image_url: challengeData.imageUrl,
        attachment_url: challengeData.attachmentUrl,
      }),
    });
    
    return response;
  } catch (error) {
    console.error('Error updating challenge:', error);
    return { success: false, error: error.message };
  }
};

// Delete challenge
export const deleteChallenge = async (challengeId) => {
  try {
    const response = await apiRequest(`/api/challenges/${challengeId}`, {
      method: 'DELETE',
    });
    
    return response;
  } catch (error) {
    console.error('Error deleting challenge:', error);
    return { success: false, error: error.message };
  }
};

// Search challenges
export const searchChallenges = async (searchTerm) => {
  try {
    const params = new URLSearchParams({ q: searchTerm });
    const response = await apiRequest(`/api/challenges/search?${params}`);
    
    if (response.success) {
      const challenges = (response.data || []).map(mapChallengeFromBackend);
      return { success: true, data: challenges };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error searching challenges:', error);
    return { success: false, error: error.message };
  }
};

// Get challenges by department
export const getChallengesByDepartment = async (department) => {
  try {
    const response = await apiRequest(`/api/challenges/department/${department}`);
    
    if (response.success) {
      const challenges = (response.data || []).map(mapChallengeFromBackend);
      return { success: true, data: challenges };
    }
    
    return { success: false, error: response.error };
  } catch (error) {
    console.error('Error fetching department challenges:', error);
    return { success: false, error: error.message };
  }
};

// Get challenge status (finished, incoming, ongoing)
export const getChallengeStatus = (challenge) => {
  if (!challenge.startDate || !challenge.endDate) return 'unknown';
  
  const now = new Date();
  const startDate = new Date(challenge.startDate);
  const endDate = new Date(challenge.endDate);
  
  if (now < startDate) return 'incoming';
  if (now > endDate) return 'finished';
  return 'ongoing';
};

// Helper: Map backend challenge to frontend format
const mapChallengeFromBackend = (challenge) => {
  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    department: challenge.department,
    startDate: challenge.start_date ? new Date(challenge.start_date) : null,
    endDate: challenge.end_date ? new Date(challenge.end_date) : null,
    priority: challenge.priority,
    imageUrl: challenge.image_url,
    attachmentUrl: challenge.attachment_url,
    status: challenge.status,
    createdAt: challenge.created_at ? new Date(challenge.created_at) : new Date(),
    updatedAt: challenge.updated_at ? new Date(challenge.updated_at) : new Date(),
    isActive: true,
  };
};
