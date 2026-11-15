import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { Readable } from 'node:stream';
import { createRiderAlertsService, createRiderAlertsMiddleware, createFirebaseRiderAlertsStore,
  validatePushSubscription, validatePushEndpoint, riderPushSubscriptionId } from '../server/riderAlerts.mjs';
import endpointHandler from '../api/rider-alerts.js';

const NOW = 1_800_000_000_000;
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const publicKey = ecdh.getPublicKey().toString('base64url'), privateKey = ecdh.getPrivateKey().toString('base64url');
const keys = { p256dh: publicKey, auth: Buffer.alloc(16, 3).toString('base64url') };
const subscription = (suffix = 'rider') => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`, keys });
const request = (method, uid = 'rider', body) => ({ method, headers: uid ? { authorization: `Bearer ${uid}` } : {}, body });
async function invoke(handler, req) {
  const headers = {}; let text;
  const res = { statusCode: 0, setHeader(name, value) { headers[name] = value; }, end(value) { text = value; } };
  await handler(req, res);
  return { status: res.statusCode, headers, body: JSON.parse(text) };
}
function fixture() {
  const f = {
    users: new Map([
      ['customer', { role: 'customer', accountStatus: 'active' }],
      ['merchant', { role: 'merchant', accountStatus: 'active' }],
      ['rider', { role: 'rider', accountStatus: 'active', approvalStatus: 'approved', online: true }],
    ]),
    orders: new Map([['order', { creatorId: 'customer', createdBy: 'customer', creatorRole: 'customer', merchantId: '',
      status: 'pending', riderId: null, createdAt: new Date(NOW - 1000), preferredRiderId: '',
      customerName: 'PRIVATE_NAME', phone: 'PRIVATE_PHONE', pickup: 'PRIVATE_ADDRESS' }]]),
    riders: [{ uid: 'rider', accountStatus: 'active', approvalStatus: 'approved', online: true }],
    subscriptions: new Map([[subscription().endpoint, { uid: 'rider', ...subscription() }]]),
    stores: new Map(), members: new Map(), invites: new Map(), dispatches: new Map(), sent: [], deleted: [],
  };
  f.store = {
    getUser: async uid => f.users.get(uid) ?? null,
    getOrder: async id => f.orders.get(id) ?? null,
    getStore: async id => f.stores.get(id) ?? null,
    getStoreMember: async (id, uid) => f.members.get(`${id}_${uid}`) ?? null,
    getStoreInvite: async id => f.invites.get(id) ?? null,
    listOnlineRiders: async () => [...f.riders],
    listSubscriptions: async uid => [...f.subscriptions.values()].filter(sub => sub.uid === uid),
    saveSubscription: async (uid, sub) => { f.subscriptions.set(sub.endpoint, { uid, ...sub }); },
    deleteSubscription: async (uid, url) => { if (f.subscriptions.get(url)?.uid === uid) { f.subscriptions.delete(url); f.deleted.push(url); } },
    claimDispatch: async (id, leaseId, now) => {
      const existing = f.dispatches.get(id);
      if (existing?.status === 'complete' || existing?.leaseUntil > now) return false;
      f.dispatches.set(id, { leaseId, leaseUntil: now + 60_000, status: 'sending' }); return true;
    },
    completeDispatch: async (id, leaseId) => { if (f.dispatches.get(id)?.leaseId === leaseId) f.dispatches.get(id).status = 'complete'; },
  };
  f.verifyToken = async token => { if (['revoked', 'disabled'].includes(token)) throw new Error('PRIVATE_TOKEN_ERROR'); return { uid: token }; };
  f.sendPush = async (...args) => { f.sent.push(args); };
  f.service = createRiderAlertsService({ verifyToken: f.verifyToken, store: f.store, sendPush: (...args) => f.sendPush(...args), publicKey, privateKey, now: () => NOW });
  f.handler = createRiderAlertsMiddleware({ service: f.service });
  f.dispatch = (uid = 'customer') => f.service.handle(request('POST', uid), { action: 'dispatch', orderId: 'order' });
  return f;
}
function addRider(f, uid, profile = {}, publicProfile = {}) {
  f.users.set(uid, { role: 'rider', accountStatus: 'active', approvalStatus: 'approved', online: true, ...profile });
  f.riders.push({ uid, accountStatus: 'active', approvalStatus: 'approved', online: true, ...publicProfile });
  f.subscriptions.set(subscription(uid).endpoint, { uid, ...subscription(uid) });
}
const addMerchant = f => f.stores.set('merchant', { ownerId: 'merchant', accountStatus: 'active', approvalStatus: 'approved' });

test('API starts without credentials and rejects unauthenticated requests and unsupported methods', async () => {
  for (const method of ['GET', 'POST', 'DELETE']) {
    const result = await invoke(endpointHandler, request(method, null, {}));
    assert.equal(result.status, 401); assert.equal(result.headers['Cache-Control'], 'private, no-store'); assert.deepEqual(Object.keys(result.body), ['message']);
  }
  assert.equal((await invoke(endpointHandler, request('PUT', null))).status, 405);
});
test('revoked and disabled tokens fail without disclosing token errors', async () => {
  const f = fixture();
  for (const uid of ['revoked', 'disabled']) { const result = await invoke(f.handler, request('GET', uid)); assert.equal(result.status, 401); assert.ok(!JSON.stringify(result).includes('PRIVATE_TOKEN_ERROR')); }
});
test('document-safe custom Firebase UIDs work and path-injected identities fail', async () => {
  const f = fixture(); f.users.set('rider:custom', { ...f.users.get('rider') });
  assert.deepEqual(await f.service.handle(request('GET', 'rider:custom')), { publicKey });
  await assert.rejects(f.service.handle(request('GET', 'bad/path')), error => error.status === 401);
});
test('only approved active riders get the public key; offline approved riders can subscribe', async () => {
  const f = fixture(); assert.deepEqual(await f.service.handle(request('GET')), { publicKey });
  f.users.get('rider').online = false;
  assert.deepEqual(await f.service.handle(request('POST'), { action: 'subscribe', subscription: subscription('offline') }), { ok: true });
  assert.equal(f.subscriptions.get(subscription('offline').endpoint).uid, 'rider');
  for (const profile of [{ role: 'customer' }, { role: 'rider', approvalStatus: 'pending' }, { role: 'rider', approvalStatus: 'approved', accountStatus: 'blocked' }]) {
    f.users.set('rider', profile);
    await assert.rejects(f.service.handle(request('GET')), error => error.status === 403);
    await assert.rejects(f.service.handle(request('POST'), { action: 'subscribe', subscription: subscription() }), error => error.status === 403);
  }
});
test('subscriptions allow known providers, normal HTTPS port and padded base64 keys', () => {
  for (const url of ['https://fcm.googleapis.com:443/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Qx', 'https://wns2-db3p.notify.windows.com/w/?token=x']) assert.ok(validatePushEndpoint(url));
  assert.deepEqual(validatePushSubscription({ ...subscription(), expirationTime: null, keys: {
    p256dh: Buffer.from(publicKey, 'base64url').toString('base64'), auth: Buffer.alloc(16, 3).toString('base64'),
  } }).keys, keys);
});
test('subscription validation rejects SSRF, credentials, ports, malformed keys and injected ownership', async () => {
  for (const url of ['http://fcm.googleapis.com/fcm/send/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x',
    'https://evil.notify.windows.com.evil.example/x', 'https://user:password@fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com:444/x', 'https://fcm.googleapis.com/x#secret', 'https://fcm.googleapis.com/']) assert.throws(() => validatePushEndpoint(url), error => error.status === 400);
  for (const bad of [null, { ...subscription(), uid: 'someone' }, { ...subscription(), keys: { ...keys, auth: 'short' } },
    { ...subscription(), keys: { ...keys, p256dh: Buffer.alloc(65).toString('base64url') } }, { ...subscription(), keys: { ...keys, extra: 'x' } }, { ...subscription(), expirationTime: 'tomorrow' }]) assert.throws(() => validatePushSubscription(bad), error => error.status === 400);
  const f = fixture(), result = await invoke(f.handler, request('POST', 'rider', { action: 'subscribe', subscription: subscription('new'), uid: 'customer' }));
  assert.equal(result.status, 400); assert.ok(!f.subscriptions.has(subscription('new').endpoint));
});
test('blocked riders can unsubscribe only their own endpoint', async () => {
  const f = fixture(); addRider(f, 'other'); f.users.get('rider').accountStatus = 'blocked';
  assert.deepEqual(await f.service.handle(request('DELETE'), { endpoint: subscription('other').endpoint }), { ok: true }); assert.ok(f.subscriptions.has(subscription('other').endpoint));
  await f.service.handle(request('DELETE'), { endpoint: subscription().endpoint }); assert.ok(!f.subscriptions.has(subscription().endpoint));
});
test('dispatch filters offline, unapproved, blocked and mismatched rider profiles', async () => {
  const f = fixture(); addRider(f, 'offline', { online: false }); addRider(f, 'pending', { approvalStatus: 'pending' }); addRider(f, 'blocked', { accountStatus: 'blocked' });
  addRider(f, 'wrongrole', { role: 'customer' }); addRider(f, 'publicoffline', {}, { online: false }); addRider(f, 'publicpending', {}, { approvalStatus: 'pending' });
  assert.deepEqual(await f.dispatch(), { ok: true }); assert.equal(f.sent.length, 1); assert.equal(f.sent[0][0].endpoint, subscription().endpoint);
});
test('preferred-rider dispatch uses a generic payload and never exposes subscription or private order data', async () => {
  const f = fixture(); addRider(f, 'preferred'); f.orders.get('order').preferredRiderId = 'preferred';
  const result = await f.dispatch(); assert.deepEqual(result, { ok: true }); assert.equal(f.sent.length, 1);
  const [sub, payload, options] = f.sent[0]; assert.equal(sub.endpoint, subscription('preferred').endpoint);
  assert.deepEqual(JSON.parse(payload), { type: 'new-rider-request', orderId: 'order', title: 'New delivery request', body: 'A new delivery request is waiting. Open KyeTech to view it.', url: '/?rider-request=order' });
  assert.ok(!payload.includes('PRIVATE_')); assert.equal(options.TTL, 300); assert.equal(options.urgency, 'high'); assert.equal(options.timeout, 8000);
  assert.ok(!JSON.stringify(result).includes('endpoint')); assert.ok(!JSON.stringify(result).includes(privateKey));
});
test('concurrent and repeated dispatch requests deliver each order once', async () => {
  const f = fixture(); await Promise.all([f.dispatch(), f.dispatch()]); await f.dispatch(); assert.equal(f.sent.length, 1); assert.equal(f.dispatches.get('order').status, 'complete');
});
test('customer pickup orders allow approved active selected stores and reject unavailable stores', async () => {
  const f = fixture(); addMerchant(f); f.orders.get('order').merchantId = 'merchant'; f.stores.get('merchant').approvalStatus = 'pending';
  await assert.rejects(f.dispatch(), error => error.status === 403); f.stores.get('merchant').approvalStatus = 'approved'; f.stores.get('merchant').accountStatus = 'blocked';
  await assert.rejects(f.dispatch(), error => error.status === 403); f.stores.get('merchant').accountStatus = 'active';
  assert.deepEqual(await f.dispatch(), { ok: true }); assert.equal(f.sent.length, 1);
});
test('only the active actual creator can dispatch recent pending unassigned orders', async () => {
  const f = fixture(); await assert.rejects(f.dispatch('merchant'), error => error.status === 403); await assert.rejects(f.dispatch('rider'), error => error.status === 403);
  f.users.get('customer').accountStatus = 'blocked'; await assert.rejects(f.dispatch(), error => error.status === 403); f.users.get('customer').accountStatus = 'active';
  for (const mutation of [{ createdAt: new Date(NOW - 300_000) }, { createdAt: null }, { status: 'accepted' }, { riderId: 'rider' }]) {
    const original = { ...f.orders.get('order') }; Object.assign(f.orders.get('order'), mutation); await assert.rejects(f.dispatch(), error => error.status === 409); f.orders.set('order', original);
  }
  assert.equal(f.sent.length, 0);
});
test('order closure or rider going offline during fanout suppresses push', async () => {
  for (const change of ['order', 'rider']) {
    const f = fixture(), list = f.store.listSubscriptions;
    f.store.listSubscriptions = async uid => { if (change === 'order') f.orders.get('order').status = 'accepted'; else f.users.get('rider').online = false; return list(uid); };
    await f.dispatch(); assert.equal(f.sent.length, 0);
  }
});
test('expired subscriptions are removed; other push failures preserve subscriptions and saved orders', async () => {
  const f = fixture(); for (const suffix of ['gone404', 'gone410', 'failed500']) f.subscriptions.set(subscription(suffix).endpoint, { uid: 'rider', ...subscription(suffix) });
  f.sendPush = async sub => {
    if (sub.endpoint.endsWith('gone404')) throw Object.assign(new Error('expired'), { statusCode: 404 });
    if (sub.endpoint.endsWith('gone410')) throw Object.assign(new Error('expired'), { statusCode: 410 });
    if (sub.endpoint.endsWith('failed500')) throw Object.assign(new Error('provider unavailable'), { statusCode: 500 });
    f.sent.push(sub);
  };
  assert.deepEqual(await f.dispatch(), { ok: true }); assert.equal(f.sent.length, 1); assert.equal(f.deleted.length, 2); assert.ok(f.subscriptions.has(subscription('failed500').endpoint)); assert.ok(f.orders.has('order'));
});
test('merchant team dispatch requires merchant role, enabled membership, accepted invite and active approved store', async () => {
  const f = fixture(); f.users.set('team', { role: 'merchant', accountStatus: 'active' }); addMerchant(f);
  f.orders.set('order', { ...f.orders.get('order'), creatorId: 'merchant', createdBy: 'team', creatorRole: 'merchant', merchantId: 'merchant' });
  const inviteId = 'i'.repeat(256); f.members.set('merchant_team', { storeId: 'merchant', userId: 'team', enabled: true, inviteId });
  f.invites.set(inviteId, { storeId: 'merchant', ownerId: 'merchant', memberId: 'team', status: 'accepted' });
  f.users.get('team').role = 'customer'; await assert.rejects(f.dispatch('team'), error => error.status === 403); f.users.get('team').role = 'merchant'; f.members.get('merchant_team').enabled = false;
  await assert.rejects(f.dispatch('team'), error => error.status === 403); f.members.get('merchant_team').enabled = true; f.invites.get(inviteId).status = 'pending';
  await assert.rejects(f.dispatch('team'), error => error.status === 403); f.invites.get(inviteId).status = 'accepted'; f.users.get('merchant').accountStatus = 'blocked';
  await assert.rejects(f.dispatch('team'), error => error.status === 403); f.users.get('merchant').accountStatus = 'active'; f.stores.get('merchant').approvalStatus = 'pending';
  await assert.rejects(f.dispatch('team'), error => error.status === 403); f.stores.get('merchant').approvalStatus = 'approved';
  assert.deepEqual(await f.dispatch('team'), { ok: true }); assert.equal(f.sent.length, 1);
});
test('merchant owner accounts with document-safe custom UIDs can dispatch', async () => {
  const f = fixture(), uid = 'merchant:owner'; f.users.set(uid, { role: 'merchant', accountStatus: 'active' }); f.stores.set(uid, { ownerId: uid, accountStatus: 'active', approvalStatus: 'approved' });
  f.orders.set('order', { ...f.orders.get('order'), creatorId: uid, createdBy: uid, creatorRole: 'merchant', merchantId: uid }); assert.deepEqual(await f.dispatch(uid), { ok: true }); assert.equal(f.sent.length, 1);
});
test('malformed and oversized bodies return clean errors; streamed JSON works', async () => {
  const f = fixture(); assert.equal((await invoke(f.handler, request('POST', 'rider', '{bad json'))).status, 400);
  assert.equal((await invoke(f.handler, request('POST', 'rider', JSON.stringify({ value: 'x'.repeat(65_536) })))).status, 413);
  const streamed = Readable.from([JSON.stringify({ action: 'subscribe', subscription: subscription('streamed') })]); Object.assign(streamed, { method: 'POST', headers: { authorization: 'Bearer rider' } });
  assert.equal((await invoke(f.handler, streamed)).status, 200);
});
test('configuration and storage errors never expose credentials or endpoints', async () => {
  const f = fixture(), missingKeys = createRiderAlertsMiddleware({ store: f.store, verifyToken: f.verifyToken }); assert.equal((await invoke(missingKeys, request('GET'))).status, 503);
  f.store.getUser = async () => { throw new Error(`PRIVATE_CREDENTIAL ${privateKey} ${subscription().endpoint}`); };
  const result = await invoke(f.handler, request('GET')); assert.equal(result.status, 503); assert.ok(!JSON.stringify(result).includes('PRIVATE_')); assert.ok(!JSON.stringify(result).includes(privateKey));
});
test('Firestore dispatch leases and subscription deletion enforce transaction ownership', async () => {
  const docs = new Map(); let queue = Promise.resolve();
  const snapshot = ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) });
  const firestore = { doc: path => ({ path }), runTransaction(work) {
    const result = queue.then(() => work({ get: async ref => snapshot(ref), set: (ref, value) => docs.set(ref.path, value), update: (ref, value) => docs.set(ref.path, { ...docs.get(ref.path), ...value }), delete: ref => docs.delete(ref.path) }));
    queue = result.then(() => {}, () => {}); return result;
  } };
  const store = createFirebaseRiderAlertsStore(firestore); assert.equal(await store.claimDispatch('order', 'lease1', NOW), true); assert.equal(await store.claimDispatch('order', 'lease2', NOW), false);
  assert.equal(await store.claimDispatch('order', 'lease2', NOW + 60_001), true); await store.completeDispatch('order', 'lease1', NOW + 60_002); assert.equal(docs.get('riderPushDispatches/order').status, 'sending');
  await store.completeDispatch('order', 'lease2', NOW + 60_003); assert.equal(await store.claimDispatch('order', 'lease3', NOW + 120_000), false);
  const url = subscription().endpoint, path = `riderPushSubscriptions/${riderPushSubscriptionId(url)}`; docs.set(path, { uid: 'other', endpoint: url });
  await store.deleteSubscription('rider', url); assert.ok(docs.has(path)); await store.deleteSubscription('other', url); assert.ok(!docs.has(path));
});
