import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { getUserData } from '../services/auth';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        
        // Fetch user data from Firestore
        try {
          const result = await getUserData(firebaseUser.uid);
          
          if (result.success) {
            // Successfully got user data from Firestore
            setUserData(result.data);
            setError(null);
          } else {
            // User not found in Firestore - create minimal user data
            setError(result.error);
            console.warn('User not found in Firestore, creating minimal data:', result.error);
            
            setUserData({
              uid: firebaseUser.uid,
              email: firebaseUser.email,
              displayName: firebaseUser.displayName || '',
              role: 'user', // Default role
              department: '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              isActive: true
            });
          }
        } catch (err) {
          // Error occurred during fetch - create minimal user data
          setError(err.message);
          console.error('Error fetching user data:', err);
          
          setUserData({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName || '',
            role: 'user', // Default role
            department: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isActive: true
          });
        }
      } else {
        // User logged out
        setUser(null);
        setUserData(null);
        setError(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const updateUserData = (data) => {
    setUserData(prev => ({ ...prev, ...data }));
  };

  const refreshUserData = async () => {
    if (user) {
      // Don't set global loading state to avoid showing "Authenticating..." in PrivateRoute
      // The calling component (Sidebar) will handle its own loading state
      try {
        const result = await getUserData(user.uid);
        if (result.success) {
          setUserData(result.data);
          setError(null);
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err.message);
      }
    }
  };

  const value = {
    user,
    userData,
    loading,
    error,
    updateUserData,
    refreshUserData
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};