// Real PlatformContext + App, isolated from live Firebase, email and API traffic.
import assert from 'node:assert/strict';
import { chromium } from '../.verification/login-tools/node_modules/playwright/index.mjs';

const origin='http://localhost:5173';
const harness=`
import React from '/node_modules/.vite/deps/react.js';
import ReactDOMClient from '/node_modules/.vite/deps/react-dom_client.js';
import {PlatformProvider,usePlatform} from '/src/context/PlatformContext.jsx';
import App from '/src/App.jsx';
import '/src/styles.css';
import '/src/theme.css';
function Probe(){const value=usePlatform();globalThis.__platform=value;
 __audit.push({uid:value.user?.uid||'',profileId:value.profile?.id||'',hasAdminAccess:value.hasAdminAccess,isAdmin:value.isAdmin,otp:value.adminOtp.status,loading:value.dataLoading,users:value.adminUsers.map(record=>record.id),audit:value.adminAudit.map(record=>record.id)});
 return React.createElement(App);}
ReactDOMClient.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(PlatformProvider,null,React.createElement(Probe))));
`;
const fakeAuth=`
const state=globalThis.__authState||(globalThis.__authState={authListeners:new Set(),tokenListeners:new Set(),sequence:0});
function remember(account){__tokens[account.token]={uid:account.uid,email:account.email,authTime:account.authTime,provider:account.provider,sessionId:account.sessionId};}
function emit(listeners,account){listeners.forEach(listener=>queueMicrotask(()=>{if(listener.active)listener.next(account);}));}
function makeAccount(value){const account={uid:'admin-one',email:'admin@example.invalid',provider:'password',sessionId:'',authTime:__fixture.authTime,...value};account.token='fixture-token-'+(++state.sequence);
 account.getIdToken=async force=>{if(force){account.token='fixture-token-'+(++state.sequence);remember(account);emit(state.tokenListeners,account);}return account.token;};
 account.getIdTokenResult=async()=>({token:account.token,signInProvider:account.provider,claims:{auth_time:account.authTime,firebase:{sign_in_provider:account.provider},...(account.sessionId?{adminOtpSessionId:account.sessionId}:{})}});
 remember(account);return account;}
state.auth||={currentUser:makeAccount({})};export const fixtureAuth=state.auth;globalThis.__fakeAuth=state.auth;
function subscribe(listeners,next){const listener={active:true,next};listeners.add(listener);queueMicrotask(()=>{if(listener.active)next(state.auth.currentUser);});return()=>{listener.active=false;listeners.delete(listener);};}
export const onAuthStateChanged=(_auth,next)=>subscribe(state.authListeners,next);
export const onIdTokenChanged=(_auth,next)=>subscribe(state.tokenListeners,next);
export async function signInWithCustomToken(_auth,token){const issued=__issuedTokens[token];if(!issued)throw new Error('Unknown fixture custom token');const account=makeAccount(issued);state.auth.currentUser=account;
 __authEvents.push({provider:'custom',emitted:!__fixture.suppressCustomAuthState});
 if(!__fixture.suppressCustomAuthState)emit(state.authListeners,account);emit(state.tokenListeners,account);return {user:account};}
export async function signInWithEmailAndPassword(){const account=makeAccount({});state.auth.currentUser=account;__authEvents.push({provider:'password',emitted:true});emit(state.authListeners,account);emit(state.tokenListeners,account);return {user:account};}
export async function signOut(){state.auth.currentUser=null;emit(state.authListeners,null);emit(state.tokenListeners,null);}
export async function createUserWithEmailAndPassword(){throw new Error('Unexpected fixture registration');}
export async function sendPasswordResetEmail(){throw new Error('Unexpected fixture reset email');}
export async function sendEmailVerification(){throw new Error('Unexpected fixture verification email');}
export async function updateProfile(){}
`;
const fakeFirebase=`
import {fixtureAuth} from '/node_modules/.vite/deps/firebase_auth.js';
export const auth=fixtureAuth,db={app:{options:{projectId:'fixture-admin-platform'}}},firebaseConfigError='',firebaseInitializationError='',firebaseConfigured=true;
export const friendlyFirebaseError=cause=>cause.message||'Fixture service error';
`;
const fakeFirestore=`
const listeners=globalThis.__firestoreListeners||(globalThis.__firestoreListeners=new Set());let sequence=0;
export const collection=(_db,...parts)=>({path:parts.join('/'),kind:'collection'});
export function doc(_db,...parts){if(_db?.kind==='collection'&&!parts.length)parts=[_db.path,'fixture-'+(++sequence)];if(parts.some(part=>!part))throw new Error('Invalid empty fixture path');return {path:parts.join('/'),id:parts.at(-1),kind:'doc'};}
export const where=(field,op,value)=>({field,op,value});
export const query=(ref,...filters)=>({...ref,filters});
export const serverTimestamp=()=>Date.now();
function record(path){const value=__documents[path];return {id:path.split('/').at(-1),exists:()=>value!==undefined,data:()=>value,metadata:{hasPendingWrites:false,fromCache:false}};}
function granted(){const account=__fakeAuth.currentUser,session=account?.sessionId&&__documents['adminOtpSessions/'+account.sessionId];return Boolean(account?.provider==='custom'&&session?.status==='active'&&session.uid===account.uid&&session.authTime===account.authTime&&session.expiresAt>Date.now());}
function snapshot(ref){if(ref.kind==='doc')return record(ref.path);return {metadata:{fromCache:false},docs:Object.keys(__documents).filter(path=>path.startsWith(ref.path+'/')&&path.split('/').length===ref.path.split('/').length+1).filter(path=>(ref.filters||[]).every(filter=>filter.op==='=='&&__documents[path][filter.field]===filter.value)).map(record)};}
export function onSnapshot(ref,optionsOrNext,nextOrError,errorCallback){const next=typeof optionsOrNext==='function'?optionsOrNext:nextOrError,error=typeof optionsOrNext==='function'?nextOrError:errorCallback;
 const privateCollection=ref.kind==='collection'&&['users','admins','adminAudit','orders','stores','riders','feedback'].includes(ref.path)&&!(ref.filters?.length);
 const subscription={path:ref.path,kind:ref.kind,filters:ref.filters||[],privateCollection,granted:granted(),sid:__fakeAuth.currentUser?.sessionId||''};__subscriptions.push(subscription);
 const listener={ref,active:true,publish(){if(!this.active)return;if(privateCollection&&!granted()){if(!subscription.granted)__illegalSubscriptions.push(subscription);this.active=false;listeners.delete(this);error?.(Object.assign(new Error('Administrator OTP grant required'),{code:'permission-denied'}));return;}next(snapshot(ref));}};
 listeners.add(listener);queueMicrotask(()=>listener.publish());return()=>{listener.active=false;listeners.delete(listener);};}
globalThis.__publishService=()=>listeners.forEach(listener=>listener.publish());
export async function getDoc(ref){return record(ref.path);}
export async function runTransaction(){throw new Error('Unexpected fixture transaction');}
export function writeBatch(){throw new Error('Unexpected fixture batch');}
export async function setDoc(){throw new Error('Unexpected fixture write');}
export async function deleteDoc(){throw new Error('Unexpected fixture delete');}
`;
const profile=(name,email)=>({name,email,phone:'+233241234567',role:'customer',city:'Takoradi',photoUrl:'',bikeBrand:'',bikeModel:'',plate:'',online:false,accountStatus:'active',approvalStatus:'approved',reviewNote:'',reviewedBy:'',reviewedAt:null,createdAt:Date.now(),updatedAt:Date.now()});
const browser=await chromium.launch({headless:true});
async function makePage(suppressCustomAuthState){
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addInitScript(value=>{
  globalThis.__fixture=value;
  for(const name of ['__audit','__calls','__authEvents','__subscriptions','__illegalSubscriptions'])globalThis[name]=[];
  globalThis.__tokens={};globalThis.__issuedTokens={};globalThis.__documents=value.documents;globalThis.__apiHeld={};globalThis.__apiWaiters={};
  let sequence=0;const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  globalThis.__releaseApi=action=>{delete __apiHeld[action];(__apiWaiters[action]||[]).splice(0).forEach(resolve=>resolve());};
  globalThis.fetch=async(url,options)=>{
   if(url!=='/api/admin-otp')throw new Error('External requests are blocked by this fixture');
   const body=JSON.parse(options.body),token=options.headers.Authorization.slice(7),identity=__tokens[token];__calls.push({body,token,sid:identity?.sessionId||''});
   if(__apiHeld[body.action])await new Promise(resolve=>(__apiWaiters[body.action]||=[]).push(resolve));
   if(!identity)return response({message:'Unknown fixture identity'},401);
   if(body.action==='send')return response({status:'sent',challengeId:(++sequence).toString(16).padStart(64,'0'),expiresAt:Date.now()+600000,cooldownUntil:Date.now()+60000,maskedEmail:'ad***@example.invalid'});
   if(body.action==='verify'){
    if(body.code!=='123456')return response({message:'That code is incorrect.'},400);
    const sid=(++sequence).toString(16).padStart(64,'0'),customToken='fixture-custom-'+sequence;
    __issuedTokens[customToken]={uid:identity.uid,email:identity.email,provider:'custom',sessionId:sid,authTime:identity.authTime+1};
    __documents['adminOtpSessions/'+sid]={uid:identity.uid,status:'pending',authTime:0,createdAt:Date.now(),pendingUntil:Date.now()+120000,expiresAt:Date.now()+120000};
    return response({status:'verified',sessionId:sid,customToken});
   }
   const sid=identity.sessionId,session=__documents['adminOtpSessions/'+sid];
   if(!sid||!session||session.uid!==identity.uid||session.status==='revoked')return response({message:'This grant is unavailable for your sign-in.'},403);
   if(body.action==='activate'){
    __documents['adminOtpSessions/'+sid]={...session,status:'active',authTime:identity.authTime,expiresAt:Date.now()+3600000};__publishService();
    return response({status:'active',sessionId:sid,expiresAt:__documents['adminOtpSessions/'+sid].expiresAt});
   }
   if(body.action==='revoke'){__documents['adminOtpSessions/'+sid]={...session,status:'revoked',expiresAt:0};__publishService();return response({status:'revoked'});}
   return response({message:'Unexpected action'},400);
  };
 },{suppressCustomAuthState,authTime:Math.floor(Date.now()/1000),documents:{'users/admin-one':profile('Admin One','admin@example.invalid'),'admins/admin-one':{enabled:true},'users/customer-one':profile('Private Customer','customer@example.invalid'),'adminAudit/activity-one':{actorId:'admin-one',action:'user_approved',targetType:'user',targetId:'customer-one',note:'Fixture activity',createdAt:Date.now()}}});
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.origin!==origin||url.pathname.startsWith('/api/'))return route.abort();
  const body=url.pathname==='/src/main.jsx'?harness:url.pathname==='/src/lib/firebase.js'?fakeFirebase:url.pathname.includes('/node_modules/.vite/deps/firebase_auth.js')?fakeAuth:url.pathname.includes('/node_modules/.vite/deps/firebase_firestore.js')?fakeFirestore:null;
  return body?route.fulfill({status:200,contentType:'application/javascript',body}):route.continue();
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/admin',{waitUntil:'networkidle'});assert.deepEqual(errors,[],'Real App fixture modules must load');
 await page.waitForFunction(()=>globalThis.__platform?.hasAdminAccess&&__platform.adminOtp.status==='sent');
 return {page,context,errors};
}
try{
 for(const suppressCustomAuthState of [false,true]){
  const fixture=await makePage(suppressCustomAuthState);
  try{
   const {page}=fixture;
   assert.equal(await page.evaluate(()=>__platform.hasAdminAccess),true);assert.equal(await page.evaluate(()=>__platform.isAdmin),false);
   assert.equal(await page.locator('.admin-otp-page').count(),1);assert.equal(await page.locator('.admin-shell').count(),0);
   assert.equal(await page.evaluate(()=>__subscriptions.filter(item=>item.privateCollection).length),0,'No private collection reads before OTP');
   assert.equal(await page.evaluate(()=>__calls.filter(call=>call.body.action==='send').length),1,'StrictMode sends once before OTP');
   const passwordTime=await page.evaluate(()=>__fakeAuth.currentUser.authTime);
   await page.evaluate(()=>__platform.login('admin@example.invalid','fixture-password'));
   await page.waitForFunction(()=>__platform.hasAdminAccess&&!__platform.isAdmin&&__platform.adminOtp.status==='sent'&&__calls.filter(call=>call.body.action==='send').length===2);
   assert.equal(await page.evaluate(()=>__fakeAuth.currentUser.authTime),passwordTime,'The new password login deliberately has identical auth_time');
   assert.equal(await page.evaluate(()=>__subscriptions.filter(item=>item.privateCollection).length),0);
   const profileReads=await page.evaluate(()=>__subscriptions.filter(item=>item.path==='users/admin-one'&&item.kind==='doc').length);
   await page.evaluate(()=>__apiHeld.activate=true);
   await page.getByLabel('Verification code',{exact:true}).fill('123456');
   await page.getByRole('button',{name:'Verify',exact:true}).click();
   await page.waitForFunction(()=>__calls.some(call=>call.body.action==='activate'));
   assert.equal(await page.evaluate(()=>__platform.isAdmin),false,'An exchanged pending grant cannot open administrator access');
   assert.equal(await page.evaluate(()=>__subscriptions.filter(item=>item.privateCollection).length),0,'Private subscriptions wait for grant activation');
   await page.evaluate(()=>__releaseApi('activate'));
   await page.waitForFunction(()=>__platform.isAdmin&&__platform.profile?.id==='admin-one'&&!__platform.dataLoading);
   assert.equal(await page.locator('.admin-shell').count(),1);assert.equal(await page.getByRole('heading',{name:'Your service at a glance',exact:true}).count(),1);
   assert.ok(await page.evaluate(()=>__platform.adminUsers.some(record=>record.name==='Private Customer')));
   assert.ok(await page.evaluate(()=>__platform.adminAudit.some(record=>record.id==='activity-one')));
   assert.ok(await page.evaluate(()=>__subscriptions.filter(item=>item.privateCollection).every(item=>item.granted)));
   assert.equal(await page.evaluate(()=>__calls.filter(call=>call.body.action==='activate').length),1,'Same-UID profile refresh must not duplicate grant activation');
   const afterProfileReads=await page.evaluate(()=>__subscriptions.filter(item=>item.path==='users/admin-one'&&item.kind==='doc').length);
   if(!suppressCustomAuthState)assert.ok(afterProfileReads>profileReads,'authRevision must rehydrate the profile after same-UID auth state reset');
   else assert.equal(afterProfileReads,profileReads,'Suppressed auth-state callback uses the explicit grant watcher');
   assert.ok(await page.evaluate(expected=>__authEvents.some(event=>event.provider==='custom'&&event.emitted===expected),!suppressCustomAuthState));
   const signed=await page.evaluate(()=>({sid:__fakeAuth.currentUser.sessionId,token:__fakeAuth.currentUser.token}));
   await page.evaluate(()=>__platform.logout());
   await page.waitForFunction(()=>!__platform.user&&!__platform.isAdmin);
   assert.equal(await page.evaluate(sid=>__documents['adminOtpSessions/'+sid].status,signed.sid),'revoked');
   assert.ok(await page.evaluate(sid=>__calls.some(call=>call.body.action==='revoke'&&call.sid===sid),signed.sid));
   const replayStatus=await page.evaluate(async token=>(await fetch('/api/admin-otp',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({action:'activate'})})).status,signed.token);
   assert.equal(replayStatus,403,'Revoked grants cannot activate again');
   const afterLogout=await page.evaluate(()=>__subscriptions.length);
   await page.evaluate(()=>__platform.login('admin@example.invalid','fixture-password'));
   await page.waitForFunction(()=>__platform.hasAdminAccess&&!__platform.isAdmin&&__platform.adminOtp.status==='sent'&&__calls.filter(call=>call.body.action==='send').length===3);
   assert.equal(await page.locator('.admin-otp-page').count(),1);
   assert.deepEqual(await page.evaluate(()=>__platform.adminUsers),[]);assert.deepEqual(await page.evaluate(()=>__platform.adminAudit),[]);
   assert.equal(await page.evaluate(after=>__subscriptions.slice(after).filter(item=>item.privateCollection).length,afterLogout),0);
   assert.deepEqual(await page.evaluate(()=>__illegalSubscriptions),[]);assert.deepEqual(fixture.errors,[]);
   console.log('PASS real PlatformContext + App administrator OTP ('+(suppressCustomAuthState?'suppressed':'emitted')+' same-UID auth callback): pre-OTP gate, login generation, delayed private subscriptions, profile hydration, grant activation, admin workspace and revoke/logout isolation.');
  }finally{await fixture.context.close();}
 }
}finally{await browser.close();}
