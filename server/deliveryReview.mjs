import { randomBytes } from 'node:crypto';

const documentId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const displayName = (value, fallback) => typeof value === 'string' && value.trim() && value.trim().length <= 100 ? value.trim() : fallback;
export const RECIPIENT_REVIEW_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function createDeliveryReviewInvite({ orderId, order, merchantName, now = Date.now(), token = randomBytes(24).toString('hex') }) {
  if (!documentId(orderId) || order?.creatorRole !== 'merchant' || order.status !== 'delivered' || !documentId(order.creatorId) || !documentId(order.riderId)) throw new Error('A completed merchant delivery is required for recipient feedback.');
  if (!/^[a-f0-9]{48}$/.test(token) || !Number.isFinite(now)) throw new Error('A valid recipient review invitation is required.');
  return {
    token, orderId, merchantId: order.creatorId, riderId: order.riderId,
    merchantName: displayName(merchantName, 'Your merchant store'), riderName: displayName(order.riderName, 'Your rider'),
    expiresAt: new Date(now + RECIPIENT_REVIEW_LIFETIME_MS).toISOString(), usedAt: null,
  };
}
