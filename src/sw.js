const CACHE_PREFIX = 'kyetech-delivery-static-';
const CACHE_NAME = `${CACHE_PREFIX}__KYETECH_PWA_CACHE_VERSION__`;
const PRECACHE_URLS = /* __KYETECH_PWA_PRECACHE__ */ [];
const STATIC_PATHS = new Set(PRECACHE_URLS);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, {
        cache: 'reload',
        credentials: 'omit',
      })));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // Updates wait until existing app windows close so deliveries and OTP entry are uninterrupted.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isAppNavigation(pathname) {
  return pathname === '/' || pathname === '/index.html' || pathname === '/review'
    || pathname === '/admin' || pathname.startsWith('/admin/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Account, OTP, Firebase, uploads and other remote calls always use the network.
  if (request.method !== 'GET' || url.origin !== self.location.origin
    || url.pathname === '/api' || url.pathname.startsWith('/api/')
    || request.cache === 'no-store' || request.headers.has('authorization')
    || request.headers.has('range')) return;

  if (request.mode === 'navigate' && isAppNavigation(url.pathname)) {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        const offline = await cache.match('/offline.html');
        if (offline) return offline;
        throw error;
      }
    })());
    return;
  }

  if (request.mode !== 'navigate' && !url.search && STATIC_PATHS.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(request) || fetch(request);
    })());
  }
});

function riderRequestId(data) {
  return data && typeof data === 'object' && !Array.isArray(data)
    && data.type === 'new-rider-request' && typeof data.orderId === 'string'
    && data.orderId.length > 0 && data.orderId.length <= 128
    && !/[^A-Za-z0-9_-]/.test(data.orderId) ? data.orderId : '';
}

self.addEventListener('push', (event) => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  const orderId = riderRequestId(payload);
  if (!orderId) return;
  event.waitUntil(self.registration.showNotification('New delivery request', {
    body: 'A new delivery request is waiting. Open KyeTech Delivery to review it.',
    icon: '/images/pwa/icon-192.png',
    badge: '/images/pwa/icon-192.png',
    tag: 'rider-request-' + orderId,
    vibrate: [200, 100, 200],
    data: { type: 'new-rider-request', orderId },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const orderId = riderRequestId(event.notification.data);
  if (!orderId) return;
  event.waitUntil((async () => {
    let windows = [];
    try { windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); } catch { /* Open the app if no window can be found. */ }
    for (const client of windows) {
      try {
        const url = new URL(client.url);
        if (url.origin !== self.location.origin || !['/', '/index.html'].includes(url.pathname)) continue;
        await client.focus();
        client.postMessage({ type: 'open-rider-requests', orderId });
        return;
      } catch { /* A window may close between discovery and focus. */ }
    }
    await self.clients.openWindow('/?rider-request=' + encodeURIComponent(orderId));
  })());
});
