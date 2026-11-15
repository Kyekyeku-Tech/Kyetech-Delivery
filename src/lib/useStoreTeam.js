import { useEffect, useRef, useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { auth, db, friendlyFirebaseError } from './firebase';
import { normalizeDocument } from './domain';
import { isActiveAccount } from './admin';
import { acceptedStoreMemberships, cleanTeamEmail, defaultStoreWorkspace, storeInviteId, storeMemberId } from './storeTeam';

export default function useStoreTeam({ user, profile }) {
  const eligible = user?.uid === profile?.id && profile?.role === 'merchant' && isActiveAccount(profile);
  const accountId = eligible ? user.uid : '', email = String(user?.email || profile?.email || '').toLowerCase();
  const [snapshot, setSnapshot] = useState({ accountId: '', members: [], invitations: [], ready: false, error: '' });
  const [availability, setAvailability] = useState({ accountId: '', stores: {} }), [selection, setSelection] = useState(null), [refresh, setRefresh] = useState(0);
  const currentAccount = useRef(accountId), failedStores = useRef(new Set()), failedSources = useRef(false);
  currentAccount.current = accountId;
  const scoped = snapshot.accountId === accountId ? snapshot : { members: [], invitations: [], ready: false, error: '' };
  const members = scoped.members, invitations = scoped.invitations;
  const accepted = scoped.ready ? acceptedStoreMemberships({ userId: accountId, members, invitations }) : [];
  const storeIds = [...new Set(accepted.map(member => member.storeId))].filter(id => id !== accountId), storeKey = storeIds.slice().sort().join('|');
  const stores = availability.accountId === accountId ? availability.stores : {};
  const loading = Boolean(accountId && (!scoped.ready || storeIds.some(id => !stores[id]?.ready)));
  const unavailableStoreIds = storeIds.filter(id => stores[id]?.ready && !stores[id].available);
  const storeId = !accountId || loading || scoped.error ? '' : defaultStoreWorkspace({ userId: accountId, members, invitations, selection, unavailableStoreIds });
  const canManageStore = Boolean(accountId && !loading && (storeId === accountId || accepted.some(member => member.storeId === storeId && !unavailableStoreIds.includes(storeId))));
  const accessUnavailable = Boolean(accountId && !loading && !storeId);
  const error = scoped.error || (accessUnavailable ? 'Your invited store is unavailable or your team access has been removed. Ask the store owner to check your access.' : '');
  useEffect(() => {
    setSnapshot({ accountId, members: [], invitations: [], ready: false, error: '' });
    failedSources.current = false;
    if (!accountId) return;
    if (!db) { setSnapshot({ accountId, members: [], invitations: [], ready: true, error: 'Store access could not be loaded. Refresh the page to reconnect.' }); return; }
    let active = true;
    const records = {}, ready = new Set(), sources = [
      ['members-own', 'storeMembers', 'userId', accountId], ['members-team', 'storeMembers', 'storeId', accountId],
      ['invitations-in', 'storeInvites', 'email', email], ['invitations-out', 'storeInvites', 'ownerId', accountId],
    ];
    function publish() {
      if (!active || currentAccount.current !== accountId) return;
      const merged = category => [...new Map(sources.filter(source => source[1] === category).flatMap(source => records[source[0]] || []).map(record => [record.id, record])).values()];
      setSnapshot({ accountId, members: merged('storeMembers'), invitations: merged('storeInvites'), ready: ready.size === sources.length, error: failedSources.current ? 'Store team access could not be loaded. Check your connection and try again.' : '' });
    }
    const stops = sources.map(([key, category, field, value]) => onSnapshot(query(collection(db, category), where(field, '==', value)), { includeMetadataChanges: true }, result => {
      if (!active || currentAccount.current !== accountId) return;
      records[key] = result.docs.map(normalizeDocument);
      if (!result.metadata?.fromCache) ready.add(key);
      publish();
    }, () => {
      if (!active || currentAccount.current !== accountId) return;
      records[key] = []; ready.add(key); failedSources.current = true; publish();
    }));
    return () => { active = false; stops.forEach(stop => stop()); };
  }, [accountId, email, refresh]);

  useEffect(() => {
    failedStores.current = new Set();
    if (!db || !accountId || !storeKey) { setAvailability({ accountId, stores: {} }); return; }
    let active = true;
    const ids = storeKey.split('|');
    setAvailability({ accountId, stores: Object.fromEntries(ids.map(id => [id, { ready: false, available: false }])) });
    const stops = ids.map(id => onSnapshot(doc(db, 'stores', id), { includeMetadataChanges: true }, result => {
      if (!active || currentAccount.current !== accountId) return;
      const data = result.exists() ? result.data() : null;
      failedStores.current.delete(id);
      setAvailability(value => ({ accountId, stores: { ...(value.accountId === accountId ? value.stores : {}), [id]: { ready: Boolean((value.accountId === accountId && value.stores[id]?.ready) || !result.metadata?.fromCache), available: Boolean(data && data.ownerId === id && isActiveAccount(data)) } } }));
    }, () => {
      if (!active || currentAccount.current !== accountId) return;
      failedStores.current.add(id);
      setAvailability(value => ({ accountId, stores: { ...(value.accountId === accountId ? value.stores : {}), [id]: { ready: true, available: false } } }));
    }));
    return () => { active = false; stops.forEach(stop => stop()); };
  }, [accountId, storeKey, refresh]);

  useEffect(() => {
    function retry() { if (failedSources.current || failedStores.current.size) setRefresh(value => value + 1); }
    window.addEventListener('online', retry); window.addEventListener('focus', retry);
    return () => { window.removeEventListener('online', retry); window.removeEventListener('focus', retry); };
  }, []);

  function retry() { setRefresh(value => value + 1); }

  function account() {
    if (!accountId || auth?.currentUser?.uid !== accountId || !db) throw new Error('Sign in with an active merchant account.');
    return auth.currentUser;
  }
  async function invite(emailValue) {
    const actor = account(), email = cleanTeamEmail(emailValue);
    if (email === actor.email?.toLowerCase()) throw new Error('You already own this store. Enter your team member’s email.');
    const id = await storeInviteId(actor.uid, email);
    await runTransaction(db, async transaction => {
      const store = await transaction.get(doc(db, 'stores', actor.uid)), existing = await transaction.get(doc(db, 'storeInvites', id));
      if (!store.exists() || store.data().ownerId !== actor.uid) throw new Error('Set up your own store before adding a team member.');
      if (existing.exists() && existing.data().status !== 'revoked') throw new Error('This email already has a store invitation or team access.');
      transaction.set(doc(db, 'storeInvites', id), { ownerId: actor.uid, storeId: actor.uid, storeName: store.data().name, email, status: 'pending', memberId: '', createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp() });
    });
  }
  async function verifyEmail() {
    const actor = account();
    await actor.reload();
    if (!actor.emailVerified) await sendEmailVerification(actor);
  }
  async function accept(invitationId) {
    const actor = account();
    await actor.reload();
    await actor.getIdToken(true);
    if (!actor.emailVerified) throw new Error('Verify your email first, then return here and accept the invitation.');
    const chosen = await runTransaction(db, async transaction => {
      const ref = doc(db, 'storeInvites', invitationId), invitation = await transaction.get(ref);
      if (!invitation.exists() || invitation.data().status !== 'pending' || invitation.data().email !== actor.email.toLowerCase()) throw new Error('This invitation is no longer available for your email.');
      const data = invitation.data(), memberRef = doc(db, 'storeMembers', storeMemberId(data.storeId, actor.uid)), member = await transaction.get(memberRef);
      transaction.update(ref, { status: 'accepted', memberId: actor.uid, updatedAt: serverTimestamp() });
      transaction.set(memberRef, { storeId: data.storeId, userId: actor.uid, email: data.email, name: profile.name, inviteId: invitationId, enabled: true, createdAt: member.exists() ? member.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp() });
      return { storeId: data.storeId, invitation: { ...data, id: invitationId, status: 'accepted', memberId: actor.uid, updatedAt: Date.now() }, member: { id: storeMemberId(data.storeId, actor.uid), storeId: data.storeId, userId: actor.uid, email: data.email, name: profile.name, inviteId: invitationId, enabled: true, updatedAt: Date.now() } };
    });
    if (currentAccount.current !== actor.uid) return;
    setSnapshot(value => value.accountId === actor.uid ? { ...value, members: [...value.members.filter(member => member.id !== chosen.member.id), chosen.member], invitations: [...value.invitations.filter(invite => invite.id !== chosen.invitation.id), chosen.invitation] } : value);
    setSelection({ userId: actor.uid, storeId: chosen.storeId });
  }
  async function revoke(invitationId) {
    const actor = account();
    await runTransaction(db, async transaction => {
      const ref = doc(db, 'storeInvites', invitationId), invitation = await transaction.get(ref);
      if (!invitation.exists() || invitation.data().ownerId !== actor.uid) throw new Error('Only the store owner can remove team access.');
      const data = invitation.data();
      const memberRef = data.memberId ? doc(db, 'storeMembers', storeMemberId(data.storeId, data.memberId)) : null;
      const member = memberRef ? await transaction.get(memberRef) : null;
      transaction.update(ref, { status: 'revoked', updatedAt: serverTimestamp() });
      if (member?.exists()) transaction.update(memberRef, { enabled: false, updatedAt: serverTimestamp() });
    });
  }
  return { storeId, members, invitations, loading, canManageStore, accessUnavailable, error, retry, invite, accept, revoke, verifyEmail, friendlyError: friendlyFirebaseError };
}
