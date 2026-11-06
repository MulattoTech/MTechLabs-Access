import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {createDB,seedAuth} from './helpers/d1.js';
import {HUB_CARDS,visibilityKey} from '../src/hub-catalog.js';
import {homepageApi} from '../src/homepage.js';
import {adminApi} from '../src/admin.js';
import {createSession,ADMIN_COOKIE} from '../src/auth.js';
import {one,run} from '../src/db.js';
import {readFileSync} from 'node:fs';

const TEAM='test-owner.cloudflareaccess.com';
let signer,publicKey;
before(async()=>{
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  signer=pair.privateKey;
  publicKey={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'homepage-test-key'};
});
async function token(email='owner@example.com',aud='hub-audience'){
  const now=Math.floor(Date.now()/1000),enc=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
  const input=enc({alg:'RS256',kid:publicKey.kid})+'.'+enc({iss:'https://'+TEAM,aud:[aud],email,sub:email,iat:now-20,exp:now+3600});
  return input+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',signer,new TextEncoder().encode(input))).toString('base64url');
}
async function fixture(t){
  const DB=createDB();t.after(()=>DB.close());await seedAuth(DB);
  t.mock.method(globalThis,'fetch',async input=>{
    const url=typeof input==='string'?input:input.url;
    if(url==='https://'+TEAM+'/cdn-cgi/access/certs')return Response.json({keys:[publicKey]});
    throw Error('Unexpected external request');
  });
  return {DB,ACCESS_TEAM:TEAM,OWNER_EMAIL:'owner@example.com',HUB_HOST:'m-techlabs.com'};
}
async function request(email,method='GET',body=null,session=null){
  const headers={'Cf-Access-Jwt-Assertion':await token(email)};
  if(method==='POST'){
    headers['Origin']='https://m-techlabs.com';
    headers['Content-Type']='application/json';
    headers['X-CSRF-Token']=session.csrf;
    headers['Cookie']=ADMIN_COOKIE+'='+session.token;
  }
  return new Request('https://m-techlabs.com/admin/access/api/homepage',{method,headers,body:body?JSON.stringify(body):undefined});
}

test('catalog contains distinct stable cards and current user-facing app endpoints',()=>{
  assert.equal(new Set(HUB_CARDS.map(x=>x.id)).size,HUB_CARDS.length);
  const hrefs=HUB_CARDS.flatMap(x=>x.actions.map(a=>a[1]));
  for(const host of ['health.m-techlabs.com','tacticus.m-techlabs.com','fortnite.m-techlabs.com','codes.m-techlabs.com','mjobs.m-techlabs.com','tracker.m-techlabs.com','fleet.m-techlabs.com','feeds.m-techlabs.com','codexpro-widgets.m-techlabs.com','tacticus-auth.m-techlabs.com','mcp-staging.m-techlabs.com','homebox.m-techlabs.com']){
    assert.ok(hrefs.some(x=>x.includes(host)),host+' must appear in the owner directory');
  }
  assert.ok(HUB_CARDS.find(x=>x.id==='mbody').audience==='owner');
  assert.ok(!hrefs.some(href=>href.includes('/api/integrations/home-assistant/ingest')),'write-only ingestion must never be linked');
  const html=readFileSync(new URL('../integrations/hub/index.html',import.meta.url),'utf8');
  assert.ok(html.includes('data-cards="apps"'));
  assert.ok(!html.includes('health.m-techlabs.com'),'private URLs must be returned only after identity verification');
});

test('owner sees all enabled cards; an approved person sees only separately granted apps',async t=>{
  const env=await fixture(t);
  const owner=await homepageApi(await request('owner@example.com'),env);
  const ownerBody=await owner.json();
  assert.equal(ownerBody.owner,true);
  assert.equal(ownerBody.cards.length,HUB_CARDS.length);
  assert.ok(ownerBody.cards.some(x=>x.id==='mbody'));
  const wwwRequest=new Request('https://www.m-techlabs.com/admin/access/api/homepage',{headers:{'Cf-Access-Jwt-Assertion':await token()}});
  assert.equal((await (await homepageApi(wwwRequest,env)).json()).cards.length,HUB_CARDS.length);
  const noGrant=await (await homepageApi(await request('alice@example.com'),env)).json();
  assert.equal(noGrant.owner,false);
  assert.deepEqual(noGrant.cards,[]);
  await run(env.DB,'INSERT INTO grants(user_id,app_id,role,updated_at) VALUES(?,?,?,?)','alice','codes','viewer',1);
  const withGrant=await (await homepageApi(await request('alice@example.com'),env)).json();
  assert.deepEqual(withGrant.cards.map(x=>x.id),['tacticus-code-watch']);
  assert.ok(!withGrant.cards.some(x=>x.id==='mbody'));
});

test('unverified and suspended visitors cannot obtain the catalog',async t=>{
  const env=await fixture(t);
  await assert.rejects(homepageApi(new Request('https://m-techlabs.com/admin/access/api/homepage'),env),err=>err.status===401);
  await assert.rejects(homepageApi(await request('suspended@example.com'),env),err=>err.status===403);
});

test('owner switch persists globally without changing app grants or entry policies',async t=>{
  const env=await fixture(t),owner=await one(env.DB,'SELECT * FROM users WHERE id=?','owner');
  const session=await createSession(env,{kind:'owner',user:owner});
  const hide=await adminApi(await request('owner@example.com','POST',{id:'mbody',visible:false},session),env,{},'/homepage');
  assert.equal(hide.status,200);
  assert.equal((await one(env.DB,'SELECT value FROM settings WHERE key=?',visibilityKey('mbody'))).value,'0');
  const catalog=await (await homepageApi(await request('owner@example.com'),env)).json();
  assert.ok(!catalog.cards.some(x=>x.id==='mbody'));
  assert.equal((await one(env.DB,'SELECT access_mode FROM apps WHERE id=?','hub')).access_mode,'owner_only');
  await assert.rejects(adminApi(await request('owner@example.com','POST',{id:'unknown',visible:true},session),env,{},'/homepage'),err=>err.status===400);
  await assert.rejects(adminApi(await request('owner@example.com','POST',{id:'mbody',visible:'yes'},session),env,{},'/homepage'),err=>err.status===400);
  await adminApi(await request('owner@example.com','POST',{id:'mbody',visible:true},session),env,{},'/homepage');
  assert.equal((await one(env.DB,'SELECT value FROM settings WHERE key=?',visibilityKey('mbody'))).value,'1');
});
