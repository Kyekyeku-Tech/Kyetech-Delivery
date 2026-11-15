import { timestampMillis } from './domain.js';

export const validAdminOtpSessionId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function adminOtpIdentity(account, result) {
  const claims = result?.claims || {};
  const provider = claims.firebase?.sign_in_provider || result?.signInProvider || '';
  const sessionId = validAdminOtpSessionId(claims.adminOtpSessionId) && provider === 'custom' ? claims.adminOtpSessionId : '';
  const authTime = Number(claims.auth_time);
  return { uid: account.uid, provider, sessionId, authTime, scope: [account.uid, provider, authTime, sessionId].join(':') };
}

export function activeAdminOtpSession(session, identity, now = Date.now()) {
  return Boolean(session && identity.sessionId && session.uid === identity.uid && session.status === 'active' &&
    session.authTime === identity.authTime && timestampMillis(session.expiresAt) > now);
}

export async function requestAdminOtp(token, body, fetcher = fetch) {
  if (!token) throw new Error('Sign in again to verify administrator access.');
  let response;
  try {
    response = await fetcher('/api/admin-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body), cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(60000),
    });
  } catch { throw new Error('Administrator verification could not connect. Check your connection and try again.'); }
  let result;
  try { result = await response.json(); } catch {
    if (response.status >= 500) throw new Error('Administrator verification is temporarily unavailable. Please try again later.');
    throw new Error('Administrator verification is unavailable on this website. Please contact support.');
  }
  if (!response.ok) throw new Error(typeof result?.message === 'string' && result.message.length <= 500 ? result.message : 'Administrator verification failed. Please try again.');
  return result;
}
