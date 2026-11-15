// Run only against the local Firestore emulator.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { adminOtpClaims, adminOtpSession, adminOtpSessionId } from './admin-otp-fixtures.mjs';
const require = createRequire(new URL('../.verification/sms-tools/package.json', import.meta.url));
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection, writeBatch, serverTimestamp, Timestamp } = require('firebase/firestore');
const env = await initializeTestEnvironment({ projectId: 'demo-kyetech-location', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
const pin = { latitude: 4.8917, longitude: -1.7554 };
const tracking = 'orders/active-trip/tracking/rider';
const position = () => ({ ...pin, riderId: 'rider-one', accuracy: 20, address: 'Market Circle, Takoradi, Ghana', sharing: true, updatedAt: serverTimestamp() });
const booking = patch => ({ creatorId: 'customer-one', creatorRole: 'customer', customerName: 'Customer One', customerPhone: '+233241234567', pickup: 'Market Circle', dropoff: 'Effia, Takoradi', dropoffLocation: pin, recipientName: 'Kwame', recipientPhone: '+233551234567', packageDescription: 'Groceries', fee: 25, preferredRiderId: '', merchantId: '', status: 'pending', riderId: null, riderName: '', customerRating: null, riderRating: null, customerRatingComment: '', riderRatingComment: '', customerRatedAt: null, riderRatedAt: null, assignedAt: null, pickedUpAt: null, deliveredAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...patch });
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const id of ['customer-one', 'customer-two', 'admin-one', 'rider-one', 'rider-two', 'rider-pending', 'rider-suspended']) await setDoc(doc(db, 'users', id), { role: id.startsWith('rider') ? 'rider' : 'customer', name: id === 'customer-one' ? 'Customer One' : id, phone: '+233241234567', accountStatus: id === 'rider-suspended' ? 'suspended' : 'active', approvalStatus: id === 'rider-pending' ? 'pending' : 'approved', online: true });
    await setDoc(doc(db, 'admins/admin-one'), { enabled: true });
    await setDoc(doc(db, 'adminOtpSessions', adminOtpSessionId), adminOtpSession());
    await setDoc(doc(db, 'orders/active-trip'), booking({ status: 'accepted', riderId: 'rider-one', riderName: 'rider-one' }));
    await setDoc(doc(db, 'orders/pending-trip'), booking());
  });
  const customer = env.authenticatedContext('customer-one').firestore(), rider = env.authenticatedContext('rider-one').firestore(), otherRider = env.authenticatedContext('rider-two').firestore(), admin = env.authenticatedContext('admin-one', adminOtpClaims()).firestore();
  await assertSucceeds(getDoc(doc(customer, tracking))); // Missing tracking documents are readable to the sender.
  await assertSucceeds(setDoc(doc(rider, tracking), position()));
  assert.deepEqual((await getDoc(doc(customer, tracking))).data().latitude, pin.latitude);
  await assertSucceeds(getDoc(doc(admin, tracking)));
  await assertFails(getDoc(doc(env.authenticatedContext('customer-two').firestore(), tracking)));
  await assertFails(getDoc(doc(otherRider, tracking)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), tracking)));
  await assertFails(getDocs(collection(customer, 'orders/active-trip/tracking')));
  await assertFails(setDoc(doc(customer, tracking), position()));
  await assertFails(setDoc(doc(otherRider, tracking), { ...position(), riderId: 'rider-two' }));
  await assertFails(setDoc(doc(rider, 'orders/pending-trip/tracking/rider'), position()));
  for (const patch of [{ latitude: 91 }, { longitude: -181 }, { latitude: NaN }, { longitude: Infinity }, { accuracy: -1 }, { latitude: '4.8' }, { address: 'x'.repeat(251) }, { extra: true }, { updatedAt: Timestamp.fromMillis(1000) }, { riderId: 'rider-two' }, { sharing: false }]) await assertFails(setDoc(doc(rider, tracking), { ...position(), ...patch }));
  await assertSucceeds(updateDoc(doc(rider, tracking), { latitude: 4.892, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(otherRider, tracking)));
  await assertSucceeds(deleteDoc(doc(rider, tracking)));
  assert.equal((await getDoc(doc(customer, tracking))).exists(), false);
  await assertSucceeds(setDoc(doc(rider, tracking), position()));
  const reassign = writeBatch(admin);
  reassign.update(doc(admin, 'orders/active-trip'), { riderId: 'rider-two', riderName: 'rider-two', assignedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  reassign.delete(doc(admin, tracking));
  await assertSucceeds(reassign.commit());
  assert.equal((await getDoc(doc(customer, tracking))).exists(), false);
  await assertFails(setDoc(doc(rider, tracking), position()));
  await assertSucceeds(setDoc(doc(otherRider, tracking), { ...position(), riderId: 'rider-two' }));
  await assertSucceeds(updateDoc(doc(otherRider, 'orders/active-trip'), { status: 'picked_up', pickedUpAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  const complete = writeBatch(otherRider);
  complete.update(doc(otherRider, 'orders/active-trip'), { status: 'delivered', deliveredAt: serverTimestamp(), updatedAt: serverTimestamp() });
  complete.delete(doc(otherRider, tracking));
  await assertSucceeds(complete.commit());
  await assertFails(setDoc(doc(otherRider, tracking), { ...position(), riderId: 'rider-two' }));
  await assertFails(getDoc(doc(customer, tracking)));
  await assertSucceeds(setDoc(doc(customer, 'orders/gps-dropoff'), booking()));
  for (const dropoffLocation of [{ latitude: 91, longitude: 0 }, { ...pin, extra: true }]) await assertFails(setDoc(doc(customer, 'orders/invalid-dropoff'), booking({ dropoffLocation })));
  console.log('PASS live GPS rules: private reads, assigned-rider writes, validated pins, stop/delete, reassignment, completion cleanup and immutable drop-off pins.');
} finally { await env.cleanup(); }
