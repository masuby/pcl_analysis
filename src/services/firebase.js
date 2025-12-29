import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  updatePassword, 
  reauthenticateWithCredential,
  EmailAuthProvider 
} from 'firebase/auth';
import { 
  doc, 
  updateDoc, 
  getDoc,
  getFirestore 
} from 'firebase/firestore';
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);

/**
 * Update user profile in Firestore
 * @param {string} userId - User ID
 * @param {Object} data - Data to update (displayName, etc.)
 */
export const updateUserProfile = async (userId, data) => {
  try {
    const userRef = doc(db, 'users', userId);
    const updateData = {
      ...data,
      updatedAt: new Date().toISOString()
    };
    
    await updateDoc(userRef, updateData);
    return { success: true };
  } catch (error) {
    console.error('Error updating profile:', error);
    throw new Error('Failed to update profile: ' + error.message);
  }
};

/**
 * Change user password
 * @param {string} currentPassword - Current password
 * @param {string} newPassword - New password
 */
export const changePassword = async (currentPassword, newPassword) => {
  try {
    const user = auth.currentUser;
    
    if (!user || !user.email) {
      throw new Error('No authenticated user found');
    }

    // Re-authenticate user
    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    await reauthenticateWithCredential(user, credential);
    
    // Update password
    await updatePassword(user, newPassword);
    
    return { success: true };
  } catch (error) {
    console.error('Error changing password:', error);
    
    let errorMessage = 'Failed to change password. ';
    switch (error.code) {
      case 'auth/wrong-password':
        errorMessage += 'Current password is incorrect.';
        break;
      case 'auth/weak-password':
        errorMessage += 'New password is too weak.';
        break;
      case 'auth/requires-recent-login':
        errorMessage += 'Please log in again and try.';
        break;
      default:
        errorMessage += error.message;
    }
    
    throw new Error(errorMessage);
  }
};

/**
 * Get current user's profile data from Firestore
 * @param {string} userId - User ID
 */
export const getUserProfile = async (userId) => {
  try {
    const userRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
      return userDoc.data();
    }
    
    throw new Error('User profile not found');
  } catch (error) {
    console.error('Error getting user profile:', error);
    throw error;
  }
};