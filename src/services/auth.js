import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail,
  updatePassword,
  updateProfile 
} from "firebase/auth";
import { auth } from "./firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

export const loginUser = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error) {
    let errorMessage = error.message;
    
    // User-friendly error messages
    if (error.code === 'auth/user-not-found') {
      errorMessage = 'No account found with this email.';
    } else if (error.code === 'auth/wrong-password') {
      errorMessage = 'Incorrect password.';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email address.';
    } else if (error.code === 'auth/too-many-requests') {
      errorMessage = 'Too many failed attempts. Please try again later.';
    }
    
    return { success: false, error: errorMessage };
  }
};

export const logoutUser = async () => {
  try {
    await signOut(auth);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const createUser = async (email, password, userData) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Add user data to Firestore with displayName
    await setDoc(doc(db, "users", userCredential.user.uid), {
      email: email,
      role: userData.role || "CS",
      department: userData.department || "CS",
      displayName: userData.displayName || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
      ...userData
    });
    
    return { success: true, user: userCredential.user };
  } catch (error) {
    let errorMessage = error.message;
    
    if (error.code === 'auth/email-already-in-use') {
      errorMessage = 'This email is already registered.';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'Password should be at least 6 characters.';
    }
    
    return { success: false, error: errorMessage };
  }
};

export const getUserData = async (userId) => {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    
    if (userDoc.exists()) {
      const data = userDoc.data();
      
      // Validate required fields
      if (!data.role) {
        return { 
          success: false, 
          error: "User data incomplete in Firestore" 
        };
      }
      
      // Return complete user data including displayName
      return { 
        success: true, 
        data: {
          uid: userId,
          email: data.email || '',
          displayName: data.displayName || '',
          role: data.role || 'user',
          department: data.department || '',
          createdAt: data.createdAt,
          updatedAt: data.updatedAt || data.createdAt,
          isActive: data.isActive !== undefined ? data.isActive : true
        }
      };
    }
    
    return { 
      success: false, 
      error: "User document not found in Firestore" 
    };
  } catch (error) {
    console.error("Error fetching user data from Firestore:", error);
    return { 
      success: false, 
      error: `Database error: ${error.message}` 
    };
  }
};

export const updateUserDataInFirestore = async (userId, userData) => {
  try {
    const updateData = {
      ...userData,
      updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, "users", userId), updateData, { merge: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const resetPassword = async (email) => {
  try {
    await sendPasswordResetEmail(auth, email);
    return { success: true };
  } catch (error) {
    let errorMessage = error.message;
    
    if (error.code === 'auth/user-not-found') {
      errorMessage = 'No account found with this email.';
    }
    
    return { success: false, error: errorMessage };
  }
};

export const updateUserPassword = async (currentPassword, newPassword) => {
  try {
    const user = auth.currentUser;
    
    if (!user || !user.email) {
      throw new Error('No authenticated user found');
    }

    // Note: For reauthentication, you'll need to implement this separately
    // as it requires current password verification
    await updatePassword(user, newPassword);
    
    return { success: true };
  } catch (error) {
    console.error('Error updating password:', error);
    
    let errorMessage = 'Failed to update password. ';
    if (error.code === 'auth/weak-password') {
      errorMessage += 'New password is too weak.';
    } else if (error.code === 'auth/requires-recent-login') {
      errorMessage += 'Please log in again to change your password.';
    } else {
      errorMessage += error.message;
    }
    
    return { success: false, error: errorMessage };
  }
};