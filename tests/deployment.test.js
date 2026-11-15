import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import adminOtp from '../api/admin-otp.js';
import gpsAddress from '../api/gps-address.js';
import deliverySms from '../api/delivery-sms.js';
import riderAlerts from '../api/rider-alerts.js';
import { checkDeployment } from '../scripts/check-deployment.mjs';

test('Production API entrypoints start and return JSON without authentication or sending messages', async () => {
  const routes = { '/api/admin-otp': adminOtp, '/api/gps-address': gpsAddress, '/api/delivery-sms': deliverySms, '/api/rider-alerts': riderAlerts };
  const server = createServer((request, response) => routes[new URL(request.url, 'http://localhost').pathname](request, response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const results = await checkDeployment(`http://127.0.0.1:${server.address().port}`);
    assert.equal(results.length, 6);
    assert.deepEqual(results.filter(result => !result.passed), []);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Deployment checks flag Vercel invocation crashes and include a log reference', async () => {
  const results = await checkDeployment('https://example.invalid', async () => new Response('FUNCTION_INVOCATION_FAILED', {
    status: 500, headers: { 'Content-Type': 'text/plain', 'X-Vercel-Error': 'FUNCTION_INVOCATION_FAILED', 'X-Vercel-Id': 'fixture-log-reference' },
  }));
  assert.ok(results.every(result => !result.passed && result.reason.includes('FUNCTION_INVOCATION_FAILED') && result.reason.includes('fixture-log-reference')));
});

test('Deployment checks reject HTML fallbacks and redirects instead of reporting a healthy API', async () => {
  for (const status of [200, 307, 404]) {
    const results = await checkDeployment('https://example.invalid', async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers?.Authorization, undefined);
      return new Response('<html>Website or login page</html>', { status, headers: { 'Content-Type': 'text/html' } });
    });
    assert.ok(results.every(result => !result.passed));
  }
});
