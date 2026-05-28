/**
 * CriteriaFileManager
 * ──────────────────────────────────────────────────────────────────────────
 * Shared component that lets every Challenge report expose ONE criteria file
 * (the official PDF/image memo) per report key. Anyone can preview/download.
 * Only Administrators can upload, replace or delete.
 *
 * Storage backend: piggybacks on the existing /api/procedures endpoint.
 * Each report claims its own `reportType` (e.g. TEAM_BUILDING_CRITERIA) so
 * lookups are cheap and isolated. The uploaded file lives at
 *   /files/procedures/files/<filename>
 * and is registered as a procedure with a single "file" content block.
 *
 * Props:
 *   reportType  — string, e.g. 'TEAM_BUILDING_CRITERIA'
 *   title       — string shown in the section header
 *   accept      — optional file accept string (default: 'application/pdf,image/*')
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { proceduresAPI } from '../../../../../services/api';
import { useAuth } from '../../../../../contexts/AuthContext';
import { Toast, ConfirmDialog } from '../../../../../components/feedback/Feedback';
import './CriteriaFileManager.css';

const fmtSize = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const isPdfUrl = (url) => /\.pdf(\?.*)?$/i.test(url || '');
const isImageUrl = (url) => /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url || '');

// Extract the single file-block from a procedure's content (supports both
// array-of-blocks and {blocks: [...]} shapes for forward compatibility).
const extractFileBlock = (procedure) => {
  if (!procedure) return null;
  const content = procedure.content;
  const blocks = Array.isArray(content)
    ? content
    : (content && Array.isArray(content.blocks) ? content.blocks : []);
  return blocks.find((b) => b && (b.type === 'file' || b.type === 'image') && b.metadata?.url) || null;
};

const CriteriaFileManager = ({ reportType, title, accept = 'application/pdf,image/*' }) => {
  const { userData } = useAuth();
  const isAdmin = userData?.role === 'admin' || userData?.role === 'ALL';

  const [procedure, setProcedure] = useState(null); // backing procedure record
  const [fileBlock, setFileBlock] = useState(null); // {type, metadata:{url,filename,size}}
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); // upload / delete in flight
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const inputRef = useRef(null);
  const showToast = useCallback((t) => setToast({ ...t, _id: Date.now() }), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await proceduresAPI.getByTypeAndDepartment(reportType, null);
      if (result?.success && result.data) {
        setProcedure(result.data);
        setFileBlock(extractFileBlock(result.data));
      } else {
        setProcedure(null);
        setFileBlock(null);
      }
    } catch {
      setProcedure(null);
      setFileBlock(null);
    } finally {
      setLoading(false);
    }
  }, [reportType]);

  useEffect(() => { load(); }, [load]);

  const handlePickFile = () => inputRef.current?.click();

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      // 1) Upload the raw file to the procedures store
      const isImage = /^image\//i.test(file.type);
      const upload = await proceduresAPI.uploadFile(file, isImage ? 'image' : 'file');
      if (!upload?.success || !upload.data?.url) {
        throw new Error(upload?.error || 'Upload returned no URL');
      }

      // 2) Register / update the procedure record so the URL is persisted
      const newBlock = {
        type: isImage ? 'image' : 'file',
        content: '',
        formatting: {},
        metadata: {
          url:      upload.data.url,
          filename: upload.data.filename || file.name,
          size:     upload.data.size ?? file.size,
          mime:     file.type,
        },
      };
      const content = [newBlock];

      let saved;
      if (procedure?.id) {
        saved = await proceduresAPI.update(procedure.id, { content });
      } else {
        saved = await proceduresAPI.create({
          reportType,
          department: null,
          content,
        });
      }
      if (!saved?.success) throw new Error(saved?.error || 'Failed to save procedure');

      setProcedure(saved.data);
      setFileBlock(extractFileBlock(saved.data));
      showToast({
        type: 'success',
        title: 'Criteria uploaded',
        message: `${file.name} (${fmtSize(file.size)}) is now active.`,
      });
    } catch (ex) {
      showToast({ type: 'error', title: 'Upload failed', message: ex?.message || 'Unknown error' });
    } finally {
      setBusy(false);
      if (e.target) e.target.value = '';
    }
  }, [procedure, reportType, showToast]);

  const handleDelete = useCallback(async () => {
    if (!procedure?.id) return;
    setConfirmOpen(false);
    setBusy(true);
    try {
      const res = await proceduresAPI.delete(procedure.id);
      if (!res?.success && res?.success !== undefined) throw new Error(res?.error || 'Delete failed');
      setProcedure(null);
      setFileBlock(null);
      showToast({
        type: 'success',
        title: 'Criteria removed',
        message: 'The current criteria file has been deleted.',
      });
    } catch (ex) {
      showToast({ type: 'error', title: 'Delete failed', message: ex?.message || 'Unknown error' });
    } finally {
      setBusy(false);
    }
  }, [procedure, showToast]);

  const fileUrl  = fileBlock ? proceduresAPI.getFileUrl(fileBlock.metadata.url) : '';
  const fileName = fileBlock?.metadata?.filename || '';
  const fileSize = fileBlock?.metadata?.size;
  const ext      = (fileName.split('.').pop() || '').toUpperCase();
  const isPdf    = isPdfUrl(fileBlock?.metadata?.url || fileName);
  const isImage  = !isPdf && isImageUrl(fileBlock?.metadata?.url || fileName);

  return (
    <div className="cfm-card">
      <div className="cfm-head">
        <div className="cfm-head-left">
          <span className="cfm-icon" aria-hidden>📜</span>
          <div className="cfm-head-text">
            <div className="cfm-title">{title}</div>
            <div className="cfm-subtitle">
              The official memo this report is scored against.
              {isAdmin ? ' Admins can upload or replace it.' : ' Visible to everyone for reference.'}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="cfm-loading">Loading criteria…</div>
      ) : fileBlock ? (
        <div className="cfm-row">
          <div className="cfm-file">
            <div className={`cfm-ext cfm-ext--${isPdf ? 'pdf' : isImage ? 'img' : 'doc'}`}>
              {ext || (isPdf ? 'PDF' : isImage ? 'IMG' : 'FILE')}
            </div>
            <div className="cfm-file-info">
              <div className="cfm-file-name" title={fileName}>{fileName || 'criteria'}</div>
              <div className="cfm-file-meta">
                {fileSize ? fmtSize(fileSize) : '—'} · {isPdf ? 'PDF' : isImage ? 'Image' : 'File'}
              </div>
            </div>
          </div>

          <div className="cfm-actions">
            <button
              type="button"
              className="cfm-btn cfm-btn--preview"
              onClick={() => setPreviewOpen(true)}
              disabled={busy}
            >
              👁 Preview
            </button>
            <a
              className="cfm-btn cfm-btn--download"
              href={fileUrl}
              download={fileName || true}
              target="_blank"
              rel="noreferrer"
            >
              ⬇ Download
            </a>
            {isAdmin && (
              <>
                <button
                  type="button"
                  className="cfm-btn cfm-btn--replace"
                  onClick={handlePickFile}
                  disabled={busy}
                >
                  {busy ? 'Working…' : '↩ Replace'}
                </button>
                <button
                  type="button"
                  className="cfm-btn cfm-btn--delete"
                  onClick={() => setConfirmOpen(true)}
                  disabled={busy}
                  title="Remove criteria file"
                >
                  🗑
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="cfm-row cfm-row--empty">
          <div className="cfm-empty">
            {isAdmin
              ? 'No criteria file uploaded yet. Upload the official memo (PDF or image) to share it with the team.'
              : 'No criteria file has been uploaded yet. Ask an administrator to upload the official memo.'}
          </div>
          {isAdmin && (
            <button
              type="button"
              className="cfm-btn cfm-btn--upload"
              onClick={handlePickFile}
              disabled={busy}
            >
              {busy ? 'Uploading…' : '⬆ Upload Criteria'}
            </button>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Preview modal */}
      {previewOpen && fileBlock && (
        <div
          className="cfm-modal-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setPreviewOpen(false); }}
        >
          <div className="cfm-modal">
            <div className="cfm-modal-head">
              <div className="cfm-modal-title" title={fileName}>{fileName || 'Preview'}</div>
              <div className="cfm-modal-head-actions">
                <a
                  className="cfm-btn cfm-btn--download cfm-btn--sm"
                  href={fileUrl}
                  download={fileName || true}
                  target="_blank"
                  rel="noreferrer"
                >
                  ⬇ Download
                </a>
                <button
                  type="button"
                  className="cfm-modal-close"
                  onClick={() => setPreviewOpen(false)}
                  aria-label="Close preview"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="cfm-modal-body">
              {isPdf ? (
                <iframe
                  className="cfm-preview-frame"
                  src={fileUrl}
                  title={fileName || 'Criteria preview'}
                />
              ) : isImage ? (
                <img className="cfm-preview-image" src={fileUrl} alt={fileName || 'Criteria preview'} />
              ) : (
                <div className="cfm-preview-fallback">
                  Preview is not available for this file type. Use the Download
                  button to open it in your default application.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Remove criteria file?"
        message="This deletes the current criteria PDF/image for this report. You can upload a new one anytime."
        confirmLabel="Yes, delete"
        cancelLabel="Cancel"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />

      <Toast
        key={toast?._id}
        open={Boolean(toast)}
        type={toast?.type}
        title={toast?.title}
        message={toast?.message}
        onClose={() => setToast(null)}
      />
    </div>
  );
};

export default CriteriaFileManager;
