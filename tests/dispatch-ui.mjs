// Local browser verification: mock accounts and GPS; block all external requests.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../.verification/login-tools/node_modules/playwright/index.mjs';

const baseUrl = process.env.DISPATCH_UI_URL || 'http://localhost:5173/';
const origin = new URL(baseUrl).origin;
const output = '.verification/dispatch';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const fixtureModule = [
  "import React from '/node_modules/.vite/deps/react.js';",
  'const listeners = new Set(); let state = globalThis.__dispatchFixture;',
  'function publish(patch) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }',
  'globalThis.__updateDispatchFixture = publish;',
  'export function PlatformProvider({children}) { return children; }',
  'export function usePlatform() {',
  'const snapshot = React.useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => state);',
  'return { ...snapshot, user: snapshot.user ? {...snapshot.user, getIdToken: async () => "fixture-token"} : null, clearError() {}, async logout() {}, async saveProfile() {}, async createOrder(payload) {',
  'globalThis.__dispatchOrders.push(payload); return "test-order";',
  '} }; }',
].join('\n');

function fixture(role = 'customer') {
  const profile = { id: role === 'merchant' ? 'store-one' : 'customer-one', name: 'Abena Customer', email: 'customer@example.invalid', role, phone: '+233241234567', city: 'Takoradi', accountStatus: 'active' };
  const store = (id, name, address, patch = {}) => ({ id, ownerId: id, name, address, phone: '+233241234567', category: 'Groceries', description: 'Local shop', open: true, approvalStatus: 'approved', accountStatus: 'active', ...patch });
  return { user: { uid: profile.id }, profile, isAdmin: false, authLoading: false, adminLoading: false, dataLoading: false, error: '', riders: [], orders: [], smsMessages: [], stores: [
    store('store-one', 'Ada Shop', 'Market Circle, Takoradi'),
    store('store-two', 'Kojo Groceries', 'Kojokrom, near the station'),
    store('store-closed', 'Closed Shop', 'Closed address', { open: false }),
    store('store-pending', 'Pending Shop', 'Pending address', { approvalStatus: 'pending' }),
    store('store-suspended', 'Suspended Shop', 'Suspended address', { accountStatus: 'suspended' }),
  ] };
}

async function makePage({ width = 1366, mode = 'granted', role = 'customer', stores } = {}) {
  const state = fixture(role);
  if (stores) state.stores = stores;
  const context = await browser.newContext({ viewport: { width, height: 900 }, ...(mode === 'granted' ? { geolocation: { latitude: 4.8917, longitude: -1.7554, accuracy: 20 }, permissions: ['geolocation'] } : {}) });
  await context.addInitScript(({ state, mode }) => {
    globalThis.__dispatchFixture = state;
    globalThis.__dispatchOrders = [];
    globalThis.__geoCalls = [];
    const original = navigator.geolocation?.getCurrentPosition.bind(navigator.geolocation);
    Object.defineProperty(navigator, 'geolocation', { value: mode === 'unsupported' ? undefined : {
      getCurrentPosition(success, failure, options) {
        globalThis.__geoCalls.push(options);
        if (mode === 'granted') return original(success, failure, options);
        if (mode === 'deferred') { globalThis.__gpsSuccess = success; return; }
        if (mode === 'invalid') return queueMicrotask(() => success({ coords: { latitude: 100, longitude: 200 } }));
        queueMicrotask(() => failure({ code: mode === 'denied' ? 1 : mode === 'timeout' ? 3 : 2 }));
      },
    } });
  }, { state, mode });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/gps-address' && url.origin === origin) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({address:'Market Circle, Takoradi, Western Region, Ghana'})});
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
    if (url.pathname === '/src/context/PlatformContext.jsx') return route.fulfill({ status: 200, contentType: 'application/javascript', body: fixtureModule });
    return route.continue();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  return { context, page, errors };
}
async function openDispatch(page, role = 'customer') {
  if(role==='merchant')await page.locator('.merchant-welcome').getByRole('button',{name:'Request a rider',exact:true}).click();
  else await page.getByRole('button',{name:'Request a rider',exact:true}).click();
  await page.getByRole('dialog').waitFor();
}
const storePicker = page => page.getByRole('combobox', { name: /^Pickup store \(optional\)/ });
async function chooseStore(page,id) { await storePicker(page).click(); await page.getByRole('listbox',{name:'Pickup stores',exact:true}).locator('[data-store-id="'+id+'"]').click(); }
const selectedStoreId = page => page.locator('input[type=hidden][name=merchantId]').inputValue();
async function completeForm(page) {
  await page.getByLabel('Recipient name', { exact: true }).fill('Kwame Receiver');
  await page.getByLabel('Recipient phone', { exact: true }).fill('0241234567');
  await page.getByLabel('Package details', { exact: true }).fill('One bag of groceries.');
}
async function noOverflow(page, label) {
  const widths = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
  assert.ok(widths[1] <= widths[0] + 1, label + ' overflows horizontally: ' + widths);
}
async function check(name, task) { await task(); console.log('PASS ' + name); }

try {
  for (const width of [1366, 390, 320]) await check(width + 'px store pickup and browser GPS save valid booking details and rider directions', async () => {
    const { context, page, errors } = await makePage({ width });
    try {
      await openDispatch(page);
      assert.equal(await page.evaluate(() => __geoCalls.length), 0, 'GPS must not run before a click.');
      await storePicker(page).click();
      assert.equal(await page.getByRole('listbox',{name:'Pickup stores',exact:true}).getByRole('option').count(), 3);
      await storePicker(page).press('Escape');
      await page.getByLabel('Pickup address', { exact: true }).fill('My manual pickup');
      await chooseStore(page,'store-one');
      assert.equal(await page.getByLabel('Pickup address', { exact: true }).inputValue(), 'Market Circle, Takoradi');
      assert.equal(await page.getByLabel('Pickup address', { exact: true }).getAttribute('readonly'), '');
      await chooseStore(page,'store-two');
      assert.equal(await page.getByLabel('Pickup address', { exact: true }).inputValue(), 'Kojokrom, near the station');
      await chooseStore(page,'');
      assert.equal(await page.getByLabel('Pickup address', { exact: true }).inputValue(), 'My manual pickup');
      await chooseStore(page,'store-one');
      await page.getByRole('button', { name: 'Use my current location', exact: true }).click();
      await page.getByRole('link', { name: 'View on map', exact: true }).waitFor();
      const coordinates = '4.891700, -1.755400';
      assert.equal(await page.getByLabel('Drop-off address', { exact: true }).inputValue(), 'Market Circle, Takoradi, Western Region, Ghana');
      assert.equal(new URL(await page.getByRole('link', { name: 'View on map', exact: true }).getAttribute('href')).searchParams.get('query'), coordinates);
      assert.deepEqual(await page.evaluate(() => __geoCalls), [{ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }]);
      await noOverflow(page, width + 'px dispatch');
      await page.screenshot({ path: output + '/customer-' + width + '.png', fullPage: true });
      await completeForm(page);
      await page.getByRole('button', { name: 'Send delivery request', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const payload = await page.evaluate(() => __dispatchOrders[0]);
      assert.equal(payload.pickup, 'Market Circle, Takoradi');
      assert.equal(payload.merchantId, 'store-one');
      assert.equal(payload.dropoff, 'Market Circle, Takoradi, Western Region, Ghana');
      assert.deepEqual(payload.dropoffLocation, {latitude:4.8917,longitude:-1.7554});
      // Render the same booking in the rider workspace and check both map destinations.
      await page.evaluate(payload => {
        const rider = { id: 'rider-one', role: 'rider', name: 'Ama Rider', city: 'Takoradi', phone: '+233241234567', accountStatus: 'active', approvalStatus: 'approved', online: true };
        globalThis.__updateDispatchFixture({ user: { uid: rider.id }, profile: rider, orders: [{ ...payload, id: 'test-order', riderId: rider.id, riderName: rider.name, creatorId: 'customer-one', creatorRole: 'customer', customerName: 'Abena Customer', customerPhone: '+233241234567', status: 'accepted', createdAt: Date.now() }] });
      }, payload);
      const directions = page.getByRole('link', { name: 'Directions', exact: true });
      await directions.waitFor();
      assert.equal(new URL(await directions.getAttribute('href')).searchParams.get('query'), payload.pickup);
      // After pickup, directions should target the customer's GPS point.
      await page.evaluate(payload => globalThis.__updateDispatchFixture({ orders: [{ ...payload, id: 'test-order', riderId: 'rider-one', riderName: 'Ama Rider', creatorId: 'customer-one', status: 'picked_up', customerName: 'Abena Customer', customerPhone: '+233241234567', createdAt: Date.now() }] }), payload);
      await directions.waitFor();
      assert.equal(new URL(await directions.getAttribute('href')).searchParams.get('query'), coordinates);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Store-directory bookings start with the matching store selected', async () => {
    const { page, context, errors } = await makePage();
    try {
      await page.getByRole('button', { name: /Find Store/ }).click();
      await page.locator('.store-card').filter({ has: page.getByRole('heading', { name: 'Ada Shop', exact: true }) }).getByRole('button', { name: 'Request delivery', exact: true }).click();
      await storePicker(page).waitFor();
      assert.equal(await selectedStoreId(page), 'store-one');
      assert.equal(await page.getByLabel('Pickup address', { exact: true }).inputValue(), 'Market Circle, Takoradi');
      assert.equal(await page.evaluate(() => __geoCalls.length), 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  for (const mode of ['denied', 'timeout', 'unavailable', 'unsupported', 'invalid']) await check('GPS ' + mode + ' preserves manual drop-off and allows booking', async () => {
    const { context, page, errors } = await makePage({ mode });
    try {
      await openDispatch(page);
      await page.getByLabel('Pickup address', { exact: true }).fill('Home pickup');
      await page.getByLabel('Drop-off address', { exact: true }).fill('Effia Community Center');
      await page.getByRole('button', { name: 'Use my current location', exact: true }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByLabel('Drop-off address', { exact: true }).inputValue(), 'Effia Community Center');
      assert.equal(await page.getByRole('button', { name: 'Send delivery request', exact: true }).isEnabled(), true);
      await completeForm(page);
      await page.getByRole('button', { name: 'Send delivery request', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => __dispatchOrders[0].dropoff), 'Effia Community Center');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Late GPS results cannot overwrite manual edits or a newly opened form', async () => {
    const { context, page, errors } = await makePage({ mode: 'deferred' });
    try {
      await openDispatch(page);
      await page.getByRole('button', { name: 'Use my current location', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Send delivery request', exact: true }).isEnabled(), false);
      await page.getByLabel('Drop-off address', { exact: true }).fill('Manual destination');
      await page.evaluate(() => __gpsSuccess({ coords: { latitude: 4.8, longitude: -1.7, accuracy: 10 } }));
      assert.equal(await page.getByLabel('Drop-off address', { exact: true }).inputValue(), 'Manual destination');
      assert.equal(await page.getByRole('link', { name: 'View on map', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Use my current location', exact: true }).click();
      await page.getByRole('button', { name: 'Close dialog', exact: true }).dispatchEvent('click');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await openDispatch(page);
      await page.evaluate(() => __gpsSuccess({ coords: { latitude: 4.8, longitude: -1.7, accuracy: 10 } }));
      assert.equal(await page.getByLabel('Drop-off address', { exact: true }).inputValue(), '');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Unavailable stores cannot be submitted; customers can choose a manual pickup', async () => {
    const { context, page, errors } = await makePage();
    try {
      await openDispatch(page);
      await chooseStore(page,'store-one');
      await page.getByLabel('Drop-off address', { exact: true }).fill('Effia Community Center');
      await completeForm(page);
      await page.evaluate(() => globalThis.__updateDispatchFixture({ stores: [] }));
      await page.getByText('Choose another store or enter a pickup address.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Send delivery request', exact: true }).click();
      assert.equal(await page.evaluate(() => __dispatchOrders.length), 0);
      await chooseStore(page,'');
      await page.getByLabel('Pickup address', { exact: true }).fill('Manual pickup');
      await page.getByRole('button', { name: 'Send delivery request', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => __dispatchOrders[0].merchantId), '');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Merchants keep their own store as the pickup', async () => {
    const { context, page, errors } = await makePage({ role: 'merchant' });
    try {
      await openDispatch(page, 'merchant');
      assert.equal(await storePicker(page).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Use my current location', exact: true }).count(), 0);
      assert.equal(await page.getByLabel('Pickup address', { exact: true }).inputValue(), 'Market Circle, Takoradi');
      await page.getByLabel('Drop-off address', { exact: true }).fill('Effia Community Center');
      await completeForm(page);
      await page.getByRole('button', { name: 'Send delivery request', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => __dispatchOrders[0].merchantId), 'store-one');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
} finally { await browser.close(); }
