import React from 'react';
import './ClusterAnalysisSection.css';

const ComparisonModal = ({ isOpen, onClose, comparisonData, selectedColumn, levelName }) => {
  if (!isOpen) return null;

  const formatNumber = (num) => {
    if (num === null || num === undefined || isNaN(num)) return 'N/A';
    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (absNum >= 1000000000) return sign + (absNum / 1000000000).toFixed(2) + 'B';
    if (absNum >= 1000000) return sign + (absNum / 1000000).toFixed(2) + 'M';
    if (absNum >= 1000) return sign + (absNum / 1000).toFixed(2) + 'K';
    return sign + absNum.toLocaleString();
  };

  return (
    <div className="comparison-modal-overlay" onClick={onClose}>
      <div className="comparison-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="comparison-modal-header">
          <h3>Performance Ranking - {levelName}</h3>
          <button className="comparison-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="comparison-modal-body">
          <div className="comparison-table">
            <div className="comparison-table-header">
              <div className="comparison-rank-col">Rank</div>
              <div className="comparison-name-col">Name</div>
              <div className="comparison-value-col">{selectedColumn}</div>
            </div>
            <div className="comparison-table-body">
              {comparisonData.map((item, index) => (
                <div 
                  key={item.name} 
                  className={`comparison-table-row ${index === 0 ? 'top-performer' : ''}`}
                >
                  <div className="comparison-rank-col">
                    {index === 0 && <span className="top-badge">🏆</span>}
                    <span className="rank-number">{index + 1}</span>
                  </div>
                  <div className="comparison-name-col">{item.name}</div>
                  <div className="comparison-value-col">{formatNumber(item.value)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComparisonModal;



