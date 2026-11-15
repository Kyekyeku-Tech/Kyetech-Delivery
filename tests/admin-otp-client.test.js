import assert from 'node:assert/strict';
import test from 'node:test';
import { activeAdminOtpSession, adminOtpIdentity, requestAdminOtp, validAdminOtpSessionId } from '../src/lib/adminOtp.js';

test('administrator OTP grants require the signed custom-session identity, matching login time and future expiry', () => {
  const sid = 'a'.repeat(64), account = { uid: 'admin-one' }, now = Date.now();
  const claims = { auth_time: 100, adminOtpSessionId: sid, firebase: { sign_in_provider: 'custom' } };
  const identity = adminOtpIdentity(account, { claims });
  const grant = { uid: account.uid, authTime: 100, status: 'active', expiresAt: now + 10000 };
  assert.equal(validAdminOtpSessionId(sid), true);
  assert.equal(activeAdminOtpSession(grant, identity, now), true);
  for (const patch of [{ uid: 'other-admin' }, { authTime: 101 }, { status: 'pending' }, { status: 'revoked' }, { expiresAt: now }]) assert.equal(activeAdminOtpSession({ ...grant, ...patch }, identity, now), false);
  const passwordIdentity = adminOtpIdentity(account, { claims: { ...claims, firebase: { sign_in_provider: 'password' } } });
  assert.equal(passwordIdentity.sessionId, '');
  assert.equal(activeAdminOtpSession(grant, passwordIdentity, now), false);
  assert.equal(validAdminOtpSessionId('../session'), false);
});

test('OTP requests send only the selected action to the same-origin server and preserve the original bearer', async () => {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ status: 'sent' }) }; };
  assert.deepEqual(await requestAdminOtp('fixture-original-token', { action: 'verify', challengeId: 'a'.repeat(64), code: '123456' }, fetcher), { status: 'sent' });
  assert.equal(calls[0].url, '/api/admin-otp');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-original-token');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0].options.body), { action: 'verify', challengeId: 'a'.repeat(64), code: '123456' });
  await assert.rejects(requestAdminOtp('', { action: 'send' }, fetcher), /Sign in again/);
  assert.equal(calls.length, 1);
});

test('OTP transport failures expose useful bounded errors and never return failed responses as grants', async () => {
  await assert.rejects(requestAdminOtp('fixture', { action: 'send' }, async () => { throw new Error('provider secret detail'); }), /could not connect/);
  await assert.rejects(requestAdminOtp('fixture', { action: 'verify' }, async () => ({ ok: false, json: async () => ({ message: 'The code expired. Request a new code.' }) })), /code expired/);
  await assert.rejects(requestAdminOtp('fixture', { action: 'send' }, async () => ({ ok: false, json: async () => ({ message: 'x'.repeat(501) }) })), /verification failed/);
});
