import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const origin = 'https://kyetechdelivery.test';
const badgeCache = 'kyetech-delivery-rider-badge-v1';
const badgeUrl = origin + '/.kyetech/rider-request-badge';
const source = await readFile(new URL('../src/sw.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

// Exercise the real worker with local browser doubles; no notification or push
// subscription is created on a device, and no Firebase/network service is used.
function worker({ windows = [], discoveryFails = false, openingFails = false, stored = new Map(), badgeSupported = true, badgeFails = false, storageFails = false } = {}) {
  const events = new Map(), notifications = [], opened = [], discoveries = [], badgeCalls = [], replies = [], visible = new Map();
  let closed = 0, nativeClosed = 0, claims = 0;
  const cacheKey = value => typeof value === 'string' ? value : value.url;
  vm.runInNewContext(source, {
    URL, Response,
    caches: {
      async open(name) {
        if (storageFails) throw new Error('Storage unavailable');
        if (!stored.has(name)) stored.set(name, new Map());
        const entries = stored.get(name);
        return {
          async match(key) {
            const bytes = entries.get(cacheKey(key));
            return bytes === undefined ? undefined : new Response(bytes);
          },
          async put(key, response) { entries.set(cacheKey(key), await response.text()); },
        };
      },
      async keys() { return [...stored.keys()]; },
      async delete(name) { return stored.delete(name); },
    },
    self: {
      location: { origin },
      navigator: badgeSupported ? {
        async setAppBadge(count) { badgeCalls.push(count); if (badgeFails) throw new Error('Badging unavailable'); },
        async clearAppBadge() { badgeCalls.push(0); if (badgeFails) throw new Error('Badging unavailable'); },
      } : {},
      addEventListener(name, listener) { events.set(name, listener); },
      registration: {
        async showNotification(title, options) {
          const notification = { title, ...copy(options), close() { nativeClosed += 1; visible.delete(options.tag); } };
          notifications.push({ title, ...copy(options) });
          visible.set(options.tag, notification);
        },
        async getNotifications() { return [...visible.values()]; },
      },
      clients: {
        async claim() { claims += 1; },
        async matchAll(options) {
          discoveries.push(copy(options));
          if (discoveryFails) throw new Error('Client discovery unavailable');
          return windows;
        },
        async openWindow(url) {
          opened.push(url);
          if (openingFails) throw new Error('Window could not open');
          return { url: new URL(url, origin).href };
        },
      },
    },
  });
  async function emit(name, event) {
    let pending;
    events.get(name)({ ...event, waitUntil(promise) { pending = promise; } });
    await pending;
  }
  return {
    events, notifications, opened, discoveries, badgeCalls, replies, stored, visible,
    get closed() { return closed; },
    get nativeClosed() { return nativeClosed; },
    get claims() { return claims; },
    get badgeState() {
      const bytes = stored.get(badgeCache)?.get(badgeUrl);
      return bytes === undefined ? undefined : JSON.parse(bytes);
    },
    push(payload) { return emit('push', { data: payload === undefined ? undefined : { json: () => payload } }); },
    malformedPush() { return emit('push', { data: { json() { throw new SyntaxError('Malformed JSON'); } } }); },
    click(data) { return emit('notificationclick', { notification: { data, close() { closed += 1; visible.delete('rider-request-' + data?.orderId); } } }); },
    message(data, sourceUrl = origin + '/') {
      return emit('message', { data, source: sourceUrl == null ? undefined : { url: sourceUrl }, ports: [{ postMessage(reply) { replies.push(copy(reply)); } }] });
    },
    activate() { return emit('activate', {}); },
  };
}

function windowClient(url, { fails = false } = {}) {
  let focused = 0;
  const messages = [];
  return {
    url, messages,
    get focused() { return focused; },
    async focus() {
      focused += 1;
      if (fails) throw new Error('Window was closed');
      return this;
    },
    postMessage(message) { messages.push(copy(message)); },
  };
}

const request = orderId => ({ type: 'new-rider-request', orderId });

test('A rider push shows only fixed public text and app icons, with an order-specific tag', async () => {
  const sw = worker();
  await sw.push({
    ...request('Order_ABC-123'), title: 'Private customer name', body: 'Private address',
    url: 'https://untrusted.example/steal', icon: 'https://untrusted.example/track.png',
    customerPhone: '+233241234567',
  });
  assert.deepEqual(sw.notifications, [{
    title: 'New delivery alert',
    body: 'A new delivery request is waiting. Open KyeTech Delivery to review it.',
    icon: '/images/pwa/icon-192.png', badge: '/images/pwa/icon-192.png',
    tag: 'rider-request-Order_ABC-123', vibrate: [200, 100, 200],
    data: request('Order_ABC-123'),
  }]);
  assert.deepEqual(sw.opened, []);
  assert.deepEqual(sw.discoveries, []);
  assert.deepEqual(sw.badgeState, { unread: ['Order_ABC-123'], read: [] });
  assert.deepEqual(sw.badgeCalls, [1]);
  assert.ok(sw.events.has('install') && sw.events.has('activate') && sw.events.has('fetch'), 'Existing cache lifecycle handlers remain registered.');
});

test('Missing, malformed, unrelated and unsafe rider push payloads display no notification', async () => {
  const sw = worker();
  await sw.malformedPush();
  for (const payload of [
    undefined, null, [], 'text', {}, { type: 'other', orderId: 'valid-order' },
    request(''), request(123), request('a'.repeat(129)), request('../admin'),
    request('https://untrusted.example/'), request('order?token=private'),
    request(' order'), request('order\n'), request('order\r'), request('order/id'),
  ]) await sw.push(payload);
  assert.deepEqual(sw.notifications, []);
  assert.deepEqual(sw.opened, []);
  assert.deepEqual(sw.discoveries, []);
  await sw.push(request('a'.repeat(128)));
  assert.equal(sw.notifications.length, 1, 'The maximum permitted order ID is valid.');
});

test('Clicking a rider notification focuses an existing same-origin app and sends only its order ID', async () => {
  const client = windowClient(origin + '/?existing=1');
  const sw = worker({ windows: [client] });
  await sw.click({ ...request('order-one'), url: 'https://untrusted.example/', body: 'Private customer address' });
  assert.equal(sw.closed, 1);
  assert.equal(client.focused, 1);
  assert.deepEqual(client.messages, [{ type: 'open-rider-requests', orderId: 'order-one' }]);
  assert.deepEqual(sw.discoveries, [{ type: 'window', includeUncontrolled: true }]);
  assert.deepEqual(sw.opened, []);
});

test('A notification never focuses a remote or malformed client and opens only the app request route', async () => {
  const clients = [windowClient('https://kyetechdelivery.test.untrusted.example/'), windowClient('https://untrusted.example/'), windowClient('not a URL')];
  const sw = worker({ windows: clients });
  await sw.click({ ...request('order-2_A'), url: '/admin?token=private' });
  assert.ok(clients.every(client => client.focused === 0 && client.messages.length === 0));
  assert.deepEqual(sw.opened, ['/?rider-request=order-2_A']);
});

test('A window that closes during notification click does not block another open app window', async () => {
  const closed = windowClient(origin + '/', { fails: true });
  const open = windowClient(origin + '/index.html');
  const sw = worker({ windows: [closed, open] });
  await sw.click(request('order-three'));
  assert.equal(closed.focused, 1);
  assert.deepEqual(closed.messages, []);
  assert.equal(open.focused, 1);
  assert.deepEqual(open.messages, [{ type: 'open-rider-requests', orderId: 'order-three' }]);
  assert.deepEqual(sw.opened, []);
});

test('Review and administrator windows do not swallow a rider notification click', async () => {
  const clients = [windowClient(origin + '/review?token=private'), windowClient(origin + '/admin')];
  const sw = worker({ windows: clients });
  await sw.click(request('order-six'));
  assert.ok(clients.every(client => client.focused === 0));
  assert.deepEqual(sw.opened, ['/?rider-request=order-six']);
});

test('Notification clicks open the app when no usable window can be discovered or focused', async () => {
  for (const options of [
    {}, { discoveryFails: true }, { windows: [windowClient(origin + '/', { fails: true })] },
  ]) {
    const sw = worker(options);
    await sw.click(request('order-four'));
    assert.deepEqual(sw.opened, ['/?rider-request=order-four']);
    assert.equal(sw.closed, 1);
  }
});

test('An invalid or unrelated notification click closes the notification without routing the app', async () => {
  const client = windowClient(origin + '/'), sw = worker({ windows: [client] });
  for (const data of [undefined, null, {}, { type: 'other', orderId: 'valid-order' }, request(''), request('../admin'), request('order\n'), request('a'.repeat(129))]) {
    await sw.click(data);
  }
  assert.equal(sw.closed, 8);
  assert.equal(client.focused, 0);
  assert.deepEqual(client.messages, []);
  assert.deepEqual(sw.opened, []);
  assert.deepEqual(sw.discoveries, []);
});

test('The notification lifetime includes a failed app-opening attempt', async () => {
  const sw = worker({ openingFails: true });
  await assert.rejects(sw.click(request('order-five')), /Window could not open/);
  assert.deepEqual(sw.opened, ['/?rider-request=order-five']);
});

test('Concurrent duplicate pushes keep one persistent unread ID per request without open app windows', async () => {
  const stored = new Map(), sw = worker({ stored });
  await Promise.all([sw.push(request('first')), sw.push(request('second')), sw.push(request('first'))]);
  assert.deepEqual(sw.badgeState, { unread: ['first', 'second'], read: [] });
  assert.deepEqual(sw.badgeCalls, [1, 2, 2]);
  assert.equal(sw.visible.size, 2, 'Per-order native notification tags also avoid duplicate launcher notifications.');
  assert.deepEqual(sw.discoveries, [], 'Background push never needs an app window.');
  const restarted = worker({ stored });
  await restarted.push(request('third'));
  assert.deepEqual(restarted.badgeState, { unread: ['first', 'second', 'third'], read: [] });
  assert.deepEqual(restarted.badgeCalls, [3]);
});

test('Clicking an alert marks its ID read and snapshot sync or duplicate push does not restore it', async () => {
  const sw = worker();
  await sw.push(request('first'));
  await sw.push(request('second'));
  await sw.click(request('first'));
  assert.deepEqual(sw.badgeState, { unread: ['second'], read: ['first'] });
  assert.equal(sw.badgeCalls.at(-1), 1);
  await sw.message({ type: 'sync-rider-request-badge', orderIds: ['first', 'second', 'second', 'third'] });
  assert.deepEqual(sw.badgeState, { unread: ['second', 'third'], read: ['first'] });
  assert.deepEqual(sw.replies.at(-1), { type: 'rider-request-badge', count: 2 });
  await sw.push(request('first'));
  assert.deepEqual(sw.badgeState, { unread: ['second', 'third'], read: ['first'] });
  assert.equal(sw.visible.has('rider-request-first'), false, 'A repeated read notification does not leave a launcher badge behind.');
});

test('Eligible-request sync removes unavailable IDs and their own native notifications', async () => {
  const sw = worker();
  await sw.push(request('accepted-order'));
  await sw.push(request('pending-order'));
  await sw.message({ type: 'sync-rider-request-badge', orderIds: ['pending-order'] });
  assert.deepEqual(sw.badgeState, { unread: ['pending-order'], read: [] });
  assert.equal(sw.badgeCalls.at(-1), 1);
  assert.equal(sw.visible.has('rider-request-accepted-order'), false);
  assert.equal(sw.visible.has('rider-request-pending-order'), true);
});

test('Account or alert clearing resets both ID sets, clears badges and closes only delivery alerts', async () => {
  const sw = worker();
  await sw.push(request('first'));
  await sw.push(request('second'));
  await sw.click(request('first'));
  sw.visible.set('unrelated', { data: { type: 'other' }, close() { throw new Error('Must not close unrelated notifications'); } });
  await sw.message({ type: 'clear-rider-request-badge' });
  assert.deepEqual(sw.badgeState, { unread: [], read: [] });
  assert.equal(sw.badgeCalls.at(-1), 0);
  assert.equal(sw.visible.size, 1);
  assert.equal(sw.visible.has('unrelated'), true);
  assert.deepEqual(sw.replies.at(-1), { type: 'rider-request-badge', count: 0 });
  await sw.message({ type: 'sync-rider-request-badge', orderIds: ['first'] });
  assert.deepEqual(sw.badgeState, { unread: ['first'], read: [] }, 'The previous account read history was reset.');
});

test('Invalid or foreign badge messages cannot alter unread state or reply with a count', async () => {
  const sw = worker();
  await sw.push(request('valid-order'));
  for (const [data, sourceUrl] of [
    [{ type: 'clear-rider-request-badge' }, 'https://untrusted.example/'],
    [{ type: 'clear-rider-request-badge' }, null],
    [{ type: 'clear-rider-request-badge' }, 'not a URL'],
    [{ type: 'unknown', orderIds: [] }, origin + '/'],
    [{ type: 'sync-rider-request-badge', orderIds: 'valid-order' }, origin + '/'],
    [{ type: 'sync-rider-request-badge', orderIds: ['valid-order', '../private'] }, origin + '/'],
    [{ type: 'sync-rider-request-badge', orderIds: ['order\n'] }, origin + '/'],
    [{ type: 'sync-rider-request-badge', orderIds: Array(1001).fill('order') }, origin + '/'],
  ]) await sw.message(data, sourceUrl);
  assert.deepEqual(sw.badgeState, { unread: ['valid-order'], read: [] });
  assert.deepEqual(sw.badgeCalls, [1]);
  assert.deepEqual(sw.replies, []);
});

test('Unsupported Badging API leaves visible native notifications available for Android launchers', async () => {
  const sw = worker({ badgeSupported: false });
  await sw.push(request('background-order'));
  assert.equal(sw.notifications.length, 1);
  assert.equal(sw.visible.size, 1);
  assert.deepEqual(sw.badgeCalls, []);
  assert.deepEqual(sw.badgeState, { unread: ['background-order'], read: [] });
  await sw.message({ type: 'clear-rider-request-badge' });
  assert.equal(sw.visible.size, 0);
});

test('Badge API or storage errors never suppress a visible delivery notification', async () => {
  for (const options of [{ badgeFails: true }, { storageFails: true }]) {
    const sw = worker(options);
    await sw.push(request('first'));
    await sw.push(request('second'));
    assert.equal(sw.notifications.length, 2);
    assert.equal(sw.visible.size, 2);
    assert.equal(sw.badgeCalls.at(-1), 2);
    await sw.message({ type: 'clear-rider-request-badge' });
    assert.equal(sw.visible.size, 0);
  }
});

test('Persisted badge state stores only ID lists and survives static-worker update cleanup', async () => {
  const stored = new Map([['kyetech-delivery-static-old', new Map()]]), sw = worker({ stored });
  await sw.push({ ...request('order-one'), customerName: 'Private name', phone: '+233241234567', token: 'private-token' });
  await sw.activate();
  assert.equal(stored.has('kyetech-delivery-static-old'), false);
  assert.equal(stored.has(badgeCache), true);
  assert.equal(sw.claims, 1);
  assert.deepEqual([...stored.get(badgeCache).keys()], [badgeUrl]);
  const bytes = stored.get(badgeCache).get(badgeUrl);
  assert.deepEqual(JSON.parse(bytes), { unread: ['order-one'], read: [] });
  assert.doesNotMatch(bytes, /Private name|233241234567|private-token|customerName|phone|token/);
});

test('Corrupt badge storage is repaired using validated ID lists without retaining extra fields', async () => {
  const stored = new Map([[badgeCache, new Map([[badgeUrl, JSON.stringify({ unread: ['first', 'first', '../bad', 'read-one'], read: ['read-one'], customerName: 'Private name' })]])]]);
  const sw = worker({ stored });
  await sw.push(request('second'));
  assert.deepEqual(sw.badgeState, { unread: ['first', 'second'], read: ['read-one'] });
  assert.equal(sw.badgeCalls.at(-1), 2);
});
