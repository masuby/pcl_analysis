/**
 * Reads CS KPI TARGET.xlsx and prints sheet names and content (for implementing KPI Analysis Report).
 * Run from project root: node scripts/read_cs_kpi_target.mjs
 */
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const filePath = path.join(
  projectRoot,
  'src/pages/Dashboard/components/DepartmentalDashboard/components/KpiAnalysisReport/CS KPI TARGET.xlsx'
);

if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

const workbook = XLSX.readFile(filePath, { cellDates: true });
console.log('Sheet names:', workbook.SheetNames);
console.log('---\n');

workbook.SheetNames.forEach((sheetName) => {
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  console.log(`\n========== Sheet: ${sheetName} ==========`);
  console.log('Rows:', raw.length);
  raw.slice(0, 50).forEach((row, i) => {
    console.log(`  ${i}:`, JSON.stringify(row));
  });
  if (raw.length > 50) console.log('  ...', raw.length - 50, 'more rows');
});
