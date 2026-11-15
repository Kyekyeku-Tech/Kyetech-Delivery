// Verification uses demo projects on the local Firestore emulator only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../.verification/sms-tools/package.json', import.meta.url));
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc, serverTimestamp } = require('firebase/firestore');
const env = await initializeTestEnvironment({ projectId: 'demo-kyetech-listings', firestore: { host: '127.0.0.1', port: 8080, rules: await readFile('firestore.rules', 'utf8') } });
const listing = (patch = {}) => ({ kind: 'product', name: 'Fresh milk', category: 'Groceries', description: 'One litre bottle', price: 24.5, imageUrl: '/images/store-placeholder.svg', available: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...patch });
const seedListing = (patch = {}) => listing({ createdAt: new Date('2026-11-14T00:00:00Z'), updatedAt: new Date('2026-11-14T00:00:00Z'), ...patch });
try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const id of ['merchant-one', 'merchant-two', 'pending-store', 'rejected-store', 'suspended-store', 'closed-store', 'inactive-owner', 'team-one', 'revoked-team', 'suspended-team', 'foreign-team']) {
      await setDoc(doc(db, 'users', id), { role: 'merchant', accountStatus: ['inactive-owner', 'suspended-team'].includes(id) ? 'suspended' : 'active' });
    }
    await setDoc(doc(db, 'users/customer-one'), { role: 'customer', accountStatus: 'active' });
    await setDoc(doc(db, 'users/customer-suspended'), { role: 'customer', accountStatus: 'suspended' });
    for (const id of ['merchant-one', 'merchant-two', 'pending-store', 'rejected-store', 'suspended-store', 'closed-store', 'inactive-owner']) {
      await setDoc(doc(db, 'stores', id), { ownerId: id, name: id, accountStatus: id === 'suspended-store' ? 'suspended' : 'active', approvalStatus: id === 'pending-store' ? 'pending' : id === 'rejected-store' ? 'rejected' : 'approved', open: id !== 'closed-store' });
      await setDoc(doc(db, 'stores', id, 'listings', 'available-one'), seedListing());
      await setDoc(doc(db, 'stores', id, 'listings', 'unavailable-one'), seedListing({ available: false }));
    }
    for (const [id, enabled, status, storeId] of [['team-one', true, 'accepted', 'merchant-one'], ['revoked-team', false, 'revoked', 'merchant-one'], ['suspended-team', true, 'accepted', 'merchant-one'], ['foreign-team', true, 'accepted', 'merchant-two']]) {
      const inviteId = storeId + '_' + id;
      await setDoc(doc(db, 'storeInvites', inviteId), { storeId, ownerId: storeId, status });
      await setDoc(doc(db, 'storeMembers', storeId + '_' + id), { storeId, userId: id, enabled, inviteId });
    }
  });
  const owner = env.authenticatedContext('merchant-one').firestore();
  const otherOwner = env.authenticatedContext('merchant-two').firestore();
  const team = env.authenticatedContext('team-one').firestore();
  const customer = env.authenticatedContext('customer-one').firestore();
  const publicItems = db => query(collection(db, 'stores/merchant-one/listings'), where('available', '==', true));
  const milk = doc(owner, 'stores/merchant-one/listings/new-product');
  await assertSucceeds(setDoc(milk, listing()));
  await assertSucceeds(updateDoc(milk, { kind: 'menu', name: 'Jollof with chicken', category: 'Lunch', price: 35.75, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(milk, { available: false, updatedAt: serverTimestamp() }));
  await assertSucceeds(getDoc(milk));
  assert.equal((await getDoc(milk)).data().price, 35.75);
  assert.equal((await getDoc(milk)).data().kind, 'menu');
  await assertSucceeds(getDocs(collection(owner, 'stores/merchant-one/listings')));
  await assertSucceeds(getDocs(collection(team, 'stores/merchant-one/listings')));
  await assertSucceeds(getDoc(doc(team, 'stores/merchant-one/listings/unavailable-one')));
  const teamProduct = doc(team, 'stores/merchant-one/listings/team-product');
  await assertSucceeds(setDoc(teamProduct, listing()));
  await assertSucceeds(updateDoc(teamProduct, { kind: 'menu', name: 'Team lunch special', price: 45, available: false, updatedAt: serverTimestamp() }));
  assert.equal((await assertSucceeds(getDoc(teamProduct))).data().price, 45);
  await assertSucceeds(updateDoc(teamProduct, { available: true, updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(teamProduct));
  await assertFails(setDoc(doc(otherOwner, 'stores/merchant-one/listings/foreign-product'), listing()));
  await assertFails(updateDoc(doc(otherOwner, 'stores/merchant-one/listings/available-one'), { price: 1, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(otherOwner, 'stores/merchant-one/listings/available-one')));
  await assertSucceeds(getDoc(doc(customer, 'stores/merchant-one/listings/available-one')));
  await assertFails(getDoc(doc(customer, 'stores/merchant-one/listings/unavailable-one')));
  const available = await assertSucceeds(getDocs(publicItems(customer)));
  assert.deepEqual(available.docs.map(item => item.id), ['available-one']);
  await assertFails(getDocs(collection(customer, 'stores/merchant-one/listings')));
  await assertFails(setDoc(doc(customer, 'stores/merchant-one/listings/customer-product'), listing()));
  await assertFails(getDocs(publicItems(env.unauthenticatedContext().firestore())));
  await assertFails(getDocs(publicItems(env.authenticatedContext('customer-suspended').firestore())));
  for (const id of ['pending-store', 'rejected-store', 'suspended-store', 'inactive-owner']) {
    await assertFails(getDoc(doc(customer, 'stores', id, 'listings', 'available-one')));
    await assertFails(getDocs(query(collection(customer, 'stores', id, 'listings'), where('available', '==', true))));
  }
  await assertSucceeds(getDoc(doc(customer, 'stores/closed-store/listings/available-one')));
  for (const id of ['pending-store', 'rejected-store']) {
    const db = env.authenticatedContext(id).firestore();
    await assertSucceeds(setDoc(doc(db, 'stores', id, 'listings', 'draft-product'), listing()));
  }
  for (const id of ['suspended-store', 'inactive-owner']) {
    const db = env.authenticatedContext(id).firestore();
    await assertFails(setDoc(doc(db, 'stores', id, 'listings', 'blocked-product'), listing()));
  }
  for (const id of ['revoked-team', 'suspended-team', 'foreign-team']) {
    const db = env.authenticatedContext(id).firestore();
    await assertFails(getDocs(collection(db, 'stores/merchant-one/listings')));
    await assertFails(setDoc(doc(db, 'stores/merchant-one/listings/forbidden-team-product'), listing()));
    await assertFails(updateDoc(doc(db, 'stores/merchant-one/listings/available-one'), { price: 1, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(db, 'stores/merchant-one/listings/available-one')));
  }
  for (const [index, patch] of [
    { kind: 'other' }, { name: '' }, { name: 'a'.repeat(101) }, { category: 'a'.repeat(61) }, { description: 'a'.repeat(1001) },
    { price: -1 }, { price: 100000.01 }, { price: 1.001 }, { price: '25' }, { available: 'yes' },
    { imageUrl: 'javascript:alert(1)' }, { imageUrl: 'a'.repeat(2001) }, { ownerId: 'merchant-one' }, { storeId: 'merchant-one' },
    { extra: true }, { createdAt: new Date(0) }, { updatedAt: new Date(0) },
  ].entries()) {
    await assertFails(setDoc(doc(owner, 'stores/merchant-one/listings/invalid-' + index), listing(patch)));
  }
  await assertFails(updateDoc(milk, { createdAt: new Date(0), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(milk, { updatedAt: new Date(0) }));
  await assertSucceeds(setDoc(doc(owner, 'stores/merchant-one/listings/free-item'), listing({ price: 0, imageUrl: '', description: '' })));
  await assertSucceeds(setDoc(doc(owner, 'stores/merchant-one/listings/max-price'), listing({ price: 100000 })));
  await assertSucceeds(deleteDoc(milk));
  await assertSucceeds(updateDoc(doc(owner, 'stores/merchant-one/listings/available-one'), { available: false, updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(customer, 'stores/merchant-one/listings/available-one')));
  assert.equal((await assertSucceeds(getDocs(publicItems(customer)))).size, 2);
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'storeInvites/merchant-one_team-one'), { status: 'revoked' });
  });
  await assertFails(getDocs(collection(team, 'stores/merchant-one/listings')));
  await assertFails(setDoc(doc(team, 'stores/merchant-one/listings/revoked-product'), listing()));
  await assertFails(updateDoc(doc(team, 'stores/merchant-one/listings/free-item'), { price: 1, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(team, 'stores/merchant-one/listings/free-item')));
  console.log('PASS store listing rules: owner and accepted-team validated product/menu CRUD, immutable creation time, available-only customer queries, store/owner moderation, closed-store browsing and revoked/suspended/foreign write denial.');
} finally { await env.cleanup(); }
