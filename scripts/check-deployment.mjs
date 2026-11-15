import { pathToFileURL } from 'node:url';

// These probes stop before authentication or delivery; they send no emails or SMS.
const probes = [
  { path: '/api/admin-otp', method: 'GET', status: 405 },
  { path: '/api/admin-otp', method: 'POST', status: 401, body: { action: 'send' } },
  { path: '/api/gps-address?latitude=4.9&longitude=-1.7', method: 'GET', status: 401 },
  { path: '/api/delivery-sms', method: 'GET', status: 405 },
];

export async function checkDeployment(origin, fetchImpl = fetch) {
  const site = new URL(origin);
  if (site.username || site.password || !['http:', 'https:'].includes(site.protocol)) throw new Error('Provide an HTTP or HTTPS website address without credentials.');
  const results = [];
  for (const probe of probes) {
    const label = `${probe.method} ${probe.path}`;
    try {
      const response = await fetchImpl(new URL(probe.path, site.origin), {
        method: probe.method, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(60000),
        ...(probe.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(probe.body) } : {}),
      });
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
      const passed = response.status === probe.status && typeof data?.message === 'string';
      const vercelError = response.headers.get('x-vercel-error');
      const reference = response.headers.get('x-vercel-id');
      const reason = passed ? `HTTP ${response.status}, JSON` :
        `HTTP ${response.status}, expected ${probe.status} with a JSON message${vercelError ? `; Vercel: ${vercelError}` : ''}${reference ? `; log reference: ${reference}` : ''}`;
      results.push({ label, passed, reason });
    } catch {
      results.push({ label, passed: false, reason: 'The endpoint could not be reached or timed out.' });
    }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const results = await checkDeployment(process.argv[2] || 'https://kyetechdelivery.site');
    for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.label}: ${result.reason}`);
    if (results.some(result => !result.passed)) {
      console.error('Check Vercel runtime logs, the Node 24 setting, and the deployed API files. Redeploy after changing configuration.');
      process.exitCode = 1;
    } else console.log('API startup checks passed. Verify administrator email delivery separately after setting the server credentials.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
