// Local browser fixtures only: no database writes, real accounts, or SMS sends.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../.verification/login-tools/node_modules/playwright/index.mjs';

const origin = 'http://localhost:5173', output = '.verification/rider-performance';
await mkdir(output, { recursive: true });
const now = Date.parse('2026-11-14T18:30:00Z');
const profile = { id: 'rider-one', role: 'rider', name: 'Kofi Rider', city: 'Sekondi-Takoradi', email: 'rider@example.invalid', phone: '+233241234567', accountStatus: 'active', approvalStatus: 'approved', online: true, bikeBrand: 'Apsonic', bikeModel: 'AP125', plate: 'WR-100' };
const trip = (index, patch = {}) => ({ id: 'trip-' + index, riderId: profile.id, riderName: profile.name, status: 'delivered', creatorId: 'customer-one', creatorRole: 'customer', customerName: 'Customer ' + index, customerPhone: '+233241234567', recipientName: 'Abena', recipientPhone: '+233551234567', pickup: 'Market Circle', dropoff: 'Beach Rd', packageDescription: 'Parcel', fee: 25, createdAt: Date.parse('2026-11-01T12:00:00Z'), pickedUpAt: Date.parse('2026-11-01T12:00:00Z'), deliveredAt: Date.parse('2026-11-01T12:18:00Z'), ...patch });
const fees = [120, 160, 100, 140, 260, 360];
const orders = Array.from({ length: 24 }, (_, index) => trip(index, index < 6 ? {
  pickedUpAt: Date.parse('2026-11-' + String(14 - index).padStart(2, '0') + 'T12:00:00Z'),
  deliveredAt: Date.parse('2026-11-' + String(14 - index).padStart(2, '0') + 'T12:18:00Z'),
  fee: fees[5 - index],
  customerName: index === 0 ? 'Safo' : index === 1 ? 'Ama Serwaa' : 'Kwame',
  pickup: index === 1 ? 'Anaji' : 'Market Circle', dropoff: index === 1 ? 'Effia' : 'Beach Rd',
  customerRating: 5, customerRatedAt: now - index * 86400000,
  customerRatingComment: index === 0 ? 'Very fast pickup and polite rider. Package arrived intact!' : index === 1 ? 'Followed landmarks accurately. Great service.' : 'Thank you for the careful delivery.',
} : index < 12 ? { customerRating: index === 11 ? 4 : 5 } : {}));
orders.push(trip('cancelled', { status: 'cancelled' }), trip('active', { status: 'accepted' }), trip('foreign', { riderId: 'another-rider', fee: 10000, deliveredAt: now, customerRating: 1, customerRatingComment: 'PRIVATE OTHER RIDER REVIEW' }));
const recipientReviews = [5,4,5,4].map((riderRating,index)=>({orderId:'recipient-'+index,riderId:profile.id,merchantId:'merchant-one',riderRating,merchantRating:5,comment:index===0?'Kind rider and a safe delivery.':'Thanks for delivering.',createdAt:now-index*1000}));
const fixture = { profile, user: { uid: profile.id }, isAdmin: false, authLoading: false, adminLoading: false, authActionPending: false, dataLoading: false, needsProfile: false, firebaseConfigured: true, error: '', orders, recipientReviews, riders: [], stores: [], smsMessages: [], liveLocations: {} };
const provider = `
import React from '/node_modules/.vite/deps/react.js';
const listeners = new Set();let state=globalThis.__fixture;
function update(patch){state={...state,...patch};listeners.forEach(fn=>fn());}
globalThis.__update=update;
export function PlatformProvider({children}){return children;}
export function usePlatform(){const snapshot=React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>state);return {...snapshot,clearError(){},async logout(){},async saveProfile(){},async rateOrder(id,rating,comment){globalThis.__rated={id,rating,comment};update({orders:state.orders.map(order=>order.id===id?{...order,riderRating:rating}:order)});}};}
`;
const browser = await chromium.launch({ headless: true });
async function noOverflow(page, label) {
  const size = await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
  assert.ok(size[1] <= size[0] + 1, label + ' overflows: ' + size);
}
try {
  for (const width of [1366, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(state => { globalThis.__fixture = state; }, fixture);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
      if (url.pathname === '/src/context/PlatformContext.jsx') return route.fulfill({ status: 200, contentType: 'application/javascript', body: provider });
      return route.continue();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.clock.install({ time: now });
      await page.goto(origin, { waitUntil: 'networkidle' });
      const nav = page.getByRole('navigation', { name: width < 720 ? 'Mobile navigation' : 'Main navigation', exact: true });
      await nav.getByRole('button', { name: 'Performance', exact: true }).click();
      await page.getByRole('heading', { name: 'My Performance', exact: true }).waitFor();
      const metrics = page.locator('.performance-metric');
      assert.equal(await metrics.count(), 3);
      assert.match(await metrics.nth(0).innerText(), /96%/);
      assert.match(await metrics.nth(1).innerText(), /18 min/);
      assert.match(await metrics.nth(2).innerText(), /4\.92/);
      assert.match(await metrics.nth(2).innerText(), /12 reviews/);
      assert.equal((await page.locator('.performance-weekly-total').innerText()).replace(/\s/g, ''), 'GH\u20b51,140.00');
      const days = page.getByRole('group', { name: 'Daily earnings for this week' });
      assert.equal(await days.getByRole('button').count(), 7);
      assert.equal(await days.getByRole('button', { name: /Saturday/ }).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.performance-review').count(), 3);
      assert.equal(await page.getByText('PRIVATE OTHER RIDER REVIEW', { exact: true }).count(), 0);
      const recipientFeedback=page.getByRole('region',{name:'Recipient feedback',exact:true});
      assert.match(await recipientFeedback.innerText(),/4\.5/);assert.match(await recipientFeedback.innerText(),/4 recipient reviews/);
      assert.equal(await recipientFeedback.locator('article').count(),3);
      assert.match(await recipientFeedback.innerText(),/Kind rider and a safe delivery/);
      assert.equal(await recipientFeedback.getByText('Store 5/5',{exact:true}).count(),0);
      await recipientFeedback.getByRole('button',{name:'View all recipient reviews',exact:true}).click();assert.equal(await recipientFeedback.locator('article').count(),4);
      await recipientFeedback.getByRole('button',{name:'Show fewer reviews',exact:true}).click();assert.equal(await recipientFeedback.locator('article').count(),3);
      await noOverflow(page, width + 'px performance');
      await page.screenshot({ path: output + '/performance-' + width + '.png', fullPage: true, animations: 'disabled' });
      await days.getByRole('button', { name: /Monday/ }).click();
      assert.match(await page.locator('.performance-day-details').innerText(), /Monday/);
      assert.match(await page.locator('.performance-day-details').innerText(), /120\.00/);
      await days.getByRole('button', { name: /Sunday/ }).click();
      assert.match(await page.locator('.performance-day-details').innerText(), /0\.00/);
      await page.getByRole('button', { name: 'View all 12 reviews', exact: true }).click();
      assert.equal(await page.locator('.performance-review').count(), 12);
      await page.getByRole('button', { name: 'Show fewer reviews', exact: true }).click();
      assert.equal(await page.locator('.performance-review').count(), 3);
      await page.getByRole('button', { name: 'Rate customer', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Completed (24)', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.locator('.rider-request-record').first().getByRole('button').click();
      await page.getByRole('dialog', { name: 'Delivery details', exact: true }).getByRole('button', { name: 'Rate customer', exact: true }).click();
      const rating = page.getByRole('dialog', { name: 'Rate your customer', exact: true });
      await rating.getByRole('button', { name: '4 stars', exact: true }).click();
      await rating.getByRole('button', { name: 'Save rating', exact: true }).click();
      await rating.waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => __rated), { id: 'trip-0', rating: 4, comment: '' });
      await nav.getByRole('button', { name: 'Performance', exact: true }).click();
      await page.evaluate(order => __update({ orders: [order] }), trip('long', { fee: 9999999.99, deliveredAt: now, pickedUpAt: now - 4 * 86400000, customerName: 'AlexandermensahowusukyekyereLongCustomerName', pickup: 'Longpickupaddresswithoutspaces'.repeat(4), dropoff: 'A long address near the community center in Sekondi-Takoradi', customerRating: 5, customerRatingComment: 'Longreviewwithoutspaces'.repeat(12) }));
      await noOverflow(page, width + 'px long performance values');
      const clipped = await page.locator('.performance-metric strong,.performance-review-heading h3,.performance-review p,.performance-weekly-total').evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));
      assert.deepEqual(clipped, [], 'Performance values and reviews wrap fully.');
      await page.screenshot({ path: output + '/long-values-' + width + '.png', fullPage: true, animations: 'disabled' });
      await page.evaluate(() => __update({ orders: [], recipientReviews: [] }));
      assert.match(await recipientFeedback.innerText(),/Your first recipient review will appear here/);
      assert.equal(await page.locator('.performance-bar-empty').count(), 7);
      assert.equal(await page.getByRole('button', { name: 'Rate customer', exact: true }).isDisabled(), true);
      assert.match(await page.locator('.performance-weekly-total').innerText(), /0\.00/);
      await noOverflow(page, width + 'px empty performance');
      await page.screenshot({ path: output + '/empty-' + width + '.png', animations: 'disabled' });
      assert.deepEqual(errors, []);
      console.log('PASS ' + width + 'px: performance metrics/fees, interactive days, sender/recipient reviews, customer ratings, long values, and empty states.');
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
