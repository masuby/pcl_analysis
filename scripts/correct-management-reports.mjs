#!/usr/bin/env node
/**
 * Correct Management Reports - Client Counts
 *
 * Run backup first: node scripts/management-reports-backup.mjs
 *
 * 1. For each management report:
 *    - Filters Clients file by Created <= report date
 *    - For each branch in Country sheet: computes Active, Inactive from Clients
 *    - Number of clients = Active + Inactive
 *    - Updates Excel file on disk
 *    - Updates report_data in database
 *
 * Run backup first: node scripts/management-reports-backup.mjs
 * Then: node scripts/correct-management-reports.mjs
 *
 * Prerequisites: PostgreSQL, .env, Clients file, management reports in uploads
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
const loadEnv = () => {
  for (const p of [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', 'backend', '.env'),
  ]) {
    if (fs.existsSync(p)) {
      fs.readFileSync(p, 'utf8').split('\n').forEach((line) => {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
      });
      return;
    }
  }
};

loadEnv();

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'pcl_analysis',
  user: process.env.DB_USER || 'masubi',
  password: process.env.DB_PASSWORD || 'Masubi98%',
};

const CLIENTS_FILE = path.join(__dirname, '..', 'backend', 'Clients-platinumtanzania-dmasubi-2026-02-14T08_37_08.734_03_00.xlsx');
const BACKUP_DIR = path.join(__dirname, '..', 'backend', 'backup', 'management_reports');
const possibleUploadPaths = [
  process.env.UPLOAD_PATH,
  path.join(__dirname, '..', 'backend', 'uploads'),
  path.join(__dirname, '..', 'backend', 'data', 'uploads'),
].filter(Boolean);
const UPLOAD_BASE = possibleUploadPaths[0] || path.join(__dirname, '..', 'backend', 'uploads');

// Normalize branch name for matching (lowercase, trim)
const norm = (s) => String(s || '').trim().toLowerCase();

// Match report branch to clients branch (exact or client branch contains report branch)
function matchBranch(reportBranch, clientBranch) {
  const r = norm(reportBranch);
  const c = norm(clientBranch);
  if (r === c) return true;
  // "Bariadi" matches "Bariadi" or "LBF Bariadi Branch" or "Bariadi Branch"
  if (c.includes(r)) return true;
  const cCore = c.replace(/\b(lbf|branch|cs|sme)\b/gi, '').trim();
  if (r === cCore || cCore.includes(r)) return true;
  return false;
}

// Parse Created date from cell (Excel serial number or ISO string)
function parseCreatedDate(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// Load Clients data filtered by cutoff date
function loadClientsByDate(cutoffDate) {
  if (!fs.existsSync(CLIENTS_FILE)) {
    throw new Error(`Clients file not found: ${CLIENTS_FILE}`);
  }
  const wb = XLSX.readFile(CLIENTS_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = data[0] || [];
  const branchCol = headers.findIndex((h) => /^branch$/i.test(String(h || '').trim()));
  const stateCol = headers.findIndex((h) => /client\s*state/i.test(String(h || '')));
  const createdCol = headers.findIndex((h) => /^created$/i.test(String(h || '').trim()));

  if (branchCol < 0 || stateCol < 0 || createdCol < 0) {
    throw new Error(`Clients file missing columns: Branch=${branchCol}, Client State=${stateCol}, Created=${createdCol}`);
  }

  const cutoff = cutoffDate ? new Date(cutoffDate) : new Date(9999, 11, 31);
  const byBranch = {}; // branch -> { active, inactive, total }

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const created = parseCreatedDate(row[createdCol]);
    if (created && created > cutoff) continue; // client created after report date
    const branch = String(row[branchCol] || '').trim();
    if (!branch) continue;
    const state = String(row[stateCol] || '').trim().toLowerCase();
    const isActive = /active/.test(state);

    if (!byBranch[branch]) byBranch[branch] = { active: 0, inactive: 0, total: 0 };
    byBranch[branch].total++;
    if (isActive) byBranch[branch].active++;
    else byBranch[branch].inactive++;
  }

  return { byBranch, branchCol, stateCol, createdCol };
}

// Get counts for a report branch from clients map
function getCountsForBranch(reportBranch, byBranch) {
  for (const [clientBranch, counts] of Object.entries(byBranch)) {
    if (matchBranch(reportBranch, clientBranch)) return counts;
  }
  return null;
}

// Is this row a leaf branch (not zone, cluster, CS, LBF, etc.)
function isLeafBranch(val) {
  if (!val || typeof val !== 'string') return false;
  const v = val.toLowerCase();
  if (/cluster|zone|^cs$|^lbf$|zanzibar|call center|sme|maziwa|agrifinance|lbf zone|smes/i.test(v)) return false;
  return true;
}

// Find column indices in Country sheet
function findColumns(headers) {
  const get = (regex) => headers.findIndex((h) => regex.test(String(h || '')));
  return {
    branch: get(/branch/i),
    numClients: get(/number of clients|no\.?\s*of clients/i) >= 0 ? get(/number of clients|no\.?\s*of clients/i) : get(/clients/i),
    active: get(/active clients/i),
    inactive: get(/inactive clients/i),
  };
}


async function main() {
  const client = new Client(DB_CONFIG);

  try {
    await client.connect();

    // 1. Ensure backup exists
    if (!fs.existsSync(BACKUP_DIR) || !fs.readdirSync(BACKUP_DIR).some((f) => f.endsWith('.xlsx'))) {
      console.log('⚠ Backup folder empty or missing. Run: node scripts/management-reports-backup.mjs');
      console.log('  Continuing anyway (will modify originals)...\n');
    } else {
      console.log('✓ Backup folder found:', BACKUP_DIR, '\n');
    }

    // 2. Get all MANAGEMENT reports
    const res = await client.query(
      `SELECT id, title, file_name, file_path, date
       FROM reports
       WHERE type = 'MANAGEMENT' AND is_active = true
       ORDER BY date DESC NULLS LAST`
    );
    const reports = res.rows;
    console.log(`Found ${reports.length} MANAGEMENT reports to correct.\n`);

    if (reports.length === 0) {
      console.log('No reports. Exiting.');
      await client.end();
      return;
    }

    let updatedFiles = 0;
    let updatedDbRows = 0;

    for (const report of reports) {
      const reportId = report.id;
      const reportDate = report.date ? new Date(report.date) : null;
      let srcPath = null;
      for (const base of possibleUploadPaths) {
        const p = path.join(base, report.file_path);
        if (fs.existsSync(p)) {
          srcPath = p;
          break;
        }
      }
      if (!srcPath || !fs.existsSync(srcPath)) {
        console.log(`  ⚠ Skip (file not found): ${report.file_name}`);
        continue;
      }

      const cutoffDate = reportDate || new Date(0);
      const { byBranch } = loadClientsByDate(cutoffDate);

      const wb = XLSX.readFile(srcPath);
      const countrySheet = wb.SheetNames.find((s) => /country/i.test(s)) || wb.SheetNames[0];
      const ws = wb.Sheets[countrySheet];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      const headers = data[0] || [];
      const cols = findColumns(headers);
      if (cols.branch < 0 || cols.numClients < 0) {
        console.log(`  ⚠ Skip (missing columns): ${report.file_name}`);
        continue;
      }

      // Use actual header text for DB (must match how Go parser stored it)
      const metricNum = cols.numClients >= 0 ? (headers[cols.numClients] || 'Number of clients').trim() : null;
      const metricActive = cols.active >= 0 ? (headers[cols.active] || 'Active Clients').trim() : null;
      const metricInactive = cols.inactive >= 0 ? (headers[cols.inactive] || 'Inactive Clients').trim() : null;

      const dbUpdates = []; // { branch, metricName, value }

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const branchVal = row[cols.branch];
        if (!branchVal || !String(branchVal).trim()) continue;

        const branchName = String(branchVal).trim();

        if (!isLeafBranch(branchName)) continue; // only update leaf branches from Clients

        const counts = getCountsForBranch(branchName, byBranch);
        if (!counts) continue;

        const active = counts.active;
        const inactive = counts.inactive;
        const total = active + inactive;

        if (cols.numClients >= 0 && metricNum) {
          row[cols.numClients] = total;
          dbUpdates.push({ branch: branchName, metricName: metricNum, value: total });
        }
        if (cols.active >= 0 && metricActive) {
          row[cols.active] = active;
          dbUpdates.push({ branch: branchName, metricName: metricActive, value: active });
        }
        if (cols.inactive >= 0 && metricInactive) {
          row[cols.inactive] = inactive;
          dbUpdates.push({ branch: branchName, metricName: metricInactive, value: inactive });
        }
      }

      // Write back to Excel
      const newWs = XLSX.utils.aoa_to_sheet(data);
      wb.Sheets[countrySheet] = newWs;
      XLSX.writeFile(wb, srcPath);
      updatedFiles++;

      // Update report_data in database
      for (const u of dbUpdates) {
        const r = await client.query(
          `UPDATE report_data
           SET metric_value = $1
           WHERE report_id = $2 AND COALESCE(sheet_name, 'Country') = 'Country'
             AND branch = $3 AND metric_name = $4`,
          [u.value, reportId, u.branch, u.metricName]
        );
        updatedDbRows += r.rowCount || 0;
      }

      console.log(`  ✓ ${report.file_name} (${reportDate?.toISOString().split('T')[0] || 'no date'}) - ${dbUpdates.length} cells updated`);
    }

    // Refresh materialized view if it exists
    try {
      await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_summary');
      console.log('\n✓ Dashboard summary refreshed');
    } catch (_) {
      try {
        await client.query('REFRESH MATERIALIZED VIEW dashboard_summary');
      } catch (_) {}
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`Done: ${updatedFiles} files updated, DB report_data updated`);
    console.log('Downloaded files will now show corrected client counts.');
    console.log('═══════════════════════════════════════════════════════\n');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
