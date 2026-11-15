const listeners = new Set();
let initialized = false;
let deferredPrompt = null;
let prompting = false;
let snapshot = { installed: false, promptAvailable: false, platform: 'other' };

export function phonePlatform(navigatorInfo) {
  const agent = navigatorInfo?.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(agent) || (navigatorInfo?.platform === 'MacIntel' && navigatorInfo.maxTouchPoints > 1)) return 'ios';
  return /Android/i.test(agent) ? 'android' : 'other';
}

function update(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach(listener => listener());
}

export function initializeAppInstall() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const display = window.matchMedia('(display-mode: standalone)');
  const installed = () => display.matches || window.navigator.standalone === true;
  update({ installed: installed(), platform: phonePlatform(window.navigator) });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    update({ promptAvailable: true, installed: installed() });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    update({ installed: true, promptAvailable: false });
  });
  const onDisplayChange = () => update({ installed: installed() });
  if (display.addEventListener) display.addEventListener('change', onDisplayChange);
  else display.addListener?.(onDisplayChange);
}

export function subscribeAppInstall(listener) {
  initializeAppInstall();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const appInstallSnapshot = () => snapshot;

export async function promptAppInstall() {
  if (!deferredPrompt || prompting || snapshot.installed) return 'unavailable';
  prompting = true;
  const event = deferredPrompt;
  deferredPrompt = null;
  update({ promptAvailable: false });
  try {
    const result = await event.prompt();
    const choice = event.userChoice ? await event.userChoice : result;
    if (choice?.outcome === 'accepted') {
      update({ installed: true });
      return 'accepted';
    }
    return 'dismissed';
  } catch { return 'unavailable'; }
  finally { prompting = false; }
}
