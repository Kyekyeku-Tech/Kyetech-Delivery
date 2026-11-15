import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const requireFromAdmin = createRequire(require.resolve('firebase-admin/auth'));
const jwks = requireFromAdmin('jwks-rsa');

test('Firebase signing-key dependency converts RSA JWKs and verifies signatures with CommonJS ESM loading disabled', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyId = 'firebase-test-key';
  const client = jwks({
    jwksUri: 'https://example.invalid/no-network', cache: false,
    getKeysInterceptor: async () => [{ ...publicKey.export({ format: 'jwk' }), kid: keyId, use: 'sig', alg: 'RS256' }],
    fetcher: async () => { throw new Error('The fixture must not access a remote key service.'); },
  });
  const signingKey = await client.getSigningKey(keyId);
  const payload = Buffer.from('fixture-header.fixture-payload');
  const signature = sign('RSA-SHA256', payload, privateKey);
  assert.equal(verify('RSA-SHA256', payload, signingKey.getPublicKey(), signature), true);
  assert.equal(verify('RSA-SHA256', Buffer.from('tampered-payload'), signingKey.getPublicKey(), signature), false);
  assert.equal(signingKey.kid, keyId);
});
