#!/usr/bin/env node
/**
 * Read Clients File - Columns & Sample Data
 *
 * Reads: backend/Clients-platinumtanzania-dmasubi-2026-02-14T08_37_08.734_03_00.xlsx
 * Shows: columns, unique Branches, Client State values, sample rows
 *
 * Usage: node scripts/read-clients-file.mjs
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIENTS_FILE = path.join(
  __dirname,
  '..',
  'backend',
  'Clients-platinumtanzania-dmasubi-2026-02-14T08_37_08.734_03_00.xlsx'
);

function main() {
  if (!fs.existsSync(CLIENTS_FILE)) {
    console.error(`File not found: ${CLIENTS_FILE}`);
    process.exit(1);
  }

  const wb = XLSX.readFile(CLIENTS_FILE);
  const sheetNames = wb.SheetNames;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('         CLIENTS FILE - STRUCTURE');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('Sheets:', sheetNames.join(', '));

  const firstSheet = sheetNames[0];
  const ws = wb.Sheets[firstSheet];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (data.length === 0) {
    console.log('Empty sheet');
    return;
  }

  const headers = data[0];
  console.log('\n--- COLUMNS (Row 1) ---');
  headers.forEach((h, i) => console.log(`  ${i}: ${h || '(empty)'}`));

  // Build column index map
  const colIndex = {};
  headers.forEach((h, i) => {
    if (h && String(h).trim()) colIndex[String(h).trim()] = i;
  });

  const branchCol = colIndex['Branch'] ?? headers.findIndex((h) => /branch/i.test(String(h || '')));
  const clientStateCol = colIndex['Client State'] ?? headers.findIndex((h) => /client\s*state/i.test(String(h || '')));
  const createdCol = colIndex['Created'] ?? headers.findIndex((h) => /created/i.test(String(h || '')));

  console.log('\n--- KEY COLUMNS (for correction) ---');
  console.log(`  Branch: index ${branchCol} (header: ${headers[branchCol]})`);
  console.log(`  Client State: index ${clientStateCol} (header: ${headers[clientStateCol]})`);
  console.log(`  Created: index ${createdCol} (header: ${headers[createdCol]})`);

  // Unique branches and client states
  const branches = new Set();
  const clientStates = new Set();
  const createdSamples = [];

  for (let i = 1; i < Math.min(data.length, 5000); i++) {
    const row = data[i];
    if (row[branchCol]) branches.add(String(row[branchCol]).trim());
    if (row[clientStateCol]) clientStates.add(String(row[clientStateCol]).trim());
    if (createdSamples.length < 5 && row[createdCol]) {
      createdSamples.push(row[createdCol]);
    }
  }

  console.log('\n--- UNIQUE VALUES ---');
  console.log(`  Branches (count): ${branches.size}`);
  console.log('  Sample branches:', [...branches].slice(0, 20).join(', '));
  console.log(`  Client States: ${[...clientStates].join(', ')}`);
  console.log('  Created samples:', createdSamples.join(', '));

  console.log('\n--- SAMPLE ROWS (first 5 data rows) ---');
  for (let i = 1; i <= Math.min(5, data.length - 1); i++) {
    const row = data[i];
    const obj = {};
    headers.forEach((h, j) => {
      if (h && row[j] != null) obj[h] = row[j];
    });
    console.log(JSON.stringify(obj, null, 2));
  }

  console.log('\n═══════════════════════════════════════════════════════\n');
}

main();
