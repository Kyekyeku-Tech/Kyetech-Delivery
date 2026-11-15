import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { usePlatform } from '../context/PlatformContext';
import { Button, Icon } from './UI';
import { locationIsFresh, locationMapUrl, locationQuery, validCoordinates } from '../lib/location';
import './live-location.css';

function RiderMap({ location, name }) {
  const container = useRef(null), mapRef = useRef(null), markerRef = useRef(null), circleRef = useRef(null);
  const { latitude, longitude, accuracy } = location;
  useEffect(() => {
    const map = L.map(container.current, { scrollWheelZoom: false }).setView([latitude, longitude], 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    const icon = L.divIcon({ className: 'live-rider-marker', html: '<span aria-hidden="true">K</span>', iconSize: [36, 36], iconAnchor: [18, 18] });
    markerRef.current = L.marker([latitude, longitude], { icon, title: name + ' location', keyboard: true }).addTo(map);
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
  return <div className="live-rider-map" ref={container} role="region" aria-label={'Map showing ' + name + ' location'}/>;
}

export function CustomerLiveLocation({ order }) {
  const { liveLocations = {} } = usePlatform();
  const location = liveLocations[order.id], [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  if (!order.riderId || !['accepted', 'picked_up'].includes(order.status)) return null;
  const available = location?.riderId === order.riderId && location.sharing && validCoordinates(location) && Number.isFinite(location.updatedAt), fresh = available && locationIsFresh(location, now);
  return <section className={'customer-live-location' + (fresh ? ' location-is-live' : '')} aria-label="Rider location">
    <div className="live-location-heading"><span className="live-location-symbol"><Icon name="map-pin"/></span><div><h4>{fresh ? 'Your rider is sharing live' : available ? 'Last shared rider location' : 'Rider live location'}</h4><p>{fresh ? 'Follow ' + (order.riderName || 'your rider') + ' on the map.' : available ? 'Waiting for a new GPS update from your rider.' : location?.error || 'Your rider can share their location during this delivery.'}</p></div>{fresh && <span className="live-location-badge">Live</span>}</div>
    {available && <>
      <RiderMap location={location} name={order.riderName || 'Your rider'}/>
      <div className="live-address"><span>GPS address</span><strong>{location.address || 'GPS pin captured. View the position on the map.'}</strong><small>{locationQuery('', location)}{location.accuracy == null ? '' : ' · Accuracy about ' + location.accuracy + ' m'}</small></div>
      <div className="live-location-footer"><time dateTime={new Date(location.updatedAt).toISOString()}>Updated {new Date(location.updatedAt).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><a className="button button-ghost" href={locationMapUrl(location.address, location)} target="_blank" rel="noreferrer">Open map<Icon name="external" size={16}/></a></div>
    </>}
  </section>;
}

export function RiderLocationControl({ order }) {
  const { riderLocationSharing, profile } = usePlatform();
  if (!riderLocationSharing || profile?.role !== 'rider' || order?.riderId !== profile.id || !['accepted', 'picked_up'].includes(order.status)) return null;
  const { sharedOrderIds, updates, errors, address, start, stop } = riderLocationSharing;
  const enabled = sharedOrderIds.includes(order.id), updatedAt = updates[order.id], error = errors[order.id];
  return <section className={'rider-location-control' + (enabled ? ' location-is-live' : '')} aria-label={'Live GPS for delivery KYE-' + order.id.slice(-6).toUpperCase()}>
    <div className="rider-delivery-location-row"><span className="live-location-symbol"><Icon name="map-pin"/></span><div><h4>{enabled ? 'Live GPS sharing is on' : 'Share your live GPS'}</h4><p>{enabled ? 'Keep this page open so this customer can follow your trip.' : 'Let this customer see where you are during their delivery.'}</p></div>{enabled ? <Button variant="secondary" onClick={() => stop(order.id)}>Stop sharing</Button> : <Button onClick={() => start(order.id)}><Icon name="map-pin" size={16}/>Share live GPS</Button>}</div>
    {enabled && address && <div className="live-address"><span>Your GPS address</span><strong>{address}</strong></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {enabled && <p className="rider-delivery-location-status" role="status">{updatedAt ? 'Location shared. Updates about every 15 seconds.' : 'Finding and sharing your position…'}</p>}
  </section>;
}
