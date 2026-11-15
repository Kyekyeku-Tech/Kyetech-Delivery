import { useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { Button, Card, Field, Icon, SafeImage, SectionHeading } from '../components/UI';
import PhotoUpload from '../components/PhotoUpload';
import { BIKE_CATALOG } from '../lib/domain';

export default function ProfilePage({ notify }) {
  const { profile, saveProfile, logout, resetPassword } = usePlatform();
  const [form, setForm] = useState({ ...profile });
  const [busy, setBusy] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [error, setError] = useState('');
  const field = key => ({
    value: form[key] || '',
    onChange: event => setForm(current => ({ ...current, [key]: event.target.value })),
  });

  async function submit(event) {
    event.preventDefault();
    if (busy || photoUploading) return;
    setBusy(true); setError('');
    try {
      await saveProfile(form);
      notify('Your profile has been updated.');
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  const brand = BIKE_CATALOG.find(bike => bike.brand === form.bikeBrand);
  return <>
    <h1 className="sr-only">Your profile</h1>
    <div className="settings-grid">
      <section className="profile-card">
        <div className="profile-hero">
          <div><h2>{profile.name}</h2><p>{profile.email}</p><span className="status-badge">{profile.role} · KYE-{profile.id.slice(-6).toUpperCase()}</span></div>
        </div>
        <form className="profile-form stack" onSubmit={submit}>
          <SectionHeading title="Personal details" />
          <PhotoUpload value={form.photoUrl || ''} name={form.name} disabled={busy}
            onChange={photoUrl => setForm(current => ({ ...current, photoUrl }))}
            onUploadingChange={setPhotoUploading} />
          <div className="form-grid">
            <Field label="Full name" {...field('name')} required maxLength={100} />
            <Field label="Phone number" {...field('phone')} required type="tel" maxLength={25} />
            <Field label="City / service area" {...field('city')} required maxLength={100} />
          </div>
          {profile.role === 'rider' && <>
            <SectionHeading title="Your motorcycle" subtitle="Choose your brand and model from our fleet library." />
            <div className="brand-grid" role="group" aria-label="Motorcycle brand">
              {BIKE_CATALOG.map(bike => <button type="button" key={bike.brand}
                className={'brand-option ' + (form.bikeBrand === bike.brand ? 'brand-option-active' : '')}
                aria-pressed={form.bikeBrand === bike.brand}
                onClick={() => setForm(current => ({ ...current, bikeBrand: bike.brand, bikeModel: bike.models[0].name }))}>
                <SafeImage src={bike.logo} alt="" className="brand-image" />{bike.brand}
              </button>)}
            </div>
            {brand && <div className="bike-grid" role="group" aria-label="Motorcycle model">
              {brand.models.map(bike => <button type="button" key={bike.name}
                className={'bike-option ' + (form.bikeModel === bike.name ? 'bike-option-active' : '')}
                aria-pressed={form.bikeModel === bike.name}
                onClick={() => setForm(current => ({ ...current, bikeModel: bike.name }))}>
                <SafeImage src={bike.image} alt={bike.name} className="bike-image" />{bike.name}
              </button>)}
            </div>}
            <Field label="Motorcycle plate number" {...field('plate')} maxLength={40} placeholder="WR 1234-26" />
            <p className="notice"><Icon name="bike" />Save your brand, model and plate before going online. Customers will see your rider details.</p>
          </>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" busy={busy} disabled={photoUploading}>Save changes<Icon name="check" /></Button>
           <div className="menu-list">
          <Button variant="secondary" busy={busy} disabled={photoUploading} onClick={async () => {
            setBusy(true);
            try { await resetPassword(profile.email); notify('Password reset email requested. Check your inbox.'); }
            catch (cause) { setError(cause.message); }
            finally { setBusy(false); }
          }}><Icon name="lock" />Reset password</Button>
          <Button variant="ghost" onClick={() => logout().catch(cause => notify(cause.message, 'error'))}><Icon name="logout" />Sign out</Button>
        </div>
        </form>
      </section>
      
        
       
     
    </div>
  </>;
}
