export const OTP_LIFETIME_MS = 10 * 60 * 1000;
export const OTP_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LEASE_MS = 30 * 1000;
export const OTP_PENDING_MS = 2 * 60 * 1000;
export const OTP_SESSION_MS = 8 * 60 * 60 * 1000;

export class AdminOtpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function milliseconds(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  return typeof value === 'number' ? value : 0;
}

function availableAccess(admin, profile) {
  return admin?.enabled === true && Boolean(profile) && (profile.accountStatus || 'active') === 'active';
}

export function createAdminOtpStore({ firestore }) {
  const ref = (collection, id) => firestore.doc(`${collection}/${id}`);
  async function accessIn(transaction, uid) {
    const [admin, profile] = await Promise.all([transaction.get(ref('admins', uid)), transaction.get(ref('users', uid))]);
    if (!availableAccess(admin.data(), profile.data())) throw new AdminOtpError(403, 'Administrator access is unavailable for this account.');
  }
  return {
    async checkAccess(uid) {
      const [admin, profile] = await Promise.all([ref('admins', uid).get(), ref('users', uid).get()]);
      if (!availableAccess(admin.data(), profile.data())) throw new AdminOtpError(403, 'Administrator access is unavailable for this account.');
    },
    async reserveChallenge(challenge, now) {
      await firestore.runTransaction(async transaction => {
        await accessIn(transaction, challenge.uid);
        const cooldownRef = ref('adminOtpCooldowns', challenge.uid), cooldown = await transaction.get(cooldownRef);
        if (milliseconds(cooldown.data()?.nextSendAt) > now) throw new AdminOtpError(429, 'Wait a minute before requesting another code.');
        transaction.set(cooldownRef, { uid: challenge.uid, challengeId: challenge.id, nextSendAt: new Date(now + OTP_COOLDOWN_MS), updatedAt: new Date(now) });
        transaction.create(ref('adminOtpChallenges', challenge.id), {
          ...challenge, status: 'sending', attempts: 0, stateId: '', leaseId: '', leaseUntil: new Date(0),
          createdAt: new Date(now), expiresAt: new Date(now + OTP_LIFETIME_MS), updatedAt: new Date(now),
        });
      });
    },
    async finishSend(challengeId, stateId, now) {
      await firestore.runTransaction(async transaction => {
        const challengeRef = ref('adminOtpChallenges', challengeId), challenge = await transaction.get(challengeRef);
        if (challenge.data()?.status !== 'sending') throw new AdminOtpError(409, 'Request a new verification code.');
        transaction.update(challengeRef, { stateId, status: 'pending', updatedAt: new Date(now) });
      });
    },
    async failSend(challengeId, now) {
      await firestore.runTransaction(async transaction => {
        const challengeRef = ref('adminOtpChallenges', challengeId), challenge = await transaction.get(challengeRef);
        if (challenge.data()?.status === 'sending') transaction.update(challengeRef, { status: 'failed', updatedAt: new Date(now) });
      });
    },
    async claimVerification({ challengeId, uid, email, tokenHash, authTime, leaseId, now }) {
      return firestore.runTransaction(async transaction => {
        await accessIn(transaction, uid);
        const challengeRef = ref('adminOtpChallenges', challengeId);
        const [snapshot, cooldown] = await Promise.all([transaction.get(challengeRef), transaction.get(ref('adminOtpCooldowns', uid))]);
        const challenge = snapshot.data();
        if (!challenge || challenge.uid !== uid || challenge.email !== email || challenge.tokenHash !== tokenHash || challenge.authTime !== authTime || cooldown.data()?.challengeId !== challengeId) throw new AdminOtpError(403, 'This code does not belong to your current sign-in. Request a new code.');
        if (milliseconds(challenge.expiresAt) <= now) throw new AdminOtpError(410, 'This verification code has expired. Request a new code.');
        if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw new AdminOtpError(429, 'Too many incorrect codes. Request a new code.');
        if (challenge.status !== 'pending' || !challenge.stateId) throw new AdminOtpError(409, 'This code is already being verified or has been used. Request a new code if needed.');
        transaction.update(challengeRef, { status: 'verifying', attempts: challenge.attempts + 1, leaseId, leaseUntil: new Date(now + OTP_LEASE_MS), updatedAt: new Date(now) });
        return { ...challenge, id: challengeId };
      });
    },
    async failVerification(challengeId, leaseId, terminal, now) {
      await firestore.runTransaction(async transaction => {
        const challengeRef = ref('adminOtpChallenges', challengeId), snapshot = await transaction.get(challengeRef), challenge = snapshot.data();
        if (challenge?.status === 'verifying' && challenge.leaseId === leaseId) transaction.update(challengeRef, { status: terminal || challenge.attempts >= OTP_MAX_ATTEMPTS ? 'failed' : 'pending', leaseId: '', updatedAt: new Date(now) });
      });
    },
    async consumeAndCreateGrant(challengeId, leaseId, sessionId, now) {
      await firestore.runTransaction(async transaction => {
        const challengeRef = ref('adminOtpChallenges', challengeId), snapshot = await transaction.get(challengeRef), challenge = snapshot.data();
        if (!challenge || challenge.status !== 'verifying' || challenge.leaseId !== leaseId || milliseconds(challenge.leaseUntil) <= now || milliseconds(challenge.expiresAt) <= now) throw new AdminOtpError(409, 'Verification could not be completed. Request a new code.');
        await accessIn(transaction, challenge.uid);
        const cooldown = await transaction.get(ref('adminOtpCooldowns', challenge.uid));
        if (cooldown.data()?.challengeId !== challengeId) throw new AdminOtpError(409, 'A newer code was requested. Use that code instead.');
        transaction.update(challengeRef, { status: 'consumed', leaseId: '', updatedAt: new Date(now) });
        transaction.create(ref('adminOtpSessions', sessionId), {
          uid: challenge.uid, status: 'pending', authTime: 0, originalAuthTime: challenge.authTime,
          createdAt: new Date(now), pendingUntil: new Date(now + OTP_PENDING_MS), expiresAt: new Date(now + OTP_PENDING_MS), activatedAt: null, revokedAt: null,
        });
      });
    },
    async activate({ sessionId, uid, authTime, now }) {
      return firestore.runTransaction(async transaction => {
        await accessIn(transaction, uid);
        const sessionRef = ref('adminOtpSessions', sessionId), snapshot = await transaction.get(sessionRef), session = snapshot.data();
        if (!session || session.uid !== uid) throw new AdminOtpError(403, 'This administrator session does not belong to your account.');
        if (session.status === 'active') {
          if (session.authTime !== authTime || milliseconds(session.expiresAt) <= now) throw new AdminOtpError(403, 'This administrator session cannot be reused for another sign-in.');
          return { sessionId, expiresAt: milliseconds(session.expiresAt) };
        }
        if (session.status !== 'pending' || milliseconds(session.pendingUntil) <= now || authTime * 1000 < milliseconds(session.createdAt) - 1000 || authTime * 1000 > now + 60000) throw new AdminOtpError(410, 'This administrator verification has expired. Sign in again.');
        const expiresAt = now + OTP_SESSION_MS;
        transaction.update(sessionRef, { status: 'active', authTime, activatedAt: new Date(now), expiresAt: new Date(expiresAt) });
        return { sessionId, expiresAt };
      });
    },
    async revoke(sessionId, uid, authTime, now, pending = false) {
      await firestore.runTransaction(async transaction => {
        const sessionRef = ref('adminOtpSessions', sessionId), snapshot = await transaction.get(sessionRef), session = snapshot.data();
        if (!session || session.uid !== uid || (!pending && session.authTime !== authTime) || (pending && session.status !== 'pending')) throw new AdminOtpError(403, 'This administrator session does not belong to your sign-in.');
        if (session.status !== 'revoked') transaction.update(sessionRef, { status: 'revoked', revokedAt: new Date(now), expiresAt: new Date(now) });
      });
    },
  };
}
