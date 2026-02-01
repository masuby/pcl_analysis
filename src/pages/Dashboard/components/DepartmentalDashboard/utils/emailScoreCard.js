/**
 * Email Score Card Report - Skeleton
 * Add to .env.local:
 *   VITE_EMAIL_SENDER=your-email@gmail.com
 *   VITE_EMAIL_APP_PASSWORD=your-app-password
 * (Gmail: use App Password from Google Account → Security → 2-Step Verification → App passwords)
 */

const getEmailConfig = () => ({
  sender: import.meta.env.VITE_EMAIL_SENDER || '',
  appPassword: import.meta.env.VITE_EMAIL_APP_PASSWORD || ''
});

/**
 * Send score card report email to recipients.
 * Skeleton: in production you would attach the Excel blob or send a link.
 * @param {string[]} recipients - Email addresses
 * @param {string} subject - Email subject
 * @param {string} body - Email body (optional)
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export const sendScoreCardEmail = async (recipients, subject, body = '') => {
  const { sender, appPassword } = getEmailConfig();
  if (!sender || !appPassword) {
    return { success: false, error: 'Email not configured. Add VITE_EMAIL_SENDER and VITE_EMAIL_APP_PASSWORD to .env.local' };
  }
  if (!recipients || recipients.length === 0) {
    return { success: false, error: 'No recipients specified' };
  }
  // Skeleton: actual sending would go through your backend (recommended) or a client-side SMTP helper.
  // For security, app password should not be in frontend; use a backend API to send email.
  console.log('[Email] Skeleton send:', { sender, recipients: recipients.length, subject });
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ success: true });
    }, 500);
  });
};
