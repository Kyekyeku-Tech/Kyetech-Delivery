import { useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { customerSmsReadKey, loadCustomerSmsReads, saveCustomerSmsReads } from './customerSmsReads';

export default function useSmsReadReceipts({ accountId, messages }) {
  const cacheKey = customerSmsReadKey(db?.app?.options?.projectId, accountId);
  const [cached, setCached] = useState(() => ({ accountId, ids: accountId ? loadCustomerSmsReads(cacheKey) : [] }));
  const [saved, setSaved] = useState({ accountId: '', ids: [] });
  const pending = useRef(new Map()), current = useRef(null), observedAccount = useRef('');
  const eligibleMessages = messages;
  const eligibleIds = new Set(eligibleMessages.map(item => item.id));
  const cachedIds = cached.accountId === accountId ? cached.ids : accountId ? loadCustomerSmsReads(cacheKey) : [];
  const savedIds = new Set(saved.accountId === accountId ? saved.ids : []);
  current.current = { accountId, eligibleIds, cachedIds, savedIds };
  const readIds = new Set([...cachedIds, ...savedIds]);

  function remember(ids) {
    const state = current.current;
    if (!accountId || state.accountId !== accountId) return { persisted: false };
    const result = saveCustomerSmsReads(cacheKey, [...state.cachedIds, ...ids]);
    state.cachedIds = result.ids;
    setCached({ accountId, ids: result.ids });
    return result;
  }

  function syncRead(id) {
    const state = current.current;
    if (!db || state.accountId !== accountId || !state.eligibleIds.has(id)) return Promise.reject(new Error('This SMS is no longer available.'));
    if (state.savedIds.has(id)) return Promise.resolve();
    const key = accountId + ':' + id;
    if (pending.current.has(key)) return pending.current.get(key);
    const task = Promise.resolve().then(() => {
      if (current.current.accountId !== accountId || !current.current.eligibleIds.has(id)) throw new Error('This SMS is no longer available.');
      return setDoc(doc(db, 'users', accountId, 'smsReads', id), { readAt: serverTimestamp() });
    }).then(() => {
      if (current.current.accountId !== accountId) return;
      current.current.savedIds.add(id);
      setSaved(value => ({ accountId, ids: [...new Set([...(value.accountId === accountId ? value.ids : []), id])] }));
      remember([id]);
    }).finally(() => pending.current.delete(key));
    pending.current.set(key, task);
    return task;
  }

  useEffect(() => {
    setCached({ accountId, ids: accountId ? loadCustomerSmsReads(cacheKey) : [] });
    setSaved({ accountId: '', ids: [] });
    observedAccount.current = '';
    if (!accountId) return;
    let active = true, listenerFailed = false, stop = () => {};
    const syncPending = () => {
      if (!active || current.current.accountId !== accountId) return;
      for (const id of current.current.cachedIds) {
        if (current.current.eligibleIds.has(id) && !current.current.savedIds.has(id)) syncRead(id).catch(() => {});
      }
    };
    function subscribe() {
      if (!db) return;
      stop();
      listenerFailed = false;
      let synced = false;
      stop = onSnapshot(collection(db, 'users', accountId, 'smsReads'), snapshot => {
        if (!active || current.current.accountId !== accountId) return;
        // A pending local Firestore write is not a confirmed server receipt.
        const ids = snapshot.docs.filter(item => !item.metadata?.hasPendingWrites).map(item => item.id);
        ids.forEach(id => current.current.savedIds.add(id));
        setSaved(value => ({ accountId, ids: [...new Set([...(value.accountId === accountId ? value.ids : []), ...ids])] }));
        remember(ids);
        if (!synced && !snapshot.metadata?.fromCache) { synced = true; observedAccount.current = accountId; syncPending(); }
      }, () => { listenerFailed = true; syncPending(); });
    }
    function resume() { if (listenerFailed) subscribe(); syncPending(); }
    function storageChanged(event) {
      if (event.key !== cacheKey || current.current.accountId !== accountId) return;
      remember(loadCustomerSmsReads(cacheKey));
      syncPending();
    }
    subscribe();
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('storage', storageChanged);
    return () => {
      active = false; stop();
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('storage', storageChanged);
    };
  }, [accountId, cacheKey]);

  useEffect(() => {
    if (!accountId || observedAccount.current !== accountId) return;
    for (const id of current.current.cachedIds) {
      if (current.current.eligibleIds.has(id) && !current.current.savedIds.has(id)) syncRead(id).catch(() => {});
    }
  }, [accountId, messages]);

  function markRead(id) {
    if (!accountId || typeof id !== 'string' || !id || id.includes('/') || !current.current.eligibleIds.has(id) || current.current.accountId !== accountId) return Promise.reject(new Error('This SMS is no longer available.'));
    const local = remember([id]);
    const task = syncRead(id);
    if (local.persisted) { task.catch(() => {}); return Promise.resolve(); }
    return task.catch(error => {
      if (current.current.accountId === accountId) {
        current.current.cachedIds = current.current.cachedIds.filter(item => item !== id);
        setCached({ accountId, ids: current.current.cachedIds });
      }
      throw error;
    });
  }

  return { unreadCount: eligibleMessages.filter(item => !readIds.has(item.id)).length, isUnread: id => eligibleIds.has(id) && !readIds.has(id), markRead };
}
