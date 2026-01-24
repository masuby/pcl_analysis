#!/usr/bin/env node
/**
 * PostgreSQL Import Script for PCL Analysis
 * 
 * This script imports exported Firestore data into PostgreSQL.
 * Fixed to handle Firebase IDs (not UUIDs) and individual error handling.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import crypto from 'crypto';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PostgreSQL configuration
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'pcl_analysis',
  user: process.env.DB_USER || 'masubi',
  password: process.env.DB_PASSWORD || 'Masubi98%',
};

const EXPORT_DIR = path.join(__dirname, '..', 'exports');
const FIRESTORE_EXPORT = path.join(EXPORT_DIR, 'firestore_export.json');

// Generate a proper UUID
const generateUUID = () => crypto.randomUUID();

// Hash password with simple method (bcrypt requires native module)
const hashPassword = (password) => {
  // Using SHA-256 for simplicity - in production use bcrypt
  const hash = crypto.createHash('sha256').update(password + 'pcl_salt_2026').digest('hex');
  return '$sha256$' + hash;
};

// Validate prerequisites
const validatePrerequisites = () => {
  if (!fs.existsSync(FIRESTORE_EXPORT)) {
    console.error(`❌ Export file not found: ${FIRESTORE_EXPORT}`);
    console.error('   Run export-data.mjs first to export Firestore data.');
    process.exit(1);
  }
};

// Import users - each user in its own transaction
const importUsers = async (client, users) => {
  console.log('\n👤 Importing users...');
  
  if (!Array.isArray(users) || users.length === 0) {
    console.log('   No users to import');
    return { imported: 0, skipped: 0, failed: 0 };
  }
  
  const defaultPasswordHash = hashPassword('changeme123');
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const user of users) {
    try {
      // Check if user already exists by email
      const existing = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [user.email]
      );
      
      if (existing.rows.length > 0) {
        console.log(`   ⏭ Skipping existing user: ${user.email}`);
        skipped++;
        continue;
      }
      
      // Generate a NEW UUID (don't use Firebase ID)
      const id = generateUUID();
      
      await client.query(
        `INSERT INTO users (id, email, password_hash, display_name, role, department, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          user.email,
          defaultPasswordHash,
          user.displayName || user.display_name || user.email.split('@')[0],
          user.role || 'user',
          user.department || '',
          user.isActive !== false,
          user.createdAt ? new Date(user.createdAt) : new Date(),
          user.updatedAt ? new Date(user.updatedAt) : new Date(),
        ]
      );
      
      console.log(`   ✓ Imported user: ${user.email}`);
      imported++;
    } catch (err) {
      console.error(`   ✗ Failed to import user ${user.email}: ${err.message}`);
      failed++;
    }
  }
  
  console.log(`   Summary: ${imported} imported, ${skipped} skipped, ${failed} failed`);
  return { imported, skipped, failed };
};

// Import reports - each report in its own transaction
const importReports = async (client, reports) => {
  console.log('\n📊 Importing reports...');
  
  if (!Array.isArray(reports) || reports.length === 0) {
    console.log('   No reports to import');
    return { imported: 0, skipped: 0, failed: 0 };
  }
  
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const report of reports) {
    try {
      // Check if report already exists by file path
      const filePath = report.filePath || report.file_path || '';
      if (filePath) {
        const existing = await client.query(
          'SELECT id FROM reports WHERE file_path = $1',
          [filePath]
        );
        
        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }
      }
      
      // Generate a NEW UUID
      const id = generateUUID();
      
      // Parse date
      let reportDate = null;
      if (report.date) {
        try {
          reportDate = new Date(report.date);
          if (isNaN(reportDate.getTime())) reportDate = null;
        } catch (e) {
          reportDate = null;
        }
      }
      
      await client.query(
        `INSERT INTO reports (id, title, file_name, file_path, file_size, department, type, date, views, downloads, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          report.title || report.fileName || report.file_name || 'Untitled',
          report.fileName || report.file_name || '',
          report.filePath || report.file_path || '',
          report.fileSize || report.file_size || 0,
          report.department || '',
          report.type || '',
          reportDate,
          report.views || 0,
          report.downloads || 0,
          report.isActive !== false,
          report.createdAt ? new Date(report.createdAt) : new Date(),
          report.updatedAt ? new Date(report.updatedAt) : new Date(),
        ]
      );
      
      imported++;
      
      // Show progress every 10 reports
      if (imported % 10 === 0) {
        console.log(`   ✓ Imported ${imported} reports...`);
      }
    } catch (err) {
      console.error(`   ✗ Failed: ${report.fileName || report.file_name || 'unknown'}: ${err.message}`);
      failed++;
    }
  }
  
  console.log(`   Summary: ${imported} imported, ${skipped} skipped, ${failed} failed`);
  return { imported, skipped, failed };
};

// Import challenges
const importChallenges = async (client, challenges) => {
  console.log('\n🏆 Importing challenges...');
  
  if (!Array.isArray(challenges) || challenges.length === 0) {
    console.log('   No challenges to import');
    return { imported: 0, skipped: 0, failed: 0 };
  }
  
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const challenge of challenges) {
    try {
      // Check if challenge already exists
      const existing = await client.query(
        'SELECT id FROM challenges WHERE title = $1 AND department = $2',
        [challenge.title || '', challenge.department || '']
      );
      
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }
      
      const id = generateUUID();
      
      await client.query(
        `INSERT INTO challenges (id, title, description, department, start_date, end_date, image_path, attachment_path, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          challenge.title || 'Untitled',
          challenge.description || '',
          challenge.department || '',
          challenge.startDate ? new Date(challenge.startDate) : null,
          challenge.endDate ? new Date(challenge.endDate) : null,
          challenge.imagePath || challenge.image_path || null,
          challenge.attachmentPath || challenge.attachment_path || null,
          challenge.isActive !== false,
          challenge.createdAt ? new Date(challenge.createdAt) : new Date(),
          challenge.updatedAt ? new Date(challenge.updatedAt) : new Date(),
        ]
      );
      
      console.log(`   ✓ Imported challenge: ${challenge.title}`);
      imported++;
    } catch (err) {
      console.error(`   ✗ Failed: ${challenge.title || 'unknown'}: ${err.message}`);
      failed++;
    }
  }
  
  console.log(`   Summary: ${imported} imported, ${skipped} skipped, ${failed} failed`);
  return { imported, skipped, failed };
};

// Create admin user if not exists
const createAdminUser = async (client) => {
  console.log('\n🔐 Checking admin user...');
  
  try {
    const existing = await client.query(
      "SELECT id FROM users WHERE email = 'admin@pcl.com' OR role = 'admin'"
    );
    
    if (existing.rows.length > 0) {
      console.log('   ✓ Admin user already exists');
      return;
    }
    
    const id = generateUUID();
    const passwordHash = hashPassword('admin123');
    
    await client.query(
      `INSERT INTO users (id, email, password_hash, display_name, role, department, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        'admin@pcl.com',
        passwordHash,
        'System Administrator',
        'admin',
        'ALL',
        true,
        new Date(),
        new Date(),
      ]
    );
    
    console.log('   ✓ Created admin user: admin@pcl.com (password: admin123)');
  } catch (err) {
    console.error(`   ✗ Failed to create admin: ${err.message}`);
  }
};

// Main function
const main = async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('     PCL Analysis - PostgreSQL Import Tool');
  console.log('═══════════════════════════════════════════════════════');
  
  validatePrerequisites();
  
  console.log(`\nDatabase: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
  
  // Load exported data
  console.log('\n📂 Loading exported data...');
  const exportedData = JSON.parse(fs.readFileSync(FIRESTORE_EXPORT, 'utf8'));
  
  Object.keys(exportedData).forEach(collection => {
    const count = Array.isArray(exportedData[collection]) ? exportedData[collection].length : 0;
    console.log(`   ${collection}: ${count} documents`);
  });
  
  // Connect to PostgreSQL
  const client = new Client(DB_CONFIG);
  
  try {
    console.log('\n🔌 Connecting to PostgreSQL...');
    await client.connect();
    console.log('   ✓ Connected');
    
    // Import data (no global transaction - each insert is separate)
    const results = {};
    
    results.users = await importUsers(client, exportedData.users);
    results.reports = await importReports(client, exportedData.reports);
    results.challenges = await importChallenges(client, exportedData.Challenge);
    
    // Create admin user if needed
    await createAdminUser(client);
    
    // Try to refresh materialized views
    console.log('\n🔄 Refreshing materialized views...');
    try {
      await client.query('REFRESH MATERIALIZED VIEW dashboard_summary');
      console.log('   ✓ Materialized views refreshed');
    } catch (err) {
      console.log('   ⚠ Could not refresh (may need report_data first)');
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('               Import Complete!');
    console.log('═══════════════════════════════════════════════════════');
    console.log('\nSummary:');
    Object.entries(results).forEach(([collection, { imported, skipped, failed }]) => {
      console.log(`   ${collection}: ${imported} imported, ${skipped} skipped, ${failed || 0} failed`);
    });
    
    console.log('\n⚠️  IMPORTANT:');
    console.log('   Default password for all users: changeme123');
    console.log('   Admin login: admin@pcl.com / admin123');
    
    console.log('\nNext steps:');
    console.log('   1. Copy exports/files/ to backend/uploads/');
    console.log('   2. Start the Go backend: cd backend && go run cmd/server/main.go');
    console.log('   3. Start the React frontend: npm run dev');
    
  } catch (error) {
    console.error('\n❌ Import failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
  
  process.exit(0);
};

main();
