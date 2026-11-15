import { useEffect, useRef, useState } from 'react';
import { deleteDoc, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { isApprovedRider } from './admin';
import { cleanCoordinates, LIVE_LOCATION_INTERVAL, LIVE_LOCATION_MAX_AGE, lookupGpsAddress } from './location';

const TOWN_LOOKUP_INTERVAL = 30000;
const distanceMetres = (first, second) => Math.hypot(first.latitude - second.latitude, (first.longitude - second.longitude) * Math.cos(first.latitude * Math.PI / 180)) * 111320;

export default function useRiderLocationSharing({ user, profile, orders }) {
  const [selectedIds, setSelectedIds] = useState([]), [updates, setUpdates] = useState({});
  const [errors, setErrors] = useState({}), [address, setAddress] = useState('');
  const active = orders.filter(order => order.riderId === user?.uid && ['accepted', 'picked_up'].includes(order.status));
  const approved = isApprovedRider(profile), eligible = approved && active.length > 0;
  const sharedOrderIds = approved ? selectedIds.filter(id => active.some(order => order.id === id)) : [];
  const enabled = sharedOrderIds.length > 0;
  const selected = useRef(new Map()), revision = useRef(0);
  const current = useRef({ user, active, approved });
  current.current = { user, active, approved };
  const releaseRef = useRef(async () => {});
  const activeScope = (user?.uid || '') + ':' + approved + ':' + active.map(order => order.id).sort().join(',');

  useEffect(() => {
    const validIds = new Set(approved ? active.map(order => order.id) : []);
    const removed = [...selected.current.keys()].filter(id => !validIds.has(id));
    if (!removed.length) return;
    removed.forEach(id => selected.current.delete(id));
    setSelectedIds([...selected.current.keys()]);
    setUpdates(values => Object.fromEntries(Object.entries(values).filter(([id]) => validIds.has(id))));
    void releaseRef.current(removed);
  }, [activeScope]);

  useEffect(() => {
    if (!enabled || !eligible || !db) {
      setUpdates({}); setAddress('');
      return;
    }
    let running = true, watchId, latest = null, writing = false, lastWrite = 0;
    let lookingUp = false, lastLookup = 0, addressPin = null, gpsAddress = '';
    const sharedIds = new Set(), abort = new AbortController(), account = current.current.user;
    const release = async (ids = [...sharedIds]) => {
      ids.forEach(id => sharedIds.delete(id));
      await Promise.allSettled(ids.map(id => deleteDoc(doc(db, 'orders', id, 'tracking', 'rider'))));
    };
    releaseRef.current = release;

    function reportError(message) {
      if (!running) return;
      const ids = current.current.active.filter(order => selected.current.has(order.id)).map(order => order.id);
      setErrors(values => ({ ...values, ...Object.fromEntries(ids.map(id => [id, message])) }));
    }

    async function publish() {
      if (!running || writing || !latest || Date.now() - latest.capturedAt >= LIVE_LOCATION_MAX_AGE || Date.now() - lastWrite < LIVE_LOCATION_INTERVAL) return;
      const sample = latest, selection = new Map(selected.current);
      const ids = current.current.active.filter(order => selection.has(order.id)).map(order => order.id);
      if (!ids.length || !current.current.approved || current.current.user?.uid !== account.uid) return;
      writing = true; lastWrite = Date.now();
      try {
        const written = await runTransaction(db, async transaction => {
          const snapshots = await Promise.all(ids.map(id => transaction.get(doc(db, 'orders', id))));
          // A stopped session must not publish after an in-flight read or transaction retry.
          if (!running || !current.current.approved || current.current.user?.uid !== account.uid) return [];
          const writable = snapshots.filter(snapshot => snapshot.exists() && selected.current.get(snapshot.id) === selection.get(snapshot.id) && current.current.active.some(order => order.id === snapshot.id) && snapshot.data().riderId === account.uid && ['accepted', 'picked_up'].includes(snapshot.data().status));
          for (const snapshot of writable) {
            sharedIds.add(snapshot.id);
            transaction.set(doc(db, 'orders', snapshot.id, 'tracking', 'rider'), {
              ...cleanCoordinates(sample), accuracy: sample.accuracy, address: addressPin && distanceMetres(sample, addressPin) <= 150 ? gpsAddress : '',
              sharing: true, riderId: account.uid, updatedAt: serverTimestamp(),
            });
          }
          return writable.map(snapshot => snapshot.id);
        });
        if (!running) { await release(written); return; }
        const stopped = written.filter(id => !selected.current.has(id) || !current.current.active.some(order => order.id === id));
        if (stopped.length) await release(stopped);
        const fresh = written.filter(id => selected.current.get(id) === selection.get(id) && current.current.active.some(order => order.id === id));
        if (fresh.length) {
          const now = Date.now();
          setUpdates(values => ({ ...values, ...Object.fromEntries(fresh.map(id => [id, now])) }));
          setErrors(values => Object.fromEntries(Object.entries(values).filter(([id]) => !fresh.includes(id))));
        }
      } catch {
        reportError('Your live location could not be shared. Check your connection or stop and try again.');
      } finally { writing = false; }
    }

    function updateTown() {
      if (!running || lookingUp || !latest || Date.now() - latest.capturedAt >= LIVE_LOCATION_MAX_AGE) return;
      const pin = cleanCoordinates(latest);
      const moved = !addressPin || distanceMetres(pin, addressPin) > 100;
      if (!moved || Date.now() - lastLookup < TOWN_LOOKUP_INTERVAL) return;
      lookingUp = true; lastLookup = Date.now();
      lookupGpsAddress(pin, account, { signal: abort.signal, locality: true }).then(value => {
        if (!running || !latest || distanceMetres(pin, latest) > 150) return;
        gpsAddress = value; addressPin = pin; setAddress(value);
        void publish();
      }).catch(() => {}).finally(() => { lookingUp = false; });
    }

    function positionReceived(position) {
      if (!running) return;
      let pin;
      try { pin = cleanCoordinates(position.coords); } catch { reportError('Your GPS position could not be read. Stop sharing and try again.'); return; }
      latest = { ...pin, capturedAt: Number.isFinite(position.timestamp) ? position.timestamp : Date.now(), accuracy: Number.isFinite(position.coords.accuracy) && position.coords.accuracy >= 0 ? Math.min(100000, Math.ceil(position.coords.accuracy)) : null };
      const moved = !addressPin || distanceMetres(pin, addressPin) > 100;
      if (moved) { gpsAddress = ''; setAddress(''); }
      updateTown();
      void publish();
    }

    try {
      watchId = navigator.geolocation.watchPosition(positionReceived, cause => {
        if (!running) return;
        reportError(cause.code === 1 ? 'Allow location access in your browser to share with your customer.' : 'Waiting for a fresh GPS position. Keep this page open and check location access.');
        if (cause.code === 1) { selected.current.clear(); setSelectedIds([]); }
      }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    } catch { reportError('Live GPS is unavailable in this browser.'); selected.current.clear(); setSelectedIds([]); }
    const timer = setInterval(() => {
      if (latest && Date.now() - latest.capturedAt >= LIVE_LOCATION_MAX_AGE) reportError('Waiting for a fresh GPS position. Your customer can see the last shared location.');
      updateTown();
      void publish();
    }, 1000); // Check freshness often; publish() still limits writes to once per 15 seconds.
    return () => {
      running = false; abort.abort(); clearInterval(timer);
      if (watchId !== undefined) navigator.geolocation?.clearWatch(watchId);
      void release();
    };
  }, [enabled, eligible, user?.uid]);

  function start(orderId) {
    const fail = message => setErrors(values => ({ ...values, [orderId]: message }));
    if (!eligible || !active.some(order => order.id === orderId)) { fail('Accept this delivery before sharing your live location.'); return; }
    if (!window.isSecureContext || !navigator.geolocation?.watchPosition) { fail('Live GPS requires HTTPS and a browser with location access.'); return; }
    if (!db) { fail('Live GPS could not be started. Check your connection and try again.'); return; }
    if (selected.current.has(orderId)) return;
    setErrors(values => Object.fromEntries(Object.entries(values).filter(([id]) => id !== orderId)));
    setUpdates(values => Object.fromEntries(Object.entries(values).filter(([id]) => id !== orderId)));
    selected.current.set(orderId, ++revision.current);
    setSelectedIds([...selected.current.keys()]);
  }
  async function stop(orderId) {
    const ids = orderId ? [orderId] : [...selected.current.keys()];
    ids.forEach(id => selected.current.delete(id));
    setSelectedIds([...selected.current.keys()]);
    setUpdates(values => Object.fromEntries(Object.entries(values).filter(([id]) => !ids.includes(id))));
    setErrors(values => orderId ? Object.fromEntries(Object.entries(values).filter(([id]) => id !== orderId)) : {});
    await releaseRef.current(ids);
  }
  return { enabled, starting: sharedOrderIds.some(id => !updates[id]), updatedAt: Math.max(0, ...Object.values(updates)), address, count: active.length, sharedOrderIds, updates, errors, start, stop };
}
