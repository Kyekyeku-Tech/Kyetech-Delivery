import { timestampMillis } from './domain.js';

export function cleanTeamEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(email)) throw new Error('Enter a valid email address for your team member.');
  return email;
}

export function storeMemberId(storeId, userId) {
  if (![storeId, userId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value))) throw new Error('Choose a valid store account.');
  return storeId + '_' + userId;
}

export async function storeInviteId(storeId, email) {
  storeMemberId(storeId, 'invite');
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cleanTeamEmail(email)));
  return storeId + '_' + [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function acceptedStoreMemberships({ userId, members = [], invitations = [] }) {
  if (!userId) return [];
  const invites = new Map(invitations.map(invite => [invite.id, invite]));
  return members.filter(member => {
    const invite = invites.get(member.inviteId);
    return member.userId === userId && member.enabled === true && typeof member.storeId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(member.storeId) && invite?.status === 'accepted' && invite.memberId === userId && invite.storeId === member.storeId && invite.ownerId === member.storeId;
  }).sort((a, b) => {
    const updated = member => Math.max(timestampMillis(member.updatedAt), timestampMillis(invites.get(member.inviteId)?.updatedAt), timestampMillis(member.createdAt));
    return updated(b) - updated(a) || a.storeId.localeCompare(b.storeId);
  });
}

export function defaultStoreWorkspace({ userId, members = [], invitations = [], selection, unavailableStoreIds = [] }) {
  if (!userId) return '';
  const unavailable = new Set(unavailableStoreIds);
  const memberships = acceptedStoreMemberships({ userId, members, invitations });
  const accepted = memberships.filter(member => !unavailable.has(member.storeId));
  const selected = selection?.userId === userId && accepted.find(member => member.storeId === selection.storeId);
  const knownSharedMembership = members.some(member => member.userId === userId && member.storeId !== userId && typeof member.storeId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(member.storeId));
  const hadSharedAccess = invitations.some(invite => invite.memberId === userId && invite.ownerId === invite.storeId && invite.storeId !== userId && typeof invite.storeId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(invite.storeId) && ['accepted', 'revoked'].includes(invite.status));
  return selected?.storeId || accepted[0]?.storeId || (knownSharedMembership || hadSharedAccess ? '' : userId);
}
