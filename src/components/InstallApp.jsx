import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { appInstallSnapshot, confirmAppInstalled, dismissAppInstall, openAppInstallGuide, promptAppInstall, subscribeAppInstall } from '../lib/appInstall';
import { Button, Icon } from './UI';
import './install-app.css';

function InstallDialog({ mode, platform, busy, onInstall }) {
  const dialog = useRef(null), primary = useRef(null), title = useId();
  useEffect(() => {
    const current = dialog.current, previous = document.activeElement;
    current.showModal();
    return () => { current.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { primary.current?.focus({ preventScroll: true }); }, [mode]);
  return createPortal(<dialog ref={dialog} className="install-app-dialog" aria-labelledby={title}
    onCancel={event => { event.preventDefault(); dismissAppInstall(); }}
    onKeyDown={event => {
      if (event.key === 'Tab' || event.key === 'Escape') event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); dismissAppInstall(); }
      if (event.key === 'Tab') {
        const items = [...dialog.current.querySelectorAll('button:not(:disabled),a[href]')], first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismissAppInstall();
    }}>
    <header className="install-app-dialog-header"><h2 id={title}>Install KyeTech Delivery</h2><button type="button" className="install-app-close" aria-label="Close installation dialog" onClick={dismissAppInstall}><Icon name="x" size={20}/></button></header>
    <div className="install-app-guide">
      <img src="/images/pwa/icon-192.png" alt="" width={72} height={72}/>
      <p>Keep KyeTech on your home screen and open it like an app.</p>
      {mode === 'offer' ? <><p className="install-app-offer-copy">Find stores, request riders and follow your deliveries with quick access to KyeTech.</p><div className="install-app-dialog-actions"><Button ref={primary} onClick={onInstall} busy={busy}><Icon name="download" size={18}/>Install app</Button><Button variant="secondary" onClick={dismissAppInstall}>Not now</Button></div></> : <>
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
        <div className="install-app-dialog-actions">{platform === 'ios' && <Button ref={primary} onClick={confirmAppInstalled}>I've added the app</Button>}<Button ref={platform === 'ios' ? undefined : primary} variant="secondary" onClick={dismissAppInstall}>Got it</Button></div>
      </>}
    </div>
  </dialog>, document.body);
}

export function InstallAppPrompt() {
  const { installed, dialogMode, platform, prompting } = useSyncExternalStore(subscribeAppInstall, appInstallSnapshot);
  async function install() {
    if (platform === 'ios') { openAppInstallGuide(); return; }
    const outcome = await promptAppInstall();
    if (outcome === 'unavailable') openAppInstallGuide();
    else dismissAppInstall();
  }
  if (installed || !dialogMode || window.location.pathname === '/review') return null;
  return <InstallDialog mode={dialogMode} platform={platform} busy={prompting} onInstall={install}/>;
}

export default function InstallApp() {
  const { installed, promptAvailable, platform, supported, dialogMode, prompting } = useSyncExternalStore(subscribeAppInstall, appInstallSnapshot);
  const [notice, setNotice] = useState('');
  if (installed || !supported) return null;
  async function install() {
    if (prompting) return;
    setNotice('');
    if (!promptAvailable || platform === 'ios') { openAppInstallGuide(); return; }
    const outcome = await promptAppInstall();
    if (outcome === 'unavailable') openAppInstallGuide();
    else {
      dismissAppInstall();
      if (outcome === 'dismissed') setNotice('You can install later from your browser menu.');
    }
  }
  return <section className="install-app-card" aria-label="Install KyeTech Delivery" aria-hidden={dialogMode ? true : undefined} inert={dialogMode ? true : undefined}>
    <img src="/images/pwa/icon-192.png" alt="" width={44} height={44}/>
    <div className="install-app-copy"><strong>KyeTech on your phone</strong><p>Add to your home screen for quick access.</p></div>
    <Button className="install-app-button" variant="secondary" onClick={install} busy={prompting}><Icon name="download" size={17}/>Install app</Button>
    {notice && <p className="install-app-notice" role="status">{notice}</p>}
  </section>;
}
