import { useRef, useState } from 'react';
import { Avatar, Button, EmptyState, Icon, SafeImage } from './UI';
import { getBike, normalizeGhanaPhone } from '../lib/domain';
import { matchesDirectorySearch } from '../lib/directory';
import StoreCatalog from './StoreCatalog';
import './customer-directory.css';

function DirectorySearch({ kind, value, onChange }) {
  const input = useRef(null);
  return <label className="directory-search"><Icon name="search" size={20}/><input ref={input} type="search" aria-label={'Search ' + kind} value={value} onChange={event => onChange(event.target.value)} placeholder={kind === 'stores' ? 'Store name, area or category' : 'Rider name, area or motorcycle'}/>{value && <button type="button" aria-label={'Clear ' + kind + ' search'} onClick={() => { onChange(''); input.current?.focus(); }}><Icon name="x" size={17}/></button>}</label>;
}

export function StoreDirectory({ stores, onDispatch }) {
  const [search, setSearch] = useState(''), [category, setCategory] = useState('All'), [openOnly, setOpenOnly] = useState(false), [selectedId, setSelectedId] = useState('');
  const catalogueButton = useRef(null);
  if (selectedId) return <div className="customer-directory store-directory"><StoreCatalog key={selectedId} store={stores.find(store => store.id === selectedId)} browse onDispatch={onDispatch} onBack={() => { const storeId = catalogueButton.current; setSelectedId(''); requestAnimationFrame(() => [...document.querySelectorAll('[data-store-catalog]')].find(button => button.dataset.storeCatalog === storeId)?.focus()); }}/></div>;
  const categories = ['All', ...new Set(stores.map(store => store.category).filter(Boolean))];
  const matches = stores.filter(store => (category === 'All' || store.category === category) && (!openOnly || store.open) && matchesDirectorySearch(search, store.name, store.address, store.category, store.description))
    .sort((a, b) => Number(Boolean(b.open)) - Number(Boolean(a.open)) || a.name.localeCompare(b.name));
  const openCount = stores.filter(store => store.open).length;
  return <div className="customer-directory store-directory">
    <div className="directory-hero"><div><span className="directory-eyebrow">SHOP THE KYETECH COMMUNITY</span><h2>Local favourites.<br/>Ready for your doorstep.</h2><p>Find a store, arrange your purchase and let a rider bring it to you.</p><span className="directory-hero-count"><span className="directory-online-dot"/>{openCount} {openCount === 1 ? 'store' : 'stores'} open now</span></div><span className="directory-hero-symbol" aria-hidden="true"><Icon name="store" size={48}/></span></div>
    <div className="directory-tools">
      <DirectorySearch kind="stores" value={search} onChange={setSearch}/>
      <div className="directory-categories" role="group" aria-label="Store categories">{categories.map(value => <button type="button" key={value} className={'directory-chip' + (category === value ? ' directory-chip-active' : '')} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div>
      <div className="directory-results-row"><p role="status">{matches.length} {matches.length === 1 ? 'store' : 'stores'} to explore</p><button type="button" className={'directory-open-filter' + (openOnly ? ' is-selected' : '')} aria-pressed={openOnly} onClick={() => setOpenOnly(value => !value)}><span className="directory-online-dot"/>Open now{openOnly && <Icon name="check" size={14}/>}</button></div>
    </div>
    <div className="directory-grid directory-store-grid">{matches.map(store => {
      const phone = normalizeGhanaPhone(store.phone);
      return <article className="store-card directory-store-card" key={store.id} aria-label={store.name}>
        <div className="directory-store-photo"><SafeImage src={store.imageUrl} alt={store.name} loading="lazy"/><span className={'directory-availability' + (!store.open ? ' availability-offline' : '')}><span/>{store.open ? 'Open now' : 'Closed'}</span></div>
        <div className="directory-store-body"><span className="directory-category">{store.category}</span><h3>{store.name}</h3>{store.description && <p className="directory-description">{store.description}</p>}<p className="directory-address"><Icon name="map-pin" size={17}/><span>{store.address}</span></p><Button variant="secondary" className="directory-browse-catalog" data-store-catalog={store.id} aria-label={'Browse products and menu at ' + store.name} onClick={() => { catalogueButton.current = store.id; setSelectedId(store.id); }}><Icon name="package" size={18}/>Products & menu</Button><div className="directory-card-actions">{phone && <a className="button button-secondary directory-call" href={'tel:' + phone} aria-label={'Call store ' + store.name}><Icon name="phone" size={18}/>Call store</a>}<Button disabled={!store.open} onClick={() => onDispatch({ pickup: store.address, merchantId: store.id })}><Icon name="send" size={18}/>Request delivery</Button></div></div>
      </article>;
    })}</div>
    {!matches.length && <EmptyState icon="store" title={stores.length ? 'No stores match just yet' : 'Our store community is growing'} description={stores.length ? 'Try another name, area or category. You can also turn off the open filter.' : 'Stores will appear here once they are ready to serve customers.'} action={stores.length ? <Button variant="secondary" onClick={() => { setSearch(''); setCategory('All'); setOpenOnly(false); }}>Show all stores</Button> : undefined}/>}
    <div className="directory-tip"><Icon name="phone" size={20}/><p><strong>A quick call gets things started.</strong>Call the store to arrange your items, then request a rider for pickup.</p></div>
  </div>;
}

export function RiderDirectory({ riders, onDispatch }) {
  const [search, setSearch] = useState(''), [onlineOnly, setOnlineOnly] = useState(false);
  const online = riders.filter(rider => rider.online).length;
  const matches = riders.filter(rider => (!onlineOnly || rider.online) && matchesDirectorySearch(search, rider.name, rider.city, rider.bikeBrand, rider.bikeModel))
    .sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)) || a.name.localeCompare(b.name));
  return <div className="customer-directory rider-directory">
    <div className="directory-tools"><DirectorySearch kind="riders" value={search} onChange={setSearch}/><div className="directory-results-row"><div className="directory-rider-filters" role="group" aria-label="Rider availability"><button type="button" className={'directory-chip' + (!onlineOnly ? ' directory-chip-active' : '')} aria-pressed={!onlineOnly} onClick={() => setOnlineOnly(false)}>All riders</button><button type="button" className={'directory-chip' + (onlineOnly ? ' directory-chip-active' : '')} aria-pressed={onlineOnly} onClick={() => setOnlineOnly(true)}><span className="directory-online-dot"/>Online now</button></div><p role="status">{matches.length} {matches.length === 1 ? 'rider' : 'riders'}</p></div></div>
    <div className="directory-grid directory-rider-grid">{matches.map(rider => {
      const phone = normalizeGhanaPhone(rider.phone), bike = getBike(rider.bikeBrand, rider.bikeModel);
      return <article className="directory-rider-card" key={rider.id} aria-label={rider.name}>
        <div className="directory-rider-heading"><Avatar name={rider.name} src={rider.photoUrl} size={58}/><div><span className={'directory-availability' + (!rider.online ? ' availability-offline' : '')}><span/>{rider.online ? 'Online now' : 'Offline'}</span><h3>{rider.name}</h3><p><Icon name="map-pin" size={15}/>{rider.city}</p></div></div>
        <div className="directory-rider-bike"><div><span>Your ride</span><strong>{[rider.bikeBrand, rider.bikeModel].filter(Boolean).join(' ') || 'Motorcycle'}</strong>{rider.plate && <small>{rider.plate}</small>}</div><SafeImage src={bike.image} alt={rider.bikeBrand ? rider.bikeBrand + ' motorcycle' : 'Motorcycle'} loading="lazy"/></div>
        <div className="directory-card-actions">{phone && <a className="button button-secondary directory-call" href={'tel:' + phone} aria-label={'Call rider ' + rider.name}><Icon name="phone" size={18}/>Call rider</a>}<Button disabled={!rider.online} onClick={() => onDispatch({ preferredRiderId: rider.id })}><Icon name="send" size={18}/>Request rider</Button></div>
        <p className="directory-rider-note">{rider.online ? 'Ready to receive your delivery request.' : 'You can call now. Requests open when this rider is online.'}</p>
      </article>;
    })}</div>
    {!matches.length && <EmptyState icon="bike" title={riders.length ? 'No riders match this search' : 'Your next rider is on the way'} description={riders.length ? 'Try another name, area or motorcycle, or browse all riders.' : 'Riders will appear here as they join. You can send a request for the next available rider.'} action={riders.length ? <Button variant="secondary" onClick={() => { setSearch(''); setOnlineOnly(false); }}>Show all riders</Button> : <Button onClick={() => onDispatch({})}>Send request</Button>}/>}
    <div className="directory-tip"><Icon name="phone" size={20}/><p><strong>Say hello before the pickup.</strong>Use Call rider to explain your package and destination, then send your request.</p></div>
  </div>;
}
