import { useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { db } from './firebase';
import { usePlatform } from '../context/PlatformContext';
import { normalizeDocument } from './domain';
import { isActiveAccount } from './admin';
import { acceptedStoreCatalogMember, canManageStoreListings, cleanStoreListing, normalizeStoreListingRecord } from './storeCatalog';
import { storeMemberId } from './storeTeam';

function documentId(value) {
  if (typeof value !== 'string' || !value || value.length > 128 || value.includes('/')) throw new Error('This item is no longer available.');
  return value;
}

export default function useStoreCatalog(store) {
  const { user, profile, storeTeam } = usePlatform();
  const manager = canManageStoreListings(profile, store, storeTeam);
  const team = profile?.role === 'merchant' && isActiveAccount(store) && acceptedStoreCatalogMember(profile, store, storeTeam);
  const publicStore = store?.approvalStatus === 'approved' && isActiveAccount(store);
  const eligible = Boolean(db && user?.uid === profile?.id && isActiveAccount(profile) && store?.id && (manager || team || publicStore));
  const privateView = Boolean(manager || team);
  const scope = eligible ? [user.uid, store.id, privateView ? 'store' : 'available'].join(':') : '';
  const current = useRef(null); current.current = { scope, canManage: manager, storeId: store?.id, userId: user?.uid };
  const [state, setState] = useState({ scope: '', items: [], loading: false, error: '' });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setState({ scope, items: [], loading: Boolean(scope), error: '' });
    if (!scope) return;
    let active = true;
    const source = collection(db, 'stores', store.id, 'listings');
    const stop = onSnapshot(privateView ? source : query(source, where('available', '==', true)), snapshot => {
      if (active && current.current.scope === scope) setState({ scope, items: snapshot.docs.map(normalizeDocument).map(normalizeStoreListingRecord).filter(Boolean), loading: false, error: '' });
    }, () => {
      if (active && current.current.scope === scope) setState({ scope, items: [], loading: false, error: 'The store’s listings could not be loaded. Please try again.' });
    });
    return () => { active = false; stop(); };
  }, [scope, revision]);

  function session() {
    if (!db || !current.current.scope || !current.current.canManage) throw new Error('Only the store owner or an accepted team member can change these listings.');
    return { ...current.current };
  }
  async function mutate(id, operation, payload) {
    const account = session();
    const ref = id ? doc(db, 'stores', account.storeId, 'listings', documentId(id)) : doc(collection(db, 'stores', account.storeId, 'listings'));
    try {
      await runTransaction(db, async transaction => {
        const storeSnapshot = await transaction.get(doc(db, 'stores', account.storeId));
        const actorSnapshot = await transaction.get(doc(db, 'users', account.userId));
        if (!storeSnapshot.exists() || !isActiveAccount(storeSnapshot.data()) || !actorSnapshot.exists() || actorSnapshot.data().role !== 'merchant' || !isActiveAccount(actorSnapshot.data())) throw new Error('An active store and merchant account are required to change listings.');
        if (storeSnapshot.data().ownerId !== account.userId) {
          const member = await transaction.get(doc(db, 'storeMembers', storeMemberId(account.storeId, account.userId)));
          const data = member.exists() ? member.data() : null;
          if (!data || data.enabled !== true || data.storeId !== account.storeId || data.userId !== account.userId || typeof data.inviteId !== 'string' || !data.inviteId || data.inviteId.length > 256 || data.inviteId.includes('/')) throw new Error('Your store team access is no longer active.');
          const invite = await transaction.get(doc(db, 'storeInvites', data.inviteId));
          const invitation = invite.exists() ? invite.data() : null;
          if (!invitation || invitation.status !== 'accepted' || invitation.storeId !== account.storeId || invitation.ownerId !== storeSnapshot.data().ownerId || invitation.memberId !== account.userId) throw new Error('Accept your store invitation before changing listings.');
        }
        const existing = id ? await transaction.get(ref) : null;
        if (current.current.scope !== account.scope || !current.current.canManage) throw new Error('Your store workspace changed. Open the item again.');
        if (id && !existing.exists()) throw new Error('This item has already been removed.');
        if (operation === 'delete') transaction.delete(ref);
        else if (operation === 'availability') transaction.update(ref, { available: payload, updatedAt: serverTimestamp() });
        else transaction.set(ref, { ...payload, createdAt: existing ? existing.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp() });
      });
      return ref.id;
    } catch (cause) {
      if (cause.code === 'permission-denied') throw new Error('You no longer have permission to change this store’s listings.');
      if (cause.code === 'unavailable') throw new Error('Check your connection and try saving again.');
      throw cause;
    }
  }

  return {
    items: state.scope === scope ? state.items : [], loading: Boolean(scope) && (state.scope !== scope || state.loading),
    error: state.scope === scope ? state.error : '', canManage: manager && eligible, canRead: eligible,
    retry: () => setRevision(value => value + 1), save: (input, id) => mutate(id, 'save', cleanStoreListing(input)),
    remove: id => mutate(id, 'delete'), setAvailable: (id, available) => {
      if (typeof available !== 'boolean') return Promise.reject(new Error('Choose whether this item is available.'));
      return mutate(id, 'availability', available);
    },
  };
}
