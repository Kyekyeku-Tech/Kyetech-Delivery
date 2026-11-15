import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageStoreListings, cleanStoreListing, filterStoreListings, normalizeStoreListingRecord } from '../src/lib/storeCatalog.js';

const valid = { kind: 'product', name: ' Fresh tomatoes ', category: ' Groceries ', description: ' Ripe local tomatoes ', price: '12.50', imageUrl: '', available: true };

test('store listings keep a clean fixed schema and exact GHS prices', () => {
  assert.deepEqual(cleanStoreListing({ ...valid, ownerId: 'injected', storeId: 'injected' }), {
    kind: 'product', name: 'Fresh tomatoes', category: 'Groceries', description: 'Ripe local tomatoes', price: 12.5, imageUrl: '', available: true,
  });
  assert.equal(cleanStoreListing({ ...valid, kind: 'menu', price: '0' }).price, 0);
  assert.equal(cleanStoreListing({ ...valid, price: '100000' }).price, 100000);
  for (const patch of [{ kind: 'other' }, { name: ' ' }, { category: '' }, { name: 'a'.repeat(101) }, { category: 'a'.repeat(61) }, { description: 'a'.repeat(1001) }, { price: '' }, { price: null }, { price: '-1' }, { price: '100000.01' }, { price: '1.001' }, { price: Infinity }, { available: 'true' }, { imageUrl: 'javascript:alert(1)' }]) assert.throws(() => cleanStoreListing({ ...valid, ...patch }));
});

test('catalog management requires the active owner or an accepted member of the selected active store', () => {
  const store = { id: 'store-one', ownerId: 'merchant-one', accountStatus: 'active', approvalStatus: 'pending' };
  const owner = { id: store.ownerId, role: 'merchant', accountStatus: 'active' };
  assert.equal(canManageStoreListings(owner, store), true, 'Owners can prepare listings before approval.');
  for (const profile of [{ ...owner, id: 'team-member' }, { ...owner, role: 'customer' }, { ...owner, accountStatus: 'suspended' }]) assert.equal(canManageStoreListings(profile, store), false);
  assert.equal(canManageStoreListings(owner, { ...store, accountStatus: 'suspended' }), false);
  const profile = { ...owner, id: 'team-one' };
  const membership = { storeId: store.id, members: [{ userId: profile.id, storeId: store.id, enabled: true, inviteId: 'invite-one' }], invitations: [{ id: 'invite-one', storeId: store.id, ownerId: store.ownerId, memberId: profile.id, status: 'accepted' }] };
  assert.equal(canManageStoreListings(profile, store, membership), true);
  for (const patch of [{ storeId: 'other-store' }, { members: [{ ...membership.members[0], enabled: false }] }, { members: [{ ...membership.members[0], userId: 'foreign-member' }] }, { invitations: [{ ...membership.invitations[0], status: 'pending' }] }, { invitations: [{ ...membership.invitations[0], status: 'revoked' }] }, { invitations: [{ ...membership.invitations[0], memberId: 'foreign-member' }] }, { invitations: [{ ...membership.invitations[0], ownerId: 'foreign-owner' }] }]) assert.equal(canManageStoreListings(profile, store, { ...membership, ...patch }), false);
  assert.equal(canManageStoreListings({ ...profile, accountStatus: 'suspended' }, store, membership), false);
});

test('listing filters combine search terms, type, category and availability without mutating records', () => {
  const items = [{ id: 'b', name: 'Waakye bowl', category: 'Meals', description: 'Rice and beans', kind: 'menu', available: true }, { id: 'a', name: 'Bottled water', category: 'Drinks', description: 'Cool still water', kind: 'product', available: true }, { id: 'c', name: 'Jollof rice', category: 'Meals', description: 'With chicken', kind: 'menu', available: false }];
  assert.deepEqual(filterStoreListings(items, { search: 'BEANS rice', kind: 'menu', category: 'Meals', availability: 'available' }).map(item => item.id), ['b']);
  assert.deepEqual(filterStoreListings(items, { availability: 'unavailable' }).map(item => item.id), ['c']);
  assert.deepEqual(filterStoreListings(items).map(item => item.id), ['a', 'c', 'b']);
  assert.deepEqual(items.map(item => item.id), ['b', 'a', 'c']);
});

test('malformed or imported catalog documents cannot crash listings or publish invalid prices and images', () => {
  const record = { id: 'listing-one', ...cleanStoreListing(valid), createdAt: { seconds: 100 }, updatedAt: 200000, extraPrivateField: 'omit' };
  const clean = normalizeStoreListingRecord(record);
  assert.equal(clean.createdAt, 100000);
  assert.equal(clean.extraPrivateField, undefined);
  for (const patch of [{ id: '' }, { id: 'bad/path' }, { name: undefined }, { name: 123 }, { category: null }, { description: {} }, { kind: 'unsupported' }, { price: '12.50' }, { price: NaN }, { price: -1 }, { price: 0.001 }, { imageUrl: 'javascript:alert(1)' }, { available: 'true' }]) assert.equal(normalizeStoreListingRecord({ ...record, ...patch }), null);
  assert.deepEqual(filterStoreListings([null, {}, { ...clean, name: undefined }, clean]).map(item => item.id), ['listing-one']);
});
