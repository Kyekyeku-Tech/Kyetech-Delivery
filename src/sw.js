const CACHE_PREFIX = 'kyetech-delivery-static-';
const CACHE_NAME = `${CACHE_PREFIX}__KYETECH_PWA_CACHE_VERSION__`;
const PRECACHE_URLS = /* __KYETECH_PWA_PRECACHE__ */ [];
const STATIC_PATHS = new Set(PRECACHE_URLS);
// This separate cache contains only unread/read order IDs, never order details.
const BADGE_CACHE_NAME = 'kyetech-delivery-rider-badge-v1';
const BADGE_STATE_URL = new URL('/.kyetech/rider-request-badge', self.location.origin).href;
const MAX_BADGE_IDS = 1000;
let badgeOperation = Promise.resolve(), lastBadgeState = { unread: [], read: [] };

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

function validRiderRequestId(orderId) {
  return typeof orderId === 'string' && orderId.length > 0 && orderId.length <= 128
    && !/[^A-Za-z0-9_-]/.test(orderId);
}

function riderRequestId(data) {
  return data && typeof data === 'object' && !Array.isArray(data)
    && data.type === 'new-rider-request' && validRiderRequestId(data.orderId) ? data.orderId : '';
}

function storedIds(value) {
  return Array.isArray(value) ? [...new Set(value.filter(validRiderRequestId))].slice(-MAX_BADGE_IDS) : [];
}

async function readBadgeState() {
  try {
    const response = await (await caches.open(BADGE_CACHE_NAME)).match(BADGE_STATE_URL);
    if (response) {
      const saved = await response.json(), read = storedIds(saved?.read);
      lastBadgeState = { unread: storedIds(saved?.unread).filter(id => !read.includes(id)), read };
    }
  } catch { /* Notifications still work if device storage is unavailable. */ }
  return { unread: [...lastBadgeState.unread], read: [...lastBadgeState.read] };
}

async function showBadge(count) {
  try {
    if (!count && typeof self.navigator?.clearAppBadge === 'function') await self.navigator.clearAppBadge();
    else if (typeof self.navigator?.setAppBadge === 'function') await self.navigator.setAppBadge(count);
  } catch { /* Some browsers and launchers do not support app badges. */ }
}

async function closeReadNotifications(unread, notificationId) {
  try {
    const notifications = await self.registration.getNotifications();
    for (const notification of notifications) {
      const id = riderRequestId(notification.data);
      if (id && (!notificationId || id === notificationId) && !unread.has(id)) notification.close();
    }
  } catch { /* Badges can still update when notification enumeration is unavailable. */ }
}

function updateBadge(transform, { notify, notificationId } = {}) {
  const update = badgeOperation.then(async () => {
    if (notify) await notify();
    const next = transform(await readBadgeState());
    lastBadgeState = { unread: storedIds(next.unread), read: storedIds(next.read) };
    try {
      const cache = await caches.open(BADGE_CACHE_NAME);
      await cache.put(BADGE_STATE_URL, new Response(JSON.stringify(lastBadgeState), {
        headers: { 'Content-Type': 'application/json' },
      }));
    } catch { /* Keep this worker's ID state and deliver the visible notification. */ }
    const count = lastBadgeState.unread.length;
    await Promise.all([showBadge(count), closeReadNotifications(new Set(lastBadgeState.unread), notificationId)]);
    return count;
  });
  badgeOperation = update.catch(() => {});
  return update;
}

self.addEventListener('push', (event) => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  const orderId = riderRequestId(payload);
  if (!orderId) return;
  event.waitUntil(updateBadge(state => ({
    unread: state.read.includes(orderId) ? state.unread : [...state.unread, orderId],
    read: state.read,
  }), {
    notificationId: orderId,
    // Display first, inside the queue, so storage errors cannot suppress this alert
    // and another badge update cannot close a not-yet-recorded notification.
    notify: () => self.registration.showNotification('New delivery alert', {
      body: 'A new delivery request is waiting. Open KyeTech Delivery to review it.',
      icon: '/images/pwa/icon-192.png',
      badge: '/images/pwa/icon-192.png',
      tag: 'rider-request-' + orderId,
      vibrate: [200, 100, 200],
      data: { type: 'new-rider-request', orderId },
    }),
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const orderId = riderRequestId(event.notification.data);
  if (!orderId) return;
  event.waitUntil(Promise.all([
    updateBadge(state => ({ unread: state.unread.filter(id => id !== orderId), read: [...state.read, orderId] }), { notificationId: orderId }),
    (async () => {
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
    })(),
  ]));
});

self.addEventListener('message', (event) => {
  try { if (new URL(event.source?.url).origin !== self.location.origin) return; } catch { return; }
  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  let transform;
  if (data.type === 'clear-rider-request-badge') transform = () => ({ unread: [], read: [] });
  else if (data.type === 'sync-rider-request-badge') {
    if (!Array.isArray(data.orderIds) || data.orderIds.length > MAX_BADGE_IDS || !data.orderIds.every(validRiderRequestId)) return;
    const pending = new Set(data.orderIds);
    transform = state => ({
      unread: [...pending].filter(id => !state.read.includes(id)),
      read: state.read.filter(id => pending.has(id)),
    });
  } else return;
  event.waitUntil(updateBadge(transform).then(count => {
    try { event.ports?.[0]?.postMessage({ type: 'rider-request-badge', count }); } catch { /* The app may have closed its reply port. */ }
  }));
});
