#!/usr/bin/env node
/**
 * Read Management Report - Country Sheet
 *
 * Reads the "Country" sheet only from a Management Report Excel.
 * Shows: columns, Branch column data, row structure (branches, zones, clusters)
 *
 * Usage: node scripts/read-management-country-sheet.mjs [path-to-management-report.xlsx]
 *
 * Default: backend/Management Report2026-02.xlsx
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_REPORT = path.join(__dirname, '..', 'backend', 'Management Report2026-02.xlsx');

function main() {
  const reportPath = process.argv[2] || DEFAULT_REPORT;

  if (!fs.existsSync(reportPath)) {
    console.error(`File not found: ${reportPath}`);
    console.error('Usage: node scripts/read-management-country-sheet.mjs [path-to-report.xlsx]');
    process.exit(1);
  }

  const wb = XLSX.readFile(reportPath);
  const sheetNames = wb.SheetNames;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('    MANAGEMENT REPORT - COUNTRY SHEET STRUCTURE');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('File:', reportPath);
  console.log('All sheets:', sheetNames.join(', '));

  const countrySheet = sheetNames.find((s) => /country/i.test(s)) || sheetNames[0];
  console.log('Using sheet:', countrySheet, '\n');

  const ws = wb.Sheets[countrySheet];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (data.length === 0) {
    console.log('Empty sheet');
    return;
  }

  const headers = data[0];
  console.log('--- COLUMNS (Row 1) ---');
  headers.forEach((h, i) => console.log(`  ${i}: ${h || '(empty)'}`));

  // Find Branch column (usually first or second)
  const branchCol = headers.findIndex((h) => /branch/i.test(String(h || '')));
  const numClientsCol = headers.findIndex((h) => /number of clients/i.test(String(h || '')));
  const activeCol = headers.findIndex((h) => /active clients/i.test(String(h || '')));
  const inactiveCol = headers.findIndex((h) => /inactive clients/i.test(String(h || '')));

  console.log('\n--- KEY COLUMNS ---');
  console.log(`  Branch: index ${branchCol} (${headers[branchCol]})`);
  console.log(`  Number of clients: index ${numClientsCol} (${headers[numClientsCol]})`);
  console.log(`  Active Clients: index ${activeCol} (${headers[activeCol]})`);
  console.log(`  Inactive Clients: index ${inactiveCol} (${headers[inactiveCol]})`);

  // Collect Branch column values (non-empty)
  const branchValues = [];
  for (let i = 1; i < data.length; i++) {
    const val = data[i][branchCol];
    if (val != null && String(val).trim()) {
      branchValues.push({ row: i + 1, value: String(val).trim() });
    }
  }

  console.log('\n--- BRANCH COLUMN VALUES (for matching with Clients file) ---');
  console.log(`  Total non-empty branch rows: ${branchValues.length}`);
  console.log('  Sample (first 40):');
  branchValues.slice(0, 40).forEach(({ row, value }) => {
    console.log(`    Row ${row}: "${value}"`);
  });

  // Group by type (branch vs zone vs cluster) based on common patterns
  const branches = [];
  const zones = [];
  const clusters = [];
  const others = [];

  for (const { row, value } of branchValues) {
    const v = value.toLowerCase();
    if (v.includes('cluster') || /^cluster\s*\d/i.test(value)) {
      clusters.push(value);
    } else if (v.includes('zone') || v.endsWith('zone')) {
      zones.push(value);
    } else if (v === 'cs' || v === 'lbf' || v === 'zanzibar' || v.includes('lbf cluster') || v.includes('call center') || v.includes('sme') || v.includes('maziwa')) {
      others.push(value);
    } else {
      branches.push(value);
    }
  }

  console.log('\n--- ROW TYPE SUMMARY ---');
  console.log(`  Branches (leaf): ${branches.length} - ${branches.slice(0, 15).join(', ')}...`);
  console.log(`  Zones: ${zones.length} - ${zones.join(', ')}`);
  console.log(`  Clusters: ${clusters.length} - ${clusters.join(', ')}`);
  console.log(`  Other (CS, LBF, etc): ${others.length} - ${others.join(', ')}`);

  console.log('\n═══════════════════════════════════════════════════════\n');
}

main();
