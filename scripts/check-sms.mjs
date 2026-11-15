import { loadEnv } from 'vite';
import { MNOTIFY_BASE_URL, SMS_SENDER_ID } from '../server/mnotify.mjs';

const env = loadEnv('development', process.cwd(), '');
const key = env.VITE_MNOTIFY_API_KEY?.trim();
console.log(`mNotify API key: ${key ? 'present (server only)' : 'MISSING'}`);
console.log(`SMS sender: ${SMS_SENDER_ID}`);
if (!key) process.exitCode = 1;
else if (process.argv.includes('--live')) {
  const checks = [
    ['SMS balance', 'balance/sms', undefined],
    ['Sender ID approval', 'senderid/status', { sender_name: SMS_SENDER_ID }],
  ];
  const results = await Promise.allSettled(checks.map(async ([name, path, body]) => {
    const url = new URL(path, MNOTIFY_BASE_URL);
    url.searchParams.set('key', key);
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || result.status !== 'success') {
      console.log(`${name}: failed (HTTP ${response.status}).`);
      process.exitCode = 1;
      return;
    }
    if (name === 'SMS balance') {
      const balance = Number(result.balance), bonus = Number(result.bonus || 0);
      console.log(`SMS balance: ${Number.isFinite(balance) ? balance : 'unknown'}; bonus: ${Number.isFinite(bonus) ? bonus : 'unknown'}.`);
      if (!(balance + bonus > 0)) process.exitCode = 1;
    } else {
      const approved = result.summary?.status?.toLowerCase() === 'approved' && result.summary?.is_otp !== true;
      console.log(`Sender ID ${SMS_SENDER_ID}: ${approved ? 'approved for delivery updates' : 'not approved for delivery updates'}.`);
      if (!approved) process.exitCode = 1;
    }
  }));
  for (const result of results) if (result.status === 'rejected') {
    console.log('mNotify check could not complete.');
    process.exitCode = 1;
  }
  console.log('Read-only checks completed; no SMS messages sent.');
}
