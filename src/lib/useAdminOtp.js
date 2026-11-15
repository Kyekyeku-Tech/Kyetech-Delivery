import { useEffect, useRef, useState } from 'react';
import { onIdTokenChanged, signInWithCustomToken } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import { timestampMillis } from './domain';
import { activeAdminOtpSession, adminOtpIdentity, requestAdminOtp, validAdminOtpSessionId } from './adminOtp';

const empty = { scope: '', status: 'idle', error: '', challengeId: '', expiresAt: 0, resendAt: 0 };

export default function useAdminOtp({ user, eligible, sessionVersion = 0 }) {
  const [state, setState] = useState(empty);
  const active = useRef(false), identity = useRef(null), challenge = useRef(null), grantWatch = useRef(null);
  const sending = useRef(null), verifying = useRef(null), activating = useRef(null), autoSent = useRef(''), closing = useRef(false);
  const eligibleUid = eligible ? user?.uid || '' : '';
  const currentAccount = useRef({ uid: eligibleUid, version: sessionVersion });
  currentAccount.current = { uid: eligibleUid, version: sessionVersion };
  const identify = (account, result) => { const value = adminOtpIdentity(account, result); return { ...value, version: sessionVersion, scope: value.scope + ':' + sessionVersion }; };
  const current = scope => Boolean(active.current && !closing.current && identity.current?.scope === scope &&
    currentAccount.current.uid === identity.current.uid && currentAccount.current.version === identity.current.version && auth?.currentUser?.uid === identity.current.uid);
  const operationCurrent = operation => current(operation.scope) || Boolean(operation.destination && current(operation.destination));
  const exchangeFor = scope => Boolean(verifying.current && (verifying.current.scope === scope || verifying.current.destination === scope) && verifying.current.sessionId);

  function activatePending(context) {
    if (activating.current?.scope === context.scope) return activating.current.promise;
    const operation = { scope: context.scope };
    setState({ ...empty, scope: context.scope, status: 'verifying' });
    operation.promise = Promise.resolve().then(async () => {
      const account = auth.currentUser;
      if (!current(context.scope) || account.uid !== context.uid) return false;
      const result = await requestAdminOtp(await account.getIdToken(), { action: 'activate' });
      if (result.sessionId !== context.sessionId || !Number.isFinite(result.expiresAt)) throw new Error('Administrator verification could not finish. Request a new code.');
      if (!current(context.scope)) return false;
      setState({ ...empty, scope: context.scope, status: 'verified', expiresAt: result.expiresAt });
      return true;
    }).catch(cause => {
      if (current(context.scope)) setState({ ...empty, scope: context.scope, status: 'error', error: cause.message });
      return false;
    });
    // Keep the completed attempt until identity changes; metadata events must not retry a failed activation.
    activating.current = operation;
    return operation.promise;
  }

  function watchGrant(context) {
    if (grantWatch.current?.scope === context.scope) return;
    grantWatch.current?.stop();
    const watcher = { scope: context.scope, stop: () => {} };
    grantWatch.current = watcher;
    watcher.stop = onSnapshot(doc(db, 'adminOtpSessions', context.sessionId), { includeMetadataChanges: true }, snapshot => {
      if (!current(context.scope) || grantWatch.current !== watcher) return;
      if (snapshot.metadata?.fromCache) {
        setState(value => ({ ...value, scope: context.scope, status: exchangeFor(context.scope) ? 'verifying' : 'loading' }));
        return;
      }
      const session = snapshot.exists() ? snapshot.data() : null;
      if (activeAdminOtpSession(session, context)) setState({ ...empty, scope: context.scope, status: 'verified', expiresAt: timestampMillis(session.expiresAt) });
      else if (exchangeFor(context.scope)) setState(value => ({ ...value, scope: context.scope, status: 'verifying' }));
      else if (session?.status === 'pending' && session.uid === context.uid) void activatePending(context);
      else setState({ ...empty, scope: context.scope, status: 'required', error: 'Verify a new email code to continue your administrator session.' });
    }, () => {
      if (current(context.scope) && grantWatch.current === watcher) setState({ ...empty, scope: context.scope, status: 'error', error: 'Your administrator session could not be confirmed. Sign in again or request a new code.' });
    });
  }

  function sendCode() {
    const account = auth?.currentUser, context = identity.current;
    if (!account || !context || account.uid !== context.uid || !current(context.scope)) return Promise.resolve(false);
    if (sending.current?.scope === context.scope) return sending.current.promise;
    if ((verifying.current && operationCurrent(verifying.current)) || (activating.current?.scope === context.scope && state.status === 'verifying')) return Promise.resolve(false);
    const operation = { scope: context.scope };
    setState(value => ({ ...value, scope: context.scope, status: 'sending', error: '' }));
    operation.promise = Promise.resolve().then(async () => {
      const token = await account.getIdToken(true);
      if (!current(context.scope)) return false;
      const result = await requestAdminOtp(token, { action: 'send' });
      if (!validAdminOtpSessionId(result.challengeId) || !Number.isFinite(result.expiresAt) || !Number.isFinite(result.cooldownUntil)) throw new Error('The email code could not be started. Please try again.');
      if (!current(context.scope)) return false;
      challenge.current = { scope: context.scope, token, id: result.challengeId };
      setState({ scope: context.scope, status: 'sent', error: '', challengeId: result.challengeId, expiresAt: result.expiresAt, resendAt: result.cooldownUntil });
      return true;
    }).catch(cause => {
      if (current(context.scope)) setState(value => ({ ...value, scope: context.scope, status: value.challengeId ? 'sent' : 'error', error: cause.message }));
      return false;
    }).finally(() => { if (sending.current === operation) sending.current = null; });
    sending.current = operation;
    return operation.promise;
  }

  function verifyCode(code) {
    const context = identity.current, pending = challenge.current;
    if (!context || !pending || pending.scope !== context.scope || !current(context.scope)) return Promise.resolve(false);
    if (verifying.current && operationCurrent(verifying.current)) return verifying.current.promise;
    if (sending.current?.scope === context.scope) return Promise.resolve(false);
    const value = String(code || '').trim();
    if (!/^\d{4,10}$/.test(value)) { setState(currentState => ({ ...currentState, error: 'Enter the numeric code from your email.' })); return Promise.resolve(false); }
    const operation = { scope: context.scope, destination: '', sessionId: '' };
    setState(currentState => ({ ...currentState, status: 'verifying', error: '' }));
    operation.promise = Promise.resolve().then(async () => {
      const result = await requestAdminOtp(pending.token, { action: 'verify', challengeId: pending.id, code: value });
      if (!validAdminOtpSessionId(result.sessionId) || typeof result.customToken !== 'string' || !result.customToken) throw new Error('Administrator verification could not finish. Request a new code.');
      if (!current(context.scope)) return false;
      operation.sessionId = result.sessionId;
      challenge.current = null;
      const credential = await signInWithCustomToken(auth, result.customToken);
      if (!active.current || closing.current || currentAccount.current.uid !== context.uid || currentAccount.current.version !== context.version || auth.currentUser?.uid !== context.uid) return false;
      const tokenResult = await credential.user.getIdTokenResult();
      const next = identify(credential.user, tokenResult);
      if (next.sessionId !== result.sessionId || next.uid !== context.uid) throw new Error('Administrator verification could not finish. Sign in again.');
      operation.destination = next.scope;
      identity.current = next;
      watchGrant(next);
      const activated = await requestAdminOtp(tokenResult.token || await credential.user.getIdToken(), { action: 'activate' });
      if (activated.sessionId !== next.sessionId || !Number.isFinite(activated.expiresAt)) throw new Error('Administrator verification could not finish. Request a new code.');
      if (!current(next.scope)) return false;
      setState({ ...empty, scope: next.scope, status: 'verified', expiresAt: activated.expiresAt });
      return true;
    }).catch(cause => {
      if (operationCurrent(operation)) setState(currentState => ({ ...currentState, scope: identity.current.scope, status: challenge.current ? 'sent' : 'error', challengeId: challenge.current?.id || '', error: cause.message }));
      return false;
    }).finally(() => { if (verifying.current === operation) verifying.current = null; });
    verifying.current = operation;
    return operation.promise;
  }

  useEffect(() => {
    active.current = true; closing.current = false;
    if (!eligibleUid || !auth || !db) {
      identity.current = null; challenge.current = null; autoSent.current = ''; setState(empty);
      return () => { active.current = false; };
    }
    let alive = true, revision = 0;
    const stop = onIdTokenChanged(auth, async account => {
      const attempt = ++revision;
      if (!account || account.uid !== eligibleUid) return;
      try {
        const result = await account.getIdTokenResult();
        if (!alive || !active.current || attempt !== revision || currentAccount.current.uid !== eligibleUid || currentAccount.current.version !== sessionVersion || closing.current) return;
        const next = identify(account, result), changed = next.scope !== identity.current?.scope;
        if (next.sessionId && verifying.current?.sessionId === next.sessionId && verifying.current?.scope.startsWith(next.uid + ':')) verifying.current.destination = next.scope;
        identity.current = next;
        if (next.sessionId) {
          if (changed) { challenge.current = null; setState({ ...empty, scope: next.scope, status: exchangeFor(next.scope) ? 'verifying' : 'loading' }); }
          watchGrant(next);
        } else if (changed) {
          grantWatch.current?.stop(); grantWatch.current = null; challenge.current = null;
          setState({ ...empty, scope: next.scope, status: 'required' });
          if (autoSent.current !== next.scope) { autoSent.current = next.scope; void sendCode(); }
        }
      } catch {
        if (alive && active.current && currentAccount.current.uid === eligibleUid && currentAccount.current.version === sessionVersion) setState({ ...empty, status: 'error', error: 'Administrator verification could not start. Sign in again.' });
      }
    });
    return () => { alive = false; active.current = false; stop(); grantWatch.current?.stop(); grantWatch.current = null; };
  }, [eligibleUid, sessionVersion]);

  useEffect(() => {
    if (state.status !== 'verified' || !state.expiresAt) return;
    const timer = setTimeout(() => {
      if (current(state.scope)) setState({ ...empty, scope: state.scope, status: 'required', error: 'Verify a new email code to continue your administrator session.' });
    }, Math.max(0, state.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [state.status, state.scope, state.expiresAt]);

  async function revoke() {
    closing.current = true;
    setState(value => ({ ...value, status: 'loading', error: '' }));
    const context = identity.current, account = auth?.currentUser;
    if (!context?.sessionId || !account || account.uid !== context.uid) return;
    await requestAdminOtp(await account.getIdToken(), { action: 'revoke' });
  }

  const belongsToAccount = !closing.current && identity.current?.uid === eligibleUid && identity.current?.version === sessionVersion && auth?.currentUser?.uid === eligibleUid;
  return { ...state, status: !eligibleUid ? 'idle' : !belongsToAccount || (state.scope && state.scope !== identity.current?.scope) ? 'loading' : state.status,
    sendCode, verifyCode, revoke };
}
