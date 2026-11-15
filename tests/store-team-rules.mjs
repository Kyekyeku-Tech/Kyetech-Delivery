import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../.verification/sms-tools/package.json', import.meta.url));
const { initializeTestEnvironment, assertSucceeds, assertFails: expectDenial } = require('@firebase/rules-unit-testing');
async function assertFails(request) {
  const origin = new Error().stack?.split('\n')[2]?.trim();
  try { return await expectDenial(request); }
  catch (cause) { cause.message += ' (' + origin + ')'; throw cause; }
}
const { doc, setDoc, getDoc, getDocs, query, where, collection, updateDoc, writeBatch, serverTimestamp } = require('firebase/firestore');
const env = await initializeTestEnvironment({ projectId: 'demo-kyetech-team', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
const inviteId = 'merchant-one_' + 'a'.repeat(64), invitePath = 'storeInvites/' + inviteId, memberPath = 'storeMembers/merchant-one_teammate';
const invite = () => ({ ownerId: 'merchant-one', storeId: 'merchant-one', storeName: 'Ada Shop', email: 'team@example.invalid', status: 'pending', memberId: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const member = () => ({ storeId: 'merchant-one', userId: 'teammate', email: 'team@example.invalid', name: 'Team Member', inviteId, enabled: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
const ownerPhone = '+233241111111', storePhone = '+233242222222', teamPhone = '+233203333333';
const delivery = (patch = {}) => ({ creatorId: 'merchant-one', creatorRole: 'merchant', merchantId: 'merchant-one', createdBy: 'teammate', customerName: 'Ada Shop', customerPhone: storePhone,
  pickup: 'Market Circle, Takoradi', pickupLocation: null, dropoff: 'Effia, Takoradi', dropoffLocation: null, recipientName: 'Kwame Receiver', recipientPhone: '+233551234567', packageDescription: 'One bag of groceries', fee: 25,
  preferredRiderId: '', status: 'pending', riderId: null, riderName: '', customerRating: null, riderRating: null, customerRatingComment: '', riderRatingComment: '', customerRatedAt: null, riderRatedAt: null,
  assignedAt: null, pickedUpAt: null, deliveredAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...patch });
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const [id, name] of [['merchant-one', 'Ada Merchant'], ['merchant-two', 'Other Merchant'], ['teammate', 'Team Member'], ['stranger', 'Stranger'], ['suspended-team', 'Suspended Team']]) await setDoc(doc(db, 'users', id), { role: 'merchant', name, phone: id === 'merchant-one' ? ownerPhone : teamPhone, accountStatus: id === 'suspended-team' ? 'suspended' : 'active' });
    await setDoc(doc(db, 'users/customer'), { role: 'customer', name: 'Abena Customer', phone: '+233551234567', accountStatus: 'active' });
    await setDoc(doc(db, 'users/rider-one'), { role: 'rider', name: 'Kofi Rider', phone: '+233241234567', approvalStatus: 'approved', accountStatus: 'active' });
    for (const [id, name] of [['merchant-one', 'Ada Shop'], ['merchant-two', 'Other Shop']]) await setDoc(doc(db, 'stores', id), { ownerId: id, name, category: 'Groceries', address: 'Market Circle, Takoradi', phone: storePhone, imageUrl: '', description: 'Fresh groceries', open: true, createdAt: new Date(), updatedAt: new Date(), accountStatus: 'active', approvalStatus: 'pending' });
    await setDoc(doc(db, 'orders/store-delivery'), { creatorId: 'merchant-one', creatorRole: 'merchant', merchantId: 'merchant-one', status: 'pending' });
    await setDoc(doc(db, 'orders/customer-delivery'), { creatorId: 'customer', creatorRole: 'customer', merchantId: 'merchant-one', status: 'pending' });
  });
  const owner = env.authenticatedContext('merchant-one', { email: 'owner@example.invalid' }).firestore(), other = env.authenticatedContext('merchant-two', { email: 'other@example.invalid' }).firestore();
  const unverified = env.authenticatedContext('teammate', { email: 'team@example.invalid', email_verified: false }).firestore(), verified = env.authenticatedContext('teammate', { email: 'team@example.invalid', email_verified: true }).firestore(), stranger = env.authenticatedContext('stranger', { email: 'stranger@example.invalid', email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(owner, invitePath)));
  await assertSucceeds(setDoc(doc(owner, invitePath), invite()));
  await assertFails(setDoc(doc(other, invitePath), invite()));
  await assertFails(setDoc(doc(owner, 'storeInvites/merchant-two_' + 'b'.repeat(64)), invite()));
  await assertFails(getDoc(doc(stranger, invitePath)));
  await assertSucceeds(getDocs(query(collection(owner, 'storeInvites'), where('ownerId', '==', 'merchant-one'))));
  await assertSucceeds(getDocs(query(collection(verified, 'storeInvites'), where('email', '==', 'team@example.invalid'))));
  await assertSucceeds(getDoc(doc(verified, memberPath)));
  await assertFails(getDoc(doc(verified, 'stores/merchant-one')));
  await assertFails(getDoc(doc(verified, 'orders/store-delivery')));
  function acceptance(db, patch = {}) { const batch = writeBatch(db); batch.update(doc(db, invitePath), { status: 'accepted', memberId: 'teammate', updatedAt: serverTimestamp() }); batch.set(doc(db, memberPath), { ...member(), ...patch }); return batch; }
  await assertFails(acceptance(unverified).commit());
  await assertFails(acceptance(stranger).commit());
  await assertFails(acceptance(verified, { storeId: 'merchant-two' }).commit());
  await assertFails(acceptance(verified, { extra: true }).commit());
  await assertSucceeds(acceptance(verified).commit());
  assert.equal((await getDoc(doc(owner, memberPath))).data().enabled, true);
  await assertSucceeds(getDoc(doc(verified, 'stores/merchant-one')));
  await assertSucceeds(getDoc(doc(verified, 'orders/store-delivery')));
  await assertSucceeds(getDocs(query(collection(verified, 'orders'), where('creatorId', '==', 'merchant-one'), where('creatorRole', '==', 'merchant'), where('merchantId', '==', 'merchant-one'))));
  await assertFails(getDoc(doc(verified, 'orders/customer-delivery')));
  await assertFails(getDoc(doc(verified, 'stores/merchant-two')));
  await assertFails(updateDoc(doc(verified, 'stores/merchant-one'), { name: 'Changed store', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(verified, 'stores/merchant-one'), { open: false, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(verified, 'orders/store-delivery'), { status: 'cancelled', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(verified, memberPath), { enabled: false, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(verified, 'orders/pending-store-order'), delivery()));
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await updateDoc(doc(db, 'stores/merchant-one'), { approvalStatus: 'approved' });
    await updateDoc(doc(db, 'stores/merchant-two'), { approvalStatus: 'approved' });
    await setDoc(doc(db, 'storeInvites/merchant-one_suspended-team'), { ownerId: 'merchant-one', storeId: 'merchant-one', status: 'accepted' });
    await setDoc(doc(db, 'storeMembers/merchant-one_suspended-team'), { storeId: 'merchant-one', userId: 'suspended-team', enabled: true, inviteId: 'merchant-one_suspended-team' });
    await setDoc(doc(db, 'orders/completed-store-order'), delivery({ status: 'delivered', riderId: 'rider-one', riderName: 'Kofi Rider', deliveredAt: new Date(), assignedAt: new Date(), pickedUpAt: new Date() }));
    await setDoc(doc(db, 'orders/second-completed-store-order'), delivery({ status: 'delivered', riderId: 'rider-one', riderName: 'Kofi Rider', deliveredAt: new Date(), assignedAt: new Date(), pickedUpAt: new Date() }));
    await setDoc(doc(db, 'orders/completed-customer-order'), delivery({ creatorId: 'customer', creatorRole: 'customer', createdBy: 'customer', customerName: 'Abena Customer', customerPhone: '+233551234567', status: 'delivered', riderId: 'rider-one', riderName: 'Kofi Rider', deliveredAt: new Date(), assignedAt: new Date(), pickedUpAt: new Date() }));
  });
  const newDelivery = doc(verified, 'orders/team-created-order');
  await assertSucceeds(setDoc(newDelivery, delivery()));
  assert.equal((await assertSucceeds(getDoc(newDelivery))).data().createdBy, 'teammate');
  assert.equal((await assertSucceeds(getDoc(doc(owner, 'orders/team-created-order')))).data().customerPhone, storePhone);
  await assertFails(updateDoc(newDelivery, { createdBy: 'merchant-one', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(newDelivery, { fee: 1, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(newDelivery, { status: 'picked_up', updatedAt: serverTimestamp() }));
  for (const [index, patch] of [
    { createdBy: 'merchant-one' }, { creatorId: 'teammate', merchantId: 'teammate' }, { creatorId: 'merchant-two', merchantId: 'merchant-two', customerName: 'Other Shop' },
    { merchantId: 'merchant-two' }, { customerName: 'Team Member', customerPhone: teamPhone }, { customerName: 'Ada Merchant', customerPhone: ownerPhone },
  ].entries()) await assertFails(setDoc(doc(verified, 'orders/spoofed-team-order-' + index), delivery(patch)));
  const withoutActor = delivery(); delete withoutActor.createdBy;
  await assertFails(setDoc(doc(verified, 'orders/team-order-without-actor'), withoutActor));
  await assertFails(setDoc(doc(stranger, 'orders/stranger-store-order'), delivery({ createdBy: 'stranger' })));
  const suspendedTeam = env.authenticatedContext('suspended-team').firestore();
  await assertFails(setDoc(doc(suspendedTeam, 'orders/suspended-team-order'), delivery({ createdBy: 'suspended-team' })));
  await assertFails(updateDoc(doc(suspendedTeam, 'orders/team-created-order'), { status: 'cancelled', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(newDelivery, { status: 'cancelled', updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(verified, 'orders/team-second-order'), delivery()));
  await assertSucceeds(updateDoc(doc(owner, 'orders/team-second-order'), { status: 'cancelled', updatedAt: serverTimestamp() }));
  const legacyOwner = delivery({ customerName: 'Ada Merchant', customerPhone: ownerPhone }); delete legacyOwner.createdBy;
  await assertSucceeds(setDoc(doc(owner, 'orders/legacy-owner-order'), legacyOwner));
  await assertSucceeds(setDoc(doc(owner, 'orders/new-owner-order'), delivery({ createdBy: 'merchant-one' })));
  const customer = env.authenticatedContext('customer').firestore();
  const customerDelivery = delivery({ creatorId: 'customer', creatorRole: 'customer', merchantId: '', createdBy: 'customer', customerName: 'Abena Customer', customerPhone: '+233551234567' });
  await assertSucceeds(setDoc(doc(customer, 'orders/new-customer-order'), customerDelivery));
  const legacyCustomer = { ...customerDelivery }; delete legacyCustomer.createdBy;
  await assertSucceeds(setDoc(doc(customer, 'orders/legacy-customer-order'), legacyCustomer));
  await assertFails(setDoc(doc(customer, 'orders/spoofed-customer-order'), { ...customerDelivery, createdBy: 'teammate' }));
  await assertSucceeds(updateDoc(doc(verified, 'orders/legacy-owner-order'), { status: 'cancelled', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(verified, 'orders/customer-delivery'), { status: 'cancelled', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(other, 'orders/new-owner-order'), { status: 'cancelled', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(verified, 'orders/completed-store-order'), { customerRating: 4, customerRatingComment: 'Careful delivery', customerRatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  assert.equal((await assertSucceeds(getDoc(doc(owner, 'orders/completed-store-order')))).data().customerRating, 4);
  await assertFails(updateDoc(doc(owner, 'orders/completed-store-order'), { customerRating: 5, customerRatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(verified, 'orders/second-completed-store-order'), { customerRating: 6, customerRatingComment: '', customerRatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(other, 'orders/second-completed-store-order'), { customerRating: 5, customerRatingComment: '', customerRatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(verified, 'orders/completed-customer-order'), { customerRating: 5, customerRatingComment: '', customerRatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(owner, 'orders/second-completed-store-order'), { customerRating: 5, customerRatingComment: '', customerRatedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  const revoke = writeBatch(owner);
  revoke.update(doc(owner, invitePath), { status: 'revoked', updatedAt: serverTimestamp() });
  revoke.update(doc(owner, memberPath), { enabled: false, updatedAt: serverTimestamp() });
  await assertSucceeds(revoke.commit());
  // The store is now approved: revocation removes activity access, while
  // its public directory details remain visible to any active account.
  await assertSucceeds(getDoc(doc(verified, 'stores/merchant-one')));
  await assertFails(getDoc(doc(verified, 'orders/store-delivery')));
  await assertFails(setDoc(doc(verified, 'orders/revoked-team-order'), delivery()));
  await assertFails(updateDoc(doc(verified, 'orders/new-owner-order'), { status: 'cancelled', updatedAt: serverTimestamp() }));
  await assertFails(acceptance(verified).commit());
  console.log('PASS store team rules: owner-controlled invitations/settings, verified acceptance, delegated order creation with store identity and actor attribution, team cancellation/rating, cross-store and suspended/revoked denial.');
} finally { await env.cleanup(); }
