// Local merchant team layout and interactions; no real invitations or account emails.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../.verification/login-tools/node_modules/playwright/index.mjs';
const origin='http://localhost:5173', output='.verification/store-team';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const module=`
import React from '/node_modules/.vite/deps/react.js';
const listeners=new Set();let state=globalThis.__fixture;
const publish=patch=>{state={...state,...patch};globalThis.__fixture=state;listeners.forEach(fn=>fn());};
globalThis.__update=publish;
export function PlatformProvider({children}){return children;}
export function usePlatform(){const snapshot=React.useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn);},()=>state);return {...snapshot,clearError(){},async logout(){},storeTeam:{...snapshot.storeTeam,friendlyError:e=>e.message,async invite(email){globalThis.__invites.push(email);publish({storeTeam:{...state.storeTeam,invitations:[...state.storeTeam.invitations,{id:'invite-one',ownerId:'merchant-one',storeId:'merchant-one',storeName:'Ada Groceries',email,status:'pending',memberId:''}]}});},async revoke(id){globalThis.__revokes.push(id);publish({storeTeam:{...state.storeTeam,invitations:state.storeTeam.invitations.filter(item=>item.id!==id)}});},async verifyEmail(){globalThis.__verifications++;},async accept(id){globalThis.__accepts.push(id);const invite=state.storeTeam.invitations.find(item=>item.id===id);publish({storeTeam:{...state.storeTeam,storeId:invite.storeId,invitations:state.storeTeam.invitations.map(item=>item.id===id?{...item,status:'accepted',memberId:state.user.uid}:item),members:[{id:'member-one',userId:state.user.uid,storeId:invite.storeId,inviteId:id,enabled:true}]}});}}};}
`;
function fixture(staff=false){
 const profile={id:staff?'teammate':'merchant-one',name:staff?'Team Member':'Millicent',role:'merchant',email:staff?'team@example.invalid':'owner@example.invalid',phone:'+233241234567',city:'Takoradi',accountStatus:'active'};
 const store={id:'merchant-one',ownerId:'merchant-one',name:'Ada Groceries',category:'Groceries',description:'Fresh groceries and everyday essentials.',address:'Market Circle, Takoradi',phone:'+233241234567',imageUrl:'/images/store-placeholder.svg',approvalStatus:'approved',accountStatus:'active',open:true};
 const order={id:'store-trip',creatorId:store.id,creatorRole:'merchant',merchantId:store.id,customerName:profile.name,customerPhone:profile.phone,status:'pending',riderId:null,recipientName:'Kwame Receiver',recipientPhone:'+233551234567',pickup:store.address,dropoff:'Effia, Takoradi',packageDescription:'One bag of groceries',fee:25,createdAt:Date.now()};
 return {user:{uid:profile.id,email:profile.email},profile,authLoading:false,adminLoading:false,dataLoading:false,isAdmin:false,error:'',stores:[store],riders:[],orders:[order],smsMessages:[],storeTeam:{storeId:profile.id,members:[],invitations:staff?[{id:'invite-one',storeId:store.id,ownerId:store.id,storeName:store.name,email:profile.email,status:'pending',memberId:''}]:[],loading:false,canManageStore:true,error:''}};
}
async function makePage(width,staff,patch={}){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
 await context.addInitScript(state=>{globalThis.__fixture=state;globalThis.__invites=[];globalThis.__revokes=[];globalThis.__accepts=[];globalThis.__verifications=0;globalThis.__retries=0;__fixture.storeTeam.retry=()=>__retries++;},{...fixture(staff),...patch});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin||url.pathname.startsWith('/api/'))return route.abort();if(url.pathname==='/src/context/PlatformContext.jsx')return route.fulfill({status:200,contentType:'application/javascript',body:module});return route.continue();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin,{waitUntil:'networkidle'});if(patch.dataLoading)await page.getByText('Loading your deliveries…',{exact:true}).waitFor();else await page.getByRole('heading',{level:1}).waitFor();
 return {page,context,errors};
}
async function noOverflow(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
try{
 for(const width of [1366,390,320]){
  const {page,context,errors}=await makePage(width,false);
  try{
   assert.equal(await page.getByRole('heading',{level:1}).innerText(),'Ada Groceries');
   assert.equal(await page.getByText('YOUR MERCHANT WORKSPACE',{exact:true}).count(),0);
   assert.equal(await page.getByText('Your store, your customers, delivered.',{exact:true}).count(),0);
   assert.equal(await page.getByRole('heading',{name:'Hi, Millicent',exact:true}).count(),0);
   assert.equal(await page.getByLabel('Choose a store workspace',{exact:true}).count(),0);
   assert.equal(await page.getByText('My own store',{exact:true}).count(),0);
   const nav=page.getByRole('navigation',{name:width<720?'Mobile navigation':'Main navigation',exact:true});
   await nav.getByRole('button',{name:'My store',exact:true}).click();
   await page.getByLabel('Team member email',{exact:true}).fill('team@example.invalid');
   await page.getByRole('button',{name:'Add team member',exact:true}).click();
   await page.getByText('Invitation pending',{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>__invites),['team@example.invalid']);
   await noOverflow(page);
   await page.locator('.store-team-panel').scrollIntoViewIfNeeded();
   await page.screenshot({path:output+'/owner-team-'+width+'.png',animations:'disabled'});
   await page.getByRole('button',{name:'Remove access',exact:true}).click();
   await page.getByText('Your team members will appear here.',{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>__revokes),['invite-one']);
   assert.deepEqual(errors,[]);
   console.log('PASS '+width+'px merchant home, team invitation and removal layout.');
  }finally{await context.close();}
 }
 const {page,context,errors}=await makePage(320,true);
 try{
  await page.getByRole('button',{name:'Verify email',exact:true}).click();
  assert.equal(await page.evaluate(()=>__verifications),1);
  await page.getByRole('button',{name:'Accept invitation',exact:true}).click();
  await page.getByRole('heading',{name:'Ada Groceries',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Request a rider',exact:true}).isDisabled(),false);
  assert.equal(await page.getByLabel('Choose a store workspace',{exact:true}).count(),0);
  assert.equal(await page.getByText('My own store',{exact:true}).count(),0);
  const nav=page.getByRole('navigation',{name:'Mobile navigation',exact:true});
  await nav.getByRole('button',{name:'Deliveries',exact:true}).click();
  await page.locator('.merchant-delivery-list').getByRole('button').first().click();
  await page.getByText('Recipient: Kwame Receiver',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Cancel request',exact:true}).count(),1);
  await page.getByRole('dialog').getByRole('button',{name:'Close dialog',exact:true}).click();
  await nav.getByRole('button',{name:'My store',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Edit store',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Close store',exact:true}).isDisabled(),true);
  assert.equal(await page.getByLabel('Team member email',{exact:true}).count(),0);
  await noOverflow(page);
  await page.screenshot({path:output+'/staff-store-320.png',animations:'disabled'});
  assert.deepEqual(errors,[]);
  console.log('PASS invited merchant acceptance, automatic store entry, delivery management and owner-only settings.');
 }finally{await context.close();}
 const loadingFixture=fixture(true), scopedLoading=await makePage(390,true,{dataLoading:true,storeTeam:{...loadingFixture.storeTeam,storeId:'',loading:true,invitations:[]}});
 try{
  const {page,errors}=scopedLoading;
  assert.equal(await page.getByRole('button',{name:'Set up store',exact:true}).count(),0);
  assert.equal(await page.getByRole('heading',{name:'Your store dashboard',exact:true}).count(),0);
  await page.evaluate(()=>__update({dataLoading:false,storeTeam:{...__fixture.storeTeam,loading:false,accessUnavailable:true,error:'Store team access could not be loaded. Check your connection and try again.'}}));
  await page.getByRole('heading',{name:'Store access unavailable',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Set up store',exact:true}).count(),0);
  await page.getByRole('button',{name:'Retry store access',exact:true}).click();
  assert.equal(await page.evaluate(()=>__retries),1);
  await page.getByRole('navigation',{name:'Mobile navigation',exact:true}).getByRole('button',{name:'Profile',exact:true}).click();
  await page.getByRole('heading',{name:'Your profile',exact:true}).waitFor();
  await noOverflow(page);assert.deepEqual(errors,[]);
  console.log('PASS unfinished store access shows loading, failed access shows retry, and Profile remains accessible.');
 }finally{await scopedLoading.context.close();}
}finally{await browser.close();}
