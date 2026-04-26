// ─────────────────────────────────────────────────────────────────────────────
// CSS Field Inspector — Service Worker
// Estrategia: cache-first para assets estáticos, network-only para APIs
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME    = 'css-field-inspector-v1';
const STATIC_ASSETS = [
  './css_field_inspector_v3.html',
  './docx.iife.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Dominios que NUNCA se cachean (APIs autenticadas y servicios externos)
const NETWORK_ONLY_HOSTS = [
  'googleapis.com',
  'accounts.google.com',
  'workers.dev',
  'anthropic.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// ── INSTALL: cachear assets estáticos ────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: eliminar caches antiguas ───────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia de respuesta ───────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Solo GET — POST/PUT/DELETE van siempre a red
  if (event.request.method !== 'GET') return;

  // 2. Network-only para APIs autenticadas y servicios externos críticos
  if (NETWORK_ONLY_HOSTS.some(host => url.hostname.includes(host))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. Cache-first para assets estáticos con fallback a red
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Solo cachear respuestas válidas de nuestro propio origen
        if (
          response.ok &&
          response.type !== 'opaque' &&
          url.origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: devolver el HTML principal si no hay respuesta
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./css_field_inspector_v3.html');
        }
      });
    })
  );
});

// ── MENSAJE: forzar actualización desde la app ────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
