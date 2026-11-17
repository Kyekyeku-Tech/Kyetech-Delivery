import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMojoAuthProvider, MojoAuthError } from '../server/mojoAuth.mjs';
import { createAdminOtpService, createAdminOtpMiddleware } from '../server/adminOtp.mjs';
import { createAdminOtpStore, OTP_LIFETIME_MS, OTP_COOLDOWN_MS, OTP_LEASE_MS, OTP_PENDING_MS, OTP_SESSION_MS } from '../server/adminOtpStore.mjs';

function fakeFirestore() {
  const documents = new Map([['admins/admin-one', { enabled: true }], ['users/admin-one', { role: 'merchant', accountStatus: 'active' }]]);
  let queue = Promise.resolve();
  const snapshot = path => ({ exists: documents.has(path), data: () => documents.has(path) ? structuredClone(documents.get(path)) : undefined });
  return {
    documents,
    doc(path) { return { path, async get() { return snapshot(path); } }; },
    runTransaction(action) {
      const pending = queue.then(async () => {
        const writes = [];
        const value = await action({
          async get(ref) { assert.equal(writes.length, 0, 'Firestore transactions require every read before writes.'); return snapshot(ref.path); },
          set(ref, data) { writes.push({ path: ref.path, data }); },
          create(ref, data) { if (documents.has(ref.path)) throw new Error('Fixture duplicate document'); writes.push({ path: ref.path, data }); },
          update(ref, data) { if (!documents.has(ref.path)) throw new Error('Fixture missing document'); writes.push({ path: ref.path, data: { ...documents.get(ref.path), ...data } }); },
        });
        for (const write of writes) documents.set(write.path, structuredClone(write.data));
        return value;
      });
      queue = pending.catch(() => {}); return pending;
    },
  };
}

function fixture(patch = {}) {
  const db = fakeFirestore(), store = createAdminOtpStore({ firestore: db });
  let timestamp = Date.parse('2026-11-15T12:00:00Z'), sequence = 0;
  const sent = [], verifications = [], customTokens = [], identities = new Map();
  const initial = { uid: 'admin-one', email: 'admin@example.invalid', auth_time: Math.floor(timestamp / 1000), firebase: { sign_in_provider: 'password' } };
  identities.set('original-token', initial);
  const auth = {
    async verifyIdToken(token, revoked) { assert.equal(revoked, true); if (!identities.has(token)) throw new Error('Fixture expired token'); return identities.get(token); },
    async getUser(uid) { return { uid, email: 'admin@example.invalid', disabled: false }; },
    async createCustomToken(uid, claims) { customTokens.push({ uid, claims }); return 'custom-token-' + customTokens.length; },
  };
  const provider = {
    async send(email) { sent.push(email); return { stateId: 'provider-state-' + sent.length }; },
    async verify(stateId, code) { verifications.push({ stateId, code }); return code === '123456' ? { authenticated: true, email: 'admin@example.invalid' } : { authenticated: false }; },
  };
  const options = { auth, store, provider, now: () => timestamp, randomId: () => (++sequence).toString(16).padStart(64, '0'), ...patch };
  const service = createAdminOtpService(options);
  return { db, store, auth, provider, options, service, initial, identities, sent, verifications, customTokens, now: () => timestamp, advance: ms => { timestamp += ms; }, exchange(sessionId, token = 'exchanged-token') { identities.set(token, { ...initial, auth_time: Math.floor(timestamp / 1000), adminOtpSessionId: sessionId, firebase: { sign_in_provider: 'custom' } }); return token; } };
}

test('MojoAuth uses documented email JSON and uppercase OTP form fields without exposing provider tokens', async () => {
  const calls = [];
  const provider = createMojoAuthProvider({ apiKey: 'private-fixture-key', emailDomainCheck: async () => {}, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => url.endsWith('/verify') ? { authenticated: true, user: { identifier: 'Admin@Example.Invalid' }, oauth: { access_token: 'never-return', refresh_token: 'never-return' } } : { state_id: 'state-one' } };
  } });
  assert.deepEqual(await provider.send('admin@example.invalid'), { stateId: 'state-one' });
  assert.equal(calls[0].url, 'https://api.mojoauth.com/users/emailotp');
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'admin@example.invalid' });
  assert.equal(calls[0].options.headers['x-api-key'], 'private-fixture-key');
  assert.deepEqual(await provider.verify('state-one', '123456'), { authenticated: true, email: 'admin@example.invalid' });
  assert.equal(calls[1].url, 'https://api.mojoauth.com/users/emailotp/verify');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[1].options.body)), { OTP: '123456', state_id: 'state-one' });
  assert.ok(calls[1].options.signal instanceof AbortSignal);
});

test('MojoAuth failures and uncertain/malformed responses cannot authenticate or reveal request credentials', async () => {
  for (const reply of [{ ok: false, status: 401, data: { message: 'private-fixture-key' } }, { ok: true, status: 200, data: { authenticated: true, oauth: { access_token: 'secret-provider-token' } } }, { ok: true, status: 200, data: { status: 'success' } }]) {
    const provider = createMojoAuthProvider({ apiKey: 'private-fixture-key', fetchImpl: async () => ({ ...reply, json: async () => reply.data }) });
    await assert.rejects(provider.verify('state-one', '123456'), error => error instanceof MojoAuthError && !/private-fixture-key|secret-provider-token|123456/.test(error.message));
  }
  const invalid = createMojoAuthProvider({ apiKey: 'fixture', fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ message: 'Bad OTP' }) }) });
  assert.deepEqual(await invalid.verify('state-one', '000000'), { authenticated: false });
  const offline = createMojoAuthProvider({ apiKey: 'fixture', fetchImpl: async () => { throw new Error('private-fixture-key 123456'); } });
  await assert.rejects(offline.send('admin@example.invalid'), MojoAuthError);
});

test('Distributed send reservation derives admin email and enforces cooldown across concurrent processes', async () => {
  const f = fixture(), second = createAdminOtpService(f.options);
  const results = await Promise.allSettled([f.service({ token: 'original-token', action: 'send' }), second({ token: 'original-token', action: 'send' }), f.service({ token: 'original-token', action: 'send' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.deepEqual(f.sent, ['admin@example.invalid']);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 429).length, 2);
  const sent = results.find(result => result.status === 'fulfilled').value;
  assert.equal(sent.expiresAt, f.now() + OTP_LIFETIME_MS);
  assert.equal(sent.cooldownUntil, f.now() + OTP_COOLDOWN_MS);
  assert.equal(sent.maskedEmail, 'ad***@example.invalid');
  assert.doesNotMatch(JSON.stringify([...f.db.documents]), /original-token|123456|private-fixture-key/);
});

test('Removed/suspended admins, disabled accounts and mismatched Firebase identity cannot request or verify codes', async () => {
  for (const alter of [f => f.db.documents.set('admins/admin-one', { enabled: false }), f => f.db.documents.set('users/admin-one', { accountStatus: 'suspended' }), f => f.db.documents.delete('users/admin-one'), f => { f.auth.getUser = async uid => ({ uid, email: 'other@example.invalid' }); }, f => { f.auth.getUser = async uid => ({ uid, email: 'admin@example.invalid', disabled: true }); }]) {
    const f = fixture(); alter(f);
    await assert.rejects(f.service({ token: 'original-token', action: 'send' }), error => [401, 403].includes(error.status));
    assert.equal(f.sent.length, 0);
  }
  const f = fixture(), sent = await f.service({ token: 'original-token', action: 'send' });
  f.db.documents.set('admins/admin-one', { enabled: false });
  await assert.rejects(f.service({ token: 'original-token', action: 'verify', challengeId: sent.challengeId, code: '123456' }), error => error.status === 403);
  assert.equal(f.verifications.length, 0);
});

test('Challenge verification binds exact original token, UID, email, login time and latest challenge', async () => {
  const f = fixture(), sent = await f.service({ token: 'original-token', action: 'send' });
  f.identities.set('refreshed-token', { ...f.initial });
  await assert.rejects(f.service({ token: 'refreshed-token', action: 'verify', challengeId: sent.challengeId, code: '123456' }), error => error.status === 403);
  f.identities.set('different-login', { ...f.initial, auth_time: f.initial.auth_time + 1 });
  await assert.rejects(f.service({ token: 'different-login', action: 'verify', challengeId: sent.challengeId, code: '123456' }), error => error.status === 403);
  f.advance(OTP_COOLDOWN_MS);
  await f.service({ token: 'original-token', action: 'send' });
  await assert.rejects(f.service({ token: 'original-token', action: 'verify', challengeId: sent.challengeId, code: '123456' }), error => error.status === 403);
  assert.equal(f.verifications.length, 0);
});

test('Wrong codes are limited to five atomic attempts and expired challenges cannot reach MojoAuth', async () => {
  const f = fixture(), sent = await f.service({ token: 'original-token', action: 'send' });
  for (let index = 0; index < 5; index++) await assert.rejects(f.service({ token: 'original-token', action: 'verify', challengeId: sent.challengeId, code: '000000' }), error => error.status === 400);
  await assert.rejects(f.service({ token: 'original-token', action: 'verify', challengeId: sent.challengeId, code: '123456' }), error => error.status === 429);
  assert.equal(f.verifications.length, 5); assert.equal(f.customTokens.length, 0);
  const expired = fixture(), old = await expired.service({ token: 'original-token', action: 'send' });
  expired.advance(OTP_LIFETIME_MS);
  await assert.rejects(expired.service({ token: 'original-token', action: 'verify', challengeId: old.challengeId, code: '123456' }), error => error.status === 410);
  assert.equal(expired.verifications.length, 0);
});

test('Concurrent correct verification creates one pending grant and emits one session-specific custom token', async () => {
  const f = fixture(), sent = await f.service({ token: 'original-token', action: 'send' }), second = createAdminOtpService(f.options);
  const request = { token: 'original-token', action: 'verify', challengeId: sent.challengeId, code: '123456' };
  const results = await Promise.allSettled([f.service(request), second(request), f.service(request)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.verifications.length, 1); assert.equal(f.customTokens.length, 1);
  const verified = results.find(result => result.status === 'fulfilled').value;
  assert.deepEqual(f.customTokens[0], { uid: 'admin-one', claims: { adminOtpSessionId: verified.sessionId } });
  const grant = f.db.documents.get('adminOtpSessions/' + verified.sessionId);
  assert.equal(grant.status, 'pending'); assert.equal(grant.authTime, 0);
  assert.equal(grant.pendingUntil.getTime(), f.now() + OTP_PENDING_MS);
  await assert.rejects(f.service(request), error => error.status === 409);
  assert.equal(f.customTokens.length, 1);
});

test('Provider identity mismatch or uncertain verification consumes the attempt without granting admin access', async () => {
  for (const verify of [async () => ({ authenticated: true, email: 'another@example.invalid' }), async () => { throw new Error('private-provider-state 123456'); }]) {
    const f = fixture(); f.provider.verify = verify;
    const sent = await f.service({ token: 'original-token', action: 'send' });
    await assert.rejects(f.service({ token: 'original-token', action: 'verify', challengeId: sent.challengeId, code: '123456' }), error => [403, 503].includes(error.status) && !/123456|private-provider-state/.test(error.message));
    assert.equal(f.customTokens.length, 0);
    assert.equal(f.db.documents.get('adminOtpChallenges/' + sent.challengeId).status, 'failed');
  }
});

test('Custom token signing failure cannot replay verification or leave an authorizable grant', async () => {
  const f = fixture(); f.auth.createCustomToken = async () => { throw new Error('private-service-account'); };
  const sent = await f.service({ token: 'original-token', action: 'send' }), request = { token: 'original-token', action: 'verify', challengeId: sent.challengeId, code: '123456' };
  await assert.rejects(f.service(request), error => error.status === 503 && !error.message.includes('private-service-account'));
  assert.equal([...f.db.documents].find(([path]) => path.startsWith('adminOtpSessions/'))[1].status, 'revoked');
  await assert.rejects(f.service(request), error => error.status === 409);
  assert.equal(f.verifications.length, 1);
});

test('Uncertain email sends retain cooldown and cannot generate immediate duplicate emails', async () => {
  const f = fixture(); let calls = 0;
  f.provider.send = async () => { calls++; throw new Error('private-api-key provider-network-timeout'); };
  await assert.rejects(f.service({ token: 'original-token', action: 'send' }), error => error.status === 503 && !error.message.includes('private-api-key'));
  await assert.rejects(createAdminOtpService(f.options)({ token: 'original-token', action: 'send' }), error => error.status === 429);
  assert.equal(calls, 1);
  assert.equal([...f.db.documents].find(([path]) => path.startsWith('adminOtpChallenges/'))[1].status, 'failed');
});

test('Undeliverable administrator email domains report the mailbox problem without granting access', async () => {
  const f = fixture();
  f.provider.send = async () => { throw new MojoAuthError('email-domain'); };
  await assert.rejects(f.service({ token: 'original-token', action: 'send' }), error => error.status === 422 && /email domain cannot receive mail/.test(error.message));
  assert.equal(f.customTokens.length, 0);
  assert.equal([...f.db.documents].find(([path]) => path.startsWith('adminOtpChallenges/'))[1].status, 'failed');
});

test('Expired MojoAuth sessions require a new code instead of reporting an incorrect code', async () => {
  const provider = createMojoAuthProvider({ apiKey: 'fixture', fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ code: '914', message: 'Invalid Session State' }) }) });
  await assert.rejects(provider.verify('expired-state', '123456'), error => error instanceof MojoAuthError && error.reason === 'session');
  const f = fixture();
  f.provider.verify = provider.verify;
  const sent = await f.service({ token: 'original-token', action: 'send' });
  await assert.rejects(f.service({ token: 'original-token', action: 'verify', challengeId: sent.challengeId, code: '123456' }), error => error.status === 410 && /expired or been replaced/.test(error.message));
  assert.equal(f.customTokens.length, 0);
  assert.equal(f.db.documents.get('adminOtpChallenges/' + sent.challengeId).status, 'failed');
});

test('Expired verification leases and admin revocation during provider verification cannot mint a token', async () => {
  for (const change of [f => f.advance(OTP_LEASE_MS), f => f.db.documents.set('admins/admin-one', { enabled: false })]) {
    const f = fixture(); let calls = 0;
    f.provider.verify = async () => { calls++; change(f); return { authenticated: true, email: 'admin@example.invalid' }; };
    const sent = await f.service({ token: 'original-token', action: 'send' });
    const request = { token: 'original-token', action: 'verify', challengeId: sent.challengeId, code: '123456' };
    await assert.rejects(f.service(request), error => [403, 409].includes(error.status));
    assert.equal(f.customTokens.length, 0);
    assert.equal([...f.db.documents].filter(([path]) => path.startsWith('adminOtpSessions/')).length, 0);
    await assert.rejects(f.service(request), error => [403, 409].includes(error.status));
    assert.equal(calls, 1, 'A timed-out verification lease cannot be taken over to replay a used OTP.');
  }
});

async function pending(f) {
  const sent = await f.service({ token: 'original-token', action: 'send' });
  return f.service({ token: 'original-token', action: 'verify', challengeId: sent.challengeId, code: '123456' });
}

test('Grant activation requires exchanged custom-provider token and binds eight-hour access to its exact login time', async () => {
  const f = fixture(), verified = await pending(f);
  await assert.rejects(f.service({ token: 'original-token', action: 'activate' }), error => error.status === 403);
  f.advance(2000); const token = f.exchange(verified.sessionId);
  const active = await f.service({ token, action: 'activate' });
  assert.deepEqual(active, { status: 'active', sessionId: verified.sessionId, expiresAt: f.now() + OTP_SESSION_MS });
  assert.equal(f.db.documents.get('adminOtpSessions/' + verified.sessionId).authTime, Math.floor(f.now() / 1000));
  assert.deepEqual(await f.service({ token, action: 'activate' }), active, 'Retrying activation for the same signed login is idempotent.');
  f.advance(2000); f.exchange(verified.sessionId, 'replayed-custom-token');
  await assert.rejects(f.service({ token: 'replayed-custom-token', action: 'activate' }), error => error.status === 403);
  await assert.rejects(f.service({ token: 'replayed-custom-token', action: 'revoke' }), error => error.status === 403);
  assert.deepEqual(await f.service({ token, action: 'revoke' }), { status: 'revoked' });
  assert.equal(f.db.documents.get('adminOtpSessions/' + verified.sessionId).status, 'revoked');
  await assert.rejects(f.service({ token, action: 'activate' }), error => error.status === 410);
});

test('Pending grants expire after two minutes and admin removal prevents activation', async () => {
  const expired = fixture(), result = await pending(expired);
  expired.advance(OTP_PENDING_MS); const token = expired.exchange(result.sessionId);
  await assert.rejects(expired.service({ token, action: 'activate' }), error => error.status === 410);
  const removed = fixture(), verified = await pending(removed), exchanged = removed.exchange(verified.sessionId);
  removed.db.documents.set('users/admin-one', { accountStatus: 'suspended' });
  await assert.rejects(removed.service({ token: exchanged, action: 'activate' }), error => error.status === 403);
});

test('Active grant expiry is enforced and logout revocation works without a MojoAuth API credential', async () => {
  const f = fixture(), verified = await pending(f), token = f.exchange(verified.sessionId);
  await f.service({ token, action: 'activate' });
  f.advance(OTP_SESSION_MS);
  await assert.rejects(f.service({ token, action: 'activate' }), error => error.status === 403);
  const logoutOnly = createAdminOtpService({ ...f.options, provider: undefined, apiKey: '' });
  assert.deepEqual(await logoutOnly({ token, action: 'revoke' }), { status: 'revoked' });
});

test('HTTP route accepts parsed Vercel and streamed bodies but rejects recipient injection, unknown fields and cross-origin requests', async () => {
  const f = fixture(), middleware = createAdminOtpMiddleware(f.options), server = createServer(middleware);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const body of [{ action: 'send', email: 'victim@example.invalid' }, { action: 'send', code: '123456' }, { action: 'send', challengeId: 'a'.repeat(64) }, { action: 'unknown' }]) {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer original-token' }, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
    }
    const unauthorized = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer original-token', Origin: 'https://evil.example.invalid' }, body: '{"action":"send"}' });
    assert.equal(unauthorized.status, 403); assert.equal(f.sent.length, 0);
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer original-token' }, body: '{"action":"send"}' });
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'sent');
    const second = fixture(), headers = {}, parsed = {};
    await createAdminOtpMiddleware(second.options)({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer original-token' }, body: { action: 'send' } }, { setHeader(name, value) { headers[name] = value; }, set statusCode(value) { parsed.code = value; }, end(value) { parsed.body = JSON.parse(value); } });
    assert.equal(parsed.code, 200); assert.equal(parsed.body.status, 'sent'); assert.equal(headers['Cache-Control'], 'no-store');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
