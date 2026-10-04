const CACHE_NAME = 'case-manager-v10';
const RUNTIME_CACHE = 'case-manager-runtime-v10';

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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(PRECACHE_ASSETS.map(url => cache.add(url).catch(() => null)));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  if (event.request.method !== 'GET') return;
  if (url.startsWith('chrome-extension://')) return;
  if (url.startsWith('chrome://')) return;
  if (url.includes('firebase') || url.includes('googleapis.com') || url.includes('gstatic.com')) {
    return;
  }

  const isHTML = event.request.mode === 'navigate' ||
                 url.endsWith('.html') ||
                 url.endsWith('.json') ||
                 url.endsWith('/') ||
                 NETWORK_FIRST.some(path => url.endsWith(path.replace('./', '')));

  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy).catch(() => null));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const copy = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, copy).catch(() => null));
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return new Response('គ្មានការតភ្ជាប់អ៊ីនធឺណិត', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CHECK_UPDATE') self.registration.update();
  if (event.data?.type === 'SCHEDULE_NOTIFICATION') {
    scheduleNotification(event.data.payload);
  }
});

// ============================================================
// NOTIFICATION HANDLERS
// ============================================================

const scheduledTimers = new Map();

function scheduleNotification(payload) {
  const { id, scheduledFor, title, body, data } = payload;
  const delay = scheduledFor - Date.now();

  if (scheduledTimers.has(id)) {
    clearTimeout(scheduledTimers.get(id));
    scheduledTimers.delete(id);
  }

  if (delay <= 0) {
    showScheduledNotification({ title, body, data, id });
    return;
  }

  if (delay > 2147483647) {
    console.warn('⏰ Delay too long, max 24.8 days:', delay);
    return;
  }

  const timer = setTimeout(() => {
    showScheduledNotification({ title, body, data, id });
    scheduledTimers.delete(id);
  }, delay);

  scheduledTimers.set(id, timer);
  console.log(`⏰ Scheduled notification ${id} in ${Math.round(delay / 1000 / 60)} minutes`);
}

async function showScheduledNotification({ title, body, data, id }) {
  try {
    await self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'hearing-' + (data?.caseId || id),
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 200],
      data: data || {},
      actions: [
        { action: 'view', title: '👁️ មើល' },
        { action: 'dismiss', title: 'បិទ' }
      ]
    });
    console.log('✅ Notification shown:', id);
  } catch (e) {
    console.error('❌ Show notification error:', e);
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  if (action === 'dismiss') return;

  const caseId = event.notification.data?.caseId;
  const urlToOpen = event.notification.data?.url || './index.html?page=calendar';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            caseId: caseId,
            action: action
          });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Case Manager', body: 'អ្នកមានកាលបរិច្ឆេទតុលាការ' };
  if (event.data) {
    try { data = event.data.json(); } catch { data.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [200, 100, 200],
      data: data.data || {}
    })
  );
});
