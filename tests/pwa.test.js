import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const origin = 'https://kyetechdelivery.test';
const prefix = 'kyetech-delivery-static-';
const publicUrls = ['/offline.html', '/manifest.webmanifest', '/images/pwa/icon-192.png', '/assets/app-fixture.js', '/assets/app-fixture.css'];
const template = await readFile(new URL('../src/sw.js', import.meta.url), 'utf8');

// Run the actual worker in an isolated browser-like environment. None of these
// cases touch Firebase, send an OTP/SMS or require a previous production build.
async function worker({ version = 'new', failAsset = '', stored = new Map() } = {}) {
  const events = new Map(), networkCalls = [], deleted = [], installRequests = [];
  let online = true, status = 200, claims = 0, forcedActivations = 0;
  const key = value => new URL(typeof value === 'string' ? value : value.url, origin).href;
  const fetcher = async request => {
    networkCalls.push(request);
    if (!online || new URL(request.url).pathname === failAsset) throw new TypeError('Network unavailable');
    const path = new URL(request.url).pathname;
    return new Response(path === '/offline.html' ? '<h1>You are offline</h1>' : `network ${request.url}`, { status });
  };
  const caches = {
    async open(name) {
      if (!stored.has(name)) stored.set(name, new Map());
      const entries = stored.get(name);
      return {
        async addAll(requests) {
          for (const request of requests) {
            installRequests.push(request);
            const response = await fetcher(request);
            if (!response.ok) throw new Error('Precache failed');
            entries.set(key(request), response);
          }
        },
        async match(request) { return entries.get(key(request))?.clone(); },
      };
    },
    async keys() { return [...stored.keys()]; },
    async delete(name) { deleted.push(name); return stored.delete(name); },
  };
  class BrowserRequest extends Request {
    constructor(input, options) { super(typeof input === 'string' ? new URL(input, origin) : input, options); }
  }
  const self = {
    location: { origin },
    clients: { async claim() { claims += 1; } },
    skipWaiting() { forcedActivations += 1; },
    addEventListener(name, listener) { events.set(name, listener); },
  };
  vm.runInNewContext(template
    .replace('__KYETECH_PWA_CACHE_VERSION__', version)
    .replace('/* __KYETECH_PWA_PRECACHE__ */ []', JSON.stringify(publicUrls)), {
    self, caches, fetch: fetcher, URL, Request: BrowserRequest, Response,
  });
  return {
    stored, networkCalls, deleted, installRequests,
    get claims() { return claims; },
    get forcedActivations() { return forcedActivations; },
    set online(value) { online = value; },
    set status(value) { status = value; },
    async lifecycle(name) {
      let pending;
      events.get(name)({ waitUntil(value) { pending = value; } });
      await pending;
    },
    async request(path, { method = 'GET', mode = 'cors', cache = 'default', headers = {} } = {}) {
      const request = { url: new URL(path, origin).href, method, mode, cache, headers: new Headers(headers) };
      let response;
      events.get('fetch')({ request, respondWith(value) { response = value; } });
      return { intercepted: response !== undefined, response: response === undefined ? undefined : await response };
    },
  };
}

test('Worker installation fetches only public assets without cookies and never forces an update into an open app', async () => {
  const sw = await worker();
  await sw.lifecycle('install');
  assert.deepEqual(sw.installRequests.map(request => new URL(request.url).pathname), publicUrls);
  assert.ok(sw.installRequests.every(request => request.credentials === 'omit' && request.cache === 'reload'));
  assert.equal(sw.forcedActivations, 0);
  assert.equal(sw.claims, 0);
  assert.equal(sw.stored.get(`${prefix}new`).size, publicUrls.length);
});

test('An incomplete update discards its partial cache and preserves the currently installed version', async () => {
  const previous = new Map([['https://kyetechdelivery.test/offline.html', new Response('old fallback')]]);
  const stored = new Map([[`${prefix}old`, previous], ['other-app', new Map()]]);
  const sw = await worker({ stored, failAsset: '/assets/app-fixture.js' });
  await assert.rejects(sw.lifecycle('install'), /Network unavailable/);
  assert.equal(stored.has(`${prefix}new`), false);
  assert.equal(stored.get(`${prefix}old`), previous);
  assert.equal(stored.has('other-app'), true);
  assert.equal(sw.forcedActivations, 0);
});

test('Account and review navigation keeps fresh server responses and tokens out of the public cache', async () => {
  const sw = await worker();
  await sw.lifecycle('install');
  const paths = ['/', '/index.html', '/admin', '/admin/access', '/review?token=private-review-token'];
  for (const path of paths) {
    const result = await sw.request(path, { mode: 'navigate' });
    assert.equal(result.intercepted, true);
    assert.equal(await result.response.text(), `network ${new URL(path, origin).href}`);
  }
  assert.equal(sw.stored.get(`${prefix}new`).size, publicUrls.length);
  assert.ok([...sw.stored.get(`${prefix}new`).keys()].every(url => !url.includes('private-review-token')));
  sw.status = 503;
  assert.equal((await sw.request('/admin', { mode: 'navigate' })).response.status, 503, 'A server error must remain an error rather than appear as offline success.');
  sw.online = false;
  for (const path of paths) {
    assert.match(await (await sw.request(path, { mode: 'navigate' })).response.text(), /offline/);
  }
  assert.equal(sw.stored.get(`${prefix}new`).size, publicUrls.length);
});

test('API, Firebase, writes and unknown navigation never receive cached app HTML or an offline success', async () => {
  const sw = await worker();
  await sw.lifecycle('install');
  sw.online = false;
  for (const [path, options] of [
    ['/api/admin-otp', {}], ['/api/delivery-sms', { method: 'POST' }],
    ['/api/gps-address', { mode: 'navigate' }], ['/api', { mode: 'navigate' }],
    ['https://firestore.googleapis.com/v1/projects/fixture', {}],
    ['https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword', { method: 'POST' }],
    ['/assets/app-fixture.js', { method: 'POST' }],
    ['/unknown-route', { mode: 'navigate' }],
  ]) assert.equal((await sw.request(path, options)).intercepted, false, `${path} must stay on the network.`);
  assert.equal(sw.stored.get(`${prefix}new`).size, publicUrls.length);
});

test('Only exact public asset reads use cache; private, no-store, partial and query requests bypass it', async () => {
  const sw = await worker();
  await sw.lifecycle('install');
  sw.networkCalls.length = 0;
  const publicAsset = await sw.request('/assets/app-fixture.js');
  assert.equal(publicAsset.intercepted, true);
  assert.equal(sw.networkCalls.length, 0);
  for (const [path, options] of [
    ['/assets/app-fixture.js?account=private', {}],
    ['/assets/app-fixture.js', { cache: 'no-store' }],
    ['/assets/app-fixture.js', { headers: { Authorization: 'Bearer private-fixture' } }],
    ['/assets/app-fixture.js', { headers: { Range: 'bytes=0-20' } }],
    ['/user-photo.png', {}],
    ['/admin', { mode: 'navigate', headers: { Authorization: 'Bearer private-fixture' } }],
  ]) assert.equal((await sw.request(path, options)).intercepted, false, `${path} must not read the public cache.`);
  assert.equal(sw.stored.get(`${prefix}new`).size, publicUrls.length);
});

test('Installing an update preserves the old app until activation; cleanup leaves unrelated caches alone', async () => {
  const stored = new Map([[`${prefix}old`, new Map()], ['firebase-private-fixture', new Map()], ['another-pwa', new Map()]]);
  const sw = await worker({ stored });
  await sw.lifecycle('install');
  assert.equal(stored.has(`${prefix}old`), true, 'An update must not remove assets in use by an existing tab.');
  assert.equal(sw.claims, 0);
  assert.equal(sw.forcedActivations, 0);
  await sw.lifecycle('activate');
  assert.deepEqual(sw.deleted, [`${prefix}old`]);
  assert.equal(stored.has(`${prefix}new`), true);
  assert.equal(stored.has('firebase-private-fixture'), true);
  assert.equal(stored.has('another-pwa'), true);
  assert.equal(sw.claims, 1);
  assert.equal(sw.forcedActivations, 0);
});
