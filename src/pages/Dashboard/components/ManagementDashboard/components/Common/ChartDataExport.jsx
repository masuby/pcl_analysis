import { useState } from 'react';
import '../CountrywiseSection/CountrywiseSection.css';

const ChartDataExport = ({ chartData, column }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showToast, setShowToast] = useState(false);

  if (!chartData || chartData.length === 0) return null;

  const copyToClipboard = () => {
    // Create TSV (Tab-Separated Values) format for Excel compatibility
    const headers = ['Date', column || 'Value'];
    const rows = chartData.map(item => {
      const date = item.date instanceof Date ? item.date : new Date(item.date);
      const dateStr = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const value = item[column] || item.value || 0;
      // Use tab character (\t) instead of comma for Excel compatibility
      return `${dateStr}\t${value}`;
    });
    
    // Join headers and rows with tabs and newlines
    const tsv = [headers.join('\t'), ...rows].join('\n');
    
    navigator.clipboard.writeText(tsv).then(() => {
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  };

  return (
    <>
      <button
        className="chart-data-export-btn"
        onClick={() => setIsOpen(true)}
        title="View chart data"
      >
        👁️
      </button>
      
      {showToast && (
        <div className="chart-data-toast">
          Successfully copied
        </div>
      )}
      
      {isOpen && (
        <div className="chart-data-export-overlay" onClick={() => setIsOpen(false)}>
          <div className="chart-data-export-modal" onClick={(e) => e.stopPropagation()}>
            <div className="chart-data-export-header">
              <h4>Chart Data: {column}</h4>
              <button className="chart-data-export-close" onClick={() => setIsOpen(false)}>
                ×
              </button>
            </div>
            <div className="chart-data-export-body">
              <table className="chart-data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>{column || 'Value'}</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((item, index) => {
                    const date = item.date instanceof Date ? item.date : new Date(item.date);
                    const dateStr = date.toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    });
                    const value = item[column] || item.value || 0;
                    return (
                      <tr key={index}>
                        <td>{dateStr}</td>
                        <td>{typeof value === 'number' ? value.toLocaleString() : value}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="chart-data-export-footer">
              <button className="chart-data-copy-btn" onClick={copyToClipboard}>
                📋 Copy to Clipboard
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ChartDataExport;

