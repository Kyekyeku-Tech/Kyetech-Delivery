// Isolated merchant UI verification; no account changes or real image uploads.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../.verification/login-tools/node_modules/playwright/index.mjs';
const baseUrl = process.env.STORE_UI_URL || 'http://localhost:5173/';
const origin = new URL(baseUrl).origin, output = '.verification/store';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const providerModule = [
  "import React from '/node_modules/.vite/deps/react.js';",
  'const listeners = new Set(); let state = globalThis.__storeFixture;',
  'function publish(patch) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }',
  'globalThis.__updateStoreFixture = publish;',
  'export function PlatformProvider({children}) { return children; }',
  'export function usePlatform() {',
  'const snapshot = React.useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => state);',
  'return { ...snapshot, user: snapshot.user ? {...snapshot.user, getIdToken: async () => "fixture-token"} : null, clearError() {}, async logout() {}, async saveStore(payload) {',
  'if (globalThis.__failSave) { globalThis.__failSave = false; throw new Error("Store save failed. Please retry."); }',
  'globalThis.__storeCalls.push(JSON.parse(JSON.stringify(payload)));',
  'publish({ stores: [{ ...payload, id: state.profile.id, ownerId: state.profile.id, approvalStatus: "pending", accountStatus: "active" }] });',
  '} }; }',
].join('\n');
const imageModule = [
  "export { IMAGE_ACCEPT, validateImageFile } from '/src/lib/imageUpload.js?store-fixture-original';",
  'export async function uploadImageToImgbb(file, progress, {signal}) {',
  'globalThis.__uploadCalls += 1; progress(50);',
  'return new Promise((resolve, reject) => {',
  'globalThis.__finishUpload = () => { progress(100); resolve(location.origin + "/images/rider.png"); };',
  'globalThis.__failUpload = () => reject(new Error("Photo upload failed. Check your connection and retry."));',
  'signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), {once:true});',
  '}); }',
].join('\n');

async function makePage({ width = 1366, mode = 'granted' } = {}) {
  const profile = { id: 'merchant-one', role: 'merchant', name: 'Ada Merchant', email: 'merchant@example.invalid', phone: '+233241234567', city: 'Takoradi', accountStatus: 'active' };
  const state = { user: { uid: profile.id }, profile, isAdmin: false, authLoading: false, adminLoading: false, dataLoading: false, error: '', riders: [], orders: [], stores: [], smsMessages: [] };
  const context = await browser.newContext({ viewport: { width, height: 900 }, ...(mode === 'granted' ? { geolocation: { latitude: 4.8917, longitude: -1.7554, accuracy: 20 }, permissions: ['geolocation'] } : {}) });
  await context.addInitScript(({ state, mode }) => {
    globalThis.__storeFixture = state; globalThis.__storeCalls = []; globalThis.__uploadCalls = 0; globalThis.__geoCalls = 0;
    const original = navigator.geolocation?.getCurrentPosition.bind(navigator.geolocation);
    Object.defineProperty(navigator, 'geolocation', { value: mode === 'unsupported' ? undefined : {
      getCurrentPosition(success, failure, options) {
        globalThis.__geoCalls += 1;
        if (mode === 'granted') return original(success, failure, options);
        if (mode === 'deferred') { globalThis.__gpsSuccess = success; return; }
        queueMicrotask(() => failure({ code: mode === 'denied' ? 1 : 3 }));
      },
    } });
  }, { state, mode });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/gps-address' && url.origin === origin) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({address:'Market Circle, Takoradi, Western Region, Ghana'})});
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
    if (url.pathname === '/src/context/PlatformContext.jsx') return route.fulfill({ status: 200, contentType: 'application/javascript', body: providerModule });
    if (url.pathname === '/src/lib/imageUpload.js' && !url.search.includes('store-fixture-original')) return route.fulfill({ status: 200, contentType: 'application/javascript', body: imageModule });
    return route.continue();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Set up store', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  return { page, context, errors };
}
async function details(page) {
  await page.getByLabel('Store name', { exact: true }).fill('Ada Groceries');
  await page.getByLabel('Category', { exact: true }).selectOption('Groceries');
  await page.getByLabel('Store address', { exact: true }).fill('Market Circle, Takoradi, Western Region, Ghana');
  await page.getByLabel('Store phone', { exact: true }).fill('+233241234567');
  await page.getByLabel('About your store', { exact: true }).fill('Fresh groceries and everyday essentials.');
}
async function noOverflow(page, label) {
  const sizes = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
  assert.ok(sizes[1] <= sizes[0] + 1, label + ' overflows: ' + sizes);
}
async function check(name, task) { await task(); console.log('PASS ' + name); }
const upload = page => page.getByLabel('Upload store photo', { exact: true });

try {
  for (const width of [1366, 390, 320]) await check(width + 'px merchant store: photo upload, GPS, saved preview, edit, and rider pickup pin', async () => {
    const { context, page, errors } = await makePage({ width });
    try {
      await details(page);
      assert.equal(await page.evaluate(() => __geoCalls), 0);
      await page.getByRole('button', { name: 'Use current location', exact: true }).click();
      await page.getByRole('link', { name: 'View on map', exact: true }).waitFor();
      await page.getByText('Location captured', {exact:false}).waitFor();
      assert.equal(await page.getByLabel('Store address', { exact: true }).inputValue(), 'Market Circle, Takoradi, Western Region, Ghana');
      assert.equal(new URL(await page.getByRole('link', { name: 'View on map', exact: true }).getAttribute('href')).searchParams.get('query'), '4.891700, -1.755400');
      await noOverflow(page, width + 'px store form');
      await page.screenshot({ path: output + '/setup-' + width + '.png', fullPage: true });
      await upload(page).setInputFiles('public/images/rider.png');
      await page.getByRole('progressbar', { name: 'Photo upload progress', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Save store', exact: true }).isEnabled(), false);
      await page.getByRole('button', { name: 'Close dialog', exact: true }).dispatchEvent('click');
      assert.equal(await page.getByRole('dialog').count(), 1, 'Uploading should keep the store form open.');
      await page.evaluate(() => __finishUpload());
      await page.getByText('Photo uploaded. Save your changes to use it.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Save store', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('heading', { name: 'Ada Groceries', exact: true }).waitFor();
      const saved = await page.evaluate(() => __storeCalls[0]);
      assert.equal(saved.imageUrl, origin + '/images/rider.png');
      assert.deepEqual(saved.location, { latitude: 4.8917, longitude: -1.7554 });
      assert.equal(saved.address, 'Market Circle, Takoradi, Western Region, Ghana');
      assert.equal(new URL(await page.getByRole('link', { name: 'View location', exact: true }).getAttribute('href')).searchParams.get('query'), '4.891700, -1.755400');
      await page.getByRole('button', { name: 'Edit store', exact: true }).click();
      await page.getByRole('button', { name: 'Remove GPS pin', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Remove GPS pin', exact: true }).click();
      await page.getByRole('button', { name: 'Remove', exact: true }).click();
      await page.getByRole('button', { name: 'Save store', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => __storeCalls[1].location), null);
      assert.equal(await page.evaluate(() => __storeCalls[1].imageUrl), '');
      // A booking keeps its original pickup pin after the store pin changes.
      await page.evaluate(saved => {
        const rider = { id: 'rider-one', role: 'rider', name: 'Ama Rider', phone: '+233241234567', city: 'Takoradi', accountStatus: 'active', approvalStatus: 'approved', online: true };
        __updateStoreFixture({ user: { uid: rider.id }, profile: rider, orders: [{ id: 'store-booking', status: 'accepted', riderId: rider.id, riderName: rider.name, merchantId: 'merchant-one', pickup: saved.address, pickupLocation: saved.location, dropoff: 'Effia', customerName: 'Ada Merchant', customerPhone: '+233241234567', recipientName: 'Kwame', recipientPhone: '+233551234567', fee: 25, packageDescription: 'Groceries', createdAt: Date.now() }] });
      }, saved);
      const directions = page.getByRole('link', { name: 'Directions', exact: true });
      await directions.waitFor();
      assert.equal(new URL(await directions.getAttribute('href')).searchParams.get('query'), '4.891700, -1.755400');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Invalid photos, upload failures, retry, and save failures remain editable', async () => {
    const { context, page, errors } = await makePage();
    try {
      await details(page);
      await upload(page).setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
      await page.getByRole('alert').filter({ hasText: 'Choose a JPG' }).waitFor();
      assert.equal(await page.evaluate(() => __uploadCalls), 0);
      await upload(page).setInputFiles('public/images/rider.png');
      await page.getByRole('progressbar').waitFor();
      await page.evaluate(() => __failUpload());
      await page.getByRole('alert').filter({ hasText: 'Photo upload failed' }).waitFor();
      await page.getByRole('button', { name: 'Retry upload', exact: true }).click();
      await page.getByRole('progressbar').waitFor();
      await page.evaluate(() => __finishUpload());
      await page.getByRole('progressbar').waitFor({ state: 'hidden' });
      await page.evaluate(() => { globalThis.__failSave = true; });
      await page.getByRole('button', { name: 'Save store', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Store save failed' }).waitFor();
      assert.equal(await page.getByLabel('Store name', { exact: true }).inputValue(), 'Ada Groceries');
      await page.getByRole('button', { name: 'Save store', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  for (const mode of ['denied', 'timeout', 'unsupported']) await check('Merchant GPS ' + mode + ' allows a written pickup address', async () => {
    const { context, page, errors } = await makePage({ mode });
    try {
      await details(page);
      await page.getByRole('button', { name: 'Use current location', exact: true }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Save store', exact: true }).isEnabled(), true);
      await page.getByRole('button', { name: 'Save store', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => __storeCalls[0].location), null);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Closing the store form discards a late GPS result', async () => {
    const { context, page, errors } = await makePage({ mode: 'deferred' });
    try {
      await page.getByRole('button', { name: 'Use current location', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Save store', exact: true }).isEnabled(), false);
      await page.getByRole('button', { name: 'Close dialog', exact: true }).dispatchEvent('click');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Set up store', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.evaluate(() => __gpsSuccess({ coords: { latitude: 4.8, longitude: -1.7, accuracy: 10 } }));
      assert.equal(await page.getByRole('link', { name: 'View on map', exact: true }).count(), 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
} finally { await browser.close(); }
