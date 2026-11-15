// Isolated browser verification: no real accounts, database writes, or SMS sends.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../.verification/login-tools/node_modules/playwright/index.mjs';

const baseUrl = process.env.CUSTOMER_SMS_UI_URL || 'http://localhost:5173/';
const origin = new URL(baseUrl).origin;
const output = '.verification/customer-sms';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const fixtureModule = `
import React from '/node_modules/.vite/deps/react.js';
import useCustomerSmsReads from '/src/lib/useCustomerSmsReads.js';
const { useSyncExternalStore } = React;
const listeners = new Set(), context = React.createContext(null);
let state = globalThis.__smsFixture;
function publish(patch) { state = { ...state, ...patch }; globalThis.__smsFixture = state; listeners.forEach(listener => listener()); }
globalThis.__updateSmsFixture = publish;
export function PlatformProvider({ children }) {
  const snapshot = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => state);
  const customerSmsReads = useCustomerSmsReads({ user: snapshot.user, profile: snapshot.profile, messages: snapshot.smsMessages });
  return React.createElement(context.Provider,{value:{ ...snapshot, customerSmsReads, clearError() {}, async logout() {}, async rateOrder(id, rating, comment) {
    globalThis.__smsCalls.push({ id, rating, comment });
    publish({ orders: state.orders.map(order => order.id === id ? { ...order, customerRating: rating } : order) });
  } }},children);
}
export function usePlatform() { return React.useContext(context); }
`;
const firestoreModule = `
const listeners=new Set();
export const doc=(_db,...parts)=>({path:parts.join('/')});
export const collection=(_db,...parts)=>({path:parts.join('/')});
export const query=(ref,...filters)=>({...ref,filters});
export const where=(...parts)=>parts;
export async function getDoc(){throw new Error('Unexpected recipient review read in the customer SMS fixture');}
export async function runTransaction(){throw new Error('Unexpected catalog transaction in the customer SMS fixture');}
export const serverTimestamp=()=>Date.now();
globalThis.__notifySmsReads=()=>{sessionStorage.setItem('fixture-sms-reads',JSON.stringify(__smsReads));listeners.forEach(listener=>listener.publish());};
export function onSnapshot(ref,next,error){
 __listenAttempts++;
 if(__failSmsReadListen){queueMicrotask(()=>error({code:'permission-denied'}));return()=>{};}
 const uid=ref.path.split('/')[1],listener={active:true,publish(){if(this.active)next({docs:(__smsReads[uid]||[]).map(id=>({id}))});}};
 listeners.add(listener);queueMicrotask(()=>listener.publish());
 return()=>{listener.active=false;listeners.delete(listener);};
}
export async function setDoc(ref,data){
 __readAttempts++;
 if(__failSmsReadSave)throw Object.assign(new Error('Fixture save failure'),{code:'permission-denied'});
 if(__delaySmsReadSave)await new Promise(resolve=>{globalThis.__releaseSmsReadSave=resolve;});
 __readWrites.push({path:ref.path,data});
 const parts=ref.path.split('/'),uid=parts[1],id=parts[3];
 __smsReads[uid]=[...new Set([...(__smsReads[uid]||[]),id])];__notifySmsReads();
}
`;
function fixture() {
  const profile = { id: 'customer-one', name: 'Abena Customer', role: 'customer', email: 'customer@example.invalid', city: 'Takoradi', phone: '+233241234567', photoUrl: '', accountStatus: 'active' };
  const sms = (id, orderId, type, date, patch = {}) => ({ id, orderId, type, customerId: profile.id, sender: 'KYE-TECH', status: 'submitted', message: `Exact ${type} SMS for ${orderId}.`, createdAt: Date.parse('2026-11-11T12:00:00Z'), updatedAt: Date.parse(date), ...patch });
  const order = (id, patch = {}) => ({ id, creatorId: profile.id, creatorRole: 'customer', status: 'delivered', pickup: 'Market Circle', dropoff: 'Kojokrom', packageDescription: 'Parcel', fee: 25, riderId: 'rider-one', riderName: 'Ama Rider', createdAt: Date.parse('2026-11-11T12:00:00Z'), ...patch });
  return {
    user: { uid: profile.id }, profile, isAdmin: false, adminLoading: false, authLoading: false, dataLoading: false, needsProfile: false, error: '', stores: [], riders: [],
    orders: [order('order-a'), order('order-b', { customerRating: 5 })],
    smsMessages: [
      sms('pickup-a', 'order-a', 'picked_up', '2026-11-13T00:00:00Z'),
      sms('complete-a', 'order-a', 'delivered', '2026-11-13T23:59:59Z'),
      sms('pickup-b', 'order-b', 'picked_up', '2026-11-12T23:59:59Z', { updatedAt: { seconds: Date.parse('2026-11-12T23:59:59Z') / 1000 } }),
      sms('complete-b', 'order-b', 'delivered', '2026-11-14T00:00:00Z'),
      sms('other', 'other-order', 'delivered', '2026-11-14T02:00:00Z', { customerId: 'other-customer', message: 'PRIVATE OTHER CUSTOMER MESSAGE' }),
      sms('failed', 'failed-order', 'picked_up', '2026-11-14T02:00:00Z', { status: 'failed', message: 'FAILED MESSAGE' }),
      sms('pending', 'pending-order', 'picked_up', '2026-11-14T02:00:00Z', { status: 'submitting', message: 'PENDING MESSAGE' }),
      sms('legacy', 'legacy-order', 'picked_up', '2026-11-14T02:00:00Z', { message: '' }),
    ],
  };
}
async function makePage(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript(value => {
    globalThis.__smsFixture = value;
    globalThis.__smsCalls = [];
    globalThis.__copiedSms = '';
    globalThis.__smsReads = JSON.parse(sessionStorage.getItem('fixture-sms-reads') || '{}');
    globalThis.__readWrites = [];globalThis.__readAttempts=0;globalThis.__listenAttempts=0;globalThis.__failSmsReadSave=false;globalThis.__failSmsReadListen=false;globalThis.__delaySmsReadSave=false;
    Object.defineProperty(navigator, 'clipboard', { value: { async writeText(text) { globalThis.__copiedSms = text; } } });
  }, fixture());
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
    if (url.pathname === '/src/context/PlatformContext.jsx') return route.fulfill({ status: 200, contentType: 'application/javascript', body: fixtureModule });
    if (url.pathname === '/src/lib/firebase.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export const db={};' });
    if (url.pathname.includes('/node_modules/.vite/deps/firebase_firestore.js')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: firestoreModule });
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'The customer app starts without module errors.');
  const nav = page.getByRole('navigation', { name: width < 720 ? 'Mobile navigation' : 'Main navigation', exact: true });
  await nav.waitFor();
  assert.equal(await nav.getByRole('button', { name: 'Menu', exact: true }).count(), 0);
  const labels = await nav.getByRole('button').allTextContents();
  assert.ok(labels.findIndex(label => label.includes('SMS')) < labels.findIndex(label => label.includes('Profile')), 'SMS comes before Profile.');
  assert.equal(await nav.getByRole('button', { name: 'SMS', exact: true }).locator('.sms-nav-unread-badge').innerText(), '4');
  await nav.getByRole('button', { name: 'SMS', exact: true }).click();
  await page.getByRole('heading', { name: 'Your SMS', exact: true }).waitFor();
  return { context, page, errors };
}
async function messageCount(page, count) { assert.equal(await page.locator('.sms-message-card').count(), count); }
async function noOverflow(page, label) {
  const sizes = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
  assert.ok(sizes[1] <= sizes[0] + 1, `${label} overflows: ${sizes}`);
}
try {
  for (const width of [1366, 390, 320]) {
    const { page, context, errors } = await makePage(width);
    try {
      await messageCount(page, 4);
      assert.equal(await page.locator('.sms-message-unread').count(),4,'Opening the SMS tab does not mark messages as viewed.');
      assert.match(await page.locator('.sms-message-card').first().innerText(), /KYE-RDER-B/);
      assert.equal(await page.locator('.sms-message-body').count(), 0);
      assert.equal(await page.getByLabel('From date', { exact: true }).isVisible(), false);
      assert.equal(await page.getByLabel('To date', { exact: true }).isVisible(), false);
      assert.equal(await page.getByRole('button', { name: 'Date filter', exact: true }).getAttribute('aria-expanded'), 'false');
      const rowHeights = await page.locator('.sms-message-card').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
      assert.ok(rowHeights.every(height => height <= 70), 'SMS summaries stay slim.');
      assert.equal(await page.getByText('PRIVATE OTHER CUSTOMER MESSAGE', { exact: true }).count(), 0);
      assert.equal(await page.getByText('FAILED MESSAGE', { exact: true }).count(), 0);
      assert.equal(await page.getByText('PENDING MESSAGE', { exact: true }).count(), 0);
      await noOverflow(page, `${width}px inbox`);
      await page.screenshot({ path: `${output}/inbox-${width}.png`, fullPage: true });
      const firstView = page.getByRole('button', { name: 'View completed delivery SMS KYE-RDER-B', exact: true });
      await firstView.click();
      assert.equal(await page.locator('.sms-message-unread').count(),3);
      assert.equal(await page.evaluate(()=>__readWrites.length),1);
      assert.equal(await page.evaluate(()=>__readWrites[0].path),'users/customer-one/smsReads/complete-b');
      const smsDetails = page.getByRole('dialog', { name: 'SMS details', exact: true });
      assert.match(await smsDetails.innerText(), /Exact delivered SMS for order-b/);
      assert.match(await smsDetails.innerText(), /KYE-TECH/);
      assert.equal(await smsDetails.getByRole('button', { name: 'Rate rider', exact: true }).count(), 0);
      await smsDetails.getByRole('button', { name: 'Copy completed delivery SMS KYE-RDER-B', exact: true }).click();
      assert.equal(await page.evaluate(() => globalThis.__copiedSms), 'Exact delivered SMS for order-b.');
      await noOverflow(page, `${width}px SMS details`);
      await page.screenshot({ path: `${output}/details-${width}.png`, fullPage: true });
      await page.keyboard.press('Escape');
      await smsDetails.waitFor({ state: 'hidden' });
      assert.ok(await firstView.evaluate(button => button === document.activeElement));
      await page.getByRole('button', { name: 'Pickup', exact: true }).click();
      await messageCount(page, 2);
      assert.equal(await page.getByRole('button', { name: 'Rate rider', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Completed', exact: true }).click();
      await messageCount(page, 2);
      await page.getByRole('button', { name: 'View completed delivery SMS KYE-RDER-A', exact: true }).click();
      assert.equal(await smsDetails.getByRole('button', { name: 'Rate rider', exact: true }).count(), 1);
      await smsDetails.getByRole('button', { name: 'Close dialog', exact: true }).click();
      assert.equal(await page.locator('.sms-message-unread').count(),0,'Both completed messages have been viewed; pickup messages remain unread.');
      await page.reload({waitUntil:'networkidle'});
      const nav=page.getByRole('navigation',{name:width<720?'Mobile navigation':'Main navigation',exact:true});
      await nav.getByRole('button',{name:'SMS',exact:true}).click();
      assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'2','Viewed status survives reload.');
      assert.equal(await page.locator('.sms-message-unread').count(),2);
      await firstView.click();
      assert.equal(await page.evaluate(()=>__readWrites.length),0,'Reopening a viewed SMS does not create another receipt.');
      await smsDetails.getByRole('button',{name:'Close dialog',exact:true}).click();
      await page.getByRole('button', { name: 'All', exact: true }).click();
      await page.getByRole('button', { name: 'Date filter', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Date filter', exact: true }).getAttribute('aria-expanded'), 'true');
      await page.getByLabel('From date', { exact: true }).fill('2026-11-13');
      await page.getByLabel('To date', { exact: true }).fill('2026-11-13');
      await messageCount(page, 2);
      assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'2','Filters do not change the total unread count.');
      await page.screenshot({ path: `${output}/date-filters-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Date filter', exact: true }).click();
      assert.equal(await page.getByLabel('From date', { exact: true }).isVisible(), false);
      await messageCount(page, 2);
      assert.match(await page.locator('.sms-active-dates').innerText(), /13 Nov 2026/);
      await page.getByRole('button', { name: 'Pickup', exact: true }).click();
      await messageCount(page, 1);
      await page.getByRole('button', { name: 'Completed', exact: true }).click();
      await messageCount(page, 1);
      await page.getByRole('button', { name: 'View completed delivery SMS KYE-RDER-A', exact: true }).click();
      await page.getByRole('button', { name: 'Copy completed delivery SMS KYE-RDER-A', exact: true }).click();
      assert.equal(await page.evaluate(() => globalThis.__copiedSms), 'Exact delivered SMS for order-a.');
      await page.getByRole('button', { name: 'Rate rider', exact: true }).click();
      assert.equal(await page.getByRole('dialog').count(), 1, 'Rating replaces SMS details without nesting dialogs.');
      await page.getByRole('dialog', { name: 'How was your delivery?', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Save rating', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => globalThis.__smsCalls), [{ id: 'order-a', rating: 5, comment: '' }]);
      assert.equal(await page.getByRole('button', { name: 'Rate rider', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await messageCount(page, 4);
      assert.equal(await page.getByLabel('From date', { exact: true }).isVisible(), false);
      await page.getByRole('button', { name: 'Date filter', exact: true }).click();
      assert.equal(await page.getByLabel('From date', { exact: true }).inputValue(), '');
      assert.equal(await page.getByLabel('To date', { exact: true }).inputValue(), '');
      await page.getByLabel('From date', { exact: true }).fill('2026-11-15');
      await messageCount(page, 0);
      await page.getByRole('heading', { name: 'No SMS match these filters', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Show all SMS', exact: true }).click();
      await messageCount(page, 4);
      await page.getByLabel('From date', { exact: true }).fill('2026-11-14');
      await page.getByLabel('To date', { exact: true }).fill('2026-11-13');
      await page.getByRole('alert').filter({ hasText: 'Choose an end date' }).waitFor();
      await messageCount(page, 0);
      await page.getByRole('button', { name: 'Date filter', exact: true }).click();
      assert.equal(await page.getByLabel('To date', { exact: true }).isVisible(), false);
      await page.getByRole('alert').filter({ hasText: 'Choose an end date' }).waitFor();
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await page.evaluate(()=>__updateSmsFixture({smsMessages:[...__smsFixture.smsMessages,{id:'new-sms',orderId:'order-c',type:'delivered',customerId:'customer-one',sender:'KYE-TECH',status:'submitted',message:'A new delivery SMS.',createdAt:Date.now(),updatedAt:Date.now()}]}));
      assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'3','New SMS increases the unread count.');
      await page.evaluate(()=>{__failSmsReadSave=true;});
      await page.getByRole('button',{name:'View completed delivery SMS KYE-RDER-C',exact:true}).click();
      await page.waitForFunction(()=>__readAttempts>0);
      assert.equal(await page.getByRole('alert').filter({hasText:'Could not save this SMS as viewed'}).count(),0,'A successful browser save does not show a Firestore save error.');
      assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'2','A denied server save keeps the opened message viewed on this device.');
      await smsDetails.getByRole('button',{name:'Close dialog',exact:true}).click();
      await page.evaluate(()=>{__failSmsReadSave=false;__delaySmsReadSave=true;window.dispatchEvent(new Event('online'));});
      await page.waitForFunction(()=>typeof __releaseSmsReadSave==='function');
      await page.getByRole('button',{name:'View completed delivery SMS KYE-RDER-C',exact:true}).click();
      assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'2','A background retry cannot restore the red badge.');
      await page.evaluate(()=>{__delaySmsReadSave=false;__releaseSmsReadSave();});
      await page.waitForFunction(()=>__readWrites.some(write=>write.path.endsWith('/new-sms')));
      await smsDetails.getByRole('button',{name:'Close dialog',exact:true}).click();
      await page.evaluate(()=>{__smsReads['customer-one'].push('pickup-a');__notifySmsReads();});
      await nav.locator('.sms-nav-unread-badge').filter({hasText:/^1$/}).waitFor();
      assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'1','Read status updates from another device.');
      await page.getByRole('button',{name:'View pickup SMS KYE-RDER-B',exact:true}).click();
      await smsDetails.getByRole('button',{name:'Close dialog',exact:true}).click();
      assert.equal(await nav.locator('.sms-nav-unread-badge').count(),0,'No badge remains when all SMS are viewed.');
      await page.evaluate(()=>__updateSmsFixture({user:{uid:'customer-two'},profile:{...__smsFixture.profile,id:'customer-two',name:'Second Customer'},smsMessages:[{id:'complete-b',orderId:'order-b',type:'delivered',customerId:'customer-two',status:'submitted',sender:'KYE-TECH',message:'Second account SMS.',createdAt:Date.now(),updatedAt:Date.now()}]}));
      await nav.getByRole('button',{name:'SMS',exact:true}).click();
      assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'1','Viewed IDs stay scoped to the signed-in account.');
      await page.getByRole('button',{name:'View completed delivery SMS KYE-RDER-B',exact:true}).click();
      assert.match(await smsDetails.innerText(),/Second account SMS/);
      await smsDetails.getByRole('button',{name:'Close dialog',exact:true}).click();
      assert.equal(await nav.locator('.sms-nav-unread-badge').count(),0);
      assert.equal(await page.evaluate(()=>__readWrites.at(-1).path),'users/customer-two/smsReads/complete-b');

      // Simulate an older deployment that denies both receipt reads and writes.
      await context.addInitScript(()=>{__failSmsReadSave=true;__failSmsReadListen=true;});
      await page.evaluate(()=>{localStorage.removeItem('kyetech:sms-viewed:v1:default:customer-one');sessionStorage.removeItem('fixture-sms-reads');});
      await page.reload({waitUntil:'networkidle'});
      await nav.getByRole('button',{name:'SMS',exact:true}).click();
      assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'4');
      await firstView.click();
      assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'3');
      assert.equal(await page.getByRole('alert').filter({hasText:'Could not save this SMS as viewed'}).count(),0);
      await page.reload({waitUntil:'networkidle'});
      await nav.getByRole('button',{name:'SMS',exact:true}).click();
      assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'3','Viewed status survives reload even when Firestore rejects reads and writes.');
      assert.ok(await page.evaluate(()=>__readAttempts<=2),'Denied saves cannot create a retry loop.');

      const otherTab=await context.newPage();
      await otherTab.goto(baseUrl,{waitUntil:'networkidle'});
      const otherNav=otherTab.getByRole('navigation',{name:width<720?'Mobile navigation':'Main navigation',exact:true});
      await otherNav.getByRole('button',{name:'SMS',exact:true}).click();
      await otherTab.getByRole('button',{name:'View pickup SMS KYE-RDER-B',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('.sms-nav-unread-badge')?.textContent==='2');
      assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'2','Viewed messages update other tabs through private browser storage.');
      await otherTab.close();
      await page.evaluate(()=>{__failSmsReadSave=false;__failSmsReadListen=false;window.dispatchEvent(new Event('online'));});
      await page.waitForFunction(()=>__readWrites.length===2);
      assert.deepEqual(await page.evaluate(()=>__readWrites.map(write=>write.path).sort()),['users/customer-one/smsReads/complete-b','users/customer-one/smsReads/pickup-b']);
      assert.ok(await page.evaluate(()=>__listenAttempts>=2),'Failed subscriptions reconnect during recovery.');

      // If the browser also blocks storage, retain the honest retry error.
      await context.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new Error('Fixture storage blocked');}});});
      await page.reload({waitUntil:'networkidle'});
      await nav.getByRole('button',{name:'SMS',exact:true}).click();
      await firstView.click();
      await page.getByRole('alert').filter({hasText:'Could not save this SMS as viewed'}).waitFor();
      assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'4','A failure in both storage locations cannot claim viewed status was saved.');
      await smsDetails.getByRole('button',{name:'Close dialog',exact:true}).click();
      await page.evaluate(() => globalThis.__updateSmsFixture({ smsMessages: [] }));
      await page.getByRole('heading', { name: 'No SMS yet', exact: true }).waitFor();
      await noOverflow(page, `${width}px empty inbox`);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}px customer SMS: red unread counts, SMS before Profile, browser persistence, denied-server-save recovery, background retry, filters, copying, ratings, and private account switching.`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
