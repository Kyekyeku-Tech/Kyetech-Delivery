import test from 'node:test';
import assert from 'node:assert/strict';
import { claimRiderRequestBadge, createRequestTracker, riderPushSupport, vapidKeyBytes, rememberRiderAlerts, riderAlertsEnabled, registerRiderPush, removeRiderPush, notifyRiderOrder, createRiderChime, syncRiderRequestBadge, clearRiderRequestBadge } from '../src/lib/riderAlerts.js';

test('request chimes ignore initial, cached, offline and reopened backlogs and repeated IDs', () => {
  const tracker = createRequestTracker(), live = { ready: true, active: true };
  assert.deepEqual(tracker.observe(['old'], { ready: false, active: true }), []);
  assert.deepEqual(tracker.observe(['old', 'cached'], live), []);
  assert.deepEqual(tracker.observe(['old', 'cached', 'new', 'other'], live), ['new', 'other']);
  assert.deepEqual(tracker.observe(['new'], live), []);
  assert.deepEqual(tracker.observe(['new', 'other'], live), []);
  tracker.observe([], { ready: false, active: true });
  assert.deepEqual(tracker.observe(['new', 'missed'], live), []);
  tracker.observe([], { ready: true, active: false });
  assert.deepEqual(tracker.observe(['new', 'missed', 'offline'], live), []);
  assert.deepEqual(tracker.observe(['new', 'missed', 'offline', 'fresh'], live), ['fresh']);
});

test('iPhone background push requires the installed Home Screen app and browser capabilities', () => {
  const phone = { isSecureContext: true, Notification: {}, PushManager: {}, navigator: { userAgent: 'iPhone', serviceWorker: {} }, matchMedia: () => ({ matches: false }) };
  assert.equal(riderPushSupport(phone), 'install-ios');
  phone.navigator.standalone = true; assert.equal(riderPushSupport(phone), 'supported');
  delete phone.PushManager; assert.equal(riderPushSupport(phone), 'unsupported');
  phone.navigator = { userAgent: 'Android', serviceWorker: {} }; phone.PushManager = {}; assert.equal(riderPushSupport(phone), 'supported');
  phone.isSecureContext = false; assert.equal(riderPushSupport(phone), 'unsupported');
});

test('alert preferences remain per account and tolerate blocked storage', () => {
  const old = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
  try { assert.equal(riderAlertsEnabled('account-a'), false); rememberRiderAlerts('account-a', true); assert.equal(riderAlertsEnabled('account-a'), true); assert.equal(riderAlertsEnabled('account-b'), false); rememberRiderAlerts('account-a', false); assert.equal(riderAlertsEnabled('account-a'), false); }
  finally { globalThis.localStorage = old; }
});

test('push registration uses authenticated uncached requests and aborts stale account registration', async () => {
  const previousFetch = globalThis.fetch;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const key = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
  let unsubscribed = 0, subscribed = 0, calls = [], current = true, afterKey;
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/fixture', options: {}, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: key, auth: Buffer.alloc(16, 1).toString('base64url') } }; }, async unsubscribe() { unsubscribed++; return true; } };
  const registration = { active: { state: 'activated' }, pushManager: { async getSubscription() { return subscription; }, async subscribe() { subscribed++; return subscription; } } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { async register() { return registration; }, ready: Promise.resolve(registration), async getRegistration() { return registration; } } } });
  globalThis.fetch = async (url, options) => { calls.push(options); assert.match(url, /^\/api\/rider-alerts(?:\?subscriptionId=[a-f0-9]{64})?$/); assert.equal(options.cache, 'no-store'); assert.equal(options.headers.Authorization, 'Bearer fixture-token'); if (options.method === 'GET') afterKey?.(); return new Response(JSON.stringify(options.method === 'GET' ? { publicKey: key } : { ok: true }), { headers: { 'Content-Type': 'application/json' } }); };
  const user = { uid: 'fixture-user', async getIdToken() { return 'fixture-token'; } };
  try {
    assert.deepEqual([...vapidKeyBytes(key)], [...Buffer.from(key, 'base64url')]);
    assert.equal(await registerRiderPush(user, () => current), true); assert.equal(subscribed, 0);
    assert.equal(JSON.parse(calls[1].body).action, 'subscribe'); assert.equal(JSON.parse(calls[1].body).uid, undefined);
    await removeRiderPush({ ...user, uid: 'another-user' }); assert.equal(unsubscribed, 0);
    await removeRiderPush(user); assert.equal(unsubscribed, 1); assert.equal(calls.at(-1).method, 'DELETE');
    calls = []; afterKey = () => { current = false; };
    assert.equal(await registerRiderPush(user, () => current), false); assert.equal(calls.length, 1);
  } finally { globalThis.fetch = previousFetch; Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); }
});

test('a push error never turns a saved delivery into a failed order', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Temporarily unavailable' }), { status: 503 });
  try { assert.equal(await notifyRiderOrder({ getIdToken: async () => 'fixture' }, 'saved-order'), false); }
  finally { globalThis.fetch = original; }
});

test('push enrollment repairs a provider-rejected subscription or a rotated application key', async () => {
  const originalFetch = globalThis.fetch, descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const key = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 8)]).toString('base64url');
  const user = { uid: 'repair-rider', getIdToken: async () => 'fixture-token' };
  try {
    for (const rejected of [true, false]) {
      let current, removed = 0, enrolled = 0;
      const calls = [];
      const old = { endpoint: 'https://fcm.googleapis.com/fcm/send/old', options: { applicationServerKey: Buffer.from(rejected ? key : Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 9)])) }, unsubscribe: async () => { removed++; current = null; }, toJSON() { return { endpoint: this.endpoint, keys: {} }; } };
      old.options.applicationServerKey = rejected ? Buffer.from(key, 'base64url') : Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 9)]);
      const fresh = { endpoint: 'https://fcm.googleapis.com/fcm/send/new', unsubscribe: async () => {}, toJSON() { return { endpoint: this.endpoint, keys: {} }; } };
      current = old;
      const registration = { active: { state: 'activated', postMessage() {} }, pushManager: { getSubscription: async () => current, subscribe: async options => { enrolled++; assert.deepEqual([...options.applicationServerKey], [...Buffer.from(key, 'base64url')]); return fresh; } } };
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistration: async () => registration } } });
      globalThis.navigator.serviceWorker.register = async () => registration;
      globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); return new Response(JSON.stringify(options.method === 'GET' ? { publicKey: key, requiresResubscribe: rejected } : { ok: true })); };
      assert.equal(await registerRiderPush(user), true);
      assert.equal(removed, 1); assert.equal(enrolled, 1);
      assert.match(calls[0].url, /\?subscriptionId=[a-f0-9]{64}$/);
      assert.ok(!calls[0].url.includes(old.endpoint));
      assert.equal(calls[1].method, 'DELETE'); assert.equal(JSON.parse(calls[1].body).endpoint, old.endpoint);
      assert.equal(JSON.parse(calls[2].body).subscription.endpoint, fresh.endpoint);
      await removeRiderPush(user);
    }
  } finally { globalThis.fetch = originalFetch; Object.defineProperty(globalThis, 'navigator', descriptor); }
});

test('badge messages contain only safe pending IDs and discard stale account work', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const messages = []; let current = true, hold;
  const registration = { active: { postMessage: message => messages.push(message) } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistration: async () => { if (hold) await hold; return registration; } } } });
  try {
    await syncRiderRequestBadge(['order-1', 'order-1', 'order-2', 'bad/path', 'newline\n', '', null]);
    assert.deepEqual(messages, [{ type: 'sync-rider-request-badge', orderIds: ['order-1', 'order-2'] }]);
    await syncRiderRequestBadge(Array.from({ length: 1100 }, (_, index) => 'order-' + index));
    assert.equal(messages.at(-1).orderIds.length, 1000, 'The client respects the worker protocol limit.');
    const before = messages.length;
    let release; hold = new Promise(resolve => { release = resolve; });
    const pending = syncRiderRequestBadge(['stale-order'], () => current);
    await new Promise(resolve => setImmediate(resolve)); current = false; release(); await pending;
    assert.equal(messages.length, before);
    await clearRiderRequestBadge(); assert.deepEqual(messages.at(-1), { type: 'clear-rider-request-badge' });
  } finally { Object.defineProperty(globalThis, 'navigator', descriptor); }
});

test('persistent badge ownership preserves read state when the same rider reopens the app', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), previousStorage = globalThis.localStorage;
  const stored = new Map(), messages = [];
  globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistration: async () => ({ active: { postMessage: message => messages.push(message) } }) } } });
  try {
    await claimRiderRequestBadge('same-rider');
    assert.deepEqual(messages, [{ type: 'clear-rider-request-badge' }], 'Unknown ownership is cleared before the first account claims it.');
    messages.length = 0;
    await syncRiderRequestBadge(['read-order', 'new-order'], () => true, 'same-rider');
    assert.equal(stored.get('kyetech:rider-request-badge-owner'), 'same-rider');
    const reopened = await import('../src/lib/riderAlerts.js?badge-owner-reopen');
    await reopened.claimRiderRequestBadge('same-rider');
    await reopened.syncRiderRequestBadge(['read-order', 'new-order'], () => true, 'same-rider');
    assert.deepEqual(messages, [
      { type: 'sync-rider-request-badge', orderIds: ['read-order', 'new-order'] },
      { type: 'sync-rider-request-badge', orderIds: ['read-order', 'new-order'] },
    ], 'A fresh client module must not reset the worker read-ID history for the same account.');
  } finally { globalThis.localStorage = previousStorage; Object.defineProperty(globalThis, 'navigator', descriptor); }
});

test('account changes clear badges once before sync, and stale queued owners cannot clear the new account', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), previousStorage = globalThis.localStorage;
  const key = 'kyetech:rider-request-badge-owner', stored = new Map([[key, 'old-rider']]), messages = [];
  let hold, current = true;
  globalThis.localStorage = { getItem: name => stored.get(name) ?? null, setItem: (name, value) => stored.set(name, value) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistration: async () => {
    if (hold) await hold;
    return { active: { postMessage: message => messages.push(message) } };
  } } } });
  try {
    await claimRiderRequestBadge('new-rider');
    await syncRiderRequestBadge(['new-order'], () => true, 'new-rider');
    assert.deepEqual(messages, [{ type: 'clear-rider-request-badge' }, { type: 'sync-rider-request-badge', orderIds: ['new-order'] }]);
    assert.equal(stored.get(key), 'new-rider');
    let release; hold = new Promise(resolve => { release = resolve; });
    const stale = claimRiderRequestBadge('stale-rider', () => current);
    await new Promise(resolve => setImmediate(resolve));
    current = false; release(); await stale; hold = null;
    assert.equal(stored.get(key), 'new-rider');
    await clearRiderRequestBadge(() => true, 'old-rider');
    assert.equal(messages.length, 2, 'The previous account cannot clear the new owner badge.');
    await clearRiderRequestBadge(() => true, 'new-rider');
    assert.deepEqual(messages.at(-1), { type: 'clear-rider-request-badge' });
  } finally { globalThis.localStorage = previousStorage; Object.defineProperty(globalThis, 'navigator', descriptor); }
});

test('an unready worker leaves ownership untouched until a guarded first sync can clear the previous account', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), previousStorage = globalThis.localStorage;
  const key = 'kyetech:rider-request-badge-owner', stored = new Map([[key, 'previous-rider']]), messages = [];
  let registration;
  globalThis.localStorage = { getItem: name => stored.get(name) ?? null, setItem: (name, value) => stored.set(name, value) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistration: async () => registration } } });
  try {
    assert.equal(await claimRiderRequestBadge('current-rider'), false);
    assert.equal(stored.get(key), 'previous-rider');
    registration = { active: { postMessage: message => messages.push(message) } };
    await syncRiderRequestBadge(['eligible-order'], () => true, 'current-rider');
    assert.deepEqual(messages, [{ type: 'clear-rider-request-badge' }, { type: 'sync-rider-request-badge', orderIds: ['eligible-order'] }]);
    assert.equal(stored.get(key), 'current-rider');
  } finally { globalThis.localStorage = previousStorage; Object.defineProperty(globalThis, 'navigator', descriptor); }
});

test('stale account cleanup cannot unsubscribe the current phone enrollment', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), originalFetch = globalThis.fetch;
  let release, current = true, unsubscribed = 0, requests = 0;
  const held = new Promise(resolve => { release = resolve; });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistration: async () => {
    await held;
    return { active: { postMessage() {} }, pushManager: { getSubscription: async () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/current', unsubscribe: async () => { unsubscribed++; } }) } };
  } } } });
  globalThis.fetch = async () => { requests++; return new Response('{}'); };
  try {
    const cleanup = removeRiderPush({ uid: 'stale-rider', getIdToken: async () => 'fixture' }, () => current);
    await new Promise(resolve => setImmediate(resolve)); current = false; release(); await cleanup;
    assert.equal(unsubscribed, 0);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; Object.defineProperty(globalThis, 'navigator', descriptor); }
});

test('chimes require a rider gesture and stop every scheduled tone when muted', async () => {
  const tones = []; let state = 'suspended';
  const sound = createRiderChime({ AudioContext: class {
    get state() { return state; } currentTime = 0; destination = {};
    async resume() { state = 'running'; }
    async close() { state = 'closed'; }
    createOscillator() { const node = { frequency: {}, connect() {}, disconnect() {}, start() {}, stop() { this.stops = (this.stops || 0) + 1; } }; tones.push(node); return node; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  } });
  assert.equal(sound.play(), false); assert.equal(tones.length, 0);
  assert.equal(await sound.unlock(), true); assert.equal(tones.length, 6);
  sound.stop(); assert.ok(tones.every(node => node.stops === 2)); sound.close(); assert.equal(sound.ready(), false);
});
