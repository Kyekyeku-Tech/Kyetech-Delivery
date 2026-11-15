// Build first, then run: node tests/pwa-ui.mjs
// Uses the production bundle and a local server; never signs in or contacts
// Firebase, sends messages, or installs anything on the user's device.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

let playwright;
try { playwright = await import('playwright'); }
catch {
  try { playwright = await import('@playwright/test'); }
  catch { playwright = await import('../.verification/login-tools/node_modules/playwright/index.mjs'); }
}

const dist = resolve('dist');
await stat(resolve(dist, 'sw.js'));
const output = '.verification/pwa';
await mkdir(output, { recursive: true });
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const androidAgent = 'Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';
let updateNumber = 0;
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) {
    response.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ message: 'Local unauthenticated API fixture', privateMarker: 'private-api-fixture-never-cache' }));
    return;
  }
  const appRoute = pathname === '/' || pathname === '/admin' || pathname.startsWith('/admin/') || pathname === '/review';
  const file = resolve(dist, appRoute ? 'index.html' : `.${pathname}`);
  if (!file.startsWith(`${dist}${sep}`)) { response.writeHead(400); response.end(); return; }
  try {
    let bytes = await readFile(file);
    if (pathname === '/sw.js' && updateNumber) bytes = Buffer.from(`${bytes}\n// verification update ${updateNumber}\n`);
    response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...(pathname === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
    response.end(bytes);
  } catch { response.writeHead(404); response.end('Missing file'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ headless: true });
let passes = 0;

async function context(options = {}) {
  const result = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: androidAgent, ...options });
  await result.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  return result;
}

async function controlledPage(browserContext) {
  const page = await browserContext.newPage();
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated', undefined, { timeout: 20000 });
  await page.getByLabel('Email address', { exact: true }).waitFor();
  return page;
}

async function cachedUrls(page) {
  return page.evaluate(async () => {
    const entries = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) entries.push({ name, url: request.url });
    }
    return entries;
  });
}

async function check(name, operation) {
  await operation();
  passes += 1;
  console.log(`PASS ${name}`);
}

try {
  await check('Production manifest, decoded icons and service worker meet Chrome installation requirements', async () => {
    const browserContext = await context();
    try {
      const page = await controlledPage(browserContext);
      const data = await page.evaluate(async () => {
        const link = document.querySelector('link[rel="manifest"]');
        const manifest = await (await fetch(link.href)).json();
        const icons = [];
        for (const icon of manifest.icons) {
          const bitmap = await createImageBitmap(await (await fetch(icon.src)).blob());
          icons.push({ ...icon, width: bitmap.width, height: bitmap.height });
          bitmap.close();
        }
        const registration = await navigator.serviceWorker.ready;
        return { manifest, icons, scope: registration.scope, active: registration.active.state, controller: navigator.serviceWorker.controller.scriptURL };
      });
      assert.equal(data.manifest.name, 'KyeTech Delivery');
      assert.equal(new URL(data.manifest.start_url, origin).href, `${origin}/`);
      assert.equal(new URL(data.manifest.scope, origin).href, `${origin}/`);
      assert.equal(data.manifest.display, 'standalone');
      assert.equal(data.scope, `${origin}/`);
      assert.equal(data.active, 'activated');
      assert.equal(data.controller, `${origin}/sw.js`);
      for (const size of [192, 512]) assert.ok(data.icons.some(icon => icon.purpose.split(' ').includes('any') && icon.width === size && icon.height === size && icon.sizes === `${size}x${size}`));
      assert.ok(data.icons.some(icon => icon.purpose === 'maskable' && icon.width === 512 && icon.height === 512));
      const cdp = await browserContext.newCDPSession(page);
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      assert.deepEqual(installabilityErrors, [], `Chrome installability errors: ${JSON.stringify(installabilityErrors)}`);
      assert.equal(await page.getByRole('dialog').count(), 0, 'Installation should not open a dialog automatically.');
      const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert.ok(geometry.scrollWidth <= geometry.width + 1, 'Installation controls must fit on a phone.');
      await page.screenshot({ path: `${output}/mobile-install.png`, fullPage: true, animations: 'disabled' });
    } finally { await browserContext.close(); }
  });

  await check('Production worker never caches private API replies or account/review HTML', async () => {
    const browserContext = await context();
    try {
      const page = await controlledPage(browserContext);
      const replies = await page.evaluate(async () => {
        const responses = [];
        for (const path of ['/api/admin-otp', '/api/gps-address', '/api/delivery-sms']) {
          const response = await fetch(path, { cache: 'no-store' });
          responses.push({ status: response.status, marker: (await response.json()).privateMarker });
        }
        return responses;
      });
      assert.ok(replies.every(reply => reply.status === 401 && reply.marker === 'private-api-fixture-never-cache'));
      await page.goto(`${origin}/admin/access`, { waitUntil: 'networkidle' });
      await page.goto(`${origin}/review?token=private-review-fixture`, { waitUntil: 'networkidle' });
      const entries = await cachedUrls(page);
      assert.ok(entries.length > 5, 'Production public JS/CSS and offline assets should be precached.');
      assert.ok(entries.every(({ url }) => !url.includes('/api/') && !url.includes('/admin') && !url.includes('/review') && !url.includes('index.html') && !new URL(url).search));
      assert.ok(entries.every(({ url }) => url.startsWith(`${origin}/`)));
    } finally { await browserContext.close(); }
  });

  await check('Native installation is user initiated and a declined prompt leaves the login untouched', async () => {
    const browserContext = await context();
    try {
      const page = await controlledPage(browserContext);
      await page.getByLabel('Email address', { exact: true }).fill('unfinished-login@example.invalid');
      await page.evaluate(() => {
        globalThis.__pwaPromptCalls = 0;
        const event = new Event('beforeinstallprompt', { cancelable: true });
        event.prompt = async () => { globalThis.__pwaPromptCalls += 1; };
        event.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
        dispatchEvent(event);
      });
      assert.equal(await page.evaluate(() => globalThis.__pwaPromptCalls), 0);
      assert.equal(await page.getByRole('dialog').count(), 0);
      await page.getByRole('button', { name: 'Install app', exact: true }).click();
      await page.waitForFunction(() => globalThis.__pwaPromptCalls === 1);
      assert.equal(await page.getByRole('dialog').count(), 0);
      assert.equal(await page.getByLabel('Email address', { exact: true }).inputValue(), 'unfinished-login@example.invalid');
      await page.evaluate(() => dispatchEvent(new Event('appinstalled')));
      await page.getByRole('button', { name: 'Install app', exact: true }).waitFor({ state: 'hidden' });
    } finally { await browserContext.close(); }
  });

  await check('iPhone installation guidance opens on demand and supports keyboard dismissal', async () => {
    const browserContext = await context({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1' });
    // Chromium supplies the mobile viewport and accessibility automation. The
    // Safari user agent exercises the documented iPhone guidance branch.
    await browserContext.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => false });
      addEventListener('beforeinstallprompt', event => event.stopImmediatePropagation(), { capture: true });
    });
    try {
      const page = await controlledPage(browserContext);
      assert.equal(await page.getByRole('dialog').count(), 0);
      const installButton = page.getByRole('button', { name: 'Install app', exact: true });
      await installButton.click();
      const dialog = page.getByRole('dialog', { name: 'Install KyeTech Delivery', exact: true });
      await dialog.waitFor();
      const copy = await dialog.innerText();
      assert.match(copy, /Safari/);
      assert.match(copy, /Share/);
      assert.match(copy, /Add to Home Screen/i);
      assert.match(copy, /Add/);
      await page.screenshot({ path: `${output}/iphone-install-guide.png`, animations: 'disabled' });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await installButton.evaluate(element => element === document.activeElement), true);
    } finally { await browserContext.close(); }
  });

  await check('An app launched from the phone home screen hides redundant installation controls', async () => {
    const browserContext = await context();
    await browserContext.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
      const original = matchMedia.bind(window);
      window.matchMedia = query => original(query === '(display-mode: standalone)' ? '(min-width: 0px)' : query);
    });
    try {
      const page = await controlledPage(browserContext);
      assert.equal(await page.getByRole('button', { name: 'Install app', exact: true }).count(), 0);
      assert.equal(await page.getByRole('dialog').count(), 0);
    } finally { await browserContext.close(); }
  });

  await check('Offline app launch explains connection needs and provides no delivery or account actions', async () => {
    const browserContext = await context();
    try {
      const page = await controlledPage(browserContext);
      await browserContext.setOffline(true);
      for (const path of ['/', '/admin/access', '/review?token=private-review-fixture']) {
        const response = await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
        assert.equal(response.status(), 200);
        await page.getByRole('heading', { name: "You're offline", exact: true }).waitFor();
        assert.equal(await page.locator('form, input').count(), 0);
        assert.deepEqual(await page.getByRole('button').allTextContents(), ['Try again']);
        assert.match(await page.locator('main').innerText(), /connect to the internet/i);
      }
      await page.screenshot({ path: `${output}/offline.png`, fullPage: true, animations: 'disabled' });
      await page.goto(`${origin}/`);
      await browserContext.setOffline(false);
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await page.getByLabel('Email address', { exact: true }).waitFor();
      assert.equal(await page.locator('h1').filter({ hasText: "You're offline" }).count(), 0);
      await browserContext.setOffline(true);
      await assert.rejects(page.goto(`${origin}/api/admin-otp`), /ERR_INTERNET_DISCONNECTED|ERR_FAILED/);
      await assert.rejects(page.goto(`${origin}/missing-route`), /ERR_INTERNET_DISCONNECTED|ERR_FAILED/);
    } finally { await browserContext.close(); }
  });

  await check('A new deployment waits without reloading an open login or interrupting its input', async () => {
    const browserContext = await context();
    try {
      const page = await controlledPage(browserContext);
      await page.getByLabel('Email address', { exact: true }).fill('unfinished-login@example.invalid');
      await page.evaluate(() => { globalThis.__pwaControllerChanges = 0; navigator.serviceWorker.addEventListener('controllerchange', () => globalThis.__pwaControllerChanges += 1); });
      updateNumber += 1;
      await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
      await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state === 'installed');
      assert.equal(await page.getByLabel('Email address', { exact: true }).inputValue(), 'unfinished-login@example.invalid');
      assert.equal(await page.evaluate(() => globalThis.__pwaControllerChanges), 0);
    } finally { await browserContext.close(); }
  });
  console.log(`Verified ${passes} production PWA cases. Screenshots: ${output}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
