import { useEffect, useId, useRef, useState } from 'react';
import { STATUS_LABELS, formatMoney, timestampMillis } from '../lib/domain';
import './brand.css';

const paths = {
  download: <><path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/></>,
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-8h6v8"/></>,
  store: <><path d="M3 9h18l-2-6H5L3 9Zm1 4v8h16v-8M9 21v-6h6v6"/><path d="M3 9v2a3 3 0 0 0 6 0V9m0 2a3 3 0 0 0 6 0V9m0 2a3 3 0 0 0 6 0V9"/></>,
  bike: <><circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="M8 17h6l3-9h-6l-3 5H5m10-9h3l2 7"/><circle cx="10" cy="5" r="2"/></>,
  send: <><path d="m22 2-7 20-4-9-9-4 20-7Zm0 0L11 13"/></>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>,
  message: <><path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z"/><path d="M8 9h8M8 13h5"/></>,
  package: <><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10v10M3 7l9 5 9-5M8 4l9 5"/></>,
  user: <><circle cx="12" cy="7" r="4"/><path d="M4 21v-3a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v3"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  'arrow-right': <path d="M4 12h16m-6-6 6 6-6 6"/>,
  'arrow-left': <path d="M20 12H4m6-6-6 6 6 6"/>,
  'chevron-right': <path d="m9 5 7 7-7 7"/>,
  'map-pin': <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>,
  phone: <path d="M8 3H4a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-4l-5-2-2 3a13 13 0 0 1-7-7l3-2-2-5Z"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  wallet: <><path d="M20 8H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13v5M3 6v13a2 2 0 0 0 2 2h15V8"/><path d="M20 12h-6v5h6m-3-3h.01"/></>,
  chart: <path d="M4 20h17M7 16v-5m5 5V4m5 12V8"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  edit: <><path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/></>,
  search: <><circle cx="10" cy="10" r="7"/><path d="m16 16 5 5"/></>,
  x: <path d="m6 6 12 12M6 18 18 6"/>,
  logout: <><path d="M9 3H4v18h5m6-16 6 7-6 7m-6-7h12"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3H9Z"/></>,
  external: <><path d="M14 3h7v7m0-7L10 14M9 3H3v18h18v-6"/></>,
  shield: <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z"/><path d="m8 11 3 3 5-5"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  'eye-off': <><path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 4M6 6C3.4 8.3 2 12 2 12s3.5 7 10 7a10 10 0 0 0 5-1.4M10 10a3 3 0 0 0 4 4"/></>,
  truck: <><path d="M2 4h12v13H2V4Zm12 5h4l4 5v3h-8"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4M12 2v2"/></>,
};
export function Icon({name,size=22,className=''}) { return <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.package}</svg>; }
export function RequestNotification({count,compact=false,className=''}) {
  if (!count) return null;
  return <span className={`request-notification ${compact?'request-notification-compact':''} ${className}`} role="img" aria-label={`${count} incoming delivery ${count===1?'request':'requests'}`}>
    {!compact&&<Icon name="bell" size={14}/>}{count>99?'99+':count}
  </span>;
}
export function Brand() { return <div className="brand"><img className="brand-logo" src="/images/logo.png" alt="" width={52} height={52} decoding="async"/><div className="brand-copy"><strong>KyeTech</strong><small>Delivery service</small></div></div>; }
export function Button({children,variant='primary',busy=false,className='',type='button',...props}) { return <button type={type} className={`button button-${variant} ${className}`} {...props} disabled={busy || props.disabled}>{busy && <span className="spinner"/>}{children}</button>; }
export function Field({label,hint,...props}) { const id=useId();return <label className="field" htmlFor={id}><span className="field-label">{label}</span><input id={id} {...props}/>{hint && <small>{hint}</small>}</label>; }
export function Card({children,className=''}) { return <div className={`card ${className}`}>{children}</div>; }
export function MetricCard({ icon, label, value, detail, tone = 'blue', className = '' }) {
  return <Card className={'stat-card metric-card metric-' + tone + ' ' + className}>
    <div className="metric-heading"><span className="metric-icon"><Icon name={icon}/></span><p className="metric-label">{label}</p></div>
    <strong className="metric-value">{value}</strong>
    <p className="metric-detail">{detail}</p>
  </Card>;
}
export function SectionHeading({title,subtitle,action}) { return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div>{action}</div>; }
export function EmptyState({icon='package',title,description,action}) { return <Card><div className="empty-state"><span className="empty-icon"><Icon name={icon}/></span><h3>{title}</h3><p>{description}</p>{action}</div></Card>; }
export function SafeImage({src,alt,className='',fallback='/images/store-placeholder.svg',...props}) {
  const [failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{setFailed(false);setAttempt(0);},[src]);
  useEffect(()=>{
    if(!src || !failed)return;
    function retry(){setFailed(false);setAttempt(value=>value+1);}
    const timer=attempt===0?setTimeout(retry,1000):null;
    window.addEventListener('online',retry);
    return()=>{clearTimeout(timer);window.removeEventListener('online',retry);};
  },[src,failed,attempt]);
  return <img key={src+':'+attempt} src={!src || failed ? fallback : src} alt={alt} className={className} referrerPolicy="no-referrer" onError={event=>{if(event.currentTarget.getAttribute('src')!==fallback)setFailed(true);}} {...props}/>;
}
export function Avatar({name='',src,size=42}) { const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[src]);return <span className="avatar" style={{width:size,height:size}}>{src && !failed ? <img src={src} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/> : name.split(' ').filter(Boolean).map(s=>s[0]).slice(0,2).join('').toUpperCase() || 'K'}</span>; }
export function StatusBadge({status}) { return <span className={`status-badge status-${status}`}>{STATUS_LABELS[status] || status}</span>; }
export function Modal({title,children,onClose}) {
  const ref=useRef(null),closeRef=useRef(onClose); const id=useId(); closeRef.current=onClose;
  useEffect(()=>{const previous=document.activeElement;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';ref.current?.querySelector('button,input,select,textarea,a[href]')?.focus();function key(e){if(e.key==='Escape'){closeRef.current();return;}if(e.key!=='Tab')return;const items=[...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')];const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}document.addEventListener('keydown',key);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);previous?.focus();};},[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={id}><header className="modal-header"><h2 id={id}>{title}</h2><button className="modal-close" aria-label="Close dialog" onClick={onClose}><Icon name="x"/></button></header><div className="modal-body">{children}</div></section></div>;
}
export function RatingStars({value,onChange}) { return <div className="rating-stars" role="group" aria-label="Choose a rating">{[1,2,3,4,5].map(n=><button type="button" key={n} className={`star-button ${n<=value?'star-active':''}`} aria-label={`${n} stars`} aria-pressed={value===n} onClick={()=>onChange(n)}><Icon name="star" size={30}/></button>)}</div>; }
export function OrderCard({order,children}) { const date=timestampMillis(order.createdAt);return <Card className={`order-card order-${order.status}`}><div className="row"><div><h3>KYE-{order.id.slice(-6).toUpperCase()}</h3><small>{date?new Date(date).toLocaleDateString('en-GH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Sending request…'}</small></div><StatusBadge status={order.status}/></div><div className="route"><span className="route-line"/><div className="route-point"><span className="route-dot"/><div><small>PICKUP</small><strong>{order.pickup}</strong></div></div><div className="route-point"><span className="route-dot"/><div><small>DROP-OFF</small><strong>{order.dropoff}</strong></div></div></div><div className="order-meta"><span><Icon name="package"/>{order.packageDescription}</span><strong className="amount">{formatMoney(order.fee)}</strong></div>{order.riderName && <p className="muted" style={{marginTop:12}}>Rider: {order.riderName}</p>}{children && <div className="card-actions">{children}</div>}</Card>; }
