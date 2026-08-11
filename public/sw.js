/*
 * Digital Agent — service worker.
 *
 * Its job is to make the dashboard installable and to survive a flaky
 * connection. It deliberately does NOT try to make the app work fully offline:
 * this is an authenticated tool whose value is live data, and caching API
 * responses would risk showing one user another user's stale leads.
 *
 * Strategy
 *   navigations   network-first, falling back to the cached shell when offline
 *   /assets/*     cache-first (filenames are content-hashed by Vite, so a cached
 *                 file can never be the wrong version — a new build means a new
 *                 filename)
 *   /icons/*      cache-first
 *   /api/*        never touched. Same for /automation-api/ and /files/.
 *
 * Bump CACHE_VERSION to force every client to drop its old caches.
 */

// v2 — v1 could store an error page as the offline shell; bumping drops it.
const CACHE_VERSION = 'v2';
const SHELL_CACHE = `da-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `da-assets-${CACHE_VERSION}`;

// Kept small on purpose: a full precache of the bundle would be megabytes over
// a mobile connection at install time. Everything else is cached on first use.
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Requests the worker must stay out of entirely.
const BYPASS = [/^\/api\//, /^\/automation-api\//, /^\/files\//, /^\/health$/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // addAll rejects the whole install if any single file 404s; tolerate that.
      .then((cache) => Promise.allSettled(SHELL_FILES.map((f) => cache.add(f))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('da-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only handle our own origin; leave Google Sheets, CDNs, etc. alone.
  if (url.origin !== self.location.origin) return;
  if (BYPASS.some((re) => re.test(url.pathname))) return;

  // Page loads: always try the network so a new deploy is picked up straight
  // away; fall back to the cached shell only when genuinely offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only a genuine, successful HTML page may become the offline shell.
          // Without this check a 404 or a 502 mid-deploy gets stored as
          // /index.html, and every later offline load shows that error page.
          const type = response.headers.get('content-type') || '';
          if (response.ok && type.includes('text/html')) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html').then((r) => r || offlineResponse())),
    );
    return;
  }

  // Hashed build output and icons: cache-first is safe because the filename
  // changes whenever the content does.
  if (/^\/(assets|icons)\//.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(ASSET_CACHE).then((c) => c.put(request, copy));
        }
        return response;
      })),
    );
  }
});

function offlineResponse() {
  return new Response(
    `<!doctype html><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Digital Agent — offline</title>
     <div style="font-family:system-ui,sans-serif;padding:48px 24px;text-align:center;
                 background:#0f172a;color:#e2e8f0;min-height:100vh">
       <h1 style="font-size:20px;margin:0 0 8px">You are offline</h1>
       <p style="color:#94a3b8;font-size:14px;margin:0">
         Digital Agent needs a connection to load your data. Reconnect and try again.
       </p>
     </div>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
  );
}

// Lets the page trigger an immediate update instead of waiting for a restart.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
