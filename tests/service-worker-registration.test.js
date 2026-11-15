import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureServiceWorker } from '../src/lib/registerServiceWorker.js';

function fixture() {
  const installing = Object.assign(new EventTarget(), { state: 'installing' });
  const registration = Object.assign(new EventTarget(), { installing, waiting: null, active: null });
  const calls = [];
  const container = {
    // ready can remain unresolved when registration never started.
    ready: new Promise(() => {}),
    async getRegistration() { return undefined; },
    async register(...args) { calls.push(args); return registration; },
  };
  return { registration, installing, calls, container };
}

test('alert setup starts a root worker directly and follows first-install activation without relying on ready', async () => {
  const f = fixture(), pending = ensureServiceWorker({ container: f.container, timeoutMs: 1000 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls, [['/sw.js', { scope: '/', updateViaCache: 'none' }]]);
  f.installing.state = 'activating'; f.registration.active = f.installing; f.registration.installing = null;
  f.installing.dispatchEvent(new Event('statechange'));
  f.installing.state = 'activated'; f.installing.dispatchEvent(new Event('statechange'));
  assert.equal(await pending, f.registration);
});

test('an active worker is usable while a newer version waits without forcing an update', async () => {
  const f = fixture(); f.registration.active = { state: 'activated' }; f.registration.waiting = { state: 'installed' };
  f.container.getRegistration = async () => f.registration;
  assert.equal(await ensureServiceWorker({ container: f.container }), f.registration);
  assert.equal(f.calls.length, 0);
});

test('a failed installation reports a retry error promptly and can be registered again', async () => {
  const f = fixture(), pending = ensureServiceWorker({ container: f.container, timeoutMs: 1000 });
  await new Promise(resolve => setImmediate(resolve));
  const rejected = assert.rejects(pending, /Check your connection and turn alerts on again/);
  f.installing.state = 'redundant'; f.registration.installing = null; f.installing.dispatchEvent(new Event('statechange'));
  await rejected;
  f.registration.active = { state: 'activated' };
  assert.equal(await ensureServiceWorker({ container: f.container }), f.registration);
  assert.equal(f.calls.length, 2);
});

test('registration failures and stalled browsers have a bounded accurate error', async () => {
  const f = fixture(); f.container.register = async () => { throw new Error('Internal browser failure'); };
  await assert.rejects(ensureServiceWorker({ container: f.container }), /Phone notifications could not start/);
  const stalled = fixture(); stalled.container.register = () => new Promise(() => {});
  await assert.rejects(ensureServiceWorker({ container: stalled.container, timeoutMs: 20 }), /Phone notifications could not start/);
  stalled.registration.active = { state: 'activated' };
  stalled.container.register = async () => stalled.registration;
  assert.equal(await ensureServiceWorker({ container: stalled.container }), stalled.registration, 'A stalled attempt must not prevent the next tap from retrying.');
});
