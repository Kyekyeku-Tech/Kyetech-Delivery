// Isolated merchant SMS browser checks. No live accounts, message sends or database writes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../.verification/login-tools/node_modules/playwright/index.mjs';
const baseUrl = 'http://localhost:5173/', origin = new URL(baseUrl).origin, output = '.verification/merchant-sms';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const provider = `
import React from '/node_modules/.vite/deps/react.js';
import useMerchantSmsReads from '/src/lib/useMerchantSmsReads.js';
const context=React.createContext(null),listeners=new Set();let state=globalThis.__merchantSmsFixture;
function publish(patch){state={...state,...patch};globalThis.__merchantSmsFixture=state;listeners.forEach(fn=>fn());}
globalThis.__updateMerchantSms=publish;
export function PlatformProvider({children}){
 const snapshot=React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>state);
 const merchantSmsReads=useMerchantSmsReads({user:snapshot.user,profile:snapshot.profile,messages:snapshot.smsMessages,storeId:snapshot.storeTeam.storeId});
 const storeTeam=snapshot.storeTeam;
 return React.createElement(context.Provider,{value:{...snapshot,merchantSmsReads,storeTeam,clearError(){},async logout(){}}},children);
}
export function usePlatform(){return React.useContext(context);}
`;
const firestore = `
const listeners=new Set();
export const doc=(_db,...parts)=>({path:parts.join('/')});
export const collection=(_db,...parts)=>({path:parts.join('/')});
export const serverTimestamp=()=>Date.now();
export async function getDoc(){throw new Error('Unexpected fixture review read');}
export async function runTransaction(){throw new Error('Unexpected fixture transaction');}
export async function deleteDoc(){throw new Error('Unexpected fixture document removal');}
globalThis.__notifyMerchantReads=()=>{sessionStorage.setItem('fixture-merchant-reads',JSON.stringify(__merchantReads));listeners.forEach(listener=>listener.publish());};
export function onSnapshot(ref,next,error){
 __listenAttempts++;
 if(__failListen){queueMicrotask(()=>error({code:'permission-denied'}));return()=>{};}
 const uid=ref.path.split('/')[1],listener={active:true,publish(){if(this.active)next({docs:(__merchantReads[uid]||[]).map(id=>({id}))});}};
 listeners.add(listener);queueMicrotask(()=>listener.publish());return()=>{listener.active=false;listeners.delete(listener);};
}
export async function setDoc(ref,data){
 __readAttempts++;
 if(__failRead)throw Object.assign(new Error('Fixture receipt denied'),{code:'permission-denied'});
 __merchantReadWrites.push({path:ref.path,data});
 const [,uid,,id]=ref.path.split('/');__merchantReads[uid]=[...new Set([...(__merchantReads[uid]||[]),id])];__notifyMerchantReads();
}
`;
function fixture(staff) {
  const profile={id:staff?'team-one':'merchant-one',name:staff?'Team Member':'Millicent',role:'merchant',email:'account@example.invalid',phone:'+233241234567',city:'Takoradi',accountStatus:'active'};
  const store={id:'merchant-one',ownerId:'merchant-one',name:'Ada Groceries',category:'Groceries',address:'Market Circle, Takoradi',phone:profile.phone,imageUrl:'/images/store-placeholder.svg',open:true,approvalStatus:'approved',accountStatus:'active'};
  const sms=(id,orderId,type,date,patch={})=>({id,orderId,type,merchantId:store.id,customerId:'',sender:'KYE-TECH',status:'submitted',message:`Exact ${type} message for ${orderId}.`,createdAt:Date.parse('2026-11-11T12:00:00Z'),updatedAt:Date.parse(date),...patch});
  return {user:{uid:profile.id,email:profile.email},profile,isAdmin:false,adminLoading:false,authLoading:false,dataLoading:false,needsProfile:false,error:'',orders:[],riders:[],stores:[store,{...store,id:'store-two',ownerId:'store-two',name:'Second Store'}],
    storeTeam:{storeId:store.id,loading:false,canManageStore:true,error:'',invitations:[],members:[...(staff?[{id:'member-one',userId:profile.id,storeId:store.id,enabled:true}]:[]),{id:'member-two',userId:profile.id,storeId:'store-two',enabled:true}]},
    smsMessages:[sms('pickup-a','order-a','picked_up','2026-11-13T00:00:00Z'),sms('complete-a','order-a','delivered','2026-11-13T23:59:59Z'),sms('pickup-b','order-b','picked_up','2026-11-12T23:59:59Z'),sms('complete-b','order-b','delivered','2026-11-14T00:00:00Z'),
      sms('other-store','other-order','delivered','2026-11-14T02:00:00Z',{merchantId:'store-two',message:'PRIVATE SECOND STORE MESSAGE'}),sms('customer','customer-order','delivered','2026-11-14T03:00:00Z',{merchantId:'',customerId:'customer-one',message:'PRIVATE CUSTOMER MESSAGE'}),sms('failed','failed-order','picked_up','2026-11-14T02:00:00Z',{status:'failed',message:'FAILED MESSAGE'}),sms('pending','pending-order','picked_up','2026-11-14T02:00:00Z',{status:'submitting',message:'PENDING MESSAGE'}),sms('legacy','legacy-order','picked_up','2026-11-14T02:00:00Z',{message:''})]};
}
async function makePage(width,staff){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
 await context.addInitScript(value=>{globalThis.__merchantSmsFixture=value;globalThis.__merchantReads=JSON.parse(sessionStorage.getItem('fixture-merchant-reads')||'{}');globalThis.__merchantReadWrites=[];globalThis.__readAttempts=0;globalThis.__listenAttempts=0;globalThis.__failRead=false;globalThis.__failListen=false;globalThis.__copiedMerchantSms='';Object.defineProperty(navigator,'clipboard',{value:{async writeText(text){globalThis.__copiedMerchantSms=text;}}});},fixture(staff));
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin||url.pathname.startsWith('/api/'))return route.abort();if(url.pathname==='/src/context/PlatformContext.jsx')return route.fulfill({status:200,contentType:'application/javascript',body:provider});if(url.pathname==='/src/lib/firebase.js')return route.fulfill({status:200,contentType:'application/javascript',body:'export const db={};'});if(url.pathname.includes('/node_modules/.vite/deps/firebase_firestore.js'))return route.fulfill({status:200,contentType:'application/javascript',body:firestore});if(url.pathname==='/src/lib/useStoreCatalog.js')return route.fulfill({status:200,contentType:'application/javascript',body:'export function useStoreCatalog(){return {items:[],loading:false,error:"",canEdit:false};} export default useStoreCatalog;'});return route.continue();});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(baseUrl,{waitUntil:'networkidle'});
 const nav=page.getByRole('navigation',{name:width<720?'Mobile navigation':'Main navigation',exact:true});
 await nav.waitFor({state:'visible'});
 const labels=await nav.getByRole('button').allTextContents();assert.ok(labels.findIndex(label=>label.includes('SMS'))<labels.findIndex(label=>label.includes('Profile')));
 await nav.getByRole('button',{name:'SMS',exact:true}).click();await page.getByRole('heading',{name:'Store SMS',exact:true}).waitFor();return {context,page,nav,errors};
}
async function noOverflow(page,label){const sizes=await page.evaluate(()=>[innerWidth,document.documentElement.scrollWidth]);assert.ok(sizes[1]<=sizes[0]+1,label+' overflows: '+sizes);}
async function close(page){await page.getByRole('dialog').getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});}
try{
 for(const width of [1366,390,320])for(const staff of [false,true]){
  const {context,page,nav,errors}=await makePage(width,staff),uid=staff?'team-one':'merchant-one';
  try{
   assert.equal(await page.locator('.sms-message-card').count(),4);assert.equal(await page.locator('.sms-message-unread').count(),4);assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'4');
   assert.ok((await page.locator('.sms-message-card').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height))).every(height=>height<=70));
   assert.equal(await page.getByLabel('From date',{exact:true}).isVisible(),false);assert.equal(await page.getByLabel('To date',{exact:true}).isVisible(),false);
   assert.equal(await page.getByText('PRIVATE CUSTOMER MESSAGE',{exact:true}).count(),0);assert.equal(await page.getByText('PRIVATE SECOND STORE MESSAGE',{exact:true}).count(),0);assert.equal(await page.getByText('FAILED MESSAGE',{exact:true}).count(),0);
   await noOverflow(page,width+'px store inbox');if(!staff)await page.screenshot({path:output+'/inbox-'+width+'.png',fullPage:true});
   const firstView=page.getByRole('button',{name:'View completed delivery SMS KYE-RDER-B',exact:true});await firstView.click();const details=page.getByRole('dialog',{name:'SMS details',exact:true});
   assert.match(await details.innerText(),/Exact delivered message for order-b/);assert.match(await details.innerText(),/KYE-TECH/);assert.equal(await details.getByRole('button',{name:'Rate rider',exact:true}).count(),0);
   await page.waitForFunction(()=>__merchantReadWrites.length===1);assert.equal(await page.evaluate(()=>__merchantReadWrites[0].path),`users/${uid}/smsReads/complete-b`);assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'3');
   await noOverflow(page,width+'px store SMS details');if(!staff)await page.screenshot({path:output+'/details-'+width+'.png'});
   await details.getByRole('button',{name:'Copy completed delivery SMS KYE-RDER-B',exact:true}).click();assert.equal(await page.evaluate(()=>__copiedMerchantSms),'Exact delivered message for order-b.');await close(page);assert.ok(await firstView.evaluate(button=>button===document.activeElement));
   await page.getByRole('button',{name:'Pickup',exact:true}).click();assert.equal(await page.locator('.sms-message-card').count(),2);await page.getByRole('button',{name:'Completed',exact:true}).click();assert.equal(await page.locator('.sms-message-card').count(),2);
   await page.getByRole('button',{name:'All',exact:true}).click();await page.getByRole('button',{name:'Date filter',exact:true}).click();await page.getByLabel('From date',{exact:true}).fill('2026-11-13');await page.getByLabel('To date',{exact:true}).fill('2026-11-13');assert.equal(await page.locator('.sms-message-card').count(),2);
   await page.getByRole('button',{name:'Date filter',exact:true}).click();assert.equal(await page.getByLabel('From date',{exact:true}).isVisible(),false);assert.equal(await page.locator('.sms-message-card').count(),2);assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'3','Filters do not reduce the unread count.');
   await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.getByRole('button',{name:'Date filter',exact:true}).click();await page.getByLabel('From date',{exact:true}).fill('2026-11-14');await page.getByLabel('To date',{exact:true}).fill('2026-11-13');await page.getByRole('alert').filter({hasText:'Choose an end date'}).waitFor();assert.equal(await page.locator('.sms-message-card').count(),0);await page.getByRole('button',{name:'Clear filters',exact:true}).click();

   await page.evaluate(()=>{__failRead=true;});await page.getByRole('button',{name:'View pickup SMS KYE-RDER-A',exact:true}).click();assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'2');assert.equal(await page.getByRole('alert').filter({hasText:'Could not save this SMS as viewed'}).count(),0);await close(page);
   await context.addInitScript(()=>{__failRead=true;__failListen=true;});await page.reload({waitUntil:'networkidle'});await nav.getByRole('button',{name:'SMS',exact:true}).click();assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'2','Opened messages stay viewed after reload even when receipt reads and writes are denied.');assert.ok(await page.evaluate(()=>__readAttempts<=2),'Denied writes cannot loop.');
   await page.evaluate(()=>{__failRead=false;__failListen=false;window.dispatchEvent(new Event('online'));});await page.waitForFunction(()=>__merchantReadWrites.some(write=>write.path.endsWith('/pickup-a')));assert.ok(await page.evaluate(()=>__listenAttempts>=2),'Failed receipt subscriptions reconnect.');

   assert.equal(await page.getByLabel('Choose a store workspace',{exact:true}).count(),0);await page.evaluate(()=>__updateMerchantSms({storeTeam:{...__merchantSmsFixture.storeTeam,storeId:'store-two'}}));await page.getByRole('heading',{name:'Store SMS',exact:true}).waitFor();assert.equal(await page.locator('.sms-message-card').count(),1);assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'1');
   await page.getByRole('button',{name:'View completed delivery SMS KYE--ORDER',exact:true}).click();assert.match(await details.innerText(),/PRIVATE SECOND STORE MESSAGE/);await page.waitForFunction(()=>__merchantReadWrites.some(write=>write.path.endsWith('/other-store')));assert.equal(await page.evaluate(()=>__merchantReadWrites.at(-1).path),`users/${uid}/smsReads/other-store`);
   await page.evaluate(()=>__updateMerchantSms({storeTeam:{...__merchantSmsFixture.storeTeam,storeId:'merchant-one'}}));await details.waitFor({state:'hidden'});assert.equal(await page.locator('.sms-message-card').count(),4);assert.equal(await nav.locator('.sms-nav-unread-badge').innerText(),'2');
   await page.evaluate(()=>__updateMerchantSms({smsMessages:[...__merchantSmsFixture.smsMessages,{id:'new-merchant-sms',orderId:'order-c',type:'delivered',merchantId:'merchant-one',customerId:'',sender:'KYE-TECH',status:'submitted',message:'A new store delivery update.',createdAt:Date.now(),updatedAt:Date.now()}]}));await nav.locator('.sms-nav-unread-badge').filter({hasText:/^3$/}).waitFor();
   await page.evaluate(()=>__updateMerchantSms({smsMessages:[]}));await page.getByRole('heading',{name:'No SMS yet',exact:true}).waitFor();await noOverflow(page,width+'px empty store SMS');assert.deepEqual(errors,[]);
   console.log('PASS '+width+'px '+(staff?'store team':'store owner')+' SMS: compact copies, unread counts, private receipts, copying, date/stage filters, denied-save recovery, store switching, new updates and empty state.');
  }finally{await context.close();}
 }
}finally{await browser.close();}
