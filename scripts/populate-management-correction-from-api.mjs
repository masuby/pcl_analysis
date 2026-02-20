#!/usr/bin/env node
/**
 * Populate ManagementCorrection by downloading from the website API
 *
 * Fetches files the SAME way the website does - via HTTP from the backend.
 * Use this when the file copy from disk (populate-management-reports) gives
 * unformatted files, but website download has formatting.
 *
 * Prerequisites:
 *   - Backend running (local or production - use API URL of the one with formatted files)
 *
 * Usage:
 *   npm run populate-management-correction-from-api
 *
 * For PRODUCTION (website with formatted files):
 *   API_URL=https://your-api.com npm run populate-management-correction-from-api
 *
 * For auth (if /files/ returns 401):
 *   PCL_TOKEN=<token-from-localStorage> npm run populate-management-correction-from-api
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { mkdirSync } from 'fs';

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
      return;
    }
  }
};

loadEnv();

const API_URL = process.env.VITE_API_URL || process.env.API_URL || 'http://localhost:8080';
const AUTH_TOKEN = process.env.PCL_TOKEN || '';
const MGMT_CORRECTION_DIR = path.join(__dirname, '..', 'backend', 'ManagementCorrection');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'pcl_analysis',
  user: process.env.DB_USER || 'masubi',
  password: process.env.DB_PASSWORD || 'Masubi98%',
};

async function fetchViaApiDownload(reportId, fileName) {
  const url = `${API_URL}/api/reports/${reportId}/download`;
  const headers = {};
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchViaFilesEndpoint(filePath) {
  const cleanPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  const url = `${API_URL}/files/${cleanPath}`;
  const headers = {};
  if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const client = new Client(DB_CONFIG);

  try {
    await client.connect();

    const res = await client.query(
      `SELECT id, title, file_name, file_path, file_size, department, type, date, created_at
       FROM reports
       WHERE type = 'MANAGEMENT' AND is_active = true
       ORDER BY date DESC NULLS LAST, created_at DESC`
    );

    const reports = res.rows;
    const count = reports.length;

    console.log('═══════════════════════════════════════════════════════');
    console.log('  Populate ManagementCorrection (from website API)');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log(`API:     ${API_URL}`);
    console.log(`Target:  ${MGMT_CORRECTION_DIR}`);
    console.log(`Reports: ${count}`);
    console.log(`Token:   ${AUTH_TOKEN ? 'Yes' : 'No (use /files/ if available)\n'}`);

    if (count === 0) {
      console.log('No MANAGEMENT reports found.');
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
    console.log(`Metadata saved.\n`);

    console.log('Downloading from API (same source as website)...\n');
    let copied = 0;
    let failed = 0;

    for (const r of reports) {
      const dstName = `${r.id}_${path.basename(r.file_path)}`;
      const dstPath = path.join(MGMT_CORRECTION_DIR, dstName);

      try {
        let buffer;
        try {
          buffer = await fetchViaFilesEndpoint(r.file_path);
        } catch (e1) {
          try {
            buffer = await fetchViaApiDownload(r.id, r.file_name);
          } catch (e2) {
            throw new Error(`Files: ${e1.message}, API: ${e2.message}`);
          }
        }

        fs.writeFileSync(dstPath, buffer);
        copied++;
        console.log(`  OK [${copied}/${count}] ${r.file_name} (${r.date || 'N/A'})`);
      } catch (err) {
        failed++;
        console.log(`  FAIL ${r.file_name}: ${err.message}`);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`Done: ${copied} downloaded, ${failed} failed`);
    if (failed > 0 && !AUTH_TOKEN) {
      console.log('\nTip: Login to the website, open DevTools > Application > Local Storage,');
      console.log('     copy the pcl_token value, then run:');
      console.log('     PCL_TOKEN=<your-token> npm run populate-management-correction-from-api');
    }
    console.log('═══════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
