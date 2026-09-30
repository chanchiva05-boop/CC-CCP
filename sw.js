const CACHE_NAME = 'case-manager-v8';
const RUNTIME_CACHE = 'case-manager-runtime-v8';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://fonts.googleapis.com/css2?family=Kantumruy+Pro:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=swap'
];

const NETWORK_FIRST = ['./', './index.html', './manifest.json'];

// Install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(PRECACHE_ASSETS.map(url => cache.add(url).catch(() => null)));
    }).then(() => self.skipWaiting())
  );
});

// Activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  if (event.request.method !== 'GET') return;
  if (url.startsWith('chrome-extension://')) return;
  if (url.startsWith('chrome://')) return;

  const isHTML = event.request.mode === 'navigate' || 
                 url.endsWith('.html') || 
                 url.endsWith('.json') ||
                 url.endsWith('/') ||
                 NETWORK_FIRST.some(path => url.endsWith(path.replace('./', '')));

  // Network First សម្រាប់ HTML
  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, copy).catch(() => null);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then(cached => {
            return cached || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // Cache First សម្រាប់ Assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => {
          cache.put(event.request, copy).catch(() => null);
        });
        
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('គ្មានការតភ្ជាប់អ៊ីនធឺណិត', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});

// Message
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CHECK_UPDATE') self.registration.update();
});
