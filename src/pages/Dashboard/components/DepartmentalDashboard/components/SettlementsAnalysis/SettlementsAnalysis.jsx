import { useCallback, useEffect, useMemo, useState } from 'react';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';
import { useManagementData } from '../../../ManagementDashboard/hooks/useManagementData';
import { settlementsAPI } from '../../../../../../services/settlements';
import { parseTransactionsWorkbook } from './utils/transactionsParser';
import { parseZoneClusterWorkbook } from './utils/zoneClusterParser';
import { buildManagementIssuanceLookup } from './utils/managementIssuance';
import { buildSettlementReport } from './utils/settlementReportBuilder';
import { buildSettlementWorkbook } from './utils/settlementExcelExport';
import { buildSettlementEmailHTML, sendSettlementEmail } from './utils/settlementEmail';
import UploadInstructionsButton from './components/UploadInstructionsButton';
import ProductSettlementView from './components/ProductSettlementView';
import './SettlementsAnalysis.css';

const RECIPIENTS_KEY = 'settlements_analysis_email_recipients';
const TRANSACTIONS_INSTRUCTIONS = [
  'Upload the monthly Transactions export (.xlsx).',
  'Required columns: Creation Date, Amount, Branch, Institution that buys the Loan.',
  'The "Branch" column is matched against the Zone & Cluster file to resolve each transaction to a product (CS, LBF, SME, Agrifinance, …). Upload the Zone & Cluster file first for accurate product mapping.',
  'Data is grouped by the Creation Date\'s month; totals and trends are computed per product.',
  'Existing file (if any) is replaced. Previous versions are kept on the server.',
];
const ZONE_CLUSTER_INSTRUCTIONS = [
  'Upload the Zone & Cluster mapping file (.xlsx).',
  'Required columns: Zone, Branch, Cluster, Product.',
  'The "Branch" and "Product" columns are used as a VLOOKUP so every transaction row is classified under CS, LBF, SME, Agrifinance, or any new product you add.',
  'Upload a new file here whenever branch allocations change. Existing file is replaced.',
];

const parseEmails = (text) =>
  (text || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));

const SettlementsAnalysis = () => {
  const { parsedReports, loading: managementLoading } = useManagementData();

  const [transactionsFileMeta, setTransactionsFileMeta] = useState(null);
  const [zoneClusterFileMeta, setZoneClusterFileMeta] = useState(null);

  const [busy, setBusy] = useState({ phase: 'idle', message: '' });
  const [error, setError] = useState('');
  const [transactionsData, setTransactionsData] = useState(null); // { rows: [...] }
  const [zoneClusterData, setZoneClusterData] = useState(null); // { branchToProduct, products }
  const [report, setReport] = useState(null);
  const [activeTab, setActiveTab] = useState('Total');

  // Email modal state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [recipients, setRecipients] = useState(() => {
    try {
      const raw = localStorage.getItem(RECIPIENTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [newRecipient, setNewRecipient] = useState('');
  const [pasteBox, setPasteBox] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendSuccess, setSendSuccess] = useState('');

  const persistRecipients = (next) => {
    setRecipients(next);
    try {
      localStorage.setItem(RECIPIENTS_KEY, JSON.stringify(next));
    } catch {
      // no-op
    }
  };

  const issuanceLookup = useMemo(
    () => buildManagementIssuanceLookup(parsedReports || []),
    [parsedReports]
  );

  /** Fetch stored files (if any) and auto-load them on mount. */
  const loadStoredFiles = useCallback(async () => {
    setBusy({ phase: 'loading', message: 'Loading stored files…' });
    try {
      const [txRes, zcRes] = await Promise.all([
        settlementsAPI.getActive('TRANSACTIONS').catch(() => ({ data: null })),
        settlementsAPI.getActive('ZONE_CLUSTER').catch(() => ({ data: null })),
      ]);

      const txMeta = txRes?.data || null;
      const zcMeta = zcRes?.data || null;
      setTransactionsFileMeta(txMeta);
      setZoneClusterFileMeta(zcMeta);

      // Download and parse whatever is stored so the UI is immediately populated.
      const tasks = [];
      if (txMeta?.id) {
        tasks.push(
          settlementsAPI
            .downloadBlob(txMeta.id)
            .then((blob) => parseTransactionsWorkbook(blob))
            .then((res) => setTransactionsData(res))
            .catch(() => null)
        );
      }
      if (zcMeta?.id) {
        tasks.push(
          settlementsAPI
            .downloadBlob(zcMeta.id)
            .then((blob) => parseZoneClusterWorkbook(blob))
            .then((res) => setZoneClusterData(res))
            .catch(() => null)
        );
      }
      await Promise.all(tasks);
    } catch (e) {
      setError(e?.message || 'Failed to load stored files');
    } finally {
      setBusy({ phase: 'idle', message: '' });
    }
  }, []);

  useEffect(() => {
    loadStoredFiles();
  }, [loadStoredFiles]);

  /** Rebuild the report whenever all inputs are ready. */
  useEffect(() => {
    if (!transactionsData?.rows || !zoneClusterData?.branchToProduct) {
      setReport(null);
      return;
    }
    try {
      const built = buildSettlementReport({
        transactions: transactionsData.rows,
        branchToProduct: zoneClusterData.branchToProduct,
        issuanceLookup,
      });
      setReport(built);
      if (!built.products.includes(activeTab)) {
        setActiveTab('Total');
      }
    } catch (e) {
      setError(e?.message || 'Failed to build report');
    }
  }, [transactionsData, zoneClusterData, issuanceLookup, activeTab]);

  const handleUpload = async (kind, file) => {
    if (!file) return;
    const kindLabel = kind === 'TRANSACTIONS' ? 'Transactions' : 'Zone & Cluster';
    setError('');
    setBusy({ phase: 'uploading', message: `Uploading ${kindLabel}…` });
    try {
      const res = await settlementsAPI.upload({ kind, file });
      const meta = res?.data || null;
      if (kind === 'TRANSACTIONS') setTransactionsFileMeta(meta);
      else setZoneClusterFileMeta(meta);

      setBusy({ phase: 'parsing', message: `Parsing ${kindLabel}…` });
      if (kind === 'TRANSACTIONS') {
        const parsed = await parseTransactionsWorkbook(file);
        setTransactionsData(parsed);
      } else {
        const parsed = await parseZoneClusterWorkbook(file);
        setZoneClusterData(parsed);
      }
    } catch (e) {
      setError(e?.message || `Upload failed (${kindLabel})`);
    } finally {
      setBusy({ phase: 'idle', message: '' });
    }
  };

  const onTransactionsPicked = async (file) => handleUpload('TRANSACTIONS', file);
  const onZoneClusterPicked = async (file) => handleUpload('ZONE_CLUSTER', file);

  const generatedLabel = useMemo(() => {
    if (!report?.generatedAt) return '';
    return report.generatedAt.toLocaleString('en-GB');
  }, [report]);

  const xlsxFileName = useMemo(() => {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    return `Settlements_Analysis_${date}.xlsx`;
  }, []);

  const handleDownloadXlsx = async () => {
    if (!report) return;
    setBusy({ phase: 'exporting', message: 'Building styled XLSX with charts…' });
    setError('');
    try {
      const { buffer } = await buildSettlementWorkbook(report);
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = xlsxFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e?.message || 'XLSX export failed');
    } finally {
      setBusy({ phase: 'idle', message: '' });
    }
  };

  const handleDownloadRawFile = async (meta, label) => {
    if (!meta?.id) return;
    setError('');
    setBusy({ phase: 'downloading', message: `Downloading ${label} raw file…` });
    try {
      const blob = await settlementsAPI.downloadBlob(meta.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.fileName || `${label.replace(/\s+/g, '_')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e?.message || `Failed to download ${label} raw file`);
    } finally {
      setBusy({ phase: 'idle', message: '' });
    }
  };

  const handleSendEmail = async () => {
    setSendError('');
    setSendSuccess('');
    if (!report) return;
    if (recipients.length === 0) {
      setSendError('Add at least one recipient first.');
      return;
    }
    setSending(true);
    try {
      const { buffer } = await buildSettlementWorkbook(report);
      // Convert buffer -> base64
      const uint8 = new Uint8Array(buffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < uint8.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, uint8.subarray(i, i + chunkSize));
      }
      const attachmentBase64 = btoa(binary);

      const now = new Date();
      const currentMonth = now.toLocaleString('en-US', { month: 'long' }).toUpperCase();
      const currentYear = now.getFullYear();
      const subject = `SETTLEMENT ANALYSIS REPORT FOR ${currentMonth} ${currentYear}`;
      const htmlBody = buildSettlementEmailHTML(generatedLabel, report);
      const result = await sendSettlementEmail(recipients, subject, htmlBody, {
        attachmentBase64,
        attachmentName: xlsxFileName,
      });
      if (result.success) {
        setSendSuccess(`Sent to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}.`);
      } else {
        setSendError(result.error || 'Failed to send email');
      }
    } catch (e) {
      setSendError(e?.message || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const addNewRecipient = () => {
    const e = (newRecipient || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setSendError('Please enter a valid email address.');
      return;
    }
    if (recipients.includes(e)) {
      setSendError('Recipient already added.');
      return;
    }
    setSendError('');
    persistRecipients([...recipients, e]);
    setNewRecipient('');
  };

  const addPastedEmails = () => {
    const found = parseEmails(pasteBox);
    if (found.length === 0) return;
    const merged = Array.from(new Set([...recipients, ...found]));
    persistRecipients(merged);
    setPasteBox('');
  };

  const removeRecipient = (email) => {
    persistRecipients(recipients.filter((r) => r !== email));
  };

  const copyAllEmails = async () => {
    if (!recipients.length) return;
    try {
      await navigator.clipboard.writeText(recipients.join(', '));
    } catch {
      // no-op
    }
  };

  const tabs = report?.products?.length
    ? report.products.filter((p) => p !== 'Unmapped')
    : ['Total'];
  const activeData = report?.perProduct?.[activeTab];

  const hasBothFiles = !!transactionsData && !!zoneClusterData;

  return (
    <div className="set-page">
      {/* Header bar with controls */}
      <div className="set-header-bar">
        <div className="set-header-bar-left">
          <h2 className="set-header-title">SETTLEMENTS ANALYSIS</h2>
          {generatedLabel && <span className="set-header-subtitle">Last built: {generatedLabel}</span>}
        </div>
        <div className="set-header-controls">
          <button
            type="button"
            className="set-btn set-btn-email"
            disabled={!hasBothFiles || busy.phase !== 'idle'}
            onClick={() => {
              setSendError('');
              setSendSuccess('');
              setShowEmailModal(true);
            }}
          >
            <span>✉</span> Send Email
          </button>
          <button
            type="button"
            className="set-btn"
            disabled={!hasBothFiles || busy.phase !== 'idle'}
            onClick={handleDownloadXlsx}
          >
            <span>📥</span> Download XLSX
          </button>
          <UploadInstructionsButton
            label="Upload Transaction File"
            icon="📁"
            className="set-btn-upload-loan"
            title="Transactions file"
            instructions={TRANSACTIONS_INSTRUCTIONS}
            onFilePicked={onTransactionsPicked}
            existingFile={transactionsFileMeta}
            disabled={busy.phase === 'uploading'}
          />
          <UploadInstructionsButton
            label="Upload Zone and Cluster File"
            icon="🗂"
            className="set-btn-upload-zone"
            title="Zone & Cluster file"
            instructions={ZONE_CLUSTER_INSTRUCTIONS}
            onFilePicked={onZoneClusterPicked}
            existingFile={zoneClusterFileMeta}
            disabled={busy.phase === 'uploading'}
          />
        </div>
      </div>

      {/* Status / error strips */}
      {(busy.phase !== 'idle' || managementLoading) && (
        <div className="set-status-strip">
          <LoadingSpinner size="small" />
          <span>{busy.message || 'Loading management report data…'}</span>
        </div>
      )}
      {error ? <div className="set-error-strip">{error}</div> : null}

      {/* File status (plain inline text) */}
      <div className="set-file-cards">
        <FileStatusCard
          label="Transactions file"
          meta={transactionsFileMeta}
          onDownloadRaw={() => handleDownloadRawFile(transactionsFileMeta, 'Transactions')}
          downloadDisabled={busy.phase !== 'idle'}
        />
        <FileStatusCard
          label="Zone & Cluster file"
          meta={zoneClusterFileMeta}
          onDownloadRaw={() => handleDownloadRawFile(zoneClusterFileMeta, 'Zone & Cluster')}
          downloadDisabled={busy.phase !== 'idle'}
        />
      </div>

      {/* Unmapped branches info — plain text, no box */}
      {report?.unmappedBranches?.length ? (
        <div className="set-warning-strip">
          <strong>{report.unmappedBranches.length} branch(es) could not be mapped to a product.</strong>{' '}
          These transaction branches are missing from the Zone &amp; Cluster file and were excluded from every
          sheet (Total included). Update the Zone &amp; Cluster file if they should appear in the report:{' '}
          <span className="set-warning-list">
            {report.unmappedBranches.slice(0, 12).map((u) => (
              <span key={u.branch} className="set-warning-chip">
                {u.branch} · {u.count}
              </span>
            ))}
            {report.unmappedBranches.length > 12 ? (
              <span className="set-warning-chip">+{report.unmappedBranches.length - 12} more…</span>
            ) : null}
          </span>
        </div>
      ) : null}

      {/* Main content */}
      {!hasBothFiles ? (
        <div className="set-empty-card">
          <div className="set-empty-icon">💳</div>
          <p>Upload both the Transactions and the Zone & Cluster files to build the report.</p>
          <p className="set-empty-subtitle">
            Click any upload button above to see the expected file format.
          </p>
        </div>
      ) : (
        <div className="set-main-body">
          <div className="set-tabs">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                className={`set-tab ${activeTab === t ? 'set-tab--active' : ''}`}
                onClick={() => setActiveTab(t)}
              >
                {t === 'Total' ? 'Summary' : t}
              </button>
            ))}
          </div>
          <ProductSettlementView product={activeTab} data={activeData} />
        </div>
      )}

      {showEmailModal && (
        <div className="set-modal-overlay" onClick={() => setShowEmailModal(false)}>
          <div className="set-modal" onClick={(e) => e.stopPropagation()}>
            <div className="set-modal-header">
              <h3>Send Settlements Report</h3>
              <button type="button" className="set-modal-close" onClick={() => setShowEmailModal(false)}>
                ✕
              </button>
            </div>
            <div className="set-modal-body">
              <p className="set-modal-subtitle">
                The email includes a compact overall summary and the full styled workbook as an attachment.
              </p>

              <div className="set-modal-row">
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={newRecipient}
                  onChange={(e) => setNewRecipient(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addNewRecipient();
                  }}
                  className="set-modal-input"
                />
                <button type="button" className="set-btn" onClick={addNewRecipient}>
                  Add
                </button>
              </div>

              <div className="set-modal-row">
                <textarea
                  placeholder="Paste multiple emails (comma, semicolon, or newline separated)…"
                  value={pasteBox}
                  onChange={(e) => setPasteBox(e.target.value)}
                  rows={3}
                  className="set-modal-textarea"
                />
                <button type="button" className="set-btn" onClick={addPastedEmails}>
                  Paste
                </button>
              </div>

              <div className="set-modal-row set-modal-row-utilities">
                <button type="button" className="set-btn set-btn-ghost" onClick={copyAllEmails}>
                  📋 Copy all ({recipients.length})
                </button>
              </div>

              <div className="set-recipient-list">
                {recipients.length === 0 ? (
                  <div className="set-recipient-empty">No recipients yet.</div>
                ) : (
                  recipients.map((r) => (
                    <span key={r} className="set-recipient-chip">
                      {r}
                      <button type="button" onClick={() => removeRecipient(r)} aria-label={`Remove ${r}`}>
                        ✕
                      </button>
                    </span>
                  ))
                )}
              </div>

              {sendError ? <div className="set-error-strip">{sendError}</div> : null}
              {sendSuccess ? <div className="set-success-strip">{sendSuccess}</div> : null}
            </div>
            <div className="set-modal-footer">
              <button type="button" className="set-btn set-btn-ghost" onClick={() => setShowEmailModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="set-btn set-btn-email"
                disabled={sending || recipients.length === 0}
                onClick={handleSendEmail}
              >
                {sending ? 'Sending…' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const FileStatusCard = ({ label, meta, onDownloadRaw, downloadDisabled }) => {
  return (
    <div className="set-file-card">
      <div className="set-file-card-label">{label}</div>
      {meta ? (
        <>
          <div className="set-file-card-name" title={meta.fileName}>
            {meta.fileName}
          </div>
          <div className="set-file-card-meta">
            {new Date(meta.createdAt).toLocaleString()}
            {typeof meta.fileSize === 'number' ? ` · ${Math.round((meta.fileSize || 0) / 1024)} KB` : ''}
          </div>
          <button
            type="button"
            className="set-file-card-download-btn"
            onClick={onDownloadRaw}
            disabled={downloadDisabled}
            title="Download raw file from system"
          >
            Download raw
          </button>
        </>
      ) : (
        <div className="set-file-card-empty">Not uploaded yet.</div>
      )}
    </div>
  );
};

export default SettlementsAnalysis;
