export const SMS_SENDER_ID = 'KYE-TECH';
export const MNOTIFY_BASE_URL = 'https://api.mnotify.com/api/';

export function ghanaSmsNumber(value) {
  const digits = String(value || '').replace(/[\s()+.-]/g, '');
  if (/^0[235]\d{8}$/.test(digits)) return digits;
  if (/^233[235]\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return '';
}

export class SmsSubmissionError extends Error {
  constructor(outcome, code) {
    super(`SMS submission ${outcome} (${code}).`);
    this.outcome = outcome;
    this.code = String(code).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  }
}

export async function sendQuickSms({ apiKey, recipient, message, fetchImpl = fetch }) {
  if (!apiKey?.trim()) throw new SmsSubmissionError('failed', 'missing-api-key');
  const phone = ghanaSmsNumber(recipient);
  if (!phone || typeof message !== 'string' || !message.trim()) throw new SmsSubmissionError('failed', 'invalid-message');
  const url = new URL('sms/quick', MNOTIFY_BASE_URL);
  url.searchParams.set('key', apiKey.trim());
  let response, data;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ recipient: [phone], sender: SMS_SENDER_ID, message, is_schedule: false, schedule_date: '' }),
      signal: AbortSignal.timeout(20000),
    });
    data = await response.json();
  } catch {
    // A timeout or unreadable response can occur after the provider accepted it.
    throw new SmsSubmissionError('unknown', 'provider-response-unknown');
  }
  if (!response.ok || data?.status !== 'success' || String(data.code) !== '2000' || !(Number(data.summary?.total_sent) > 0) || Number(data.summary?.total_rejected || 0) > 0) {
    const outcome = response.status >= 500 ? 'unknown' : 'failed';
    const code = /^[a-zA-Z0-9_-]{1,40}$/.test(String(data?.code || '')) ? data.code : `http-${response.status}`;
    throw new SmsSubmissionError(outcome, code);
  }
  return {
    providerCode: '2000',
    campaignId: typeof data.summary._id === 'string' ? data.summary._id.slice(0, 128) : '',
  };
}
