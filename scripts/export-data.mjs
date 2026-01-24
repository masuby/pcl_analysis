#!/usr/bin/env node
/**
 * Data Export Script for PCL Analysis
 * 
 * This script exports all data from Firebase Firestore and
 * downloads all files from Supabase Storage.
 * 
 * Usage:
 *   1. Make sure you have .env.local with Firebase and Supabase credentials
 *   2. Run: node scripts/export-data.mjs
 *   3. Data will be exported to the 'exports' folder
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from multiple possible locations
const loadEnv = () => {
  const projectRoot = path.join(__dirname, '..');
  
  // Try multiple env file locations (in order of priority)
  const envFiles = [
    path.join(projectRoot, '.env.local'),
    path.join(projectRoot, '.env'),
    path.join(projectRoot, '.env.development'),
  ];
  
  let loaded = false;
  
  for (const envPath of envFiles) {
    if (fs.existsSync(envPath)) {
      console.log(`📄 Loading environment from: ${path.basename(envPath)}`);
      const envContent = fs.readFileSync(envPath, 'utf8');
      
      envContent.split('\n').forEach(line => {
        // Skip comments and empty lines
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith('#')) return;
        
        const equalIndex = trimmedLine.indexOf('=');
        if (equalIndex > 0) {
          const key = trimmedLine.substring(0, equalIndex).trim();
          let value = trimmedLine.substring(equalIndex + 1).trim();
          
          // Remove surrounding quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          
          process.env[key] = value;
        }
      });
      
      loaded = true;
      break; // Use first found env file
    }
  }
  
  if (!loaded) {
    console.error('❌ No .env.local or .env file found!');
    console.error('   Create .env.local with your Firebase and Supabase credentials.');
    process.exit(1);
  }
};

loadEnv();

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

// Supabase configuration
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

// Validate configuration
const validateConfig = () => {
  console.log('\n🔍 Checking configuration...');
  
  const missing = [];
  const found = [];
  
  if (!firebaseConfig.apiKey) {
    missing.push('VITE_FIREBASE_API_KEY');
  } else {
    found.push(`VITE_FIREBASE_API_KEY: ${firebaseConfig.apiKey.substring(0, 10)}...`);
  }
  
  if (!firebaseConfig.projectId) {
    missing.push('VITE_FIREBASE_PROJECT_ID');
  } else {
    found.push(`VITE_FIREBASE_PROJECT_ID: ${firebaseConfig.projectId}`);
  }
  
  if (!supabaseUrl) {
    missing.push('VITE_SUPABASE_URL');
  } else {
    found.push(`VITE_SUPABASE_URL: ${supabaseUrl}`);
  }
  
  if (!supabaseKey) {
    missing.push('VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY');
  } else {
    found.push(`VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY: ${supabaseKey.substring(0, 20)}...`);
  }
  
  // Show what was found
  if (found.length > 0) {
    console.log('   ✓ Found:');
    found.forEach(v => console.log(`     ${v}`));
  }
  
  if (missing.length > 0) {
    console.error('\n   ✗ Missing:');
    missing.forEach(v => console.error(`     - ${v}`));
    console.error('\n   Make sure your .env.local file contains these variables.');
    process.exit(1);
  }
  
  console.log('   ✓ All configuration valid\n');
};

// These will be initialized after validation
let app, db, supabase;

// Initialize clients (called after validation)
const initializeClients = () => {
  // Initialize Firebase
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  console.log('   ✓ Firebase initialized');

  // Initialize Supabase
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('   ✓ Supabase initialized\n');
};

// Create exports directory
const EXPORT_DIR = path.join(__dirname, '..', 'exports');
const FILES_DIR = path.join(EXPORT_DIR, 'files');

const ensureDirectories = () => {
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }
  if (!fs.existsSync(FILES_DIR)) {
    fs.mkdirSync(FILES_DIR, { recursive: true });
  }
};

// Collections to export
const COLLECTIONS = ['users', 'reports', 'Challenge'];

// Convert Firestore timestamps
const processTimestamps = (obj) => {
  if (obj === null || obj === undefined) return obj;
  
  if (obj.toDate && typeof obj.toDate === 'function') {
    return obj.toDate().toISOString();
  }
  
  if (obj._seconds !== undefined && obj._nanoseconds !== undefined) {
    return new Date(obj._seconds * 1000).toISOString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => processTimestamps(item));
  }
  
  if (typeof obj === 'object') {
    const processed = {};
    for (const [key, value] of Object.entries(obj)) {
      processed[key] = processTimestamps(value);
    }
    return processed;
  }
  
  return obj;
};

// Export Firestore data
const exportFirestore = async () => {
  console.log('\n📦 Exporting Firestore data...\n');
  
  const allData = {};
  
  for (const collectionName of COLLECTIONS) {
    console.log(`  Exporting: ${collectionName}...`);
    
    try {
      const collectionRef = collection(db, collectionName);
      const snapshot = await getDocs(collectionRef);
      
      const documents = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        const processedData = processTimestamps(data);
        documents.push({
          id: doc.id,
          ...processedData
        });
      });
      
      allData[collectionName] = documents;
      console.log(`  ✓ ${collectionName}: ${documents.length} documents`);
    } catch (err) {
      console.error(`  ✗ Error exporting ${collectionName}: ${err.message}`);
      allData[collectionName] = { error: err.message };
    }
  }
  
  // Save to file
  const outputPath = path.join(EXPORT_DIR, 'firestore_export.json');
  fs.writeFileSync(outputPath, JSON.stringify(allData, null, 2));
  console.log(`\n✅ Firestore data saved to: ${outputPath}`);
  
  return allData;
};

// List all files in Supabase storage recursively
const listAllFiles = async (bucket, folderPath = '') => {
  const files = [];
  
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(folderPath, { limit: 1000 });
    
    if (error) throw error;
    
    for (const item of data || []) {
      const itemPath = folderPath ? `${folderPath}/${item.name}` : item.name;
      
      if (item.id === null) {
        // It's a folder
        const subFiles = await listAllFiles(bucket, itemPath);
        files.push(...subFiles);
      } else {
        // It's a file
        files.push({
          name: item.name,
          path: itemPath,
          size: item.metadata?.size || 0,
        });
      }
    }
  } catch (err) {
    if (!err.message.includes('not found')) {
      console.error(`  Error listing ${folderPath}: ${err.message}`);
    }
  }
  
  return files;
};

// Download a file from Supabase
const downloadFile = async (bucket, filePath, localPath) => {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(filePath);
    
    if (error) throw error;
    
    const buffer = Buffer.from(await data.arrayBuffer());
    
    // Ensure directory exists
    const dir = path.dirname(localPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(localPath, buffer);
    return true;
  } catch (err) {
    console.error(`  ✗ Failed to download ${filePath}: ${err.message}`);
    return false;
  }
};

// Export Supabase files
const exportSupabaseFiles = async () => {
  console.log('\n📁 Exporting Supabase files...\n');
  
  const bucket = 'Reports';
  
  // List all files
  console.log('  Scanning storage...');
  const files = await listAllFiles(bucket);
  console.log(`  Found ${files.length} files\n`);
  
  if (files.length === 0) {
    console.log('  No files found in storage.');
    return;
  }
  
  // Save file list
  const fileListPath = path.join(EXPORT_DIR, 'file_list.json');
  fs.writeFileSync(fileListPath, JSON.stringify(files, null, 2));
  console.log(`  File list saved to: ${fileListPath}\n`);
  
  // Download files
  console.log('  Downloading files...\n');
  
  let successful = 0;
  let failed = 0;
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const localPath = path.join(FILES_DIR, file.path);
    
    process.stdout.write(`  [${i + 1}/${files.length}] ${file.path}... `);
    
    const success = await downloadFile(bucket, file.path, localPath);
    
    if (success) {
      successful++;
      console.log('✓');
    } else {
      failed++;
      console.log('✗');
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`\n✅ Download complete: ${successful} successful, ${failed} failed`);
  console.log(`   Files saved to: ${FILES_DIR}`);
};

// Main function
const main = async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('        PCL Analysis - Data Export Tool');
  console.log('═══════════════════════════════════════════════════════');
  
  // Step 1: Validate configuration
  validateConfig();
  
  // Step 2: Initialize Firebase and Supabase clients
  console.log('🔌 Initializing connections...');
  initializeClients();
  
  // Step 3: Create export directories
  ensureDirectories();
  
  try {
    // Export Firestore
    await exportFirestore();
    
    // Export Supabase files
    await exportSupabaseFiles();
    
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('               Export Complete!');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`\nExported data location: ${EXPORT_DIR}`);
    console.log('\nNext steps:');
    console.log('  1. Copy firestore_export.json to your server');
    console.log('  2. Copy the files/ folder to /var/reports/');
    console.log('  3. Run the import script to populate PostgreSQL');
    
  } catch (error) {
    console.error('\n❌ Export failed:', error.message);
    process.exit(1);
  }
  
  process.exit(0);
};

main();
