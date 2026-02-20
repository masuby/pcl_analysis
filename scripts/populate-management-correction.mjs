#!/usr/bin/env node
/**
 * Populate ManagementCorrection from uploads (website/database source)
 *
 * Copies Management report files from backend/uploads/ to backend/ManagementCorrection/
 * These are the files the website serves - with original formatting preserved.
 *
 * Usage:
 *   node scripts/populate-management-correction.mjs
 *   npm run populate-management-correction
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { copyFileSync, mkdirSync } from 'fs';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadEnv = () => {
  const envPaths = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', 'backend', '.env'),
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      content.split('\n').forEach((line) => {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m) {
          const key = m[1].trim();
          let val = m[2].trim().replace(/^["']|["']$/g, '');
          process.env[key] = val;
        }
      });
      console.log(`Loaded env from ${path.basename(p)}\n`);
      return;
    }
  }
  console.warn('No .env found - using defaults\n');
};

loadEnv();

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'pcl_analysis',
  user: process.env.DB_USER || 'masubi',
  password: process.env.DB_PASSWORD || 'Masubi98%',
};

const possibleUploadPaths = [
  process.env.UPLOAD_PATH,
  path.join(__dirname, '..', 'backend', 'uploads'),
  path.join(__dirname, '..', 'backend', 'data', 'uploads'),
  path.join(__dirname, '..', 'uploads'),
].filter(Boolean);

const UPLOAD_PATH = possibleUploadPaths[0] || path.join(__dirname, '..', 'backend', 'uploads');
const MGMT_CORRECTION_DIR = path.join(__dirname, '..', 'backend', 'ManagementCorrection');

async function main() {
  const client = new Client(DB_CONFIG);

  try {
    await client.connect();
    console.log('Connected to PostgreSQL\n');

    const res = await client.query(
      `SELECT id, title, file_name, file_path, file_size, department, type, date, created_at
       FROM reports
       WHERE type = 'MANAGEMENT' AND is_active = true
       ORDER BY date DESC NULLS LAST, created_at DESC`
    );

    const reports = res.rows;
    const count = reports.length;

    console.log('═══════════════════════════════════════════════════════');
    console.log('  Populate ManagementCorrection from uploads');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log(`Source:  ${UPLOAD_PATH}`);
    console.log(`Target:  ${MGMT_CORRECTION_DIR}`);
    console.log(`Reports: ${count}\n`);

    if (count === 0) {
      console.log('No MANAGEMENT reports found. Exiting.');
      await client.end();
      return;
    }

    const metadata = reports.map((r) => ({
      id: r.id,
      title: r.title,
      file_name: r.file_name,
      file_path: r.file_path,
      file_size: r.file_size,
      department: r.department,
      type: r.type,
      date: r.date ? new Date(r.date).toISOString().split('T')[0] : null,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));

    mkdirSync(MGMT_CORRECTION_DIR, { recursive: true });

    const metadataPath = path.join(MGMT_CORRECTION_DIR, 'management_reports_metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
    console.log(`Metadata saved: ${metadataPath}\n`);

    console.log('Copying files from uploads (formatted)...\n');
    let copied = 0;
    let notFound = 0;

    for (const r of reports) {
      let srcPath = path.join(UPLOAD_PATH, r.file_path);
      for (const base of possibleUploadPaths) {
        const p = path.join(base, r.file_path);
        if (fs.existsSync(p)) {
          srcPath = p;
          break;
        }
      }

      const dstName = `${r.id}_${path.basename(r.file_path)}`;
      const dstPath = path.join(MGMT_CORRECTION_DIR, dstName);

      if (!fs.existsSync(srcPath)) {
        console.log(`  NOT FOUND: ${r.file_path}`);
        notFound++;
        continue;
      }

      copyFileSync(srcPath, dstPath);
      copied++;
      console.log(`  OK [${copied}/${count}] ${r.file_name} (date: ${r.date || 'N/A'})`);
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`Done: ${copied} copied, ${notFound} not found`);
    console.log(`ManagementCorrection ready for correction scripts.`);
    console.log('═══════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
