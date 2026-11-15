import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { incomingRiderRequests, isApprovedRider } from '../lib/admin';
import { openAppInstallGuide } from '../lib/appInstall';
import { claimRiderRequestBadge, clearRiderRequestBadge, createRequestTracker, createRiderChime, registerRiderPush, removeRiderPush, riderAlertsEnabled, rememberRiderAlerts, riderPushSupport, syncRiderRequestBadge } from '../lib/riderAlerts';
import { Button, Icon } from './UI';
import './rider-alerts.css';

export default function RiderAlerts({ onViewRequests }) {
  const { user, profile, isAdmin, orders, riderRequestsReady } = usePlatform();
  const eligible = !isAdmin && isApprovedRider(profile);
  const uid = user?.uid || '';
  const current = useRef(null), action = useRef(0);
  const chime = useRef(null), tracker = useRef(createRequestTracker());
  const [enabled, setEnabled] = useState(false), [pushReady, setPushReady] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [newIds, setNewIds] = useState([]);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  current.current = { uid, eligible, online: profile?.online, enabled, pushReady, riderRequestsReady };
  const support = riderPushSupport();

  useEffect(() => {
    const sound = createRiderChime(); chime.current = sound;
    return () => { sound.close(); chime.current = null; };
  }, [uid]);

  useEffect(() => {
    const changed = () => { setVisible(document.visibilityState === 'visible'); if (document.visibilityState !== 'visible') chime.current?.stop(); };
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);

  useEffect(() => {
    let active = true, registering = false, lastAttempt = 0;
    const sameAccount = () => active && current.current.uid === uid && current.current.eligible;
    const valid = () => sameAccount() && riderAlertsEnabled(uid);
    action.current += 1;
    tracker.current = createRequestTracker(); setNewIds([]); setMessage(''); setBusy(false); setPushReady(false);
    claimRiderRequestBadge(uid, () => active && current.current.uid === uid);
    const remembered = riderAlertsEnabled(uid);
    const canRestore = eligible && remembered && support === 'supported' && Notification.permission === 'granted';
    setEnabled(canRestore);
    if (eligible && remembered && support === 'supported' && Notification.permission !== 'granted') rememberRiderAlerts(uid, false);
    async function restore() {
      if (!valid() || registering || Date.now() - lastAttempt < 60000 || document.visibilityState !== 'visible') return;
      registering = true; lastAttempt = Date.now();
      const attempt = ++action.current;
      const stillCurrent = () => valid() && action.current === attempt;
      setBusy(true);
      try {
        const ready = await registerRiderPush(user, stillCurrent);
        if (stillCurrent()) { setPushReady(ready); setMessage(''); }
      } catch (error) {
        if (stillCurrent()) {
          lastAttempt = 0;
          if (Notification.permission !== 'granted') { rememberRiderAlerts(uid, false); setEnabled(false); }
          setPushReady(false); setMessage(error.message || 'Alerts could not connect. Turn them on again to retry.');
        }
      } finally { registering = false; if (sameAccount() && action.current === attempt) setBusy(false); }
    }
    if (canRestore) restore();
    else if (user && !eligible) removeRiderPush(user, () => active && current.current.uid === uid && !current.current.eligible).catch(() => {});
    const reconnect = () => { if (support === 'supported' && Notification.permission === 'granted') restore(); };
    window.addEventListener('online', reconnect);
    window.addEventListener('focus', reconnect);
    document.addEventListener('visibilitychange', reconnect);
    return () => { active = false; window.removeEventListener('online', reconnect); window.removeEventListener('focus', reconnect); document.removeEventListener('visibilitychange', reconnect); };
  }, [uid, eligible]);

  const requests = incomingRiderRequests(orders, profile);
  const requestIds = requests.map(order => order.id);
  useEffect(() => {
    const active = eligible && profile?.online === true && enabled && pushReady;
    const valid = () => current.current.uid === uid && current.current.eligible && current.current.online === true
      && current.current.enabled && current.current.pushReady && current.current.riderRequestsReady && riderAlertsEnabled(uid);
    const shouldClear = () => current.current.uid === uid
      && (!current.current.eligible || current.current.online === false || !riderAlertsEnabled(uid));
    if (active && riderRequestsReady) syncRiderRequestBadge(requestIds, valid, uid);
    else if (shouldClear()) clearRiderRequestBadge(shouldClear, uid);
  }, [requestIds.join(','), riderRequestsReady, eligible, profile?.online, enabled, pushReady, uid]);

  useEffect(() => {
    const active = eligible && profile.online && enabled && pushReady && visible;
    const added = tracker.current.observe(requestIds, { ready: riderRequestsReady, active });
    if (!active || !riderRequestsReady) { setNewIds([]); chime.current?.stop(); return; }
    setNewIds(previous => [...new Set([...previous.filter(id => requestIds.includes(id)), ...added])]);
    if (added.length) {
      chime.current?.play();
      try { navigator.vibrate?.([200, 100, 200]); } catch { /* Some phones do not support vibration. */ }
    }
  }, [requestIds.join(','), riderRequestsReady, eligible, profile?.online, enabled, pushReady, visible]);

  async function enable() {
    const account = user;
    const sameAccount = () => current.current.uid === account.uid && current.current.eligible;
    const attempt = ++action.current;
    const valid = () => sameAccount() && action.current === attempt && riderAlertsEnabled(account.uid);
    setMessage('');
    if (support !== 'supported') {
      rememberRiderAlerts(uid, false); setEnabled(false); setPushReady(false);
      if (support === 'install-ios') { setMessage('Add KyeTech to your Home Screen, then open it there to turn alerts on. Requires iOS 16.4 or later.'); openAppInstallGuide(); }
      else setMessage('Phone notifications are unavailable in this browser. Open KyeTech in a browser that supports notifications.');
      return;
    }
    // Start permission and audio directly in the tap, before any network work.
    setBusy(true); rememberRiderAlerts(uid, true); setEnabled(true);
    try {
      const audio = chime.current?.unlock();
      const permission = Notification.requestPermission();
      const choice = await permission;
      await audio;
      if (!valid()) return;
      if (choice === 'denied') throw new Error('Notifications are blocked. Allow KyeTech notifications in your phone or browser settings, then turn alerts on again.');
      if (choice !== 'granted') throw new Error('Allow notifications, then turn alerts on again.');
      const ready = await registerRiderPush(account, valid);
      if (valid()) setPushReady(ready);
    } catch (error) {
      if (sameAccount() && action.current === attempt) { rememberRiderAlerts(account.uid, false); setEnabled(false); setPushReady(false); chime.current?.stop(); setMessage(error.message || 'Alerts could not start. Turn them on again.'); }
    } finally { if (sameAccount() && action.current === attempt) setBusy(false); }
  }

  async function disable() {
    const account = user;
    const attempt = ++action.current;
    const sameAccount = () => current.current.uid === account.uid && action.current === attempt;
    rememberRiderAlerts(uid, false); setEnabled(false); setNewIds([]); setPushReady(false); setMessage(''); chime.current?.stop(); setBusy(true);
    try { await removeRiderPush(account, sameAccount); }
    catch { if (sameAccount()) setMessage('Check your phone notification settings if alerts continue.'); }
    finally { if (sameAccount()) setBusy(false); }
  }

  if (!eligible) return null;
  const on = enabled && pushReady;
  return <section className="rider-alerts" aria-label="Delivery request alerts">
    <button type="button" className="rider-alert-switch" role="switch" aria-label="Delivery alerts" aria-checked={on} aria-busy={busy} disabled={busy} onClick={on ? disable : enable}>
      <Icon name="bell" size={17}/><span className="rider-alert-switch-track" aria-hidden="true"><span/></span><span>{on ? 'On' : 'Off'}</span>
    </button>
    {message && <p className="rider-alerts-message" role="status">{message}</p>}
    {newIds.length > 0 && <div className="rider-alerts-new"><span className="request-announcement" role="status">{newIds.length === 1 ? 'New delivery alert' : `${newIds.length} new delivery alerts`}</span><Button onClick={() => { setNewIds([]); onViewRequests(); }}>View requests ({newIds.length})</Button><button className="button-icon" aria-label="Dismiss new request alert" onClick={() => setNewIds([])}><Icon name="x"/></button></div>}
  </section>;
}
