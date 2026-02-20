/**
 * Send Gap Analysis report email via backend (reuses scorecard endpoint)
 */
import { emailAPI } from '../../../../../../../services/api';

export const sendGapAnalysisEmail = async (recipients, subject, htmlBody = '', options = {}) => {
  if (!recipients || recipients.length === 0) {
    return { success: false, error: 'No recipients specified' };
  }
  try {
    const result = await emailAPI.sendScoreCard({
      recipients,
      subject,
      htmlBody,
      mode: 'GAP_ANALYSIS',
      attachmentBase64: options.attachmentBase64 || '',
      attachmentName: options.attachmentName || '',
    });
    if (result.success) return { success: true };
    return { success: false, error: result.error || 'Failed to send email' };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
};
