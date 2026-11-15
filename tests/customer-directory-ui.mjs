// Local directory and searchable-pickup verification; external services are blocked.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../.verification/login-tools/node_modules/playwright/index.mjs';
const origin = 'http://localhost:5173', output = '.verification/customer-directory';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const provider = `
import React from '/node_modules/.vite/deps/react.js';
const listeners=new Set();let state=globalThis.__directoryFixture;
globalThis.__updateDirectory=patch=>{state={...state,...patch};globalThis.__directoryFixture=state;listeners.forEach(fn=>fn());};
export function PlatformProvider({children}){return children;}
export function usePlatform(){const snapshot=React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>state);return {...snapshot,clearError(){},async logout(){},async createOrder(payload){globalThis.__bookings.push(payload);return 'test-order';}};}
`;
function fixture() {
  const store = (id, name, category, address, open = true) => ({ id, ownerId: id, name, category, address, open, imageUrl: '/images/store-placeholder.svg', description: 'Good things for your home, delivered from your local store.', phone: '0241234567', approvalStatus: 'approved', accountStatus: 'active' });
  const rider = (id, name, city, brand, model, online) => ({ id, name, role: 'rider', city, bikeBrand: brand, bikeModel: model, online, phone: '0551234567', photoUrl: id === 'kofi' ? '/images/apple-touch-icon.png' : '', plate: 'WR 1234-26', approvalStatus: 'approved', accountStatus: 'active' });
  return { user: { uid: 'customer-one' }, profile: { id: 'customer-one', name: 'Abena Customer', role: 'customer', phone: '+233241234567', email: 'customer@example.invalid', city: 'Takoradi', accountStatus: 'active' }, authLoading: false, adminLoading: false, dataLoading: false, isAdmin: false, error: '', orders: [], smsMessages: [], stores: [
    store('ada', 'Ada Groceries', 'Groceries', 'Market Circle, Takoradi'), store('cafe', 'Café Essentials', 'Food & drinks', 'Chapel Hill, Takoradi'), store('closed', 'Kojo Corner Store', 'Groceries', 'Kojokrom, near the station', false), store('pharmacy', 'Effia Pharmacy', 'Pharmacy', 'Effia Community Center'),
  ], riders: [rider('kofi', 'Kofi Mensah', 'Takoradi', 'Apsonic', 'AP 125', true), rider('ama', 'Ama Owusu', 'Sekondi', 'Royal', 'Jungle', true), rider('kojo', 'Kojo Asante', 'Kojokrom', 'Boxer', '150', false)] };
}
async function makePage(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(state => { globalThis.__directoryFixture = state; globalThis.__bookings = []; }, fixture());
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
    if (url.pathname === '/src/context/PlatformContext.jsx') return route.fulfill({ status: 200, contentType: 'application/javascript', body: provider });
    return route.continue();
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  return { page, context, errors };
}
async function noOverflow(page, label) {
  const values = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
  assert.ok(values[1] <= values[0] + 1, label + ' overflows: ' + values);
  const dialogs = await page.getByRole('dialog').evaluateAll(nodes => nodes.map(node => [node.clientWidth, node.scrollWidth]));
  for (const dialog of dialogs) assert.ok(dialog[1] <= dialog[0] + 1, label + ' dialog overflows: ' + dialog);
}
const riderProfile = page => page.getByRole('dialog', { name: 'Kofi Mensah Rider profile', exact: true });
const paintedPhotoSize = photo => photo.evaluate(image => {
  const bounds = image.getBoundingClientRect();
  const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  return { width: image.naturalWidth * scale, height: image.naturalHeight * scale };
});
async function checkRiderProfile(page, width) {
  const dialog = riderProfile(page);
  await dialog.waitFor();
  assert.equal(await page.locator('.modal-backdrop').count(), 1, 'The rider directory remains mounted behind the profile.');
  for (const text of ['Kofi Mensah', 'Online now', 'Approved rider', 'Takoradi', '+233551234567', 'Apsonic AP 125']) {
    await dialog.getByText(text, { exact: true }).waitFor();
  }
  assert.match(await dialog.getByRole('region', { name: 'Rider motorcycle', exact: true }).innerText(), /WR 1234-26/);
  assert.equal(await dialog.getByRole('link', { name: 'Call rider Kofi Mensah', exact: true }).getAttribute('href'), 'tel:+233551234567');
  const photo = dialog.getByRole('img', { name: 'Kofi Mensah profile photo', exact: true });
  await photo.evaluate(image => image.decode());
  const normal = await photo.boundingBox();
  const normalPicture = await paintedPhotoSize(photo);
  assert.ok(normal.width >= 230 && normal.height >= 230, 'The profile shows a large loaded portrait at ' + width + 'px.');
  assert.equal(await photo.getAttribute('src'), '/images/apple-touch-icon.png');
  await noOverflow(page, width + 'px rider profile');
  const close = dialog.getByRole('button', { name: 'Close rider profile', exact: true });
  const call = dialog.getByRole('link', { name: 'Call rider Kofi Mensah', exact: true });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await call.evaluate(node => node === document.activeElement), true, 'Backward Tab wraps within the nested profile.');
  await page.keyboard.press('Tab');
  assert.equal(await close.evaluate(node => node === document.activeElement), true, 'Forward Tab wraps within the nested profile.');
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true, 'Tab must not reach the directory behind the native profile.');
  }
  const expand = dialog.getByRole('button', { name: 'Enlarge profile photo for Kofi Mensah', exact: true });
  await expand.click();
  const back = dialog.getByRole('button', { name: 'Back to profile', exact: true });
  await back.waitFor();
  await dialog.getByRole('img', { name: 'Kofi Mensah profile photo', exact: true }).evaluate(image => image.decode());
  await page.screenshot({ path: output + '/rider-photo-' + width + '.png', animations: 'disabled' });
  const enlargedPicture = await paintedPhotoSize(dialog.getByRole('img', { name: 'Kofi Mensah profile photo', exact: true }));
  assert.ok(enlargedPicture.width > normalPicture.width && enlargedPicture.height > normalPicture.height, 'View photo must enlarge the actual portrait within the image element at ' + width + 'px: ' + JSON.stringify({ normalPicture, enlargedPicture }));
  if (width === 1366) assert.ok(enlargedPicture.height > normalPicture.height + 100, 'The desktop photo view provides a substantially larger portrait.');
  await noOverflow(page, width + 'px enlarged rider photo');
  await page.keyboard.press('Escape');
  await expand.waitFor();
  assert.equal(await dialog.count(), 1, 'Escape returns from the photo to the profile.');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Enlarge profile photo for Kofi Mensah');
  await expand.click();
  await back.click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Enlarge profile photo for Kofi Mensah');
  await page.screenshot({ path: output + '/rider-profile-' + width + '.png', animations: 'disabled' });
}
const picker = page => page.getByRole('combobox', { name: 'Pickup store (optional)', exact: true });
const selectedId = page => page.locator('input[type=hidden][name=merchantId]').inputValue();
try {
  for (const width of [1366, 390, 320]) {
    const { page, context, errors } = await makePage(width);
    try {
      await page.getByRole('button', { name: /Find Store/ }).click();
      await page.getByRole('searchbox', { name: 'Search stores', exact: true }).waitFor();
      assert.equal(await page.locator('.directory-store-card').count(), 4);
      assert.equal(await page.getByRole('article', { name: 'Kojo Corner Store', exact: true }).getByRole('button', { name: 'Request delivery', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('link', { name: 'Call store Ada Groceries', exact: true }).getAttribute('href'), 'tel:+233241234567');
      await noOverflow(page, width + 'px store directory');
      await page.screenshot({ path: output + '/stores-' + width + '.png', animations: 'disabled' });
      await page.getByRole('searchbox', { name: 'Search stores', exact: true }).fill('cafe chapel');
      assert.equal(await page.locator('.directory-store-card').count(), 1);
      await page.getByRole('button', { name: 'Clear stores search', exact: true }).click();
      await page.getByRole('group', { name: 'Store categories', exact: true }).getByRole('button', { name: 'Groceries', exact: true }).click();
      assert.equal(await page.locator('.directory-store-card').count(), 2);
      await page.getByRole('button', { name: 'Open now', exact: true }).click();
      assert.equal(await page.locator('.directory-store-card').count(), 1);
      await page.getByRole('article', { name: 'Ada Groceries', exact: true }).getByRole('button', { name: 'Request delivery', exact: true }).click();
      assert.equal(await selectedId(page), 'ada');
      assert.equal(await page.getByLabel('Pickup address', { exact: true }).inputValue(), 'Market Circle, Takoradi');
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.getByRole('button', { name: /Find Rider/ }).click();
      assert.equal(await page.locator('.directory-rider-card').count(), 3);
      assert.equal(await page.getByRole('article', { name: 'Kojo Asante', exact: true }).getByRole('button', { name: 'Request rider', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('link', { name: 'Call rider Kofi Mensah', exact: true }).getAttribute('href'), 'tel:+233551234567');
      await noOverflow(page, width + 'px rider directory');
      await page.screenshot({ path: output + '/riders-' + width + '.png', animations: 'disabled' });
      await page.getByRole('button', { name: 'Online now', exact: true }).click();
      assert.equal(await page.locator('.directory-rider-card').count(), 2);
      await page.getByRole('searchbox', { name: 'Search riders', exact: true }).fill('apsonic takoradi');
      assert.equal(await page.locator('.directory-rider-card').count(), 1);
      const profileButton = page.getByRole('button', { name: 'View profile for Kofi Mensah', exact: true });
      await profileButton.click();
      await checkRiderProfile(page, width);
      await riderProfile(page).getByRole('button', { name: 'Close rider profile', exact: true }).click();
      assert.equal(await profileButton.evaluate(node => node === document.activeElement), true, 'Closing the profile restores its directory button focus.');
      assert.equal(await page.getByRole('searchbox', { name: 'Search riders', exact: true }).inputValue(), 'apsonic takoradi', 'Opening a profile preserves directory search.');
      assert.equal(await page.getByRole('button', { name: 'Online now', exact: true }).getAttribute('aria-pressed'), 'true', 'Opening a profile preserves the availability filter.');
      const avatar = page.getByRole('button', { name: 'View photo and profile for Kofi Mensah', exact: true });
      await avatar.click();
      await riderProfile(page).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.rider-profile-dialog').count(), 0, 'Escape closes the profile without closing its directory.');
      assert.equal(await page.locator('.modal-backdrop').count(), 1);
      assert.equal(await avatar.evaluate(node => node === document.activeElement), true, 'Escape restores the rider photo opener focus.');
      assert.equal(await page.getByRole('searchbox', { name: 'Search riders', exact: true }).inputValue(), 'apsonic takoradi');
      if (width === 390) {
        for (const photoUrl of ['/images/missing-profile-photo.png', 'javascript:alert(1)', '']) {
          await page.evaluate(photoUrl => __updateDirectory({ riders: __directoryFixture.riders.map(rider => rider.id === 'kofi' ? { ...rider, photoUrl } : rider) }), photoUrl);
          await avatar.click();
          const dialog = riderProfile(page);
          const fallback = dialog.getByRole('img', { name: 'Delivery rider illustration', exact: true });
          await fallback.waitFor();
          await fallback.evaluate(image => image.decode());
          assert.equal(await fallback.getAttribute('src'), '/images/rider.png', 'Unavailable or unsafe profile photos use a loaded illustration.');
          await dialog.getByText("This rider's profile photo is unavailable.", { exact: true }).waitFor();
          await page.keyboard.press('Escape');
        }
        await page.evaluate(() => __updateDirectory({ riders: __directoryFixture.riders.map(rider => rider.id === 'kofi' ? { ...rider, photoUrl: '/images/apple-touch-icon.png' } : rider) }));
      }
      await page.getByRole('searchbox', { name: 'Search riders', exact: true }).fill('no matching rider');
      await page.getByText('No riders match this search', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Show all riders', exact: true }).click();
      assert.equal(await page.locator('.directory-rider-card').count(), 3);
      await page.getByRole('article', { name: 'Kofi Mensah', exact: true }).getByRole('button', { name: 'Request rider', exact: true }).click();
      assert.equal(await page.getByLabel('Rider preference', { exact: true }).inputValue(), 'kofi');
      await noOverflow(page, width + 'px rider booking');
      assert.deepEqual(errors, []);
      console.log('PASS ' + width + 'px directories: search/filter preservation, large rider profile/photo, public fields/call, nested Escape/Tab/focus and matching store/rider bookings.');
    } finally { await context.close(); }
  }
  const { page, context, errors } = await makePage(320);
  try {
    await page.evaluate(() => {
      const base = __directoryFixture.stores[0];
      const stores = Array.from({ length: 240 }, (_, index) => ({ ...base, id: 'shop-' + index, name: 'Community Shop ' + String(index).padStart(3, '0'), address: index === 219 ? 'Chapel Hill, beside the library' : 'Area ' + index + ', Takoradi', category: index === 219 ? 'Pharmacy' : 'Groceries' }));
      stores.push({ ...base, id: 'closed-hidden', name: 'Closed Hidden Store', open: false }, { ...base, id: 'pending-hidden', name: 'Pending Hidden Store', approvalStatus: 'pending' });
      __updateDirectory({ stores });
    });
    await page.getByRole('button', { name: 'Request a rider', exact: true }).click();
    await page.getByLabel('Pickup address', { exact: true }).fill('My original pickup');
    await picker(page).fill('library pharmacy');
    assert.equal(await page.getByRole('listbox', { name: 'Pickup stores', exact: true }).getByRole('option').count(), 2);
    await picker(page).press('Enter');
    assert.equal(await selectedId(page), 'shop-219');
    assert.equal(await picker(page).inputValue(), 'Community Shop 219');
    assert.equal(await page.getByLabel('Pickup address', { exact: true }).inputValue(), 'Chapel Hill, beside the library');
    await picker(page).click(); // Reopening with focus still on the selected input.
    assert.equal(await page.getByRole('listbox', { name: 'Pickup stores', exact: true }).getByRole('option').count(), 241);
    await picker(page).fill('community shop 239');
    assert.equal(await selectedId(page), 'shop-219', 'Typing must not replace the chosen pickup.');
    await picker(page).press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 1, 'Escape closes choices before the delivery dialog.');
    assert.equal(await picker(page).inputValue(), 'Community Shop 219');
    await picker(page).fill('community shop 239');
    await noOverflow(page, 'Many-store search');
    await page.screenshot({ path: output + '/pickup-search-320.png', animations: 'disabled' });
    await picker(page).press('Enter');
    assert.equal(await selectedId(page), 'shop-239');
    await picker(page).fill('no store matches');
    await page.getByText('No stores match this search.', { exact: false }).waitFor();
    await page.getByRole('option', { name: /^Enter a pickup address/ }).click();
    assert.equal(await selectedId(page), '');
    assert.equal(await page.getByLabel('Pickup address', { exact: true }).inputValue(), 'My original pickup');
    await picker(page).fill('community shop 238');
    await picker(page).press('ArrowDown');
    await picker(page).press('ArrowUp');
    await picker(page).press('Enter');
    assert.equal(await selectedId(page), 'shop-238');
    await picker(page).click();
    await picker(page).press('Tab');
    assert.equal(await picker(page).getAttribute('aria-expanded'), 'false');
    await page.getByLabel('Drop-off address', { exact: true }).fill('Effia');
    await page.getByLabel('Recipient name', { exact: true }).fill('Kwame');
    await page.getByLabel('Recipient phone', { exact: true }).fill('0241234567');
    await page.getByLabel('Package details', { exact: true }).fill('Groceries');
    await page.getByRole('button', { name: 'Send delivery request', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const payload = await page.evaluate(() => __bookings[0]);
    assert.equal(payload.merchantId, 'shop-238');
    assert.equal(payload.pickup, 'Area 238, Takoradi');
    assert.deepEqual(errors, []);
    console.log('PASS searchable pickup: 240 stores, area/category matching, keyboard/mouse selection, preserved pickup, Escape/Tab, no results and saved booking.');
  } finally { await context.close(); }
} finally { await browser.close(); }
