import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const origin = 'https://kyetechdelivery.test';
const source = await readFile(new URL('../src/sw.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

// Exercise the real worker with local browser doubles; no notification or push
// subscription is created on a device, and no Firebase/network service is used.
function worker({ windows = [], discoveryFails = false, openingFails = false } = {}) {
  const events = new Map(), notifications = [], opened = [], discoveries = [];
  let closed = 0;
  vm.runInNewContext(source, {
    URL,
    self: {
      location: { origin },
      addEventListener(name, listener) { events.set(name, listener); },
      registration: {
        async showNotification(title, options) { notifications.push({ title, ...copy(options) }); },
      },
      clients: {
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
    events, notifications, opened, discoveries,
    get closed() { return closed; },
    push(payload) { return emit('push', { data: payload === undefined ? undefined : { json: () => payload } }); },
    malformedPush() { return emit('push', { data: { json() { throw new SyntaxError('Malformed JSON'); } } }); },
    click(data) { return emit('notificationclick', { notification: { data, close() { closed += 1; } } }); },
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
    title: 'New delivery request',
    body: 'A new delivery request is waiting. Open KyeTech Delivery to review it.',
    icon: '/images/pwa/icon-192.png', badge: '/images/pwa/icon-192.png',
    tag: 'rider-request-Order_ABC-123', vibrate: [200, 100, 200],
    data: request('Order_ABC-123'),
  }]);
  assert.deepEqual(sw.opened, []);
  assert.deepEqual(sw.discoveries, []);
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
