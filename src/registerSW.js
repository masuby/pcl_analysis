/**
 * Service-worker registration for the "Digital Agent" PWA.
 *
 * Registering is what makes the app installable to a home screen. Two rules:
 *
 *  - Production only. In dev a service worker caches the very files Vite is
 *    trying to hot-reload, which produces baffling stale-code bugs.
 *  - A secure context is required. Browsers refuse to register a worker unless
 *    the page is on https with a certificate the device TRUSTS, or on
 *    localhost. A self-signed certificate does not qualify, so on such an
 *    origin this logs why installation is unavailable rather than failing
 *    silently.
 */

const isLocalhost = () =>
  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  // window.isSecureContext is true on https and on localhost. It is FALSE when
  // the certificate is untrusted — which is exactly the self-signed case.
  if (!window.isSecureContext && !isLocalhost()) {
    console.info(
      '[Digital Agent] Not a secure context — install unavailable. '
      + 'The site needs HTTPS with a certificate the device trusts '
      + '(a self-signed certificate will not do).',
    );
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Activate a newly deployed worker without waiting for every tab to close.
        reg.addEventListener('updatefound', () => {
          const incoming = reg.installing;
          if (!incoming) return;
          incoming.addEventListener('statechange', () => {
            if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
              incoming.postMessage('SKIP_WAITING');
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[Digital Agent] Service worker registration failed:', err.message);
      });
  });

  // When the new worker takes over, reload once so the fresh build is showing.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}
