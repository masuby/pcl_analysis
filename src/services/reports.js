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

const REPORTS_COLLECTION = 'reports';

// Create a new report
export const createReport = async (reportData) => {
  try {
    const reportId = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const reportRef = doc(db, REPORTS_COLLECTION, reportId);
    
    const report = {
      id: reportId,
      ...reportData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      views: 0,
      downloads: 0,
      isActive: true
    };

    await setDoc(reportRef, report);
    return { success: true, data: report };
  } catch (error) {
    console.error('Error creating report:', error);
    return { success: false, error: error.message };
  }
};

// Get all reports
export const getAllReports = async (options = {}) => {
  try {
    const { limit: limitNum = 100, orderBy: order = 'createdAt', orderDir = 'desc' } = options;
    const reportsRef = collection(db, REPORTS_COLLECTION);
    const q = query(reportsRef, orderBy(order, orderDir), limit(limitNum));
    
    const querySnapshot = await getDocs(q);
    const reports = [];
    
    querySnapshot.forEach((doc) => {
      reports.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return { success: true, data: reports };
  } catch (error) {
    console.error('Error fetching reports:', error);
    return { success: false, error: error.message };
  }
};

// Get recent reports (limit 3 for dashboard)
export const getRecentReports = async (limitNum = 3) => {
  try {
    const reportsRef = collection(db, REPORTS_COLLECTION);
    const q = query(reportsRef, orderBy('createdAt', 'desc'), limit(limitNum));
    
    const querySnapshot = await getDocs(q);
    const reports = [];
    
    querySnapshot.forEach((doc) => {
      reports.push({
        id: doc.id,
        ...doc.data()
      });
    });



    return { success: true, data: reports };
  } catch (error) {
    console.error('Error fetching recent reports:', error);
    return { success: false, error: error.message };
  }
};

// Get report by ID
export const getReportById = async (reportId) => {
  try {
    const reportRef = doc(db, REPORTS_COLLECTION, reportId);
    const reportSnap = await getDoc(reportRef);
    
    if (reportSnap.exists()) {
      return { success: true, data: reportSnap.data() };
    } else {
      return { success: false, error: 'Report not found' };
    }
  } catch (error) {
    console.error('Error fetching report:', error);
    return { success: false, error: error.message };
  }
};

// Update report
export const updateReport = async (reportId, reportData) => {
  try {
    const reportRef = doc(db, REPORTS_COLLECTION, reportId);
    
    await updateDoc(reportRef, {
      ...reportData,
      updatedAt: serverTimestamp()
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating report:', error);
    return { success: false, error: error.message };
  }
};

// Delete report
export const deleteReport = async (reportId) => {
  try {
    const reportRef = doc(db, REPORTS_COLLECTION, reportId);
    await deleteDoc(reportRef);
    return { success: true };
  } catch (error) {
    console.error('Error deleting report:', error);
    return { success: false, error: error.message };
  }
};

// Search reports
export const searchReports = async (searchTerm) => {
  try {
    const reportsRef = collection(db, REPORTS_COLLECTION);
    const q = query(
      reportsRef, 
      orderBy('createdAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    const reports = [];
    
    querySnapshot.forEach((doc) => {
      const report = doc.data();
      
      // Client-side filtering
      if (
        report.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        report.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        report.department?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        report.type?.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        reports.push({
          id: doc.id,
          ...report
        });
      }
    });

    return { success: true, data: reports };
  } catch (error) {
    console.error('Error searching reports:', error);
    return { success: false, error: error.message };
  }
};

// Get reports by department
export const getReportsByDepartment = async (department) => {
  try {
    const reportsRef = collection(db, REPORTS_COLLECTION);
    const q = query(
      reportsRef, 
      where('department', '==', department),
      orderBy('createdAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    const reports = [];
    
    querySnapshot.forEach((doc) => {
      reports.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return { success: true, data: reports };
  } catch (error) {
    console.error('Error fetching department reports:', error);
    return { success: false, error: error.message };
  }
};

// Increment report views
export const incrementReportViews = async (reportId) => {
  try {
    const reportRef = doc(db, REPORTS_COLLECTION, reportId);
    const reportSnap = await getDoc(reportRef);
    
    if (reportSnap.exists()) {
      const report = reportSnap.data();
      await updateDoc(reportRef, {
        views: (report.views || 0) + 1,
        updatedAt: serverTimestamp()
      });
      return { success: true };
    }
    
    return { success: false, error: 'Report not found' };
  } catch (error) {
    console.error('Error incrementing views:', error);
    return { success: false, error: error.message };
  }
};

// Increment report downloads - ADD THIS FUNCTION
export const incrementReportDownloads = async (reportId) => {
  try {
    const reportRef = doc(db, REPORTS_COLLECTION, reportId);
    const reportSnap = await getDoc(reportRef);
    
    if (reportSnap.exists()) {
      const report = reportSnap.data();
      await updateDoc(reportRef, {
        downloads: (report.downloads || 0) + 1,
        updatedAt: serverTimestamp()
      });
      return { success: true };
    }
    
    return { success: false, error: 'Report not found' };
  } catch (error) {
    console.error('Error incrementing downloads:', error);
    return { success: false, error: error.message };
  }
};

// Get reports by department and type (for CS Reports page)
export const getReportsByDepartmentAndType = async (department, reportType) => {
  try {
    const reportsRef = collection(db, REPORTS_COLLECTION);
    
    // Query for CS department or ALL department
    const q = query(
      reportsRef,
      where('department', 'in', [department, 'ALL']),
      where('type', '==', reportType),
      where('isActive', '==', true),
      orderBy('date', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    const reports = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      reports.push({
        id: doc.id,
        ...data,
        // Ensure date is properly formatted
        date: data.date?.toDate ? data.date.toDate() : new Date(data.date)
      });
    });

    return { success: true, data: reports };
  } catch (error) {
    console.error('Error fetching department reports:', error);
    return { success: false, error: error.message };
  }
};

// Get unique dates from reports for filtering
export const getUniqueDatesFromReports = async (department, reportType) => {
  try {
    const result = await getReportsByDepartmentAndType(department, reportType);
    
    if (!result.success) {
      return { success: false, error: result.error };
    }
    
    // Extract unique dates
    const dates = [...new Set(
      result.data
        .map(report => {
          const date = report.date;
          return date ? new Date(date).toISOString().split('T')[0] : null;
        })
        .filter(date => date !== null)
        .sort((a, b) => new Date(b) - new Date(a)) // Sort descending
    )];
    
    return { success: true, data: dates };
  } catch (error) {
    console.error('Error extracting dates:', error);
    return { success: false, error: error.message };
  }
};

// Download all reports as ZIP
export const downloadAllReportsAsZip = async (reports) => {
  try {
    const JSZip = await import('jszip');
    const { saveAs } = await import('file-saver');
    
    const zip = new JSZip.default();
    const folder = zip.folder('CS_Reports');
    
    // Add each report to zip
    for (const report of reports) {
      try {
        const response = await fetch(report.fileUrl || getReportFileUrl(report.filePath));
        if (!response.ok) throw new Error(`Failed to fetch ${report.fileName}`);
        
        const blob = await response.blob();
        folder.file(report.fileName, blob);
        
        // Update download count
        await incrementReportDownloads(report.id);
      } catch (error) {
        console.error(`Error adding ${report.fileName} to zip:`, error);
      }
    }
    
    // Generate zip file
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `CS_Reports_${new Date().toISOString().split('T')[0]}.zip`);
    
    return { success: true };
  } catch (error) {
    console.error('Error creating zip file:', error);
    return { success: false, error: error.message };
  }
};

// Get report analysis data (placeholder for now)
export const getReportAnalysis = async (reportId) => {
  try {
    // This would connect to your analysis backend
    // For now, return mock data
    return { 
      success: true, 
      data: {
        summary: "Analysis data will be available soon.",
        metrics: [],
        insights: []
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};