import React, { useEffect, useRef, useState } from 'react';

/**
 * Button that, on click, shows a popup describing the expected format of the file
 * to upload, plus an action button that triggers a hidden <input type="file">.
 *
 * The popup closes automatically when clicking outside of it or pressing Escape.
 */
const UploadInstructionsButton = ({
  label,
  icon,
  className = '',
  title,
  instructions = [],
  onFilePicked,
  replaceLabel = 'Upload new file',
  existingFile,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const handlePick = () => {
    inputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setOpen(false);
      try {
        await onFilePicked?.(file);
      } finally {
        // Clear the input so the same file can be selected again later.
        if (inputRef.current) inputRef.current.value = '';
      }
    }
  };

  return (
    <div className="set-upload-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`set-btn ${className}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {icon ? <span>{icon}</span> : null}
        {label}
      </button>
      {open && (
        <div className="set-upload-popup" role="dialog" aria-modal="true">
          <div className="set-upload-popup-arrow" />
          <div className="set-upload-popup-header">
            <h4 className="set-upload-popup-title">{title}</h4>
            {existingFile ? (
              <div className="set-upload-popup-meta">
                Current: <strong>{existingFile.fileName}</strong>
                {existingFile.createdAt ? (
                  <span className="set-upload-popup-meta-date">
                    {' · '}
                    {new Date(existingFile.createdAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="set-upload-popup-meta set-upload-popup-meta-empty">No file uploaded yet.</div>
            )}
          </div>
          <ul className="set-upload-popup-list">
            {instructions.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          <div className="set-upload-popup-actions">
            <button type="button" className="set-upload-popup-btn" onClick={handlePick}>
              {existingFile ? replaceLabel : 'Upload file'}
            </button>
            <button
              type="button"
              className="set-upload-popup-btn set-upload-popup-btn-secondary"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="set-hidden-input"
            onChange={handleFileChange}
          />
        </div>
      )}
    </div>
  );
};

export default UploadInstructionsButton;
