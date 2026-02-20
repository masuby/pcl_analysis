import { useState } from 'react';
import { getMetricValue } from '../../utils/reportUtils';
import '../CountrywiseSection/CountrywiseSection.css';

/**
 * Button + modal that shows Date, Number of Clients, Active clients, Inactive clients
 * for the current section (Countrywise, CS, LBF, SME). Placed below the chart eye button.
 */
const ClientBreakdownModal = ({ data = [], sectionLabel = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const hasClientData = data.some(
    item =>
      getMetricValue(item, 'Number of Clients') > 0 ||
      getMetricValue(item, 'Active clients') > 0 ||
      getMetricValue(item, 'Inactive clients') > 0
  );

  if (!data?.length || !hasClientData) return null;

  const sortedData = [...data].sort((a, b) => {
    const dateA = a.date instanceof Date ? a.date : new Date(a.date);
    const dateB = b.date instanceof Date ? b.date : new Date(b.date);
    return dateB - dateA; // Newest first
  });

  const copyToClipboard = () => {
    const headers = ['Date', 'Number of Clients', 'Active clients', 'Inactive clients'];
    const rows = sortedData.map(item => {
      const date = item.date instanceof Date ? item.date : new Date(item.date);
      const dateStr = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const numClients = getMetricValue(item, 'Number of Clients');
      const active = getMetricValue(item, 'Active clients');
      const inactive = getMetricValue(item, 'Inactive clients');
      return `${dateStr}\t${numClients}\t${active}\t${inactive}`;
    });
    const tsv = [headers.join('\t'), ...rows].join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2000);
    }).catch(err => console.error(err));
  };

  return (
    <>
      <button
        className="chart-client-breakdown-btn"
        onClick={() => setIsOpen(true)}
        title="View client breakdown (Date, Active, Inactive, Number of Clients)"
      >
        👥
      </button>

      {showToast && (
        <div className="chart-data-toast">Successfully copied</div>
      )}

      {isOpen && (
        <div className="chart-data-export-overlay" onClick={() => setIsOpen(false)}>
          <div className="chart-data-export-modal chart-client-breakdown-modal" onClick={e => e.stopPropagation()}>
            <div className="chart-data-export-header">
              <h4>Client Breakdown ({sectionLabel})</h4>
              <button className="chart-data-export-close" onClick={() => setIsOpen(false)}>
                ×
              </button>
            </div>
            <div className="chart-data-export-body">
              <table className="chart-data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Number of Clients</th>
                    <th>Active clients</th>
                    <th>Inactive clients</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedData.map((item, index) => {
                    const date = item.date instanceof Date ? item.date : new Date(item.date);
                    const dateStr = date.toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    });
                    const numClients = getMetricValue(item, 'Number of Clients');
                    const active = getMetricValue(item, 'Active clients');
                    const inactive = getMetricValue(item, 'Inactive clients');
                    return (
                      <tr key={index}>
                        <td>{dateStr}</td>
                        <td>{numClients.toLocaleString()}</td>
                        <td>{active.toLocaleString()}</td>
                        <td>{inactive.toLocaleString()}</td>
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

export default ClientBreakdownModal;
