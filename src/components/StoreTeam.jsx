import { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { Button, Field, Icon } from './UI';
import './store-team.css';

export default function StoreTeam({ store, notify }) {
  const { profile, storeTeam } = usePlatform(), [email, setEmail] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!storeTeam || store?.ownerId !== profile.id) return null;
  const invitations = storeTeam.invitations.filter(invite => invite.storeId === store.id && invite.status !== 'revoked');
  async function run(task, message) { setBusy(true); setError(''); try { await task(); notify?.(message); setEmail(''); } catch (cause) { setError(storeTeam.friendlyError(cause)); } finally { setBusy(false); } }
  return <section className="store-team-panel" aria-label="Store team">
    <header className="store-team-heading"><span><Icon name="user"/></span><div><h2>Your store team</h2><p>Add someone to manage your products and deliveries.</p></div></header>
    <form className="store-team-invite" onSubmit={event => { event.preventDefault(); void run(() => storeTeam.invite(email), 'Store invitation saved. Ask your team member to sign in with this email and accept it.'); }}>
      <Field label="Team member email" type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} placeholder="teammate@example.com"/>
      <Button type="submit" busy={busy}><Icon name="plus"/>Add team member</Button>
    </form>
    <p className="store-team-note"><Icon name="shield" size={16}/>Team members sign up as merchants, verify their email and accept your invitation. They can manage products and deliveries. You manage the store profile and team access.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="store-team-list">{invitations.map(invite => <div className="store-team-person" key={invite.id}><div><strong>{storeTeam.members.find(member => member.inviteId === invite.id)?.name || invite.email}</strong><small>{invite.email}</small></div><span className={'status-badge ' + (invite.status === 'accepted' ? 'status-delivered' : '')}>{invite.status === 'accepted' ? 'Products & deliveries' : 'Invitation pending'}</span><Button variant="ghost" disabled={busy} onClick={() => run(() => storeTeam.revoke(invite.id), 'Store access removed.')}>Remove access</Button></div>)}{!invitations.length && <p className="store-team-empty">Your team members will appear here.</p>}</div>
  </section>;
}

export function MerchantStoreAccess({ notify }) {
  const { user, profile, storeTeam } = usePlatform(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!storeTeam || profile?.role !== 'merchant') return null;
  const incoming = storeTeam.invitations.filter(invite => invite.email === String(user.email || profile.email).toLowerCase() && invite.status === 'pending');
  async function run(task, message) { setBusy(true); setError(''); try { await task(); notify?.(message); } catch (cause) { setError(storeTeam.friendlyError(cause)); } finally { setBusy(false); } }
  if (!incoming.length && !storeTeam.error && !error) return null;
  return <section className="merchant-store-access" aria-label="Your store access">
    {incoming.map(invite => <div className="store-invitation" key={invite.id}><span><Icon name="store"/></span><div><h3>{invite.storeName} invited you</h3><p>Accept to manage this store’s products and deliveries.</p></div><div className="store-invitation-actions"><Button disabled={busy} onClick={() => run(() => storeTeam.verifyEmail(), 'Check your email for the verification link, then return here to accept the store invitation.')}>Verify email</Button><Button variant="secondary" busy={busy} onClick={() => run(() => storeTeam.accept(invite.id), 'Store access accepted. Your store workspace is ready.')}>Accept invitation</Button></div></div>)}
    {(error || storeTeam.error) && <p className="form-error" role="alert">{error || storeTeam.error}</p>}
    {storeTeam.error && storeTeam.retry && <Button variant="secondary" disabled={busy || storeTeam.loading} onClick={storeTeam.retry}>Retry store access</Button>}
  </section>;
}
