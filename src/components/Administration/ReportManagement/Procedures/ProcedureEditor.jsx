import { useState, useRef, useEffect } from 'react';
import { proceduresAPI } from '../../../../services/api';
import ProcedureViewer from './ProcedureViewer';
import './ProcedureEditor.css';

const ProcedureEditor = ({ reportType, department, onSave, onCancel, initialContent = [] }) => {
  const [content, setContent] = useState(initialContent);
  const [isEditing, setIsEditing] = useState(initialContent.length === 0);
  const [currentBlock, setCurrentBlock] = useState(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);

  // Update content when initialContent changes (e.g., after loading)
  useEffect(() => {
    if (initialContent && initialContent.length > 0) {
      setContent(initialContent);
      setIsEditing(false);
    }
  }, [initialContent]);

  useEffect(() => {
    if (isEditing && editorRef.current) {
      editorRef.current.focus();
    }
  }, [isEditing]);

  const addBlock = (type, afterIndex = null) => {
    const newBlock = {
      type,
      content: '',
      listType: type === 'list' ? 'ordered' : null,
      formatting: {},
      metadata: {},
    };

    const newContent = [...content];
    if (afterIndex === null) {
      newContent.push(newBlock);
    } else {
      newContent.splice(afterIndex + 1, 0, newBlock);
    }
    setContent(newContent);
    setCurrentBlock(newContent.length - 1);
  };

  const updateBlock = (index, updates) => {
    const newContent = [...content];
    newContent[index] = { ...newContent[index], ...updates };
    setContent(newContent);
  };

  const deleteBlock = (index) => {
    const newContent = content.filter((_, i) => i !== index);
    setContent(newContent);
    if (currentBlock === index) {
      setCurrentBlock(null);
    } else if (currentBlock > index) {
      setCurrentBlock(currentBlock - 1);
    }
  };

  const handleFormat = (command, value = null) => {
    if (currentBlock === null) return;
    
    const block = content[currentBlock];
    const newFormatting = { ...block.formatting };
    
    if (command === 'bold' || command === 'italic' || command === 'underline') {
      newFormatting[command] = !newFormatting[command];
    } else if (command === 'link') {
      const url = prompt('Enter URL:');
      if (url) {
        newFormatting.link = url;
      }
    } else {
      newFormatting[command] = value;
    }
    
    updateBlock(currentBlock, { formatting: newFormatting });
  };

  const handleFileUpload = async (file, type) => {
    try {
      setSaving(true);
      const result = await proceduresAPI.uploadFile(file, type);
      
      if (result.success) {
        const newBlock = {
          type: type === 'image' ? 'image' : 'file',
          content: '',
          formatting: {},
          metadata: {
            url: result.data.url,
            filename: result.data.filename,
            size: result.data.size,
          },
        };
        
        const newContent = [...content];
        if (currentBlock !== null) {
          newContent.splice(currentBlock + 1, 0, newBlock);
        } else {
          newContent.push(newBlock);
        }
        setContent(newContent);
      } else {
        alert('Failed to upload file: ' + result.error);
      }
    } catch (error) {
      alert('Error uploading file: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileUpload(file, 'image');
    }
    e.target.value = '';
  };

  const handleFileUploadClick = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileUpload(file, 'file');
    }
    e.target.value = '';
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await onSave(content);
      setIsEditing(false);
    } catch (error) {
      alert('Failed to save procedure: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const renderBlock = (block, index) => {
    const isSelected = currentBlock === index;
    
    return (
      <div
        key={index}
        className={`procedure-block ${isSelected ? 'selected' : ''}`}
        onClick={() => setCurrentBlock(index)}
      >
        {block.type === 'paragraph' && (
          <div className="block-content">
            <p
              contentEditable={isEditing}
              suppressContentEditableWarning
              onBlur={(e) => updateBlock(index, { content: e.target.textContent })}
              style={{
                fontWeight: block.formatting.bold ? 'bold' : 'normal',
                fontStyle: block.formatting.italic ? 'italic' : 'normal',
                textDecoration: block.formatting.underline ? 'underline' : 'none',
              }}
            >
              {block.content || 'Enter text...'}
            </p>
          </div>
        )}
        
        {block.type === 'heading' && (
          <div className="block-content">
            <h3
              contentEditable={isEditing}
              suppressContentEditableWarning
              onBlur={(e) => updateBlock(index, { content: e.target.textContent })}
            >
              {block.content || 'Enter heading...'}
            </h3>
          </div>
        )}
        
        {block.type === 'list' && (
          <div className="block-content">
            {block.listType === 'ordered' ? (
              <ol>
                <li
                  contentEditable={isEditing}
                  suppressContentEditableWarning
                  onBlur={(e) => updateBlock(index, { content: e.target.textContent })}
                >
                  {block.content || 'Enter list item...'}
                </li>
              </ol>
            ) : (
              <ul>
                <li
                  contentEditable={isEditing}
                  suppressContentEditableWarning
                  onBlur={(e) => updateBlock(index, { content: e.target.textContent })}
                >
                  {block.content || 'Enter list item...'}
                </li>
              </ul>
            )}
          </div>
        )}
        
        {block.type === 'image' && (
          <div className="block-content image-block">
            {block.metadata?.url ? (
              <>
                <img
                  src={proceduresAPI.getFileUrl(block.metadata.url)}
                  alt={block.metadata.filename || 'Procedure image'}
                  style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
                  onError={(e) => {
                    console.error('Image load error:', block.metadata.url);
                    e.target.style.display = 'none';
                    const errorMsg = e.target.nextElementSibling;
                    if (errorMsg) errorMsg.style.display = 'block';
                  }}
                />
                <div style={{ display: 'none', color: '#999', padding: '1rem', textAlign: 'center' }}>
                  Failed to load image: {block.metadata.filename || 'Unknown'}
                </div>
              </>
            ) : (
              <div style={{ color: '#999', padding: '1rem', textAlign: 'center' }}>
                Image not available
              </div>
            )}
            {isEditing && (
              <button
                className="remove-block-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteBlock(index);
                }}
              >
                Remove Image
              </button>
            )}
          </div>
        )}
        
        {block.type === 'file' && (
          <div className="block-content file-block">
            {block.metadata?.url && block.metadata?.filename ? (
              <a
                href={proceduresAPI.getFileUrl(block.metadata.url)}
                download={block.metadata.filename}
                className="file-link"
              >
                📎 {block.metadata.filename}
                {block.metadata.size && ` (${(block.metadata.size / 1024).toFixed(2)} KB)`}
              </a>
            ) : (
              <div style={{ color: '#999', padding: '0.5rem' }}>
                File not available
              </div>
            )}
            {isEditing && (
              <button
                className="remove-block-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteBlock(index);
                }}
              >
                Remove File
              </button>
            )}
          </div>
        )}
        
        {block.type === 'formula' && (
          <div className="block-content">
            <div className="formula-display">
              <code
                contentEditable={isEditing}
                suppressContentEditableWarning
                onBlur={(e) => updateBlock(index, { content: e.target.textContent })}
              >
                {block.content || 'Enter formula...'}
              </code>
            </div>
          </div>
        )}
        
        {isEditing && (
          <div className="block-actions">
            <button
              className="delete-block-btn"
              onClick={(e) => {
                e.stopPropagation();
                deleteBlock(index);
              }}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  };

  // If not editing and have content, show viewer
  if (!isEditing && content.length > 0) {
    return (
      <div className="procedure-editor">
        <div className="editor-header">
          <h3>
            Procedure: {reportType}
            {department && ` - ${department}`}
          </h3>
          <button className="edit-btn" onClick={() => setIsEditing(true)}>
            Edit
          </button>
        </div>
        <ProcedureViewer procedure={{ content }} />
      </div>
    );
  }

  return (
    <div className="procedure-editor">
      <div className="editor-header">
        <h3>
          Procedure: {reportType}
          {department && ` - ${department}`}
        </h3>
        {!isEditing && content.length > 0 && (
          <button className="edit-btn" onClick={() => setIsEditing(true)}>
            Edit
          </button>
        )}
      </div>

      {isEditing && (
        <div className="editor-toolbar">
          <div className="toolbar-group">
            <button
              onClick={() => addBlock('paragraph')}
              title="Add Paragraph"
            >
              📝 Paragraph
            </button>
            <button
              onClick={() => addBlock('heading')}
              title="Add Heading"
            >
              📌 Heading
            </button>
            <button
              onClick={() => addBlock('list')}
              title="Add List"
            >
              • List
            </button>
          </div>
          
          <div className="toolbar-group">
            <button
              onClick={() => handleFormat('bold')}
              disabled={currentBlock === null}
              title="Bold (Ctrl+B)"
            >
              <strong>B</strong>
            </button>
            <button
              onClick={() => handleFormat('italic')}
              disabled={currentBlock === null}
              title="Italic"
            >
              <em>I</em>
            </button>
            <button
              onClick={() => handleFormat('underline')}
              disabled={currentBlock === null}
              title="Underline"
            >
              <u>U</u>
            </button>
          </div>
          
          <div className="toolbar-group">
            <label className="upload-btn">
              📷 Image
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                style={{ display: 'none' }}
              />
            </label>
            <label className="upload-btn">
              📎 File
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                onChange={handleFileUploadClick}
                style={{ display: 'none' }}
              />
            </label>
            <button
              onClick={() => addBlock('formula')}
              title="Add Formula"
            >
              Σ Formula
            </button>
          </div>
        </div>
      )}

      <div className="editor-content" ref={editorRef}>
        {content.length === 0 && isEditing ? (
          <div className="empty-editor">
            <p>Click the toolbar buttons above to add content blocks</p>
          </div>
        ) : (
          content.map((block, index) => renderBlock(block, index))
        )}
      </div>

      {isEditing && (
        <div className="editor-footer">
          <button className="cancel-btn" onClick={() => {
            setIsEditing(false);
            setContent(initialContent);
            onCancel && onCancel();
          }}>
            Cancel
          </button>
          <button
            className="save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ProcedureEditor;
