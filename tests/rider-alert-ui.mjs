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
await writeFile(resolve(fixture, 'main.jsx'), `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Context} from './context';import RiderAlerts from '../../src/components/RiderAlerts';import {initializeAppInstall,appInstallSnapshot} from '../../src/lib/appInstall';import '../../src/styles.css';import '../../src/theme.css';
initializeAppInstall();window.__installSnapshot=appInstallSnapshot;
const user={uid:'fixture-rider',getIdToken:async()=>'fixture-token'};
const order=id=>({id,status:'pending',riderId:null,createdAt:Date.now()});
function Fixture(){const [state,setState]=useState({user,profile:{id:user.uid,role:'rider',approvalStatus:'approved',accountStatus:'active',online:true},isAdmin:false,orders:[order('old'),{...order('done'),status:'delivered'},{...order('assigned'),riderId:'another-rider'},{...order('preferred'),preferredRiderId:'another-rider'}],riderRequestsReady:true});window.__alertsState=state;window.__setAlerts=patch=>setState(previous=>({...previous,...patch}));window.__order=order;return <Context.Provider value={state}><div style={{padding:16,maxWidth:950,margin:'auto'}}><RiderAlerts onViewRequests={()=>window.__viewRequests=(window.__viewRequests||0)+1}/></div></Context.Provider>;}createRoot(document.getElementById('root')).render(<Fixture/>);`);
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
const origin = `http://127.0.0.1:${server.address().port}`, browser = await playwright.chromium.launch({ headless: true, channel: 'chromium' });
async function pageFor({ width = 390, ios = false, permission = 'granted', realWorker = false, holdLoad = false, installed = false, standalone = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, userAgent: ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1' : 'Mozilla/5.0 (Linux; Android 14) Chrome/147.0.0.0 Mobile Safari/537.36' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addInitScript(({ permission, key, realWorker, installed, standalone }) => {
    if (installed) localStorage.setItem('kyetech:app-installed', '1');
    if (standalone) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    window.__permissionCalls = 0; window.__permissionChoice = permission;
    class Notification { static permission = 'default'; static async requestPermission() { window.__permissionCalls++; window.__permissionWasGesture = navigator.userActivation.isActive; this.permission = window.__permissionChoice; return this.permission; } }
    Object.defineProperty(window, 'Notification', { configurable: true, value: Notification });
    window.__badgeCalls = []; window.__badgeCount = 0; window.__badgeMessages = [];
    Object.defineProperty(navigator, 'setAppBadge', { configurable: true, value: async count => { window.__badgeCount = count; window.__badgeCalls.push({ action: 'set', count }); } });
    Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: async () => { window.__badgeCount = 0; window.__badgeCalls.push({ action: 'clear' }); } });
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
      const registration = { active: { state: 'activated', postMessage(message, ports) { window.__badgeMessages.push(message); const count = message.type === 'sync-rider-request-badge' ? new Set(message.orderIds || []).size : 0; ports?.[0]?.postMessage({ type: 'rider-request-badge', count }); } }, pushManager };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration), getRegistration: async () => registration, register: async () => registration } });
    }
  }, { permission, key, realWorker, installed, standalone });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(holdLoad ? `${origin}/?hold-load=1` : origin, { waitUntil: holdLoad ? 'domcontentloaded' : 'load' }); await alertsSwitch(page).waitFor();
  return { page, context, errors };
}
const alertsSwitch = page => page.getByRole('switch', { name: 'Delivery alerts', exact: true });
async function waitForSwitch(page, checked, timeout = 10000) {
  await page.waitForFunction(checked => {
    const element = document.querySelector('[role="switch"][aria-label="Delivery alerts"]');
    return element?.getAttribute('aria-checked') === String(checked) && !element.disabled;
  }, checked, { timeout });
}
const freshRequests = page => page.locator('.rider-alerts-new');
async function waitForBadgeMessage(page, ids) {
  await page.waitForFunction(ids => {
    const message = window.__badgeMessages.at(-1);
    return ids === null ? message?.type === 'clear-rider-request-badge' : message?.type === 'sync-rider-request-badge' && JSON.stringify(message.orderIds) === JSON.stringify(ids);
  }, ids);
}
async function compactControls(page, checked) {
  const card = page.getByRole('region', { name: 'Delivery request alerts', exact: true });
  assert.equal(await card.getByRole('switch', { name: 'Delivery alerts', exact: true }).count(), 1);
  assert.equal(await alertsSwitch(page).getAttribute('aria-checked'), String(checked));
  assert.equal((await alertsSwitch(page).innerText()).trim(), checked ? 'On' : 'Off');
  assert.equal(await card.getByRole('button').count(), 0, 'Normal controls must contain only the On/Off switch.');
  assert.equal(await card.locator('.rider-alerts-copy, p:not(.rider-alerts-message), small, strong, h1, h2, h3').count(), 0, 'Normal alert controls must not include static descriptions or a title.');
  assert.equal(await card.locator('.rider-alerts-message').count(), 0, 'Normal alert controls must not show an error or setup message.');
  const geometry = await card.evaluate(element => ({ card: element.getBoundingClientRect().toJSON(), width: innerWidth, buttons: [...element.querySelectorAll('button')].map(button => ({ bounds: button.getBoundingClientRect().toJSON(), scrollWidth: button.scrollWidth, clientWidth: button.clientWidth })) }));
  assert.ok(geometry.card.left >= 0 && geometry.card.right <= geometry.width, 'The card must fit the viewport.');
  for (const button of geometry.buttons) {
    assert.ok(button.bounds.left >= geometry.card.left && button.bounds.right <= geometry.card.right, 'Every button must fit the card.');
    assert.ok(button.scrollWidth <= button.clientWidth + 1, 'Button text must not be clipped.');
  }
  const switchBounds = await alertsSwitch(page).boundingBox();
  assert.ok(switchBounds.width <= 140 && switchBounds.height >= 44 && switchBounds.height <= 60, 'The switch must remain small with a usable tap target.');
}
try {
  const slow = await pageFor({ realWorker: true, holdLoad: true });
  try {
    assert.notEqual(await slow.page.evaluate(() => document.readyState), 'complete');
    assert.equal(await slow.page.evaluate(() => navigator.serviceWorker.controller), null);
    const before = apiCalls.length;
    await alertsSwitch(slow.page).click();
    await waitForSwitch(slow.page, true);
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
      await alertsSwitch(retry.page).click();
      await retry.page.locator('.rider-alerts-message').waitFor({ timeout: 5000 });
      assert.equal(await retry.page.locator('.rider-alerts-message').innerText(), 'Phone notifications could not start. Check your connection and turn alerts on again.');
      assert.ok(Date.now() - started < 5000, 'A failed worker must report promptly instead of waiting on serviceWorker.ready.');
      assert.ok(!apiCalls.slice(before).some(call => call.method === 'POST' && call.body.action === 'subscribe'));
      await waitForSwitch(retry.page, false);
      assert.equal(await alertsSwitch(retry.page).isEnabled(), true);
      assert.equal(await retry.page.evaluate(() => localStorage.getItem('kyetech:rider-alerts:fixture-rider')), '0');
      failWorkerRequests = false;
      failPrecacheRequests = false;
      await alertsSwitch(retry.page).click();
      await waitForSwitch(retry.page, true);
      assert.equal(await retry.page.evaluate(() => window.__workerRegistrations.length), 2);
      assert.equal(await retry.page.evaluate(() => document.readyState), 'interactive');
      assert.equal(await retry.page.locator('.rider-alerts-message').count(), 0);
      assert.deepEqual(retry.errors, []);
    } finally { failWorkerRequests = false; failPrecacheRequests = false; releasePageLoad(); await retry.context.close(); }
    console.log(`PASS a failed production worker ${failure} explains the error promptly and retries without reopening the app`);
  }

  for (const width of [320, 390, 1366]) {
    const { page, context, errors } = await pageFor({ width });
    await compactControls(page, false);
    await alertsSwitch(page).click();
    await waitForSwitch(page, true);
    await compactControls(page, true);
    await waitForBadgeMessage(page, ['old']);
    assert.equal(await page.evaluate(() => window.__permissionWasGesture), true);
    assert.equal(await page.evaluate(() => window.__pushSubscriptions), 1);
    assert.equal(await page.evaluate(() => window.__permissionCalls), 1);
    await page.screenshot({ path: resolve(fixture, `alerts-enabled-${width}.png`), fullPage: true });
    assert.equal(await freshRequests(page).count(), 0);
    await page.evaluate(() => window.__setAlerts({ orders: [window.__order('old'), window.__order('new')] }));
    await page.getByRole('button', { name: 'View requests (1)', exact: true }).waitFor();
    await waitForBadgeMessage(page, ['old', 'new']);
    await page.getByRole('button', { name: 'View requests (1)', exact: true }).click(); assert.equal(await page.evaluate(() => window.__viewRequests), 1);
    await freshRequests(page).waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__setAlerts({ orders: [window.__order('old'), window.__order('new')] })); assert.equal(await freshRequests(page).count(), 0);
    await page.evaluate(() => window.__setAlerts({ orders: [window.__order('old'), window.__order('new'), window.__order('newer')] }));
    await page.getByRole('button', { name: 'View requests (1)', exact: true }).waitFor();
    await page.evaluate(() => window.__setAlerts({ profile: { id: 'fixture-rider', role: 'rider', approvalStatus: 'approved', accountStatus: 'active', online: false } }));
    await freshRequests(page).waitFor({ state: 'hidden' });
    await compactControls(page, true);
    await waitForBadgeMessage(page, null);
    await page.evaluate(() => window.__setAlerts({ orders: [window.__order('offline')] }));
    await page.waitForFunction(() => window.__alertsState.orders[0].id === 'offline');
    await page.evaluate(() => window.__setAlerts({ profile: { id: 'fixture-rider', role: 'rider', approvalStatus: 'approved', accountStatus: 'active', online: true } }));
    await page.waitForFunction(() => window.__alertsState.profile.online === true);
    assert.equal(await freshRequests(page).count(), 0);
    await alertsSwitch(page).click(); await page.waitForFunction(() => window.__unsubscribed === true);
    await waitForSwitch(page, false);
    await compactControls(page, false);
    await waitForBadgeMessage(page, null);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(fixture, `alerts-${width}.png`), fullPage: true }); await context.close();
    console.log(`PASS rider alerts: permission, fresh requests, online state, mute and layout at ${width}px`);
  }
  const denied = await pageFor({ permission: 'denied' }); await alertsSwitch(denied.page).click();
  await denied.page.getByText(/Notifications are blocked/).waitFor();
  await waitForSwitch(denied.page, false);
  assert.equal(await alertsSwitch(denied.page).isEnabled(), true);
  assert.equal(await denied.page.evaluate(() => window.__pushSubscriptions), 0);
  assert.equal(await denied.page.evaluate(() => localStorage.getItem('kyetech:rider-alerts:fixture-rider')), '0');
  await denied.page.evaluate(() => { window.__permissionChoice = 'granted'; Notification.permission = 'default'; });
  await alertsSwitch(denied.page).click();
  await waitForSwitch(denied.page, true);
  await compactControls(denied.page, true);
  assert.deepEqual(denied.errors, []); await denied.context.close();
  console.log('PASS permission denial leaves the switch Off and permits another On tap to retry');
  for (const installed of [false, true]) {
    const ios = await pageFor({ ios: true, installed });
    await compactControls(ios.page, false);
    await alertsSwitch(ios.page).click();
    await ios.page.locator('.rider-alerts-message').filter({ hasText: /Home Screen/i }).waitFor();
    assert.equal(await ios.page.evaluate(() => window.__permissionCalls), 0);
    assert.equal(await ios.page.evaluate(() => window.__pushSubscriptions), 0);
    await waitForSwitch(ios.page, false);
    assert.equal(await ios.page.evaluate(() => localStorage.getItem('kyetech:rider-alerts:fixture-rider')), '0');
    assert.deepEqual(ios.errors, []); await ios.context.close();
  }
  const homeScreen = await pageFor({ ios: true, installed: true, standalone: true });
  await compactControls(homeScreen.page, false);
  await alertsSwitch(homeScreen.page).click();
  await waitForSwitch(homeScreen.page, true);
  await compactControls(homeScreen.page, true);
  assert.equal(await homeScreen.page.evaluate(() => window.__permissionWasGesture), true);
  assert.equal(await homeScreen.page.evaluate(() => window.__pushSubscriptions), 1);
  await alertsSwitch(homeScreen.page).click();
  await waitForSwitch(homeScreen.page, false);
  assert.equal(await homeScreen.page.evaluate(() => window.__unsubscribed), true);
  assert.deepEqual(homeScreen.errors, []); await homeScreen.context.close();
  assert.ok(apiCalls.every(call => call.authorization === 'Bearer fixture-token')); assert.ok(apiCalls.some(call => call.method === 'DELETE'));
  console.log('PASS iPhone browser setup remains Off and explains Home Screen requirements on demand');
  console.log('PASS a simulated iPhone Home Screen launch can enroll and disable notifications through the switch');
} finally { releasePageLoad(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
