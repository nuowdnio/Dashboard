// Service Worker: macht das Dashboard als App installierbar und zeigt ohne Verbindung den letzten Stand.
// Strategie: immer zuerst das Netz (der Server läuft lokal und ist schnell), bei Fehler der letzte gespeicherte Stand.
const CACHE = 'dashboard-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Kopie mit Zeitstempel speichern, damit die Seite "Stand von …" anzeigen kann.
async function store(request, response) {
  const body = await response.blob();
  const headers = new Headers(response.headers);
  headers.set('x-cached-at', String(Date.now()));
  const cache = await caches.open(CACHE);
  await cache.put(request, new Response(body, { status: response.status, statusText: response.statusText, headers }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.csv')) return;

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone(); // sofort kopieren, bevor die Seite die Antwort liest
          const isApi = url.pathname.startsWith('/api/');
          // API-Antworten mit Zeitstempel speichern, die App-Dateien unverändert.
          event.waitUntil(isApi ? store(req, copy) : caches.open(CACHE).then((c) => c.put(req, copy)));
        }
        return res;
      } catch (err) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await caches.match('index.html');
          if (shell) return shell;
        }
        throw err;
      }
    })(),
  );
});
