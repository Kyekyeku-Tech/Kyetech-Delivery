import { timestampMillis } from './domain.js';

export function validReviewToken(value) { return typeof value === 'string' && /^[0-9a-f]{48}$/.test(value); }

function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); }

export function normalizeRecipientReviewInvite(input) {
  if (!input || !['orderId', 'merchantId', 'riderId'].every(key => validId(input[key])) ||
    !['merchantName', 'riderName'].every(key => typeof input[key] === 'string' && input[key].trim() && input[key].length <= 100)) return null;
  const createdAt = timestampMillis(input.createdAt), expiresAt = timestampMillis(input.expiresAt);
  const usedAt = input.usedAt === null ? null : timestampMillis(input.usedAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0 || !Number.isFinite(expiresAt) || expiresAt <= createdAt ||
    (usedAt !== null && (!Number.isFinite(usedAt) || usedAt <= 0))) return null;
  return {
    orderId: input.orderId, merchantId: input.merchantId, riderId: input.riderId,
    merchantName: input.merchantName.trim(), riderName: input.riderName.trim(), createdAt, expiresAt, usedAt,
  };
}

export function recipientReviewStatus(invite, now = Date.now()) {
  if (!invite) return 'invalid';
  if (invite.usedAt !== null) return 'used';
  return invite.expiresAt <= now ? 'expired' : 'ready';
}

export function cleanRecipientReview(input = {}) {
  const riderRating = Number(input.riderRating), merchantRating = Number(input.merchantRating);
  if (!Number.isInteger(riderRating) || riderRating < 1 || riderRating > 5) throw new Error('Choose a rating for your rider.');
  if (!Number.isInteger(merchantRating) || merchantRating < 1 || merchantRating > 5) throw new Error('Choose a rating for the store.');
  const comment = String(input.comment || '').trim();
  if (comment.length > 1000) throw new Error('Your review must be 1,000 characters or fewer.');
  return { riderRating, merchantRating, comment };
}

export function recipientReviewReference(orderId) { return 'KYE-' + String(orderId || '').slice(-6).toUpperCase(); }
