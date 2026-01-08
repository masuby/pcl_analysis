import { useState } from 'react';
import './ClusterAnalysisSection.css';

const ComparisonList = ({ data, column, formatNumber }) => {
  const [showAll, setShowAll] = useState(false);
  const displayCount = 3;
  const displayData = showAll ? data : data.slice(0, displayCount);
  const hasMore = data.length > displayCount;

  return (
    <>
      <div className="comparison-list">
        {displayData.map((item, index) => (
          <div key={item.name} className={`comparison-item ${index === 0 ? 'best-performer' : ''}`}>
            <span className="item-rank">{index + 1}.</span>
            <span className="item-name">
              {index === 0 && '🏆 '}
              {item.name}
            </span>
            <span className="item-value">{formatNumber(item.value)}</span>
          </div>
        ))}
      </div>
      {hasMore && !showAll && (
        <div className="comparison-view-all">
          <button 
            className="view-all-btn" 
            onClick={() => setShowAll(true)}
          >
            View All ({data.length})
          </button>
        </div>
      )}
      {showAll && hasMore && (
        <div className="comparison-view-all">
          <button 
            className="view-all-btn" 
            onClick={() => setShowAll(false)}
          >
            Show Less
          </button>
        </div>
      )}
    </>
  );
};

export default ComparisonList;

