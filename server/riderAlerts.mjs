import { createHash, randomUUID } from 'node:crypto';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { sendNotification } from 'web-push';

export class RiderAlertsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new RiderAlertsError(status, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const active = profile => object(profile) && (profile.accountStatus || 'active') === 'active';
const approvedRider = (profile, online = false) => active(profile) && profile.role === 'rider' && profile.approvalStatus === 'approved' && (!online || profile.online === true);
const validId = (value, limit = 128) => typeof value === 'string' && value.length <= limit && /^[A-Za-z0-9_-]+$/.test(value);
const validUid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/') && value !== '.' && value !== '..';
function base64Key(value, length, publicKey = false) {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const normalized = value.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const bytes = Buffer.from(normalized, 'base64url');
  return bytes.length === length && bytes.toString('base64url') === normalized && (!publicKey || bytes[0] === 4) ? normalized : null;
}
export function validatePushEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 4096 || endpoint.trim() !== endpoint) fail(400, 'Invalid push subscription.');
  let url; try { url = new URL(endpoint); } catch { fail(400, 'Invalid push subscription.'); }
  const providers = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  const microsoft = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.notify\.windows\.com$/.test(url.hostname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || (!providers.includes(url.hostname) && !microsoft) || url.pathname === '/') fail(400, 'Invalid push subscription.');
  return url.href;
}
export function validatePushSubscription(subscription) {
  if (!exactKeys(subscription, ['endpoint', 'keys', 'expirationTime']) || !exactKeys(subscription.keys, ['p256dh', 'auth']) || (subscription.expirationTime != null && (!Number.isFinite(subscription.expirationTime) || subscription.expirationTime < 0))) fail(400, 'Invalid push subscription.');
  const p256dh = base64Key(subscription.keys.p256dh, 65, true), auth = base64Key(subscription.keys.auth, 16);
  if (!p256dh || !auth) fail(400, 'Invalid push subscription.');
  return { endpoint: validatePushEndpoint(subscription.endpoint), keys: { p256dh, auth } };
}
export const riderPushSubscriptionId = endpoint => createHash('sha256').update(endpoint).digest('hex');
const timestampMs = value => value instanceof Date ? value.getTime() : typeof value?.toMillis === 'function' ? value.toMillis() : typeof value === 'number' ? value : NaN;
function dispatchable(order, now) {
  const created = timestampMs(order?.createdAt);
  return object(order) && order.status === 'pending' && !order.riderId && Number.isFinite(created) && now - created < 300000 && created <= now + 30000;
}
function bearerToken(request) {
  const match = /^Bearer ([^\s]+)$/i.exec(request.headers?.authorization || '');
  if (!match || match[1].length > 16384) fail(401, 'Sign in to use rider alerts.');
  return match[1];
}
export function createFirebaseRiderAlertsRuntime({ projectId, serviceAccountJson } = {}) {
  if (typeof projectId !== 'string' || !projectId.trim()) fail(503, 'Rider alerts are temporarily unavailable.');
  try {
    let credential;
    if (serviceAccountJson?.trim()) {
      const account = JSON.parse(serviceAccountJson);
      if (account.project_id !== projectId || typeof account.client_email !== 'string' || typeof account.private_key !== 'string') throw new Error();
      credential = cert(account);
    } else credential = applicationDefault();
    const name = 'kyetech-rider-alerts-' + projectId;
    const app = getApps().find(candidate => candidate.name === name) || initializeApp({ projectId, credential }, name);
    return { auth: getAuth(app), firestore: getFirestore(app) };
  } catch { fail(503, 'Rider alerts are temporarily unavailable.'); }
}
export function createFirebaseRiderAlertsStore(firestore) {
  const read = async path => { const snapshot = await firestore.doc(path).get(); return snapshot.exists ? snapshot.data() : null; };
  return {
    getUser: uid => read('users/' + uid), getOrder: id => read('orders/' + id), getStore: id => read('stores/' + id),
    getStoreMember: (id, uid) => read('storeMembers/' + id + '_' + uid), getStoreInvite: id => read('storeInvites/' + id),
    async listOnlineRiders() { const snapshot = await firestore.collection('riders').where('online', '==', true).get(); return snapshot.docs.map(doc => ({ ...doc.data(), uid: doc.id })); },
    async listSubscriptions(uid) { const snapshot = await firestore.collection('riderPushSubscriptions').where('uid', '==', uid).get(); return snapshot.docs.map(doc => doc.data()); },
    async saveSubscription(uid, subscription, now) { await firestore.doc('riderPushSubscriptions/' + riderPushSubscriptionId(subscription.endpoint)).set({ uid, ...subscription, updatedAt: new Date(now) }); },
    async deleteSubscription(uid, endpoint) {
      const ref = firestore.doc('riderPushSubscriptions/' + riderPushSubscriptionId(endpoint));
      await firestore.runTransaction(async transaction => { const snapshot = await transaction.get(ref); if (snapshot.exists && snapshot.data().uid === uid) transaction.delete(ref); });
    },
    async claimDispatch(orderId, leaseId, now) {
      const ref = firestore.doc('riderPushDispatches/' + orderId);
      return firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref), previous = snapshot.exists ? snapshot.data() : {};
        if (previous.status === 'complete' || previous.leaseUntil > now) return false;
        transaction.set(ref, { status: 'sending', leaseId, leaseUntil: now + 60000, createdAt: previous.createdAt || new Date(now) }); return true;
      });
    },
    async completeDispatch(orderId, leaseId, now) {
      const ref = firestore.doc('riderPushDispatches/' + orderId);
      await firestore.runTransaction(async transaction => { const snapshot = await transaction.get(ref); if (snapshot.exists && snapshot.data().leaseId === leaseId) transaction.update(ref, { status: 'complete', leaseUntil: null, completedAt: new Date(now) }); });
    },
  };
}
export function createRiderAlertsService({ verifyToken, store, sendPush = sendNotification, publicKey, privateKey, subject = 'https://kyetechdelivery.site', now = Date.now } = {}) {
  function configured() {
    const pub = base64Key(publicKey, 65, true), priv = base64Key(privateKey, 32);
    if (!pub || !priv || typeof subject !== 'string' || !/^(https:\/\/|mailto:)/.test(subject)) fail(503, 'Rider alerts are temporarily unavailable.');
    return { subject, publicKey: pub, privateKey: priv };
  }
  async function authenticate(request) {
    const token = bearerToken(request); let identity;
    try { identity = await verifyToken(token); } catch { fail(401, 'Sign in again to use rider alerts.'); }
    if (!validUid(identity?.uid)) fail(401, 'Sign in again to use rider alerts.');
    return { uid: identity.uid, profile: await store.getUser(identity.uid) };
  }
  async function authorizeCreator(actor, order) {
    if (!active(actor.profile) || !['customer', 'merchant'].includes(actor.profile.role) || (order.createdBy || order.creatorId) !== actor.uid || order.creatorRole !== actor.profile.role) fail(403, 'You cannot send alerts for this order.');
    if (order.creatorRole === 'customer') {
      if (order.creatorId !== actor.uid) fail(403, 'You cannot send alerts for this order.');
      if (order.merchantId) {
        if (!validUid(order.merchantId)) fail(403, 'You cannot send alerts for this order.');
        const pickupStore = await store.getStore(order.merchantId);
        if (!active(pickupStore) || pickupStore.approvalStatus !== 'approved') fail(403, 'You cannot send alerts for this order.');
      }
      return;
    }
    const storeId = order.merchantId;
    if (!validUid(storeId) || order.creatorId !== storeId) fail(403, 'You cannot send alerts for this order.');
    const [merchant, owner] = await Promise.all([store.getStore(storeId), store.getUser(storeId)]);
    if (!active(merchant) || merchant.approvalStatus !== 'approved' || merchant.ownerId !== storeId || !active(owner) || owner.role !== 'merchant') fail(403, 'You cannot send alerts for this order.');
    if (actor.uid === storeId) return;
    const member = await store.getStoreMember(storeId, actor.uid);
    if (member?.enabled !== true || member.storeId !== storeId || member.userId !== actor.uid || !validId(member.inviteId, 256)) fail(403, 'You cannot send alerts for this order.');
    const invite = await store.getStoreInvite(member.inviteId);
    if (invite?.status !== 'accepted' || invite.storeId !== storeId || invite.ownerId !== storeId || invite.memberId !== actor.uid) fail(403, 'You cannot send alerts for this order.');
  }
  async function dispatch(actor, orderId) {
    if (!validId(orderId)) fail(400, 'Invalid delivery request.');
    const order = await store.getOrder(orderId);
    if (!order) fail(404, 'Delivery request not found.');
    await authorizeCreator(actor, order);
    if (!dispatchable(order, now())) fail(409, 'This delivery request is no longer available for alerts.');
    const vapidDetails = configured(), leaseId = randomUUID();
    if (!await store.claimDispatch(orderId, leaseId, now())) return { ok: true };
    const payload = JSON.stringify({ type: 'new-rider-request', orderId, title: 'New delivery request', body: 'A new delivery request is waiting. Open KyeTech to view it.', url: '/?rider-request=' + encodeURIComponent(orderId) });
    const riders = (await store.listOnlineRiders()).filter(rider => active(rider) && rider.approvalStatus === 'approved' && rider.online === true && (!order.preferredRiderId || order.preferredRiderId === rider.uid)), queue = [...riders];
    async function worker() {
      while (queue.length) {
        const rider = queue.shift(), subscriptions = await store.listSubscriptions(rider.uid);
        for (const saved of subscriptions) {
          const [latest, profile] = await Promise.all([store.getOrder(orderId), store.getUser(rider.uid)]);
          if (!dispatchable(latest, now()) || !approvedRider(profile, true) || (latest.preferredRiderId && latest.preferredRiderId !== rider.uid)) continue;
          let subscription; try { subscription = validatePushSubscription({ endpoint: saved.endpoint, keys: saved.keys }); } catch { continue; }
          try { await sendPush(subscription, payload, { TTL: 300, urgency: 'high', timeout: 8000, vapidDetails }); }
          catch (error) { if ([404, 410].includes(error?.statusCode)) { try { await store.deleteSubscription(rider.uid, saved.endpoint); } catch { /* Retry expired-device cleanup later. */ } } }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, riders.length) }, worker));
    await store.completeDispatch(orderId, leaseId, now()); return { ok: true };
  }
  return { async handle(request, body = {}) {
    const actor = await authenticate(request);
    if (request.method === 'GET') { if (!approvedRider(actor.profile)) fail(403, 'Only approved riders can enable rider alerts.'); return { publicKey: configured().publicKey }; }
    if (!object(body)) fail(400, 'Invalid rider alerts request.');
    if (request.method === 'DELETE') { if (!exactKeys(body, ['endpoint']) || typeof body.endpoint !== 'string' || !body.endpoint || body.endpoint.length > 4096) fail(400, 'Invalid push subscription.'); await store.deleteSubscription(actor.uid, body.endpoint); return { ok: true }; }
    if (body.action === 'subscribe') { if (!exactKeys(body, ['action', 'subscription'])) fail(400, 'Invalid push subscription.'); if (!approvedRider(actor.profile)) fail(403, 'Only approved riders can enable rider alerts.'); configured(); await store.saveSubscription(actor.uid, validatePushSubscription(body.subscription), now()); return { ok: true }; }
    if (body.action === 'dispatch') { if (!exactKeys(body, ['action', 'orderId'])) fail(400, 'Invalid delivery request.'); return dispatch(actor, body.orderId); }
    fail(400, 'Invalid rider alerts request.');
  } };
}
async function readBody(request) {
  let body = request.body;
  if (body === undefined) { let raw = ''; for await (const chunk of request) { raw += chunk.toString('utf8'); if (Buffer.byteLength(raw) > 65536) fail(413, 'Request is too large.'); } body = raw; }
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') { if (Buffer.byteLength(body) > 65536) fail(413, 'Request is too large.'); try { body = JSON.parse(body); } catch { fail(400, 'Invalid rider alerts request.'); } }
  if (!object(body)) fail(400, 'Invalid rider alerts request.');
  if (Buffer.byteLength(JSON.stringify(body)) > 65536) fail(413, 'Request is too large.');
  return body;
}
export function createRiderAlertsMiddleware(options = {}) {
  let service = options.service;
  function getService() {
    if (!service) { const runtime = options.store && options.verifyToken ? null : createFirebaseRiderAlertsRuntime(options); service = createRiderAlertsService({ ...options, store: options.store || createFirebaseRiderAlertsStore(runtime.firestore), verifyToken: options.verifyToken || (token => runtime.auth.verifyIdToken(token, true)) }); }
    return service;
  }
  return async (request, response) => {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Allow', 'GET, POST, DELETE');
    try {
      if (!['GET', 'POST', 'DELETE'].includes(request.method)) fail(405, 'Use GET, POST or DELETE for rider alerts.');
      bearerToken(request);
      const body = request.method === 'GET' ? {} : await readBody(request);
      const result = await getService().handle(request, body); response.statusCode = 200; response.end(JSON.stringify(result));
    } catch (error) { response.statusCode = error instanceof RiderAlertsError ? error.status : 503; response.end(JSON.stringify({ message: error instanceof RiderAlertsError ? error.message : 'Rider alerts are temporarily unavailable. Please try again.' })); }
  };
}
