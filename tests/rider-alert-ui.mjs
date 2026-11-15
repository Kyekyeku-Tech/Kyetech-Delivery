// Isolated rider UI fixture with mocked identity, push subscription and API.
// No Firebase traffic, delivery creation, device subscription or push delivery.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

let playwright;
try { playwright = await import('playwright'); } catch { playwright = await import('../.verification/login-tools/node_modules/playwright/index.mjs'); }
const fixture = resolve('.verification/rider-alert-ui'); await mkdir(fixture, { recursive: true });
await writeFile(resolve(fixture, 'index.html'), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>');
await writeFile(resolve(fixture, 'context.jsx'), `import { createContext, useContext } from 'react';export const Context=createContext(null);export const usePlatform=()=>useContext(Context);`);
await writeFile(resolve(fixture, 'main.jsx'), `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Context} from './context';import RiderAlerts from '../../src/components/RiderAlerts';import '../../src/styles.css';import '../../src/theme.css';
const user={uid:'fixture-rider',getIdToken:async()=>'fixture-token'};
const order=id=>({id,status:'pending',riderId:null,createdAt:Date.now()});
function Fixture(){const [state,setState]=useState({user,profile:{id:user.uid,role:'rider',approvalStatus:'approved',accountStatus:'active',online:true},isAdmin:false,orders:[order('old')],riderRequestsReady:true});window.__setAlerts=patch=>setState(previous=>({...previous,...patch}));window.__order=order;return <Context.Provider value={state}><div style={{padding:16,maxWidth:950,margin:'auto'}}><RiderAlerts onViewRequests={()=>window.__viewRequests=(window.__viewRequests||0)+1}/></div></Context.Provider>;}createRoot(document.getElementById('root')).render(<Fixture/>);`);
await build({ configFile: false, root: fixture, logLevel: 'error', plugins: [react()], resolve: { alias: [{ find: /.*context\/PlatformContext$/, replacement: resolve(fixture, 'context.jsx') }] }, build: { outDir: resolve(fixture, 'dist'), emptyOutDir: true } });
const key = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 5)]).toString('base64url');
const apiCalls = [];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/api/rider-alerts') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    apiCalls.push({ method: req.method, authorization: req.headers.authorization, body: raw && JSON.parse(raw) });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(req.method === 'GET' ? { publicKey: key } : { ok: true })); return;
  }
  try { const bytes = await readFile(resolve(fixture, 'dist', path === '/' ? 'index.html' : '.' + path)); res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(path)] || 'text/html' }); res.end(bytes); } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await playwright.chromium.launch({ headless: true });
async function pageFor({ width = 390, ios = false, permission = 'granted' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, userAgent: ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1' : 'Mozilla/5.0 (Linux; Android 14) Chrome/147.0.0.0 Mobile Safari/537.36' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addInitScript(({ permission, key }) => {
    window.__permissionCalls = 0; window.__permissionChoice = permission;
    class Notification { static permission = 'default'; static async requestPermission() { window.__permissionCalls++; window.__permissionWasGesture = navigator.userActivation.isActive; this.permission = window.__permissionChoice; return this.permission; } }
    Object.defineProperty(window, 'Notification', { configurable: true, value: Notification });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
    let subscription = null;
    const registration = { pushManager: { async getSubscription() { return subscription; }, async subscribe() { subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/ui-fixture', options: {}, toJSON() { return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: key, auth: 'AQEBAQEBAQEBAQEBAQEBAQ' } }; }, async unsubscribe() { subscription = null; window.__unsubscribed = true; return true; } }; return subscription; } } };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration), getRegistration: async () => registration } });
  }, { permission, key });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.getByRole('button', { name: 'Enable alerts', exact: true }).waitFor();
  return { page, context, errors };
}
try {
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
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
