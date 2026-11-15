export const APP_INSTALLED_STORAGE_KEY = 'kyetech:app-installed';
export const INSTALL_DISMISSED_SESSION_KEY = 'kyetech:install-dismissed';

const listeners = new Set();
let initialized = false, deferredPrompt = null, generation = 0;
let rememberedInstalled = false, rememberedDismissed = false;
let removeBrowserListeners = () => {};
let snapshot = { installed: false, promptAvailable: false, platform: 'other', supported: false, popupDismissed: false, dialogMode: null, prompting: false };

export function phonePlatform(navigatorInfo) {
  const agent = navigatorInfo?.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(agent) || (navigatorInfo?.platform === 'MacIntel' && navigatorInfo.maxTouchPoints > 1)) return 'ios';
  return /Android/i.test(agent) ? 'android' : 'other';
}

function update(patch) {
  if (!Object.entries(patch).some(([key, value]) => snapshot[key] !== value)) return;
  snapshot = { ...snapshot, ...patch };
  listeners.forEach(listener => listener());
}

function stored(storage, key) {
  try { return typeof window !== 'undefined' && window[storage]?.getItem(key) === '1'; }
  catch { return false; }
}

function remember(storage, key) {
  try { if (typeof window !== 'undefined') window[storage]?.setItem(key, '1'); }
  catch { /* Keep this page usable when browser storage is unavailable. */ }
}

const reviewRoute = () => typeof window !== 'undefined' && window.location?.pathname === '/review';

function offerInstall() {
  if (!snapshot.installed && !snapshot.popupDismissed && !snapshot.dialogMode && !reviewRoute()
    && (snapshot.promptAvailable || snapshot.platform === 'ios')) update({ dialogMode: 'offer' });
}

export function confirmAppInstalled() {
  rememberedInstalled = true;
  remember('localStorage', APP_INSTALLED_STORAGE_KEY);
  deferredPrompt = null;
  update({ installed: true, promptAvailable: false, dialogMode: null });
}

export function dismissAppInstall() {
  rememberedDismissed = true;
  remember('sessionStorage', INSTALL_DISMISSED_SESSION_KEY);
  update({ popupDismissed: true, dialogMode: null });
}

export function openAppInstallGuide() {
  if (!snapshot.installed && !reviewRoute()) update({ dialogMode: 'guide' });
}

export function cleanupAppInstall() {
  removeBrowserListeners();
  removeBrowserListeners = () => {};
  initialized = false;
  generation += 1;
  deferredPrompt = null;
  update({ promptAvailable: false, prompting: false, dialogMode: null });
}

export function initializeAppInstall() {
  if (initialized || typeof window === 'undefined') return cleanupAppInstall;
  initialized = true;
  const browser = window, display = browser.matchMedia?.('(display-mode: standalone)');
  const standalone = () => display?.matches === true || browser.navigator?.standalone === true;
  const platform = phonePlatform(browser.navigator);
  rememberedInstalled ||= stored('localStorage', APP_INSTALLED_STORAGE_KEY);
  rememberedDismissed ||= stored('sessionStorage', INSTALL_DISMISSED_SESSION_KEY);
  update({ installed: rememberedInstalled, popupDismissed: rememberedDismissed, platform, supported: platform !== 'other' });
  if (standalone()) confirmAppInstalled();

  const onPrompt = event => {
    event.preventDefault();
    if (standalone()) confirmAppInstalled();
    if (snapshot.installed || typeof event.prompt !== 'function') return;
    deferredPrompt = event;
    update({ promptAvailable: true, supported: true });
    offerInstall();
  };
  const onInstalled = () => confirmAppInstalled();
  const onDisplayChange = () => { if (standalone()) confirmAppInstalled(); };
  const onStorage = event => {
    if (event.key === APP_INSTALLED_STORAGE_KEY && event.newValue === '1') confirmAppInstalled();
  };
  browser.addEventListener('beforeinstallprompt', onPrompt);
  browser.addEventListener('appinstalled', onInstalled);
  browser.addEventListener('storage', onStorage);
  if (display?.addEventListener) display.addEventListener('change', onDisplayChange);
  else display?.addListener?.(onDisplayChange);
  removeBrowserListeners = () => {
    browser.removeEventListener('beforeinstallprompt', onPrompt);
    browser.removeEventListener('appinstalled', onInstalled);
    browser.removeEventListener('storage', onStorage);
    if (display?.removeEventListener) display.removeEventListener('change', onDisplayChange);
    else display?.removeListener?.(onDisplayChange);
  };
  offerInstall();
  return cleanupAppInstall;
}

export function subscribeAppInstall(listener) {
  initializeAppInstall();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const appInstallSnapshot = () => snapshot;

export async function promptAppInstall() {
  if (!deferredPrompt || snapshot.prompting || snapshot.installed) return 'unavailable';
  const event = deferredPrompt, currentGeneration = generation;
  deferredPrompt = null;
  update({ promptAvailable: false, prompting: true });
  try {
    const result = await event.prompt();
    const choice = event.userChoice ? await event.userChoice : result;
    // Accepted browser UI is not proof of installation; appinstalled supplies that proof.
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch { return 'unavailable'; }
  finally { if (currentGeneration === generation) update({ prompting: false }); }
}
