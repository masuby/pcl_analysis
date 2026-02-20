import React, { useState, useRef, useMemo, useEffect } from 'react';
import './SalesReviewReport.css';
import { useManagementData } from '../../../ManagementDashboard/hooks/useManagementData';
import LoadingSpinner from '../../../../../../components/Common/Loading/LoadingSpinner';
import { generateSalesReviewPPTX } from './utils/pptxGenerator';
import { exportReportToPDF } from './utils/pdfGenerator';
import { getMonthlyTrendData, getTrendExplanation } from './utils/trendDataUtils';
import { getSummaryForMonth, getComparisonData } from './utils/summaryDataUtils';
import { getProductContributionData, getProductContributionForSection } from './utils/productContributionUtils';
import { getNewBusinessTrendData, getRepeatBusinessTrendData, getNewBusinessComparison, getRepeatBusinessComparison } from './utils/newRepeatBusinessUtils';
import { REPORT_SECTIONS } from './config/reportSectionConfig';
import { sendSalesReviewEmail } from './utils/emailSalesReview';
import { buildSalesReviewEmailHTML } from './utils/emailTemplateSalesReview';
import GeneralSalesTrendChart from './sections/GeneralSalesTrendChart';
import SalesAndPerformanceSummary from './sections/SalesAndPerformanceSummary';
import PerformanceComparison from './sections/PerformanceComparison';
import PerProductContribution from './sections/PerProductContribution';
import NewBusinessPerformance from './sections/NewBusinessPerformance';
import RepeatBusinessPerformance from './sections/RepeatBusinessPerformance';
import ProductPerformanceBlock from './sections/ProductPerformanceBlock';

const LOGO_SRC = '/Assets/pcl_logo2.png';
const RECIPIENTS_STORAGE_KEY = 'sales_review_email_recipients';

async function getLogoAsBase64() {
  const res = await fetch(LOGO_SRC);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const SalesReviewReport = ({ userData }) => {
  const { parsedReports, loading, error } = useManagementData();
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [generatingPPTX, setGeneratingPPTX] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [recipients, setRecipients] = useState(() => {
    try {
      const saved = localStorage.getItem(RECIPIENTS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [newRecipient, setNewRecipient] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendProgress, setSendProgress] = useState(null); // null = not started, or [{ email, status, error? }]
  const [sendPhase, setSendPhase] = useState(''); // 'preparing' | 'sending' | ''
  const [showPreview, setShowPreview] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [copiedList, setCopiedList] = useState(false);
  const [copiedBody, setCopiedBody] = useState(false);
  const reportContainerRef = useRef(null);

  const copyRecipientList = () => {
    if (recipients.length === 0) return;
    const list = recipients.join('\n');
    navigator.clipboard.writeText(list).then(() => {
      setCopiedList(true);
      setTimeout(() => setCopiedList(false), 2000);
    }).catch(() => {});
  };

  const copyMessageBody = () => {
    const reportDate = new Date().toISOString().split('T')[0];
    const html = emailBody || buildSalesReviewEmailHTML(monthLabel, reportDate);
    const div = document.createElement('div');
    div.innerHTML = html;
    const text = (div.innerText || div.textContent || '').trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedBody(true);
      setTimeout(() => setCopiedBody(false), 2000);
    }).catch(() => {});
  };

  const monthDate = new Date(selectedMonth + '-01');
  const monthLabel = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const monthLabelShort = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  useEffect(() => {
    try {
      localStorage.setItem(RECIPIENTS_STORAGE_KEY, JSON.stringify(recipients));
    } catch (e) {
      console.warn('Could not save recipients', e);
    }
  }, [recipients]);

  const addRecipient = () => {
    const email = (newRecipient || '').trim().toLowerCase();
    if (!email) return;
    if (recipients.includes(email)) return;
    setRecipients((prev) => [...prev, email]);
    setNewRecipient('');
  };

  const removeRecipient = (email) => {
    setRecipients((prev) => prev.filter((r) => r !== email));
  };

  const generatePreview = () => {
    const reportDate = new Date().toISOString().split('T')[0];
    const subject = `MONTHLY SALES REVIEW FOR ${monthLabel.toUpperCase()}`;
    const html = buildSalesReviewEmailHTML(monthLabel, reportDate);
    setEmailSubject(subject);
    setEmailBody(html);
    setShowPreview(true);
  };

  const handleSendEmail = async () => {
    if (recipients.length === 0) {
      setSendError('Add at least one recipient.');
      return;
    }
    setSending(true);
    setSendError('');
    setSendProgress(null);
    setSendPhase('preparing');

    const reportDate = new Date().toISOString().split('T')[0];
    const subject = emailSubject || `MONTHLY SALES REVIEW FOR ${monthLabel.toUpperCase()}`;
    const htmlBody = emailBody || buildSalesReviewEmailHTML(monthLabel, reportDate);

    // Generate PPTX once and convert to base64
    let attachmentBase64 = '';
    let attachmentName = '';
    try {
      const logoBase64 = await getLogoAsBase64().catch(() => null);
      const pptxResult = await generateSalesReviewPPTX(
        { 
          countrywiseData, 
          monthlyTrendData, 
          trendExplanation, 
          summaryData, 
          comparisonData, 
          productContributionData, 
          newBusinessTrend,
          repeatBusinessTrend,
          newBusinessComparison,
          repeatBusinessComparison,
          sectionsData 
        },
        selectedMonth,
        userData,
        logoBase64,
        true // Return blob instead of downloading
      );
      // pptxgenjs write() returns a Promise that resolves to Blob
      const pptxBlob = pptxResult instanceof Blob ? pptxResult : await Promise.resolve(pptxResult);
      if (pptxBlob && pptxBlob instanceof Blob) {
        const arrayBuffer = await pptxBlob.arrayBuffer();
        const binary = Array.from(new Uint8Array(arrayBuffer))
          .map((b) => String.fromCharCode(b))
          .join('');
        attachmentBase64 = btoa(binary);
        attachmentName = `Sales_Review_${selectedMonth}.pptx`;
      }
    } catch (e) {
      console.error('Failed to generate PPTX attachment', e);
      setSendError('Failed to generate PPTX attachment: ' + (e?.message || String(e)));
      setSending(false);
      setSendPhase('');
      return;
    }

    setSendPhase('sending');
    setSendProgress(recipients.map((email) => ({ email, status: 'sending', error: null })));

    const emailResult = await sendSalesReviewEmail(recipients, subject, htmlBody, {
      attachmentBase64,
      attachmentName
    });

    const status = emailResult.success ? 'success' : 'failed';
    const error = emailResult.success ? null : (emailResult.error || 'Failed to send');
    setSendProgress((prev) => prev && prev.map((p) => ({ ...p, status, error })));
    setSending(false);
    setSendPhase('');
  };

  const countrywiseData = useMemo(() => {
    if (!parsedReports || parsedReports.length === 0) return [];
    return parsedReports
      .filter((r) => r.countrywise && Object.keys(r.countrywise).length > 0)
      .map((r) => ({
        fileName: r.fileName || 'Unknown',
        date: r.date ? (r.date instanceof Date ? r.date : new Date(r.date)) : new Date(),
        ...r.countrywise
      }));
  }, [parsedReports]);

  const monthlyTrendData = useMemo(() => getMonthlyTrendData(countrywiseData), [countrywiseData]);
  const trendExplanation = useMemo(() => getTrendExplanation(monthlyTrendData), [monthlyTrendData]);
  const summaryData = useMemo(() => getSummaryForMonth(countrywiseData, selectedMonth), [countrywiseData, selectedMonth]);
  const comparisonData = useMemo(() => getComparisonData(countrywiseData, selectedMonth), [countrywiseData, selectedMonth]);
  const productContributionData = useMemo(() => getProductContributionData(parsedReports, selectedMonth), [parsedReports, selectedMonth]);
  
  // New and Repeat Business performance for countrywide
  const newBusinessTrend = useMemo(() => getNewBusinessTrendData(countrywiseData), [countrywiseData]);
  const repeatBusinessTrend = useMemo(() => getRepeatBusinessTrendData(countrywiseData), [countrywiseData]);
  const newBusinessComparison = useMemo(() => getNewBusinessComparison(countrywiseData, selectedMonth), [countrywiseData, selectedMonth]);
  const repeatBusinessComparison = useMemo(() => getRepeatBusinessComparison(countrywiseData, selectedMonth), [countrywiseData, selectedMonth]);

  const sectionsData = useMemo(() => {
    return REPORT_SECTIONS.map((section) => {
      const sectionData = section.getData(parsedReports);
      const monthlyTrend = getMonthlyTrendData(sectionData);
      return {
        section,
        sectionData,
        summaryData: getSummaryForMonth(sectionData, selectedMonth),
        comparisonData: getComparisonData(sectionData, selectedMonth),
        monthlyTrendData: monthlyTrend,
        trendExplanation: getTrendExplanation(monthlyTrend),
        productContributionData: getProductContributionForSection(parsedReports, selectedMonth, section),
        newBusinessTrend: getNewBusinessTrendData(sectionData),
        repeatBusinessTrend: getRepeatBusinessTrendData(sectionData),
        newBusinessComparison: getNewBusinessComparison(sectionData, selectedMonth),
        repeatBusinessComparison: getRepeatBusinessComparison(sectionData, selectedMonth)
      };
    });
  }, [parsedReports, selectedMonth]);

  const handleDownloadPPTX = async () => {
    setGeneratingPPTX(true);
    try {
      const logoBase64 = await getLogoAsBase64().catch(() => null);
      await generateSalesReviewPPTX(
        { 
          countrywiseData, 
          monthlyTrendData, 
          trendExplanation, 
          summaryData, 
          comparisonData, 
          productContributionData, 
          newBusinessTrend,
          repeatBusinessTrend,
          newBusinessComparison,
          repeatBusinessComparison,
          sectionsData 
        },
        selectedMonth,
        userData,
        logoBase64
      );
    } catch (err) {
      console.error(err);
      alert('Failed to generate PowerPoint.');
    } finally {
      setGeneratingPPTX(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!reportContainerRef.current) return;
    setGeneratingPDF(true);
    try {
      await exportReportToPDF(reportContainerRef.current, selectedMonth);
    } catch (err) {
      console.error(err);
      alert('Failed to generate PDF.');
    } finally {
      setGeneratingPDF(false);
    }
  };

  if (loading) {
    return (
      <div className="sales-review-loading">
        <LoadingSpinner size="large" />
        <p>Loading management data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sales-review-error">
        <div className="error-icon">⚠️</div>
        <h3>Error Loading Data</h3>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="sales-review-container">
      <div className="sales-review-header-bar">
        <h1 className="sales-review-header-title">MONTHLY SALES REVIEW FOR {monthLabel.toUpperCase()}</h1>
        <div className="sales-review-header-controls">
          <input
            type="month"
            className="sales-review-date-input"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          />
          <button
            type="button"
            className="sales-review-download-btn sales-review-download-btn--email"
            onClick={() => setShowEmailModal(true)}
            disabled={loading}
            title="Send report by email"
          >
            <span className="sales-review-btn-icon">✉</span>
            <span className="sales-review-btn-label">Send Email</span>
          </button>
          <button
            type="button"
            className="sales-review-download-btn sales-review-download-btn--pdf"
            onClick={handleDownloadPDF}
            disabled={generatingPDF}
            title="Download PDF"
          >
            {generatingPDF ? (
              <span className="sales-review-btn-spinner" aria-hidden>⏳</span>
            ) : (
              <svg className="sales-review-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <path d="M12 18v-6" />
                <path d="M9 15l3 3 3-3" />
              </svg>
            )}
            <span className="sales-review-btn-label">PDF</span>
          </button>
          <button
            type="button"
            className="sales-review-download-btn sales-review-download-btn--pptx"
            onClick={handleDownloadPPTX}
            disabled={generatingPPTX}
            title="Download PowerPoint"
          >
            {generatingPPTX ? (
              <span className="sales-review-btn-spinner" aria-hidden>⏳</span>
            ) : (
              <svg className="sales-review-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
            <span className="sales-review-btn-label">PPTX</span>
          </button>
        </div>
      </div>
      <div className="sales-review-header-line" aria-hidden="true" />

      <div className="sales-review-preview-wrapper">
        <div className="sales-review-preview-inner" ref={reportContainerRef}>
          {/* Page 1: Cover - white, logo (blue), blue line, blue text */}
          <div className="report-page report-page--cover">
            <div className="report-cover-logo-wrap">
              <img src={LOGO_SRC} alt="PCL" className="report-cover-logo" />
            </div>
            <div className="report-cover-line" />
            <div className="report-cover-title-wrap">
              <h2 className="report-cover-title">SALES REVIEW</h2>
              <p className="report-cover-subtitle">{monthLabel}</p>
            </div>
            <div className="report-page-bottom-line" />
          </div>

          {/* Page 2: Table of Contents */}
          <div className="report-page report-page--toc">
            <div className="report-toc-header">
              <h2 className="report-toc-title">Table of Contents</h2>
              <img src={LOGO_SRC} alt="PCL" className="report-toc-logo" />
            </div>
            <div className="report-toc-line" />
            <ol className="report-toc-list">
              <li>GENERAL PERFORMANCE HIGHLIGHTS</li>
              <li>
                CS PRODUCT PERFORMANCE HIGHLIGHTS
                <ol type="i" className="report-toc-sublist">
                  <li>CS MAINLAND PERFORMANCE HIGHLIGHTS</li>
                  <li>CS ZANZIBAR PERFORMANCE HIGHLIGHTS</li>
                </ol>
              </li>
              <li>
                LBF PRODUCT PERFORMANCE HIGHLIGHTS
                <ol type="i" className="report-toc-sublist">
                  <li>IPF PRODUCT PERFORMANCE HIGHLIGHTS</li>
                  <li>QUICK CASH PERFORMANCE HIGHLIGHTS</li>
                  <li>MIF (SHORT TERM & LONG TERM) PERFORMANCE HIGHLIGHTS</li>
                  <li>MIF CUSTOMS PERFORMANCE HIGHLIGHTS</li>
                  <li>YARD FINANCE PERFORMANCE HIGHLIGHTS</li>
                </ol>
              </li>
              <li>SME PERFORMANCE HIGHLIGHTS</li>
              <li>AGRIFINANCE PERFORMANCE HIGHLIGHT</li>
            </ol>
            <div className="report-page-bottom-line" />
          </div>

          {/* Page 3: General Performance Highlights - centered title, large logo only */}
          <div className="report-page report-page--content report-page--general">
            <div className="report-general-center">
              <img src={LOGO_SRC} alt="PCL" className="report-general-logo" />
              <h2 className="report-general-title">1. GENERAL PERFORMANCE HIGHLIGHTS</h2>
            </div>
            <div className="report-page-bottom-line" />
          </div>

          {/* Page 4: General Sales Trend - header, chart, explanation */}
          <div className="report-page report-page--trend">
            <div className="report-trend-header">
              <h2 className="report-trend-title">GENERAL SALES TREND</h2>
              <img src={LOGO_SRC} alt="PCL" className="report-trend-logo" />
            </div>
            <div className="report-trend-line" />
            <div className="report-trend-chart-area">
              <GeneralSalesTrendChart monthlyData={monthlyTrendData} />
            </div>
            <div className="report-trend-explanation">
              <p className="report-trend-explanation-text">{trendExplanation}</p>
            </div>
            <div className="report-page-bottom-line" />
          </div>

          {/* Page 5: Sales and Performance Summary */}
          <SalesAndPerformanceSummary
            summaryData={summaryData}
            monthLabel={monthLabel}
            logoSrc={LOGO_SRC}
          />

          {/* Page 6: Performance Comparison */}
          <PerformanceComparison comparisonData={comparisonData} logoSrc={LOGO_SRC} />

          {/* Page 7: New Business Sales Performance */}
          <NewBusinessPerformance
            comparisonData={newBusinessComparison}
            trendData={newBusinessTrend}
            logoSrc={LOGO_SRC}
          />

          {/* Page 8: Repeat Business Sales Performance */}
          <RepeatBusinessPerformance
            comparisonData={repeatBusinessComparison}
            trendData={repeatBusinessTrend}
            logoSrc={LOGO_SRC}
          />

          {/* Page 9: Per Product Contribution */}
          <PerProductContribution productData={productContributionData} logoSrc={LOGO_SRC} />

          {/* Product sections (CS, LBF, IPF, SME, AgriFinance, etc.) - same flow per section */}
          {sectionsData.map(({ section, summaryData: sSummary, comparisonData: sComparison, monthlyTrendData: sTrend, trendExplanation: sExplanation, productContributionData: sProduct, newBusinessTrend: sNewTrend, repeatBusinessTrend: sRepeatTrend, newBusinessComparison: sNewComp, repeatBusinessComparison: sRepeatComp }) => (
            <ProductPerformanceBlock
              key={section.id}
              section={section}
              summaryData={sSummary}
              comparisonData={sComparison}
              monthlyTrendData={sTrend}
              trendExplanation={sExplanation}
              productContributionData={sProduct}
              newBusinessComparison={sNewComp}
              newBusinessTrend={sNewTrend}
              repeatBusinessComparison={sRepeatComp}
              repeatBusinessTrend={sRepeatTrend}
              monthLabel={monthLabel}
              logoSrc={LOGO_SRC}
            />
          ))}

          {/* Thank you page */}
          <div className="report-page report-page--thank-you">
            <div className="report-thank-you-content">
              <div className="report-thank-you-line" />
              <h2 className="report-thank-you-title">Thank You</h2>
              <p className="report-thank-you-subtitle">Thank you for your attention.</p>
              <div className="report-thank-you-line report-thank-you-line-bottom" />
              {LOGO_SRC && <img src={LOGO_SRC} alt="PCL" className="report-thank-you-logo" />}
            </div>
            <div className="report-page-bottom-line" />
          </div>
        </div>
      </div>

      {/* Email modal */}
      {showEmailModal && (
        <div className="sales-review-modal-overlay" onClick={() => { if (!sending) { setShowEmailModal(false); setSendProgress(null); } }}>
          <div className="sales-review-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="sales-review-modal-header">
              <h3 className="sales-review-modal-title">Send Monthly Sales Review by Email</h3>
              <button
                className="sales-review-modal-close"
                onClick={() => { if (!sending) { setShowEmailModal(false); setShowPreview(false); setSendProgress(null); } }}
                disabled={sending}
              >
                ✕
              </button>
            </div>

            {/* Progress popup: sticky banner when sending or when result is shown */}
            {(sending || (sendProgress && sendProgress.length > 0)) && (
              <div className="sales-review-progress-popup">
                {sendPhase === 'preparing' && (
                  <div className="sales-review-progress-popup-inner sales-review-progress-popup--preparing">
                    <span className="sales-review-send-progress-spinner" aria-hidden>⏳</span>
                    <span>Preparing attachment…</span>
                  </div>
                )}
                {sendProgress && sendProgress.length > 0 && (sendPhase === 'sending' || !sending) && (
                  <div className="sales-review-progress-popup-inner">
                    <h4 className="sales-review-send-progress-title">
                      {sending ? 'Sending email to all recipients…' : 'Send result'}
                    </h4>
                    <ul className="sales-review-send-progress-list">
                      {sendProgress.map(({ email, status, error }) => (
                        <li key={email} className={`sales-review-send-progress-item sales-review-send-progress-item--${status}`}>
                          <span className="sales-review-send-progress-email">{email}</span>
                          <span className="sales-review-send-progress-status">
                            {status === 'sending' && <span className="sales-review-send-progress-spinner" aria-hidden>⏳</span>}
                            {status === 'success' && <span className="sales-review-send-progress-ok" title="Received">✓</span>}
                            {status === 'failed' && <span className="sales-review-send-progress-fail" title={error || 'Failed'}>✗</span>}
                          </span>
                          {status === 'failed' && error && (
                            <span className="sales-review-send-progress-error">{error}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="sales-review-modal-body">
              {/* Recipients input */}
              <div className="sales-review-input-group">
                <label>Add Recipients:</label>
                <div className="sales-review-input-row">
                  <input
                    type="email"
                    placeholder="Enter email address"
                    value={newRecipient}
                    onChange={(e) => setNewRecipient(e.target.value)}
                    onKeyPress={(e) => { if (e.key === 'Enter') addRecipient(); }}
                    disabled={sending}
                  />
                  <button
                    className="sales-review-add-btn"
                    onClick={addRecipient}
                    disabled={sending}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Copy actions: list + message (always show so message can be copied without recipients) */}
              <div className="sales-review-recipient-list-actions">
                <button
                  type="button"
                  className="sales-review-copy-list-btn"
                  onClick={copyRecipientList}
                  disabled={sending || recipients.length === 0}
                  title="Copy all emails (one per line) to paste manually"
                >
                  {copiedList ? '✓ Copied!' : 'Copy email list'}
                </button>
                <button
                  type="button"
                  className="sales-review-copy-list-btn sales-review-copy-body-btn"
                  onClick={copyMessageBody}
                  disabled={sending}
                  title="Copy email message (plain text) to paste into your email"
                >
                  {copiedBody ? '✓ Copied!' : 'Copy message'}
                </button>
              </div>

              {/* Recipients list */}
              {recipients.length > 0 && (
                <ul className="sales-review-recipient-list">
                    {recipients.map((email) => (
                      <li key={email} className="sales-review-recipient-item">
                        <span className="sales-review-recipient-email">{email}</span>
                        <button
                          className="sales-review-recipient-remove"
                          onClick={() => removeRecipient(email)}
                          disabled={sending}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
              )}

              {/* Email Preview Section */}
              <div className="sales-review-preview-section">
                <button
                  className="sales-review-preview-toggle"
                  onClick={generatePreview}
                  disabled={sending}
                >
                  {showPreview ? '▼ Hide Email Preview' : '▶ Preview Email'}
                </button>
                {showPreview && (
                  <div className="sales-review-preview-content">
                    <div className="sales-review-preview-field">
                      <label>Subject:</label>
                      <input
                        type="text"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        disabled={sending}
                      />
                    </div>
                    <div className="sales-review-preview-field">
                      <label>Email Body:</label>
                      <div
                        className="sales-review-preview-html"
                        dangerouslySetInnerHTML={{ __html: emailBody }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Error display */}
              {sendError && (
                <div className="sales-review-error-msg">{sendError}</div>
              )}
            </div>

            <div className="sales-review-modal-footer">
              <button
                className="sales-review-modal-cancel"
                onClick={() => { if (!sending) { setShowEmailModal(false); setShowPreview(false); setSendProgress(null); } }}
                disabled={sending}
              >
                {sendProgress && !sending ? 'Close' : 'Cancel'}
              </button>
              <button
                className="sales-review-modal-send"
                onClick={handleSendEmail}
                disabled={sending || recipients.length === 0}
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

export default SalesReviewReport;
