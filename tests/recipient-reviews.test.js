import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRecipientReview, normalizeRecipientReviewInvite, recipientReviewReference, recipientReviewStatus, validReviewToken } from '../src/lib/recipientReviews.js';

const createdAt = Date.parse('2026-11-14T12:00:00Z'), expiresAt = Date.parse('2026-12-14T12:00:00Z');
const invite = { orderId: 'delivery-aswmlj', merchantId: 'merchant-one', riderId: 'rider-one', merchantName: ' Ada Groceries ', riderName: ' Kofi Rider ', createdAt, expiresAt, usedAt: null };

test('recipient capability tokens accept only the generated 48 lowercase hex format', () => {
  assert.equal(validReviewToken('a'.repeat(48)), true);
  assert.equal(validReviewToken('1234567890abcdef'.repeat(3)), true);
  for (const value of [null, '', 'a'.repeat(47), 'a'.repeat(49), 'A'.repeat(48), 'g'.repeat(48), '../' + 'a'.repeat(48)]) assert.equal(validReviewToken(value), false);
});

test('recipient invite rendering keeps only safe business identity and detects invalid, used and expired links', () => {
  const clean = normalizeRecipientReviewInvite({ ...invite, createdAt: { seconds: createdAt / 1000 }, recipientPhone: '+233241234567', pickup: 'Private address', recipientName: 'Private name' });
  assert.deepEqual(clean, { ...invite, merchantName: 'Ada Groceries', riderName: 'Kofi Rider' });
  assert.equal(clean.recipientPhone, undefined);
  assert.equal(clean.pickup, undefined);
  assert.equal(recipientReviewStatus(clean, expiresAt - 1), 'ready');
  assert.equal(recipientReviewStatus(clean, expiresAt), 'expired');
  assert.equal(recipientReviewStatus({ ...clean, usedAt: createdAt + 1000 }, expiresAt + 1000), 'used');
  assert.equal(recipientReviewReference(clean.orderId), 'KYE-ASWMLJ');
  for (const patch of [{ orderId: 'bad/path' }, { merchantId: '' }, { riderId: null }, { merchantName: ' ' }, { riderName: 'a'.repeat(101) }, { expiresAt: createdAt }, { createdAt: NaN }, { usedAt: undefined }]) assert.equal(normalizeRecipientReviewInvite({ ...invite, ...patch }), null);
});

test('recipient reviews require both valid scores and preserve a trimmed optional combined review', () => {
  assert.deepEqual(cleanRecipientReview({ riderRating: 4, merchantRating: 5, comment: '  Friendly rider.\nFresh items.  ', injected: true }), { riderRating: 4, merchantRating: 5, comment: 'Friendly rider.\nFresh items.' });
  assert.deepEqual(cleanRecipientReview({ riderRating: 1, merchantRating: 1, comment: '  ' }), { riderRating: 1, merchantRating: 1, comment: '' });
  for (const patch of [{ riderRating: 0 }, { merchantRating: 0 }, { riderRating: 6 }, { merchantRating: 2.5 }, { riderRating: NaN }, { comment: 'a'.repeat(1001) }]) assert.throws(() => cleanRecipientReview({ riderRating: 5, merchantRating: 5, comment: '', ...patch }));
});
