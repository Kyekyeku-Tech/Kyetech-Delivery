import { useEffect, useId, useRef, useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { Button, EmptyState, Field, Icon, SafeImage } from './UI';
import PhotoUpload from './PhotoUpload';
import useStoreCatalog from '../lib/useStoreCatalog';
import { filterStoreListings, MAX_LISTING_PRICE } from '../lib/storeCatalog';
import { formatMoney, normalizeGhanaPhone } from '../lib/domain';
import './store-catalog.css';

const blank = kind => ({ kind, name: '', category: '', description: '', price: '', imageUrl: '', available: true });

export default function StoreCatalog({ store, notify, browse = false, onBack, onDispatch }) {
  const { profile } = usePlatform();
  const catalog = useStoreCatalog(store), canManage = catalog.canManage && !browse;
  const [search, setSearch] = useState(''), [kind, setKind] = useState('all'), [category, setCategory] = useState('All'), [availability, setAvailability] = useState('all');
  const [editor, setEditor] = useState(null), [removing, setRemoving] = useState(''), [busy, setBusy] = useState(false), [photoUploading, setPhotoUploading] = useState(false), [error, setError] = useState('');
  const descriptionId = useId(), searchInput = useRef(null), editorRef = useRef(null), catalogRef = useRef(null), alive = useRef(false), operation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current += 1; }; }, []);
  useEffect(() => { operation.current += 1; setEditor(null); setRemoving(''); setError(''); setBusy(false); setSearch(''); setCategory('All'); setKind('all'); setAvailability('all'); }, [store?.id, profile?.id, canManage]);
  useEffect(() => { if (editor) editorRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [Boolean(editor)]);
  useEffect(() => {
    const body = catalogRef.current?.closest('.modal-body');
    if (body) { body.scrollTop = 0; catalogRef.current?.querySelector('.catalog-back')?.focus({ preventScroll: true }); }
  }, [store?.id]);

  if (!store) return <div className="store-catalog">{onBack && <Button variant="secondary" onClick={onBack}><Icon name="arrow-left"/>Back to stores</Button>}<EmptyState icon="store" title="Add your store first" description="Set up your store details to start listing products and menu items."/></div>;

  const phone = normalizeGhanaPhone(store.phone);
  const categories = ['All', ...new Set(catalog.items.map(item => item.category).filter(Boolean))];
  const visible = filterStoreListings(catalog.items, { search, kind, category: categories.includes(category) ? category : 'All', availability });
  const productCount = catalog.items.filter(item => item.kind === 'product').length, menuCount = catalog.items.length - productCount;
  const canRequest = store.open && store.approvalStatus === 'approved' && (store.accountStatus || 'active') === 'active';
  const HeroTitle = browse ? 'h2' : 'h1';

  async function run(task, message, after) {
    if (busy || photoUploading) return;
    const token = ++operation.current;
    setBusy(true); setError('');
    try {
      await task();
      if (!alive.current || token !== operation.current) return;
      notify?.(message); after?.();
    } catch (cause) { if (alive.current && token === operation.current) setError(cause.message || 'This change could not be saved. Please try again.'); }
    finally { if (alive.current && token === operation.current) setBusy(false); }
  }
  function edit(item) { setError(''); setRemoving(''); setEditor({ ...item }); }
  const field = key => ({ value: editor?.[key] ?? '', disabled: busy, onChange: event => setEditor(value => ({ ...value, [key]: event.target.value })) });
  const request = item => onDispatch?.({ pickup: store.address, merchantId: store.id, ...(item ? { packageDescription: item.name } : {}) });

  return <section className={'store-catalog' + (browse ? ' catalog-browse' : '')} aria-label="Store products and menu" ref={catalogRef}>
    {onBack && <Button variant="secondary" className="catalog-back" onClick={onBack}><Icon name="arrow-left" size={17}/>Back to stores</Button>}
    <header className="catalog-hero"><div><span>{browse ? store.name : 'YOUR STORE’S COLLECTION'}</span><HeroTitle>Products & menu</HeroTitle><p>{browse ? 'Explore this store’s listings. Call to arrange your items, then request a rider.' : 'Show customers what you sell with clear photos, prices and availability.'}</p></div><span className="catalog-hero-icon" aria-hidden="true"><Icon name="package" size={38}/></span></header>
    {!editor && <>
      <div className="catalog-summary"><div><Icon name="package" size={20}/><strong>{productCount}</strong><span>{productCount === 1 ? 'Product' : 'Products'}</span></div><div><Icon name="menu" size={20}/><strong>{menuCount}</strong><span>{menuCount === 1 ? 'Menu item' : 'Menu items'}</span></div></div>
      {canManage && <div className="catalog-add-actions"><Button onClick={() => edit(blank('product'))} disabled={busy}><Icon name="plus" size={18}/>Add product</Button><Button variant="secondary" onClick={() => edit(blank('menu'))} disabled={busy}><Icon name="plus" size={18}/>Add menu item</Button></div>}
      {!canManage && !browse && <p className="catalog-note"><Icon name="eye" size={18}/>You can browse this store’s available listings. Accepted store team members can manage products and menu items.</p>}
      <div className="catalog-tools"><label className="catalog-search"><Icon name="search" size={19}/><input type="search" ref={searchInput} aria-label="Search products and menu" placeholder="Search items, categories or descriptions" value={search} onChange={event => setSearch(event.target.value)}/>{search && <button type="button" aria-label="Clear listing search" onClick={() => { setSearch(''); searchInput.current?.focus(); }}><Icon name="x" size={17}/></button>}</label>
        <div className="catalog-filters" role="group" aria-label="Listing type">{[['all', 'All items'], ['product', 'Products'], ['menu', 'Menu']].map(([value, label]) => <button type="button" className={'catalog-chip' + (kind === value ? ' catalog-chip-selected' : '')} aria-pressed={kind === value} key={value} onClick={() => setKind(value)}>{label}</button>)}</div>
        <div className="catalog-selects"><label className="field"><span className="field-label">Category</span><select aria-label="Listing category filter" value={categories.includes(category) ? category : 'All'} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>{!browse && <label className="field"><span className="field-label">Availability</span><select aria-label="Listing availability filter" value={availability} onChange={event => setAvailability(event.target.value)}><option value="all">All listings</option><option value="available">Available</option><option value="unavailable">Unavailable</option></select></label>}</div>
      </div>
    </>}

    {editor && canManage && <form className="catalog-editor" ref={editorRef} onSubmit={event => { event.preventDefault(); if (!busy && !photoUploading) run(() => catalog.save(editor, editor.id), editor.id ? 'Your listing has been updated.' : 'Your listing has been added.', () => setEditor(null)); }}>
      <div className="catalog-editor-heading"><span><Icon name={editor.kind === 'menu' ? 'menu' : 'package'} size={22}/></span><div><small>{editor.id ? 'KEEP YOUR STORE UP TO DATE' : 'ADD SOMETHING CUSTOMERS WILL LOVE'}</small><h3>{editor.id ? 'Edit listing' : editor.kind === 'menu' ? 'Add menu item' : 'Add product'}</h3></div></div>
      <div className="catalog-editor-kind" role="group" aria-label="Choose listing type">{[['product', 'Product', 'package'], ['menu', 'Menu item', 'menu']].map(([value, label, icon]) => <button type="button" key={value} aria-pressed={editor.kind === value} disabled={busy || photoUploading} className={'catalog-kind-choice' + (editor.kind === value ? ' is-chosen' : '')} onClick={() => setEditor(item => ({ ...item, kind: value }))}><Icon name={icon} size={21}/>{label}</button>)}</div>
      <div className="catalog-editor-fields"><Field label="Item name" {...field('name')} required maxLength={100} placeholder={editor.kind === 'menu' ? 'Jollof rice with chicken' : 'Fresh fruit basket'}/><div className="form-grid"><Field label="Category" {...field('category')} required maxLength={60} placeholder="Meals, drinks, groceries…"/><Field label="Price (GH₵)" {...field('price')} required type="number" inputMode="decimal" min={0} max={MAX_LISTING_PRICE} step="0.01" placeholder="0.00"/></div><label className="field" htmlFor={descriptionId}><span className="field-label" id={descriptionId + '-label'}>Description (optional)</span><textarea id={descriptionId} aria-labelledby={descriptionId + '-label'} {...field('description')} maxLength={1000} rows={3} placeholder="Sizes, ingredients or other details customers should know."/></label>
        <div className="catalog-photo"><PhotoUpload kind="store" label="Item photo" value={editor.imageUrl} disabled={busy} onChange={imageUrl => setEditor(value => ({ ...value, imageUrl }))} onUploadingChange={setPhotoUploading}/></div>
        <label className="catalog-available-option"><input type="checkbox" checked={editor.available} disabled={busy} onChange={event => setEditor(value => ({ ...value, available: event.target.checked }))}/><span><strong>Available for customers</strong><small>Turn this off when the item is out of stock or off the menu.</small></span></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="catalog-editor-actions"><Button variant="secondary" disabled={busy || photoUploading} onClick={() => { setEditor(null); setError(''); }}>Cancel editing</Button><Button type="submit" busy={busy} disabled={photoUploading}><Icon name="check" size={18}/>{editor.id ? 'Save changes' : 'Save listing'}</Button></div>
    </form>}

    {!editor && <>
      {error && <p className="form-error" role="alert">{error}</p>}
      {catalog.loading ? <div className="catalog-loading" role="status"><span className="spinner"/>Loading this store’s listings…</div> : catalog.error ? <EmptyState icon="store" title="Listings could not be loaded" description={catalog.error} action={<Button variant="secondary" onClick={catalog.retry}>Try again</Button>}/> : !catalog.canRead ? <EmptyState icon="store" title="Listings are not available" description="Return to the store directory to explore another store."/> : <>
        <p className="catalog-result-count" role="status">{visible.length} {visible.length === 1 ? 'listing' : 'listings'}</p>
        <div className="catalog-grid">{visible.map(item => <article className={'catalog-item' + (!item.available ? ' catalog-item-unavailable' : '')} aria-label={item.name} key={item.id}><div className="catalog-item-photo">{item.imageUrl ? <SafeImage src={item.imageUrl} alt={item.name} loading="lazy"/> : <span className={'catalog-item-placeholder' + (item.kind === 'menu' ? ' catalog-placeholder-menu' : '')} aria-hidden="true"><Icon name={item.kind === 'menu' ? 'menu' : 'package'} size={54}/></span>}<span className={'catalog-item-badge' + (item.kind === 'menu' ? ' catalog-badge-menu' : '')}>{item.kind === 'menu' ? 'Menu' : 'Product'}</span></div><div className="catalog-item-body"><span className="catalog-item-category">{item.category}</span><h3>{item.name}</h3>{item.description && <p className="catalog-item-description">{item.description}</p>}<div className="catalog-item-meta"><strong>{formatMoney(item.price)}</strong><span className={item.available ? 'catalog-stock-available' : 'catalog-stock-unavailable'}><span/>{item.available ? 'Available' : 'Unavailable'}</span></div>
          {canManage && <div className="catalog-item-actions"><Button variant="secondary" disabled={busy || photoUploading} onClick={() => edit(item)} aria-label={'Edit ' + item.name}><Icon name="edit" size={16}/>Edit</Button><Button variant="secondary" disabled={busy || photoUploading} onClick={() => run(() => catalog.setAvailable(item.id, !item.available), item.available ? 'Item marked unavailable.' : 'Item is available again.')} aria-label={'Mark ' + item.name + (item.available ? ' unavailable' : ' available')}><Icon name={item.available ? 'eye-off' : 'eye'} size={16}/>{item.available ? 'Unavailable' : 'Available'}</Button><Button variant="ghost" className="catalog-remove" disabled={busy || photoUploading} onClick={() => { setRemoving(item.id); setError(''); }} aria-label={'Remove ' + item.name}><Icon name="x" size={16}/>Remove</Button></div>}
          {removing === item.id && canManage && <div className="catalog-remove-confirm"><p>Remove this listing from your store?</p><div><Button variant="secondary" disabled={busy} onClick={() => setRemoving('')}>Keep listing</Button><Button variant="danger" busy={busy} aria-label={'Confirm removal of ' + item.name} onClick={() => run(() => catalog.remove(item.id), 'Listing removed.', () => setRemoving(''))}>Remove listing</Button></div></div>}
          {browse && onDispatch && <Button className="catalog-request-item" variant="secondary" disabled={!item.available || !canRequest} onClick={() => request(item)} aria-label={'Request delivery for ' + item.name}><Icon name="send" size={16}/>Request delivery</Button>}
        </div></article>)}</div>
        {!visible.length && <EmptyState icon={kind === 'menu' ? 'menu' : 'package'} title={catalog.items.length ? 'No items match these filters' : canManage ? 'Your first listing starts here' : 'This store has no available listings yet'} description={catalog.items.length ? 'Try another search, category or listing type.' : canManage ? 'Add a product or menu item with a photo and price.' : 'Call the store to ask what is available today.'} action={catalog.items.length ? <Button variant="secondary" onClick={() => { setSearch(''); setKind('all'); setCategory('All'); setAvailability('all'); }}>Show all listings</Button> : canManage ? <Button onClick={() => edit(blank('product'))}><Icon name="plus" size={17}/>Add your first listing</Button> : undefined}/>}
      </>}
      {browse && <div className="catalog-contact"><p><Icon name="phone" size={18}/>{store.open ? 'Call to confirm your items and arrange payment with the store.' : 'This store is closed. You can browse the listings and call about opening times.'}</p><div>{phone && <a className="button button-secondary" href={'tel:' + phone} aria-label={'Call store ' + store.name}><Icon name="phone" size={17}/>Call store</a>}{onDispatch && <Button disabled={!canRequest} onClick={() => request()}><Icon name="send" size={17}/>Request delivery</Button>}</div></div>}
    </>}
  </section>;
}
