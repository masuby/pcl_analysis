import { proceduresAPI } from '../../../../services/api';
import './ProcedureViewer.css';

const ProcedureViewer = ({ procedure }) => {
  if (!procedure || !procedure.content || procedure.content.length === 0) {
    return (
      <div className="procedure-viewer">
        <div className="no-procedure">
          <div className="no-procedure-icon">📋</div>
          <h3>No Procedure Available</h3>
          <p>This procedure has not been created yet.</p>
        </div>
      </div>
    );
  }

  const renderBlock = (block, index) => {
    switch (block.type) {
      case 'paragraph':
        return (
          <div key={index} className="procedure-block paragraph-block">
            <p
              style={{
                fontWeight: block.formatting?.bold ? 'bold' : 'normal',
                fontStyle: block.formatting?.italic ? 'italic' : 'normal',
                textDecoration: block.formatting?.underline ? 'underline' : 'none',
              }}
            >
              {block.content}
            </p>
          </div>
        );

      case 'heading':
        return (
          <div key={index} className="procedure-block heading-block">
            <h3>{block.content}</h3>
          </div>
        );

      case 'list':
        const ListTag = block.listType === 'ordered' ? 'ol' : 'ul';
        return (
          <div key={index} className="procedure-block list-block">
            <ListTag>
              <li>{block.content}</li>
            </ListTag>
          </div>
        );

      case 'image':
        return (
          <div key={index} className="procedure-block image-block">
            {block.metadata?.url ? (
              <img
                src={proceduresAPI.getFileUrl(block.metadata.url)}
                alt={block.metadata?.filename || 'Procedure image'}
                onError={(e) => {
                  console.error('Image load error:', block.metadata?.url);
                  e.target.style.display = 'none';
                  const errorDiv = document.createElement('div');
                  errorDiv.textContent = `Failed to load image: ${block.metadata?.filename || 'Unknown'}`;
                  errorDiv.style.cssText = 'color: #999; padding: 1rem; text-align: center;';
                  e.target.parentNode.appendChild(errorDiv);
                }}
              />
            ) : (
              <div style={{ color: '#999', padding: '1rem', textAlign: 'center' }}>
                Image not available
              </div>
            )}
          </div>
        );

      case 'file':
        return (
          <div key={index} className="procedure-block file-block">
            {block.metadata?.url && block.metadata?.filename ? (
              <a
                href={proceduresAPI.getFileUrl(block.metadata.url)}
                download={block.metadata.filename}
                className="file-download-link"
              >
                <span className="file-icon">📎</span>
                <span className="file-name">{block.metadata.filename}</span>
                {block.metadata.size && (
                  <span className="file-size">
                    ({(block.metadata.size / 1024).toFixed(2)} KB)
                  </span>
                )}
              </a>
            ) : (
              <div style={{ color: '#999', padding: '0.5rem' }}>
                File not available
              </div>
            )}
          </div>
        );

      case 'formula':
        return (
          <div key={index} className="procedure-block formula-block">
            <code>{block.content}</code>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="procedure-viewer">
      <div className="procedure-content">
        {procedure.content.map((block, index) => renderBlock(block, index))}
      </div>
    </div>
  );
};

export default ProcedureViewer;
