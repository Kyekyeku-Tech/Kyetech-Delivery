import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEmailDeliveryDomain, EmailDomainError } from '../server/emailDelivery.mjs';
import { createMojoAuthProvider, MojoAuthError } from '../server/mojoAuth.mjs';

const missing = code => async () => { throw Object.assign(new Error('DNS fixture'), { code }); };
const noAddresses = { resolve4: missing('ENODATA'), resolve6: missing('ENODATA') };

test('Mail delivery accepts MX records and the SMTP address fallback', async () => {
  await checkEmailDeliveryDomain('admin@example.invalid', { ...noAddresses, resolveMx: async () => [{ exchange: 'mail.example.invalid' }] });
  for (const resolveMx of [missing('ENODATA'), async () => []]) {
    await checkEmailDeliveryDomain('admin@example.invalid', { ...noAddresses, resolveMx, resolve6: async () => ['2001:db8::1'] });
  }
});

test('Nonexistent domains, null MX and missing mail addresses fail before MojoAuth sends', async () => {
  for (const dns of [
    { ...noAddresses, resolveMx: missing('ENOTFOUND') },
    { ...noAddresses, resolveMx: async () => [{ exchange: '.', priority: 0 }] },
    { ...noAddresses, resolveMx: missing('ENODATA') },
  ]) {
    let sent = false;
    const provider = createMojoAuthProvider({ apiKey: 'fixture', emailDomainCheck: email => checkEmailDeliveryDomain(email, dns), fetchImpl: async () => { sent = true; } });
    await assert.rejects(provider.send('admin@example.invalid'), error => error instanceof MojoAuthError && error.reason === 'email-domain');
    assert.equal(sent, false);
  }
});

test('Temporary DNS failures remain retryable and cannot report a successful send', async () => {
  for (const dns of [
    { ...noAddresses, resolveMx: missing('ETIMEOUT') },
    { ...noAddresses, resolveMx: missing('ENODATA'), resolve4: missing('ESERVFAIL') },
  ]) {
    await assert.rejects(checkEmailDeliveryDomain('admin@example.invalid', dns), error => error instanceof EmailDomainError && error.reason === 'unavailable');
  }
});
