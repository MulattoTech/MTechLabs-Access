import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../src/index.js';
import {validatePolicy,managerConfiguration,projectManagerStatus} from '../src/mcp.js';
import {createSession,ADMIN_COOKIE} from '../src/auth.js';
import {one,run,rows} from '../src/db.js';
import {createDB,seedAuth} from './helpers/d1.js';

const TEAM='mcp-test-owner.cloudflareaccess.com';
const ORIGIN='https://mcp-origin.m-techlabs.com';
const SERVICE_TOKEN='test-manager-credential-not-for-the-browser-00001';
let signer,publicKey;
before(async()=>{
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  signer=pair.privateKey;publicKey={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'mcp-test-key'};
});
async function identity(email='owner@example.com',audience='hub-audience'){
  const now=Math.floor(Date.now()/1000),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const input=encode({alg:'RS256',kid:publicKey.kid})+'.'+encode({iss:`https://${TEAM}`,aud:[audience],email,sub:email,iat:now-10,exp:now+3600});
  return input+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',signer,new TextEncoder().encode(input))).toString('base64url');
}
async function fixture(t,configured=true){
  const DB=createDB();t.after(()=>DB.close());await seedAuth(DB);
  return {DB,ACCESS_TEAM:TEAM,OWNER_EMAIL:'owner@example.com',ACCOUNT_ID:'test-account',HUB_HOST:'m-techlabs.com',CODE_HOST:'codes.m-techlabs.com',
    ...(configured?{MCP_MANAGER_ORIGIN:ORIGIN,MCP_MANAGER_TOKEN:SERVICE_TOKEN}:{})};
}
function sample(){return {
  schemaVersion:1,service:{name:'M-TechLabs MCP Manager',version:'0.1.0',state:'running',uptimeSeconds:12},
  policy:{enabled:true,readOnly:true,maxInflight:1},policyValid:true,runtime:{nodeVersion:'v24.0.0',packageVersion:'0.2.0',installed:true},
  resources:{freeMemoryBytes:32*1073741824,totalMemoryBytes:64*1073741824,lowMemoryFloorBytes:4*1073741824,admissionOpen:true,disk:{freeBytes:200*1073741824,totalBytes:2000*1073741824}},
  limits:{maxInflightPerInstance:1,queueCapacityPerInstance:16,detachedJobsCapped:false},
  instances:[{id:'instance-1',client:'Claude Desktop',state:'active',startedAt:'2026-11-05T20:00:00Z',lastSeenAt:'2026-11-05T20:00:12Z',inflight:0,queued:0,initialized:true}],
  inventory:{generatedAt:'2026-11-05T20:00:00Z',entries:[{id:'local',name:'Desktop Commander',client:'Claude Desktop',transport:'stdio',management:'managed',configured:true,connection:'connected',tested:true},
    {id:'remote',name:'Remote Desktop Commander',client:'ChatGPT web',transport:'http',management:'hosted',configured:true,connection:'unknown',tested:false}]},
  boundaries:['Only managed wrappers are controlled.'],warnings:[],
};}
function mockNetwork(t,callback){
  const calls=[];t.mock.method(globalThis,'fetch',async(input,options)=>{
    const url=typeof input==='string'?input:input.url;
    if(url===`https://${TEAM}/cdn-cgi/access/certs`)return Response.json({keys:[publicKey]});
    calls.push({url,options});return callback?callback(url,options):Response.json(sample());
  });return calls;
}
async function get(env,path='/admin/mcp/api/status',headers={}){
  return worker.fetch(new Request('https://m-techlabs.com'+path,{headers:{'Cf-Access-Jwt-Assertion':await identity(),...headers}}),env,{});
}
async function post(env,body,extra={},path='/admin/mcp/api/policy'){
  const user=await one(env.DB,"SELECT * FROM users WHERE id='owner'"),session=await createSession(env,{kind:'owner',user});
  return worker.fetch(new Request('https://m-techlabs.com'+path,{method:'POST',headers:{
    'Cf-Access-Jwt-Assertion':await identity(),Cookie:`${ADMIN_COOKIE}=${session.token}`,Origin:'https://m-techlabs.com',
    'Content-Type':'application/json','X-CSRF-Token':session.csrf,...extra,
  },body:JSON.stringify(body)}),env,{});
}

test('MCP page, assets and API reject unauthenticated and non-owner callers',async t=>{
  const env=await fixture(t),calls=mockNetwork(t);
  for(const path of ['/admin/mcp','/admin/mcp/assets/mcp.js','/admin/mcp/assets/mcp.css','/admin/mcp/api/status']){
    const anonymous=await worker.fetch(new Request('https://m-techlabs.com'+path),env,{});assert.equal(anonymous.status,401);
    const alice=await get(env,path,{'Cf-Access-Jwt-Assertion':await identity('alice@example.com')});assert.equal(alice.status,403);
  }
  assert.equal(calls.length,0);
});

test('unconfigured manager is explicit, creates owner CSRF session and never contacts an origin',async t=>{
  const env=await fixture(t,false),calls=mockNetwork(t),response=await get(env),data=await response.json();
  assert.equal(response.status,200);assert.equal(data.configured,false);assert.equal(data.connected,false);assert.equal(data.status,null);assert.equal(data.reason,'not_configured');
  assert.equal(typeof data.csrf,'string');assert.match(response.headers.get('Set-Cookie'),/__Host-mtl-admin=.*HttpOnly; Secure/);assert.equal(calls.length,0);
});

test('status uses only the fixed origin, minimal headers and manual redirects',async t=>{
  const env=await fixture(t),raw=sample();raw.token=SERVICE_TOKEN;raw.localPath='C:\\private\\credentials';raw.service.secret=SERVICE_TOKEN;raw.runtime.command='SECRET';raw.warnings=['SECRET C:\\private\\logs'];
  const calls=mockNetwork(t,()=>Response.json(raw));
  const response=await get(env,'/admin/mcp/api/status',{Cookie:'personal=value','X-Forwarded-Host':'attacker.invalid'}),data=await response.json();
  assert.equal(data.connected,true);assert.equal(data.status.inventory.entries[1].connection,'unknown');
  assert.equal(calls.length,1);assert.equal(calls[0].url,ORIGIN+'/v1/status');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'manual');
  assert.deepEqual(calls[0].options.headers,{Accept:'application/json',Authorization:'Bearer '+SERVICE_TOKEN});
  assert.equal(calls[0].options.body,undefined);assert.equal(JSON.stringify(data).includes(SERVICE_TOKEN),false);assert.equal(JSON.stringify(data).includes('private'),false);assert.equal(JSON.stringify(data).includes('SECRET'),false);
  assert.equal(data.status.diagnosticCounts.warnings,1);
});

test('configuration cannot target a caller-selected, alternate or insecure origin',async t=>{
  const env=await fixture(t),calls=mockNetwork(t);
  for(const origin of ['https://evil.invalid',ORIGIN+'/',ORIGIN+'?target=elsewhere','http://mcp-origin.m-techlabs.com',ORIGIN+':8443']){
    env.MCP_MANAGER_ORIGIN=origin;const data=await (await get(env)).json();assert.equal(data.configured,false);assert.equal(data.connected,false);
  }
  assert.equal(calls.length,0);assert.equal(managerConfiguration({...env,MCP_MANAGER_ORIGIN:ORIGIN,MCP_MANAGER_TOKEN:'short'}),null);
});

test('an accidental service credential echo in an allowlisted label fails closed',async t=>{
  const env=await fixture(t),raw=sample();raw.inventory.entries[0].name=SERVICE_TOKEN;
  mockNetwork(t,()=>Response.json(raw));const data=await (await get(env)).json();
  assert.equal(data.connected,false);assert.equal(data.status,null);assert.equal(JSON.stringify(data).includes(SERVICE_TOKEN),false);
});

test('redirects, non-JSON, oversized responses and failures remain offline without response disclosure',async t=>{
  const env=await fixture(t);let reply;
  const calls=mockNetwork(t,()=>reply());
  const replies=[()=>new Response('SECRET',{status:302,headers:{Location:'https://evil.invalid'}}),()=>new Response('SECRET',{status:503}),
    ()=>new Response('SECRET',{headers:{'Content-Type':'text/html'}}),()=>new Response('{bad SECRET',{headers:{'Content-Type':'application/json'}}),
    ()=>new Response(JSON.stringify({...sample(),extra:'x'.repeat(65536)}),{headers:{'Content-Type':'application/json'}}),
    ()=>Response.json({schemaVersion:2,token:SERVICE_TOKEN}),()=>{throw Error('SECRET network error');}];
  for(const next of replies){reply=next;const data=await (await get(env)).json();assert.equal(data.configured,true);assert.equal(data.connected,false);assert.equal(data.status,null);assert.equal(JSON.stringify(data).includes('SECRET'),false);}
  assert.equal(calls.length,replies.length);
});

test('verified owner policy update relays only three fields and records safe audit events',async t=>{
  const env=await fixture(t),policy={enabled:false,readOnly:true,maxInflight:32};
  const calls=mockNetwork(t,()=>Response.json({ok:true,policy,appliesTo:'new_tool_calls',runningCommandsInterrupted:false,secret:SERVICE_TOKEN}));
  const response=await post(env,policy),data=await response.json();assert.equal(response.status,200);assert.deepEqual(data.policy,policy);assert.equal(data.runningCommandsInterrupted,false);
  assert.equal(calls.length,1);assert.equal(calls[0].url,ORIGIN+'/v1/policy');assert.equal(calls[0].options.method,'POST');assert.deepEqual(JSON.parse(calls[0].options.body),policy);
  assert.deepEqual(Object.keys(calls[0].options.headers).sort(),['Accept','Authorization','Content-Type']);assert.equal(JSON.stringify(data).includes(SERVICE_TOKEN),false);
  const events=await rows(env.DB,"SELECT * FROM audit WHERE target='mcp-manager' ORDER BY id");assert.deepEqual(events.map(item=>item.outcome),['requested','allowed']);assert.equal(events[0].actor,'owner@example.com');assert.equal(JSON.stringify(events).includes(SERVICE_TOKEN),false);
});

test('invalid or expanded policy payloads never reach the local API',async t=>{
  const env=await fixture(t),calls=mockNetwork(t);
  for(const body of [null,[],{}, {enabled:true,readOnly:true,maxInflight:0},{enabled:true,readOnly:true,maxInflight:65},
    {enabled:true,readOnly:true,maxInflight:'2'},{enabled:'true',readOnly:true,maxInflight:1},{enabled:true,readOnly:false,maxInflight:1,command:'whoami'},
    {enabled:true,readOnly:true,maxInflight:1,url:'https://evil.invalid'}, {enabled:true,readOnly:true}]){
    assert.equal((await post(env,body)).status,400);
  }
  assert.equal(calls.length,0);assert.throws(()=>validatePolicy({enabled:true,readOnly:true,maxInflight:1.5}));
});

test('policy writes require current owner session, correct audience and exact-origin CSRF',async t=>{
  const env=await fixture(t),calls=mockNetwork(t),policy={enabled:true,readOnly:true,maxInflight:1};
  for(const [headers,code] of [[{'X-CSRF-Token':''},403],[{Origin:'https://codes.m-techlabs.com'},403],
    [{Cookie:''},401],[{'Cf-Access-Jwt-Assertion':await identity('alice@example.com')},403],
    [{'Cf-Access-Jwt-Assertion':await identity('owner@example.com','codes-audience')},401]]){
    assert.equal((await post(env,policy,headers)).status,code);
  }
  assert.equal(calls.length,0);
});

test('unknown actions and wrong methods never become an arbitrary proxy',async t=>{
  const env=await fixture(t),calls=mockNetwork(t),policy={enabled:true,readOnly:true,maxInflight:1};
  assert.equal((await get(env,'/admin/mcp/api/policy')).status,405);
  assert.equal((await post(env,policy,{},'/admin/mcp/api/status')).status,405);
  assert.equal((await post(env,policy,{},'/admin/mcp/api/exec')).status,404);
  assert.equal((await post(env,policy,{},'/admin/mcp/api/v1/policy')).status,404);
  assert.equal(calls.length,0);
});

test('unverified policy reply is not retried or represented as success',async t=>{
  const env=await fixture(t),policy={enabled:false,readOnly:true,maxInflight:1};
  const calls=mockNetwork(t,()=>Response.json({ok:true,policy:{...policy,enabled:true},appliesTo:'new_tool_calls',runningCommandsInterrupted:false}));
  const response=await post(env,policy);assert.equal(response.status,502);assert.match((await response.json()).error,/Refresh status before retrying/);assert.equal(calls.length,1);
  assert.deepEqual((await rows(env.DB,"SELECT outcome FROM audit WHERE target='mcp-manager' ORDER BY id")).map(item=>item.outcome),['requested','unverified']);
});

test('owner session revocation blocks a policy write before the local API',async t=>{
  const env=await fixture(t),calls=mockNetwork(t),user=await one(env.DB,"SELECT * FROM users WHERE id='owner'");
  const session=await createSession(env,{kind:'owner',user});await run(env.DB,'UPDATE sessions SET revoked_at=? WHERE id=?',Math.floor(Date.now()/1000),session.id);
  const request=new Request('https://m-techlabs.com/admin/mcp/api/policy',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':await identity(),Cookie:`${ADMIN_COOKIE}=${session.token}`,Origin:'https://m-techlabs.com','X-CSRF-Token':session.csrf,'Content-Type':'application/json'},body:JSON.stringify({enabled:true,readOnly:true,maxInflight:1})});
  assert.equal((await worker.fetch(request,env,{})).status,401);assert.equal(calls.length,0);
});

test('owner page assets use existing security headers and explain real control boundaries',async t=>{
  const env=await fixture(t);mockNetwork(t);
  const response=await get(env,'/admin/mcp'),html=await response.text();assert.equal(response.status,200);assert.match(html,/managed local wrappers only/);assert.match(html,/Website application grants do not authorize/);assert.match(html,/Codex\/Claude built-in tools and separately connected hosted services are not controlled by this MCP policy/);assert.match(html,/do not interrupt commands already running/);assert.match(html,/href="\/admin\/access"/);
  assert.equal(response.headers.get('X-Frame-Options'),'DENY');assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'self'/);
  for(const path of ['/admin/mcp/assets/mcp.js','/admin/mcp/assets/mcp.css','/admin/mcp/assets/style.css'])assert.equal((await get(env,path)).status,200);
});

test('management inventory is display-only and cannot create delegated local-tool grants',async t=>{
  const env=await fixture(t);mockNetwork(t);
  const response=await get(env,'/admin/access/api/bootstrap'),data=await response.json();
  assert.equal(data.management[0].id,'mcp-manager');assert.equal(data.management[0].access_mode,'owner_only');assert.equal(data.management[0].managed,0);assert.equal(data.management[0].href,'/admin/mcp');
  assert.equal(await one(env.DB,"SELECT * FROM apps WHERE id='mcp-manager'"),null);
  const denied=await post(env,{userId:'alice',appId:'mcp-manager',role:'access'}, {}, '/admin/access/api/grants');assert.equal(denied.status,400);
});

test('unknown status values are not shown as healthy or zero and arbitrary fields are dropped',()=>{
  const raw=sample();raw.resources={};raw.runtime={};raw.limits={};raw.policy=null;raw.policyValid=true;raw.instances=[{id:'test',client:'Unknown client'}];
  const projected=projectManagerStatus(raw);assert.equal(projected.resources.freeMemoryBytes,null);assert.equal(projected.resources.admissionOpen,null);assert.equal(projected.runtime.installed,null);assert.equal(projected.limits.detachedJobsCapped,null);assert.equal(projected.policyValid,false);assert.equal(projected.instances[0].inflight,null);assert.equal(projected.instances[0].state,'unknown');
});

test('remote backend status is projected without inventing browser sign-in evidence',()=>{
  const raw=sample();raw.remoteMcp={transport:'streamable-http',endpoint:'/mcp',state:'idle',sdkLoaded:true,sharedBackend:true,
    activeHttpRequests:0,maxHttpRequests:8,idleTimeoutSeconds:300,idleTeardownDeferred:false,lastToolListCount:null,
    lastSuccessfulRequestAt:null,lastSuccessfulToolAt:null,clientIdentityTracked:true,accessToken:'SECRET',clientEmail:'private@example.com'};
  const remote=projectManagerStatus(raw).remoteMcp;assert.equal(remote.state,'idle');assert.equal(remote.clientIdentityTracked,false);
  assert.equal(remote.lastToolListCount,null);assert.equal(remote.lastSuccessfulToolAt,null);assert.equal(remote.sharedBackend,true);
  assert.equal(JSON.stringify(remote).includes('SECRET'),false);assert.equal(JSON.stringify(remote).includes('private@example.com'),false);
  raw.remoteMcp={state:'unrecognized',endpoint:'https://evil.invalid'};const unknown=projectManagerStatus(raw).remoteMcp;
  assert.equal(unknown.state,'unknown');assert.equal(unknown.endpoint,null);assert.equal(unknown.sdkLoaded,null);assert.equal(unknown.activeHttpRequests,null);
});

test('connect instructions link the private ChatGPT connector without claiming individual OAuth status',async()=>{
  const html=await readFile(new URL('../public/mcp.html',import.meta.url),'utf8');
  assert.match(html,/https:\/\/mcp\.m-techlabs\.com\/mcp/);assert.match(html,/dynamic client registration \(DCR\)/);
  assert.match(html,/href="https:\/\/chatgpt\.com\/plugins\/plugins_6aed1a85300481919559498b458ed278" target="_blank" rel="noopener noreferrer"/);
  assert.match(html,/href="https:\/\/claude\.ai" target="_blank" rel="noopener noreferrer"/);assert.match(html,/OAuth with automatic client registration/);
  assert.match(html,/This page does not track individual client OAuth sign-in/);assert.equal(html.includes('Manual sign-in pending'),false);
  assert.match(html,/does not replace or modify your hosted Remote Desktop Commander connection/);
  assert.match(html,/not proof of completed ChatGPT or Claude OAuth sign-in/);assert.equal(html.includes(SERVICE_TOKEN),false);
});

test('admin and manager UI retain separate permissions, controlled refresh and no browser credential',async()=>{
  const [admin,html,client]=await Promise.all(['admin.js','admin.html','mcp.js'].map(file=>readFile(new URL('../public/'+file,import.meta.url),'utf8')));
  assert.match(admin,/mcpPermissionNote\(\)/);assert.match(admin,/mcpManagementCard\(\)/);assert.match(html,/href="\/admin\/mcp"/);
  assert.match(client,/30000/);assert.match(client,/!document.hidden && !dirty/);assert.match(client,/maxInflight:Number/);
  assert.match(client,/updateConcurrencyPreview/);assert.match(client,/data-mcp-capacity/);
  assert.match(client,/older gateway\(s\)/);assert.match(client,/Continue anyway\?/);
  const managerHtml=await readFile(new URL('../public/mcp.html',import.meta.url),'utf8');
  assert.match(managerHtml,/type="range" min="1" max="64"/);assert.match(managerHtml,/data-mcp-capacity="32">32 · Fleet/);
  assert.match(managerHtml,/id="mcp-capacity-warning" aria-live="polite"/);
  assert.equal(client.includes('MCP_MANAGER_TOKEN'),false);assert.equal(client.includes('Authorization'),false);assert.equal(client.includes(ORIGIN),false);
});

test('shared scheduling, resource use and installation records retain only bounded safe evidence',()=>{
  const raw=sample();
  raw.resources={...raw.resources,lowDiskFloorBytes:10*1073741824,managerResidentBytes:80*1048576,managerHeapUsedBytes:20*1048576,processCommand:'SECRET'};
  raw.limits={...raw.limits,scope:'shared-state-directory',maxInflightGlobal:2,queueCapacityGlobal:64};
  raw.coordinator={available:true,scope:'shared-state-directory',inflight:2,queued:3,uncertain:1,queueCapacity:64,
    clients:[{client:'claude-code',inflight:1,queued:2,uncertain:1,token:'SECRET'}],
    recentEvents:[{time:'2026-11-06T01:00:00Z',type:'uncertain',client:'claude-code',toolName:'start_process',arguments:{command:'SECRET'},requestId:'SECRET'}],
    databasePath:'C:\\private\\scheduler.sqlite',reason:'SECRET'};
  raw.deployment={sourceCommit:'a'.repeat(40),installedAt:'2026-11-06T01:00:00Z',workerVersion:'e56424fb-e0a5-4710-a4c2-206fa18787c6',evidence:'installation-record',privatePath:'SECRET'};
  raw.instances[0]={...raw.instances[0],managerVersion:'0.2.0',residentBytes:50*1048576};
  const projected=projectManagerStatus(raw);
  assert.equal(projected.resources.lowDiskFloorBytes,10*1073741824);assert.equal(projected.resources.managerResidentBytes,80*1048576);assert.equal(projected.resources.managerHeapUsedBytes,20*1048576);
  assert.equal(projected.limits.maxInflightGlobal,2);assert.equal(projected.limits.scope,'shared-state-directory');
  assert.deepEqual(projected.coordinator,{available:true,scope:'shared-state-directory',inflight:2,queued:3,uncertain:1,queueCapacity:64,
    clients:[{client:'claude-code',inflight:1,queued:2,uncertain:1}],recentEvents:[{time:'2026-11-06T01:00:00.000Z',type:'uncertain',client:'claude-code',toolName:'start_process'}]});
  assert.equal(projected.deployment.sourceCommit,'a'.repeat(40));assert.equal(projected.deployment.evidence,'installation-record');assert.equal(projected.instances[0].managerVersion,'0.2.0');assert.equal(projected.instances[0].residentBytes,50*1048576);
  assert.equal(JSON.stringify(projected).includes('SECRET'),false);assert.equal(JSON.stringify(projected).includes('private'),false);
  raw.coordinator.recentEvents[0].type='reconciled';assert.equal(projectManagerStatus(raw).coordinator.recentEvents[0].type,'reconciled');
});

test('expanded fleet concurrency and bounded remote capacity survive Worker projection',()=>{
  const raw=sample();raw.policy={enabled:true,readOnly:false,maxInflight:64};
  raw.limits={scope:'shared-state-directory',maxInflightGlobal:64,maxInflightPerInstance:64,
    queueCapacityGlobal:128,queueCapacityPerInstance:64,detachedJobsCapped:false};
  raw.remoteMcp={state:'ready',transport:'streamable-http',endpoint:'/mcp',activeHttpRequests:32,maxHttpRequests:64};
  const projected=projectManagerStatus(raw);
  assert.equal(projected.policy.maxInflight,64);assert.equal(projected.limits.maxInflightGlobal,64);
  assert.equal(projected.limits.queueCapacityGlobal,128);assert.equal(projected.limits.queueCapacityPerInstance,64);
  assert.equal(projected.remoteMcp.maxHttpRequests,64);assert.equal(projected.remoteMcp.activeHttpRequests,32);
});

test('legacy, unavailable and malformed scheduler evidence never establishes a shared healthy limit',()=>{
  const legacy=projectManagerStatus(sample());assert.equal(legacy.coordinator,null);assert.equal(legacy.limits.maxInflightGlobal,null);assert.equal(legacy.limits.queueCapacityGlobal,null);assert.equal(legacy.limits.scope,'unknown');assert.equal(legacy.deployment,null);
  const raw=sample();raw.limits={scope:'machine-wide',maxInflightGlobal:2,queueCapacityGlobal:64};
  raw.coordinator={available:false,scope:'shared-state-directory',inflight:-1,queued:'0',uncertain:NaN,queueCapacity:Infinity,clients:[{client:'C:\\private',inflight:-3}],recentEvents:[{type:'SECRET',time:'invalid'}]};
  raw.resources={managerResidentBytes:-1,managerHeapUsedBytes:'0',lowDiskFloorBytes:Infinity};
  raw.deployment={evidence:'installation-record',sourceCommit:'malformed',workerVersion:'not-a-version',installedAt:'invalid'};
  const projected=projectManagerStatus(raw);assert.equal(projected.limits.maxInflightGlobal,null);assert.equal(projected.coordinator.available,false);assert.equal(projected.coordinator.inflight,null);assert.equal(projected.coordinator.queued,null);assert.equal(projected.coordinator.uncertain,null);assert.equal(projected.coordinator.queueCapacity,null);assert.deepEqual(projected.coordinator.clients,[]);assert.deepEqual(projected.coordinator.recentEvents,[]);
  assert.equal(projected.resources.managerResidentBytes,null);assert.equal(projected.resources.managerHeapUsedBytes,null);assert.equal(projected.resources.lowDiskFloorBytes,null);assert.equal(projected.deployment.sourceCommit,null);assert.equal(projected.deployment.workerVersion,null);assert.equal(projected.deployment.installedAt,null);
  raw.deployment.evidence='live-cloudflare-check';assert.equal(projectManagerStatus(raw).deployment,null);
  raw.coordinator={...raw.coordinator,inflight:0,queued:0,uncertain:0,queueCapacity:64};
  const unavailable=projectManagerStatus(raw).coordinator;assert.equal(unavailable.inflight,null);assert.equal(unavailable.queued,null);assert.equal(unavailable.uncertain,null);assert.equal(unavailable.queueCapacity,64);
  raw.coordinator.available=true;assert.equal(projectManagerStatus(raw).coordinator.clients[0].client,'unknown');
});

test('remote client labels prove only protocol initialization and discard arbitrary identity fields',()=>{
  const raw=sample();raw.remoteMcp={state:'ready',clientIdentityTracked:true,observedClients:[
    {name:'ChatGPT',version:'1.0.0',lastInitializedAt:'2026-11-06T01:00:00Z',evidence:'protocol-initialize',email:'SECRET',oauthConnected:true},
    {name:'<script>SECRET</script>',version:'1.0.0',evidence:'protocol-initialize'},
    {name:'Claude',version:'SECRET/path',lastInitializedAt:'not-a-date',evidence:'protocol-initialize'},
    {name:'Fake OAuth account',evidence:'verified-login'},
  ]};
  const remote=projectManagerStatus(raw).remoteMcp;
  assert.equal(remote.clientIdentityTracked,false);
  assert.deepEqual(remote.observedClients,[{name:'ChatGPT',version:'1.0.0',lastInitializedAt:'2026-11-06T01:00:00.000Z',evidence:'protocol-initialize'},{name:'Claude',version:null,lastInitializedAt:null,evidence:'protocol-initialize'}]);
  assert.equal(JSON.stringify(remote).includes('SECRET'),false);assert.equal(Object.hasOwn(remote.observedClients[0],'oauthConnected'),false);
});

test('scheduler and initialization histories are bounded before browser projection',()=>{
  const raw=sample();raw.coordinator={available:true,scope:'shared-state-directory',clients:Array.from({length:100},()=>({client:'local',inflight:0,queued:0,uncertain:0})),recentEvents:Array.from({length:150},()=>({time:'2026-11-06T01:00:00Z',type:'queued',client:'local',toolName:'read_file'}))};
  raw.remoteMcp={observedClients:Array.from({length:20},()=>({name:'Test client',version:'1',lastInitializedAt:'2026-11-06T01:00:00Z',evidence:'protocol-initialize'}))};
  const projected=projectManagerStatus(raw);assert.equal(projected.coordinator.clients.length,64);assert.equal(projected.coordinator.recentEvents.length,100);assert.equal(projected.remoteMcp.observedClients.length,8);
});
