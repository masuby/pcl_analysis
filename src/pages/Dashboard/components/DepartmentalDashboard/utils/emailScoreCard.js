/**
 * Email Score Card Report - Sends via backend API
 * Backend requires EMAIL_SENDER and EMAIL_APP_PASSWORD in backend/.env
 * (Gmail: use App Password from Google Account → Security → 2-Step Verification → App passwords)
 */

import { emailAPI } from '../../../../../services/api';

/**
 * Send HOD Score Card report email to recipients via backend
 * @param {string[]} recipients - Email addresses
 * @param {string} subject - Email subject
 * @param {string} htmlBody - HTML email body
 * @param {Object} options - { mode, attachmentBase64, attachmentName, attachments }
 *   attachments: optional array of { base64, name } for multiple attachments (used when set)
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export const sendScoreCardEmail = async (recipients, subject, htmlBody = '', options = {}) => {
  if (!recipients || recipients.length === 0) {
    return { success: false, error: 'No recipients specified' };
  }

  try {
    const payload = {
      recipients,
      subject,
      htmlBody,
      mode: options.mode || 'WEEKLY',
      attachmentBase64: options.attachmentBase64 || '',
      attachmentName: options.attachmentName || '',
    };
    if (options.attachments && options.attachments.length > 0) {
      payload.attachments = options.attachments;
    }
    const result = await emailAPI.sendScoreCard(payload);

    if (result.success) {
      return { success: true };
    }
    return { success: false, error: result.error || 'Failed to send email' };
  } catch (err) {
    const msg = err?.message || String(err);
    return { success: false, error: msg };
  }
};
