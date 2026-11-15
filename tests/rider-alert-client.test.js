import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestTracker, riderPushSupport, vapidKeyBytes, rememberRiderAlerts, riderAlertsEnabled, registerRiderPush, removeRiderPush, notifyRiderOrder, createRiderChime } from '../src/lib/riderAlerts.js';

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
  globalThis.fetch = async (url, options) => { calls.push(options); assert.equal(url, '/api/rider-alerts'); assert.equal(options.cache, 'no-store'); assert.equal(options.headers.Authorization, 'Bearer fixture-token'); if (options.method === 'GET') afterKey?.(); return new Response(JSON.stringify(options.method === 'GET' ? { publicKey: key } : { ok: true }), { headers: { 'Content-Type': 'application/json' } }); };
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
