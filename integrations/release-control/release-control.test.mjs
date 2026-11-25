import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import {PROJECTS} from './catalog.mjs';
import {createController} from './controller.mjs';
import {createServer,ownerCheck} from './server.mjs';
const A='a'.repeat(40),B='b'.repeat(40);
async function fixture(t){
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'release-control-'));
 t.after(()=>fs.rm(tmp,{recursive:true,force:true}));
 let sha=A,clock=Date.now(),calls=0,fail=false;
 const stateFile=path.join(tmp,'state.json');
 const opts={stateFile,now:()=>clock,github:{head:async()=>{calls++;if(fail)throw Error('test offline');return sha;},checks:async()=>({total:2,returned:2,checks:[{name:'unit',status:'completed',conclusion:'success'},{name:'security',status:'in_progress',conclusion:null}]})},observe:async()=>({state:'unknown',detail:'test only'})};
 return {controller:await createController(opts),opts,setHead:s=>sha=s,advance:()=>clock+=61000,calls:()=>calls,offline:()=>fail=true};
}
const get=(s,id)=>s.projects.find(p=>p.id===id);
test('registry contains 30 active and 2 archived unique repositories',()=>{
 assert.equal(PROJECTS.length,32);assert.equal(new Set(PROJECTS.map(p=>p.id)).size,32);
 assert.equal(PROJECTS.filter(p=>!p.archived).length,30);
 assert.equal(PROJECTS.find(p=>p.id==='Antimatter-Dimensions').branch,'master');
});
test('check deduplicates within cooldown, detects change and preserves last observation on failure',async t=>{
 const f=await fixture(t),c=f.controller;
 let s=await c.check({ids:['MBody']});assert.equal(get(s,'MBody').head.sha,A);
 await c.check({ids:['MBody']});assert.equal(f.calls(),1);
 f.advance();f.setHead(B);s=await c.check({ids:['MBody']});
 assert.equal(get(s,'MBody').head.previousSha,A);assert.equal(get(s,'MBody').head.sha,B);
 f.advance();f.offline();s=await c.check({ids:['MBody']});
 assert.equal(get(s,'MBody').head.sha,B);assert.equal(get(s,'MBody').head.status,'unavailable');
});
test('rejects unknown, archived, duplicate and over-batch input',async t=>{
 const {controller:c}=await fixture(t);
 for(const ids of [['unknown'],['MTerm'],['MBody','MBody'],[],PROJECTS.slice(0,7).map(p=>p.id)])
  await assert.rejects(c.check({ids}),{status:400});
});
test('exact head recheck, immutable preparation, durable review/hold and stale revision refusal',async t=>{
 const f=await fixture(t),c=f.controller;
 await c.check({ids:['MBody']});f.setHead(B);
 await assert.rejects(c.prepare({id:'MBody',sha:A}),{status:409});
 f.advance();await c.check({ids:['MBody']});
 let s=await c.prepare({id:'MBody',sha:B}),p=get(s,'MBody').plan;
 assert.equal(p.sha,B);assert.equal(p.requiredChecks,'unverified');assert.equal(p.activation,'not-enrolled');
 assert.equal(p.checks.checks[1].status,'in_progress');
 s=await c.decide({id:'MBody',planId:p.id,sha:B,decision:'hold',notBefore:new Date(Date.now()+3600000).toISOString()});
 assert.equal(get(s,'MBody').plan.status,'hold');
 const restored=await createController(f.opts);assert.equal(get(restored.snapshot(),'MBody').plan.id,p.id);
 await assert.rejects(c.decide({id:'MBody',planId:p.id,sha:A,decision:'reviewed'}),{status:409});
 f.advance();f.setHead(A);await c.check({ids:['MBody']});
 await assert.rejects(c.decide({id:'MBody',planId:p.id,sha:B,decision:'reviewed'}),{status:409});
});
test('actual JWT verification accepts correct owner, rejects forged, expired and wrong audience',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
 const now=Math.floor(Date.now()/1000);
 const claims={iss:'https://broken-breeze-d0bb.cloudflareaccess.com',aud:['07ab5d3b657038e3da3af279994f36c3e8deb8cb1c79adcc43e01e3df6ccb785'],sub:'fixture',iat:now-1,exp:now+60,email:'dylanmellor@gmail.com'};
 const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const jwt=(c)=>{const input=b({alg:'RS256',kid:'test-key'})+'.'+b(c);return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');};
 const options={fetcher:async()=>new Response(JSON.stringify({keys:[jwk]})),now};
 assert.equal(await ownerCheck(jwt(claims),options),true);
 assert.equal(await ownerCheck(jwt({...claims,email:'other@example.test'}),options),false);
 assert.equal(await ownerCheck(jwt({...claims,aud:['bad']}),options),false);
 assert.equal(await ownerCheck(jwt({...claims,exp:now-1}),options),false);
 assert.equal(await ownerCheck('invalid',options),false);
});
test('HTTP routes fail closed and enforce same-origin, bounded exact operations',async t=>{
 const {controller}=await fixture(t);const s=await createServer({controller,verify:async token=>token==='fixture'});
 await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>s.close(resolve)));
 const req=(method,url,headers={},data)=>new Promise((resolve,reject)=>{
  const r=http.request({hostname:'127.0.0.1',port:s.address().port,path:'/admin/releases'+url,method,headers:{Host:'m-techlabs.com',...headers}},res=>{let raw='';res.on('data',b=>raw+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,raw}));});
  r.on('error',reject);r.end(data===undefined?undefined:JSON.stringify(data));
 });
 const auth={'Cf-Access-Jwt-Assertion':'fixture'},post={...auth,Origin:'https://m-techlabs.com','Content-Type':'application/json','X-MTech-Release':'1'};
 assert.equal((await req('GET','/api/status')).status,401);
 assert.equal((await req('GET','/api/status',{...auth,Host:'bad.example'})).status,403);
 assert.equal((await req('GET','/',auth)).status,200);
 assert.equal((await req('GET','/app.js',auth)).status,200);
 assert.match((await req('GET','/style.css',auth)).headers['content-security-policy'],/default-src 'none'/);
 assert.equal((await req('POST','/api/check',{...post,Origin:'https://evil.example'},{ids:['MBody']})).status,403);
 assert.equal((await req('POST','/api/check',post,{ids:['MBody']})).status,200);
 assert.equal((await req('POST','/api/deploy',post,{id:'MBody'})).status,404);
 assert.equal((await req('GET','/api/status',auth)).headers['cache-control'],'private, no-store, max-age=0');
});
