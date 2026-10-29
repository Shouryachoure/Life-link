/**
 * LifeLink Emergency Healthcare Service Worker
 * PWA Service Worker adhering strictly to clinical safety and data integrity policies:
 * 1. NEVER caches sensitive patient data, auth tokens, or private medical records.
 * 2. NEVER caches POST requests or queues emergency SOS requests offline with false delivery claims.
 * 3. NEVER presents stale ambulance GPS or bed availability as live.
 * 4. Provides reliable offline app shell for UI resilience while maintaining strict network truth.
 */

const CACHE_NAME = 'lifelink-app-shell-v1';

// Static App Shell assets required to render the application frame
const STATIC_APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

// Sensitive or dynamic routes that must NEVER be served from cache
const SENSITIVE_OR_LIVE_API_PATTERNS = [
  /\/api\/v1\/sos/,
  /\/api\/sos/,
  /\/api\/v1\/requests/,
  /\/api\/requests/,
  /\/api\/v1\/auth/,
  /\/api\/auth/,
  /\/api\/v1\/appointments/,
  /\/api\/appointments/,
  /\/api\/v1\/emergency-contacts/,
  /\/api\/v1\/emergency-profile/,
  /\/api\/v1\/ambulances/,
  /\/api\/ambulances/,
  /\/api\/v1\/hospitals\/capacities/,
  /\/api\/hospitals\/capacities/,
  /\/socket\.io/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(STATIC_APP_SHELL);
      })
      .then(() => {
        // Activate immediately without trapping user on obsolete app version
        return self.skipWaiting();
      })
      .catch((err) => {
        console.warn('[LifeLink SW] Precaching app shell notice:', err);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((name) => {
            if (name !== CACHE_NAME) {
              console.log('[LifeLink SW] Purging obsolete cache:', name);
              return caches.delete(name);
            }
          })
        );
      })
      .then(() => {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. NON-GET REQUESTS (POST, PUT, DELETE, PATCH):
  // Strictly network-only. NEVER cache. Offline mutations must fail transparently
  // so the application NEVER falsely reports emergency dispatch or appointment creation.
  if (req.method !== 'GET') {
    return;
  }

  // 2. LIVE TELEMETRY, AUTH, & EMERGENCY APIS:
  // Must always hit network directly to prevent stale ambulance GPS, bed claims, or credential leaks.
  const isLiveApi = SENSITIVE_OR_LIVE_API_PATTERNS.some((pattern) => pattern.test(url.pathname));
  if (isLiveApi) {
    event.respondWith(
      fetch(req).catch(() => {
        return new Response(
          JSON.stringify({
            status: 'offline',
            offline: true,
            message: 'Network offline. Live emergency dispatch and telemetry require active internet connectivity.',
            dialNumber: '112',
          }),
          {
            status: 503,
            statusText: 'Service Unavailable (Offline)',
            headers: { 'Content-Type': 'application/json' },
          }
        );
      })
    );
    return;
  }

  // 3. NAVIGATION REQUESTS (SPA Page loads):
  // Network-first with cache fallback to /index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('/index.html');
          if (cachedIndex) return cachedIndex;
          const cachedReq = await caches.match(req);
          if (cachedReq) return cachedReq;
          return new Response(
            '<!DOCTYPE html><html><head><title>LifeLink Offline</title><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="font-family:system-ui;padding:2rem;text-align:center;background:#0f172a;color:#f8fafc;"><h2>LifeLink Offline</h2><p>You appear to be offline. Please reconnect to Wi-Fi or cellular network.</p><p>For immediate emergencies, dial <strong>112</strong> directly from your phone.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // 4. STATIC ASSETS (JS, CSS, SVGs, Fonts, Images):
  // Cache-first with background network update (Stale-while-revalidate)
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          // Revalidate in background
          fetch(req)
            .then((res) => {
              if (res.ok) {
                caches.open(CACHE_NAME).then((cache) => cache.put(req, res));
              }
            })
            .catch(() => {});
          return cached;
        }

        return fetch(req).then((res) => {
          if (res.ok && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        });
      })
    );
    return;
  }

  // 5. DEFAULT: Network fetch
  event.respondWith(fetch(req));
});

// Support manual update triggers from client
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
