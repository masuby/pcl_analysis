/**
 * Reads the "Bariadi" sheet from Management Report2026-02.xlsx to inspect structure
 * for Target and Disbursement this Month columns.
 * Run from project root: node scripts/read_management_bariadi.mjs
 */
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const filePath = path.join(
  projectRoot,
  'src/pages/Dashboard/components/DepartmentalDashboard/components/KpiAnalysisReport/Management Report2026-02.xlsx'
);

if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
console.log('All sheet names:', workbook.SheetNames);
console.log('---\n');

const sheetName = 'Bariadi';
if (!workbook.SheetNames.includes(sheetName)) {
  console.error('Sheet "Bariadi" not found. Available:', workbook.SheetNames.filter(s => !s.startsWith('LBF') && !s.startsWith('SME')).slice(0, 15));
  process.exit(1);
}

const sheet = workbook.Sheets[sheetName];
const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

console.log(`========== Sheet: ${sheetName} ==========`);
console.log('Total rows:', raw.length);
console.log('\n--- First 15 rows (row index, then cells) ---\n');

raw.slice(0, 15).forEach((row, i) => {
  const cells = Array.isArray(row) ? row : [];
  const preview = cells.map((c, j) => {
    const val = c == null ? '' : String(c);
    const short = val.length > 25 ? val.slice(0, 22) + '...' : val;
    return `[${j}]${short}`;
  }).join(' | ');
  console.log(`Row ${i}: ${preview}`);
  console.log(`      (raw row length: ${cells.length}, values: ${JSON.stringify(cells.slice(0, 12))})`);
});

console.log('\n--- Column indices that might be Target / Disbursement ---');
const headerRow = raw[0] || [];
for (let c = 0; c < Math.min(headerRow.length, 25); c++) {
  const h = headerRow[c];
  const str = h != null ? String(h).trim().toLowerCase() : '';
  if (str.includes('target') || str.includes('disbursement')) {
    console.log(`  Column ${c}: "${headerRow[c]}"`);
  }
}

console.log('\n--- Row 1 (data row) first 15 cells ---');
const dataRow = raw[1] || [];
dataRow.slice(0, 15).forEach((v, i) => {
  console.log(`  [${i}] type=${typeof v} value=${JSON.stringify(v)}`);
});
