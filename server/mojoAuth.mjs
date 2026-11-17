import { checkEmailDeliveryDomain, EmailDomainError } from './emailDelivery.mjs';

export class MojoAuthError extends Error {
  constructor(reason = 'unavailable') {
    super('The email verification service is temporarily unavailable. Request a new code and try again.');
    this.reason = reason;
  }
}

export function createMojoAuthProvider({ apiKey, fetchImpl = fetch, emailDomainCheck = checkEmailDeliveryDomain }) {
  async function request(path, body, contentType) {
    if (!apiKey?.trim()) throw new MojoAuthError();
    try {
      const response = await fetchImpl(`https://api.mojoauth.com${path}`, {
        method: 'POST', headers: { 'x-api-key': apiKey.trim(), 'Content-Type': contentType },
        body, signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok && path.endsWith('/verify') && [400, 422].includes(response.status)) {
        if (String(data?.code) === '914') throw new MojoAuthError('session');
        return { authenticated: false };
      }
      if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)) throw new MojoAuthError();
      return data;
    } catch (error) { throw error instanceof MojoAuthError ? error : new MojoAuthError(); }
  }
  return {
    async send(email) {
      try { await emailDomainCheck(email); }
      catch (error) { throw new MojoAuthError(error instanceof EmailDomainError ? error.reason : 'unavailable'); }
      const data = await request('/users/emailotp', JSON.stringify({ email }), 'application/json');
      if (typeof data.state_id !== 'string' || !data.state_id.trim() || data.state_id.length > 512) throw new MojoAuthError();
      return { stateId: data.state_id };
    },
    async verify(stateId, code) {
      const data = await request('/users/emailotp/verify', new URLSearchParams({ OTP: code, state_id: stateId }).toString(), 'application/x-www-form-urlencoded');
      if (data.authenticated === false) return { authenticated: false };
      if (data.authenticated !== true) throw new MojoAuthError();
      const email = data.user?.identifier || data.user?.email;
      if (typeof email !== 'string' || !email.trim()) throw new MojoAuthError();
      // Provider tokens and profile metadata never leave this boundary.
      return { authenticated: true, email: email.trim().toLowerCase() };
    },
  };
}
