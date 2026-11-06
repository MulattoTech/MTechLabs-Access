import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {remoteMcp} from '../src/mcp-remote.js';

const TEAM='mcp-proxy-test.cloudflareaccess.com';
const ORIGIN='https://mcp-origin.m-techlabs.com';
const URL='https://mcp.m-techlabs.com/mcp';
const OWNER='owner@example.com';
const AUD='dedicated-mcp-test-audience';
const TOKEN='private-test-manager-token-not-an-oauth-token-000000001';
const RPC={jsonrpc:'2.0',id:1,method:'tools/list'};
const REPLY={jsonrpc:'2.0',id:1,result:{tools:[{name:'read_file',inputSchema:{type:'object'},_meta:{'ui/resourceUri':'ui://local/preview'}}]}};
let signer,key;
before(async()=>{
  const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  signer=pair.privateKey;key={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'mcp-proxy-key'};
});

async function jwt(extra={},head={}) {
  const now=Math.floor(Date.now()/1000),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const input=encode({alg:'RS256',kid:key.kid,...head})+'.'+encode({iss:`https://${TEAM}`,aud:[AUD],email:OWNER,sub:'owner-subject',iat:now-5,exp:now+3600,...extra});
  return input+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',signer,new TextEncoder().encode(input))).toString('base64url');
}

function fixture() {
  const state={row:{id:'owner',email:OWNER,is_owner:1,status:'approved',revoke_before:0},reads:0,throwDB:false};
  const DB={prepare(sql){
    assert.equal(sql,'SELECT id,email,status,is_owner,revoke_before FROM users WHERE email=?');
    return {bind(email){assert.equal(email,OWNER);return {async first(){state.reads++;if(state.throwDB)throw Error('private DB failure');return state.row;}};}};
  }};
  return {state,env:{DB,ACCESS_TEAM:TEAM,OWNER_EMAIL:OWNER,MCP_ACCESS_AUD:AUD,MCP_MANAGER_ORIGIN:ORIGIN,MCP_MANAGER_TOKEN:TOKEN}};
}

function network(t,reply=()=>Response.json(REPLY)) {
  const calls=[];
  t.mock.method(globalThis,'fetch',async(input,options)=>{
    if(input===`https://${TEAM}/cdn-cgi/access/certs`)return Response.json({keys:[key]});
    calls.push({url:input,options});return reply(input,options);
  });
  return calls;
}

async function request({url=URL,method='POST',headers={},body=RPC,token,raw=false}={}) {
  const assertion=token===undefined?await jwt():token;
  const values={'Content-Type':'application/json',Accept:'application/json, text/event-stream',...headers};
  if(assertion!==null)values['Cf-Access-Jwt-Assertion']=assertion;
  const options={method,headers:values};
  if(method!=='GET'&&method!=='HEAD')options.body=raw?body:JSON.stringify(body);
  if(options.body instanceof ReadableStream)options.duplex='half';
  return new Request(url,options);
}

async function safeError(response,status) {
  assert.equal(response.status,status);
  const text=await response.text();
  assert.equal(text.includes(TOKEN),false);assert.equal(text.includes('private DB'),false);assert.equal(text.includes('private network'),false);
  assert.equal(response.headers.get('Set-Cookie'),null);
  return JSON.parse(text);
}

test('remote MCP requires a signed Access assertion, not cookies, bearer or descriptive email',async t=>{
  const {env,state}=fixture(),calls=network(t);
  for(const token of [null,'invalid.jwt.value']) {
    const response=await remoteMcp(await request({token,headers:{Authorization:'Bearer fake',Cookie:'CF_Authorization=fake','Cf-Access-Authenticated-User-Email':OWNER}}),env,{});
    await safeError(response,401);assert.match(response.headers.get('WWW-Authenticate'),/resource_metadata="https:\/\/mcp\.m-techlabs\.com\/\.well-known\/oauth-protected-resource"/);
  }
  assert.equal(state.reads,0);assert.equal(calls.length,0);
});

test('remote MCP verifies signature, issuer, dedicated audience, time and human identity',async t=>{
  const {env,state}=fixture(),calls=network(t),now=Math.floor(Date.now()/1000);
  const bad=[{iss:'https://different.cloudflareaccess.com'},{aud:['hub-audience']},{exp:now-1},{iat:now+120},{iat:null},{email:null},{sub:''},{identity:'service'},{nonce:'evaluation'}];
  for(const claims of bad)await safeError(await remoteMcp(await request({token:await jwt(claims)}),env,{}),401);
  const altered=await jwt();
  await safeError(await remoteMcp(await request({token:altered.slice(0,-2)+(altered.endsWith('AA')?'BB':'AA')}),env,{}),401);
  await safeError(await remoteMcp(await request({token:await jwt({}, {jku:'https://attacker.invalid/jwks'})}),env,{}),401);
  assert.equal(state.reads,0);assert.equal(calls.length,0);
});

test('remote MCP allows only the exact owner and current approved owner row',async t=>{
  const {env,state}=fixture(),calls=network(t);
  await safeError(await remoteMcp(await request({token:await jwt({email:'alice@example.com'})}),env,{}),403);
  assert.equal(state.reads,0);
  const original=state.row;
  for(const row of [null,{...original,is_owner:0},{...original,is_owner:'1'},{...original,status:'suspended'},
    {...original,status:'revoked'},{...original,status:'pending'},{...original,email:'other@example.com'},
    {...original,revoke_before:null},{...original,revoke_before:-1},{...original,revoke_before:'0'}]) {
    state.row=row;await safeError(await remoteMcp(await request(),env,{}),403);
  }
  assert.equal(calls.length,0);
});

test('owner revocation is checked on every request, with equality revoked and fresh token accepted',async t=>{
  const {env,state}=fixture(),calls=network(t),now=Math.floor(Date.now()/1000),token=await jwt({iat:now-10});
  assert.equal((await remoteMcp(await request({token}),env,{})).status,200);
  state.row.revoke_before=now-10;
  await safeError(await remoteMcp(await request({token}),env,{}),403);
  assert.equal((await remoteMcp(await request({token:await jwt({iat:now-9})}),env,{})).status,200);
  assert.equal(state.reads,3);assert.equal(calls.length,2);
});

test('missing configuration, alternate origin and DB failure fail closed',async t=>{
  const {env,state}=fixture(),calls=network(t);
  for(const change of [{MCP_MANAGER_TOKEN:undefined},{MCP_MANAGER_TOKEN:'short'},
    {MCP_MANAGER_ORIGIN:'https://attacker.invalid'},{MCP_MANAGER_ORIGIN:ORIGIN+'/'},
    {MCP_MANAGER_ORIGIN:ORIGIN+'?url=https://attacker.invalid'},{MCP_ACCESS_AUD:undefined},
    {MCP_ACCESS_AUD:'a,b'},{ACCESS_TEAM:'attacker.invalid'},{OWNER_EMAIL:undefined},{DB:undefined}]) {
    await safeError(await remoteMcp(await request(),{...env,...change},{}),503);
  }
  state.throwDB=true;await safeError(await remoteMcp(await request(),env,{}),503);
  assert.equal(calls.length,0);
});

test('the adapter accepts only its HTTPS hostname, exact path, no query and POST method',async t=>{
  const {env}=fixture(),calls=network(t);
  for(const url of ['https://m-techlabs.com/mcp','http://mcp.m-techlabs.com/mcp',URL+'/',URL+'?url=https://attacker.invalid',URL.replace('/mcp','/admin/mcp'),URL.replace('.com/','.com:8443/')]) {
    await safeError(await remoteMcp(await request({url}),env,{}),404);
  }
  for(const method of ['GET','DELETE','PUT','PATCH','OPTIONS']) {
    const response=await remoteMcp(await request({method}),env,{});await safeError(response,405);assert.equal(response.headers.get('Allow'),'POST');
  }
  assert.equal(calls.length,0);
});

test('explicit untrusted origins are denied; cloud clients need no Origin header',async t=>{
  const {env}=fixture(),calls=network(t);
  for(const Origin of ['null','https://attacker.invalid','http://chatgpt.com','https://chatgpt.com.attacker.invalid'])await safeError(await remoteMcp(await request({headers:{Origin}}),env,{}),403);
  for(const Origin of ['https://mcp.m-techlabs.com','https://m-techlabs.com','https://www.m-techlabs.com','https://chatgpt.com','https://claude.ai'])assert.equal((await remoteMcp(await request({headers:{Origin}}),env,{})).status,200);
  assert.equal((await remoteMcp(await request(),env,{})).status,200);assert.equal(calls.length,6);
});

test('content type, encoding, accept and protocol version are validated before the PC is contacted',async t=>{
  const {env}=fixture(),calls=network(t);
  for(const [headers,status] of [[{'Content-Type':'text/plain'},415],[{'Content-Type':'application/jsonp'},415],
    [{'Content-Encoding':'gzip'},415],[{Accept:'text/event-stream'},406],[{'MCP-Protocol-Version':'../../admin'},400],
    [{'MCP-Protocol-Version':'2025-11-25, injected'},400]])await safeError(await remoteMcp(await request({headers}),env,{}),status);
  assert.equal(calls.length,0);
});

test('malformed, batched, invalid UTF-8 and over-limit request bodies never reach the origin',async t=>{
  const {env}=fixture(),calls=network(t);
  for(const body of [null,[],[RPC],{jsonrpc:'1.0'},'not a message'])await safeError(await remoteMcp(await request({body}),env,{}),400);
  await safeError(await remoteMcp(await request({body:'{broken',raw:true}),env,{}),400);
  await safeError(await remoteMcp(await request({body:new Uint8Array([0xff,0xfe]),raw:true}),env,{}),400);
  await safeError(await remoteMcp(await request({headers:{'Content-Length':'1048577'}}),env,{}),413);
  await safeError(await remoteMcp(await request({headers:{'Content-Length':'oops'}}),env,{}),413);
  // The actual UTF-8 byte count is enforced even if a client advertises less.
  await safeError(await remoteMcp(await request({headers:{'Content-Length':'1'},body:{...RPC,padding:'é'.repeat(524289)}}),env,{}),413);
  assert.equal(calls.length,0);
});

test('successful request uses one fixed origin, a minimal private header set and preserves MCP metadata',async t=>{
  const {env}=fixture(),calls=network(t,()=>Response.json(REPLY,{headers:{'Set-Cookie':'private-cookie=yes','Mcp-Session-Id':'internal-session',Location:'https://attacker.invalid','X-Internal':'private'}}));
  const response=await remoteMcp(await request({headers:{'MCP-Protocol-Version':'2025-11-25',Authorization:'Bearer caller',Cookie:'personal=yes',Origin:'https://chatgpt.com',
    'Mcp-Session-Id':'caller-session','X-Forwarded-Host':'attacker.invalid','X-Arbitrary':'private'}}),env,{});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),REPLY);assert.equal(calls.length,1);
  const {url,options}=calls[0];assert.equal(url,ORIGIN+'/mcp');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');assert.equal(options.signal instanceof AbortSignal,true);
  assert.deepEqual(options.headers,{Accept:'application/json, text/event-stream','Content-Type':'application/json',Authorization:'Bearer '+TOKEN,'MCP-Protocol-Version':'2025-11-25'});
  assert.deepEqual(JSON.parse(options.body),RPC);assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(response.headers.get('Mcp-Session-Id'),null);assert.equal(response.headers.get('Location'),null);assert.equal(response.headers.get('X-Internal'),null);
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
});

test('notifications accept an empty202 without inventing a session or swallowing a body',async t=>{
  const {env}=fixture();let response=()=>new Response(null,{status:202,headers:{'Set-Cookie':'bad=yes','Mcp-Session-Id':'bad'}});
  const calls=network(t,()=>response()),notification={jsonrpc:'2.0',method:'notifications/initialized'};
  const accepted=await remoteMcp(await request({body:notification}),env,{});assert.equal(accepted.status,202);assert.equal(await accepted.text(),'');assert.equal(accepted.headers.get('Set-Cookie'),null);
  response=()=>new Response('unexpected private body',{status:202});await safeError(await remoteMcp(await request({body:notification}),env,{}),502);assert.equal(calls.length,2);
});

test('redirects, authentication failures, nonJSON and malformed responses cannot leak upstream data or trigger retries',async t=>{
  const {env}=fixture();let reply;const calls=network(t,()=>reply());
  const cases=[()=>new Response('private body',{status:302,headers:{Location:'https://attacker.invalid'}}),
    ()=>Response.json({jsonrpc:'2.0',error:{message:TOKEN}},{status:401}),()=>new Response('private body',{status:403}),
    ()=>new Response('<html>private</html>',{headers:{'Content-Type':'text/html'}}),
    ()=>new Response('{private malformed',{headers:{'Content-Type':'application/json'}}),()=>Response.json({unknown:'private'}),
    ()=>Response.json([{jsonrpc:'2.0',id:1,result:{}}]),()=>Response.json({jsonrpc:'2.0',id:1,result:{accidentalCredential:TOKEN}}),
    ()=>{throw Error('private network '+TOKEN);}];
  for(const next of cases){reply=next;const error=await safeError(await remoteMcp(await request(),env,{}),502);assert.match(error.error.message,/may still be running/);assert.match(error.error.message,/not automatically retried or killed/);}
  assert.equal(calls.length,cases.length);
});

test('response declared size and actual byte size are both capped at8MiB',async t=>{
  const {env}=fixture();let reply;const calls=network(t,()=>reply());
  reply=()=>Response.json(REPLY,{headers:{'Content-Length':'8388609'}});await safeError(await remoteMcp(await request(),env,{}),502);
  reply=()=>Response.json({...REPLY,padding:'x'.repeat(8388609)},{headers:{'Content-Length':'1'}});await safeError(await remoteMcp(await request(),env,{}),502);
  assert.equal(calls.length,2);
});

test('valid upstream protocol errors and tool-denial details pass through unchanged',async t=>{
  const {env}=fixture(),denial={jsonrpc:'2.0',id:1,error:{code:-32011,message:'This tool is not allowed by the managed read-only policy.'}};
  const calls=network(t,()=>Response.json(denial,{status:429,headers:{'Set-Cookie':'not-forwarded=yes'}}));
  const response=await remoteMcp(await request(),env,{});assert.equal(response.status,429);assert.deepEqual(await response.json(),denial);assert.equal(response.headers.get('Set-Cookie'),null);assert.equal(calls.length,1);
});

test('origin deadline aborts once and reports an unverified outcome, never a successful or unexecuted tool call',async t=>{
  const {env}=fixture();let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const calls=network(t,(_url,options)=>new Promise((_,reject)=>{
    options.signal.addEventListener('abort',()=>reject(new DOMException('private network timeout','AbortError')),{once:true});entered();
  }));
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=remoteMcp(await request(),env,{});await started;t.mock.timers.tick(110001);
  const result=await safeError(await pending,504);assert.match(result.error.message,/may still be running/);assert.equal(calls.length,1);assert.equal(calls[0].options.signal.aborted,true);
});

test('response-body stall is bounded even after origin response headers arrive',async t=>{
  const {env}=fixture();let entered,cancelled=false;
  const started=new Promise(resolve=>{entered=resolve;});
  const calls=network(t,()=>new Response(new ReadableStream({start(){entered();},cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}}));
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=remoteMcp(await request(),env,{});await started;t.mock.timers.tick(110001);
  await safeError(await pending,504);assert.equal(calls.length,1);assert.equal(cancelled,true);
});

test('request-body stall is rejected before contacting the PC',async t=>{
  const {env}=fixture(),calls=network(t);let pulling,cancelled=false;
  const started=new Promise(resolve=>{pulling=resolve;});
  const stream=new ReadableStream({pull(){pulling();},cancel(){cancelled=true;}});
  t.mock.timers.enable({apis:['setTimeout']});
  const pending=remoteMcp(await request({body:stream,raw:true}),env,{});
  await started;
  // Verification is asynchronous; wait until the real signed owner has passed
  // and the request reader has installed its timer, without advancing walltime.
  while(!stream.locked)await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(15001);
  const result=await safeError(await pending,408);assert.match(result.error.message,/No tool request was sent/);assert.equal(cancelled,true);assert.equal(calls.length,0);
});
