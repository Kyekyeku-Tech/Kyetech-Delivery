import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { Button, Field, Icon } from './UI';
import PhotoUpload from './PhotoUpload';
import { cleanCoordinates, locationMapUrl, locationQuery, lookupGpsAddress } from '../lib/location';
import './store-form.css';

const categories = ['Food & drinks', 'Groceries', 'Pharmacy', 'Retail', 'Other'];

export default function StoreForm({ initial = {}, notify, onSuccess, onWorkingChange }) {
  const { user, profile, saveStore } = usePlatform();
  const [form, setForm] = useState({ name: '', category: 'Food & drinks', address: '', phone: profile.phone, imageUrl: '', description: '', open: true, location: null, gpsAddress: '', ...initial });
  const [busy, setBusy] = useState(false), [photoUploading, setPhotoUploading] = useState(false), [error, setError] = useState('');
  const [locating, setLocating] = useState(false), [locationError, setLocationError] = useState(''), [accuracy, setAccuracy] = useState(null);
  const locationRequest = useRef(0);
  useEffect(() => () => { locationRequest.current += 1; }, []);
  useEffect(() => {
    onWorkingChange?.(busy || photoUploading);
    return () => onWorkingChange?.(false);
  }, [busy, photoUploading, onWorkingChange]);

  const field = key => ({ value: form[key] || '', onChange: event => {
    const value = event.target.value;
    if (key === 'address') { locationRequest.current += 1; setLocating(false); setLocationError(''); }
    setForm(current => ({ ...current, [key]: value }));
  } });

  async function captureLocation() {
    if (busy || locating) return;
    setLocationError('');
    if (!window.isSecureContext || !navigator.geolocation) {
      setLocationError('Your browser cannot detect your location here. Enter the store address manually.');
      return;
    }
    const request = ++locationRequest.current;
    setLocating(true);
    try {
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }));
      if (request !== locationRequest.current) return;
      const location = cleanCoordinates(position.coords);
      setForm(current => ({ ...current, location, gpsAddress: '' }));
      setAccuracy(Number.isFinite(position.coords.accuracy) ? Math.ceil(position.coords.accuracy) : null);
      try {
        const address = await lookupGpsAddress(location, user);
        if (request !== locationRequest.current) return;
        setForm(current => ({ ...current, address, gpsAddress: address }));
      } catch {
        if (request === locationRequest.current) setLocationError('GPS pin captured. The street address could not be found; enter your store address or a nearby landmark.');
      }
    } catch (cause) {
      if (request !== locationRequest.current) return;
      setLocationError(cause?.code === 1 ? 'Allow location access in your browser, or enter the store address manually.' : cause?.code === 3 ? 'Location detection timed out. Try again while you are at your store.' : 'Your location could not be detected. Try again or use your store address.');
    } finally { if (request === locationRequest.current) setLocating(false); }
  }

  function removeLocation() {
    locationRequest.current += 1;
    setLocating(false); setLocationError(''); setAccuracy(null);
    setForm(current => ({ ...current, location: null, gpsAddress: '' }));
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || photoUploading || locating) return;
    setBusy(true); setError('');
    try {
      await saveStore(form);
      notify?.('Your store details have been saved.');
      onSuccess?.();
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  return <form className="stack store-setup-form" onSubmit={submit}>
    <div className="store-setup-hero">
      <div><span className="store-setup-eyebrow">Your business, closer to everyone</span><h2>Give your store a home.</h2><p>A great photo and a clear pickup point help customers and riders find you.</p></div>
      <span className="store-setup-art" aria-hidden="true"><Icon name="store" size={46}/></span>
    </div>

    <section className="store-setup-panel store-setup-identity" aria-label="Store details">
      <header className="store-setup-heading"><span className="store-setup-icon"><Icon name="store"/></span><div><span>01 · Meet your business</span><h3>Store details</h3></div></header>
      <div className="stack store-setup-fields">
        <div className="form-grid"><Field label="Store name" {...field('name')} required maxLength={100} placeholder="What is your store called?"/><label className="field"><span className="field-label">Category</span><select aria-label="Category" {...field('category')}>{categories.map(category => <option key={category}>{category}</option>)}</select></label></div>
        <Field label="Store phone" {...field('phone')} required type="tel" maxLength={25} placeholder="024 123 4567"/>
        <label className="field"><span className="field-label">About your store</span><textarea {...field('description')} maxLength={1000} rows={3} placeholder="Tell customers what they can find at your store."/></label>
      </div>
    </section>

    <section className="store-setup-panel store-setup-photo" aria-label="Store photo">
      <header className="store-setup-heading"><span className="store-setup-icon"><Icon name="plus"/></span><div><span>02 · Make a good first impression</span><h3>Show your storefront</h3></div></header>
      <PhotoUpload kind="store" label="Store photo" value={form.imageUrl || ''} disabled={busy} onChange={imageUrl => setForm(current => ({ ...current, imageUrl }))} onUploadingChange={setPhotoUploading}/>
    </section>

    <section className="store-setup-panel store-setup-location" aria-label="Store pickup location">
      <header className="store-setup-heading"><span className="store-setup-icon"><Icon name="map-pin"/></span><div><span>03 · Help your rider find you</span><h3>Your pickup point</h3></div></header>
      <div className="stack store-setup-fields">
        <Field label="Store address" {...field('address')} required maxLength={250} placeholder="Street, area and a nearby landmark"/>
        <div className="store-location-actions"><Button variant="secondary" className="store-gps-button" busy={locating} disabled={busy} onClick={captureLocation}><Icon name="map-pin"/>{locating ? 'Finding your store…' : 'Use current location'}</Button>{form.location && <Button variant="ghost" disabled={busy} onClick={removeLocation}>Remove GPS pin</Button>}</div>
        <p className="store-location-hint" role="status">{locating ? 'Finding your current position. Keep this form open while your location is detected.' : accuracy !== null && form.location ? 'Location captured (accurate to about ' + accuracy + ' m). Check the map before saving.' : 'Tap while you are at your store to add a GPS pin for rider directions.'}</p>
        {form.location && <div className="store-gps-pin"><span className="store-pin-symbol"><Icon name="check"/></span><div><span>GPS address</span><strong>{form.gpsAddress || form.address || 'Store GPS pin'}</strong><small>{locationQuery('', form.location)}</small></div><a className="button button-ghost" href={locationMapUrl(form.address, form.location)} target="_blank" rel="noreferrer">View on map<Icon name="external" size={16}/></a></div>}
        {locationError && <p className="form-error" role="alert">{locationError}</p>}
      </div>
    </section>

    <label className="store-opening-option"><input type="checkbox" checked={form.open} onChange={event => setForm(current => ({ ...current, open: event.target.checked }))}/><span><strong>Open and ready for customers</strong><small>Show customers when your store is ready to take orders.</small></span><Icon name="clock"/></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer className="store-setup-submit"><p><Icon name="check" size={16}/>Save your details to keep your store up to date.</p><Button type="submit" className="store-save-button" busy={busy} disabled={photoUploading || locating}>Save store<Icon name="arrow-right"/></Button></footer>
  </form>;
}
