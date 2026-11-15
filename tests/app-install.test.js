import test from 'node:test';
import assert from 'node:assert/strict';

let moduleNumber = 0;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const storage = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};

async function fixture(t, { platform = 'android', standalone = false, legacyMedia = false, path = '/', local = storage(), session = storage(), storageBlocked = false } = {}) {
  const target = new EventTarget(), display = new EventTarget();
  display.matches = standalone;
  display.addListener = listener => EventTarget.prototype.addEventListener.call(display, 'change', listener);
  display.removeListener = listener => EventTarget.prototype.removeEventListener.call(display, 'change', listener);
  if (legacyMedia) { display.addEventListener = undefined; display.removeEventListener = undefined; }
  target.matchMedia = () => display;
  target.navigator = { userAgent: platform === 'ios' ? 'iPhone Safari' : platform === 'android' ? 'Android Chrome' : 'Desktop Chrome', standalone };
  target.location = { pathname: path };
  const unavailableStorage = { getItem() { throw new Error('Storage denied'); }, setItem() { throw new Error('Storage denied'); }, removeItem() { throw new Error('Storage denied'); } };
  Object.defineProperties(target, {
    localStorage: { configurable: true, get: () => storageBlocked ? unavailableStorage : local },
    sessionStorage: { configurable: true, get: () => storageBlocked ? unavailableStorage : session },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: target });
  const api = await import(`../src/lib/appInstall.js?install-test=${++moduleNumber}`);
  t.after(() => {
    api.cleanupAppInstall();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else delete globalThis.window;
  });
  api.initializeAppInstall();
  let promptCalls = 0;
  function offer({ outcome = 'dismissed', choice, fail = false } = {}) {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = async () => { promptCalls += 1; if (fail) throw new Error('Browser prompt unavailable'); };
    event.userChoice = choice || Promise.resolve({ outcome });
    target.dispatchEvent(event);
    return event;
  }
  return { api, target, display, local, session, offer, promptCalls: () => promptCalls };
}

test('Phone detection supports Android, iPhone and desktop-mode iPad without misidentifying a Mac', async t => {
  const { api } = await fixture(t);
  assert.equal(api.phonePlatform({ userAgent: 'Android' }), 'android');
  assert.equal(api.phonePlatform({ userAgent: 'iPhone' }), 'ios');
  assert.equal(api.phonePlatform({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }), 'ios');
  assert.equal(api.phonePlatform({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 1 }), 'other');
  assert.equal(api.phonePlatform(), 'other');
});

test('A browser install offer is automatic while its native prompt remains user initiated and single-use', async t => {
  const f = await fixture(t, { platform: 'other' });
  let releaseChoice;
  const choice = new Promise(resolve => { releaseChoice = resolve; });
  const event = f.offer({ choice });
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.api.appInstallSnapshot().dialogMode, 'offer');
  assert.equal(f.api.appInstallSnapshot().promptAvailable, true);
  assert.equal(f.promptCalls(), 0);
  const first = f.api.promptAppInstall();
  assert.equal(await f.api.promptAppInstall(), 'unavailable');
  assert.equal(f.promptCalls(), 1);
  assert.equal(f.api.appInstallSnapshot().prompting, true);
  releaseChoice({ outcome: 'accepted' });
  assert.equal(await first, 'accepted');
  assert.equal(f.api.appInstallSnapshot().prompting, false);
  assert.equal(f.api.appInstallSnapshot().installed, false, 'A choice does not confirm actual installation.');
  assert.equal(f.local.values.size, 0, 'Native acceptance must not persist an installed flag.');
  assert.equal(await f.api.promptAppInstall(), 'unavailable');
  f.target.dispatchEvent(new Event('appinstalled'));
  assert.equal(f.api.appInstallSnapshot().installed, true);
  assert.equal(f.api.appInstallSnapshot().dialogMode, null);
  assert.equal(f.api.appInstallSnapshot().promptAvailable, false);
  assert.ok(f.local.values.size > 0);
});

test('Not now lasts for the tab session, allows manual guidance and does not persist installation', async t => {
  const local = storage(), session = storage();
  const first = await fixture(t, { platform: 'ios', local, session });
  assert.equal(first.api.appInstallSnapshot().dialogMode, 'offer');
  first.api.dismissAppInstall();
  assert.equal(first.api.appInstallSnapshot().popupDismissed, true);
  assert.equal(first.api.appInstallSnapshot().dialogMode, null);
  assert.equal(first.api.appInstallSnapshot().installed, false);
  assert.equal(local.values.size, 0);
  first.api.openAppInstallGuide();
  assert.equal(first.api.appInstallSnapshot().dialogMode, 'guide');
  first.api.dismissAppInstall();
  first.api.cleanupAppInstall();
  const reload = await fixture(t, { platform: 'ios', local, session });
  assert.equal(reload.api.appInstallSnapshot().popupDismissed, true);
  assert.equal(reload.api.appInstallSnapshot().dialogMode, null);
  reload.offer();
  assert.equal(reload.api.appInstallSnapshot().dialogMode, null, 'A later browser event must honor session dismissal.');
  reload.api.cleanupAppInstall();
  const newSession = await fixture(t, { platform: 'ios', local, session: storage() });
  assert.equal(newSession.api.appInstallSnapshot().dialogMode, 'offer');
});

test('Actual installation and explicit iPhone confirmation persist across reloads and later browser offers', async t => {
  for (const confirm of [f => f.target.dispatchEvent(new Event('appinstalled')), f => f.api.confirmAppInstalled()]) {
    const local = storage();
    const first = await fixture(t, { platform: 'ios', local });
    confirm(first);
    assert.equal(first.api.appInstallSnapshot().installed, true);
    assert.equal(first.api.appInstallSnapshot().dialogMode, null);
    first.api.cleanupAppInstall();
    const reload = await fixture(t, { platform: 'ios', local });
    assert.equal(reload.api.appInstallSnapshot().installed, true);
    assert.equal(reload.api.appInstallSnapshot().dialogMode, null);
    reload.offer();
    reload.api.openAppInstallGuide();
    assert.equal(reload.api.appInstallSnapshot().promptAvailable, false);
    assert.equal(reload.api.appInstallSnapshot().dialogMode, null);
    assert.equal(await reload.api.promptAppInstall(), 'unavailable');
  }
});

test('Standalone detection is durable even after returning to a browser tab, including legacy media listeners', async t => {
  for (const legacyMedia of [false, true]) {
    const local = storage();
    const first = await fixture(t, { local, legacyMedia });
    first.display.matches = true;
    first.display.dispatchEvent(new Event('change'));
    assert.equal(first.api.appInstallSnapshot().installed, true);
    first.display.matches = false;
    first.display.dispatchEvent(new Event('change'));
    assert.equal(first.api.appInstallSnapshot().installed, true);
    first.api.cleanupAppInstall();
    const reload = await fixture(t, { local, legacyMedia });
    assert.equal(reload.api.appInstallSnapshot().installed, true);
  }
  const alreadyInstalled = await fixture(t, { standalone: true });
  assert.equal(alreadyInstalled.api.appInstallSnapshot().installed, true);
  assert.ok(alreadyInstalled.local.values.size > 0);
});

test('Recipient review routes never open automatic install popups', async t => {
  for (const platform of ['ios', 'android', 'other']) {
    const f = await fixture(t, { platform, path: '/review' });
    f.offer();
    assert.equal(f.api.appInstallSnapshot().dialogMode, null);
    assert.equal(f.promptCalls(), 0);
  }
});

test('Storage denial and prompt failures leave dismissal and installed state usable in memory', async t => {
  const f = await fixture(t, { platform: 'ios', storageBlocked: true });
  assert.equal(f.api.appInstallSnapshot().dialogMode, 'offer');
  f.offer({ fail: true });
  assert.equal(await f.api.promptAppInstall(), 'unavailable');
  assert.equal(f.api.appInstallSnapshot().prompting, false);
  assert.equal(f.api.appInstallSnapshot().installed, false);
  f.api.dismissAppInstall();
  assert.equal(f.api.appInstallSnapshot().popupDismissed, true);
  f.api.openAppInstallGuide();
  assert.equal(f.api.appInstallSnapshot().dialogMode, 'guide');
  f.api.confirmAppInstalled();
  assert.equal(f.api.appInstallSnapshot().installed, true);
  assert.equal(f.api.appInstallSnapshot().dialogMode, null);
});

test('Initialization and subscription cleanup detach browser/media handlers without stale updates', async t => {
  const f = await fixture(t);
  let notifications = 0;
  const unsubscribe = f.api.subscribeAppInstall(() => { notifications += 1; });
  const cleanup = f.api.initializeAppInstall();
  f.offer();
  assert.ok(notifications > 0);
  unsubscribe();
  const beforeDismissal = notifications;
  f.api.dismissAppInstall();
  assert.equal(notifications, beforeDismissal);
  assert.equal(typeof cleanup, 'function');
  cleanup();
  const previous = f.api.appInstallSnapshot();
  f.offer();
  f.target.dispatchEvent(new Event('appinstalled'));
  f.display.matches = true;
  f.display.dispatchEvent(new Event('change'));
  assert.deepEqual(f.api.appInstallSnapshot(), previous);
});
