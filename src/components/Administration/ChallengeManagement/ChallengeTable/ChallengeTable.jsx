import React from 'react';
import { getChallengeStatus } from '../../../../services/challenges';
import { getChallengeAttachmentUrl } from '../../../../services/supabase';
import './ChallengeTable.css';

const ChallengeTable = ({ challenges, onChallengeClick }) => {
  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (error) {
      return 'Invalid Date';
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'N/A';
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getDepartmentColor = (department) => {
    const colors = {
      CS: '#38a169',
      LBF: '#d69e2e',
      SME: '#805ad5',
      ALL: '#3182ce'
    };
    return colors[department] || '#666';
  };

  const getStatusColor = (status) => {
    const colors = {
      finished: '#38a169',
      incoming: '#4299e1',
      ongoing: '#ed8936',
      unknown: '#666'
    };
    return colors[status] || '#666';
  };

  const getStatusLabel = (status) => {
    const labels = {
      finished: 'Finished',
      incoming: 'Incoming',
      ongoing: 'Ongoing',
      unknown: 'Unknown'
    };
    return labels[status] || 'Unknown';
  };

  const handleDownload = async (e, challenge) => {
    e.stopPropagation();
    
    if (challenge.attachmentUrl) {
      window.open(challenge.attachmentUrl, '_blank');
    } else if (challenge.attachmentPath) {
      const url = await getChallengeAttachmentUrl(challenge.attachmentPath);
      if (url) {
        window.open(url, '_blank');
      }
    }
  };

  return (
    <div className="challenge-table-wrapper">
      <div className="table-responsive">
        <table className="challenge-table">
          <thead>
            <tr>
              <th className="title-column">Challenge Title</th>
              <th className="department-column">Department</th>
              <th className="status-column">Status</th>
              <th className="date-column">Start - End Date</th>
              <th className="size-column">Attachment Size</th>
              <th className="actions-column">Actions</th>
            </tr>
          </thead>
          <tbody>
            {challenges.map((challenge) => {
              const status = getChallengeStatus(challenge);
              return (
                <tr 
                  key={challenge.id} 
                  className="challenge-row"
                  onClick={() => onChallengeClick(challenge)}
                  tabIndex={0}
                  onKeyPress={(e) => e.key === 'Enter' && onChallengeClick(challenge)}
                >
                  <td className="title-column">
                    <div className="challenge-info">
                      <div className="challenge-icon">
                        {challenge.imageUrl ? '🖼️' : '🎯'}
                      </div>
                      <div className="challenge-details">
                        <div className="challenge-title">
                          {challenge.title || 'Untitled Challenge'}
                        </div>
                        {challenge.description && (
                          <div className="challenge-description" title={challenge.description}>
                            {challenge.description.length > 50 
                              ? challenge.description.substring(0, 50) + '...' 
                              : challenge.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="department-column">
                    <span 
                      className="department-badge"
                      style={{ backgroundColor: getDepartmentColor(challenge.department) }}
                    >
                      {challenge.department}
                    </span>
                  </td>
                  <td className="status-column">
                    <span 
                      className="status-badge"
                      style={{ backgroundColor: getStatusColor(status) }}
                    >
                      {getStatusLabel(status)}
                    </span>
                  </td>
                  <td className="date-column">
                    <div className="date-range">
                      <span className="date-item">
                        <strong>Start:</strong> {formatDate(challenge.startDate)}
                      </span>
                      <span className="date-item">
                        <strong>End:</strong> {formatDate(challenge.endDate)}
                      </span>
                    </div>
                  </td>
                  <td className="size-column">
                    <span className="file-size">
                      {formatFileSize(challenge.attachmentSize)}
                    </span>
                  </td>
                  <td className="actions-column">
                    <div className="action-buttons">
                      {challenge.attachmentUrl || challenge.attachmentPath ? (
                        <button 
                          className="download-button"
                          onClick={(e) => handleDownload(e, challenge)}
                          aria-label={`Download ${challenge.title}`}
                        >
                          📥
                        </button>
                      ) : null}
                      <button 
                        className="view-button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onChallengeClick(challenge);
                        }}
                        aria-label={`View details for ${challenge.title}`}
                      >
                        👁️
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      
      {/* Table Footer */}
      <div className="table-footer">
        <div className="footer-info">
          Showing <strong>{challenges.length}</strong> challenges
        </div>
      </div>
    </div>
  );
};

export default ChallengeTable;

