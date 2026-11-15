import { useId, useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { Button, Icon } from '../components/UI';
import '../auth.css';

const accountTypes = [
  { value: 'customer', label: 'Customer' },
  { value: 'rider', label: 'Rider' },
  { value: 'merchant', label: 'Merchant' },
];

export default function AuthPage({ recovery = false }) {
  const { user, register, login, resetPassword, saveProfile, firebaseConfigured, error: platformError, clearError } = usePlatform();
  const [mode, setMode] = useState(recovery ? 'setup' : 'login');
  const [role, setRole] = useState('customer');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({
    name: user?.displayName || '', email: user?.email || '', phone: '',
    password: '', city: 'Sekondi–Takoradi',
  });
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const creating = mode === 'register' || mode === 'setup';
  const currentError = error || platformError;
  const field = key => ({
    value: form[key],
    onChange: event => setForm(current => ({ ...current, [key]: event.target.value })),
  });

  function changeMode(next) {
    setMode(next); setError(''); setNotice(''); setShowPassword(false); clearError();
  }

  function changeRole(next) {
    setRole(next); setError(''); clearError();
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'login') await login(form.email, form.password);
      else if (mode === 'reset') {
        await resetPassword(form.email);
        setNotice('If an account uses this email, a password reset link will arrive shortly.');
      } else if (mode === 'setup') await saveProfile({ ...form, role, online: false });
      else await register({ ...form, role });
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="login-screen">
      <section className={'login-card ' + (creating ? 'is-register' : '')} aria-label="KyeTech account access">
        <header className="login-hero">
          <div className="login-heading">
            <h1>Welcome to <span>KyeTech</span></h1>
            <p>Your city. Your delivery.</p>
          </div>
          <div className="login-hero-art" aria-hidden="true">
            <span className="login-road" />
            <img className="login-delivery-image" src="/images/delivery.png" alt="" fetchPriority="high" />
            <img className="login-rider-image" src="/images/rider.png" alt="" />
          </div>
        </header>

        <div className="login-body">
          {creating && (
            <div className="login-account-switch" role="group" aria-label="Account type">
              {accountTypes.map(account => (
                <button key={account.value} type="button"
                  className={'login-account-tab ' + (role === account.value ? 'is-active' : '')}
                  aria-pressed={role === account.value} disabled={busy}
                  onClick={() => changeRole(account.value)}>
                  {account.label}
                </button>
              ))}
            </div>
          )}

          {mode !== 'login' && (
            <div className="login-mode-heading">
              <h2>{mode === 'setup' ? 'Finish your account' : mode === 'reset' ? 'Reset password' : 'Create your account'}</h2>
              <p>{mode === 'reset' ? 'Enter your email and we’ll send you a reset link.' : 'A few details and your ' + role + ' account is ready to go.'}</p>
            </div>
          )}

          <form className="login-form" onSubmit={submit} aria-label={creating ? 'Create account' : mode === 'reset' ? 'Reset password' : 'Login'}>
            {creating && (
              <div className="login-extra-fields">
                <label className="login-field"><span>Full name</span><input {...field('name')} required maxLength={100} autoComplete="name" placeholder="Your full name" /></label>
                <label className="login-field"><span>Phone number</span><input {...field('phone')} required type="tel" maxLength={25} autoComplete="tel" placeholder="024 123 4567" /></label>
                <label className="login-field"><span>City / service area</span><input {...field('city')} required maxLength={100} autoComplete="address-level2" /></label>
              </div>
            )}

            <div className="login-field-group">
              <label className="login-input-row" htmlFor={emailId}>
                <Icon name="user" className="login-input-icon" />
                <div>
                  <span className="login-field-label">Email address</span>
                  <input id={emailId} className="login-input" {...field('email')} required type="email" autoComplete="email" placeholder="you@example.com" disabled={mode === 'setup' || busy} aria-describedby={currentError ? errorId : undefined} />
                </div>
              </label>
              {mode !== 'reset' && mode !== 'setup' && (
                <div className="login-input-row">
                  <label className="login-input-label" htmlFor={passwordId}>
                    <Icon name="lock" className="login-input-icon" />
                    <div>
                      <span className="login-field-label">Password</span>
                      <input id={passwordId} className="login-input" {...field('password')} type={showPassword ? 'text' : 'password'} required minLength={6} autoComplete={creating ? 'new-password' : 'current-password'} placeholder={creating ? 'At least 6 characters' : 'Enter your password'} disabled={busy} aria-describedby={currentError ? errorId : undefined} />
                    </div>
                  </label>
                  <button className="login-password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={busy} onClick={() => setShowPassword(value => !value)}>
                    <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
                  </button>
                </div>
              )}
            </div>

            {mode === 'login' ? (
              <div className="login-form-extra"><button type="button" className="login-reset" disabled={busy} onClick={() => changeMode('reset')}>Reset Password</button></div>
            ) : <div className="login-form-extra" />}

            {currentError && <p id={errorId} className="login-error" role="alert">{currentError}</p>}
            {notice && <p className="login-notice" role="status">{notice}</p>}

            <Button type="submit" className="login-primary" busy={busy} disabled={!firebaseConfigured}>
              {mode === 'setup' ? 'Save account details' : mode === 'register' ? 'Sign Up' : mode === 'reset' ? 'Send reset link' : 'Login'}
            </Button>
          </form>

          {!recovery && (
            <Button variant="secondary" className="login-secondary" disabled={busy} onClick={() => changeMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Sign Up' : 'Back to Login'}
            </Button>
          )}
          <p className="login-footer">Sekondi–Takoradi · Local deliveries</p>
        </div>
        <div className="login-bottom-accent" aria-hidden="true"><img className="login-accent-logo" src="/images/logo.png" alt="" width={32} height={32} decoding="async"/></div>
      </section>
    </main>
  );
}
