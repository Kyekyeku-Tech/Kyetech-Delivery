import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '../context/PlatformContext';
import { Button, Card, EmptyState, Icon, Modal, OrderCard, SectionHeading } from '../components/UI';
import DispatchForm from '../components/DispatchForm';
import CustomerSmsPage from './CustomerSmsPage';
import CustomerDeliveryGuide from './CustomerDeliveryGuide';
import { CustomerLiveLocation } from '../components/LiveLocation';
import { RiderDirectory, StoreDirectory } from '../components/CustomerDirectory';
import DeliveryHistoryCard from '../components/DeliveryHistoryCard';
import { CustomerFeedbackForm, RiderRatingForm, RiderRatings } from '../components/CustomerExperience';
export default function CustomerPage({tab,onTabChange,notify}){
  const {profile,stores,riders,orders,rateOrder,cancelOrder,submitFeedback}=usePlatform();const [modal,setModal]=useState(null),[filter,setFilter]=useState('all'),[initial,setInitial]=useState({}),[target,setTarget]=useState(null),[rating,setRating]=useState(5),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  function open(value){setError('');setModal(value);if(value==='dispatch')setInitial({});}
  function dispatch(data={}){setError('');setInitial(data);setModal('dispatch');}
  function rate(order){setTarget(order);setRating(5);setMessage('');setError('');setModal('rate');}
  function cancel(order){setTarget(order);setError('');setModal('cancel');}
  function viewDelivery(order){setTarget(order);setError('');setModal('delivery');}
  const openedSmsRating=useRef('');
  useEffect(()=>{
    const id=new URLSearchParams(window.location.search).get('rate');
    if(!id||openedSmsRating.current===id)return;
    const order=orders.find(item=>item.id===id&&item.status==='delivered'&&item.creatorId===profile.id);
    if(!order)return;
    openedSmsRating.current=id;
    onTabChange('orders');
    if(order.customerRating)notify('You have already rated this delivery.');
    else{setTarget(order);setRating(5);setMessage('');setError('');setModal('rate');}
    const url=new URL(window.location.href);url.searchParams.delete('rate');
    window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  },[orders,profile.id,onTabChange,notify]);
  async function run(task,success){setBusy(true);setError('');try{await task();notify(success);setModal(null);}catch(e){setError(e.message);}finally{setBusy(false);}}
  const active=orders.filter(o=>['pending','accepted','picked_up'].includes(o.status)),completed=orders.filter(o=>o.status==='delivered');
  const filteredOrders=orders.filter(o=>filter==='all'||(filter==='active'?active.includes(o):o.status===filter));
  const detailOrder=modal==='delivery'?orders.find(o=>o.id===target?.id):null;
  const deliveryActions=o=><><CustomerLiveLocation order={o}/>{o.status==='pending'&&<Button variant="ghost" onClick={()=>cancel(o)}>Cancel request</Button>}{o.status==='delivered'&&(o.customerRating?<span className="muted">Your rating: {o.customerRating}/5</span>:<Button variant="secondary" onClick={()=>rate(o)}><Icon name="star"/>Rate rider</Button>)}{o.riderId&&riders.find(r=>r.id===o.riderId)?.phone&&<a className="button button-secondary" href={`tel:${riders.find(r=>r.id===o.riderId).phone}`}><Icon name="phone"/>Call rider</a>}</>;
  const actions=[['store','Find Store','Shop local favourites','stores'],['bike','Find Rider','Meet your local riders','riders'],['send','Send Online Rider','Book a local delivery','dispatch'],['star','Rate Rider','Share your experience','ratings'],['message','Feedback','We’re here to help','feedback'],['package','Delivery guide','Tips for every delivery','guide']];
  return <>{tab!=='guide'&&<header className="page-heading"><div><p className="eyebrow">GOOD THINGS, DELIVERED</p><h1>Hi, {profile.name.split(' ')[0]}<span className="greeting-dot">.</span></h1></div><span className="status-badge">KYE-{profile.id.slice(-6).toUpperCase()}</span></header>}{tab==='home'&&<><SectionHeading title="A few taps. And you’re on your way."/><div className="action-grid customer-actions">{actions.map(([icon,label,desc,value])=><button className="action-card" key={value} onClick={()=>{if(value==='guide')onTabChange('guide');else if(value==='ratings'){setError('');setModal('ratings');}else if(value==='feedback'){setMessage('');open(value);}else open(value);}}><span className="action-icon"><Icon name={icon}/></span><strong className="action-label">{label}</strong><span className="action-description">{desc}</span></button>)}</div><div className="split-grid"><div><SectionHeading title="Your active delivery" action={<Button variant="ghost" onClick={()=>onTabChange('orders')}>View all<Icon name="arrow-right"/></Button>}/>{active.length?<OrderCard order={active[0]}>{deliveryActions(active[0])}</OrderCard>:<EmptyState icon="package" title="No packages on the move" description="Send your first delivery request. Your rider updates will appear here." action={<Button onClick={()=>dispatch()}>Send a package<Icon name="arrow-right"/></Button>}/>}<div className="section-block feature-banner"><div className="feature-banner-copy"><p className="eyebrow">NEAR YOU</p><h2>Your city.<br/>At your doorstep.</h2><p>Explore stores in the KyeTech community.</p><Button variant="ghost" onClick={()=>open('stores')}>Find a store<Icon name="arrow-right"/></Button></div><img src="/images/rider.png" className="feature-banner-art" alt="Delivery rider"/></div></div><aside className="stack"><div className="dispatch-callout"><Icon name="send"/><h3>Need something delivered?</h3><p>Tell us where to collect it and where it needs to go. A local rider takes it from there.</p><Button onClick={()=>dispatch()}>Request a rider<Icon name="arrow-right"/></Button></div><Card><SectionHeading title="Simple from start to finish"/><div className="stack steps"><p><span>01</span> Add your pickup and drop-off.</p><p><span>02</span> An available rider accepts.</p><p><span>03</span> Follow pickup and delivery updates.</p></div></Card></aside></div></>}
  {tab==='guide'&&<CustomerDeliveryGuide onBack={()=>onTabChange('home')} onRequestDelivery={()=>dispatch()} onViewDeliveries={()=>onTabChange('orders')} onFeedback={()=>{setMessage('');open('feedback');}}/>}
  {tab==='orders'&&<><div className="row delivery-history-heading"><SectionHeading title="My deliveries" subtitle="Follow your packages from pickup to doorstep."/><Button onClick={()=>dispatch()}><Icon name="plus"/>New delivery</Button></div><div className="filter-chips delivery-history-filters">{[['all','All'],['active','Active'],['delivered','Delivered'],['cancelled','Cancelled']].map(([v,label])=><button key={v} className={`chip ${filter===v?'chip-active':''}`} aria-pressed={filter===v} onClick={()=>setFilter(v)}>{label}</button>)}</div><div className="record-list delivery-history-list">{filteredOrders.length?filteredOrders.map(o=><DeliveryHistoryCard key={o.id} order={o} onView={viewDelivery}/>):<EmptyState title="No deliveries here yet" description="Your delivery requests and their updates will appear here." action={<Button onClick={()=>dispatch()}>Send a package</Button>}/>}</div></>}
  {tab==='sms'&&<CustomerSmsPage notify={notify} onRate={rate}/>}
  {modal&&<Modal title={{stores:'Find a store',riders:'Find a rider',dispatch:'Send a package',ratings:'Rate your rider',rate:'How was your delivery?',feedback:'Share your feedback',cancel:'Cancel this request?',delivery:'Delivery details'}[modal]} onClose={()=>{if(!busy)setModal(null);}}>
    {modal==='delivery'&&(detailOrder?<OrderCard order={detailOrder}>{deliveryActions(detailOrder)}</OrderCard>:<EmptyState title="Delivery unavailable" description="This delivery is no longer in your records."/>)}
    {modal==='dispatch'&&<DispatchForm initial={initial} notify={notify} onSuccess={()=>{setModal(null);onTabChange('orders');}}/>}
    {modal==='stores'&&<StoreDirectory stores={stores} onDispatch={dispatch}/>}
    {modal==='riders'&&<RiderDirectory riders={riders} onDispatch={dispatch}/>}
    {modal==='ratings'&&<RiderRatings orders={completed} riders={riders} onRate={rate}/>}
    {modal==='rate'&&<RiderRatingForm order={target} rider={riders.find(rider=>rider.id===target.riderId)} rating={rating} onRatingChange={setRating} message={message} onMessageChange={setMessage} busy={busy} error={error} onSubmit={()=>run(()=>rateOrder(target.id,rating,message),'Thanks! Your rider rating has been saved.')}/>}
    {modal==='feedback'&&<CustomerFeedbackForm message={message} onMessageChange={setMessage} busy={busy} error={error} onSubmit={()=>run(()=>submitFeedback(message),'Thank you. Your feedback has been sent to KyeTech.')}/>}
    {modal==='cancel'&&<div className="stack"><p className="muted">Cancel delivery KYE-{target.id.slice(-6).toUpperCase()}? You can cancel while it is waiting for a rider.</p>{error&&<p className="form-error" role="alert">{error}</p>}<Button variant="danger" busy={busy} onClick={()=>run(()=>cancelOrder(target.id),'Delivery request cancelled.')}>Cancel delivery</Button><Button variant="secondary" disabled={busy} onClick={()=>setModal(null)}>Keep request</Button></div>}
  </Modal>}</>;
}
