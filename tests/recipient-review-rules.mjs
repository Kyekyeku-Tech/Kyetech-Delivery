// Capability review verification uses demo projects on the local emulator only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { adminOtpClaims, adminOtpSession, adminOtpSessionId } from './admin-otp-fixtures.mjs';
const require = createRequire(new URL('../.verification/sms-tools/package.json', import.meta.url));
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc, writeBatch, serverTimestamp } = require('firebase/firestore');
const env = await initializeTestEnvironment({ projectId: 'demo-kyetech-recipient-reviews', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
const tokenFor = index => index.toString(16).padStart(48, '0');
const expiry = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const sms = (id, token, actorId = 'rider-one', patch = {}) => ({ orderId: id, type: 'delivered', actorId, customerId: '', merchantId: 'merchant-one', recipientReviewToken: token, sender: 'KYE-TECH', message: 'Delivery completed. Please share your feedback.', status: 'submitting', errorCode: '', providerCode: '', campaignId: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...patch });
const invite = (id, patch = {}) => ({ orderId: id, merchantId: 'merchant-one', riderId: 'rider-one', merchantName: 'Ada Groceries', riderName: 'Kofi Rider', createdAt: serverTimestamp(), expiresAt: expiry(), usedAt: null, ...patch });
const review = (id, token, patch = {}) => ({ orderId: id, merchantId: 'merchant-one', riderId: 'rider-one', riderRating: 5, merchantRating: 4, comment: 'Friendly rider and neatly packed groceries.', reviewToken: token, createdAt: serverTimestamp(), ...patch });
function issue(db, id, token, invitePatch = {}, smsPatch = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'deliverySms', id + '_delivered'), sms(id, token, 'rider-one', smsPatch));
  batch.set(doc(db, 'deliveryReviewLinks', token), invite(id, invitePatch));
  return batch;
}
function consume(db, id, token, reviewPatch = {}, invitePatch = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'deliveryReviews', id), review(id, token, reviewPatch));
  batch.update(doc(db, 'deliveryReviewLinks', token), { usedAt: serverTimestamp(), ...invitePatch });
  return batch;
}
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const uid of ['merchant-one', 'merchant-two', 'merchant-team', 'revoked-team', 'suspended-merchant']) await setDoc(doc(db, 'users', uid), { role: 'merchant', accountStatus: uid === 'suspended-merchant' ? 'suspended' : 'active' });
    for (const uid of ['rider-one', 'rider-two', 'unapproved-rider', 'suspended-rider']) await setDoc(doc(db, 'users', uid), { role: 'rider', approvalStatus: uid === 'unapproved-rider' ? 'pending' : 'approved', accountStatus: uid === 'suspended-rider' ? 'suspended' : 'active' });
    await setDoc(doc(db, 'users/customer-one'), { role: 'customer', accountStatus: 'active' });
    await setDoc(doc(db, 'users/admin-one'), { role: 'customer', accountStatus: 'active' });
    await setDoc(doc(db, 'admins/admin-one'), { enabled: true });
    await setDoc(doc(db, 'adminOtpSessions', adminOtpSessionId), adminOtpSession());
    await setDoc(doc(db, 'stores/merchant-one'), { ownerId: 'merchant-one', name: 'Ada Groceries', accountStatus: 'active', approvalStatus: 'approved' });
    for (const [uid, enabled, status] of [['merchant-team', true, 'accepted'], ['revoked-team', false, 'revoked']]) {
      const inviteId = 'merchant-one_' + uid;
      await setDoc(doc(db, 'storeInvites', inviteId), { storeId: 'merchant-one', ownerId: 'merchant-one', status });
      await setDoc(doc(db, 'storeMembers', 'merchant-one_' + uid), { storeId: 'merchant-one', userId: uid, inviteId, enabled });
    }
    for (let index = 0; index < 32; index += 1) await setDoc(doc(db, 'orders', 'review-order-' + index), { creatorId: 'merchant-one', creatorRole: 'merchant', merchantId: 'merchant-one', riderId: 'rider-one', riderName: 'Kofi Rider', status: 'delivered' });
    await setDoc(doc(db, 'orders/customer-order'), { creatorId: 'customer-one', creatorRole: 'customer', merchantId: '', riderId: 'rider-one', status: 'delivered' });
    await setDoc(doc(db, 'orders/pickup-order'), { creatorId: 'merchant-one', creatorRole: 'merchant', merchantId: 'merchant-one', riderId: 'rider-one', status: 'picked_up' });
  });
  const rider = env.authenticatedContext('rider-one').firestore(), merchant = env.authenticatedContext('merchant-one').firestore();
  const team = env.authenticatedContext('merchant-team').firestore(), admin = env.authenticatedContext('admin-one', adminOtpClaims()).firestore();
  const guest = env.unauthenticatedContext().firestore();
  const token = tokenFor(1), id = 'review-order-0';
  await assertFails(setDoc(doc(rider, 'deliveryReviewLinks', token), invite(id)));
  await assertFails(setDoc(doc(rider, 'deliverySms', id + '_delivered'), sms(id, token)));
  await assertSucceeds(issue(rider, id, token).commit());
  await assertFails(updateDoc(doc(rider, 'deliverySms', id + '_delivered'), { recipientReviewToken: tokenFor(2), status: 'submitted', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(rider, 'deliverySms', id + '_delivered'), { status: 'submitted', updatedAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(merchant, 'deliverySms', id + '_delivered')));
  await assertSucceeds(getDoc(doc(team, 'deliverySms', id + '_delivered')));
  const link = await assertSucceeds(getDoc(doc(guest, 'deliveryReviewLinks', token)));
  assert.equal(link.data().orderId, id);
  assert.deepEqual(Object.keys(link.data()).sort(), ['orderId', 'merchantId', 'riderId', 'merchantName', 'riderName', 'createdAt', 'expiresAt', 'usedAt'].sort());
  await assertFails(getDocs(collection(guest, 'deliveryReviewLinks')));
  await assertFails(getDocs(query(collection(guest, 'deliveryReviewLinks'), where('orderId', '==', id))));
  await assertFails(getDocs(collection(merchant, 'deliveryReviewLinks')));
  await assertFails(getDoc(doc(guest, 'deliveryReviewLinks/invalid-token')));
  assert.equal((await assertSucceeds(getDoc(doc(guest, 'deliveryReviewLinks', tokenFor(999))))).exists(), false);
  await assertFails(getDoc(doc(guest, 'orders', id)));
  await assertFails(setDoc(doc(guest, 'deliveryReviews', id), review(id, token)));
  await assertFails(updateDoc(doc(guest, 'deliveryReviewLinks', token), { usedAt: serverTimestamp() }));
  await assertFails(consume(guest, id, token, {}, { usedAt: new Date(0) }).commit());
  await assertFails(consume(guest, id, token, { createdAt: new Date(0) }).commit());
  await assertFails(consume(guest, id, token, { orderId: 'review-order-1' }).commit());
  await assertFails(consume(guest, id, token, { merchantId: 'merchant-two' }).commit());
  await assertFails(consume(guest, id, token, { riderId: 'rider-two' }).commit());
  await assertFails(consume(guest, id, token, { reviewToken: tokenFor(2) }).commit());
  await assertFails(consume(guest, id, token, { extra: true }).commit());
  await assertFails(consume(guest, id, token, { customerPhone: '+233551234567' }).commit());
  for (const field of ['riderRating', 'merchantRating']) for (const value of [0, 6, 2.5, '5', null]) await assertFails(consume(guest, id, token, { [field]: value }).commit());
  await assertFails(consume(guest, id, token, { comment: 'a'.repeat(1001) }).commit());
  await assertFails(consume(guest, id, token, { comment: 4 }).commit());
  await assertFails(consume(guest, id, token, {}, { merchantName: 'Changed store name' }).commit());
  await assertFails(consume(guest, 'review-order-1', token).commit());
  await assertSucceeds(consume(guest, id, token).commit());
  const used = await assertSucceeds(getDoc(doc(guest, 'deliveryReviewLinks', token)));
  assert.ok(used.data().usedAt);
  await assertFails(consume(guest, id, token).commit());
  await assertFails(getDoc(doc(guest, 'deliveryReviews', id)));
  await assertFails(getDocs(collection(guest, 'deliveryReviews')));
  await assertSucceeds(getDoc(doc(rider, 'deliveryReviews', id)));
  await assertSucceeds(getDoc(doc(merchant, 'deliveryReviews', id)));
  await assertSucceeds(getDoc(doc(team, 'deliveryReviews', id)));
  await assertSucceeds(getDocs(query(collection(rider, 'deliveryReviews'), where('riderId', '==', 'rider-one'))));
  await assertSucceeds(getDocs(query(collection(merchant, 'deliveryReviews'), where('merchantId', '==', 'merchant-one'))));
  await assertSucceeds(getDocs(query(collection(team, 'deliveryReviews'), where('merchantId', '==', 'merchant-one'))));
  await assertFails(getDocs(collection(rider, 'deliveryReviews')));
  await assertFails(getDocs(collection(merchant, 'deliveryReviews')));
  await assertFails(updateDoc(doc(rider, 'deliveryReviews', id), { riderRating: 1 }));
  await assertFails(updateDoc(doc(merchant, 'deliveryReviews', id), { merchantRating: 1 }));
  await assertFails(deleteDoc(doc(merchant, 'deliveryReviews', id)));
  await assertFails(deleteDoc(doc(rider, 'deliveryReviewLinks', token)));
  await assertFails(updateDoc(doc(rider, 'deliveryReviewLinks', token), { expiresAt: expiry() }));
  for (const uid of ['rider-two', 'merchant-two', 'revoked-team', 'customer-one', 'suspended-rider']) await assertFails(getDoc(doc(env.authenticatedContext(uid).firestore(), 'deliveryReviews', id)));
  for (const [index, patch] of [
    { orderId: 'missing-order' }, { merchantId: 'merchant-two' }, { riderId: 'rider-two' },
    { merchantName: '' }, { riderName: '' }, { merchantName: 'a'.repeat(101) }, { riderName: 'a'.repeat(101) },
    { createdAt: new Date(0) }, { expiresAt: new Date(Date.now() - 1000) }, { expiresAt: new Date(Date.now() + 32 * 24 * 60 * 60 * 1000) },
    { usedAt: serverTimestamp() }, { customerPhone: '+233551234567' }, { address: 'Private address' }, { token: tokenFor(10) },
  ].entries()) await assertFails(issue(rider, 'review-order-' + (index + 1), tokenFor(index + 10), patch).commit());
  await assertFails(issue(rider, 'review-order-20', tokenFor(40), {}, { recipientReviewToken: tokenFor(41) }).commit());
  await assertFails(issue(rider, 'review-order-20', 'a'.repeat(47)).commit());
  await assertFails(issue(rider, 'review-order-20', 'A'.repeat(48)).commit());
  await assertFails(issue(rider, 'customer-order', tokenFor(42), {}, { merchantId: '', customerId: 'customer-one' }).commit());
  await assertFails(issue(rider, 'pickup-order', tokenFor(43), {}, { type: 'picked_up' }).commit());
  for (const uid of ['merchant-one', 'merchant-team', 'rider-two', 'unapproved-rider', 'suspended-rider']) await assertFails(issue(env.authenticatedContext(uid).firestore(), 'review-order-21', tokenFor(44), {}, { actorId: uid }).commit());
  await assertFails(issue(guest, 'review-order-21', tokenFor(44)).commit());
  await assertSucceeds(issue(admin, 'review-order-21', tokenFor(44), {}, { actorId: 'admin-one' }).commit());
  await assertFails(consume(merchant, 'review-order-21', tokenFor(45)).commit());
  await assertFails(consume(team, 'review-order-21', tokenFor(45)).commit());
  await assertSucceeds(consume(guest, 'review-order-21', tokenFor(44), { riderRating: 1, merchantRating: 5, comment: '' }).commit());

  await assertSucceeds(issue(rider, 'review-order-22', tokenFor(46)).commit());
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'deliveryReviewLinks', tokenFor(46)), { expiresAt: new Date(Date.now() - 1000) });
  });
  await assertSucceeds(getDoc(doc(guest, 'deliveryReviewLinks', tokenFor(46))));
  await assertFails(consume(guest, 'review-order-22', tokenFor(46)).commit());
  await assertSucceeds(issue(rider, 'review-order-23', tokenFor(47)).commit());
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'orders/review-order-23'), { status: 'cancelled' });
  });
  await assertFails(consume(guest, 'review-order-23', tokenFor(47)).commit());
  await assertSucceeds(issue(rider, 'review-order-24', tokenFor(48)).commit());
  const results = await Promise.allSettled([consume(guest, 'review-order-24', tokenFor(48)).commit(), consume(guest, 'review-order-24', tokenFor(48)).commit()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'Only one concurrent recipient review can succeed.');
  assert.equal((await assertSucceeds(getDoc(doc(rider, 'deliveryReviews/review-order-24')))).data().riderRating, 5);
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'deliveryReviewLinks', tokenFor(49)), { ...invite('review-order-24'), createdAt: new Date() });
    await updateDoc(doc(context.firestore(), 'storeInvites/merchant-one_merchant-team'), { status: 'revoked' });
  });
  await assertFails(consume(guest, 'review-order-24', tokenFor(49)).commit());
  await assertFails(getDoc(doc(team, 'deliveryReviews', id)));
  await assertFails(getDocs(query(collection(team, 'deliveryReviews'), where('merchantId', '==', 'merchant-one'))));
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'users/rider-one'), { accountStatus: 'suspended' });
    await updateDoc(doc(context.firestore(), 'users/merchant-one'), { accountStatus: 'suspended' });
  });
  await assertFails(getDoc(doc(rider, 'deliveryReviews', id)));
  await assertFails(getDoc(doc(merchant, 'deliveryReviews', id)));
  console.log('PASS recipient review rules: private capability links, atomic issuance and consumption, anonymous dual ratings, immutable canonical reviews, malformed/expired/duplicate denial, scoped business reads and team revocation.');
} finally { await env.cleanup(); }
