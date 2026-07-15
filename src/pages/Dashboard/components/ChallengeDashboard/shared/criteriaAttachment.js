/**
 * criteriaAttachment
 * ──────────────────────────────────────────────────────────────────────────
 * Fetches the official criteria file (the PDF/image memo managed by
 * CriteriaFileManager) for a given challenge report so it can be attached to
 * the emailed report alongside the Excel.
 *
 * The criteria file is stored as a "procedure" keyed by reportType
 * (e.g. TEAM_BUILDING_CRITERIA). This mirrors CriteriaFileManager's lookup,
 * then downloads the file and returns it as an email attachment
 * ({ base64, name }) — or null when no criteria is uploaded / it can't be read.
 */

import { proceduresAPI } from '../../../../../services/api';

// Same shape-tolerant extraction CriteriaFileManager uses.
function extractFileBlock(procedure) {
  if (!procedure) return null;
  const content = procedure.content;
  const blocks = Array.isArray(content)
    ? content
    : (content && Array.isArray(content.blocks) ? content.blocks : []);
  return blocks.find((b) => b && (b.type === 'file' || b.type === 'image') && b.metadata?.url) || null;
}

// Chunked ArrayBuffer → base64 (avoids call-stack overflow on large PDFs).
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * @param {string} reportType e.g. 'TEAM_BUILDING_CRITERIA'
 * @returns {Promise<{ base64: string, name: string } | null>}
 */
export async function fetchCriteriaAttachment(reportType) {
  try {
    const result = await proceduresAPI.getByTypeAndDepartment(reportType, null);
    if (!result?.success || !result.data) return null;

    const block = extractFileBlock(result.data);
    if (!block?.metadata?.url) return null;

    const url = proceduresAPI.getFileUrl(block.metadata.url);
    const resp = await fetch(url);
    if (!resp.ok) return null;

    const buf = await resp.arrayBuffer();
    const name = block.metadata.filename || 'criteria.pdf';
    return { base64: arrayBufferToBase64(buf), name };
  } catch {
    return null;
  }
}

export default fetchCriteriaAttachment;
