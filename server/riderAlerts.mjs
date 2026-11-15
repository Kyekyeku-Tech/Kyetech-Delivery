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
const validId = (value, limit = 128) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[^A-Za-z0-9_-]/.test(value);
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
export const riderPushVapidKeyId = publicKey => createHash('sha256').update(publicKey).digest('hex');
function pushFailure(error) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : null;
  if (statusCode === 404 || statusCode === 410) return { kind: 'expired', statusCode };
  if (statusCode === 401 || statusCode === 403) return { kind: 'requiresResubscribe', statusCode };
  const transient = statusCode === 429 || (statusCode >= 500 && statusCode <= 599)
    || ['ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED'].includes(error?.code)
    || ['AbortError', 'TimeoutError'].includes(error?.name) || error?.message === 'Socket timeout';
  return { kind: transient ? 'retryable' : 'rejected', statusCode };
}
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
    getSubscriptionById: id => read('riderPushSubscriptions/' + id),
    async saveSubscription(uid, subscription, now, vapidKeyId) { await firestore.doc('riderPushSubscriptions/' + riderPushSubscriptionId(subscription.endpoint)).set({ uid, ...subscription, vapidKeyId, status: 'active', updatedAt: new Date(now) }); },
    async markRequiresResubscribe(uid, endpoint, now) {
      const ref = firestore.doc('riderPushSubscriptions/' + riderPushSubscriptionId(endpoint));
      await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (snapshot.exists && snapshot.data().uid === uid) transaction.update(ref, { status: 'requiresResubscribe', updatedAt: new Date(now) });
      });
    },
    async deleteSubscription(uid, endpoint) {
      const ref = firestore.doc('riderPushSubscriptions/' + riderPushSubscriptionId(endpoint));
      await firestore.runTransaction(async transaction => { const snapshot = await transaction.get(ref); if (snapshot.exists && snapshot.data().uid === uid) transaction.delete(ref); });
    },
    async claimDispatch(orderId, leaseId, now) {
      const ref = firestore.doc('riderPushDispatches/' + orderId);
      return firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref), previous = snapshot.exists ? snapshot.data() : {};
        if (previous.status === 'complete' || previous.leaseUntil > now) return false;
        const acceptedIds = Array.isArray(previous.acceptedIds) ? [...new Set(previous.acceptedIds.filter(id => typeof id === 'string' && id.length === 64 && !/[^a-f0-9]/.test(id)))] : [];
        transaction.set(ref, { ...previous, status: 'sending', leaseId, leaseUntil: now + 60000, acceptedIds, createdAt: previous.createdAt ?? new Date(now), updatedAt: new Date(now) }); return { acceptedIds };
      });
    },
    async recordAccepted(orderId, leaseId, subscriptionId, now) {
      const ref = firestore.doc('riderPushDispatches/' + orderId);
      await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists || snapshot.data().leaseId !== leaseId || snapshot.data().status !== 'sending') return;
        const previous = snapshot.data();
        transaction.update(ref, { acceptedIds: [...new Set([...(previous.acceptedIds ?? []), subscriptionId])], updatedAt: new Date(now) });
      });
    },
    async completeDispatch(orderId, leaseId, now, outcome) {
      const ref = firestore.doc('riderPushDispatches/' + orderId);
      await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists || snapshot.data().leaseId !== leaseId) return;
        const needsRetry = outcome.retryableFailures > 0 || outcome.rejected > 0;
        const status = needsRetry ? 'retryable' : outcome.requiresResubscribe > 0 ? 'requiresResubscribe' : 'complete';
        transaction.update(ref, { status, leaseUntil: null, completedAt: status === 'complete' ? new Date(now) : null, lastOutcome: outcome, updatedAt: new Date(now) });
      });
    },
  };
}
export function createRiderAlertsService({ verifyToken, store, sendPush = sendNotification, publicKey, privateKey, subject = 'https://kyetechdelivery.site', now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), logger = entry => console.info('[rider-alerts]', entry) } = {}) {
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
    const vapidDetails = configured(), vapidKeyId = riderPushVapidKeyId(vapidDetails.publicKey), leaseId = randomUUID();
    const claim = await store.claimDispatch(orderId, leaseId, now());
    if (!claim) return { ok: true };
    const deadline = now() + 40000;
    const acceptedIds = new Set(claim.acceptedIds ?? []);
    const outcome = { eligibleRiders: 0, attempted: 0, attempts: 0, accepted: 0, alreadyAccepted: 0,
      expired: 0, requiresResubscribe: 0, retryableFailures: 0, rejected: 0, skipped: 0, statusCodes: {} };
    function noteStatus(statusCode) {
      if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) outcome.statusCodes[statusCode] = (outcome.statusCodes[statusCode] ?? 0) + 1;
    }
    function report(status) {
      try { logger({ event: 'rider_push_dispatch', status, ...outcome }); } catch { /* Logging must not affect delivery. */ }
    }
    async function flagSubscription(rider, saved) {
      try { await store.markRequiresResubscribe(rider.uid, saved.endpoint, now()); }
      catch { outcome.retryableFailures++; }
    }
    const payload = JSON.stringify({ type: 'new-rider-request', orderId, title: 'New delivery alert',
      body: 'A new delivery request is waiting. Open KyeTech Delivery to review it.', url: '/?rider-request=' + encodeURIComponent(orderId) });
    try {
      const riders = (await store.listOnlineRiders()).filter(rider => active(rider)
        && rider.approvalStatus === 'approved' && rider.online === true
        && (!order.preferredRiderId || order.preferredRiderId === rider.uid));
      outcome.eligibleRiders = riders.length;
      const queue = [...riders];
      async function worker() {
        while (queue.length) {
          if (now() >= deadline) { outcome.retryableFailures++; return; }
          const rider = queue.shift(), subscriptions = await store.listSubscriptions(rider.uid);
          for (const saved of subscriptions) {
            if (now() >= deadline) { outcome.retryableFailures++; return; }
            const subscriptionId = typeof saved.endpoint === 'string' ? riderPushSubscriptionId(saved.endpoint) : null;
            if (subscriptionId && acceptedIds.has(subscriptionId)) { outcome.alreadyAccepted++; continue; }
            if (saved.status === 'requiresResubscribe' || (saved.vapidKeyId && saved.vapidKeyId !== vapidKeyId)) {
              outcome.requiresResubscribe++; await flagSubscription(rider, saved); continue;
            }
            let subscription;
            try { subscription = validatePushSubscription({ endpoint: saved.endpoint, keys: saved.keys }); }
            catch { outcome.requiresResubscribe++; await flagSubscription(rider, saved); continue; }
            let countedAttempt = false;
            for (let attempt = 0; attempt < 2; attempt++) {
              const [latestOrder, currentUser] = await Promise.all([store.getOrder(orderId), store.getUser(rider.uid)]);
              if (now() >= deadline) { outcome.retryableFailures++; break; }
              if (!dispatchable(latestOrder, now()) || !approvedRider(currentUser, true)
                || (latestOrder.preferredRiderId && latestOrder.preferredRiderId !== rider.uid)) {
                outcome.skipped++; break;
              }
              if (!countedAttempt) { outcome.attempted++; countedAttempt = true; }
              outcome.attempts++;
              let result;
              try { result = await sendPush(subscription, payload, { TTL: 300, urgency: 'high', timeout: 8000, vapidDetails }); }
              catch (error) {
                const failure = pushFailure(error); noteStatus(failure.statusCode);
                if (failure.kind === 'expired') {
                  outcome.expired++;
                  try { await store.deleteSubscription(rider.uid, saved.endpoint); }
                  catch { outcome.retryableFailures++; }
                  break;
                }
                if (failure.kind === 'requiresResubscribe') {
                  outcome.requiresResubscribe++; await flagSubscription(rider, saved); break;
                }
                if (failure.kind === 'retryable' && attempt === 0) { await sleep(250); continue; }
                if (failure.kind === 'retryable') outcome.retryableFailures++;
                else outcome.rejected++;
                break;
              }
              noteStatus(result?.statusCode);
              acceptedIds.add(subscriptionId); outcome.accepted++;
              await store.recordAccepted(orderId, leaseId, subscriptionId, now());
              break;
            }
          }
        }
      }
      // Keep the function alive until every provider send and acceptance write finishes.
      const workers = await Promise.allSettled(Array.from({ length: Math.min(4, riders.length) }, worker));
      const failed = workers.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      await store.completeDispatch(orderId, leaseId, now(), outcome);
      report(outcome.retryableFailures || outcome.rejected ? 'retryable' : outcome.requiresResubscribe ? 'requiresResubscribe' : 'complete');
      return { ok: true };
    } catch (error) { report('storage-error'); throw error; }
  }
  return { async handle(request, body = {}) {
    const actor = await authenticate(request);
    if (request.method === 'GET') {
      if (!approvedRider(actor.profile)) fail(403, 'Only approved riders can enable rider alerts.');
      const currentPublicKey = configured().publicKey;
      let subscriptionId = request.query?.subscriptionId;
      if (subscriptionId === undefined && typeof request.url === 'string') {
        let url;
        try { url = new URL(request.url, 'https://kyetechdelivery.site'); } catch { fail(400, 'Invalid rider alerts request.'); }
        const ids = url.searchParams.getAll('subscriptionId');
        if (ids.length > 1) fail(400, 'Invalid rider alerts request.');
        subscriptionId = ids[0];
      }
      if (subscriptionId === undefined) return { publicKey: currentPublicKey };
      if (typeof subscriptionId !== 'string' || subscriptionId.length !== 64 || /[^a-f0-9]/.test(subscriptionId)) fail(400, 'Invalid rider alerts request.');
      const saved = await store.getSubscriptionById(subscriptionId), owned = saved?.uid === actor.uid;
      return { publicKey: currentPublicKey, requiresResubscribe: Boolean(owned && (saved.status === 'requiresResubscribe' || saved.vapidKeyId !== riderPushVapidKeyId(currentPublicKey))) };
    }
    if (!object(body)) fail(400, 'Invalid rider alerts request.');
    if (request.method === 'DELETE') { if (!exactKeys(body, ['endpoint']) || typeof body.endpoint !== 'string' || !body.endpoint || body.endpoint.length > 4096) fail(400, 'Invalid push subscription.'); await store.deleteSubscription(actor.uid, body.endpoint); return { ok: true }; }
    if (body.action === 'subscribe') {
      if (!exactKeys(body, ['action', 'subscription'])) fail(400, 'Invalid push subscription.');
      if (!approvedRider(actor.profile)) fail(403, 'Only approved riders can enable rider alerts.');
      const currentPublicKey = configured().publicKey;
      await store.saveSubscription(actor.uid, validatePushSubscription(body.subscription), now(), riderPushVapidKeyId(currentPublicKey));
      return { ok: true };
    }
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
