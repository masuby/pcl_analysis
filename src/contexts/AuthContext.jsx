import React, { createContext, useContext, useState, useEffect } from 'react';
import { getUserData, logoutUser, isAuthenticated, getAuthToken } from '../services/auth';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check authentication on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // Check if we have a token
      if (!isAuthenticated()) {
        setUser(null);
        setUserData(null);
        setLoading(false);
        return;
      }

      // Fetch user data
      const result = await getUserData();
      
      if (result.success && result.data) {
        setUser({ id: result.data.id, email: result.data.email });
        setUserData(result.data);
        setError(null);
      } else {
        // Token might be invalid, clear it
        await logoutUser();
        setUser(null);
        setUserData(null);
        setError(result.error);
      }
    } catch (err) {
      console.error('Error checking auth:', err);
      setError(err.message);
      setUser(null);
      setUserData(null);
    } finally {
      setLoading(false);
    }
  };

  const login = (userData, token) => {
    setUser({ id: userData.id, email: userData.email });
    setUserData(userData);
    setError(null);
  };

  const logout = async () => {
    await logoutUser();
    setUser(null);
    setUserData(null);
    setError(null);
  };

  const updateUserData = (data) => {
    setUserData(prev => ({ ...prev, ...data }));
    // Update localStorage
    const stored = localStorage.getItem('pcl_user');
    if (stored) {
      const user = JSON.parse(stored);
      localStorage.setItem('pcl_user', JSON.stringify({ ...user, ...data }));
    }
  };

  const refreshUserData = async () => {
    try {
      const result = await getUserData();
      if (result.success && result.data) {
        setUserData(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const value = {
    user,
    userData,
    loading,
    error,
    login,
    logout,
    updateUserData,
    refreshUserData,
    isAuthenticated: () => isAuthenticated(),
    getToken: () => getAuthToken(),
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
