import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { usePlatform } from '../context/PlatformContext';
import { Button, Icon } from './UI';
import { isSafeImageUrl } from '../lib/domain';
import RiderProfileDialog from './RiderProfileDialog';
import { locationIsFresh, locationMapUrl, validCoordinates } from '../lib/location';
import './live-location.css';

function riderMapIcon(photoUrl) {
  const hasPhoto = isSafeImageUrl(photoUrl);
  const image = document.createElement('img');
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';
  image.width = 38;
  image.height = 38;
  image.dataset.loading = 'true';
  image.className = hasPhoto ? 'live-rider-photo' : 'live-rider-illustration';
  image.onload = () => { delete image.dataset.loading; };
  image.onerror = () => {
    image.onerror = null;
    image.dataset.loading = 'true';
    image.className = 'live-rider-illustration';
    image.src = '/images/rider.png';
  };
  image.src = hasPhoto ? photoUrl.trim() : '/images/rider.png';
  return L.divIcon({ className: 'live-rider-marker', html: image, iconSize: [44, 44], iconAnchor: [22, 22] });
}

function readableRiderArea(value) {
  if (typeof value !== 'string') return '';
  const address = value.trim();
  const parts = address.split(',').map(part => part.trim()).filter(Boolean);
  const looksLikeStreet = name => /^\d|^[A-Z]{1,3}[- ]?\d+$/i.test(name)
    || /\b(?:road|street|avenue|lane|drive|highway|circle|close|crescent|junction|bypass|footway|pedestrian|alley)\b/i.test(name);
  if (parts.length >= 2 && /^Ghana$/i.test(parts.at(-1)) && /\bRegion$/i.test(parts.at(-2))) {
    const area = parts.at(-3);
    // Older tracking values included street, region and country. A road alone is not a town.
    return area && !looksLikeStreet(area) ? area : parts.at(-2);
  }
  return parts.length === 1 && looksLikeStreet(address) ? '' : address;
}

function RiderMap({ location, name, photoUrl, onViewProfile }) {
  const container = useRef(null), mapRef = useRef(null), markerRef = useRef(null), circleRef = useRef(null);
  const profileAction = useRef(onViewProfile); profileAction.current = onViewProfile;
  const { latitude, longitude, accuracy } = location;
  useEffect(() => {
    const map = L.map(container.current, { scrollWheelZoom: false }).setView([latitude, longitude], 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    const icon = riderMapIcon(photoUrl);
    markerRef.current = L.marker([latitude, longitude], { icon, title: name + ' location', keyboard: true }).addTo(map);
    markerRef.current.on('click', () => profileAction.current?.());
    circleRef.current = L.circle([latitude, longitude], { radius: accuracy || 0, color: '#347dc1', weight: 1, fillOpacity: 0.1 }).addTo(map);
    mapRef.current = map;
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(container.current);
    return () => { resize.disconnect(); map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const point = [latitude, longitude];
    markerRef.current?.setLatLng(point);
    circleRef.current?.setLatLng(point).setRadius(accuracy || 0);
    mapRef.current?.panTo(point, { animate: false });
  }, [latitude, longitude, accuracy]);
  useEffect(() => {
    markerRef.current?.setIcon(riderMapIcon(photoUrl));
    const marker = markerRef.current?.getElement();
    marker?.setAttribute('aria-label', name + ' location' + (profileAction.current ? '. View rider profile' : ''));
    marker?.setAttribute('title', name + ' location');
  }, [name, photoUrl]);
  useEffect(() => {
    const marker = markerRef.current?.getElement();
    if (!marker) return;
    marker.setAttribute('aria-label', name + ' location' + (onViewProfile ? '. View rider profile' : ''));
    const onSpace = event => {
      if (event.key === ' ' && profileAction.current) { event.preventDefault(); event.stopPropagation(); profileAction.current(); }
    };
    marker.addEventListener('keydown', onSpace);
    return () => marker.removeEventListener('keydown', onSpace);
  }, [name, Boolean(onViewProfile)]);
  return <div className="live-rider-map" ref={container} role="region" aria-label={'Map showing ' + name + ' location'}/>;
}

export function CustomerLiveLocation({ order }) {
  const { liveLocations = {}, riders = [] } = usePlatform();
  const rider = riders.find(candidate => candidate.id === order.riderId);
  const riderName = order.riderName || rider?.name || 'Your rider';
  const location = liveLocations[order.id], [now, setNow] = useState(Date.now()), [profileOpen, setProfileOpen] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (profileOpen && !rider) setProfileOpen(false); }, [profileOpen, rider]);
  if (!order.riderId || !['accepted', 'picked_up'].includes(order.status)) return null;
  const available = location?.riderId === order.riderId && location.sharing && validCoordinates(location) && Number.isFinite(location.updatedAt), fresh = available && locationIsFresh(location, now);
  const area = readableRiderArea(location?.address);
  return <section className={'customer-live-location' + (fresh ? ' location-is-live' : '')} aria-label="Rider location">
    <div className="live-location-heading"><span className="live-location-symbol"><Icon name="map-pin"/></span><div><h4>{fresh ? 'Your rider is sharing live' : available ? 'Last shared rider location' : 'Rider live location'}</h4><p>{fresh ? 'Follow ' + (order.riderName || 'your rider') + ' on the map.' : available ? 'Waiting for a new GPS update from your rider.' : location?.error || 'Your rider can share their location during this delivery.'}</p></div>{fresh && <span className="live-location-badge">Live</span>}</div>
    {available && <div className="live-location-body">
      <RiderMap location={location} name={riderName} photoUrl={rider?.photoUrl} onViewProfile={rider ? () => setProfileOpen(true) : undefined}/>
      <div className="live-location-details">
        <div className="live-address live-locality" role="status" aria-live="polite" aria-atomic="true"><span>{fresh ? 'Current town or area' : 'Last known town or area'}</span><strong>{area || (fresh ? 'Locating town or area…' : 'Town or area unavailable')}</strong></div>
        <div className="live-location-footer"><time dateTime={new Date(location.updatedAt).toISOString()}>Updated {new Date(location.updatedAt).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><a className="button button-ghost" href={locationMapUrl(location.address, location)} target="_blank" rel="noreferrer">Open map<Icon name="external" size={16}/></a></div>
        {rider && <Button variant="secondary" className="live-rider-profile-action" onClick={() => setProfileOpen(true)}><Icon name="user" size={17}/>View rider profile</Button>}
      </div>
    </div>}
    {profileOpen && rider && <RiderProfileDialog rider={rider} onClose={() => setProfileOpen(false)}/>}
  </section>;
}

export function RiderLocationControl({ order }) {
  const { riderLocationSharing, profile } = usePlatform();
  if (!riderLocationSharing || profile?.role !== 'rider' || order?.riderId !== profile.id || !['accepted', 'picked_up'].includes(order.status)) return null;
  const { sharedOrderIds, updates, errors, address, start, stop } = riderLocationSharing;
  const enabled = sharedOrderIds.includes(order.id), updatedAt = updates[order.id], error = errors[order.id];
  return <section className={'rider-location-control' + (enabled ? ' location-is-live' : '')} aria-label={'Live GPS for delivery KYE-' + order.id.slice(-6).toUpperCase()}>
    <div className="rider-delivery-location-row"><span className="live-location-symbol"><Icon name="map-pin"/></span><div><h4>{enabled ? 'Live GPS sharing is on' : 'Share your live GPS'}</h4><p>{enabled ? 'Keep this page open so this customer can follow your trip.' : 'Let this customer see where you are during their delivery.'}</p></div>{enabled ? <Button variant="secondary" onClick={() => stop(order.id)}>Stop sharing</Button> : <Button onClick={() => start(order.id)}><Icon name="map-pin" size={16}/>Share live GPS</Button>}</div>
    {enabled && address && <div className="live-address"><span>Your town / area</span><strong>{address}</strong></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {enabled && <p className="rider-delivery-location-status" role="status">{updatedAt ? 'Location shared. Updates about every 15 seconds.' : 'Finding and sharing your position…'}</p>}
  </section>;
}
