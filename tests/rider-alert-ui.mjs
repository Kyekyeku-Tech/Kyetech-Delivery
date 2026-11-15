// Isolated rider UI fixture with mocked identity, push subscription and API.
// No Firebase traffic, delivery creation, device subscription or push delivery.
// Build the production app first to exercise its real service worker.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

let playwright;
try { playwright = await import('playwright'); } catch { playwright = await import('../.verification/login-tools/node_modules/playwright/index.mjs'); }
const fixture = resolve('.verification/rider-alert-ui'); await mkdir(fixture, { recursive: true });
const productionDist = resolve('dist');
await readFile(resolve(productionDist, 'sw.js'));
await writeFile(resolve(fixture, 'index.html'), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>');
await writeFile(resolve(fixture, 'context.jsx'), `import { createContext, useContext } from 'react';export const Context=createContext(null);export const usePlatform=()=>useContext(Context);`);
await writeFile(resolve(fixture, 'main.jsx'), `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Context} from './context';import RiderAlerts from '../../src/components/RiderAlerts';import '../../src/styles.css';import '../../src/theme.css';
const user={uid:'fixture-rider',getIdToken:async()=>'fixture-token'};
const order=id=>({id,status:'pending',riderId:null,createdAt:Date.now()});
function Fixture(){const [state,setState]=useState({user,profile:{id:user.uid,role:'rider',approvalStatus:'approved',accountStatus:'active',online:true},isAdmin:false,orders:[order('old')],riderRequestsReady:true});window.__setAlerts=patch=>setState(previous=>({...previous,...patch}));window.__order=order;return <Context.Provider value={state}><div style={{padding:16,maxWidth:950,margin:'auto'}}><RiderAlerts onViewRequests={()=>window.__viewRequests=(window.__viewRequests||0)+1}/></div></Context.Provider>;}createRoot(document.getElementById('root')).render(<Fixture/>);`);
await build({ configFile: false, root: fixture, logLevel: 'error', plugins: [react()], resolve: { alias: [{ find: /.*context\/PlatformContext$/, replacement: resolve(fixture, 'context.jsx') }] }, build: { outDir: resolve(fixture, 'dist'), emptyOutDir: true } });
const key = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 5)]).toString('base64url');
const apiCalls = [];
const heldImages = new Set();
let failWorkerRequests = false;
let failPrecacheRequests = false;
const releasePageLoad = () => {
  for (const response of heldImages) {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'));
  }
  heldImages.clear();
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'), path = url.pathname;
  if (path === '/verification/hold-page-load.png') {
    heldImages.add(res);
    res.on('close', () => heldImages.delete(res));
    return;
  }
  if (path === '/sw.js' && failWorkerRequests) {
    res.writeHead(503, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    res.end('Worker temporarily unavailable');
    return;
  }
  if (path === '/offline.html' && failPrecacheRequests) {
    res.writeHead(503, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end('Precache asset temporarily unavailable');
    return;
  }
  if (path === '/api/rider-alerts') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    apiCalls.push({ method: req.method, authorization: req.headers.authorization, body: raw && JSON.parse(raw) });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(req.method === 'GET' ? { publicKey: key } : { ok: true })); return;
  }
  try {
    const filePath = path === '/' ? 'index.html' : '.' + path;
    const fixtureDist = resolve(fixture, 'dist');
    const fixtureFile = resolve(fixtureDist, filePath), productionFile = resolve(productionDist, filePath);
    if (!fixtureFile.startsWith(fixtureDist + sep) || !productionFile.startsWith(productionDist + sep)) { res.writeHead(400); res.end(); return; }
    let bytes;
    try { bytes = await readFile(fixtureFile); }
    catch { bytes = await readFile(productionFile); }
    if (path === '/' && url.searchParams.has('hold-load')) bytes = Buffer.from(bytes.toString().replace('</body>', '<img src="/verification/hold-page-load.png" width="1" height="1" alt=""></body>'));
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' })[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...(path === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await playwright.chromium.launch({ headless: true });
async function pageFor({ width = 390, ios = false, permission = 'granted', realWorker = false, holdLoad = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, userAgent: ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1' : 'Mozilla/5.0 (Linux; Android 14) Chrome/147.0.0.0 Mobile Safari/537.36' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addInitScript(({ permission, key, realWorker }) => {
    window.__permissionCalls = 0; window.__permissionChoice = permission;
    class Notification { static permission = 'default'; static async requestPermission() { window.__permissionCalls++; window.__permissionWasGesture = navigator.userActivation.isActive; this.permission = window.__permissionChoice; return this.permission; } }
    Object.defineProperty(window, 'Notification', { configurable: true, value: Notification });
    let subscription = null;
    window.__pushSubscriptions = 0;
    const pushManager = { async getSubscription() { return subscription; }, async subscribe() { window.__pushSubscriptions++; subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/ui-fixture', options: {}, toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: key, auth: 'AQEBAQEBAQEBAQEBAQEBAQ' } }; }, async unsubscribe() { subscription = null; window.__unsubscribed = true; return true; } }; return subscription; } };
    if (realWorker) {
      // Keep registration and activation native; never create a real device subscription.
      Object.defineProperty(PushManager.prototype, 'getSubscription', { configurable: true, value: pushManager.getSubscription });
      Object.defineProperty(PushManager.prototype, 'subscribe', { configurable: true, value: pushManager.subscribe });
      window.__workerRegistrations = [];
      const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = (scriptURL, options) => {
        window.__workerRegistrations.push({ scriptURL, options, readyState: document.readyState });
        return register(scriptURL, options);
      };
    } else {
      Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
      const registration = { active: { state: 'activated' }, pushManager };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration), getRegistration: async () => registration, register: async () => registration } });
    }
  }, { permission, key, realWorker });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(holdLoad ? `${origin}/?hold-load=1` : origin, { waitUntil: holdLoad ? 'domcontentloaded' : 'load' }); await page.getByRole('button', { name: 'Enable alerts', exact: true }).waitFor();
  return { page, context, errors };
}
try {
  const slow = await pageFor({ realWorker: true, holdLoad: true });
  try {
    assert.notEqual(await slow.page.evaluate(() => document.readyState), 'complete');
    assert.equal(await slow.page.evaluate(() => navigator.serviceWorker.controller), null);
    const before = apiCalls.length;
    await slow.page.getByRole('button', { name: 'Enable alerts', exact: true }).click();
    await slow.page.getByText('Phone notifications are on, including when the app is closed or your screen is locked.').waitFor({ timeout: 10000 });
    const worker = await slow.page.evaluate(async () => ({ attempts: window.__workerRegistrations, state: (await navigator.serviceWorker.getRegistration('/')).active.state, readyState: document.readyState, subscriptions: window.__pushSubscriptions }));
    assert.deepEqual(worker.attempts, [{ scriptURL: '/sw.js', options: { scope: '/', updateViaCache: 'none' }, readyState: 'interactive' }]);
    assert.equal(worker.state, 'activated');
    assert.equal(worker.readyState, 'interactive', 'Alerts must finish before the delayed page load event.');
    assert.equal(worker.subscriptions, 1);
    assert.ok(apiCalls.slice(before).some(call => call.method === 'POST' && call.body.action === 'subscribe'));
    assert.deepEqual(slow.errors, []);
    releasePageLoad();
    await slow.page.waitForLoadState('load');
  } finally { releasePageLoad(); await slow.context.close(); }
  console.log('PASS rider alerts explicitly activate the production worker while page load is still pending');

  for (const failure of ['registration', 'precache']) {
    failWorkerRequests = failure === 'registration';
    failPrecacheRequests = failure === 'precache';
    const retry = await pageFor({ realWorker: true, holdLoad: true });
    try {
      const before = apiCalls.length, started = Date.now();
      await retry.page.getByRole('button', { name: 'Enable alerts', exact: true }).click();
      await retry.page.locator('.rider-alerts-message').waitFor({ timeout: 5000 });
      assert.equal(await retry.page.locator('.rider-alerts-message').innerText(), 'Phone notifications could not start. Check your connection and tap Enable alerts again.');
      assert.ok(Date.now() - started < 5000, 'A failed worker must report promptly instead of waiting on serviceWorker.ready.');
      assert.ok(!apiCalls.slice(before).some(call => call.method === 'POST' && call.body.action === 'subscribe'));
      assert.equal(await retry.page.getByRole('button', { name: 'Enable alerts', exact: true }).isEnabled(), true);
      failWorkerRequests = false;
      failPrecacheRequests = false;
      await retry.page.getByRole('button', { name: 'Enable alerts', exact: true }).click();
      await retry.page.getByText('Phone notifications are on, including when the app is closed or your screen is locked.').waitFor({ timeout: 10000 });
      assert.equal(await retry.page.evaluate(() => window.__workerRegistrations.length), 2);
      assert.equal(await retry.page.evaluate(() => document.readyState), 'interactive');
      assert.equal(await retry.page.locator('.rider-alerts-message').count(), 0);
      assert.deepEqual(retry.errors, []);
    } finally { failWorkerRequests = false; failPrecacheRequests = false; releasePageLoad(); await retry.context.close(); }
    console.log(`PASS a failed production worker ${failure} explains the error promptly and retries without reopening the app`);
  }

  for (const width of [320, 390, 1366]) {
    const { page, context, errors } = await pageFor({ width });
    await page.getByRole('button', { name: 'Enable alerts', exact: true }).click();
    await page.getByText('Phone notifications are on, including when the app is closed or your screen is locked.').waitFor();
    assert.equal(await page.evaluate(() => window.__permissionWasGesture), true);
    assert.equal(await page.getByText('New delivery request received', { exact: true }).count(), 0);
    await page.evaluate(() => window.__setAlerts({ orders: [window.__order('old'), window.__order('new')] }));
    await page.getByText('New delivery request received', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'View requests', exact: true }).click(); assert.equal(await page.evaluate(() => window.__viewRequests), 1);
    await page.evaluate(() => window.__setAlerts({ orders: [window.__order('old'), window.__order('new')] })); assert.equal(await page.getByText('New delivery request received', { exact: true }).count(), 0);
    await page.evaluate(() => window.__setAlerts({ profile: { id: 'fixture-rider', role: 'rider', approvalStatus: 'approved', accountStatus: 'active', online: false } }));
    await page.getByText('Go online to receive new requests.').waitFor();
    await page.evaluate(() => window.__setAlerts({ orders: [window.__order('offline')] }));
    await page.evaluate(() => window.__setAlerts({ profile: { id: 'fixture-rider', role: 'rider', approvalStatus: 'approved', accountStatus: 'active', online: true } }));
    await page.getByText('Go online to receive new requests.').waitFor({ state: 'hidden' }); assert.equal(await page.getByText('New delivery request received', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Turn off', exact: true }).click(); await page.waitForFunction(() => window.__unsubscribed === true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(fixture, `alerts-${width}.png`), fullPage: true }); await context.close();
    console.log(`PASS rider alerts: permission, fresh requests, online state, mute and layout at ${width}px`);
  }
  const denied = await pageFor({ permission: 'denied' }); await denied.page.getByRole('button', { name: 'Enable alerts', exact: true }).click();
  await denied.page.getByText(/Phone notifications are blocked/).waitFor(); await denied.page.getByRole('button', { name: 'Test sound', exact: true }).waitFor(); assert.deepEqual(denied.errors, []); await denied.context.close();
  console.log('PASS permission denial preserves sound controls and explains recovery');
  const ios = await pageFor({ ios: true }); await ios.page.getByText(/Requires iOS 16.4 or later/).waitFor(); await ios.page.getByRole('button', { name: 'Enable alerts', exact: true }).click();
  await ios.page.getByRole('button', { name: 'Test sound', exact: true }).waitFor(); assert.equal(await ios.page.evaluate(() => window.__permissionCalls), 0); assert.deepEqual(ios.errors, []); await ios.context.close();
  assert.ok(apiCalls.every(call => call.authorization === 'Bearer fixture-token')); assert.ok(apiCalls.some(call => call.method === 'DELETE'));
  console.log('PASS iPhone browser guidance requires Home Screen installation before background push');
} finally { releasePageLoad(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
