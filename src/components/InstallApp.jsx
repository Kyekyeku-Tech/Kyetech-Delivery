import { useState, useSyncExternalStore } from 'react';
import { appInstallSnapshot, promptAppInstall, subscribeAppInstall } from '../lib/appInstall';
import { Button, Icon, Modal } from './UI';
import './install-app.css';

export default function InstallApp() {
  const { installed, promptAvailable, platform } = useSyncExternalStore(subscribeAppInstall, appInstallSnapshot);
  const [guide, setGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  if (installed || (!promptAvailable && platform === 'other')) return null;

  async function install() {
    if (busy) return;
    setNotice('');
    if (!promptAvailable) { setGuide(true); return; }
    setBusy(true);
    try {
      const outcome = await promptAppInstall();
      if (outcome === 'unavailable') setGuide(true);
      else if (outcome === 'dismissed') setNotice('You can install later from your browser menu.');
    } finally { setBusy(false); }
  }

  return <>
    <section className="install-app-card" aria-label="Install KyeTech Delivery">
      <img src="/images/pwa/icon-192.png" alt="" width={44} height={44} />
      <div className="install-app-copy"><strong>KyeTech on your phone</strong><p>Add to your home screen for quick access.</p></div>
      <Button className="install-app-button" variant="secondary" onClick={install} busy={busy}><Icon name="download" size={17} />Install app</Button>
      {notice && <p className="install-app-notice" role="status">{notice}</p>}
    </section>
    {guide && <Modal title="Install KyeTech Delivery" onClose={() => setGuide(false)}>
      <div className="install-app-guide">
        <img src="/images/pwa/icon-192.png" alt="" width={72} height={72} />
        <p>Keep KyeTech on your home screen and open it like an app.</p>
        {platform === 'ios' ? <ol>
          <li>Open <strong>kyetechdelivery.site</strong> in <strong>Safari</strong>.</li>
          <li>Tap <strong>Share</strong> in the browser toolbar.</li>
          <li>Choose <strong>Add to Home Screen</strong>. Keep <strong>Open as Web App</strong> enabled if shown, then tap <strong>Add</strong>.</li>
        </ol> : <ol>
          <li>Open <strong>kyetechdelivery.site</strong> in <strong>Chrome or Edge</strong>.</li>
          <li>Open the browser menu <strong>(⋮)</strong>.</li>
          <li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>, then confirm.</li>
        </ol>}
        <p className="install-app-online-note">An internet connection is needed to request deliveries and track packages.</p>
        <Button onClick={() => setGuide(false)}>Got it</Button>
      </div>
    </Modal>}
  </>;
}
