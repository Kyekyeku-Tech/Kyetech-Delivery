import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { deleteApp, getApps } from 'firebase-admin/app';
import { JWT } from 'google-auth-library';
import { createFirebaseAdminRuntime } from '../server/firebaseAdmin.mjs';
import { createAdminOtpRuntime } from '../server/adminOtp.mjs';

test('JWT credentials supply Firebase access tokens and locally sign session claims without deprecated methods', async t => {
  const projectId = 'jwt-admin-runtime-fixture', name = 'jwt-admin-runtime-fixture';
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { type: 'service_account', project_id: projectId, client_email: 'fixture@' + projectId + '.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const warnings = t.mock.method(console, 'warn', () => {});
  const tokenRequest = t.mock.method(JWT.prototype, 'getAccessToken', async function () {
    this.credentials.expiry_date = Date.now() + 3600000;
    return { token: 'fixture-access-token' };
  });
  const runtime = createFirebaseAdminRuntime({ projectId, name, serviceAccountJson: JSON.stringify(account) });
  try {
    const credential = getApps().find(app => app.name === name).options.credential;
    const access = await credential.getAccessToken();
    assert.equal(access.access_token, 'fixture-access-token');
    assert.ok(access.expires_in >= 3598 && access.expires_in <= 3600);
    assert.equal(tokenRequest.mock.callCount(), 1);
    const token = await runtime.auth.createCustomToken('administrator-one', { adminOtpSessionId: 'a'.repeat(64) });
    const [header, payload, signature] = token.split('.');
    assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'RS256');
    const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    assert.equal(claims.uid, 'administrator-one');
    assert.equal(claims.iss, account.client_email);
    assert.equal(claims.claims.adminOtpSessionId, 'a'.repeat(64));
    assert.equal(verify('RSA-SHA256', Buffer.from(header + '.' + payload), publicKey, Buffer.from(signature, 'base64url')), true);
    assert.equal(tokenRequest.mock.callCount(), 1, 'Custom tokens must sign locally without requiring IAM signing permissions.');
    assert.equal(runtime.firestore.projectId, projectId);
    assert.equal(warnings.mock.callCount(), 0);
  } finally {
    await runtime.firestore.terminate();
    await Promise.all(getApps().filter(app => app.name === name || app.name === name + '-signing').map(deleteApp));
  }
});

test('Malformed, foreign and external-account credentials cannot initialize the OTP runtime or reveal secrets', () => {
  for (const serviceAccountJson of ['not-json', 'null', JSON.stringify({ type: 'external_account', project_id: 'fixture', client_email: 'private-fixture', private_key: 'private-fixture' }), JSON.stringify({ type: 'service_account', project_id: 'foreign-project', client_email: 'private-fixture', private_key: 'private-fixture' })]) {
    assert.throws(() => createAdminOtpRuntime({ projectId: 'fixture', serviceAccountJson }), error => error.status === 503 && !/private-fixture|not-json/.test(error.message));
  }
});
