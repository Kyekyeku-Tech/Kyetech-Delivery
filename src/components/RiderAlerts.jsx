import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { incomingRiderRequests, isApprovedRider } from '../lib/admin';
import { appInstallSnapshot, openAppInstallGuide } from '../lib/appInstall';
import { createRequestTracker, createRiderChime, registerRiderPush, removeRiderPush, riderAlertsEnabled, rememberRiderAlerts, riderPushSupport } from '../lib/riderAlerts';
import { Button, Icon } from './UI';
import './rider-alerts.css';

export default function RiderAlerts({ onViewRequests }) {
  const { user, profile, isAdmin, orders, riderRequestsReady } = usePlatform();
  const eligible = !isAdmin && isApprovedRider(profile);
  const uid = user?.uid || '';
  const current = useRef({ uid, eligible }); current.current = { uid, eligible };
  const chime = useRef(null), tracker = useRef(createRequestTracker());
  const [enabled, setEnabled] = useState(false), [pushReady, setPushReady] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [newIds, setNewIds] = useState([]);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
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
    let active = true;
    const valid = () => active && current.current.uid === uid && current.current.eligible && riderAlertsEnabled(uid);
    tracker.current = createRequestTracker(); setNewIds([]); setMessage(''); setBusy(false); setPushReady(false);
    const remembered = riderAlertsEnabled(uid); setEnabled(remembered);
    if (eligible && remembered && support === 'supported' && Notification.permission === 'granted') {
      registerRiderPush(user, valid).then(ready => { if (valid()) setPushReady(ready); }).catch(error => { if (valid()) setMessage(error.message); });
    } else if (user && !eligible) removeRiderPush(user).catch(() => {});
    return () => { active = false; };
  }, [uid, eligible]);

  const requests = incomingRiderRequests(orders, profile);
  const requestIds = requests.map(order => order.id);
  useEffect(() => {
    const active = eligible && profile.online && enabled && visible;
    const added = tracker.current.observe(requestIds, { ready: riderRequestsReady, active });
    if (!active || !riderRequestsReady) { setNewIds([]); chime.current?.stop(); return; }
    setNewIds(previous => [...new Set([...previous.filter(id => requestIds.includes(id)), ...added])]);
    if (added.length) {
      chime.current?.play();
      try { navigator.vibrate?.([200, 100, 200]); } catch { /* Some phones do not support vibration. */ }
    }
  }, [requestIds.join(','), riderRequestsReady, eligible, profile?.online, enabled, visible]);

  async function enable() {
    const account = user;
    const valid = () => current.current.uid === account.uid && current.current.eligible && riderAlertsEnabled(account.uid);
    // Both actions start inside the rider's tap, as required by mobile browsers.
    const audio = chime.current.unlock();
    const permission = support === 'supported' ? Notification.requestPermission() : Promise.resolve('unavailable');
    setBusy(true); setMessage(''); rememberRiderAlerts(uid, true); setEnabled(true);
    try {
      await audio; if (!valid()) return;
      const choice = await permission; if (!valid()) return;
      if (choice === 'granted') { const ready = await registerRiderPush(account, valid); if (valid()) setPushReady(ready); }
      else if (choice === 'denied') setMessage('Phone notifications are blocked. Allow notifications for KyeTech in your browser or phone settings, then tap Enable alerts again.');
      else if (choice === 'default') setMessage('Allow notifications to receive requests while the app is closed. You can try again.');
      else if (support === 'install-ios') setMessage('Open KyeTech from your Home Screen to enable phone notifications. Requires iOS 16.4 or later.');
      else if (support === 'unsupported') setMessage('In-app sound is enabled. This browser does not support phone notifications.');
    } catch (error) { if (valid()) setMessage(error.message || 'Alerts could not be enabled. Please try again.'); }
    finally { if (valid()) setBusy(false); }
  }

  async function disable() {
    rememberRiderAlerts(uid, false); setEnabled(false); setNewIds([]); setPushReady(false); setMessage(''); chime.current.stop(); setBusy(true);
    try { await removeRiderPush(user); }
    catch { if (current.current.uid === uid) setMessage('Alerts are muted here. Check your phone notification settings if device alerts continue.'); }
    finally { if (current.current.uid === uid) setBusy(false); }
  }

  if (!eligible) return null;
  return <section className="rider-alerts" aria-label="Delivery request alerts">
    <div className="rider-alerts-actions">{pushReady ? <Button variant="secondary" disabled><Icon name="check" size={17}/>Alerts enabled</Button> : <Button busy={busy} onClick={enable}><Icon name="bell" size={17}/>Enable alerts</Button>}
      {enabled && <Button variant="secondary" disabled={busy} onClick={async () => { const ready = await chime.current.unlock(); if (!ready) setMessage('This phone could not play the chime. Check your sound settings.'); }}>Test sound</Button>}
      {support === 'install-ios' && !appInstallSnapshot().installed && <Button variant="secondary" onClick={openAppInstallGuide}>Install guide</Button>}
      {enabled && <Button variant="ghost" disabled={busy} onClick={disable}>Turn off</Button>}
    </div>
    {message && <p className="rider-alerts-message" role="status">{message}</p>}
    {newIds.length > 0 && <div className="rider-alerts-new"><span className="request-announcement" role="status">{newIds.length === 1 ? 'New delivery request received' : `${newIds.length} new delivery requests received`}</span><Button onClick={() => { setNewIds([]); onViewRequests(); }}>View requests ({newIds.length})</Button><button className="button-icon" aria-label="Dismiss new request alert" onClick={() => setNewIds([])}><Icon name="x"/></button></div>}
  </section>;
}
