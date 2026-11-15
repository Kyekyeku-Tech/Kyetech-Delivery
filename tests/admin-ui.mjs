// UI verification uses a local provider fixture and blocks every external request.
// It never creates Firebase accounts, uploads images, or changes service records.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

let playwright;
try { playwright = await import('playwright'); }
catch {
  try { playwright = await import('@playwright/test'); }
  catch { playwright = await import('../.verification/login-tools/node_modules/playwright/index.mjs'); }
}

const baseUrl = process.env.ADMIN_UI_URL || 'http://localhost:5173/';
const origin = new URL(baseUrl).origin;
const output = '.verification/admin';
await mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
const results = [];

const fixtureModule = `
import React from '/node_modules/.vite/deps/react.js';
const { useSyncExternalStore } = React;
const fixture = globalThis.__adminUi;
const listeners = new Set();
let state = {
  ...fixture.state, authLoading: false, adminLoading: false, authActionPending: false,
  dataLoading: false, needsProfile: false, firebaseConfigured: true, error: '',
};
function publish(patch) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }
globalThis.__updateAdminFixture = publish;
async function call(action, ...payload) {
  fixture.calls.push({ action, payload });
  await new Promise(resolve => setTimeout(resolve, 300));
  if (fixture.failNext) { const message = fixture.failNext; fixture.failNext = ''; throw new Error(message); }
  const [id, second, third] = payload;
  if (action === 'adminReviewRider') {
    const patch = { approvalStatus: second, reviewNote: third, ...(second !== 'approved' ? { online: false } : {}) };
    publish({ adminUsers: state.adminUsers.map(item => item.id === id ? { ...item, ...patch } : item), riders: state.riders.map(item => item.id === id ? { ...item, ...patch } : item) });
  } else if (action === 'adminReviewStore') publish({ stores: state.stores.map(item => item.id === id ? { ...item, approvalStatus: second, reviewNote: third } : item) });
  else if (action === 'adminSetAccountStatus') publish({ adminUsers: state.adminUsers.map(item => item.id === id ? { ...item, accountStatus: second, reviewNote: third } : item) });
  else if (action === 'adminSaveProfile') publish({ adminUsers: state.adminUsers.map(item => item.id === id ? { ...item, ...second } : item) });
  else if (action === 'adminSaveStore') publish({ stores: state.stores.map(item => item.id === id ? { ...item, ...second } : item) });
  else if (action === 'adminReviewFeedback') publish({ feedback: state.feedback.map(item => item.id === id ? { ...item, status: second.status, adminNote: second.note } : item) });
  else if (action === 'adminManageOrder') publish({ orders: state.orders.map(item => item.id === id ? { ...item, status: second === 'assign' ? 'accepted' : second === 'cancel' ? 'cancelled' : second, ...(second === 'assign' ? { riderId: third.riderId, riderName: state.adminUsers.find(user => user.id === third.riderId)?.name } : {}) } : item) });
  else if (action === 'adminSetAdmin') publish({ adminAdmins: [...state.adminAdmins.filter(item => item.id !== id), { id, enabled: second }] });
  else if (action === 'logout') publish({ user: null, profile: null, isAdmin: false });
  return true;
}
const actions = Object.fromEntries(['adminReviewRider','adminReviewStore','adminSetAccountStatus','adminSaveProfile','adminSaveStore','adminManageOrder','adminReviewFeedback','adminSetAdmin','logout','resetPassword','saveProfile','login','register','createOrder','submitFeedback'].map(action => [action, (...payload) => call(action, ...payload)]));
export function PlatformProvider({ children }) { return children; }
export function usePlatform() {
  const snapshot = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => state, () => state);
  return { ...snapshot, ...actions, clearError() { publish({ error: '' }); } };
}
`;

function makeFixture({ isAdmin = true, suspended = false } = {}) {
  const common = { phone: '+233241234567', city: 'Takoradi', photoUrl: '', accountStatus: 'active', createdAt: 1794600000000, bikeBrand: '', bikeModel: '', plate: '', online: false };
  const person = (id, name, role, patch = {}) => ({ ...common, id, name, role, email: `${id}@example.invalid`, ...patch });
  const admin = person('admin-owner', 'Service Administrator', 'customer', suspended ? { accountStatus: 'suspended', reviewNote: 'Please contact support for an account review.' } : {});
  const riders = [
    person('pending-rider', 'Kojo Pending', 'rider', { bikeBrand: 'Apsonic', bikeModel: 'AP 125', plate: 'WR 1000-26' }),
    person('online-rider', 'Ama Approved', 'rider', { approvalStatus: 'approved', online: true, bikeBrand: 'Royal', bikeModel: 'Flat', plate: 'WR 2000-26' }),
    person('offline-rider', 'Kofi Offline', 'rider', { approvalStatus: 'approved', online: false }),
    person('rejected-rider', 'Yaw Rejected', 'rider', { approvalStatus: 'rejected', online: true }),
    person('suspended-rider', 'Akua Suspended', 'rider', { approvalStatus: 'approved', accountStatus: 'suspended', online: true }),
  ];
  const customers = [person('customer-one', 'Abena Customer', 'customer')];
  const merchant = person('merchant-one', 'Nana Merchant', 'merchant');
  const suspendedAdmin = person('suspended-admin', 'Suspended Administrator', 'customer', { accountStatus: 'suspended' });
  const order = (id, status, patch = {}) => ({ id, status, creatorId: 'customer-one', customerName: 'Abena Customer', customerPhone: common.phone, recipientName: 'Kwame Recipient', recipientPhone: '+233551234567', pickup: 'Market Circle, Takoradi', dropoff: 'Effia Community Center', packageDescription: 'One bag of groceries', fee: 25, createdAt: 1794600000000, riderId: null, riderName: '', customerRating: null, riderRating: null, ...patch });
  return {
    calls: [], failNext: '', state: {
      user: { uid: admin.id, email: admin.email }, profile: admin, isAdmin,
      adminUsers: [admin, ...customers, merchant, ...riders, suspendedAdmin], riders,
      adminAdmins: [{ id: admin.id, enabled: true }, { id: suspendedAdmin.id, enabled: true }],
      stores: [{ id: merchant.id, ownerId: merchant.id, name: 'Nana Grocery Store', category: 'Groceries', address: 'Market Circle, Takoradi', phone: common.phone, description: 'Your local grocery store.', imageUrl: '/images/store-placeholder.svg', open: true, accountStatus: 'active', createdAt: 1794600000000 }],
      orders: [order('delivery-pending', 'pending'), order('delivery-assigned', 'accepted', { riderId: 'online-rider', riderName: 'Ama Approved' }), order('delivery-pickedup', 'picked_up', { riderId: 'online-rider', riderName: 'Ama Approved' }), order('delivery-completed', 'delivered', { riderId: 'online-rider', riderName: 'Ama Approved', customerRating: 5, customerRatingComment: 'Excellent service and quick delivery.', riderRating: 4, riderRatingComment: 'Clear pickup directions.' })],
      feedback: [{ id: 'feedback-open', ownerId: 'customer-one', name: 'Abena Customer', role: 'customer', message: 'Please add more riders around Kojokrom.', createdAt: 1794600000000 }, { id: 'feedback-resolved', ownerId: 'online-rider', name: 'Ama Approved', role: 'rider', message: 'My profile update is working now.', status: 'resolved', adminNote: 'Confirmed with the rider.', createdAt: 1794500000000 }],
      adminAudit: [{ id: 'audit-one', actorId: admin.id, action: 'rider_approved', targetType: 'rider', targetId: 'online-rider', note: 'Motorcycle and phone details checked.', createdAt: 1794600000000 }],
    },
  };
}

async function makePage({ viewport = { width: 1366, height: 900 }, path = '/', ...options } = {}) {
  const context = await browser.newContext({ viewport });
  const fixture = makeFixture(options);
  await context.addInitScript(value => { globalThis.__adminUi = value; }, fixture);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/src/context/PlatformContext.jsx') return route.fulfill({ status: 200, contentType: 'application/javascript', body: fixtureModule });
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL(path, baseUrl).href, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, [], 'Administrator fixture failed to start.');
  await page.getByRole('heading', { level: 1 }).or(page.getByRole('heading', { level: 2 })).first().waitFor();
  return { context, page, errors };
}
async function navigate(page, label, mobile = false) { await page.getByRole('navigation', { name: mobile ? 'Mobile navigation' : 'Main navigation', exact: true }).getByRole('button', { name: label, exact: true }).click(); }
async function callList(page) { return page.evaluate(() => globalThis.__adminUi.calls); }
async function noOverflow(page, description) { const widths = await page.evaluate(() => [window.innerWidth, document.documentElement.scrollWidth]); assert.ok(widths[1] <= widths[0] + 1, `${description} overflows horizontally: ${widths}`); }
async function check(name, task) { await task(); results.push(name); console.log(`PASS ${name}`); }

try {
  await check('All administrator sections render on desktop and mobile without overflow', async () => {
    for (const mobile of [false, true]) {
      const { page, context, errors } = await makePage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 } });
      try {
        await page.getByRole('heading', { name: 'Your service at a glance', exact: true }).waitFor();
        await noOverflow(page, 'Overview');
        await page.screenshot({ path: `${output}/${mobile ? 'mobile' : 'desktop'}-overview.png`, fullPage: true });
        for (const [label, title] of [['Riders', 'Rider management'], ['Stores', 'Store management'], ['Customers', 'Your customers'], ['Deliveries', 'All deliveries'], ['Feedback', 'Feedback & reviews'], ['Admin access', 'Administrator access'], ['Activity', 'Activity history']]) {
          await navigate(page, label, mobile);
          await page.getByRole('heading', { name: title, exact: true }).waitFor();
          await noOverflow(page, title);
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  });

  await check('Rider review requires reasons and keeps failed submissions editable', async () => {
    const { page, context, errors } = await makePage();
    try {
      await navigate(page, 'Riders');
      await page.getByRole('textbox', { name: 'Search records' }).fill('Kojo');
      await page.getByRole('button', { name: 'View & manage', exact: true }).click();
      await page.getByRole('dialog').getByText('WR 1000-26', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Reject', exact: true }).click();
      const reason = page.getByLabel('Review note (required)', { exact: true });
      assert.equal(await reason.getAttribute('maxlength'), '1000');
      await page.getByRole('button', { name: 'Reject application', exact: true }).click();
      assert.equal((await callList(page)).length, 0);
      await reason.fill('Please provide the motorcycle registration details.');
      await page.evaluate(() => { globalThis.__adminUi.failNext = 'Permission changed. Refresh your account.'; });
      await page.getByRole('button', { name: 'Reject application', exact: true }).click();
      await page.getByRole('alert').waitFor();
      assert.match(await page.getByRole('alert').innerText(), /Permission changed/);
      assert.equal(await reason.inputValue(), 'Please provide the motorcycle registration details.');
      await page.getByRole('button', { name: 'Reject application', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const calls = await callList(page);
      assert.equal(calls.at(-1).action, 'adminReviewRider');
      assert.deepEqual(calls.at(-1).payload, ['pending-rider', 'rejected', 'Please provide the motorcycle registration details.']);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Store details resolve the store rather than its matching owner UID, and edits save', async () => {
    const { page, context, errors } = await makePage();
    try {
      await navigate(page, 'Stores');
      await page.getByRole('button', { name: 'View & manage', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('heading', { name: 'Nana Grocery Store', exact: true }).waitFor();
      assert.match(await dialog.innerText(), /Nana Merchant/);
      await dialog.getByRole('button', { name: 'Edit store details', exact: true }).click();
      await page.getByLabel('Store name', { exact: true }).fill('Nana Fresh Grocery');
      await page.getByRole('button', { name: 'Save store', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('heading', { name: 'Nana Fresh Grocery', exact: true }).waitFor();
      await page.getByRole('button', { name: 'View & manage', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
      await page.getByLabel('Review note (optional)', { exact: true }).fill('Store contact and address verified.');
      await page.getByRole('button', { name: 'Approve application', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal((await callList(page)).at(-1).action, 'adminReviewStore');
      assert.equal((await callList(page)).at(-1).payload[0], 'merchant-one');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Assignments show only approved active online riders and support delivery status controls', async () => {
    const { page, context, errors } = await makePage();
    try {
      await navigate(page, 'Deliveries');
      const search = page.getByRole('textbox', { name: 'Search records' });
      await search.fill('delivery-pending');
      await page.getByRole('button', { name: 'Manage', exact: true }).click();
      await page.getByRole('button', { name: 'Assign rider', exact: true }).click();
      const select = page.getByLabel('Choose an approved, online rider', { exact: true });
      await select.waitFor();
      assert.deepEqual(await select.locator('option').allTextContents(), ['Select a rider', 'Ama Approved · Takoradi · WR 2000-26']);
      await select.selectOption('online-rider');
      await page.getByRole('button', { name: 'Assign rider', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      let calls = await callList(page);
      assert.deepEqual(calls.at(-1).payload, ['delivery-pending', 'assign', { riderId: 'online-rider', note: '' }]);
      await page.getByRole('button', { name: 'Manage', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm pickup', exact: true }).click();
      await page.getByRole('dialog').getByRole('heading', { name: 'Confirm package pickup', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Confirm pickup', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Manage', exact: true }).click();
      await page.getByRole('button', { name: 'Complete delivery', exact: true }).click();
      await page.getByRole('dialog').getByRole('heading', { name: 'Confirm delivery completed', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Complete delivery', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      calls = await callList(page);
      assert.deepEqual(calls.filter(item => item.action === 'adminManageOrder').map(item => item.payload[1]), ['assign', 'picked_up', 'delivered']);
      await search.fill('delivery-pickedup');
      await page.getByRole('button', { name: 'Manage', exact: true }).click();
      await page.getByRole('button', { name: 'Cancel delivery', exact: true }).click();
      const reason = page.getByLabel('Cancellation reason (required)', { exact: true });
      assert.equal(await reason.getAttribute('maxlength'), '2000');
      await page.getByRole('button', { name: 'Cancel delivery', exact: true }).click();
      assert.equal((await callList(page)).length, 3);
      await reason.fill('Recipient requested cancellation; sender and rider contacted.');
      await page.getByRole('button', { name: 'Cancel delivery', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal((await callList(page)).at(-1).payload[1], 'cancel');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Feedback reviews and account suspension persist status and notes', async () => {
    const { page, context, errors } = await makePage();
    try {
      await navigate(page, 'Feedback');
      await page.getByRole('combobox', { name: 'Filter records' }).selectOption('open');
      await page.getByRole('button', { name: 'Review feedback', exact: true }).click();
      await page.getByLabel('Review status', { exact: true }).selectOption('resolved');
      const note = page.getByLabel('Review note (optional)', { exact: true });
      assert.equal(await note.getAttribute('maxlength'), '2000');
      await note.fill('Added to the service coverage review.');
      await page.getByRole('button', { name: 'Save review', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.deepEqual((await callList(page)).at(-1).payload, ['feedback-open', { status: 'resolved', note: 'Added to the service coverage review.' }]);
      assert.match(await page.locator('.admin-rating-card').innerText(), /Excellent service/);
      await navigate(page, 'Customers');
      await page.getByRole('textbox', { name: 'Search records' }).fill('Abena');
      await page.getByRole('button', { name: 'View account', exact: true }).click();
      await page.getByRole('button', { name: 'Suspend account', exact: true }).click();
      await page.getByLabel('Review note (required)', { exact: true }).fill('Customer requested a temporary account hold.');
      await page.getByRole('button', { name: 'Suspend account', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal((await callList(page)).at(-1).action, 'adminSetAccountStatus');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Admin access protects self-revocation and permits revoking suspended administrators', async () => {
    const { page, context, errors } = await makePage();
    try {
      await navigate(page, 'Admin access');
      const owner = page.locator('.admin-record').filter({ hasText: 'admin-owner@example.invalid' });
      assert.equal(await owner.getByRole('button', { name: 'Revoke access', exact: true }).isDisabled(), true);
      const suspended = page.locator('.admin-record').filter({ has: page.getByRole('heading', { name: 'Suspended Administrator', exact: true }) });
      assert.equal(await suspended.getByRole('button', { name: 'Revoke access', exact: true }).isEnabled(), true);
      await suspended.getByRole('button', { name: 'Revoke access', exact: true }).click();
      await page.getByRole('button', { name: 'Revoke administrator access', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.deepEqual((await callList(page)).at(-1).payload, ['suspended-admin', false]);
      const customer = page.locator('.admin-record').filter({ has: page.getByRole('heading', { name: 'Abena Customer', exact: true }) });
      await customer.getByRole('button', { name: 'Grant admin access', exact: true }).click();
      await page.getByRole('button', { name: 'Grant administrator access', exact: true }).click();
      // Dispatch during the pending operation without waiting for modal animation stability.
      await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).dispatchEvent('click');
      assert.equal(await page.getByRole('dialog').count(), 1, 'Pending administrator changes must keep the confirmation open.');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.deepEqual((await callList(page)).at(-1).payload, ['customer-one', true]);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  await check('Non-admin, revoked and suspended accounts cannot access the administrator workspace', async () => {
    for (const scenario of [{ isAdmin: false, path: '/admin' }, { isAdmin: false, suspended: true, path: '/' }]) {
      const { page, context, errors } = await makePage(scenario);
      try {
        await page.getByRole('heading', { name: scenario.suspended ? 'Your account is suspended' : 'Administrator access required', exact: true }).waitFor();
        assert.equal(await page.getByRole('navigation').count(), 0);
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
    const { page, context, errors } = await makePage({ path: '/admin' });
    try {
      await navigate(page, 'Riders');
      await page.evaluate(() => globalThis.__updateAdminFixture({ isAdmin: false }));
      await page.getByRole('heading', { name: 'Administrator access required', exact: true }).waitFor();
      assert.equal(await page.getByRole('navigation').count(), 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  console.log(`\n${results.length} administrator UI checks passed. No live service data was changed.`);
} finally { await browser.close(); }
