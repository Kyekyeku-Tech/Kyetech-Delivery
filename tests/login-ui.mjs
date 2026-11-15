// Run against the Vite dev server: node tests/login-ui.mjs
// If Playwright is not installed, keep verification dependencies outside the app:
// npm.cmd install --prefix .verification/login-tools --no-audit --no-fund @playwright/test
// node .verification/login-tools/node_modules/playwright/cli.js install chromium
// Interactive cases replace the context module with a browser-only fixture and
// block every external request. They never create or sign in to Firebase accounts.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

let playwright;
try { playwright = await import('playwright'); }
catch {
  try { playwright = await import('@playwright/test'); }
  catch { playwright = await import('../.verification/login-tools/node_modules/playwright/index.mjs'); }
}

const baseUrl = process.env.LOGIN_UI_URL || 'http://localhost:5173/';
const baseOrigin = new URL(baseUrl).origin;
const output = '.verification/login';
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
const results = [];

const fixtureModule = `
export function PlatformProvider({ children }) { return children; }
export function usePlatform() {
  const fixture = globalThis.__loginUi;
  async function call(action, payload) {
    fixture.calls.push({ action, payload });
    await new Promise(resolve => setTimeout(resolve, 180));
    if (action === 'login') throw new Error('The email or password is incorrect.');
    return { uid: 'local-ui-fixture' };
  }
  return {
    user: null, profile: null, authLoading: false, dataLoading: false,
    needsProfile: false, firebaseConfigured: true, error: '',
    stores: [], riders: [], orders: [], feedback: [], clearError() {},
    login: (...payload) => call('login', payload),
    register: payload => call('register', payload),
    resetPassword: email => call('reset', email),
    saveProfile: payload => call('setup', payload), logout() {},
  };
}
`;

async function makePage(viewport, { mocked = true, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion });
  const errors = [];
  if (mocked) {
    await context.addInitScript(() => { globalThis.__loginUi = { calls: [] }; });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== baseOrigin) return route.abort();
      if (url.pathname === '/src/context/PlatformContext.jsx') {
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: fixtureModule });
      }
      return route.continue();
    });
  } else {
    // A fresh browser has no persisted Firebase account. Block mutations as a
    // second guard while checking the actual SDK/module startup.
    await context.route('**/*', route => {
      const request = route.request();
      if (new URL(request.url()).origin !== baseOrigin && request.method() !== 'GET') return route.abort();
      return route.continue();
    });
  }
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByLabel('Email address', { exact: true }).waitFor();
  return { page, context, errors };
}

function accountButton(page, name) {
  return page.getByRole('button', { name, exact: true }).or(page.getByRole('tab', { name, exact: true }));
}

async function assertSelected(page, name) {
  const button = accountButton(page, name);
  assert.equal(await button.evaluate(element => element.getAttribute('aria-pressed') || element.getAttribute('aria-selected')), 'true');
}

async function assertLayout(page, mobile) {
  for (const asset of ['delivery.png', 'rider.png']) {
    const image = page.locator(`img[src="/images/${asset}"]`);
    await image.waitFor({ state: 'attached' });
    await page.waitForFunction(src => {
      const img = [...document.images].find(image => image.getAttribute('src') === src);
      return img?.complete && img.naturalWidth > 0;
    }, `/images/${asset}`);
  }
  const geometry = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    heroTop: document.querySelector('img[src="/images/delivery.png"]').getBoundingClientRect().top,
    emailTop: document.querySelector('input[type="email"]').getBoundingClientRect().top,
  }));
  assert.ok(geometry.scrollWidth <= geometry.width + 1, `Horizontal overflow: ${JSON.stringify(geometry)}`);
  if (mobile) assert.ok(geometry.heroTop < geometry.emailTop, 'Illustrations must appear before the email input on mobile.');
}

async function check(name, task) {
  await task();
  results.push(name);
  console.log(`PASS ${name}`);
}

try {
  await check('Actual Firebase SDK initializes and login screen renders', async () => {
    const { page, context, errors } = await makePage({ width: 390, height: 844 }, { mocked: false });
    try {
      assert.deepEqual(errors, []);
      assert.equal(await page.getByRole('alert').count(), 0, 'The live login screen reports a startup error.');
      assert.equal(await page.getByRole('button', { name: 'Login', exact: true }).isEnabled(), true);
      await assertLayout(page, true);
      await page.screenshot({ path: `${output}/live-mobile.png`, fullPage: true });
    } finally { await context.close(); }
  });

  await check('Login has no role selector and validates email/password access', async () => {
    const { page, context, errors } = await makePage({ width: 390, height: 844 });
    try {
      await assertLayout(page, true);
      assert.equal(await page.getByRole('group', { name: 'Account type' }).count(), 0);
      await page.screenshot({ path: `${output}/mobile-login.png`, fullPage: true });
      const email = page.getByLabel('Email address', { exact: true });
      const password = page.getByLabel('Password', { exact: true });
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      assert.equal(await email.evaluate(element => element.validity.valueMissing), true);
      assert.equal(await page.evaluate(() => globalThis.__loginUi.calls.length), 0);
      await email.fill('invalid-address');
      await password.fill('secret123');
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      assert.equal(await email.evaluate(element => element.validity.typeMismatch), true);
      assert.equal(await page.evaluate(() => globalThis.__loginUi.calls.length), 0);
      await email.fill('ui-fixture@example.invalid');
      await page.getByRole('button', { name: 'Show password', exact: true }).click();
      assert.equal(await password.getAttribute('type'), 'text');
      await page.getByRole('button', { name: 'Hide password', exact: true }).click();
      assert.equal(await password.getAttribute('type'), 'password');
      await password.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').innerText(), /email or password is incorrect/i);
      const calls = await page.evaluate(() => globalThis.__loginUi.calls);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].action, 'login');
      assert.equal(calls[0].payload[0], 'ui-fixture@example.invalid');
      assert.equal(calls[0].payload.length, 2);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Reset and sign up use the selected account and remain on-screen', async () => {
    const { page, context, errors } = await makePage({ width: 390, height: 844 });
    try {
      await page.getByRole('button', { name: 'Reset Password', exact: true }).click();
      assert.equal(await page.getByLabel('Password', { exact: true }).count(), 0);
      await page.getByLabel('Email address', { exact: true }).fill('ui-fixture@example.invalid');
      await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
      await page.getByRole('status').waitFor();
      assert.match(await page.getByRole('status').innerText(), /reset link/i);
      await page.getByRole('button', { name: /back to (login|sign in)/i }).click();
      assert.equal(await page.getByRole('group', { name: 'Account type' }).count(), 0);
      await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
      await assertSelected(page, 'Customer');
      await accountButton(page, 'Merchant').focus();
      await page.keyboard.press('Space');
      await assertSelected(page, 'Merchant');
      await accountButton(page, 'Rider').click();
      await assertSelected(page, 'Rider');
      await page.getByLabel('Full name', { exact: true }).fill('UI Fixture');
      await page.getByLabel('Phone number', { exact: true }).fill('0241234567');
      await page.getByLabel('City / service area', { exact: true }).fill('Sekondi–Takoradi');
      await page.getByLabel('Email address', { exact: true }).fill('ui-fixture@example.invalid');
      await page.getByLabel('Password', { exact: true }).fill('secret123');
      await assertLayout(page, true);
      await page.screenshot({ path: `${output}/mobile-signup.png`, fullPage: true });
      await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
      await page.waitForFunction(() => globalThis.__loginUi.calls.some(call => call.action === 'register'));
      const calls = await page.evaluate(() => globalThis.__loginUi.calls);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].action, 'reset');
      assert.equal(calls[1].payload.role, 'rider');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Desktop layout and decorative animation', async () => {
    const { page, context, errors } = await makePage({ width: 1440, height: 1000 });
    try {
      await assertLayout(page, false);
      assert.ok(await page.evaluate(() => document.getAnimations().some(animation => animation.playState === 'running')), 'The header has no running illustration animation.');
      await page.screenshot({ path: `${output}/desktop-login.png`, fullPage: true });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Reduced motion disables decorative animation', async () => {
    const { page, context, errors } = await makePage({ width: 390, height: 844 }, { reducedMotion: 'reduce' });
    try {
      assert.equal(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), 0);
      await assertLayout(page, true);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
  console.log(`Verified ${results.length} login UI cases. Screenshots: ${output}`);
} finally {
  await browser.close();
}
