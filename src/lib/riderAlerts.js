import { ensureServiceWorker } from './registerServiceWorker.js';

const preferences = new Map();
let subscriptionQueue = Promise.resolve();
let badgeQueue = Promise.resolve();
let deviceOwner = '';
let badgeOwner = '';
const badgeOwnerKey = 'kyetech:rider-request-badge-owner';
const preferenceKey = uid => `kyetech:rider-alerts:${uid}`;

export function riderAlertsEnabled(uid) {
  if (!uid) return false;
  if (preferences.has(uid)) return preferences.get(uid);
  try { return localStorage.getItem(preferenceKey(uid)) === '1'; } catch { return false; }
}

export function rememberRiderAlerts(uid, enabled) {
  if (!uid) return;
  preferences.set(uid, enabled);
  try { localStorage.setItem(preferenceKey(uid), enabled ? '1' : '0'); } catch { /* Retain the preference for this session. */ }
}

export function riderPushSupport(browser = window) {
  const ios = /iPhone|iPad|iPod/i.test(browser.navigator.userAgent)
    || (browser.navigator.platform === 'MacIntel' && browser.navigator.maxTouchPoints > 1);
  const standalone = browser.navigator.standalone === true || browser.matchMedia?.('(display-mode: standalone)').matches === true;
  if (ios && !standalone) return 'install-ios';
  return browser.isSecureContext && 'Notification' in browser && 'PushManager' in browser && 'serviceWorker' in browser.navigator ? 'supported' : 'unsupported';
}

export function vapidKeyBytes(key) {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)), char => char.charCodeAt(0));
}

async function request(user, method, body, timeout = 15000, query = '') {
  const token = await user.getIdToken();
  const response = await fetch('/api/rider-alerts' + query, {
    method, cache: 'no-store', signal: AbortSignal.timeout(timeout),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || 'Rider alerts could not connect. Please try again.');
  return data;
}

function serialize(callback) {
  const operation = subscriptionQueue.then(callback);
  subscriptionQueue = operation.catch(() => {});
  return operation;
}

export function registerRiderPush(user, isCurrent = () => true) {
  return serialize(async () => {
    if (!isCurrent()) return false;
    const registration = await ensureServiceWorker();
    if (!isCurrent()) return false;
    let subscription = await registration.pushManager.getSubscription();
    const subscriptionId = subscription ? await pushEndpointId(subscription.endpoint) : '';
    const { publicKey, requiresResubscribe } = await request(user, 'GET', undefined, 15000, subscriptionId ? '?subscriptionId=' + subscriptionId : '');
    if (!isCurrent()) return false;
    const key = vapidKeyBytes(publicKey);
    const previousKey = subscription?.options?.applicationServerKey;
    if (subscription && (requiresResubscribe || (previousKey && !equalBytes(new Uint8Array(previousKey), key)))) {
      try { await request(user, 'DELETE', { endpoint: subscription.endpoint }); } catch { /* Unsubscribe also invalidates the old provider endpoint. */ }
      await subscription.unsubscribe();
      subscription = null;
    }
    if (!isCurrent()) return false;
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    if (!isCurrent()) { await subscription.unsubscribe(); return false; }
    await request(user, 'POST', { action: 'subscribe', subscription: subscription.toJSON() });
    deviceOwner = user.uid;
    if (!isCurrent()) {
      try { await request(user, 'DELETE', { endpoint: subscription.endpoint }); } catch { /* Browser unsubscribe still stops delivery. */ }
      await subscription.unsubscribe();
      deviceOwner = '';
      return false;
    }
    return true;
  });
}

async function pushEndpointId(endpoint) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function equalBytes(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }

function readBadgeOwner() {
  try { badgeOwner = localStorage.getItem(badgeOwnerKey) || ''; } catch { /* Keep ownership for this session if storage is blocked. */ }
  return badgeOwner;
}

function rememberBadgeOwner(uid) {
  badgeOwner = uid;
  try { localStorage.setItem(badgeOwnerKey, uid); } catch { /* Retain the owner for this session. */ }
}

function sendBadgeMessage(message, isCurrent, uid = '', claim = false) {
  const operation = badgeQueue.then(async () => {
    if (!isCurrent() || !('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!isCurrent() || !registration?.active) return false;
    const owner = readBadgeOwner();
    if (uid && claim) {
      if (owner !== uid) registration.active.postMessage({ type: 'clear-rider-request-badge' });
      rememberBadgeOwner(uid);
    } else if (uid && owner && owner !== uid) return false;
    if (!isCurrent()) return false;
    if (message) registration.active.postMessage(message);
    if (uid && !claim) rememberBadgeOwner(uid);
    return true;
  }).catch(() => false);
  badgeQueue = operation;
  return operation;
}

export function claimRiderRequestBadge(uid, isCurrent = () => true) {
  if (!uid) return Promise.resolve(false);
  return sendBadgeMessage(null, isCurrent, uid, true);
}

export function syncRiderRequestBadge(orderIds, isCurrent = () => true, uid = '') {
  const safeIds = [...new Set(orderIds.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128 && !/[^A-Za-z0-9_-]/.test(id)))].slice(-1000);
  return sendBadgeMessage({ type: 'sync-rider-request-badge', orderIds: safeIds }, isCurrent, uid, Boolean(uid));
}

export function clearRiderRequestBadge(isCurrent = () => true, uid = '') {
  return sendBadgeMessage({ type: 'clear-rider-request-badge' }, isCurrent, uid);
}

export function removeRiderPush(user, isCurrent) {
  const valid = isCurrent || (() => true);
  return serialize(async () => {
    if (!user || !valid() || !('serviceWorker' in navigator) || (!isCurrent && deviceOwner && deviceOwner !== user.uid)) return;
    await clearRiderRequestBadge(valid, user.uid);
    if (!valid()) return;
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!valid()) return;
    const subscription = await registration?.pushManager?.getSubscription();
    if (!valid() || !subscription) return;
    try { await request(user, 'DELETE', { endpoint: subscription.endpoint }); } catch { /* Continue even if the phone is offline or the account was revoked. */ }
    if (!valid()) return;
    await subscription.unsubscribe();
    deviceOwner = '';
  });
}

export async function notifyRiderOrder(user, orderId) {
  // A delivery is already saved; notification failure must never undo it.
  try { await request(user, 'POST', { action: 'dispatch', orderId }, 25000); return true; }
  catch { return false; }
}

export function createRequestTracker() {
  let baseline = null;
  const seen = new Set();
  return {
    observe(ids, { ready, active }) {
      if (!ready || !active) { baseline = null; return []; }
      const current = new Set(ids);
      if (!baseline) { baseline = current; ids.forEach(id => seen.add(id)); return []; }
      const added = ids.filter(id => !baseline.has(id) && !seen.has(id));
      ids.forEach(id => seen.add(id));
      baseline = current;
      if (seen.size > 2000) { seen.clear(); ids.forEach(id => seen.add(id)); }
      return added;
    },
  };
}

export function createRiderChime(browser = window) {
  let context = null;
  const playing = new Set();
  function stop() { playing.forEach(node => { try { node.stop(); } catch { /* Already ended. */ } }); playing.clear(); }
  function play() {
    if (context?.state !== 'running') return false;
    stop();
    [880, 1175, 880, 880, 1175, 880].forEach((frequency, index) => {
      const tone = context.createOscillator(), gain = context.createGain(), start = context.currentTime + index * 0.28 + (index >= 3 ? 0.2 : 0);
      tone.type = 'triangle'; tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.7, start + 0.02); gain.gain.setValueAtTime(0.7, start + 0.17); gain.gain.exponentialRampToValueAtTime(0.001, start + 0.23);
      tone.connect(gain); gain.connect(context.destination); playing.add(tone);
      tone.onended = () => { playing.delete(tone); tone.disconnect(); gain.disconnect(); };
      tone.start(start); tone.stop(start + 0.24);
    });
    return true;
  }
  return {
    async unlock() {
      try {
        const AudioContext = browser.AudioContext || browser.webkitAudioContext;
        if (!AudioContext) return false;
        context ||= new AudioContext();
        await context.resume();
        return play();
      } catch { return false; }
    },
    play, stop, ready: () => context?.state === 'running',
    close() { stop(); context?.close().catch(() => {}); context = null; },
  };
}
