// Service Worker: macht das Dashboard als App installierbar und offline nutzbar.
// Deine Einträge liegen ohnehin im Browser; zwischengespeichert werden hier nur die App-Dateien
// sowie die letzte Wettervorhersage und Warnlage. Todoist und Tankerkönig laufen nie über diesen Speicher
// (enthalten deine Schlüssel); die Spritpreise merkt sich die App selbst.
const CACHE = 'dashboard-v3';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'local-api.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const WEATHER_HOSTS = ['api.open-meteo.com', 'geocoding-api.open-meteo.com', 'api.brightsky.dev'];

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

// Immer zuerst das Netz (damit Updates sofort ankommen), ohne Verbindung der gespeicherte Stand.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !WEATHER_HOSTS.includes(url.hostname)) return;

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
        }
        return res;
      } catch (err) {
        // Ohne Verbindung: gespeicherte App-Dateien bzw. die letzte Wettervorhersage für diesen Ort
        const cached = await caches.match(req, { ignoreSearch: sameOrigin });
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
