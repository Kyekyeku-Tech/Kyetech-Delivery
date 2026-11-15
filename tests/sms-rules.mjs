// Run with the Firestore emulator, using verification-only dependencies.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { adminOtpClaims, adminOtpSession, adminOtpSessionId } from './admin-otp-fixtures.mjs';
const require = createRequire(new URL('../.verification/sms-tools/package.json', import.meta.url));
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc, serverTimestamp } = require('firebase/firestore');

const environment = await initializeTestEnvironment({ projectId: 'demo-kyetech-sms', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
const profile = { accountStatus: 'active', approvalStatus: 'approved', role: 'rider' };
const record = (id, actor = 'rider-one', type = 'picked_up') => ({ orderId: id, actorId: actor, customerId: 'customer-one', merchantId: '', sender: 'KYE-TECH', message: `Your delivery ${id} has been picked up.`, type, status: 'submitting', errorCode: '', providerCode: '', campaignId: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
try {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users/rider-one'), profile),
      setDoc(doc(db, 'users/rider-two'), profile),
      setDoc(doc(db, 'users/unapproved'), { ...profile, approvalStatus: 'pending' }),
      setDoc(doc(db, 'users/suspended'), { ...profile, accountStatus: 'suspended' }),
      setDoc(doc(db, 'users/customer-one'), { role: 'customer', accountStatus: 'active' }),
      setDoc(doc(db, 'users/customer-two'), { role: 'customer', accountStatus: 'active' }),
      setDoc(doc(db, 'users/customer-suspended'), { role: 'customer', accountStatus: 'suspended' }),
      setDoc(doc(db, 'users/admin-one'), { role: 'customer', accountStatus: 'active' }),
      setDoc(doc(db, 'admins/admin-one'), { enabled: true }),
      setDoc(doc(db, 'adminOtpSessions', adminOtpSessionId), adminOtpSession()),
      setDoc(doc(db, 'orders/order-one'), { creatorId: 'customer-one', creatorRole: 'customer', riderId: 'rider-one', status: 'picked_up' }),
      setDoc(doc(db, 'orders/order-two'), { creatorId: 'customer-one', creatorRole: 'customer', riderId: 'rider-one', status: 'picked_up' }),
      setDoc(doc(db, 'orders/order-three'), { creatorId: 'customer-one', creatorRole: 'customer', riderId: 'rider-one', status: 'picked_up' }),
      setDoc(doc(db, 'orders/order-four'), { creatorId: 'customer-one', creatorRole: 'customer', riderId: 'rider-one', status: 'picked_up' }),
      setDoc(doc(db, 'orders/other-order'), { creatorId: 'customer-two', creatorRole: 'customer', riderId: 'rider-one', status: 'picked_up' }),
      setDoc(doc(db, 'deliverySms/other-order_picked_up'), { ...record('other-order'), customerId: 'customer-two', status: 'submitted' }),
      setDoc(doc(db, 'deliverySms/failed-order_picked_up'), { ...record('failed-order'), status: 'failed' }),
      setDoc(doc(db, 'deliverySms/unknown-order_picked_up'), { ...record('unknown-order'), status: 'unknown' }),
    ]);
  });
  const rider = environment.authenticatedContext('rider-one').firestore();
  await assertSucceeds(setDoc(doc(rider, 'deliverySms/order-one_picked_up'), record('order-one')));
  await assertSucceeds(getDoc(doc(rider, 'deliverySms/order-one_picked_up')));
  await assertFails(updateDoc(doc(rider, 'deliverySms/order-one_picked_up'), { status: 'submitted', message: 'Changed message', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(rider, 'deliverySms/order-one_picked_up'), { status: 'submitted', customerId: 'customer-two', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(rider, 'deliverySms/order-one_picked_up'), { status: 'submitted', providerCode: '2000', campaignId: 'campaign-one', updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(rider, 'deliverySms/order-one_picked_up'), record('order-one')));
  await assertFails(updateDoc(doc(rider, 'deliverySms/order-one_picked_up'), { status: 'failed', updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(rider, 'deliverySms/order-two_delivered'), record('order-two', 'rider-one', 'delivered')));
  await assertFails(setDoc(doc(rider, 'deliverySms/wrong-id'), record('order-two')));
  await assertFails(setDoc(doc(rider, 'deliverySms/order-two_picked_up'), { ...record('order-two'), recipient: '0209999999' }));
  await assertFails(setDoc(doc(rider, 'deliverySms/order-two_picked_up'), { ...record('order-two'), actorId: 'someone-else' }));
  await assertFails(setDoc(doc(rider, 'deliverySms/order-two_picked_up'), { ...record('order-two'), customerId: 'customer-two' }));
  await assertFails(setDoc(doc(rider, 'deliverySms/order-two_picked_up'), { ...record('order-two'), sender: 'Other sender' }));
  await assertFails(setDoc(doc(rider, 'deliverySms/order-two_picked_up'), { ...record('order-two'), message: '' }));
  await assertFails(setDoc(doc(rider, 'deliverySms/order-two_picked_up'), { ...record('order-two'), message: 'a'.repeat(1001) }));
  for (const uid of ['customer-two', 'customer-suspended', 'rider-two', 'unapproved', 'suspended']) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertFails(setDoc(doc(db, 'deliverySms/order-two_picked_up'), record('order-two', uid)));
    await assertFails(getDoc(doc(db, 'deliverySms/order-one_picked_up')));
  }
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'deliverySms/order-one_picked_up')));
  const admin = environment.authenticatedContext('admin-one', adminOtpClaims()).firestore();
  await assertSucceeds(setDoc(doc(admin, 'deliverySms/order-three_picked_up'), record('order-three', 'admin-one')));
  await assertSucceeds(getDoc(doc(admin, 'deliverySms/order-one_picked_up')));
  const customer = environment.authenticatedContext('customer-one').firestore();
  await assertSucceeds(getDoc(doc(customer, 'deliverySms/order-one_picked_up')));
  await assertFails(getDoc(doc(customer, 'deliverySms/order-three_picked_up')));
  await assertFails(getDoc(doc(customer, 'deliverySms/other-order_picked_up')));
  await assertFails(getDoc(doc(customer, 'deliverySms/failed-order_picked_up')));
  await assertFails(getDoc(doc(customer, 'deliverySms/unknown-order_picked_up')));
  const inbox = query(collection(customer, 'deliverySms'), where('customerId', '==', 'customer-one'), where('status', '==', 'submitted'));
  const messages = await assertSucceeds(getDocs(inbox));
  assert.deepEqual(messages.docs.map(item => item.id), ['order-one_picked_up']);
  await assertFails(getDocs(collection(customer, 'deliverySms')));
  await assertFails(getDocs(query(collection(customer, 'deliverySms'), where('customerId', '==', 'customer-one'))));
  await assertFails(getDocs(query(collection(customer, 'deliverySms'), where('customerId', '==', 'customer-two'), where('status', '==', 'submitted'))));
  await assertFails(setDoc(doc(customer, 'deliverySms/order-four_picked_up'), record('order-four', 'customer-one')));
  await assertFails(updateDoc(doc(customer, 'deliverySms/order-one_picked_up'), { message: 'Edited SMS' }));
  await assertFails(updateDoc(doc(customer, 'deliverySms/order-three_picked_up'), { status: 'submitted', updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(customer, 'deliverySms/order-one_picked_up')));
  const otherCustomer = environment.authenticatedContext('customer-two').firestore();
  await assertSucceeds(getDoc(doc(otherCustomer, 'deliverySms/other-order_picked_up')));
  await assertFails(getDoc(doc(otherCustomer, 'deliverySms/order-one_picked_up')));
  const suspendedCustomer = environment.authenticatedContext('customer-suspended').firestore();
  await assertFails(getDocs(query(collection(suspendedCustomer, 'deliverySms'), where('customerId', '==', 'customer-suspended'), where('status', '==', 'submitted'))));
  const readReceipt = doc(customer, 'users/customer-one/smsReads/order-one_picked_up');
  await assertSucceeds(setDoc(readReceipt, { readAt: serverTimestamp() }));
  await assertSucceeds(getDoc(readReceipt));
  await assertSucceeds(setDoc(readReceipt, { readAt: serverTimestamp() }));
  const readReceipts = await assertSucceeds(getDocs(collection(customer, 'users/customer-one/smsReads')));
  assert.deepEqual(readReceipts.docs.map(item => item.id), ['order-one_picked_up']);
  await assertFails(setDoc(readReceipt, { readAt: serverTimestamp(), message: 'Edited SMS' }));
  await assertFails(setDoc(readReceipt, { readAt: new Date(0) }));
  await assertFails(setDoc(readReceipt, { readAt: 'read' }));
  await assertFails(deleteDoc(readReceipt));
  for (const id of ['other-order_picked_up', 'failed-order_picked_up', 'unknown-order_picked_up', 'order-three_picked_up', 'missing-message']) {
    await assertFails(setDoc(doc(customer, 'users/customer-one/smsReads/' + id), { readAt: serverTimestamp() }));
  }
  await assertSucceeds(setDoc(doc(otherCustomer, 'users/customer-two/smsReads/other-order_picked_up'), { readAt: serverTimestamp() }));
  await assertFails(setDoc(doc(otherCustomer, 'users/customer-two/smsReads/order-one_picked_up'), { readAt: serverTimestamp() }));
  for (const db of [otherCustomer, rider, suspendedCustomer, environment.unauthenticatedContext().firestore()]) {
    await assertFails(getDoc(doc(db, 'users/customer-one/smsReads/order-one_picked_up')));
    await assertFails(getDocs(collection(db, 'users/customer-one/smsReads')));
    await assertFails(setDoc(doc(db, 'users/customer-one/smsReads/order-one_picked_up'), { readAt: serverTimestamp() }));
  }
  await assertFails(setDoc(doc(suspendedCustomer, 'users/customer-suspended/smsReads/order-one_picked_up'), { readAt: serverTimestamp() }));
  await assertFails(setDoc(doc(rider, 'users/rider-one/smsReads/order-one_picked_up'), { readAt: serverTimestamp() }));
  assert.equal((await getDoc(doc(customer, 'deliverySms/order-one_picked_up'))).data().message, 'Your delivery order-one has been picked up.');
  assert.equal((await getDoc(doc(rider, 'deliverySms/order-one_picked_up'))).data().status, 'submitted');
  const merchantRecord = (id, actor = 'rider-one', type = 'picked_up', patch = {}) => ({ ...record(id, actor, type), customerId: '', merchantId: 'merchant-one', ...patch });
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const uid of ['merchant-one', 'merchant-two', 'merchant-team', 'revoked-team', 'suspended-team', 'pending-team', 'inactive-merchant']) {
      await setDoc(doc(db, 'users', uid), { role: 'merchant', accountStatus: ['suspended-team', 'inactive-merchant'].includes(uid) ? 'suspended' : 'active' });
    }
    for (const uid of ['merchant-one', 'merchant-two', 'inactive-merchant']) await setDoc(doc(db, 'stores', uid), { ownerId: uid, accountStatus: 'active', approvalStatus: 'approved' });
    for (const [uid, enabled, status] of [['merchant-team', true, 'accepted'], ['revoked-team', false, 'revoked'], ['suspended-team', true, 'accepted'], ['pending-team', true, 'pending']]) {
      const inviteId = 'merchant-one_' + uid;
      await setDoc(doc(db, 'storeInvites', inviteId), { storeId: 'merchant-one', ownerId: 'merchant-one', status });
      await setDoc(doc(db, 'storeMembers', 'merchant-one_' + uid), { storeId: 'merchant-one', userId: uid, inviteId, enabled });
    }
    for (const [id, merchantId, status] of [['merchant-order', 'merchant-one', 'picked_up'], ['merchant-order-two', 'merchant-one', 'picked_up'], ['merchant-complete', 'merchant-one', 'delivered'], ['other-merchant', 'merchant-two', 'picked_up'], ['inactive-owner-order', 'inactive-merchant', 'picked_up']]) {
      await setDoc(doc(db, 'orders', id), { creatorId: merchantId, creatorRole: 'merchant', merchantId, riderId: 'rider-one', status });
    }
    await setDoc(doc(db, 'deliverySms/other-merchant_picked_up'), merchantRecord('other-merchant', 'rider-one', 'picked_up', { merchantId: 'merchant-two', status: 'submitted' }));
    await setDoc(doc(db, 'deliverySms/inactive-owner-order_picked_up'), merchantRecord('inactive-owner-order', 'rider-one', 'picked_up', { merchantId: 'inactive-merchant', status: 'submitted' }));
    await setDoc(doc(db, 'deliverySms/merchant-failed_picked_up'), merchantRecord('merchant-failed', 'rider-one', 'picked_up', { status: 'failed' }));
    await setDoc(doc(db, 'deliverySms/merchant-unknown_picked_up'), merchantRecord('merchant-unknown', 'rider-one', 'picked_up', { status: 'unknown' }));
    const legacy = { ...record('legacy-customer'), status: 'submitted' }; delete legacy.merchantId;
    await setDoc(doc(db, 'deliverySms/legacy-customer_picked_up'), legacy);
  });
  const merchant = environment.authenticatedContext('merchant-one').firestore();
  const otherMerchant = environment.authenticatedContext('merchant-two').firestore();
  const merchantTeam = environment.authenticatedContext('merchant-team').firestore();
  await assertSucceeds(setDoc(doc(rider, 'deliverySms/merchant-order_picked_up'), merchantRecord('merchant-order')));
  await assertFails(getDoc(doc(merchant, 'deliverySms/merchant-order_picked_up')));
  await assertSucceeds(updateDoc(doc(rider, 'deliverySms/merchant-order_picked_up'), { status: 'submitted', updatedAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(merchant, 'deliverySms/merchant-order_picked_up')));
  await assertSucceeds(getDoc(doc(merchantTeam, 'deliverySms/merchant-order_picked_up')));
  await assertFails(getDoc(doc(otherMerchant, 'deliverySms/merchant-order_picked_up')));
  await assertFails(getDoc(doc(customer, 'deliverySms/merchant-order_picked_up')));
  await assertFails(getDoc(doc(merchant, 'deliverySms/order-one_picked_up')));
  await assertFails(getDoc(doc(merchant, 'deliverySms/other-merchant_picked_up')));
  await assertFails(getDoc(doc(merchant, 'deliverySms/merchant-failed_picked_up')));
  await assertFails(getDoc(doc(merchant, 'deliverySms/merchant-unknown_picked_up')));
  const merchantInbox = db => query(collection(db, 'deliverySms'), where('merchantId', '==', 'merchant-one'), where('status', '==', 'submitted'));
  const merchantCopies = await assertSucceeds(getDocs(merchantInbox(merchant)));
  assert.deepEqual(merchantCopies.docs.map(item => item.id), ['merchant-order_picked_up']);
  await assertSucceeds(getDocs(merchantInbox(merchantTeam)));
  await assertFails(getDocs(collection(merchant, 'deliverySms')));
  await assertFails(getDocs(query(collection(merchant, 'deliverySms'), where('merchantId', '==', 'merchant-one'))));
  await assertFails(getDocs(merchantInbox(otherMerchant)));
  for (const [index, patch] of [{ merchantId: 'merchant-two' }, { customerId: 'customer-one' }, { merchantId: '' }, { merchantId: 'merchant-one', customerId: 'merchant-one' }].entries()) {
    await assertFails(setDoc(doc(rider, 'deliverySms/merchant-order-two_picked_up'), merchantRecord('merchant-order-two', 'rider-one', 'picked_up', patch)));
  }
  await assertFails(setDoc(doc(merchant, 'deliverySms/merchant-order-two_picked_up'), merchantRecord('merchant-order-two', 'merchant-one')));
  await assertFails(setDoc(doc(rider, 'deliverySms/order-two_picked_up'), { ...record('order-two'), merchantId: 'merchant-one' }));
  await assertSucceeds(setDoc(doc(admin, 'deliverySms/merchant-complete_delivered'), merchantRecord('merchant-complete', 'admin-one', 'delivered')));
  await assertSucceeds(updateDoc(doc(admin, 'deliverySms/merchant-complete_delivered'), { status: 'submitted', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(merchant, 'deliverySms/merchant-order_picked_up'), { message: 'Edited store SMS' }));
  await assertFails(updateDoc(doc(rider, 'deliverySms/merchant-order_picked_up'), { merchantId: 'merchant-two', updatedAt: serverTimestamp() }));
  const merchantReceipt = doc(merchant, 'users/merchant-one/smsReads/merchant-order_picked_up');
  const teamReceipt = doc(merchantTeam, 'users/merchant-team/smsReads/merchant-order_picked_up');
  for (const receipt of [merchantReceipt, teamReceipt]) {
    await assertSucceeds(setDoc(receipt, { readAt: serverTimestamp() }));
    await assertSucceeds(setDoc(receipt, { readAt: serverTimestamp() }));
    await assertSucceeds(getDoc(receipt));
    await assertFails(setDoc(receipt, { readAt: serverTimestamp(), merchantId: 'merchant-one' }));
    await assertFails(setDoc(receipt, { readAt: new Date(0) }));
    await assertFails(deleteDoc(receipt));
  }
  await assertSucceeds(getDocs(collection(merchant, 'users/merchant-one/smsReads')));
  await assertSucceeds(getDocs(collection(merchantTeam, 'users/merchant-team/smsReads')));
  await assertFails(getDoc(doc(merchantTeam, 'users/merchant-one/smsReads/merchant-order_picked_up')));
  await assertFails(getDoc(doc(merchant, 'users/merchant-team/smsReads/merchant-order_picked_up')));
  for (const id of ['order-one_picked_up', 'other-merchant_picked_up', 'merchant-failed_picked_up', 'merchant-unknown_picked_up', 'missing-message']) {
    await assertFails(setDoc(doc(merchant, 'users/merchant-one/smsReads/' + id), { readAt: serverTimestamp() }));
  }
  for (const uid of ['revoked-team', 'suspended-team', 'pending-team']) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, 'deliverySms/merchant-order_picked_up')));
    await assertFails(getDocs(merchantInbox(db)));
    await assertFails(setDoc(doc(db, 'users', uid, 'smsReads', 'merchant-order_picked_up'), { readAt: serverTimestamp() }));
  }
  const inactiveMerchant = environment.authenticatedContext('inactive-merchant').firestore();
  await assertFails(getDoc(doc(inactiveMerchant, 'deliverySms/inactive-owner-order_picked_up')));
  await assertFails(setDoc(doc(inactiveMerchant, 'users/inactive-merchant/smsReads/inactive-owner-order_picked_up'), { readAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(customer, 'deliverySms/legacy-customer_picked_up')));
  await assertSucceeds(setDoc(doc(customer, 'users/customer-one/smsReads/legacy-customer_picked_up'), { readAt: serverTimestamp() }));
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'storeInvites/merchant-one_merchant-team'), { status: 'revoked' });
  });
  await assertFails(getDoc(doc(merchantTeam, 'deliverySms/merchant-order_picked_up')));
  await assertFails(setDoc(teamReceipt, { readAt: serverTimestamp() }));
  await assertSucceeds(getDocs(collection(merchantTeam, 'users/merchant-team/smsReads')));
  console.log('PASS SMS rules: customer/legacy and merchant copy privacy, validated store routing, immutable messages, submitted-only owner/team queries, private receipts and revoked/suspended membership denial.');
} finally { await environment.cleanup(); }
