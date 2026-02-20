/**
 * Email Sales Review Report - Sends via backend API
 * Backend requires EMAIL_SENDER and EMAIL_APP_PASSWORD in backend/.env
 */

import { emailAPI } from '../../../../../../../services/api';

/**
 * Send Monthly Sales Review report email to recipients via backend
 * @param {string[]} recipients - Email addresses
 * @param {string} subject - Email subject
 * @param {string} htmlBody - HTML email body
 * @param {Object} options - { attachmentBase64, attachmentName }
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export const sendSalesReviewEmail = async (recipients, subject, htmlBody = '', options = {}) => {
  if (!recipients || recipients.length === 0) {
    return { success: false, error: 'No recipients specified' };
  }

  try {
    const result = await emailAPI.sendScoreCard({
      recipients,
      subject,
      htmlBody,
      mode: 'MONTHLY',
      attachmentBase64: options.attachmentBase64 || '',
      attachmentName: options.attachmentName || '',
    });

    if (result.success) {
      return { success: true };
    }
    return { success: false, error: result.error || 'Failed to send email' };
  } catch (err) {
    const msg = err?.message || String(err);
    return { success: false, error: msg };
  }
};
