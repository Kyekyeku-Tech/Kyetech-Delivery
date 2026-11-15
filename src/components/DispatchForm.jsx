import { useEffect, useId, useRef, useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { Button, Field, Icon } from './UI';
import { MIN_DELIVERY_FEE, formatMoney } from '../lib/domain';
import { cleanCoordinates, locationMapUrl, locationQuery, lookupGpsAddress } from '../lib/location';
import PickupStoreSelect from './PickupStoreSelect';
import './dispatch.css';

export default function DispatchForm({ initial = {}, onSuccess, notify }) {
  const { user, profile, createOrder, riders = [], stores = [] } = usePlatform();
  const packageLabelId = useId();
  const [form, setForm] = useState({ pickup: '', dropoff: '', recipientName: '', recipientPhone: '', packageDescription: '', fee: MIN_DELIVERY_FEE, preferredRiderId: '', merchantId: '', ...initial });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [locating, setLocating] = useState(false), [locationError, setLocationError] = useState(''), [dropoffLocation, setDropoffLocation] = useState(null);
  const locationRequest = useRef(0);
  const manualPickup = useRef(initial.merchantId ? '' : initial.pickup || '');
  const customer = profile.role === 'customer';
  const pickupContact = customer ? profile.phone : stores.find(store => store.id === form.merchantId)?.phone || profile.phone;
  const pickupStores = stores.filter(store => store.approvalStatus === 'approved' && store.accountStatus === 'active' && store.open !== false && store.address?.trim()).sort((a, b) => a.name.localeCompare(b.name));
  const selectedStore = customer ? pickupStores.find(store => store.id === form.merchantId) : null;
  const unavailableStore = customer && Boolean(form.merchantId) && !selectedStore;

  useEffect(() => () => { locationRequest.current += 1; }, []);

  const field = key => ({ name: key, value: form[key], onChange: event => {
    const value = event.target.value;
    if (key === 'pickup') manualPickup.current = value;
    if (key === 'dropoff') {
      locationRequest.current += 1;
      setLocating(false); setDropoffLocation(null); setLocationError('');
    }
    setForm(current => ({ ...current, [key]: value }));
  } });

  function selectStore(merchantId) {
    const store = pickupStores.find(item => item.id === merchantId);
    setError('');
    setForm(current => ({ ...current, merchantId, pickup: store?.address || manualPickup.current }));
  }

  async function useCurrentLocation() {
    if (busy || locating) return;
    setLocationError('');
    if (!window.isSecureContext || !navigator.geolocation) {
      setLocationError('Your browser cannot detect your location here. Enter the drop-off address manually.');
      return;
    }
    const request = ++locationRequest.current;
    setLocating(true);
    try {
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
      if (request !== locationRequest.current) return;
      const location = cleanCoordinates(position.coords), { accuracy } = position.coords;
      let address = locationQuery('', location);
      try { address = await lookupGpsAddress(location, user); }
      catch { if (request === locationRequest.current) setLocationError('GPS pin captured. The street address could not be found; you can enter a nearby landmark instead.'); }
      if (request !== locationRequest.current) return;
      setForm(current => ({ ...current, dropoff: address }));
      setDropoffLocation({ ...location, address, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.ceil(accuracy) : null });
    } catch (cause) {
      if (request !== locationRequest.current) return;
      setLocationError(cause.code === 1 ? 'Allow location access in your browser, or enter the drop-off address manually.' : cause.code === 3 ? 'Location detection timed out. Try again or enter the drop-off address manually.' : 'Your location could not be detected. Try again or enter the drop-off address manually.');
    } finally {
      if (request === locationRequest.current) setLocating(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || locating) return;
    if (unavailableStore) { setError('Choose an available pickup store or enter a pickup address.'); return; }
    setBusy(true); setError('');
    try {
      const id = await createOrder({ ...form, dropoffLocation: cleanCoordinates(dropoffLocation), ...(selectedStore ? { pickup: selectedStore.address } : {}) });
      notify?.('Your delivery request has been sent.'); onSuccess?.(id);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="stack dispatch-form">
    <div className="dispatch-hero">
      <div className="dispatch-hero-copy">
        <span className="dispatch-eyebrow">KyeTech Delivery</span>
        <h2>Let’s get it moving.</h2>
        <p>Tell us where to collect and deliver your package.</p>
      </div>
      <span className="dispatch-hero-art" aria-hidden="true"><Icon name="bike" size={54}/></span>
    </div>

    <div className="dispatch-route-grid">
      <section className="dispatch-panel dispatch-pickup" aria-label="Pickup location">
        <header className="dispatch-panel-heading">
          <span className="dispatch-panel-icon"><Icon name="store"/></span>
          <div><span className="dispatch-step">01 · Collect here</span><h3>Pickup location</h3></div>
        </header>
        <div className="stack dispatch-panel-fields">
          {customer && <PickupStoreSelect stores={pickupStores} value={form.merchantId} onChange={selectStore} disabled={busy}/>}
          <Field label="Pickup address" {...field('pickup')} value={selectedStore?.address || form.pickup} readOnly={customer && Boolean(form.merchantId)} required maxLength={250} placeholder="Street, area and a nearby landmark"/>
          {unavailableStore && <p className="form-error" role="alert">Choose another store or enter a pickup address.</p>}
        </div>
      </section>

      <section className="dispatch-panel dispatch-destination" aria-label="Drop-off location">
        <header className="dispatch-panel-heading">
          <span className="dispatch-panel-icon"><Icon name="map-pin"/></span>
          <div><span className="dispatch-step">02 · Deliver here</span><h3>Drop-off location</h3></div>
        </header>
        <div className="dispatch-dropoff stack">
          <Field label="Drop-off address" {...field('dropoff')} required maxLength={250} placeholder="Where should the package go?"/>
          {customer && <>
            <div className="dispatch-location-actions">
              <Button className="dispatch-gps-button" variant="secondary" busy={locating} disabled={busy} onClick={useCurrentLocation}><Icon name="map-pin"/>{locating ? 'Finding your location…' : 'Use my current location'}</Button>
              {dropoffLocation && <a className="button button-ghost" href={locationMapUrl(form.dropoff, dropoffLocation)} target="_blank" rel="noreferrer">View on map<Icon name="external" size={16}/></a>}
            </div>
            {dropoffLocation && <div className="gps-address-details"><span>GPS address</span><strong>{dropoffLocation.address}</strong><small>{locationQuery('', dropoffLocation)}</small></div>}
            <p className="muted dispatch-location-hint" role="status">{locating ? 'Finding your location. You can type an address to continue manually.' : dropoffLocation ? 'Current location added' + (dropoffLocation.accuracy === null ? '.' : ' (accurate to about ' + dropoffLocation.accuracy + ' m).') + ' Check that this is your delivery destination.' : 'Use your current location if you are receiving the package here.'}</p>
            {locationError && <p className="form-error" role="alert">{locationError}</p>}
          </>}
        </div>
      </section>
    </div>

    <section className="dispatch-panel dispatch-package" aria-label="Recipient and package">
      <header className="dispatch-panel-heading">
        <span className="dispatch-panel-icon"><Icon name="package"/></span>
        <div><span className="dispatch-step">03 · The little details</span><h3>Recipient &amp; package</h3></div>
      </header>
      <div className="stack dispatch-panel-fields">
        <div className="form-grid">
          <Field label="Recipient name" {...field('recipientName')} required maxLength={100} placeholder="Full name"/>
          <Field label="Recipient phone" {...field('recipientPhone')} required type="tel" maxLength={25} placeholder="024 123 4567"/>
        </div>
        <label className="field"><span className="field-label" id={packageLabelId}>Package details</span><textarea aria-labelledby={packageLabelId} {...field('packageDescription')} required maxLength={1000} rows={3} placeholder="What are you sending? Include handling instructions."/></label>
      </div>
    </section>

    <section className="dispatch-panel dispatch-payment" aria-label="Rider and payment">
      <header className="dispatch-panel-heading">
        <span className="dispatch-panel-icon"><Icon name="wallet"/></span>
        <div><span className="dispatch-step">04 · Ready for the road</span><h3>Rider &amp; payment</h3></div>
        <span className="dispatch-cash-badge">Pay in cash</span>
      </header>
      <div className="stack dispatch-panel-fields">
        <div className="form-grid">
          <Field label="Delivery fee you offer (GHS)" {...field('fee')} required type="number" min={MIN_DELIVERY_FEE} max={10000} step="0.01"/>
          <label className="field"><span className="field-label">Rider preference</span><select aria-label="Rider preference" {...field('preferredRiderId')}><option value="">Any available rider</option>{riders.filter(rider => rider.online || rider.id === form.preferredRiderId).map(rider => <option key={rider.id} value={rider.id}>{rider.name}{!rider.online ? ' (offline)' : ''}</option>)}</select></label>
        </div>
        <p className="dispatch-payment-note"><Icon name="check" size={16}/>Fees start at GH₵ 15. Pay the agreed fee directly in cash.</p>
      </div>
    </section>

    <div className="dispatch-contact"><Icon name="phone" size={16}/><span>Pickup contact</span><strong>{pickupContact}</strong></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <footer className="dispatch-submit">
      <div className="dispatch-fee-summary"><span>Your offered fee</span><strong>{formatMoney(form.fee)}</strong></div>
      <Button type="submit" className="dispatch-send-button" busy={busy} disabled={locating}><Icon name="send"/>Send delivery request<Icon name="arrow-right"/></Button>
    </footer>
  </form>;
}
