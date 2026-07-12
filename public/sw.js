const CACHE = 'njs-v2';
const SHELL = [
  '/',
  '/app.css',
  '/karte.html',
  '/manifest.webmanifest',
  '/vendor/qrcode.min.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/assets/rose-ecke.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/k/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/karte.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(hit => {
      const netz = fetch(event.request)
        .then(res => {
          if (res.ok) {
            const kopie = res.clone();
            caches.open(CACHE).then(c => c.put(event.request, kopie));
          }
          return res;
        })
        .catch(() => hit);
      return hit || netz;
    })
  );
});
