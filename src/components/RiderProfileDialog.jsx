import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, SafeImage } from './UI';
import { getBike, isSafeImageUrl, normalizeGhanaPhone } from '../lib/domain';
import './rider-profile.css';

export default function RiderProfileDialog({ rider, onClose }) {
  const dialog = useRef(null), photoButton = useRef(null), photoBack = useRef(null);
  const nameId = useId(), titleId = useId();
  const [photoFailed, setPhotoFailed] = useState(false), [expanded, setExpanded] = useState(false);
  const name = rider.name || 'Your rider';
  const photoUrl = isSafeImageUrl(rider.photoUrl) ? rider.photoUrl.trim() : '';
  const photoAvailable = Boolean(photoUrl && !photoFailed);
  const photo = photoAvailable ? photoUrl : '/images/rider.png';
  const phone = normalizeGhanaPhone(rider.phone);
  const motorcycle = [rider.bikeBrand, rider.bikeModel].filter(Boolean).join(' ');
  const bike = getBike(rider.bikeBrand, rider.bikeModel);

  useEffect(() => { setPhotoFailed(false); }, [photoUrl]);
  useEffect(() => {
    const current = dialog.current, previous = document.activeElement;
    current.showModal();
    return () => {
      current.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  function showPhoto() {
    setExpanded(true);
    requestAnimationFrame(() => photoBack.current?.focus());
  }
  function showProfile() {
    setExpanded(false);
    requestAnimationFrame(() => photoButton.current?.focus());
  }
  const portrait = <img src={photo} alt={photoAvailable ? name + ' profile photo' : 'Delivery rider illustration'} referrerPolicy="no-referrer" width={360} height={360} onError={() => setPhotoFailed(true)}/>;

  return createPortal(<dialog ref={dialog} className="rider-profile-dialog" aria-labelledby={nameId + ' ' + titleId}
    onCancel={event => { event.preventDefault(); if (expanded) showProfile(); else onClose(); }}
    onKeyDown={event => {
      // The directory/delivery dialog has its own document-level keyboard handlers.
      if (event.key === 'Tab' || event.key === 'Escape') event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (expanded) showProfile(); else onClose(); }
      if (event.key === 'Tab') {
        const items = [...dialog.current.querySelectorAll('button:not(:disabled),a[href]')];
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className="rider-profile-header"><div><h2 id={nameId}>{name}</h2><p id={titleId}>Rider profile</p></div><button type="button" className="rider-profile-close" aria-label="Close rider profile" autoFocus onClick={onClose}><Icon name="x" size={20}/></button></header>
    <div className={'rider-profile-body' + (expanded ? ' rider-profile-photo-expanded' : '')}>
      {expanded ? <><button ref={photoBack} type="button" className="button button-secondary rider-profile-photo-back" onClick={showProfile}><Icon name="arrow-left" size={18}/>Back to profile</button><div className="rider-profile-expanded-image">{portrait}</div>{!photoAvailable && <p className="rider-profile-photo-note">This rider's profile photo is unavailable.</p>}</> : <>
        <div className="rider-profile-photo-panel"><button ref={photoButton} type="button" className="rider-profile-photo-button" aria-label={'Enlarge profile photo for ' + name} onClick={showPhoto}>{portrait}<span><Icon name="search" size={17}/>View photo</span></button>{!photoAvailable && <p className="rider-profile-photo-note">This rider's profile photo is unavailable.</p>}</div>
        <div className="rider-profile-details">
          <div className="rider-profile-badges"><span className={'rider-profile-availability' + (!rider.online ? ' rider-profile-offline' : '')}><span/>{rider.online ? 'Online now' : 'Offline'}</span>{rider.approvalStatus === 'approved' && <span className="rider-profile-approved"><Icon name="check" size={15}/>Approved rider</span>}</div>
          <dl className="rider-profile-info"><div><dt>City / service area</dt><dd>{rider.city || 'Not added'}</dd></div><div><dt>Phone number</dt><dd>{phone || 'Not added'}</dd></div></dl>
          <section className="rider-profile-motorcycle" aria-label="Rider motorcycle"><div><h3>Motorcycle</h3><strong>{motorcycle || 'Details not added'}</strong><p><span>Plate number</span>{rider.plate || 'Not added'}</p></div>{motorcycle && <SafeImage src={bike.image} alt={motorcycle + ' motorcycle'} fallback="/images/others_bike.png"/>}</section>
          {phone && <a className="button rider-profile-call" href={'tel:' + phone} aria-label={'Call rider ' + name}><Icon name="phone" size={18}/>Call rider</a>}
        </div>
      </>}
    </div>
  </dialog>, document.body);
}
