import { useEffect, useId, useRef, useState } from 'react';
import { Brand, Button, Icon } from '../components/UI';
import { usePlatform } from '../context/PlatformContext';
import './admin-otp.css';

function remainingTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function AdminOtpPage() {
  const { user, adminOtp = {}, logout } = usePlatform();
  const [code, setCode] = useState(''), [localError, setLocalError] = useState('');
  const [pending, setPending] = useState(''), [signingOut, setSigningOut] = useState(false), [now, setNow] = useState(Date.now());
  const inputId = useId(), hintId = useId(), errorId = useId();
  const inputRef = useRef(null), actionRef = useRef(false), signOutRef = useRef(false), mounted = useRef(true);
  const scope = `${user?.uid || ''}:${adminOtp.challengeId || ''}`, currentScope = useRef(scope); currentScope.current = scope;
  const status = adminOtp.status || 'required', hasCode = Boolean(adminOtp.challengeId), verified = status === 'verified';
  const expiresAt = Number.isFinite(adminOtp.expiresAt) ? adminOtp.expiresAt : 0;
  const resendAt = Number.isFinite(adminOtp.resendAt) ? adminOtp.resendAt : 0;
  const expired = hasCode && expiresAt > 0 && expiresAt <= now;
  const resendWait = Math.max(0, resendAt - now);
  const busy = Boolean(pending || ['loading', 'sending', 'verifying'].includes(status));
  const sending = pending === 'send' || status === 'sending', verifying = pending === 'verify' || status === 'verifying';
  const error = adminOtp.error || localError || (expired ? 'This code has expired. Send a new code to continue.' : '');

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setCode(''); setLocalError(''); }, [scope]);
  useEffect(() => {
    setNow(Date.now());
    if (!expiresAt && !resendAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt, resendAt]);
  useEffect(() => { if (hasCode && !busy && !expired && !verified) inputRef.current?.focus(); }, [scope, busy, expired, verified]);

  async function run(kind) {
    if (actionRef.current || busy || signingOut || verified || (kind === 'send' && resendWait > 0)) return;
    if (kind === 'verify' && (!hasCode || expired || !code)) { setLocalError('Enter the current verification code from your email.'); inputRef.current?.focus(); return; }
    const method = kind === 'send' ? adminOtp.sendCode : adminOtp.verifyCode;
    if (typeof method !== 'function') { setLocalError('Email verification is not ready yet. Please try again.'); return; }
    const actionScope = scope;
    actionRef.current = true; setPending(kind); setLocalError('');
    try { await method(kind === 'verify' ? code : undefined); }
    catch { if (mounted.current && currentScope.current === actionScope) setLocalError(kind === 'send' ? 'The code could not be sent. Please try again.' : 'The code could not be verified. Please try again.'); }
    finally { actionRef.current = false; if (mounted.current) setPending(''); }
  }

  async function signOut() {
    if (signOutRef.current) return;
    signOutRef.current = true; setSigningOut(true); setLocalError('');
    try { await logout(); }
    catch { if (mounted.current) setLocalError('You could not be signed out. Please try again.'); }
    finally { signOutRef.current = false; if (mounted.current) setSigningOut(false); }
  }

  const announcement = status === 'loading' ? 'Preparing email verification…' : sending ? 'Sending your verification code…' : verifying ? 'Checking your code…' : verified ? 'Your administrator sign-in is verified.' : hasCode && !expired ? 'Code sent. Check your email.' : '';
  const primaryAction = !hasCode || expired ? 'send' : 'verify';
  return <main className="admin-otp-page">
    <section className="admin-otp-shell" aria-labelledby={inputId + '-heading'}>
      <header className="admin-otp-hero">
        <div className="admin-otp-brand"><Brand/></div>
        <div className="admin-otp-art" aria-hidden="true">
          <span className="admin-otp-road"/>
          <img className="admin-otp-delivery-image" src="/images/delivery.png" alt="" fetchPriority="high"/>
          <img className="admin-otp-rider-image" src="/images/rider.png" alt=""/>
        </div>
      </header>
      <div className="admin-otp-body">
        <h1 id={inputId + '-heading'} className="admin-otp-hidden">{verified ? 'Your sign-in is verified' : 'Verify your administrator sign-in'}</h1>
        <div className="admin-otp-email"><Icon name="mail" size={20}/><div><span className="admin-otp-hidden">Verification email</span><strong>{user?.email || 'Your administrator email'}</strong></div></div>
        <p className="admin-otp-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
        {!verified ? <>
          <form className="admin-otp-form" onSubmit={event => { event.preventDefault(); void run(primaryAction); }} aria-busy={busy}>
            <label htmlFor={inputId} className="admin-otp-hidden">Verification code</label>
            <input ref={inputRef} id={inputId} type="text" inputMode="numeric" autoComplete="one-time-code" autoCapitalize="off" spellCheck={false} pattern="[0-9]*" maxLength={10} value={code} onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 10)); setLocalError(''); }} disabled={!hasCode || busy || signingOut || expired} placeholder="Enter code" aria-describedby={hintId + (error ? ' ' + errorId : '')} aria-invalid={Boolean(error)} required={primaryAction === 'verify'}/>
            <p id={hintId} className="admin-otp-hidden">Use the latest code from your email.</p>
            {hasCode && expiresAt > now && <span className="admin-otp-expiry" aria-live="off">Expires {remainingTime(expiresAt - now)}</span>}
            {error && <p id={errorId} className="admin-otp-error" role="alert">{error}</p>}
            <Button type="submit" className="admin-otp-primary" busy={sending || verifying || status === 'loading'} disabled={busy || signingOut || (primaryAction === 'verify' ? !code : resendWait > 0)}>{verifying ? 'Verifying…' : sending ? 'Sending…' : primaryAction === 'verify' ? 'Verify' : expired ? 'Send new code' : 'Send code'}</Button>
          </form>
          {primaryAction === 'verify' && <div className="admin-otp-resend">
            <Button variant="ghost" disabled={busy || signingOut || resendWait > 0} onClick={() => void run('send')}>Resend code</Button>
            {resendWait > 0 && <span aria-live="off">{remainingTime(resendWait)}</span>}
          </div>}
        </> : <div className="admin-otp-verified"><Icon name="check" size={22}/><span>Verified</span></div>}
        {verified && error && <p className="admin-otp-error" role="alert">{error}</p>}
        <Button variant="ghost" className="admin-otp-signout" busy={signingOut} onClick={() => void signOut()}><Icon name="logout" size={16}/>{signingOut ? 'Signing out…' : 'Sign out'}</Button>
      </div>
    </section>
  </main>;
}
