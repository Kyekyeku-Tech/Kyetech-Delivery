import { useEffect, useId, useRef, useState } from 'react';
import { matchesDirectorySearch } from '../lib/directory';
import { Icon } from './UI';
import './pickup-store-select.css';

export default function PickupStoreSelect({ stores, value, onChange, disabled = false }) {
  const id = useId(), root = useRef(null), input = useRef(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const selected = stores.find(store => store.id === value), unavailable = Boolean(value) && !selected;
  const matches = stores.filter(store => matchesDirectorySearch(query, store.name, store.address, store.category));
  const manual = { id: '', name: 'Enter a pickup address', address: 'Use another store or a location of your own.' };
  const options = query.trim() ? [...matches, manual] : [manual, ...matches];
  const optionKey = options.map(option => option.id).join('|');
  const hint = unavailable ? 'The selected store is unavailable. Search again or choose a manual address.' : selected ? 'Pickup address filled from ' + selected.name + '.' : stores.length ? 'Search by store name, area or category, then choose a store.' : 'No stores are available right now. Enter your pickup address below.';

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (open) setActive(query.trim() ? 0 : Math.max(0, options.findIndex(option => option.id === value)));
  }, [open, query, optionKey, value]);
  useEffect(() => {
    if (open) root.current?.querySelector('[data-option-index="' + active + '"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);
  useEffect(() => {
    function closeOutside(event) { if (!root.current?.contains(event.target)) setOpen(false); }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('focusin', closeOutside); };
  }, []);

  function choose(option) {
    if (disabled || !option) return;
    onChange(option.id); setOpen(false); setQuery('');
  }
  function keyDown(event) {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(''); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setQuery(''); setOpen(true); return; }
      setActive(current => (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open) choose(options[active]); else { setQuery(''); setOpen(true); }
    } else if (open && (event.key === 'Home' || event.key === 'End') && !query) {
      event.preventDefault(); setActive(event.key === 'Home' ? 0 : options.length - 1);
    } else if (event.key === 'Tab') { setOpen(false); setQuery(''); }
  }

  return <div className={'pickup-store-select field' + (open ? ' picker-open' : '')} ref={root}>
    <label className="field-label" htmlFor={id}>Pickup store (optional)</label>
    <div className="pickup-store-input-wrap">
      <Icon name="search" size={18}/>
      <input ref={input} id={id} role="combobox" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={disabled}
        aria-expanded={open} aria-autocomplete="list" aria-controls={id + '-options'} aria-describedby={id + '-hint'} aria-invalid={unavailable || undefined}
        aria-activedescendant={open ? id + '-option-' + active : undefined}
        value={open ? query : selected?.name || (unavailable ? 'Selected store is unavailable' : '')}
        placeholder="Search or select a store"
        onFocus={() => { setQuery(''); setOpen(true); }}
        onClick={() => { if (!open) { setQuery(''); setOpen(true); } }}
        onChange={event => { setQuery(event.target.value); setOpen(true); }} onKeyDown={keyDown}/>
      <button type="button" tabIndex={-1} disabled={disabled} aria-label={open ? 'Close pickup store choices' : 'Show pickup store choices'} onMouseDown={event => event.preventDefault()} onClick={() => {
        if (open) { setOpen(false); setQuery(''); } else { input.current?.focus(); setQuery(''); setOpen(true); }
      }}><Icon name="chevron-right" size={18}/></button>
    </div>
    <input type="hidden" name="merchantId" value={value}/>
    <small id={id + '-hint'}>{hint}</small>
    {open && <div className="pickup-store-popup">
      <div className="pickup-store-results" role="status">{matches.length} {matches.length === 1 ? 'store' : 'stores'} {query.trim() ? 'found' : 'available'}</div>
      <div className="pickup-store-options" id={id + '-options'} role="listbox" aria-label="Pickup stores">
        {options.map((option, index) => <div key={option.id} id={id + '-option-' + index} role="option" aria-selected={value === option.id} data-option-index={index}
          data-store-id={option.id} className={'pickup-store-option' + (active === index ? ' option-active' : '') + (!option.id ? ' option-manual' : '')}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(option)} onMouseMove={() => setActive(index)}>
          <span className="pickup-option-icon"><Icon name={option.id ? 'store' : 'map-pin'} size={18}/></span>
          <div><strong>{option.name}</strong><small>{option.address}</small>{option.id && <span>{option.category}</span>}</div>
          {value === option.id && <Icon name="check" size={18} className="pickup-option-check"/>}
        </div>)}
      </div>
      {query.trim() && !matches.length && <p className="pickup-store-no-results">No stores match this search. Try another name or area, or use a pickup address.</p>}
    </div>}
  </div>;
}
