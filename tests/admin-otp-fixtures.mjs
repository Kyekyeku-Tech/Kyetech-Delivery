// Shared local-emulator grant fixture; it never creates a live session.
export const adminOtpSessionId = 'a'.repeat(64);
export const adminOtpAuthTime = Math.floor(Date.now() / 1000);
export const adminOtpClaims = (patch = {}) => ({ auth_time: adminOtpAuthTime, adminOtpSessionId, firebase: { sign_in_provider: 'custom' }, ...patch });
export const adminOtpSession = (patch = {}) => ({ uid: 'admin-one', status: 'active', authTime: adminOtpAuthTime, expiresAt: new Date(Date.now() + 60 * 60 * 1000), ...patch });
