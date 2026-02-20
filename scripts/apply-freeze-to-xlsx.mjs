/**
 * Apply freeze panes to an existing xlsx file (for testing).
 * Run: node scripts/apply-freeze-to-xlsx.mjs [input.xlsx] [output.xlsx]
 *
 * Uses same freeze config as Score Card:
 * - Sheet 1 (Sales Compliance): row 1, col 5 (PRODUCT through DATE + header)
 * - Sheet 2 (Production): no freeze (causes Excel corruption)
 * - Sheet 3 (Leads Marketing): row 1, col 3 (Product, Day, Date + header)
 * - Sheet 4 (Product MTD): no freeze (causes Excel corruption)
 * - Sheet 5 (Call Center): no freeze (causes Excel corruption)
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_INPUT = join(
  __dirname,
  '..',
  'src',
  'pages',
  'Dashboard',
  'components',
  'DepartmentalDashboard',
  'components',
  'ScoreCardReports',
  'HOD_SCORE_CARD_WEEKLY_FROM_2026-02-08_TO_2026-02-14.xlsx'
);

const FREEZE_CONFIG = [
  { row: 1, col: 5 },
  null,
  { row: 1, col: 3 },
  null,
  null
];

const colToLetter = (col) => {
  let result = '';
  col += 1;
  while (col > 0) {
    const remainder = (col - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    col = Math.floor((col - 1) / 26);
  }
  return result;
};
const toCellRef = (row, col) => colToLetter(col) + (row + 1);

async function applyFreeze(inputPath, outputPath) {
  const buf = readFileSync(inputPath);
  const zip = await JSZip.loadAsync(buf);
  const sheetFiles = Object.keys(zip.files)
    .filter((f) => f.startsWith('xl/worksheets/') && f.endsWith('.xml'))
    .sort();

  for (let i = 0; i < sheetFiles.length; i++) {
    const cfg = FREEZE_CONFIG[i];
    if (!cfg || (cfg.row <= 0 && cfg.col <= 0)) continue;

    const content = await zip.file(sheetFiles[i]).async('string');
    const topLeftCell = toCellRef(cfg.row, cfg.col);
    const paneXml = `<pane xSplit="${cfg.col}" ySplit="${cfg.row}" topLeftCell="${topLeftCell}" activePane="bottomRight" state="frozen"/>`;
    const selectionXml = `<selection pane="bottomRight" activeCell="${topLeftCell}" sqref="${topLeftCell}"/>`;

    const newContent = content.replace(
      /<sheetView([^>]*)\/>/,
      `<sheetView$1>\n  ${paneXml}\n  ${selectionXml}\n</sheetView>`
    );
    zip.file(sheetFiles[i], newContent);
  }

  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  writeFileSync(outputPath, out);
  console.log('Wrote', outputPath, 'with freeze panes applied.');
}

const input = process.argv[2] || DEFAULT_INPUT;
const output = process.argv[3] || input.replace('.xlsx', '_with_freeze.xlsx');
applyFreeze(input, output).catch((err) => {
  console.error(err);
  process.exit(1);
});
