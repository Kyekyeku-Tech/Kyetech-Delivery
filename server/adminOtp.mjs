import { createHash, randomBytes } from 'node:crypto';
import { createFirebaseAdminRuntime } from './firebaseAdmin.mjs';
import { createMojoAuthProvider, MojoAuthError } from './mojoAuth.mjs';
import { AdminOtpError, createAdminOtpStore, OTP_COOLDOWN_MS, OTP_LIFETIME_MS } from './adminOtpStore.mjs';

export { AdminOtpError } from './adminOtpStore.mjs';

export function createAdminOtpRuntime({ projectId, serviceAccountJson }) {
  if (typeof projectId !== 'string' || !projectId.trim()) throw new AdminOtpError(503, 'Administrator email verification is not configured.');
  try {
    const { auth, firestore } = createFirebaseAdminRuntime({ projectId, serviceAccountJson, name: `kyetech-admin-otp-${projectId}` });
    return { auth, store: createAdminOtpStore({ firestore }) };
  } catch { throw new AdminOtpError(503, 'Administrator email verification requires Firebase server credentials.'); }
}

const hexId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const normalizedEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const hashToken = token => createHash('sha256').update(token).digest('hex');
const maskEmail = email => { const [name, domain] = email.split('@'); return name.slice(0, 2) + '***@' + domain; };

export function createAdminOtpService({ projectId, apiKey, serviceAccountJson, auth, store, provider, now = Date.now, randomId = () => randomBytes(32).toString('hex'), runtimeFactory = createAdminOtpRuntime }) {
  let runtime;
  const emails = provider || createMojoAuthProvider({ apiKey });
  function dependencies() {
    if (auth && store) return { auth, store };
    return runtime ||= runtimeFactory({ projectId, serviceAccountJson });
  }
  return async ({ token, action, challengeId, code }) => {
    if (!token || typeof token !== 'string' || token.length > 16384) throw new AdminOtpError(401, 'Sign in again to verify administrator access.');
    if (!['send', 'verify', 'activate', 'revoke'].includes(action)) throw new AdminOtpError(400, 'Choose a valid administrator verification action.');
    if (action === 'verify' && (!hexId(challengeId) || typeof code !== 'string' || !/^\d{4,10}$/.test(code))) throw new AdminOtpError(400, 'Enter the code from your verification email.');
    if (['send', 'verify'].includes(action) && !provider && !apiKey?.trim()) throw new AdminOtpError(503, 'Administrator email verification is not configured.');
    const deps = dependencies();
    let identity, user;
    try { identity = await deps.auth.verifyIdToken(token, true); user = await deps.auth.getUser(identity.uid); }
    catch { throw new AdminOtpError(401, 'Your sign-in has expired. Sign in again.'); }
    const uid = identity.uid, email = normalizedEmail(user.email), tokenEmail = normalizedEmail(identity.email), authTime = identity.auth_time;
    if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid) || user.uid !== uid || user.disabled || !validEmail(email) || email !== tokenEmail || !Number.isInteger(authTime) || authTime <= 0) throw new AdminOtpError(401, 'Sign in again with your administrator email account.');
    const timestamp = now();
    if (action === 'activate' || action === 'revoke') {
      const sessionId = identity.adminOtpSessionId;
      if (!hexId(sessionId) || identity.firebase?.sign_in_provider !== 'custom') throw new AdminOtpError(403, 'Verify your administrator email before opening this workspace.');
      if (action === 'revoke') { await deps.store.revoke(sessionId, uid, authTime, timestamp); return { status: 'revoked' }; }
      await deps.store.checkAccess(uid);
      return { status: 'active', ...await deps.store.activate({ sessionId, uid, authTime, now: timestamp }) };
    }
    await deps.store.checkAccess(uid);
    if (action === 'send') {
      const id = randomId();
      const challenge = { id, uid, email, authTime, tokenHash: hashToken(token) };
      await deps.store.reserveChallenge(challenge, timestamp);
      try { const sent = await emails.send(email); await deps.store.finishSend(id, sent.stateId, now()); }
      catch (error) {
        await deps.store.failSend(id, now()).catch(() => {});
        if (error instanceof MojoAuthError && error.reason === 'email-domain') throw new AdminOtpError(422, 'Your administrator email domain cannot receive mail. Contact support to update the email address or restore its mail service.');
        throw new AdminOtpError(503, 'The verification email could not be sent. Wait a minute and request a new code.');
      }
      return { status: 'sent', challengeId: id, expiresAt: timestamp + OTP_LIFETIME_MS, cooldownUntil: timestamp + OTP_COOLDOWN_MS, maskedEmail: maskEmail(email) };
    }
    const leaseId = randomId();
    const challenge = await deps.store.claimVerification({ challengeId, uid, email, authTime, tokenHash: hashToken(token), leaseId, now: timestamp });
    let verified;
    try { verified = await emails.verify(challenge.stateId, code); }
    catch (error) {
      await deps.store.failVerification(challengeId, leaseId, true, now()).catch(() => {});
      if (error instanceof MojoAuthError && error.reason === 'session') throw new AdminOtpError(410, 'This verification code has expired or been replaced. Request a new code.');
      throw new AdminOtpError(503, 'Code verification could not be completed. Request a new code.');
    }
    if (verified.authenticated !== true || normalizedEmail(verified.email) !== challenge.email) {
      const mismatch = verified.authenticated === true;
      await deps.store.failVerification(challengeId, leaseId, mismatch, now());
      throw new AdminOtpError(mismatch ? 403 : 400, mismatch ? 'This verification belongs to another email account.' : 'That code is incorrect. Check your email and try again.');
    }
    const sessionId = randomId();
    await deps.store.consumeAndCreateGrant(challengeId, leaseId, sessionId, now());
    let customToken;
    try { customToken = await deps.auth.createCustomToken(uid, { adminOtpSessionId: sessionId }); }
    catch { await deps.store.revoke(sessionId, uid, 0, now(), true).catch(() => {}); throw new AdminOtpError(503, 'Administrator verification could not be completed. Request a new code.'); }
    return { status: 'verified', customToken, sessionId };
  };
}

export function createAdminOtpMiddleware(options) {
  const verify = createAdminOtpService(options);
  return async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); throw new AdminOtpError(405, 'Use POST for administrator verification.'); }
      if (!request.headers['content-type']?.startsWith('application/json')) throw new AdminOtpError(415, 'Send administrator verification as JSON.');
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) throw new AdminOtpError(403, 'Use this app to verify administrator access.');
      const token = request.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
      if (!token) throw new AdminOtpError(401, 'Sign in to verify administrator access.');
      let body;
      if (request.body !== undefined && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) body = request.body;
      else {
        let raw = typeof request.body === 'string' || Buffer.isBuffer(request.body) ? String(request.body) : '';
        if (request.body === undefined) for await (const chunk of request) { raw += chunk.toString('utf8'); if (Buffer.byteLength(raw) > 4096) throw new AdminOtpError(413, 'The verification request is too large.'); }
        if (Buffer.byteLength(raw) > 4096) throw new AdminOtpError(413, 'The verification request is too large.');
        try { body = JSON.parse(raw); } catch { throw new AdminOtpError(400, 'Send a valid verification request.'); }
      }
      if (!body || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > 4096) throw new AdminOtpError(400, 'Send a valid verification request.');
      const allowed = body.action === 'verify' ? ['action', 'challengeId', 'code'] : ['action'];
      if (Object.keys(body).some(key => !allowed.includes(key))) throw new AdminOtpError(400, 'Send only the verification action and requested code.');
      const result = await verify({ token, action: body.action, challengeId: body.challengeId, code: body.code });
      response.statusCode = 200; response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = error instanceof AdminOtpError ? error.status : 503;
      response.end(JSON.stringify({ status: 'unavailable', message: error instanceof AdminOtpError ? error.message : 'Administrator verification could not be completed. Try again.' }));
    }
  };
}
