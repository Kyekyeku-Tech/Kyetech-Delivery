// Exercise the shipped OTP hook with service doubles only. No email or live Firebase requests.
import assert from 'node:assert/strict';
import { chromium } from '../.verification/login-tools/node_modules/playwright/index.mjs';

const origin = 'http://localhost:5173';
const harness = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOMClient from '/node_modules/.vite/deps/react-dom_client.js';
import {auth} from '/src/lib/firebase.js';
import {onIdTokenChanged} from '/node_modules/.vite/deps/firebase_auth.js';
import useAdminOtp from '/src/lib/useAdminOtp.js';
function Probe(){
 const [props,setProps]=React.useState(()=>({user:auth.currentUser,eligible:true,sessionVersion:0}));
 React.useEffect(()=>onIdTokenChanged(auth,user=>setProps(value=>({...value,user}))),[]);
 globalThis.__setEligible=eligible=>setProps(value=>({...value,eligible}));
 globalThis.__setSessionVersion=sessionVersion=>setProps(value=>({...value,sessionVersion}));
 const value=useAdminOtp(props);globalThis.__otp=value;
 const audit={uid:props.user?.uid||'',provider:auth.currentUser?.provider||'',sessionId:auth.currentUser?.sessionId||'',status:value.status,scope:value.scope,error:value.error,challengeId:value.challengeId};
 globalThis.__audit.push(audit);
 return React.createElement('pre',{id:'state'},JSON.stringify(audit));
}
ReactDOMClient.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Probe)));
`;
const fakeAuth = `
const state=globalThis.__authState||(globalThis.__authState={listeners:new Set(),sequence:0});
function tokenResult(account){return {token:account.token,signInProvider:account.provider,claims:{auth_time:account.authTime,firebase:{sign_in_provider:account.provider},...(account.sessionId?{adminOtpSessionId:account.sessionId}:{})}};}
function remember(account){__tokens[account.token]={uid:account.uid,email:account.email,authTime:account.authTime,provider:account.provider,sessionId:account.sessionId};}
function emit(){const account=state.auth.currentUser;state.listeners.forEach(listener=>{const task=()=>{if(listener.active)listener.next(account);};if(__deferTokenEvents)__tokenEventWaiters.push(task);else queueMicrotask(task);});}
function makeAccount(value){
 const account={email:'admin@example.invalid',provider:'password',sessionId:'',authTime:Math.floor(Date.now()/1000),...value};
 account.token=value.token||'fixture-token-'+String(++state.sequence);
 account.getIdToken=async force=>{__tokenReads.push({uid:account.uid,force:Boolean(force)});if(force){account.token='fixture-token-'+String(++state.sequence);remember(account);emit();}return account.token;};
 account.getIdTokenResult=async()=>{if(__tokenResultHolds[account.uid])await new Promise(resolve=>(__tokenResultWaiters[account.uid]||=[]).push(resolve));return tokenResult(account);};
 remember(account);return account;
}
state.auth||={currentUser:makeAccount(__fixture.actor)};
export const fixtureAuth=state.auth;
globalThis.__fakeAuth=state.auth;
globalThis.__setActor=value=>{state.auth.currentUser=value?makeAccount(value):null;emit();};
globalThis.__refreshToken=()=>state.auth.currentUser?.getIdToken(true);
globalThis.__flushTokenEvents=()=>{__deferTokenEvents=false;__tokenEventWaiters.splice(0).forEach(task=>queueMicrotask(task));};
globalThis.__releaseTokenResult=uid=>{delete __tokenResultHolds[uid];(__tokenResultWaiters[uid]||[]).splice(0).forEach(resolve=>resolve());};
export function onIdTokenChanged(_auth,next){const listener={active:true,next};state.listeners.add(listener);queueMicrotask(()=>{if(listener.active)next(state.auth.currentUser);});return()=>{listener.active=false;state.listeners.delete(listener);};}
export async function signInWithCustomToken(_auth,token){
 __exchanges.push(token);const issued=__issuedTokens[token];if(!issued)throw new Error('Unknown fixture custom token');
 if(__exchangeHeld)await new Promise(resolve=>__exchangeWaiters.push(resolve));
 const account=makeAccount(issued);state.auth.currentUser=account;emit();return {user:account};
}
export async function signOut(){state.auth.currentUser=null;emit();}
`;
const fakeFirebase = `
import {fixtureAuth} from '/node_modules/.vite/deps/firebase_auth.js';
export const auth=fixtureAuth,db={app:{options:{projectId:'fixture-admin-otp'}}};
`;
const fakeFirestore = `
const listeners=globalThis.__grantListeners||(globalThis.__grantListeners=new Set());
export const doc=(_db,...parts)=>({path:parts.join('/'),id:parts.at(-1)});
function snapshot(ref){const value=__grants[ref.id];return {exists:()=>value!==undefined,data:()=>value,metadata:{fromCache:Boolean(__cacheGrants[ref.id])}};}
export function onSnapshot(ref,optionsOrNext,nextOrError,errorCallback){
 const next=typeof optionsOrNext==='function'?optionsOrNext:nextOrError,error=typeof optionsOrNext==='function'?nextOrError:errorCallback;
 __grantSubscriptions.push(ref.path);const listener={ref,next,error,active:true,publish(){if(this.active)next(snapshot(ref));}};
 listeners.add(listener);queueMicrotask(()=>listener.publish());return()=>{listener.active=false;listeners.delete(listener);__disposedGrants.push(listener);};
}
globalThis.__publishGrants=()=>listeners.forEach(listener=>listener.publish());
globalThis.__setGrant=(sid,patch,replace=false)=>{__grants[sid]=replace?patch:{...__grants[sid],...patch};listeners.forEach(listener=>{if(listener.ref.id===sid)listener.publish();});};
globalThis.__emitOldGrant=(sid,patch)=>__disposedGrants.filter(listener=>listener.ref.id===sid).forEach(listener=>listener.next({exists:()=>true,data:()=>patch,metadata:{fromCache:false}}));
`;
const browser = await chromium.launch({ headless: true });
async function makePage(patch = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await context.addInitScript(value => {
    globalThis.__fixture=value;
    for(const name of ['__audit','__calls','__exchanges','__tokenReads','__grantSubscriptions','__disposedGrants','__exchangeWaiters','__tokenEventWaiters'])globalThis[name]=[];
    for(const name of ['__tokens','__issuedTokens','__grants','__cacheGrants','__apiHeld','__apiWaiters','__tokenResultHolds','__tokenResultWaiters'])globalThis[name]={};
    globalThis.__exchangeHeld=false;
    globalThis.__deferTokenEvents=false;
    globalThis.__grants={...value.grants};
    let sequence=0;
    const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
    globalThis.__releaseApi=action=>{delete __apiHeld[action];(__apiWaiters[action]||[]).splice(0).forEach(resolve=>resolve());};
    globalThis.fetch=async(url,options)=>{
      if(url!=='/api/admin-otp')throw new Error('External requests are blocked by this fixture');
      const body=JSON.parse(options.body),token=options.headers.Authorization.slice(7),identity=__tokens[token];
      __calls.push({token,body,uid:identity?.uid});
      if(__apiHeld[body.action])await new Promise(resolve=>(__apiWaiters[body.action]||=[]).push(resolve));
      if(!identity)return response({message:'Unknown fixture identity'},401);
      if(body.action==='send'){
        const challengeId=(++sequence).toString(16).padStart(64,'0');
        return response({status:'sent',challengeId,expiresAt:Date.now()+600000,cooldownUntil:Date.now()+60000,maskedEmail:'ad***@example.invalid'});
      }
      if(body.action==='verify'){
        if(body.code!=='123456')return response({message:'That code is incorrect. Check your email and try again.'},400);
        const sid=(++sequence).toString(16).padStart(64,'0'),customToken='fixture-custom-'+sequence;
        __issuedTokens[customToken]={uid:identity.uid,email:identity.email,provider:'custom',sessionId:sid,authTime:identity.authTime+1};
        __grants[sid]={uid:identity.uid,status:'pending',authTime:0,expiresAt:Date.now()+120000,pendingUntil:Date.now()+120000};
        return response({status:'verified',customToken,sessionId:sid});
      }
      if(body.action==='activate'){
        const sid=identity.sessionId;
        if(!sid||!__grants[sid]||__grants[sid].uid!==identity.uid)return response({message:'This session does not belong to your sign-in.'},403);
        __grants[sid]={...__grants[sid],status:'active',authTime:identity.authTime,expiresAt:Date.now()+3600000};
        __publishGrants?.();return response({status:'active',sessionId:sid,expiresAt:__grants[sid].expiresAt});
      }
      if(body.action==='revoke'){
        const sid=identity.sessionId;if(sid&&__grants[sid])__grants[sid]={...__grants[sid],status:'revoked',expiresAt:0};
        __publishGrants?.();return response({status:'revoked'});
      }
      return response({message:'Unknown fixture action'},400);
    };
  }, { actor: { uid: 'admin-one', email: 'admin@example.invalid', provider: 'password', authTime: Math.floor(Date.now()/1000) }, ...patch });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if(url.origin!==origin||url.pathname.startsWith('/api/'))return route.abort();
    const body=url.pathname==='/src/main.jsx'?harness:url.pathname==='/src/lib/firebase.js'?fakeFirebase:url.pathname.includes('/node_modules/.vite/deps/firebase_auth.js')?fakeAuth:url.pathname.includes('/node_modules/.vite/deps/firebase_firestore.js')?fakeFirestore:null;
    return body?route.fulfill({status:200,contentType:'application/javascript',body}):route.continue();
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin,{waitUntil:'networkidle'});
  assert.deepEqual(errors,[],'Fixture modules must load');
  await page.waitForFunction(status=>globalThis.__otp?.status===status,patch.readyStatus||'sent');
  return {page,context,errors};
}
const call=(page,method,...args)=>page.evaluate(async({method,args})=>__otp[method](...args),{method,args});
const calls=(page,action)=>page.evaluate(action=>__calls.filter(call=>call.body.action===action),action);
try {
  const normal=await makePage();
  try {
    const {page}=normal;
    assert.equal((await calls(page,'send')).length,1,'StrictMode must send one code per password sign-in');
    assert.equal(await call(page,'verifyCode','111111'),false);
    assert.equal(await page.evaluate(()=>__otp.status),'sent');
    assert.match(await page.evaluate(()=>__otp.error),/incorrect/);
    await page.evaluate(()=>__refreshToken());
    assert.equal((await calls(page,'send')).length,1,'ID-token refresh must not restart a password challenge');
    await page.evaluate(()=>__deferTokenEvents=true);
    assert.equal(await call(page,'verifyCode','123456'),true);
    await page.waitForFunction(()=>__otp.status==='verified');
    const signed=await page.evaluate(()=>({sid:__fakeAuth.currentUser.sessionId,authTime:__fakeAuth.currentUser.authTime,subscriptions:__grantSubscriptions.length}));
    assert.match(signed.sid,/^[a-f0-9]{64}$/);assert.ok(signed.subscriptions>=1,'The exchanged session must have a live grant watcher');
    await page.evaluate(()=>__flushTokenEvents());
    const verifyRequests=await calls(page,'verify'),sendRequests=await calls(page,'send');
    assert.ok(verifyRequests.every(request=>request.token===sendRequests[0].token),'Verification must retain the token used to bind its challenge');
    await page.evaluate(()=>__refreshToken());
    await page.waitForFunction(()=>__otp.status==='verified');
    assert.equal((await calls(page,'send')).length,1,'Refresh retains a verified session');
    await page.evaluate(sid=>__setGrant(sid,{status:'revoked',expiresAt:0}),signed.sid);
    await page.waitForFunction(()=>__otp.status!=='verified');
    await page.evaluate(({uid,authTime})=>__setActor({uid,email:'admin@example.invalid',provider:'password',authTime}),{uid:'admin-one',authTime:signed.authTime});
    await page.waitForFunction(()=>__otp.status==='sent'&&__calls.filter(call=>call.body.action==='send').length===2);
    assert.equal(await page.evaluate(()=>__fakeAuth.currentUser.sessionId),'','A new password login cannot retain the earlier signed session');
    assert.equal(await call(page,'verifyCode','123456'),true);
    await page.waitForFunction(()=>__otp.status==='verified');
    const newSid=await page.evaluate(()=>__fakeAuth.currentUser.sessionId);
    assert.notEqual(newSid,signed.sid);
    await call(page,'revoke');
    assert.equal(await page.evaluate(sid=>__grants[sid].status,newSid),'revoked');
    assert.notEqual(await page.evaluate(()=>__otp.status),'verified','Local administrator access closes when logout revokes its grant');
    await page.evaluate(()=>__setActor(null));
    await page.waitForFunction(()=>__otp.status==='idle');
    assert.deepEqual(normal.errors,[]);
    console.log('PASS real administrator OTP hook: StrictMode one-send, wrong-code retry, challenge-token retention, custom exchange/activation, live revocation, refresh persistence, fresh-password OTP and logout.');
  } finally {await normal.context.close();}
  const switched=await makePage();
  try {
    const {page}=switched;
    await page.evaluate(()=>__apiHeld.verify=true);
    const pending=page.evaluate(()=>__otp.verifyCode('123456')).catch(error=>({fixtureError:error.message}));
    await page.waitForFunction(()=>__calls.some(call=>call.body.action==='verify'));
    await page.evaluate(()=>__setActor({uid:'admin-two',email:'second@example.invalid',provider:'password',authTime:Math.floor(Date.now()/1000)}));
    await page.waitForFunction(()=>__audit.at(-1)?.uid==='admin-two');
    await page.evaluate(()=>__releaseApi('verify'));
    assert.equal(await pending,false,'An old account verification must be rejected after switching accounts');
    await page.waitForFunction(()=>__otp.status==='sent'&&__calls.some(call=>call.uid==='admin-two'&&call.body.action==='send'));
    assert.equal(await page.evaluate(()=>__exchanges.length),0,'An old verification cannot sign the previous account back in');
    assert.ok((await page.evaluate(()=>__audit.filter(item=>item.uid==='admin-two'))).every(item=>item.status!=='verified'));
    assert.deepEqual(switched.errors,[]);
    console.log('PASS real administrator OTP hook: account switch rejects in-flight verification and starts the new account code.');
  } finally {await switched.context.close();}
  const sameUid=await makePage();
  try {
    const {page}=sameUid;
    await page.evaluate(()=>__apiHeld.verify=true);
    const pending=page.evaluate(()=>__otp.verifyCode('111111')).catch(error=>({fixtureError:error.message}));
    await page.waitForFunction(()=>__calls.some(call=>call.body.action==='verify'));
    await page.evaluate(()=>{const authTime=__fakeAuth.currentUser.authTime;__setSessionVersion(1);__setActor({uid:'admin-one',email:'admin@example.invalid',provider:'password',authTime});});
    await page.waitForFunction(()=>__otp.status==='sent'&&__calls.filter(call=>call.body.action==='send').length===2);
    const challenge=await page.evaluate(()=>__otp.challengeId);
    await page.evaluate(()=>__releaseApi('verify'));
    assert.equal(await pending,false);
    assert.equal(await page.evaluate(()=>__otp.challengeId),challenge);
    assert.equal(await page.evaluate(()=>__otp.error),'','A stale failed verification cannot replace the newer sign-in error state');
    assert.equal(await page.evaluate(()=>__exchanges.length),0);
    assert.deepEqual(sameUid.errors,[]);
    console.log('PASS real administrator OTP hook: stale same-UID verification cannot alter the newer sign-in challenge, including identical auth_time with a new login generation.');
  } finally {await sameUid.context.close();}
  const sid='d'.repeat(64),now=Date.now();
  const resumed=await makePage({readyStatus:'verified',actor:{uid:'admin-one',email:'admin@example.invalid',provider:'custom',sessionId:sid,authTime:Math.floor(now/1000)},grants:{[sid]:{uid:'admin-one',status:'pending',authTime:0,createdAt:now,pendingUntil:now+120000,expiresAt:now+120000}}});
  try {
    const {page}=resumed;
    assert.equal((await calls(page,'send')).length,0,'A resumable custom exchange must not send a duplicate email');
    assert.equal((await calls(page,'activate')).length,1,'StrictMode resumes a pending exchanged session once');
    await page.evaluate(sid=>__setGrant(sid,{status:'revoked',expiresAt:0}),sid);
    await page.waitForFunction(()=>__otp.status!=='verified');
    assert.deepEqual(resumed.errors,[]);
    console.log('PASS real administrator OTP hook: pending custom sign-in resumes activation with a live grant watcher.');
  } finally {await resumed.context.close();}
  const activeSid='e'.repeat(64),activeTime=Math.floor(Date.now()/1000);
  const isolated=await makePage({readyStatus:'verified',actor:{uid:'admin-one',email:'admin@example.invalid',provider:'custom',sessionId:activeSid,authTime:activeTime},grants:{[activeSid]:{uid:'admin-one',status:'active',authTime:activeTime,expiresAt:Date.now()+3600000}}});
  try {
    const {page}=isolated;
    await page.evaluate(sid=>__setGrant(sid,{expiresAt:Date.now()+100}),activeSid);
    await page.waitForFunction(()=>__otp.status==='required');
    await page.evaluate(sid=>__setGrant(sid,{expiresAt:Date.now()+3600000}),activeSid);
    await page.waitForFunction(()=>__otp.status==='verified');
    await page.evaluate(()=>{__tokenResultHolds['admin-two']=true;__setActor({uid:'admin-two',email:'second@example.invalid',provider:'password',authTime:Math.floor(Date.now()/1000)});});
    await page.waitForFunction(()=>__audit.at(-1)?.uid==='admin-two');
    assert.ok((await page.evaluate(()=>__audit.filter(item=>item.uid==='admin-two'))).every(item=>item.status!=='verified'),'A new account cannot inherit a verified status while its token result is pending');
    await page.evaluate(sid=>__emitOldGrant(sid,{uid:'admin-one',status:'active',authTime:0,expiresAt:Date.now()+3600000}),activeSid);
    assert.notEqual(await page.evaluate(()=>__otp.status),'verified');
    await page.evaluate(()=>__releaseTokenResult('admin-two'));
    await page.waitForFunction(()=>__otp.status==='sent');
    assert.deepEqual(isolated.errors,[]);
    console.log('PASS real administrator OTP hook: grant expiry, delayed account-token reads and disposed grants cannot retain or inherit verified access.');
  } finally {await isolated.context.close();}
} finally {await browser.close();}
