import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { appInstallSnapshot, confirmAppInstalled, dismissAppInstall, openAppInstallGuide, promptAppInstall, subscribeAppInstall } from '../lib/appInstall';
import { isAppPathname, normalizeAppPathname } from '../lib/appRoutes';
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
  return createPortal(<dialog ref={dialog} className={'install-app-dialog install-app-dialog-' + mode} aria-labelledby={title}
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
    <div className="install-app-dialog-chrome"><span className="install-app-handle" aria-hidden="true"/><button type="button" className="install-app-close" aria-label="Close installation dialog" onClick={dismissAppInstall}><Icon name="x" size={20}/></button></div>
    <header className="install-app-dialog-header">
      <div className="install-app-icon"><img src="/images/pwa/icon-192.png" alt="" width={80} height={80}/><span className="install-app-icon-badge"><Icon name="download" size={17}/></span></div>
      <h2 id={title}>Install KyeTech Delivery</h2>
    </header>
    <div className="install-app-guide">
      {mode === 'offer' ? <>
        <ul className="install-app-benefits" aria-label="App features"><li><Icon name="store" size={22}/><span>Local stores</span></li><li><Icon name="bike" size={22}/><span>Riders</span></li><li><Icon name="map-pin" size={22}/><span>Live tracking</span></li></ul>
        <div className="install-app-dialog-actions"><Button ref={primary} onClick={onInstall} busy={busy}><Icon name="download" size={19}/>Install app</Button><Button className="install-app-dismiss" variant="ghost" onClick={dismissAppInstall}>Not now</Button></div>
      </> : <>
        {platform === 'ios' ? <ol className="install-app-steps" role="list" aria-label="Installation steps">
          <li><div>Open <strong>kyetechdelivery.site</strong> in <strong>Safari</strong>.</div></li>
          <li><div>Tap <strong>Share</strong> in the toolbar.</div></li>
          <li><div>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.<small>Keep <strong>Open as Web App</strong> enabled if shown.</small></div></li>
        </ol> : <ol className="install-app-steps" role="list" aria-label="Installation steps">
          <li><div>Open <strong>kyetechdelivery.site</strong> in <strong>Chrome or Edge</strong>.</div></li>
          <li><div>Open the browser menu <strong>(⋮)</strong>.</div></li>
          <li><div>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>, then confirm.</div></li>
        </ol>}
        <p className="install-app-online-note">Internet is needed for deliveries and live tracking.</p>
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
  if (installed || !dialogMode || !isAppPathname(window.location.pathname) || normalizeAppPathname(window.location.pathname) === '/review') return null;
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
    <img src="/images/pwa/icon-192.png" alt="" width={48} height={48}/>
    <div className="install-app-copy"><strong>Get the KyeTech app</strong><p>Stores, riders and live tracking.</p></div>
    <Button className="install-app-button" variant="secondary" onClick={install} busy={prompting}><Icon name="download" size={17}/>Install app</Button>
    {notice && <p className="install-app-notice" role="status">{notice}</p>}
  </section>;
}
