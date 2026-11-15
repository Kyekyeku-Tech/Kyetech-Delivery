import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedStoreMemberships, cleanTeamEmail, defaultStoreWorkspace, storeInviteId, storeMemberId } from '../src/lib/storeTeam.js';
test('Team emails normalize, and invalid account addresses are rejected', () => {
  assert.equal(cleanTeamEmail(' Teammate@Example.COM '), 'teammate@example.com');
  for (const email of ['', 'not-an-email', 'a/b@example.com', 'a @example.com', 'x'.repeat(250) + '@example.com']) assert.throws(() => cleanTeamEmail(email));
});
test('Team access and invitation IDs are stable and scoped to each store', async () => {
  assert.equal(storeMemberId('store-one', 'user-one'), 'store-one_user-one');
  assert.throws(() => storeMemberId('../store', 'user-one'));
  const first = await storeInviteId('store-one', 'Team@Example.com');
  assert.match(first, /^store-one_[a-f0-9]{64}$/);
  assert.equal(first, await storeInviteId('store-one', 'team@example.com'));
  assert.notEqual(first, await storeInviteId('store-two', 'team@example.com'));
});

function access(storeId, updatedAt = 10, userId = 'team-user') {
  const inviteId = 'invite-' + storeId;
  return {
    member: { id: storeMemberId(storeId, userId), storeId, userId, inviteId, email: 'team@example.com', enabled: true, updatedAt },
    invitation: { id: inviteId, storeId, ownerId: storeId, memberId: userId, email: 'team@example.com', status: 'accepted', updatedAt },
  };
}

test('Automatic workspace requires accepted invitation and enabled membership for this account', () => {
  const one = access('store-one'), two = access('store-two'), three = access('store-three'), foreign = access('store-other', 50, 'someone-else');
  const members = [one.member, two.member, { ...three.member, enabled: false }, foreign.member];
  const invitations = [one.invitation, { ...two.invitation, status: 'pending', memberId: '' }, { ...three.invitation, status: 'revoked' }, foreign.invitation];
  assert.deepEqual(acceptedStoreMemberships({ userId: 'team-user', members, invitations }), [one.member]);
  assert.deepEqual(acceptedStoreMemberships({ userId: 'team-user', members: [one.member], invitations: [{ ...one.invitation, memberId: 'someone-else' }] }), []);
  assert.deepEqual(acceptedStoreMemberships({ userId: 'team-user', members: [one.member], invitations: [{ ...one.invitation, ownerId: 'someone-else' }] }), []);
  assert.equal(defaultStoreWorkspace({ userId: 'team-user', members, invitations }), 'store-one');
});

test('Reload chooses newest invited store, while a valid newly accepted selection wins', () => {
  const one = access('store-one', { seconds: 10 }), two = access('store-two', 20_000);
  const input = { userId: 'team-user', members: [one.member, two.member], invitations: [one.invitation, two.invitation] };
  const before = JSON.stringify(input);
  assert.equal(defaultStoreWorkspace(input), 'store-two');
  assert.equal(defaultStoreWorkspace({ ...input, selection: { userId: 'team-user', storeId: 'store-one' } }), 'store-one');
  assert.equal(defaultStoreWorkspace({ ...input, selection: { userId: 'other-account', storeId: 'store-one' } }), 'store-two');
  assert.equal(defaultStoreWorkspace({ ...input, selection: { userId: 'team-user', storeId: 'missing-store' } }), 'store-two');
  assert.equal(JSON.stringify(input), before, 'Sorting workspace candidates cannot mutate subscription records.');
});

test('Removed or suspended invited stores use another accessible store and never open a personal workspace', () => {
  const one = access('store-one', 10), two = access('store-two', 20);
  const input = { userId: 'team-user', members: [one.member, two.member], invitations: [one.invitation, two.invitation], selection: { userId: 'team-user', storeId: 'store-two' } };
  assert.equal(defaultStoreWorkspace({ ...input, unavailableStoreIds: ['store-two'] }), 'store-one');
  assert.equal(defaultStoreWorkspace({ ...input, unavailableStoreIds: ['store-one', 'store-two'] }), '');
  assert.equal(defaultStoreWorkspace({ ...input, members: [{ ...one.member, enabled: false }, { ...two.member, enabled: false }], invitations: input.invitations.map(invite => ({ ...invite, status: 'revoked' })) }), '');
  assert.equal(defaultStoreWorkspace({ userId: 'other-account', members: input.members, invitations: input.invitations }), 'other-account');
  assert.equal(defaultStoreWorkspace({ userId: '' }), '');
  assert.equal(defaultStoreWorkspace({ userId: 'new-owner' }), 'new-owner');
});

test('Membership and invitation streams arriving separately cannot open an empty personal store', () => {
  const one = access('store-one');
  assert.equal(defaultStoreWorkspace({ userId: 'team-user', members: [one.member], invitations: [{ ...one.invitation, status: 'pending', memberId: '' }] }), '');
  assert.equal(defaultStoreWorkspace({ userId: 'team-user', members: [one.member], invitations: [] }), '');
  assert.equal(defaultStoreWorkspace({ userId: 'team-user', members: [{ ...one.member, userId: 'foreign-user' }], invitations: [] }), 'team-user');
});
