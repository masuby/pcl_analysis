/**
 * Post-process xlsx buffer to inject freeze panes into worksheet XML.
 * xlsx-js-style does not persist !freeze to the output - we inject it manually.
 *
 * OOXML format: <pane xSplit="N" ySplit="M" topLeftCell="..." activePane="bottomRight" state="frozen"/>
 * - xSplit: number of columns to freeze (left)
 * - ySplit: number of rows to freeze (top)
 * - topLeftCell: first cell in scrollable area (Excel ref e.g. "F2")
 */
import JSZip from 'jszip';

/** Convert column index (0-based) to Excel column letter(s) */
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

/** Build topLeftCell ref from row (0-based) and col (0-based) */
const toCellRef = (row, col) => {
  return colToLetter(col) + (row + 1);
};

/**
 * Inject freeze panes into an xlsx buffer.
 * @param {Uint8Array|ArrayBuffer|Buffer} xlsxBuffer - Raw xlsx file buffer
 * @param {Array} sheetsConfig - [{ name?, freeze: { row, col } }, ...] - one per sheet in order
 * @returns {Promise<Uint8Array>} Modified xlsx buffer
 */
export const injectFreezePanes = async (xlsxBuffer, sheetsConfig = []) => {
  const zip = await JSZip.loadAsync(xlsxBuffer);
  const sheetFiles = Object.keys(zip.files)
    .filter((f) => f.startsWith('xl/worksheets/') && f.endsWith('.xml'))
    .sort();

  for (let i = 0; i < sheetFiles.length; i++) {
    const sheetFile = sheetFiles[i];
    const cfg = sheetsConfig[i];
    if (!cfg?.freeze) continue;

    const { row: ySplit = 0, col: xSplit = 0 } = cfg.freeze;
    if (xSplit <= 0 && ySplit <= 0) continue;
    // Excel reports "Removed Feature: View" / corruption when modifying sheetView with xSplit=0 or ySplit=0.
    // Only inject freeze when both row and col are > 0 to avoid corrupted output.
    if (xSplit <= 0 || ySplit <= 0) continue;

    let content = await zip.file(sheetFile).async('string');

    // topLeftCell: first unfrozen cell
    const topLeftCell = toCellRef(ySplit, xSplit);

    const paneXml = `<pane xSplit="${xSplit}" ySplit="${ySplit}" topLeftCell="${topLeftCell}" activePane="bottomRight" state="frozen"/>`;
    const selectionXml = `<selection pane="bottomRight" activeCell="${topLeftCell}" sqref="${topLeftCell}"/>`;

    // Replace self-closing <sheetView .../> with expanded version including pane
    const oldPattern = /<sheetView([^>]*)\/>/;
    const match = content.match(oldPattern);
    if (match) {
      const newSheetView = `<sheetView${match[1]}>\n  ${paneXml}\n  ${selectionXml}\n</sheetView>`;
      content = content.replace(oldPattern, newSheetView);
      zip.file(sheetFile, content);
    }
  }

  const outBuffer = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
  return outBuffer;
};
