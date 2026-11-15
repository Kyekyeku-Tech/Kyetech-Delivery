import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverySmsForChange } from '../server/deliverySms.mjs';
import { createSmsService } from '../server/sms.mjs';
import { createFirestoreSmsStore } from '../server/firestoreSmsStore.mjs';
import { getMerchantSmsMessages } from '../src/lib/merchantSms.js';
import { createDeliveryReviewInvite, RECIPIENT_REVIEW_LIFETIME_MS } from '../server/deliveryReview.mjs';

const orderId = 'merchantABC123';
const booking = { creatorRole: 'merchant', creatorId: 'merchant-one', merchantId: 'merchant-one', customerName: 'Millicent Merchant', customerPhone: '+233241234567', recipientName: 'Kwame Receiver', recipientPhone: '+233551234567', riderId: 'rider-one', riderName: 'Kofi Rider', status: 'picked_up' };
const build = (before, after = booking) => deliverySmsForChange({ orderId, before, after, appUrl: 'https://kyetechdelivery.site' });

test('merchant pickup and completion notify the saved delivery recipient and scope copies to the store', () => {
  const pickup = build({ status: 'accepted' });
  assert.equal(pickup.recipient, '0551234567');
  assert.notEqual(pickup.recipient, '0241234567', 'The merchant owner is not the delivery recipient.');
  assert.equal(pickup.customerId, '');
  assert.equal(pickup.merchantId, 'merchant-one');
  assert.equal(pickup.sender, 'KYE-TECH');
  assert.equal(pickup.recipientReviewToken, '');
  assert.equal(pickup.reviewInvite, undefined);
  assert.match(pickup.message, /KYE-ABC123.*picked up/);
  assert.doesNotMatch(pickup.message, /from Ada Groceries/);
  const completion = build({ status: 'picked_up' }, { ...booking, status: 'delivered' });
  assert.notEqual(completion.id, pickup.id);
  assert.equal(completion.recipient, pickup.recipient);
  assert.match(completion.message, /KYE-ABC123.*is complete/);
  assert.match(completion.message, /Please rate your rider and merchant store:/);
  const reviewLink = new URL(completion.message.split(' ').at(-1));
  assert.equal(reviewLink.origin + reviewLink.pathname, 'https://kyetechdelivery.site/review');
  assert.match(reviewLink.searchParams.get('token'), /^[a-f0-9]{48}$/);
  assert.equal(reviewLink.searchParams.get('token'), completion.recipientReviewToken);
  assert.equal(completion.reviewInvite.orderId, orderId);
  assert.equal(completion.reviewInvite.merchantId, booking.creatorId);
  assert.equal(completion.reviewInvite.riderId, booking.riderId);
  assert.doesNotMatch(completion.message, /[?]rate=/);
  assert.equal(build({ status: 'accepted' }, { ...booking, recipientPhone: 'invalid' }), null, 'Invalid recipient numbers cannot fall back to the merchant owner.');
  assert.equal(build({ status: 'accepted' }, { ...booking, recipientPhone: '' }), null);
});

test('merchant SMS inbox selection excludes other stores, customer messages, failures and incomplete copies', () => {
  const sms = (id, patch = {}) => ({ id, orderId: 'delivery-one', merchantId: 'merchant-one', customerId: '', status: 'submitted', type: 'picked_up', message: 'Your delivery is on the way.', ...patch });
  const messages = [sms('pickup'), sms('complete', { type: 'delivered' }), sms('other-store', { merchantId: 'merchant-two' }), sms('customer', { merchantId: '', customerId: 'customer-one' }), sms('failed', { status: 'failed' }), sms('pending', { status: 'submitting' }), sms('empty', { message: ' ' }), sms('legacy', { message: undefined }), sms('wrong-stage', { type: 'accepted' }), null,
    sms('missing-order', { orderId: undefined }), sms('number-order', { orderId: 123 }), sms('invalid-order', { orderId: 'orders/private' }), sms(undefined), sms('invalid/id'), sms('oversized-order', { orderId: 'a'.repeat(129) })];
  assert.deepEqual(getMerchantSmsMessages(messages, 'merchant-one').map(item => item.id), ['pickup', 'complete']);
  assert.deepEqual(getMerchantSmsMessages(messages, 'merchant-two').map(item => item.id), ['other-store']);
  assert.deepEqual(getMerchantSmsMessages(messages, ''), []);
});

test('merchant notification copies reserve each stage once and archive store metadata without a recipient number', async () => {
  const documents = new Map(), writes = [], sent = [], commits = [];
  const fakeFirestore = async (url, options = {}) => {
    assert.equal(options.headers.Authorization, 'Bearer assigned-rider-token');
    if (options.method === 'POST') {
      const batch = JSON.parse(options.body).writes;
      commits.push(batch);
      // Simulate Firestore atomicity: check every precondition before applying any write.
      if (batch.some(write => write.currentDocument.exists === false && documents.has(write.update.name))) return { ok: false, status: 409, json: async () => ({ error: { status: 'ALREADY_EXISTS' } }) };
      for (const write of batch) {
        writes.push(write);
        documents.set(write.update.name, { ...(documents.get(write.update.name) || {}), ...write.update.fields });
      }
      return { ok: true, status: 200 };
    }
    const name = String(url).replace('https://firestore.googleapis.com/v1/', '');
    return { ok: documents.has(name), status: documents.has(name) ? 200 : 404, json: async () => ({ fields: documents.get(name) }) };
  };
  const options = {
    projectId: 'test-project', apiKey: 'private-fixture-key', verify: async () => ({ uid: 'rider-one' }),
    read: async path => path.startsWith('users/') ? { role: 'rider', approvalStatus: 'approved', accountStatus: 'active' } : path.startsWith('admins/') ? null : booking,
    send: async message => { sent.push(message); return { providerCode: '2000', campaignId: 'campaign-one' }; },
    storeFactory: context => createFirestoreSmsStore({ ...context, fetchImpl: fakeFirestore }),
  };
  const notify = createSmsService(options), request = { token: 'assigned-rider-token', orderId, status: 'picked_up' };
  await Promise.all([notify(request), notify(request), notify(request)]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].recipient, '0551234567');
  assert.equal((await createSmsService(options)(request)).status, 'submitted');
  assert.equal(sent.length, 1, 'Recreating the service cannot send a duplicate notification.');
  const complete = createSmsService({ ...options, read: async path => path.startsWith('users/') ? { role: 'rider', approvalStatus: 'approved', accountStatus: 'active' } : path.startsWith('admins/') ? null : { ...booking, status: 'delivered' } });
  assert.equal((await complete({ ...request, status: 'delivered' })).status, 'submitted');
  assert.equal(sent.length, 2);
  await Promise.all([complete({ ...request, status: 'delivered' }), complete({ ...request, status: 'delivered' })]);
  assert.equal(sent.length, 2, 'Completion retries neither send again nor orphan another review invitation.');
  const claims = writes.filter(write => write.currentDocument.exists === false && write.update.name.includes('/deliverySms/'));
  assert.equal(claims.length, 2);
  for (const claim of claims) {
    assert.equal(claim.update.fields.merchantId.stringValue, 'merchant-one');
    assert.equal(claim.update.fields.customerId.stringValue, '');
    assert.equal(claim.update.fields.actorId.stringValue, 'rider-one');
    assert.equal(claim.update.fields.sender.stringValue, 'KYE-TECH');
    assert.ok(!('recipient' in claim.update.fields));
    assert.ok(!('recipientPhone' in claim.update.fields));
    assert.ok(!('apiKey' in claim.update.fields));
    assert.ok(!('reviewInvite' in claim.update.fields));
  }
  assert.equal(claims[0].update.fields.recipientReviewToken.stringValue, '');
  const completionToken = claims[1].update.fields.recipientReviewToken.stringValue;
  assert.match(completionToken, /^[a-f0-9]{48}$/);
  assert.equal(new URL(sent[1].message.split(' ').at(-1)).searchParams.get('token'), completionToken);
  const invites = writes.filter(write => write.update.name.includes('/deliveryReviewLinks/'));
  assert.equal(invites.length, 1);
  assert.equal(invites[0].update.name, `projects/test-project/databases/(default)/documents/deliveryReviewLinks/${completionToken}`);
  assert.deepEqual(Object.keys(invites[0].update.fields).sort(), ['expiresAt', 'merchantId', 'merchantName', 'orderId', 'riderId', 'riderName', 'usedAt']);
  assert.equal(invites[0].update.fields.orderId.stringValue, orderId);
  assert.equal(invites[0].update.fields.merchantName.stringValue, 'Your merchant store');
  assert.equal(invites[0].update.fields.riderName.stringValue, 'Kofi Rider');
  assert.equal(invites[0].update.fields.usedAt.nullValue, null);
  assert.deepEqual(invites[0].updateTransforms, [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }]);
  assert.ok(Date.parse(invites[0].update.fields.expiresAt.timestampValue) > Date.now() + 29 * 86400000);
  assert.ok(commits.some(batch => batch.length === 2 && batch[0].update.name.includes('/deliverySms/') && batch[1].update.name.includes('/deliveryReviewLinks/')), 'SMS and review invitation share one atomic claim.');
  assert.equal(documents.size, 3);
});

test('merchant store owners cannot trigger delivery SMS as the assigned rider', async () => {
  let sends = 0;
  const notify = createSmsService({
    projectId: 'test-project', apiKey: 'private-fixture-key', verify: async () => ({ uid: 'merchant-one' }),
    read: async path => path.startsWith('users/') ? { role: 'merchant', accountStatus: 'active' } : path.startsWith('admins/') ? null : booking,
    send: async () => { sends++; },
  });
  await assert.rejects(notify({ token: 'merchant-token', orderId, status: 'picked_up' }), error => error.status === 403);
  assert.equal(sends, 0);
});

test('recipient review invitations use random capabilities, expire in thirty days and contain service identities only', () => {
  const completed = { ...booking, status: 'delivered' }, now = Date.parse('2026-11-14T12:00:00Z');
  const first = createDeliveryReviewInvite({ orderId, order: completed, merchantName: 'Ada Groceries', now });
  const second = createDeliveryReviewInvite({ orderId, order: completed, merchantName: 'Ada Groceries', now });
  assert.match(first.token, /^[a-f0-9]{48}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(Date.parse(first.expiresAt) - now, RECIPIENT_REVIEW_LIFETIME_MS);
  assert.equal(RECIPIENT_REVIEW_LIFETIME_MS, 30 * 86400000);
  assert.equal(first.merchantName, 'Ada Groceries');
  assert.equal(first.riderName, 'Kofi Rider');
  assert.equal(first.usedAt, null);
  assert.deepEqual(Object.keys(first).sort(), ['expiresAt', 'merchantId', 'merchantName', 'orderId', 'riderId', 'riderName', 'token', 'usedAt']);
  assert.throws(() => createDeliveryReviewInvite({ orderId, order: booking }));
  assert.throws(() => createDeliveryReviewInvite({ orderId, order: completed, token: 'guessable' }));
  assert.throws(() => createDeliveryReviewInvite({ orderId: 'orders/private', order: completed }));
});

test('recipient invites use the store name read with the assigned actor token and metadata failure keeps SMS available', async () => {
  for (const metadata of ['available', 'denied', 'missing', 'invalid']) {
    let captured, sends = 0;
    const notify = createSmsService({
      projectId: 'test-project', apiKey: 'private-fixture-key', verify: async () => ({ uid: 'rider-one' }),
      read: async (path, token) => {
        assert.equal(token, 'assigned-rider-token');
        if (path.startsWith('users/')) return { role: 'rider', approvalStatus: 'approved', accountStatus: 'active' };
        if (path.startsWith('admins/')) return null;
        if (path.startsWith('orders/')) return { ...booking, status: 'delivered' };
        assert.equal(path, 'stores/merchant-one');
        if (metadata === 'denied') throw new Error('Store metadata denied');
        if (metadata === 'missing') return null;
        return { name: metadata === 'available' ? 'Ada Groceries' : 'a'.repeat(101) };
      },
      storeFactory: ({ job }) => { captured = job; return { claim: async () => job, save: async () => {} }; },
      send: async () => { sends++; return { providerCode: '2000', campaignId: 'campaign-one' }; },
    });
    assert.equal((await notify({ token: 'assigned-rider-token', orderId, status: 'delivered' })).status, 'submitted');
    assert.equal(sends, 1);
    assert.equal(captured.reviewInvite.merchantName, metadata === 'available' ? 'Ada Groceries' : 'Your merchant store');
    assert.notEqual(captured.reviewInvite.merchantName, booking.customerName);
  }
});

test('a rejected atomic review claim cannot send a dead link or expose a half-created SMS reservation', async () => {
  let sends = 0, claims = 0;
  const options = {
    projectId: 'test-project', apiKey: 'private-fixture-key', verify: async () => ({ uid: 'rider-one' }),
    read: async path => path.startsWith('users/') ? { role: 'rider', approvalStatus: 'approved', accountStatus: 'active' } : path.startsWith('admins/') ? null : path.startsWith('stores/') ? { name: 'Ada Groceries' } : { ...booking, status: 'delivered' },
    send: async () => { sends++; },
  };
  const notify = createSmsService({ ...options, storeFactory: context => createFirestoreSmsStore({ ...context, fetchImpl: async (_url, config) => {
    const writes = JSON.parse(config.body).writes;
    assert.equal(writes.length, 2);
    assert.ok(writes.every(write => write.currentDocument.exists === false));
    claims++;
    return { ok: false, status: 403, json: async () => ({ error: { status: 'PERMISSION_DENIED' } }) };
  } }) });
  await assert.rejects(notify({ token: 'assigned-rider-token', orderId, status: 'delivered' }));
  assert.equal(claims, 1);
  assert.equal(sends, 0);
  await assert.rejects(createSmsService(options)({ token: 'assigned-rider-token', orderId, status: 'delivered' }), error => error.status === 503);
  assert.equal(sends, 0, 'Disk fallback cannot send a review invitation that was never persisted.');
});
