// Exercises the real team hook with isolated Firestore streams. No live accounts or writes.
import assert from 'node:assert/strict';
import { chromium } from '../.verification/login-tools/node_modules/playwright/index.mjs';

const origin = 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const firestore = `
const listeners = new Set();
export const collection = (_db, path) => ({ path });
export const doc = (_db, ...parts) => ({ path: parts.join('/') });
export const where = (field, operator, value) => ({ field, value });
export const query = (ref, constraint) => ({ ...ref, constraint });
export const serverTimestamp = () => Date.now();
const key = ref => ref.constraint ? [ref.path, ref.constraint.field, ref.constraint.value].join(':') : ref.path;
const snapshot = (path, data) => ({ id: path.split('/').at(-1), exists: () => Boolean(data), data: () => data });
function emit(listener, fromCache) {
 if (!listener.active) return;
 const ref = listener.ref, name = key(ref);
 if (!fromCache && __denied.includes(name)) { listener.active = false; listener.error({ code: 'permission-denied' }); return; }
 const result = ref.constraint
  ? { docs: Object.entries(__records).filter(([path, data]) => path.split('/')[0] === ref.path && data[ref.constraint.field] === ref.constraint.value).map(([path, data]) => snapshot(path, data)) }
  : snapshot(ref.path, __records[ref.path]);
 listener.next({ ...result, metadata: { fromCache } });
}
globalThis.__flushSource = (name, fromCache = false) => [...listeners].filter(listener => key(listener.ref) === name).forEach(listener => emit(listener, fromCache));
globalThis.__flushSnapshots = (fromCache = false) => [...listeners].forEach(listener => emit(listener, fromCache));
export function onSnapshot(ref, options, next, error) {
 const listener = { ref, next, error, active: true }; listeners.add(listener); __subscriptions.push(key(ref));
 queueMicrotask(() => { emit(listener, true); if (!__holdServer) emit(listener, false); });
 return () => { listener.active = false; listeners.delete(listener); };
}
export async function runTransaction(_db, action) {
 const writes = [];
 const result = await action({ async get(ref) { return snapshot(ref.path, __records[ref.path]); }, set(ref, data) { writes.push({ path: ref.path, data }); }, update(ref, data) { writes.push({ path: ref.path, data: { ...__records[ref.path], ...data } }); } });
 for (const write of writes) __records[write.path] = write.data;
 __transactionWrites.push(...writes); __flushSnapshots(false); return result;
}
`;
const harness = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDomClient from '/node_modules/.vite/deps/react-dom_client.js';
import useStoreTeam from '/src/lib/useStoreTeam.js';
function App() {
 const [actor, setActor] = React.useState(__actor);
 globalThis.__switchActor = next => { __actor = { ...next, async reload() {}, async getIdToken() { return 'fixture'; } }; setActor(__actor); };
 const profile = { id: actor.uid, role: 'merchant', name: 'Store teammate', email: actor.email, accountStatus: 'active' };
 const team = useStoreTeam({ user: actor, profile }); globalThis.__hookTeam = team;
 __workspaceTrace.push({ accountId: actor.uid, storeId: team.storeId, loading: team.loading, accessUnavailable: team.accessUnavailable, error: team.error });
 return React.createElement('main', null,
  React.createElement('div', { id: 'workspace', 'data-loading': String(team.loading), 'data-unavailable': String(team.accessUnavailable) }, team.storeId),
  team.error && React.createElement('p', { role: 'alert' }, team.error),
  team.error && React.createElement('button', { onClick: team.retry }, 'Retry store access'));
}
ReactDomClient.createRoot(document.getElementById('root')).render(React.createElement(App));
`;
const membership = (storeId, updatedAt, uid = 'team-one') => ({
  [`storeMembers/${storeId}_${uid}`]: { storeId, userId: uid, email: `${uid}@example.invalid`, inviteId: `invite-${storeId}-${uid}`, enabled: true, updatedAt },
  [`storeInvites/invite-${storeId}-${uid}`]: { storeId, ownerId: storeId, storeName: storeId, email: `${uid}@example.invalid`, status: 'accepted', memberId: uid, updatedAt },
  [`stores/${storeId}`]: { ownerId: storeId, name: storeId, accountStatus: 'active' },
});
const context = await browser.newContext();
await context.addInitScript(records => {
  globalThis.__records = records; globalThis.__holdServer = true; globalThis.__denied = [];
  globalThis.__subscriptions = []; globalThis.__workspaceTrace = []; globalThis.__transactionWrites = []; globalThis.__verifications = 0;
  globalThis.__actor = { uid: 'team-one', email: 'team-one@example.invalid', emailVerified: true, async reload() {}, async getIdToken() { return 'fixture'; } };
}, { ...membership('store-one', 10), ...membership('store-two', 20) });
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
  if (url.pathname === '/tests/store-workspace-fixture.html') return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script type="module" src="/tests/store-workspace-fixture.js"></script>' });
  if (url.pathname === '/tests/store-workspace-fixture.js') return route.fulfill({ contentType: 'application/javascript', body: harness });
  if (url.pathname === '/src/lib/firebase.js') return route.fulfill({ contentType: 'application/javascript', body: 'export const db={};export const auth={get currentUser(){return globalThis.__actor;}};export const friendlyFirebaseError=error=>error.message;' });
  if (url.pathname.includes('/node_modules/.vite/deps/firebase_firestore.js')) return route.fulfill({ contentType: 'application/javascript', body: firestore });
  if (url.pathname.includes('/node_modules/.vite/deps/firebase_auth.js')) return route.fulfill({ contentType: 'application/javascript', body: 'export async function sendEmailVerification(){globalThis.__verifications++;}' });
  return route.continue();
});
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
async function workspace(storeId) { await page.waitForFunction(expected => __hookTeam?.storeId === expected && !__hookTeam.loading, storeId); }
async function noPersonalFlash(uid = 'team-one') { assert.equal(await page.evaluate(id => __workspaceTrace.some(item => item.accountId === id && item.storeId === id), uid), false, 'Invited store streams cannot flash an empty personal workspace.'); }
try {
  await page.goto(origin + '/tests/store-workspace-fixture.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => __subscriptions.length === 4);
  assert.equal(await page.locator('#workspace').innerText(), '');
  assert.equal(await page.locator('#workspace').getAttribute('data-loading'), 'true');
  await page.evaluate(() => __flushSource('storeMembers:userId:team-one'));
  assert.equal(await page.locator('#workspace').innerText(), '');
  await page.evaluate(() => { __holdServer = false; __flushSnapshots(); });
  await workspace('store-two'); await noPersonalFlash();
  console.log('PASS unfinished cached snapshots stay loading; accepted-member login selects the newest store.');

  await page.evaluate(() => { __records['storeMembers/store-two_team-one'].enabled = false; __records['storeInvites/invite-store-two-team-one'].status = 'revoked'; __flushSnapshots(); });
  await workspace('store-one'); await noPersonalFlash();
  await page.evaluate(() => { __records['stores/store-one'].accountStatus = 'suspended'; __flushSnapshots(); });
  await workspace('');
  assert.equal(await page.locator('#workspace').getAttribute('data-unavailable'), 'true');
  assert.match(await page.getByRole('alert').innerText(), /unavailable|removed/);
  await noPersonalFlash();
  await page.evaluate(() => { __records['stores/store-one'].accountStatus = 'active'; __flushSnapshots(); });
  await workspace('store-one');
  console.log('PASS removed memberships and suspended stores use valid remaining access or an unavailable notice.');

  await page.evaluate(() => { __denied = ['stores/store-one']; __flushSource('stores/store-one'); });
  await workspace('');
  await page.evaluate(() => { __denied = []; window.dispatchEvent(new Event('online')); });
  await workspace('store-one');
  assert.ok(await page.evaluate(() => __subscriptions.filter(key => key === 'stores/store-one').length >= 2));
  await page.evaluate(() => { __denied = ['storeMembers:userId:team-one']; __flushSource('storeMembers:userId:team-one'); });
  await workspace('');
  assert.match(await page.getByRole('alert').innerText(), /could not be loaded/);
  await noPersonalFlash();
  await page.evaluate(() => { __denied = []; });
  await page.getByRole('button', { name: 'Retry store access' }).click();
  await workspace('store-one');
  console.log('PASS denied store/team listeners block personal fallback and recover with online or explicit retry.');

  await page.evaluate(() => {
    __records['stores/store-three'] = { ownerId: 'store-three', name: 'New invited store', accountStatus: 'active' };
    __records['storeInvites/invite-store-three-team-one'] = { storeId: 'store-three', ownerId: 'store-three', storeName: 'New invited store', email: 'team-one@example.invalid', status: 'pending', memberId: '', updatedAt: 1 };
    __actor.emailVerified = false; __flushSnapshots();
  });
  await page.waitForFunction(() => __hookTeam.invitations.some(invite => invite.status === 'pending'));
  await page.evaluate(() => __hookTeam.verifyEmail());
  assert.equal(await page.evaluate(() => __verifications), 1);
  await page.evaluate(() => { __actor.emailVerified = true; return __hookTeam.accept('invite-store-three-team-one'); });
  await workspace('store-three'); await noPersonalFlash();
  assert.equal(await page.evaluate(() => __records['storeMembers/store-three_team-one'].enabled), true);
  console.log('PASS verified invitation acceptance enters the invited store and saves its membership.');

  await page.evaluate(() => __switchActor({ uid: 'new-owner', email: 'new-owner@example.invalid', emailVerified: true }));
  await workspace('new-owner');
  assert.equal(await page.evaluate(() => __workspaceTrace.some(item => item.accountId === 'new-owner' && ['store-one', 'store-two', 'store-three'].includes(item.storeId))), false);
  await page.evaluate(() => __switchActor({ uid: 'team-one', email: 'team-one@example.invalid', emailVerified: true }));
  await workspace('store-three');
  assert.deepEqual(errors, []);
  console.log('PASS account changes clear the old workspace and reload only the current account’s access.');
} finally { await context.close(); await browser.close(); }
