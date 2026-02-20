/**
 * Script to inspect an Excel file for freeze pane properties.
 * Run: node scripts/inspect-excel-freeze.mjs
 */
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputFile = process.argv[2] || 'HOD_SCORE_CARD_WEEKLY_FROM_2026-02-08_TO_2026-02-14.xlsx';
const filePath = join(
  __dirname,
  '..',
  'src',
  'pages',
  'Dashboard',
  'components',
  'DepartmentalDashboard',
  'components',
  'ScoreCardReports',
  inputFile
);

console.log('Inspecting:', filePath);
console.log('---');

const buf = readFileSync(filePath);
const workbook = XLSX.read(buf, { type: 'buffer' });

console.log('Sheets:', workbook.SheetNames);

workbook.SheetNames.forEach((name) => {
  const ws = workbook.Sheets[name];
  const specialKeys = Object.keys(ws).filter((k) => k.startsWith('!'));
  console.log('\n' + name + ':');
  console.log('  Special keys:', specialKeys);
  if (ws['!freeze']) {
    console.log('  !freeze:', JSON.stringify(ws['!freeze']));
  } else {
    console.log('  !freeze: NOT SET (no freeze panes)');
  }
  if (ws['!ref']) {
    console.log('  Range:', ws['!ref']);
  }
});

// Also check raw XML in the xlsx (it's a zip file)
console.log('\n--- Checking raw xlsx structure (zip contents) ---');
import JSZip from 'jszip';
const zip = await JSZip.loadAsync(buf);
const files = Object.keys(zip.files);
const sheetFiles = files.filter((f) => f.startsWith('xl/worksheets/') && f.endsWith('.xml'));
console.log('Worksheet files:', sheetFiles);

for (const sheetFile of sheetFiles) {
  const content = await zip.file(sheetFile).async('string');
  const hasPane = content.includes('<pane') || content.includes('state="frozen"');
  const hasSheetViews = content.includes('<sheetViews');
  console.log('\n' + sheetFile + ':');
  console.log('  Has sheetViews:', hasSheetViews);
  console.log('  Has pane/frozen:', hasPane);
  if (hasSheetViews) {
    const start = content.indexOf('<sheetViews');
    const end = content.indexOf('</sheetViews>') + 13;
    const snippet = content.slice(start, Math.min(end, start + 300));
    console.log('  sheetViews snippet:', snippet.replace(/>\s*</g, '>\n<'));
  }
}
