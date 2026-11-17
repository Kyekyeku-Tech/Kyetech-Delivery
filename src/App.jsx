import { useEffect, useId, useState } from 'react';
import { usePlatform } from './context/PlatformContext';
import { Avatar, Brand, Button, Card, Icon, RequestNotification } from './components/UI';
import { incomingRiderRequests } from './lib/admin';
import SmsUnreadBadge from './components/SmsUnreadBadge';
import { MerchantStoreAccess } from './components/StoreTeam';
import AuthPage from './pages/AuthPage';
import CustomerPage from './pages/CustomerPage';
import RiderPage from './pages/RiderPage';
import MerchantPage from './pages/MerchantPage';
import ProfilePage from './pages/ProfilePage';
import AdminPage from './pages/AdminPage';
import RecipientReviewPage from './pages/RecipientReviewPage';
import NotFoundPage from './pages/NotFoundPage';
import { isAppPathname, normalizeAppPathname } from './lib/appRoutes';
import './platform-notice.css';
import LoadingScreen from './components/LoadingScreen';
import AdminOtpPage from './pages/AdminOtpPage';
import RiderAlerts from './components/RiderAlerts';
const navigation={customer:[['home','home','Home'],['orders','package','Orders'],['sms','message','SMS'],['profile','user','Profile']],rider:[['home','home','Dashboard'],['requests','send','Requests'],['performance','chart','Performance'],['profile','user','Profile']],merchant:[['home','home','Dashboard'],['orders','package','Deliveries'],['products','package','Products'],['store','store','My store'],['sms','message','SMS'],['profile','user','Profile']]};
export default function App(){
  const {user,profile,isAdmin,hasAdminAccess,adminOtp,adminLoading,authLoading,authActionPending,dataLoading,orders=[],customerSmsReads,merchantSmsReads,storeTeam,needsProfile,error,dataReadErrors={},retryData,clearError,logout}=usePlatform();const [tab,setTab]=useState('home'),[toast,setToast]=useState(null);const smsDescriptionId=useId();
  useEffect(()=>{setTab('home');setToast(null);},[profile?.id,profile?.role,isAdmin]);useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),5500);return()=>clearTimeout(timer);},[toast]);
  function notify(message,type='success'){setToast({message,type});}
  const [requestNavigation, setRequestNavigation] = useState(() => new URLSearchParams(window.location.search).has('rider-request'));
  useEffect(() => {
    const openRequests = event => { if (event.data?.type === 'open-rider-requests') setRequestNavigation(true); };
    navigator.serviceWorker?.addEventListener('message', openRequests);
    return () => navigator.serviceWorker?.removeEventListener('message', openRequests);
  }, []);
  useEffect(() => {
    if (!requestNavigation || !user || isAdmin || profile?.role !== 'rider') return;
    setTab('requests'); setRequestNavigation(false);
    const parameters = new URLSearchParams(window.location.search);
    if (parameters.has('rider-request')) {
      parameters.delete('rider-request');
      window.history.replaceState(null, '', `${window.location.pathname}${parameters.size ? '?' + parameters.toString() : ''}${window.location.hash}`);
    }
  }, [requestNavigation, user?.uid, profile?.role, isAdmin]);
  if(!isAppPathname(window.location.pathname))return <NotFoundPage/>;
  if(normalizeAppPathname(window.location.pathname)==='/review')return <RecipientReviewPage token={new URLSearchParams(window.location.search).get('token') || ''}/>;
  if(authLoading||adminLoading)return <LoadingScreen/>;
  if(!user||authActionPending)return <AuthPage/>;
  if(user&&!profile&&dataLoading)return <LoadingScreen message="Opening your profile…"/>;
  if(needsProfile)return <AuthPage recovery/>;
  if(!profile)return <div className="loading-screen"><Brand/><Card><p className="form-error" role="alert">{error||'Your account profile could not be loaded. Check your connection and Firebase setup.'}</p><Button onClick={()=>logout().catch(e=>notify(e.message,'error'))}>Back to sign in</Button></Card></div>;
  if(!isAdmin&&profile.accountStatus==='suspended')return <div className="loading-screen"><Brand/><Card><h2>Your account is suspended</h2><p className="muted">Contact the KyeTech team to review your account.</p>{profile.reviewNote&&<p className="notice">{profile.reviewNote}</p>}<Button onClick={()=>logout().catch(e=>notify(e.message,'error'))}>Sign out</Button></Card></div>;
  if(hasAdminAccess&&adminOtp?.status!=='verified')return <AdminOtpPage/>;
  if(!isAdmin&&window.location.pathname.startsWith('/admin'))return <div className="loading-screen"><Brand/><Card><h2>Administrator access required</h2><p className="muted">This account has not been granted administrator access.</p><p className="muted">Account: {profile.email}</p><p className="admin-uid">UID: {user.uid}</p><div className="card-actions"><a className="button button-primary" href="/">Open my account</a><Button variant="secondary" onClick={()=>logout().catch(e=>notify(e.message,'error'))}>Sign out</Button></div></Card></div>;
  const nav=isAdmin?[['home','chart','Overview'],['riders','bike','Riders'],['stores','store','Stores'],['customers','user','Customers'],['orders','package','Deliveries'],['feedback','message','Feedback'],['access','shield','Admin access'],['audit','clock','Activity']]:navigation[profile.role]||navigation.customer,Page=isAdmin?AdminPage:profile.role==='rider'?RiderPage:profile.role==='merchant'?MerchantPage:CustomerPage;
  const incomingCount=isAdmin?0:incomingRiderRequests(orders,profile).length, smsReads=profile.role==='merchant'?merchantSmsReads:customerSmsReads, unreadSmsCount=!isAdmin&&['customer','merchant'].includes(profile.role)?(smsReads?.unreadCount||0):0;
  return <div className={`app-shell ${isAdmin ? 'admin-shell' : 'role-'+profile.role}`}><aside className="sidebar"><Brand/><nav className="sidebar-nav" aria-label="Main navigation">{nav.map(([value,icon,label])=><button className={`nav-item ${tab===value?'active':''}`} aria-current={tab===value?'page':undefined} key={value} aria-describedby={value==='sms'?smsDescriptionId:undefined} onClick={()=>setTab(value)}><span className="nav-icon"><Icon name={icon}/>{value==='requests'&&<RequestNotification count={incomingCount} compact className="nav-request-badge"/>}{value==='sms'&&<SmsUnreadBadge count={unreadSmsCount} className="sms-nav-unread-badge" hidden/>}</span>{label}</button>)}</nav><footer className="sidebar-footer">{profile.city}<Button variant="ghost" onClick={()=>logout().catch(e=>notify(e.message,'error'))}><Icon name="logout"/>Sign out</Button><small>KyeTech Delivery · 2026</small></footer></aside><div className="main-shell"><header className="topbar"><Brand/><div className="hub-badge"><strong>{isAdmin ? 'Service management' : profile.city}</strong><span>{isAdmin ? 'Administrator workspace' : 'Delivery hub'}</span></div><button className="topbar-account" onClick={()=>setTab('profile')} aria-label="Open your profile"><div><strong>{profile.name}</strong><small>{isAdmin ? 'Administrator' : profile.role + ' account'}</small></div><Avatar name={profile.name} src={profile.photoUrl}/><Icon name="chevron-right" size={16}/></button></header><main className="workspace"><RiderAlerts onViewRequests={()=>setTab('requests')}/>{!isAdmin&&['customer','merchant'].includes(profile.role)&&<span id={smsDescriptionId} className="request-announcement" role="status" aria-atomic="true">{unreadSmsCount?`${unreadSmsCount} unread SMS ${unreadSmsCount===1?'message':'messages'}.`:'No unread SMS.'}</span>}{!isAdmin&&profile.role==='merchant'&&<MerchantStoreAccess notify={notify}/>}{!isAdmin&&profile.role==='rider'&&<span className="request-announcement" role="status" aria-atomic="true">{incomingCount?`${incomingCount} incoming delivery ${incomingCount===1?'request':'requests'} waiting.`:'No incoming delivery requests.'}</span>}{error&&<div className="notice notice-warning platform-error-notice" role="alert" style={{marginBottom:20}}><span className="platform-error-copy">{error}</span>{Object.keys(dataReadErrors).length>0&&retryData&&<Button variant="secondary" className="platform-error-retry" onClick={retryData}>Retry connection</Button>}{!Object.values(dataReadErrors).includes(error)&&<button className="button-icon" aria-label="Dismiss error" onClick={clearError}><Icon name="x"/></button>}</div>}{dataLoading?<LoadingScreen compact message="Loading your deliveries…"/>:tab==='profile'?<ProfilePage key={profile.id} notify={notify}/>:!isAdmin&&profile.role==='merchant'&&storeTeam&&!storeTeam.storeId?<Card><h2>Store access unavailable</h2><p className="muted">Your store workspace could not be opened. Retry store access to continue.</p></Card>:<Page tab={tab} onTabChange={setTab} notify={notify}/>}</main></div><nav className="bottom-nav" aria-label="Mobile navigation">{nav.map(([value,icon,label])=><button key={value} className={tab===value?'active':''} aria-current={tab===value?'page':undefined} aria-describedby={value==='sms'?smsDescriptionId:undefined} onClick={()=>setTab(value)}><span className="nav-icon"><Icon name={icon}/>{value==='requests'&&<RequestNotification count={incomingCount} compact className="nav-request-badge"/>}{value==='sms'&&<SmsUnreadBadge count={unreadSmsCount} className="sms-nav-unread-badge" hidden/>}</span>{label}</button>)}</nav>{toast&&<div className={`toast toast-${toast.type}`} role={toast.type==='error'?'alert':'status'}><Icon name={toast.type==='error'?'x':'check'}/>{toast.message}<button className="toast-close" aria-label="Dismiss notification" onClick={()=>setToast(null)}><Icon name="x" size={16}/></button></div>}</div>;
}

