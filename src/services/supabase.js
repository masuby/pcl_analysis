import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

        export const supabase = createClient(supabaseUrl, supabaseKey);

        // Bucket configuration - ensure this matches your Supabase bucket
        export const REPORTS_BUCKET = 'Reports';


        export const getReportFileUrl = async (filePath) => {
        try {
            // 3 years in seconds
            const expiresIn = 3 * 365 * 24 * 60 * 60; // 94,608,000

            const { data, error } = await supabase.storage
            .from('Reports')
            .createSignedUrl(filePath, expiresIn);

            if (error) {
            console.error('Error creating signed URL:', error);
            throw error;
            }

            return data.signedUrl;
        } catch (err) {
            console.error('Failed to get file URL:', err);
            return null;
        }
        };


// Enhanced file upload with proper path handling
export const uploadReportFile = async (file, filePath) => {
  try {
    // Ensure proper path format
    const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    
    const { data, error } = await supabase.storage
      .from(REPORTS_BUCKET)
      .upload(cleanPath, file, {
        cacheControl: '3600',
        upsert: true // Changed to true to allow overwriting
      });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error uploading file:', error);
    return { success: false, error: error.message };
  }
};

// Check if bucket exists and file is accessible
export const checkFileAccessibility = async (filePath) => {
  try {
    const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    
    const { data, error } = await supabase.storage
      .from(REPORTS_BUCKET)
      .download(cleanPath);
    
    if (error) {
      console.error('File accessibility check failed:', error);
      return { success: false, error: error.message };
    }
    
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// List files in a folder with error handling
export const listReportFiles = async (folderPath = '') => {
  try {
    const cleanPath = folderPath.startsWith('/') ? folderPath.slice(1) : folderPath;
    
    const { data, error } = await supabase.storage
      .from(REPORTS_BUCKET)
      .list(cleanPath, {
        limit: 100,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' }
      });

    if (error) {
      // If bucket doesn't exist, return empty array
      if (error.message.includes('not found')) {
        console.warn('Bucket not found or empty:', error.message);
        return { success: true, data: [] };
      }
      throw error;
    }
    
    return { success: true, data };
  } catch (error) {
    console.error('Error listing files:', error);
    return { success: false, error: error.message };
  }
};

// Download file with progress tracking
export const downloadReportFile = async (filePath) => {
  try {
    const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    
    const { data, error } = await supabase.storage
      .from(REPORTS_BUCKET)
      .download(cleanPath);

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error downloading file:', error);
    return { success: false, error: error.message };
  }
};

// Delete file
export const deleteReportFile = async (filePath) => {
  try {
    const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
    
    const { data, error } = await supabase.storage
      .from(REPORTS_BUCKET)
      .remove([cleanPath]);

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error deleting file:', error);
    return { success: false, error: error.message };
  }
};
