import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  where,
  limit,
  serverTimestamp 
} from 'firebase/firestore';
import { db } from './firebase';

const CHALLENGES_COLLECTION = 'Challenge';

// Create a new challenge
export const createChallenge = async (challengeData) => {
  try {
    const challengeId = `challenge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const challengeRef = doc(db, CHALLENGES_COLLECTION, challengeId);
    
    const challenge = {
      id: challengeId,
      ...challengeData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      isActive: true
    };

    await setDoc(challengeRef, challenge);
    return { success: true, data: challenge };
  } catch (error) {
    console.error('Error creating challenge:', error);
    return { success: false, error: error.message };
  }
};

// Get all challenges
export const getAllChallenges = async (options = {}) => {
  try {
    const { limit: limitNum = 100, orderBy: order = 'createdAt', orderDir = 'desc' } = options;
    const challengesRef = collection(db, CHALLENGES_COLLECTION);
    const q = query(challengesRef, orderBy(order, orderDir), limit(limitNum));
    
    const querySnapshot = await getDocs(q);
    const challenges = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      challenges.push({
        id: doc.id,
        ...data,
        // Convert Firestore timestamps to dates
        startDate: data.startDate?.toDate ? data.startDate.toDate() : new Date(data.startDate),
        endDate: data.endDate?.toDate ? data.endDate.toDate() : new Date(data.endDate),
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
        updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)
      });
    });

    return { success: true, data: challenges };
  } catch (error) {
    console.error('Error fetching challenges:', error);
    return { success: false, error: error.message };
  }
};

// Get challenge by ID
export const getChallengeById = async (challengeId) => {
  try {
    const challengeRef = doc(db, CHALLENGES_COLLECTION, challengeId);
    const challengeSnap = await getDoc(challengeRef);
    
    if (challengeSnap.exists()) {
      const data = challengeSnap.data();
      return { 
        success: true, 
        data: {
          id: challengeSnap.id,
          ...data,
          startDate: data.startDate?.toDate ? data.startDate.toDate() : new Date(data.startDate),
          endDate: data.endDate?.toDate ? data.endDate.toDate() : new Date(data.endDate),
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)
        }
      };
    }
    
    return { success: false, error: 'Challenge not found' };
  } catch (error) {
    console.error('Error fetching challenge:', error);
    return { success: false, error: error.message };
  }
};

// Update challenge
export const updateChallenge = async (challengeId, challengeData) => {
  try {
    const challengeRef = doc(db, CHALLENGES_COLLECTION, challengeId);
    
    await updateDoc(challengeRef, {
      ...challengeData,
      updatedAt: serverTimestamp()
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating challenge:', error);
    return { success: false, error: error.message };
  }
};

// Delete challenge
export const deleteChallenge = async (challengeId) => {
  try {
    const challengeRef = doc(db, CHALLENGES_COLLECTION, challengeId);
    await deleteDoc(challengeRef);
    return { success: true };
  } catch (error) {
    console.error('Error deleting challenge:', error);
    return { success: false, error: error.message };
  }
};

// Search challenges
export const searchChallenges = async (searchTerm) => {
  try {
    const challengesRef = collection(db, CHALLENGES_COLLECTION);
    const allChallenges = await getDocs(challengesRef);
    
    const searchLower = searchTerm.toLowerCase();
    const results = [];
    
    allChallenges.forEach((doc) => {
      const data = doc.data();
      const title = (data.title || '').toLowerCase();
      const description = (data.description || '').toLowerCase();
      const department = (data.department || '').toLowerCase();
      
      if (title.includes(searchLower) || 
          description.includes(searchLower) || 
          department.includes(searchLower)) {
        results.push({
          id: doc.id,
          ...data,
          startDate: data.startDate?.toDate ? data.startDate.toDate() : new Date(data.startDate),
          endDate: data.endDate?.toDate ? data.endDate.toDate() : new Date(data.endDate),
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)
        });
      }
    });
    
    return { success: true, data: results };
  } catch (error) {
    console.error('Error searching challenges:', error);
    return { success: false, error: error.message };
  }
};

// Get challenges by department
export const getChallengesByDepartment = async (department) => {
  try {
    const challengesRef = collection(db, CHALLENGES_COLLECTION);
    const q = query(
      challengesRef, 
      where('department', '==', department),
      orderBy('createdAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    const challenges = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      challenges.push({
        id: doc.id,
        ...data,
        startDate: data.startDate?.toDate ? data.startDate.toDate() : new Date(data.startDate),
        endDate: data.endDate?.toDate ? data.endDate.toDate() : new Date(data.endDate),
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
        updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(data.updatedAt)
      });
    });

    return { success: true, data: challenges };
  } catch (error) {
    console.error('Error fetching department challenges:', error);
    return { success: false, error: error.message };
  }
};

// Get challenge status (finished, incoming, ongoing)
export const getChallengeStatus = (challenge) => {
  if (!challenge.startDate || !challenge.endDate) return 'unknown';
  
  const now = new Date();
  const startDate = challenge.startDate?.toDate ? challenge.startDate.toDate() : new Date(challenge.startDate);
  const endDate = challenge.endDate?.toDate ? challenge.endDate.toDate() : new Date(challenge.endDate);
  
  if (now < startDate) return 'incoming';
  if (now > endDate) return 'finished';
  return 'ongoing';
};
