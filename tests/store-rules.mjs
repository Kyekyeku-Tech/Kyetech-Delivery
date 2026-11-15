// Run with the Firestore emulator; never writes to the live database.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { adminOtpClaims, adminOtpSession, adminOtpSessionId } from './admin-otp-fixtures.mjs';
const require = createRequire(new URL('../.verification/sms-tools/package.json', import.meta.url));
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, serverTimestamp, Timestamp } = require('firebase/firestore');
const environment = await initializeTestEnvironment({ projectId: 'demo-kyetech-sms', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
const pin = { latitude: 4.8917, longitude: -1.7554 };
const store = () => ({ ownerId: 'merchant-one', name: 'Ada Shop', category: 'Groceries', address: 'Market Circle, Takoradi', phone: '+233241234567', imageUrl: 'https://example.invalid/store.png', description: 'Local groceries', open: true, location: pin, accountStatus: 'active', approvalStatus: 'pending', reviewNote: '', reviewedBy: '', reviewedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const booking = (patch = {}) => ({
  creatorId: 'customer-one', creatorRole: 'customer', customerName: 'Customer One', customerPhone: '+233241234567',
  pickup: 'Market Circle, Takoradi', dropoff: 'Effia', recipientName: 'Kwame', recipientPhone: '+233551234567', packageDescription: 'Groceries', fee: 25, preferredRiderId: '', merchantId: 'merchant-one',
  status: 'pending', riderId: null, riderName: '', customerRating: null, riderRating: null, customerRatingComment: '', riderRatingComment: '', customerRatedAt: null, riderRatedAt: null, assignedAt: null, pickedUpAt: null, deliveredAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...patch,
});
try {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users/merchant-one'), { role: 'merchant', name: 'Merchant One', phone: '+233241234567', accountStatus: 'active' }),
      setDoc(doc(db, 'users/merchant-two'), { role: 'merchant', name: 'Merchant Two', phone: '+233241234567', accountStatus: 'active' }),
      setDoc(doc(db, 'users/customer-one'), { role: 'customer', name: 'Customer One', phone: '+233241234567', accountStatus: 'active' }),
      setDoc(doc(db, 'users/admin-one'), { role: 'customer', accountStatus: 'active' }),
      setDoc(doc(db, 'admins/admin-one'), { enabled: true }),
      setDoc(doc(db, 'adminOtpSessions', adminOtpSessionId), adminOtpSession()),
      setDoc(doc(db, 'users/rider-one'), { role: 'rider', name: 'Rider One', accountStatus: 'active', approvalStatus: 'approved', online: true }),
    ]);
    const legacy = { ...store(), ownerId: 'merchant-two', approvalStatus: 'approved', createdAt: Timestamp.fromMillis(1000), updatedAt: Timestamp.fromMillis(1000) };
    delete legacy.location;
    await setDoc(doc(db, 'stores/merchant-two'), legacy);
  });
  const merchant = environment.authenticatedContext('merchant-one').firestore();
  const otherMerchant = environment.authenticatedContext('merchant-two').firestore();
  const customer = environment.authenticatedContext('customer-one').firestore();
  const admin = environment.authenticatedContext('admin-one', adminOtpClaims()).firestore();
  await assertSucceeds(setDoc(doc(merchant, 'stores/merchant-one'), store()));
  assert.deepEqual((await getDoc(doc(merchant, 'stores/merchant-one'))).data().location, pin);
  await assertFails(getDoc(doc(customer, 'stores/merchant-one')));
  await assertFails(updateDoc(doc(merchant, 'stores/merchant-one'), { approvalStatus: 'approved', updatedAt: serverTimestamp() }));
  for (const location of [
    { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: '4.8', longitude: -1.7 },
    { latitude: 4.8 }, { latitude: 4.8, longitude: -1.7, recipient: 'extra' }, [4.8, -1.7],
    { latitude: NaN, longitude: 0 }, { latitude: 0, longitude: Infinity },
  ]) await assertFails(updateDoc(doc(merchant, 'stores/merchant-one'), { location, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(otherMerchant, 'stores/merchant-one'), { location: { latitude: 0, longitude: 0 }, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(customer, 'stores/merchant-one'), { location: null, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(merchant, 'stores/merchant-one'), { location: { latitude: 0, longitude: 0 }, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(merchant, 'stores/merchant-one'), { location: pin, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(admin, 'stores/merchant-one'), { approvalStatus: 'approved', reviewedBy: 'admin-one', reviewedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(customer, 'stores/merchant-one')));
  await assertSucceeds(updateDoc(doc(otherMerchant, 'stores/merchant-two'), { description: 'Legacy store remains editable', updatedAt: serverTimestamp() }));

  await assertSucceeds(setDoc(doc(customer, 'orders/pinned-booking'), booking({ pickupLocation: pin })));
  await assertFails(setDoc(doc(customer, 'orders/forged-booking'), booking({ pickupLocation: { latitude: 5, longitude: -2 } })));
  await assertFails(setDoc(doc(customer, 'orders/invalid-booking'), booking({ pickupLocation: { latitude: '4.8', longitude: -1.7 } })));
  await assertFails(setDoc(doc(customer, 'orders/manual-forged-pin'), booking({ merchantId: '', pickupLocation: pin })));
  await assertSucceeds(setDoc(doc(customer, 'orders/legacy-client-booking'), booking()));
  await assertSucceeds(setDoc(doc(customer, 'orders/manual-booking'), booking({ merchantId: '' })));
  await assertSucceeds(setDoc(doc(customer, 'orders/legacy-store-booking'), booking({ merchantId: 'merchant-two', pickupLocation: null })));
  await assertFails(setDoc(doc(otherMerchant, 'orders/wrong-merchant-booking'), booking({ creatorId: 'merchant-two', creatorRole: 'merchant', customerName: 'Merchant Two', pickupLocation: pin })));
  await assertFails(updateDoc(doc(customer, 'orders/pinned-booking'), { pickupLocation: null, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(admin, 'orders/pinned-booking'), { pickupLocation: null, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(merchant, 'stores/merchant-one'), { location: null, updatedAt: serverTimestamp() }));
  assert.deepEqual((await getDoc(doc(customer, 'orders/pinned-booking'))).data().pickupLocation, pin, 'A store edit must not move the original booking pin.');
  const rider = environment.authenticatedContext('rider-one').firestore();
  await assertSucceeds(updateDoc(doc(rider, 'orders/pinned-booking'), { status: 'accepted', riderId: 'rider-one', riderName: 'Rider One', assignedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  assert.deepEqual((await getDoc(doc(rider, 'orders/pinned-booking'))).data().pickupLocation, pin);
  console.log('PASS store GPS rules: owner/admin writes, valid pins, approved-store visibility, booking pin equality/immutability, and legacy compatibility.');
} finally { await environment.cleanup(); }
