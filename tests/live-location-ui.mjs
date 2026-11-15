// Exercise the real rider-sharing hook and customer map with local service doubles.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../.verification/login-tools/node_modules/playwright/index.mjs';
const origin = 'http://localhost:5173', output = '.verification/live-location';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const provider = `
import React from '/node_modules/.vite/deps/react.js';
import useRiderLocationSharing from '/src/lib/useRiderLocationSharing.js';
const listeners=new Set(), context=React.createContext(null);let state=globalThis.__fixture;
globalThis.__update=patch=>{state={...state,...patch};globalThis.__fixture=state;listeners.forEach(fn=>fn());};
export function PlatformProvider({children}){
 const snapshot=React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>state);
 const user={...snapshot.user,getIdToken:async()=> 'fixture-token'};
 const riderLocationSharing=useRiderLocationSharing({user,profile:snapshot.profile,orders:snapshot.orders});
 return React.createElement(context.Provider,{value:{...snapshot,user,riderLocationSharing,clearError(){},async logout(){},async saveProfile(){}}},children);
}
export function usePlatform(){return React.useContext(context);}
`;
const firestore = `
export const doc=(_db,...parts)=>({path:parts.join('/')});
export const collection=(_db,...parts)=>({path:parts.join('/')});
export const query=(ref,...filters)=>({...ref,filters});
export const where=(...parts)=>parts;
export async function getDoc(){throw new Error('Unexpected recipient review read in the live GPS fixture');}
export function onSnapshot(){throw new Error('Unexpected catalog subscription in the live GPS fixture');}
export const serverTimestamp=()=>Date.now();
export async function deleteDoc(ref){globalThis.__deletes.push(ref.path);const id=ref.path.split('/')[1],locations={...__fixture.liveLocations};delete locations[id];__update({liveLocations:locations});}
export async function runTransaction(_db,task){
 const writes=[];
 const result=await task({get:async ref=>{const id=ref.path.split('/')[1];const order=__fixture.orders.find(item=>item.id===id);if(__deferRead)await new Promise(resolve=>{globalThis.__releaseRead=resolve;});return {id,exists:()=>Boolean(order),data:()=>order};},set:(ref,data)=>writes.push({ref,data})});
 if(__deferCommit)await new Promise(resolve=>{globalThis.__releaseCommit=resolve;});
 for(const {ref,data}of writes){const id=ref.path.split('/')[1];globalThis.__writes.push({id,...data});__update({liveLocations:{...__fixture.liveLocations,[id]:data}});}
 return result;
}
`;
function fixture(role = 'rider') {
  const profile = { id: role + '-one', name: role === 'rider' ? 'Kofi Rider' : 'Abena Customer', role, email: 'account@example.invalid', phone: '+233241234567', city: 'Takoradi', accountStatus: 'active', approvalStatus: 'approved', online: true, bikeBrand: 'Apsonic', bikeModel: 'AP 125', plate: 'WR-100' };
  const order = { id: 'active-trip', status: 'accepted', creatorId: 'customer-one', creatorRole: 'customer', customerName: 'Abena Customer', customerPhone: '+233241234567', recipientName: 'Kwame', recipientPhone: '+233551234567', riderId: 'rider-one', riderName: 'Kofi Rider', pickup: 'Market Circle, Takoradi', dropoff: 'Effia, Takoradi', packageDescription: 'Groceries', fee: 25, createdAt: Date.now() };
  const orders = role === 'rider' ? [order, { ...order, id: 'second-trip', status: 'picked_up', customerName: 'Second Customer' }, { ...order, id: 'pending-trip', status: 'pending', riderId: null, riderName: '' }, { ...order, id: 'finished-trip', status: 'delivered' }] : [order];
  return { user: { uid: profile.id }, profile, authLoading: false, adminLoading: false, authActionPending: false, dataLoading: false, isAdmin: false, orders, riders: [], stores: [], smsMessages: [], liveLocations: {}, error: '' };
}
async function makePage(role, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(state => {
    globalThis.__fixture=state;globalThis.__writes=[];globalThis.__deletes=[];globalThis.__watchCalls=0;globalThis.__clearCalls=0;globalThis.__deferRead=false;globalThis.__deferCommit=false;
    Object.defineProperty(navigator,'geolocation',{value:{
      watchPosition(success,failure){__watchCalls++;globalThis.__gpsSuccess=success;globalThis.__gpsError=failure;queueMicrotask(()=>success({coords:{latitude:4.8917,longitude:-1.7554,accuracy:20},timestamp:Date.now()}));return 1;},
      clearWatch(){__clearCalls++;},
    }});
  },fixture(role));
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/src/context/PlatformContext.jsx')return route.fulfill({status:200,contentType:'application/javascript',body:provider});
    if(url.pathname==='/src/lib/firebase.js')return route.fulfill({status:200,contentType:'application/javascript',body:'export const db={};'});
    if(url.pathname.includes('/node_modules/.vite/deps/firebase_firestore.js'))return route.fulfill({status:200,contentType:'application/javascript',body:firestore});
    if(url.pathname==='/api/gps-address')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({address:'Market Circle, Takoradi, Western Region, Ghana'})});
    if(url.pathname.startsWith('/api/'))return route.abort();
    return route.continue();
  });
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install();
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.getByRole('heading',{level:1}).waitFor();
  return {page,context,errors};
}
async function noOverflow(page) { assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)); }
function locationPanel(page, id) { return page.getByRole('region', { name: 'Live GPS for delivery KYE-' + id.slice(-6).toUpperCase(), exact: true }); }
async function activeRequests(page, width = 390) {
  await page.getByRole('navigation',{name:width<720?'Mobile navigation':'Main navigation',exact:true}).getByRole('button',{name:/\bRequests\b/}).click();
  await page.getByRole('button',{name:/^Active \(/}).click();
}
async function openDelivery(page,id) {
  if(await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('button',{name:'View delivery KYE-'+id.slice(-6).toUpperCase(),exact:true}).click();
  await page.getByRole('dialog',{name:'Delivery details',exact:true}).waitFor();
}
try {
  const {page,context,errors}=await makePage('rider');
  try {
    assert.equal(await page.evaluate(()=>__watchCalls),0);
    const first = locationPanel(page, 'active-trip'), second = locationPanel(page, 'second-trip');
    assert.equal(await first.count(), 1);
    assert.equal(await page.locator('.workspace > .rider-location-control').count(), 0);
    assert.equal(await first.locator('xpath=ancestor::div[contains(@class,"order-card")]').count(), 1, 'GPS controls belong inside the delivery card.');
    await first.getByRole('button',{name:'Share live GPS',exact:true}).click();
    await page.getByText('Location shared. Updates about every 15 seconds.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>__watchCalls),1);
    assert.equal(await page.evaluate(()=>__writes.length),1);
    assert.equal(await page.evaluate(()=>__writes[0].id),'active-trip');
    await page.getByRole('navigation',{name:'Mobile navigation',exact:true}).getByRole('button',{name:'Performance',exact:true}).click();
    assert.equal(await page.locator('.rider-location-control').count(),0, 'Completed deliveries have no GPS sharing controls.');
    await page.evaluate(()=>__gpsSuccess({coords:{latitude:4.893,longitude:-1.753,accuracy:15},timestamp:Date.now()}));
    await page.clock.runFor(16000);
    assert.equal(await page.evaluate(()=>__writes.at(-1).latitude),4.893);
    assert.ok(await page.evaluate(()=>__writes.every(item=>item.id==='active-trip')), 'Starting one delivery cannot share another.');
    await page.getByRole('navigation',{name:'Mobile navigation',exact:true}).getByRole('button',{name:/\bRequests\b/}).click();
    assert.equal(await page.locator('.rider-location-control').count(),0, 'Incoming requests have no GPS sharing controls.');
    await page.getByRole('button',{name:/^Active \(/}).click();
    assert.equal(await page.locator('.rider-location-control').count(),0,'Compact request rows keep GPS controls inside View details.');
    await openDelivery(page,'active-trip');
    assert.equal(await first.getByRole('button',{name:'Stop sharing',exact:true}).count(),1);
    await openDelivery(page,'second-trip');
    assert.equal(await second.getByRole('button',{name:'Share live GPS',exact:true}).count(),1);
    await second.getByRole('button',{name:'Share live GPS',exact:true}).click();
    await page.clock.runFor(16000);
    assert.ok(await page.evaluate(()=>__writes.some(item=>item.id==='second-trip')));
    assert.equal(await page.evaluate(()=>__watchCalls),1, 'Selected deliveries use the same GPS watch.');
    await noOverflow(page);
    await page.screenshot({path:output+'/rider-sharing-390.png',animations:'disabled'});
    await openDelivery(page,'active-trip');
    await first.getByRole('button',{name:'Stop sharing',exact:true}).click();
    await first.getByRole('button',{name:'Share live GPS',exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>!__fixture.liveLocations['active-trip']&&__fixture.liveLocations['second-trip']));
    const afterFirstStop=await page.evaluate(()=>__writes.length);
    await page.evaluate(()=>__gpsSuccess({coords:{latitude:4.894,longitude:-1.752,accuracy:15},timestamp:Date.now()}));
    await page.clock.runFor(16000);
    assert.ok(await page.evaluate(index=>__writes.slice(index).every(item=>item.id==='second-trip'),afterFirstStop));
    assert.equal(await page.evaluate(()=>__clearCalls),0, 'Stopping one selected delivery keeps the other sharing.');
    await openDelivery(page,'second-trip');
    assert.equal(await second.getByRole('button',{name:'Stop sharing',exact:true}).count(),1);
    await second.getByRole('button',{name:'Stop sharing',exact:true}).click();
    await second.getByRole('button',{name:'Share live GPS',exact:true}).waitFor();
    const writes=await page.evaluate(()=>__writes.length);
    await page.evaluate(()=>__gpsSuccess({coords:{latitude:5,longitude:-1,accuracy:10},timestamp:Date.now()}));
    await page.clock.runFor(30000);
    assert.equal(await page.evaluate(()=>__writes.length),writes);
    assert.ok(await page.evaluate(()=>__clearCalls>0&&__deletes.length>0));
    await openDelivery(page,'active-trip');
    await page.evaluate(()=>{__deferRead=true;});
    await first.getByRole('button',{name:'Share live GPS',exact:true}).click();
    await page.waitForFunction(()=>typeof __releaseRead==='function');
    await first.getByRole('button',{name:'Stop sharing',exact:true}).click();
    await first.getByRole('button',{name:'Share live GPS',exact:true}).waitFor();
    await page.evaluate(()=>{__deferRead=false;__releaseRead();});
    await page.clock.runFor(1000);
    assert.equal(await page.evaluate(()=>__writes.length),writes,'Stopping must cancel a publication that is still reading the delivery.');
    await page.evaluate(()=>{__deferCommit=true;});
    await first.getByRole('button',{name:'Share live GPS',exact:true}).click();
    await page.waitForFunction(()=>typeof __releaseCommit==='function');
    await first.getByRole('button',{name:'Stop sharing',exact:true}).click();
    await first.getByRole('button',{name:'Share live GPS',exact:true}).waitFor();
    await page.evaluate(()=>{__deferCommit=false;__releaseCommit();});
    await page.clock.runFor(1000);
    assert.equal(await page.evaluate(()=>__writes.length),writes+1,'The queued write should have committed in this test.');
    assert.ok(await page.evaluate(()=>!__fixture.liveLocations['active-trip']),'A GPS write that finishes after Stop must be cleared.');
    await first.getByRole('button',{name:'Share live GPS',exact:true}).click();
    await page.getByText('Location shared. Updates about every 15 seconds.',{exact:true}).waitFor();
    await page.evaluate(()=>__update({orders:[...__fixture.orders,{...__fixture.orders[0],id:'extra-trip'}]}));
    await page.clock.runFor(16000);
    assert.ok(await page.evaluate(()=>!__writes.some(item=>item.id==='extra-trip')),'New deliveries must require their own sharing opt-in.');
    const third = locationPanel(page,'extra-trip');
    await openDelivery(page,'extra-trip');
    await third.getByRole('button',{name:'Share live GPS',exact:true}).click();
    await page.clock.runFor(16000);
    assert.ok(await page.evaluate(()=>__writes.some(item=>item.id==='extra-trip')));
    await page.evaluate(()=>__update({orders:__fixture.orders.map(order=>order.id==='active-trip'?{...order,status:'delivered'}:order)}));
    await first.waitFor({state:'hidden'});
    assert.equal(await third.getByRole('button',{name:'Stop sharing',exact:true}).count(),1);
    assert.ok(await page.evaluate(()=>!__fixture.liveLocations['active-trip']&&__fixture.liveLocations['extra-trip']));
    await page.evaluate(()=>__update({orders:__fixture.orders.map(order=>order.id==='extra-trip'?{...order,riderId:'another-rider'}:order)}));
    await third.waitFor({state:'hidden'});
    assert.ok(await page.evaluate(()=>!__fixture.liveLocations['extra-trip']));
    await page.evaluate(()=>__update({orders:__fixture.orders.map(order=>({...order,status:'delivered'}))}));
    assert.equal(await page.locator('.rider-location-control').count(),0);
    assert.ok(await page.evaluate(()=>__clearCalls>=2));
    assert.deepEqual(errors,[]);
    console.log('PASS real rider sharing hook: separate delivery opt-in and stop, one GPS watch, throttled moving GPS, navigation, in-flight stop, new delivery consent, completion and reassignment cleanup.');
  } finally { await context.close(); }
  for(const width of [1366,390,320]) {
    const {page,context,errors}=await makePage('rider',width);
    try {
      await activeRequests(page,width);
      const first=locationPanel(page,'active-trip'),second=locationPanel(page,'second-trip');
      assert.equal(await page.locator('.rider-location-control').count(),0);
      await openDelivery(page,'active-trip');
      assert.equal(await page.locator('.rider-location-control').count(),1);
      await noOverflow(page);
      await page.screenshot({path:output+'/rider-delivery-gps-'+width+'.png',fullPage:true,animations:'disabled'});
      await first.getByRole('button',{name:'Share live GPS',exact:true}).click();
      await first.getByText('Location shared. Updates about every 15 seconds.',{exact:true}).waitFor();
      await first.getByText('Market Circle, Takoradi, Western Region, Ghana',{exact:true}).waitFor();
      await openDelivery(page,'second-trip');
      assert.equal(await second.getByRole('button',{name:'Share live GPS',exact:true}).count(),1);
      await openDelivery(page,'active-trip');
      await noOverflow(page);
      await page.screenshot({path:output+'/rider-delivery-sharing-'+width+'.png',fullPage:true,animations:'disabled'});
      await page.evaluate(()=>__gpsError({code:1}));
      await first.getByText('Allow location access in your browser to share with your customer.',{exact:true}).waitFor();
      assert.equal(await second.getByRole('alert').count(),0);
      await first.getByRole('button',{name:'Share live GPS',exact:true}).click();
      await first.getByText('Location shared. Updates about every 15 seconds.',{exact:true}).waitFor();
      assert.equal(await first.getByRole('alert').count(),0);
      assert.deepEqual(errors,[]);
      console.log('PASS '+width+'px rider delivery GPS placement, live address, individual controls, permission error and retry.');
    } finally {await context.close();}
  }
  for(const width of [1366,390,320]) {
    const {page,context,errors}=await makePage('customer',width);
    try {
      await page.evaluate(()=>__update({liveLocations:{'active-trip':{riderId:'rider-one',sharing:true,latitude:4.8917,longitude:-1.7554,accuracy:20,address:'Market Circle, Takoradi, Western Region, Ghana',updatedAt:Date.now()}}}));
      await page.getByText('Your rider is sharing live',{exact:true}).waitFor();
      assert.equal(await page.locator('.live-rider-marker').count(),1);
      assert.equal(new URL(await page.getByRole('link',{name:'Open map',exact:true}).getAttribute('href')).searchParams.get('query'),'4.891700, -1.755400');
      await noOverflow(page);
      await page.screenshot({path:output+'/customer-live-'+width+'.png',fullPage:true,animations:'disabled'});
      await page.clock.runFor(100000);
      await page.getByText('Last shared rider location',{exact:true}).waitFor();
      assert.equal(await page.locator('.live-location-badge').count(),0);
      await page.evaluate(()=>__update({liveLocations:{}}));
      assert.equal(await page.locator('.live-rider-map').count(),0);
      assert.deepEqual(errors,[]);
      console.log('PASS '+width+'px customer live map, GPS address, stale update and stopped-sharing display.');
    } finally {await context.close();}
  }
} finally {await browser.close();}
