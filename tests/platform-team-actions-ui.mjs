// Exercise the real PlatformContext with local Firebase/auth doubles only.
// All external requests and /api/ traffic are blocked. No real writes or SMS.
import assert from 'node:assert/strict';
import { chromium } from '../.verification/login-tools/node_modules/playwright/index.mjs';

const origin = 'http://localhost:5173';
const harness = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOMClient from '/node_modules/.vite/deps/react-dom_client.js';
const {createRoot} = ReactDOMClient;
import {PlatformProvider,usePlatform} from '/src/context/PlatformContext.jsx';
function Probe(){const value=usePlatform();globalThis.__platform=value;
 const state={uid:value.user?.uid,role:value.profile?.role,loading:value.dataLoading,storeId:value.storeTeam.storeId,orders:value.orders.map(o=>o.creatorId),sms:value.smsMessages.map(s=>s.merchantId),reviews:value.recipientReviews.map(r=>r.merchantId),readErrors:value.dataReadErrors,error:value.error};
 globalThis.__renderAudit.push(state);
 return React.createElement('pre',{id:'platform-state'},JSON.stringify(state));}
createRoot(document.getElementById('root')).render(React.createElement(PlatformProvider,null,React.createElement(Probe)));
`;
const firebase = `
export const auth={currentUser:{...__fixture.user,getIdToken:async()=>'fixture-token'}};
globalThis.__fixtureAuth=auth;
export const db={app:{options:{projectId:'fixture-team-actions'}}};
export const firebaseConfigError='',firebaseInitializationError='';
export const friendlyFirebaseError=error=>error?.message||'Fixture service failure';
`;
const auth = `
export function onAuthStateChanged(auth,next){queueMicrotask(()=>next(auth.currentUser));return()=>{};}
export function onIdTokenChanged(auth,next){queueMicrotask(()=>next(auth.currentUser));return()=>{};}
export async function signInWithCustomToken(){throw new Error('Unexpected admin OTP exchange in the store-team fixture');}
export async function createUserWithEmailAndPassword(){throw new Error('Unexpected fixture registration');}
export async function signInWithEmailAndPassword(){throw new Error('Unexpected fixture sign-in');}
export async function sendPasswordResetEmail(){throw new Error('Unexpected fixture email');}
export async function signOut(){throw new Error('Unexpected fixture sign-out');}
export async function updateProfile(){}
`;
const teamHook = `
import React from '/node_modules/.vite/deps/react.js';
const listeners=new Set();let state=globalThis.__fixture.team;
globalThis.__setTeam=patch=>{state={...state,...patch};listeners.forEach(fn=>fn());};
export default function useStoreTeam(){return React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>state);}
`;
const firestore = `
const listeners=new Set(), disposed=[];let counter=0;
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const sourceKey=ref=>ref.path+':'+String((ref.filters||[]).find(filter=>filter.field==='merchantId')?.value||'');
export const collection=(_db,...parts)=>({path:parts.join('/'),kind:'collection'});
export function doc(_db,...parts){if(_db?.kind==='collection'&&!parts.length)parts=[_db.path,'auto-'+String(++counter).padStart(6,'0')];if(parts.some(part=>typeof part!=='string'||!part))throw new Error('Empty fixture document path');return {path:parts.join('/'),id:parts.at(-1),kind:'doc'};}
export const where=(field,op,value)=>({field,op,value});
export const query=(ref,...filters)=>({...ref,filters});
export const serverTimestamp=()=>({__serverTimestamp:true});
function resolved(value){if(value?.__serverTimestamp)return Date.now();if(Array.isArray(value))return value.map(resolved);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,resolved(item)]));return value;}
function record(path){const data=clone(__documents[path]);return {id:path.split('/').at(-1),exists:()=>data!==undefined,data:()=>data,metadata:{hasPendingWrites:false}};}
function privateOwnerRead(path){if(path==='users/merchant-one'||path==='users/merchant-two'){__forbiddenReads.push(path);throw new Error('Owner private profile must not be read by a team member');}}
function snapshot(ref){if(ref.kind==='doc'){privateOwnerRead(ref.path);return record(ref.path);}return {metadata:{fromCache:Boolean(__cacheSources[sourceKey(ref)])},docs:Object.keys(__documents).filter(path=>path.startsWith(ref.path+'/')&&path.split('/').length===ref.path.split('/').length+1).filter(path=>(ref.filters||[]).every(filter=>filter.op==='=='&&__documents[path][filter.field]===filter.value)).map(record)};}
export function onSnapshot(ref,optionsOrNext,nextOrError,errorCallback){const next=typeof optionsOrNext==='function'?optionsOrNext:nextOrError,error=typeof optionsOrNext==='function'?nextOrError:errorCallback;__subscriptions.push(clone(ref));const listener={ref,active:true,next,error,publish(){if(!this.active||__delaySources[sourceKey(ref)])return;try{const failure=__sourceFailures[sourceKey(ref)];if(failure)throw Object.assign(new Error(failure.message),{code:failure.code});next(snapshot(ref));}catch(cause){this.active=false;listeners.delete(this);disposed.push(this);error?.(cause);}}};listeners.add(listener);queueMicrotask(()=>listener.publish());return()=>{listener.active=false;listeners.delete(listener);disposed.push(listener);};}
globalThis.__publishService=()=>listeners.forEach(listener=>listener.publish());
globalThis.__setSourceFailure=(key,failure)=>{__sourceFailures[key]=failure;listeners.forEach(listener=>{if(sourceKey(listener.ref)===key)listener.publish();});};
globalThis.__emitDisposedError=(key,message)=>disposed.filter(listener=>sourceKey(listener.ref)===key).forEach(listener=>listener.error?.(Object.assign(new Error(message),{code:'permission-denied'})));
globalThis.__emitDisposedSnapshot=key=>disposed.filter(listener=>sourceKey(listener.ref)===key).forEach(listener=>listener.next(snapshot(listener.ref)));
globalThis.__patchService=(path,patch,replace=false)=>{__documents[path]=replace?clone(patch):{...__documents[path],...clone(patch)};};
export async function runTransaction(_db,task){
 const writes=[];
 const result=await task({get:async ref=>{__transactionReads.push(ref.path);privateOwnerRead(ref.path);return record(ref.path);},set:(ref,data,options)=>writes.push({kind:'set',path:ref.path,data:clone(data),options}),update:(ref,data)=>writes.push({kind:'update',path:ref.path,data:clone(data)}),delete:ref=>writes.push({kind:'delete',path:ref.path})});
 for(const write of writes){if(write.kind==='delete')delete __documents[write.path];else __documents[write.path]=write.kind==='update'||write.options?.merge?{...__documents[write.path],...resolved(write.data)}:resolved(write.data);}
 __commits.push(clone(writes));__publishService();return result;
}
export function writeBatch(){throw new Error('Unexpected batch action in this fixture');}
export async function setDoc(){throw new Error('Unexpected receipt write in this fixture');}
export async function deleteDoc(){throw new Error('Unexpected location write in this fixture');}
`;
const merchantOne = { ownerId: 'merchant-one', name: 'Ada Groceries', phone: '+233242222222', address: 'Market Circle, Takoradi', location: { latitude: 4.8917, longitude: -1.7554 }, open: true, accountStatus: 'active', approvalStatus: 'approved' };
const merchantTwo = { ...merchantOne, ownerId: 'merchant-two', name: 'Second Store', phone: '+233245555555', location: { latitude: 4.91, longitude: -1.76 } };
const member = storeId => ({ storeId, userId: 'team-one', enabled: true, inviteId: storeId + '-invite' });
const invitation = storeId => ({ storeId, ownerId: storeId, memberId: 'team-one', status: 'accepted' });
const order = (id, storeId = 'merchant-one', patch = {}) => ({ id, creatorId: storeId, createdBy: 'team-one', creatorRole: 'merchant', merchantId: storeId, customerName: storeId === 'merchant-one' ? merchantOne.name : merchantTwo.name, customerPhone: merchantOne.phone, pickup: merchantOne.address, dropoff: 'Effia, Takoradi', recipientName: 'Kwame Receiver', recipientPhone: '+233551234567', packageDescription: 'Groceries', fee: 25, status: 'delivered', riderId: 'rider-one', riderName: 'Kofi Rider', customerRating: null, riderRating: null, customerRatingComment: '', riderRatingComment: '', createdAt: Date.now(), ...patch });
function fixture(role = 'merchant', patch = {}) {
  const uid = role === 'merchant' ? 'team-one' : role + '-one';
  const profile = { name: role === 'merchant' ? 'Team Member' : 'Account Name', role, phone: '+233203333333', email: 'account@example.invalid', city: 'Takoradi', photoUrl: '', online: role === 'rider', accountStatus: 'active', approvalStatus: 'approved' };
  return { user: { uid, email: profile.email }, team: { storeId: 'merchant-one', members: [member('merchant-one'), member('merchant-two')], invitations: [{ ...invitation('merchant-one'), id: 'merchant-one-invite' }, { ...invitation('merchant-two'), id: 'merchant-two-invite' }], loading: false, ...patch }, documents: {
    ['users/' + uid]: profile,
    'stores/merchant-one': merchantOne, 'stores/merchant-two': merchantTwo,
    'storeMembers/merchant-one_team-one': member('merchant-one'), 'storeMembers/merchant-two_team-one': member('merchant-two'),
    'storeInvites/merchant-one-invite': invitation('merchant-one'), 'storeInvites/merchant-two-invite': invitation('merchant-two'),
    'riders/rider-one': { name: 'Kofi Rider', online: true, accountStatus: 'active', approvalStatus: 'approved' },
    'orders/completed-one': order('completed-one'), 'orders/completed-two': order('completed-two'), 'orders/foreign-order': order('foreign-order', 'merchant-two'),
    'deliveryReviews/review-one': { orderId: 'completed-one', merchantId: 'merchant-one', riderId: 'rider-one', riderRating: 5, merchantRating: 4, comment: 'Well done', createdAt: Date.now() },
    'deliveryReviews/review-two': { orderId: 'foreign-order', merchantId: 'merchant-two', riderId: 'rider-two', riderRating: 4, merchantRating: 5, comment: 'Other store review', createdAt: Date.now() },
    'deliverySms/sms-one': { orderId: 'completed-one', merchantId: 'merchant-one', customerId: '', type: 'delivered', sender: 'KYE-TECH', message: 'Your delivery is complete.', status: 'submitted', createdAt: Date.now(), updatedAt: Date.now() },
    'deliverySms/sms-two': { orderId: 'foreign-order', merchantId: 'merchant-two', customerId: '', type: 'delivered', sender: 'KYE-TECH', message: 'Your second-store delivery is complete.', status: 'submitted', createdAt: Date.now(), updatedAt: Date.now() },
  } };
}
const browser = await chromium.launch({ headless: true });
async function makePage(value) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await context.addInitScript(value => { globalThis.__fixture = value; globalThis.__documents = value.documents; globalThis.__subscriptions = []; globalThis.__transactionReads = []; globalThis.__commits = []; globalThis.__forbiddenReads = []; globalThis.__renderAudit = []; globalThis.__sourceFailures = value.sourceFailures || {}; globalThis.__cacheSources = {}; globalThis.__delaySources = {}; }, value);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
    const body = url.pathname === '/src/main.jsx' ? harness : url.pathname === '/src/lib/firebase.js' ? firebase : url.pathname === '/src/lib/useStoreTeam.js' ? teamHook : url.pathname.includes('/node_modules/.vite/deps/firebase_auth.js') ? auth : url.pathname.includes('/node_modules/.vite/deps/firebase_firestore.js') ? firestore : null;
    return body ? route.fulfill({ status: 200, contentType: 'application/javascript', body }) : route.continue();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'Fixture modules must load before exercising PlatformContext');
  await page.waitForFunction(() => globalThis.__platform?.profile && !__platform.authLoading && !__platform.adminLoading && !__platform.dataLoading);
  return { page, context, errors };
}
const call = (page, method, ...args) => page.evaluate(async ({ method, args }) => { try { return { ok: true, result: await __platform[method](...args) }; } catch (cause) { return { ok: false, error: cause.message }; } }, { method, args });
const payload = { pickup: 'Store pickup counter', pickupLocation: { latitude: 0, longitude: 0 }, dropoff: 'Effia, Takoradi', dropoffLocation: { latitude: 4.9, longitude: -1.77 }, recipientName: 'Kwame Receiver', recipientPhone: '0551234567', packageDescription: 'One bag of groceries', fee: '25.50', merchantId: 'merchant-one', preferredRiderId: 'rider-one', customerName: 'Spoofed contact', customerPhone: '+233209999999' };
try {
  const { page, context, errors } = await makePage(fixture());
  try {
    const created = await call(page, 'createOrder', payload); assert.ok(created.ok, created.error);
    const saved = await page.evaluate(id => __documents['orders/' + id], created.result);
    assert.equal(saved.creatorId, 'merchant-one'); assert.equal(saved.merchantId, 'merchant-one'); assert.equal(saved.createdBy, 'team-one');
    assert.equal(saved.creatorRole, 'merchant'); assert.equal(saved.customerName, merchantOne.name); assert.equal(saved.customerPhone, merchantOne.phone);
    assert.deepEqual(saved.pickupLocation, merchantOne.location); assert.deepEqual(saved.dropoffLocation, payload.dropoffLocation);
    assert.equal(saved.recipientPhone, '+233551234567'); assert.equal(saved.fee, 25.5);
    assert.ok((await call(page, 'cancelOrder', created.result)).ok); assert.equal(await page.evaluate(id => __documents['orders/' + id].status, created.result), 'cancelled');
    assert.ok((await call(page, 'rateOrder', 'completed-one', 4, '  Careful delivery  ')).ok);
    const rated = await page.evaluate(() => __documents['orders/completed-one']); assert.equal(rated.customerRating, 4); assert.equal(rated.customerRatingComment, 'Careful delivery');
    assert.equal((await call(page, 'rateOrder', 'completed-one', 5, '')).ok, false);
    const pending = await call(page, 'createOrder', { ...payload, preferredRiderId: '' }); assert.ok(pending.ok);
    for (const [path, patch] of [
      ['storeMembers/merchant-one_team-one', { enabled: false }], ['storeMembers/merchant-one_team-one', { storeId: 'merchant-two' }], ['storeMembers/merchant-one_team-one', { userId: 'someone-else' }],
      ['storeMembers/merchant-one_team-one', { inviteId: 'invalid/path' }], ['storeInvites/merchant-one-invite', { status: 'revoked' }], ['storeInvites/merchant-one-invite', { status: 'pending' }],
      ['storeInvites/merchant-one-invite', { storeId: 'merchant-two' }], ['storeInvites/merchant-one-invite', { ownerId: 'merchant-two' }], ['storeInvites/merchant-one-invite', { memberId: 'someone-else' }],
    ]) {
      await page.evaluate(({ path, patch }) => __patchService(path, patch), { path, patch });
      const before = await page.evaluate(() => __commits.length);
      assert.equal((await call(page, 'createOrder', payload)).ok, false, 'Invalid membership must block delivery creation');
      assert.equal((await call(page, 'cancelOrder', pending.result)).ok, false, 'Invalid membership must block cancellation');
      assert.equal((await call(page, 'rateOrder', 'completed-two', 5, '')).ok, false, 'Invalid membership must block rating');
      assert.equal(await page.evaluate(() => __commits.length), before, 'Rejected actions cannot commit writes');
      await page.evaluate(({ member, invitation }) => { __patchService('storeMembers/merchant-one_team-one', member, true); __patchService('storeInvites/merchant-one-invite', invitation, true); }, { member: member('merchant-one'), invitation: invitation('merchant-one') });
    }
    const beforeMismatch = await page.evaluate(() => __commits.length);
    assert.equal((await call(page, 'createOrder', { ...payload, merchantId: 'merchant-two' })).ok, false);
    assert.equal(await page.evaluate(() => __commits.length), beforeMismatch);
    await page.evaluate(() => { __patchService('stores/merchant-one', { ownerId: 'merchant-two' }); });
    assert.equal((await call(page, 'createOrder', payload)).ok, false);
    await page.evaluate(store => __patchService('stores/merchant-one', store, true), merchantOne);
    await page.evaluate(() => __setTeam({ storeId: 'merchant-two' }));
    await page.waitForFunction(() => __platform.storeTeam.storeId === 'merchant-two' && !__platform.dataLoading && __platform.recipientReviews.some(review => review.merchantId === 'merchant-two'));
    const second = await call(page, 'createOrder', { ...payload, merchantId: 'merchant-two' }); assert.ok(second.ok, second.error);
    const secondSaved = await page.evaluate(id => __documents['orders/' + id], second.result);
    assert.equal(secondSaved.creatorId, 'merchant-two'); assert.equal(secondSaved.createdBy, 'team-one'); assert.equal(secondSaved.customerName, merchantTwo.name); assert.equal(secondSaved.customerPhone, merchantTwo.phone); assert.deepEqual(secondSaved.pickupLocation, merchantTwo.location);
    const subscriptions = await page.evaluate(() => __subscriptions);
    for (const storeId of ['merchant-one', 'merchant-two']) {
      assert.ok(subscriptions.some(ref => ref.path === 'orders' && ref.filters?.some(f => f.field === 'creatorId' && f.value === storeId) && ref.filters.some(f => f.field === 'creatorRole' && f.value === 'merchant') && ref.filters.some(f => f.field === 'merchantId' && f.value === storeId)));
      assert.ok(subscriptions.some(ref => ref.path === 'deliverySms' && ref.filters?.some(f => f.field === 'merchantId' && f.value === storeId) && ref.filters.some(f => f.field === 'status' && f.value === 'submitted')));
      assert.ok(subscriptions.some(ref => ref.path === 'deliveryReviews' && ref.filters?.some(f => f.field === 'merchantId' && f.value === storeId)));
    }
    const audit = await page.evaluate(() => __renderAudit.filter(state => state.role === 'merchant' && state.storeId));
    assert.ok(audit.every(state => [...state.orders, ...state.sms, ...state.reviews].every(scope => scope === state.storeId)), 'Store switches cannot expose the previous store records');
    assert.deepEqual(await page.evaluate(() => __forbiddenReads), []); assert.deepEqual(errors, []);
    console.log('PASS real PlatformContext merchant actions: accepted-team store identity/createdBy/contact/GPS, cancel/rating, live backend membership checks, rejected-action atomicity, store-scoped subscriptions/switches, and no owner private-profile reads.');
  } finally { await context.close(); }
  const rejectedFixture = fixture();
  const denial = { code: 'permission-denied', message: 'Firebase denied this request. Check that the app security rules have been deployed.' };
  rejectedFixture.sourceFailures = { 'deliverySms:merchant-one': denial, 'deliveryReviews:merchant-one': denial };
  const rejected = await makePage(rejectedFixture);
  try {
    const { page } = rejected;
    const initial = await page.evaluate(() => ({ errors: __platform.dataReadErrors, error: __platform.error, orders: __platform.orders.length, subscriptions: __subscriptions.length }));
    assert.equal(Object.keys(initial.errors).length, 2);
    assert.ok(Object.values(initial.errors).some(message => message.startsWith('Store SMS access was denied.')));
    assert.ok(Object.values(initial.errors).some(message => message.startsWith('Store reviews access was denied.')));
    assert.match(initial.error, /Store SMS access was denied/); assert.ok(initial.orders >= 2, 'A failed inbox cannot hide successful delivery reads');
    const invalid = await call(page, 'createOrder', { ...payload, fee: 'invalid' }); assert.equal(invalid.ok, false);
    assert.equal(await page.evaluate(() => Object.keys(__platform.dataReadErrors).length), 2, 'An action failure must preserve separate read failures');
    await call(page, 'clearError');
    assert.match(await page.evaluate(() => __platform.error), /Store SMS access was denied/, 'Dismissal leaves the read notice and its retry action available');
    const healthyOrdersSubscriptions = await page.evaluate(() => __subscriptions.filter(ref => ref.path === 'orders').length);
    await page.evaluate(() => { delete __sourceFailures['deliverySms:merchant-one']; __cacheSources['deliverySms:merchant-one'] = true; __delaySources['deliverySms:merchant-one'] = true; __delaySources['deliveryReviews:merchant-one'] = true; });
    const beforeHeldRetry = await page.evaluate(() => __subscriptions.length);
    await call(page, 'retryData');
    assert.equal(await page.evaluate(() => __platform.dataLoading), false, 'Retry must keep the active page and open forms mounted');
    assert.ok(await page.evaluate(() => __platform.orders.length >= 2), 'Successful records remain visible while a retried read is pending');
    assert.equal(await page.evaluate(() => Object.keys(__platform.dataReadErrors).length), 2);
    assert.equal(await page.evaluate(() => __subscriptions.length), beforeHeldRetry + 2);
    await call(page, 'retryData');
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
    assert.equal(await page.evaluate(() => __subscriptions.length), beforeHeldRetry + 2, 'Repeated manual/connectivity retries cannot restart pending source reads');
    await page.evaluate(() => { delete __delaySources['deliverySms:merchant-one']; __publishService(); });
    await page.waitForFunction(() => !__platform.dataLoading && __platform.smsMessages.length === 1);
    assert.equal(await page.evaluate(() => Object.keys(__platform.dataReadErrors).length), 2, 'Cached data does not confirm restored server access');
    await call(page, 'retryData');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await page.evaluate(() => __subscriptions.length), beforeHeldRetry + 2, 'A cache-only retry stays pending until its server result');
    await page.evaluate(() => { delete __delaySources['deliveryReviews:merchant-one']; __publishService(); });
    assert.equal(await page.evaluate(() => __subscriptions.filter(ref => ref.path === 'orders').length), healthyOrdersSubscriptions, 'Retry only reattaches failed sources');
    assert.ok(await page.evaluate(() => __platform.orders.length >= 2), 'Successful records remain visible during retry');
    await page.evaluate(() => { delete __cacheSources['deliverySms:merchant-one']; __publishService(); });
    await page.waitForFunction(() => Object.keys(__platform.dataReadErrors).length === 1);
    assert.match(await page.evaluate(() => __platform.error), /Store reviews access was denied/, 'Recovering one source cannot clear another source failure');
    await page.evaluate(() => __emitDisposedError('deliverySms:merchant-one', 'Late rejected callback'));
    assert.equal(await page.evaluate(() => Object.keys(__platform.dataReadErrors).length), 1, 'An old listener attempt cannot overwrite its recovered replacement');
    const beforeOnline = await page.evaluate(() => __subscriptions.length);
    await page.evaluate(() => { delete __sourceFailures['deliveryReviews:merchant-one']; __publishService(); });
    assert.equal(await page.evaluate(() => Object.keys(__platform.dataReadErrors).length), 1, 'A terminal listener stays failed until it is reattached');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => !__platform.dataLoading && Object.keys(__platform.dataReadErrors).length === 0 && __platform.recipientReviews.length === 1);
    assert.equal(await page.evaluate(() => __subscriptions.length), beforeOnline + 1);
    assert.equal(await page.evaluate(() => __platform.error), '');
    await page.evaluate(denial => __setSourceFailure('deliveryReviews:merchant-one', denial), denial);
    await page.waitForFunction(() => Object.keys(__platform.dataReadErrors).length === 1);
    await page.evaluate(() => { delete __sourceFailures['deliveryReviews:merchant-one']; window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => !__platform.dataLoading && Object.keys(__platform.dataReadErrors).length === 0);
    await page.evaluate(denial => __setSourceFailure('deliverySms:merchant-one', denial), denial);
    await page.waitForFunction(() => Object.keys(__platform.dataReadErrors).length === 1);
    await page.evaluate(() => __setTeam({ storeId: 'merchant-two' }));
    await page.waitForFunction(() => __platform.storeTeam.storeId === 'merchant-two' && !__platform.dataLoading && __platform.smsMessages[0]?.merchantId === 'merchant-two');
    await page.evaluate(() => { __emitDisposedError('deliverySms:merchant-one', 'Late old-store denial'); __emitDisposedSnapshot('deliverySms:merchant-one'); });
    assert.deepEqual(await page.evaluate(() => __platform.dataReadErrors), {});
    assert.equal(await page.evaluate(() => __platform.error), '');
    assert.ok((await page.evaluate(() => __renderAudit.filter(state => state.role === 'merchant' && state.storeId))).every(state => [...state.orders, ...state.sms, ...state.reviews].every(scope => scope === state.storeId)));
    await page.evaluate(() => __setTeam({ storeId: '' }));
    await page.waitForFunction(() => __platform.storeTeam.storeId === '' && !__platform.dataLoading);
    const beforeEmptyRetry = await page.evaluate(() => __subscriptions.length);
    await call(page, 'retryData');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    assert.equal(await page.evaluate(() => __subscriptions.length), beforeEmptyRetry);
    assert.deepEqual(await page.evaluate(() => __platform.dataReadErrors), {});
    assert.deepEqual(rejected.errors, []); assert.deepEqual(await page.evaluate(() => __forbiddenReads), []);
    console.log('PASS real PlatformContext listener recovery: independent scoped denials, explicit and online/focus retries, terminal-listener reattachment, mounted UI and pending retry deduplication, confirmed-server recovery, successful-data preservation, stale-callback rejection and safe store switching.');
  } finally { await rejected.context.close(); }
  for (const role of ['customer', 'rider']) {
    const { page, context, errors } = await makePage(fixture(role));
    try {
      const sources = await page.evaluate(() => __subscriptions.filter(ref => ref.path === 'deliveryReviews'));
      if (role === 'customer') { assert.equal(sources.length, 0); assert.deepEqual(await page.evaluate(() => __platform.recipientReviews), []); }
      else { assert.ok(sources.some(ref => ref.filters?.some(f => f.field === 'riderId' && f.value === 'rider-one'))); assert.ok((await page.evaluate(() => __platform.recipientReviews)).every(review => review.riderId === 'rider-one')); }
      assert.deepEqual(errors, []); console.log('PASS real PlatformContext ' + role + ' recipient-review subscription scope.');
    } finally { await context.close(); }
  }
  const unavailable = await makePage(fixture('merchant', { storeId: '', loading: false }));
  try { assert.equal(await unavailable.page.evaluate(() => __subscriptions.some(ref => ['orders', 'stores', 'deliverySms', 'deliveryReviews'].includes(ref.path))), false); assert.deepEqual(await unavailable.page.evaluate(() => __platform.orders), []); assert.deepEqual(unavailable.errors, []); console.log('PASS real PlatformContext empty merchant store selection: no invalid document/subscription paths or stale records.'); }
  finally { await unavailable.context.close(); }
} finally { await browser.close(); }
