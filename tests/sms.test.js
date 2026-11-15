import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { sendQuickSms, SmsSubmissionError } from '../server/mnotify.mjs';
import { deliverySmsForChange } from '../server/deliverySms.mjs';
import { createSmsService, createDeliverySmsMiddleware } from '../server/sms.mjs';
import { notifyDeliverySms, deliveryUpdateNotice } from '../src/lib/sms.js';
import { createServer } from 'node:http';
import { createFirestoreSmsStore } from '../server/firestoreSmsStore.mjs';

const orderId = 'deliveryABC123';
const booking = { creatorRole: 'customer', creatorId: 'customer-one', customerPhone: '+233241234567', riderId: 'rider-one', status: 'picked_up' };
const approved = { role: 'rider', approvalStatus: 'approved', accountStatus: 'active' };
const providerSuccess = () => ({ ok: true, status: 200, json: async () => ({ status: 'success', code: '2000', summary: { total_sent: 1, total_rejected: 0, _id: 'campaign-one' } }) });

test('mNotify sends the saved customer number and KYE-TECH sender using the documented JSON format', async () => {
  const sent = [];
  const result = await sendQuickSms({ apiKey: 'private-test-key', recipient: '+233 24 123 4567', message: 'Pickup confirmed.', fetchImpl: async (url, options) => { sent.push({ url, options }); return providerSuccess(); } });
  assert.equal(sent[0].url.origin + sent[0].url.pathname, 'https://api.mnotify.com/api/sms/quick');
  assert.equal(sent[0].url.searchParams.get('key'), 'private-test-key');
  assert.deepEqual(JSON.parse(sent[0].options.body), { recipient: ['0241234567'], sender: 'KYE-TECH', message: 'Pickup confirmed.', is_schedule: false, schedule_date: '' });
  assert.equal(sent[0].options.method, 'POST');
  assert.equal(sent[0].options.headers['Content-Type'], 'application/json');
  assert.equal(sent[0].options.signal instanceof AbortSignal, true);
  assert.deepEqual(result, { providerCode: '2000', campaignId: 'campaign-one' });
});

test('provider errors, zero accepted recipients and uncertain responses cannot report SMS success or reveal the key', async () => {
  for (const [http, data, outcome] of [
    [200, { status: 'error', code: '4000', message: 'private-test-key' }, 'failed'],
    [200, { status: 'success', code: '2000', summary: { total_sent: 0 } }, 'failed'],
    [200, { status: 'success', code: '2000', summary: { total_sent: 1, total_rejected: 1 } }, 'failed'],
    [500, { status: 'error' }, 'unknown'],
  ]) {
    await assert.rejects(sendQuickSms({ apiKey: 'private-test-key', recipient: '0241234567', message: 'Update', fetchImpl: async () => ({ ok: http < 400, status: http, json: async () => data }) }), error => error instanceof SmsSubmissionError && error.outcome === outcome && !error.message.includes('private-test-key'));
  }
  await assert.rejects(sendQuickSms({ apiKey: 'private-test-key', recipient: '0241234567', message: 'Update', fetchImpl: async () => { throw new Error('private-test-key'); } }), error => error.outcome === 'unknown' && !error.message.includes('private-test-key'));
  let called = false;
  await assert.rejects(sendQuickSms({ apiKey: '', recipient: 'invalid', message: 'Update', fetchImpl: async () => { called = true; } }));
  assert.equal(called, false);
});

test('pickup and completion SMS use distinct stages, with a private-account rating link on completion', () => {
  const build = (before, after = booking) => deliverySmsForChange({ orderId, before, after, appUrl: 'https://kyetechdelivery.site/?old=value#old' });
  const pickup = build({ status: 'accepted' });
  assert.equal(pickup.recipient, '0241234567');
  assert.equal(pickup.sender, 'KYE-TECH');
  assert.equal(pickup.customerId, booking.creatorId);
  assert.match(pickup.message, /KYE-ABC123.*picked up/);
  const complete = build({ status: 'picked_up' }, { ...booking, status: 'delivered' });
  assert.notEqual(pickup.id, complete.id);
  assert.match(complete.message, /Please rate your rider: https:\/\/kyetechdelivery\.site\/\?rate=deliveryABC123$/);
  for (const [before, after] of [
    [{ status: 'picked_up' }, booking],
    [{ status: 'delivered' }, { ...booking, status: 'delivered', customerRating: 5 }],
    [{ status: 'pending' }, { ...booking, status: 'cancelled' }],
    [{ status: 'accepted' }, { ...booking, creatorRole: 'merchant' }],
    [{ status: 'accepted' }, { ...booking, creatorId: '' }],
    [{ status: 'accepted' }, { ...booking, customerPhone: 'invalid' }],
  ]) assert.equal(build(before, after), null);
});

async function withOutbox(task) {
  const parent = resolve('.verification');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(resolve(parent, 'sms-tests-'));
  try { await task(directory); }
  finally { assert.ok(directory.startsWith(parent + sep)); await rm(directory, { recursive: true, force: true }); }
}

function fixture(directory, patch = {}) {
  const sent = [];
  const options = {
    projectId: 'test-project', apiKey: 'private-test-key', outboxDir: directory,
    verify: async token => { if (token !== 'valid-rider') throw new Error('invalid'); return { uid: 'rider-one' }; },
    read: async path => path.startsWith('users/') ? approved : path.startsWith('admins/') ? null : booking,
    send: async message => { sent.push(message); return { providerCode: '2000', campaignId: 'campaign-one' }; },
    ...patch,
  };
  return { options, sent, notify: createSmsService(options) };
}

test('concurrent requests and server restarts submit each pickup or completion SMS once', async () => withOutbox(async directory => {
  const { options, sent, notify } = fixture(directory);
  const request = { token: 'valid-rider', orderId, status: 'picked_up' };
  const results = await Promise.all([notify(request), notify(request), notify(request)]);
  assert.equal(sent.length, 1);
  assert.ok(results.some(result => result.status === 'submitted'));
  assert.equal((await createSmsService(options)(request)).status, 'submitted');
  assert.equal(sent.length, 1);
  const completed = createSmsService({ ...options, read: async path => path.startsWith('users/') ? approved : path.startsWith('admins/') ? null : { ...booking, status: 'delivered' } });
  assert.equal((await completed({ ...request, status: 'delivered' })).status, 'submitted');
  assert.equal(sent.length, 2);
  assert.equal(JSON.parse(await readFile(resolve(directory, `${orderId}_delivered.json`), 'utf8')).campaignId, 'campaign-one');
}));

test('customer, suspended rider, different rider, stale status and unauthenticated requests cannot send SMS', async () => withOutbox(async directory => {
  for (const profile of [{ role: 'customer', accountStatus: 'active' }, { ...approved, accountStatus: 'suspended' }, { ...approved, approvalStatus: 'pending' }]) {
    const { notify, sent } = fixture(directory, { read: async path => path.startsWith('users/') ? profile : path.startsWith('admins/') ? null : booking });
    await assert.rejects(notify({ token: 'valid-rider', orderId, status: 'picked_up' }), error => error.status === 403);
    assert.equal(sent.length, 0);
  }
  const { notify, sent } = fixture(directory, { read: async path => path.startsWith('users/') ? approved : path.startsWith('admins/') ? null : { ...booking, riderId: 'rider-two' } });
  await assert.rejects(notify({ token: 'valid-rider', orderId, status: 'picked_up' }), error => error.status === 403);
  assert.equal(sent.length, 0);
  const current = fixture(directory);
  await assert.rejects(current.notify({ token: '', orderId, status: 'picked_up' }), error => error.status === 401);
  await assert.rejects(current.notify({ token: 'valid-rider', orderId, status: 'delivered' }), error => error.status === 409);
  assert.equal(current.sent.length, 0);
}));

test('Administrator SMS sends require an active OTP grant bound to the custom-token login', async () => withOutbox(async directory => {
  const sessionId = 'a'.repeat(64), authTime = Math.floor(Date.now() / 1000), account = { uid: 'admin-one', auth_time: authTime, adminOtpSessionId: sessionId, firebase: { sign_in_provider: 'custom' } };
  const valid = { uid: account.uid, status: 'active', authTime, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  for (const [identity, grant] of [
    [{ ...account, adminOtpSessionId: undefined }, valid], [{ ...account, firebase: { sign_in_provider: 'password' } }, valid],
    [account, { ...valid, uid: 'someone-else' }], [account, { ...valid, status: 'pending' }], [account, { ...valid, authTime: authTime - 1 }], [account, { ...valid, expiresAt: new Date(Date.now() - 1).toISOString() }], [account, null],
  ]) {
    const f = fixture(directory, { verify: async () => identity, read: async path => path.startsWith('users/') ? { role: 'merchant', accountStatus: 'active' } : path.startsWith('admins/') ? { enabled: true } : path.startsWith('adminOtpSessions/') ? grant : booking });
    await assert.rejects(f.notify({ token: 'valid-admin', orderId, status: 'picked_up' }), error => error.status === 403);
    assert.equal(f.sent.length, 0);
  }
  const f = fixture(directory, { verify: async () => account, read: async path => path.startsWith('users/') ? { role: 'merchant', accountStatus: 'active' } : path.startsWith('admins/') ? { enabled: true } : path.startsWith('adminOtpSessions/') ? valid : booking });
  assert.equal((await f.notify({ token: 'valid-admin', orderId, status: 'picked_up' })).status, 'submitted');
  assert.equal(f.sent.length, 1);
}));

test('failed or uncertain SMS records survive retries without submitting another message', async () => withOutbox(async directory => {
  for (const outcome of ['failed', 'unknown']) {
    let attempts = 0;
    const notify = fixture(directory, { send: async () => { attempts++; throw new SmsSubmissionError(outcome, 'test-provider-error'); } }).notify;
    const request = { token: 'valid-rider', orderId: `${orderId}${outcome}`, status: 'picked_up' };
    assert.equal((await notify(request)).status, outcome);
    assert.equal((await notify(request)).status, outcome);
    assert.equal(attempts, 1);
  }
}));

test('the HTTP SMS route rejects arbitrary recipients and accepts only authenticated delivery updates', async () => withOutbox(async directory => {
  const { options, sent } = fixture(directory);
  const server = createServer(createDeliverySmsMiddleware(options));
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer valid-rider' };
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ orderId, status: 'picked_up', recipient: '0209999999' }) })).status, 400);
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ orderId, status: 'picked_up' }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'submitted' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].recipient, '0241234567');
  } finally { await new Promise(resolveClose => server.close(resolveClose)); }
}));

test('the browser requests SMS only with its Firebase token and preserves a successful delivery when SMS fails', async () => {
  let payload;
  const account = { getIdToken: async () => 'signed-user-token' };
  const result = await notifyDeliverySms(account, orderId, 'delivered', async (url, options) => { payload = { url, options }; return { ok: true, json: async () => ({ status: 'submitted', apiKey: 'must-not-be-forwarded' }) }; });
  assert.equal(payload.url, '/api/delivery-sms');
  assert.equal(payload.options.headers.Authorization, 'Bearer signed-user-token');
  assert.deepEqual(JSON.parse(payload.options.body), { orderId, status: 'delivered' });
  assert.deepEqual(result, { status: 'submitted' });
  assert.deepEqual(await notifyDeliverySms(account, orderId, 'delivered', async () => { throw new Error('offline'); }), { status: 'unavailable' });
  assert.match(deliveryUpdateNotice({ sms: { status: 'unavailable' } }, 'Delivery completed.').message, /^Delivery completed\./);
});

test('Vercel handles a parsed request body and stores duplicate protection in Firestore without local disk', async () => {
  const documents = new Map();
  const commits = [];
  const fakeFirestore = async (url, options = {}) => {
    assert.equal(options.headers.Authorization, 'Bearer valid-rider');
    if (options.method === 'POST') {
      const body = JSON.parse(options.body), write = body.writes[0];
      commits.push(write);
      if (write.currentDocument.exists === false && documents.has(write.update.name)) return { ok: false, status: 409, json: async () => ({ error: { status: 'ALREADY_EXISTS' } }) };
      const existing = documents.get(write.update.name) || {};
      documents.set(write.update.name, { ...existing, ...write.update.fields });
      return { ok: true, status: 200 };
    }
    const name = String(url).replace('https://firestore.googleapis.com/v1/', '');
    return { ok: documents.has(name), status: documents.has(name) ? 200 : 404, json: async () => ({ fields: documents.get(name) }) };
  };
  let sends = 0;
  const options = {
    projectId: 'test-project', apiKey: 'private-test-key', verify: async () => ({ uid: 'rider-one' }),
    read: async path => path.startsWith('users/') ? approved : path.startsWith('admins/') ? null : booking,
    send: async () => { sends++; return { providerCode: '2000', campaignId: 'campaign-one' }; },
    storeFactory: context => createFirestoreSmsStore({ ...context, fetchImpl: fakeFirestore }),
  };
  const middleware = createDeliverySmsMiddleware(options);
  const server = createServer((request, response) => {
    // Vercel's Node runtime parses JSON before passing the request to the handler.
    request.body = { orderId, status: 'picked_up' };
    middleware(request, response);
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const request = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-rider' }, body: '{}' };
    assert.deepEqual(await (await fetch(url, request)).json(), { status: 'submitted' });
    assert.deepEqual(await (await fetch(url, request)).json(), { status: 'submitted' });
    assert.equal(sends, 1);
    const claim = commits.find(write => write.currentDocument.exists === false);
    assert.equal(claim.update.fields.actorId.stringValue, 'rider-one');
    assert.equal(claim.update.fields.customerId.stringValue, booking.creatorId);
    assert.equal(claim.update.fields.sender.stringValue, 'KYE-TECH');
    assert.equal(claim.update.fields.message.stringValue, deliverySmsForChange({ orderId, before: { status: 'accepted' }, after: booking }).message);
    assert.ok(!('recipient' in claim.update.fields));
    assert.ok(!('apiKey' in claim.update.fields));
    assert.equal(claim.updateTransforms.find(transform => transform.fieldPath === 'createdAt').setToServerValue, 'REQUEST_TIME');
  } finally { await new Promise(resolveClose => server.close(resolveClose)); }
});
