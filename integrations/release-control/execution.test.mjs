import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {policyDigest,planDigest} from './admission.mjs';
import {openDeploymentStore} from './deployment-store.mjs';
import {createExecutionEngine} from './execution.mjs';

const sha='a'.repeat(40),digest=b=>'sha256:'+createHash('sha256').update(b).digest('hex'),owner='owner@example.test',iso=n=>new Date(n).toISOString();
const candidate=Buffer.from('release-v2'),previous=Buffer.from('release-v1');
const policy={targetId:'isolated-http',environment:'fixture',repo:'MulattoTech/MTechLabs-Access',branch:'main',requiredChecks:[{name:'fixture-tests',appId:1}],maxEvidenceAgeMs:60000,resources:['target:isolated-http','database:fixture']};
const plan={targetId:policy.targetId,environment:policy.environment,repo:policy.repo,branch:policy.branch,sha,artifactDigest:digest(candidate),policyDigest:policyDigest(policy),resources:policy.resources};

async function setup(t,{failHealth=false,corrupt=false,timeout=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rc-http-adapter-'));
 const live=path.join(root,'live'),backup=path.join(root,'backup'),stage=path.join(root,'stage'),built=path.join(root,'build');
 await fs.writeFile(live,previous);
 let clock=Date.now(),activations=0,rollbacks=0;
 const server=http.createServer(async(req,res)=>{
  const body=await fs.readFile(live);
  res.writeHead(failHealth&&body.equals(candidate)?503:200,{'Content-Type':'application/octet-stream'});
  res.end(body);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const probe=async()=>{
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/health');
  return {healthy:r.ok,artifactDigest:digest(Buffer.from(await r.arrayBuffer()))};
 };
 const db=path.join(root,'ledger.sqlite');
 let store=openDeploymentStore(db,{now:()=>clock,maxConcurrent:1});
 t.after(async()=>{try{store.close();}catch{}await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
 const adapter={
  preflight:async()=>{assert.equal((await probe()).healthy,true);return {receipt:'Disposable HTTP target healthy before deployment'};},
  backup:async()=>{await fs.copyFile(live,backup);assert.equal(digest(await fs.readFile(backup)),digest(previous));return {receipt:'Known-good artifact backed up and independently hashed'};},
  build:async()=>{await fs.writeFile(built,candidate);return {receipt:'Isolated candidate constructed'};},
  stage:async()=>{await fs.copyFile(built,stage);if(corrupt)await fs.writeFile(stage,'corrupted');return {receipt:'Isolated candidate staged'};},
  validate:async()=>({artifactDigest:digest(await fs.readFile(stage)),receipt:'Staged bytes hashed'}),
  activate:async({signal})=>{activations++;if(timeout)await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));await fs.rename(stage,live);return {receipt:'Atomic fixture runtime replacement'};},
  health:async()=>({...await probe(),receipt:'Live HTTP health and bytes observed'}),
  rollback:async()=>{rollbacks++;assert.equal(digest(await fs.readFile(backup)),digest(previous));await fs.copyFile(backup,stage);await fs.rename(stage,live);return {receipt:'Previous verified bytes restored'};},
  reconcile:async()=>{const p=await probe();if(!p.healthy)return {outcome:'UNKNOWN',receipt:'Target unhealthy'};if(p.artifactDigest===digest(previous))return {outcome:'ROLLED_BACK',quiescent:true,artifactDigest:p.artifactDigest,receipt:'Previous known-good HTTP response verified'};if(p.artifactDigest===digest(candidate))return {outcome:'COMPLETED',quiescent:true,artifactDigest:p.artifactDigest,receipt:'Candidate HTTP response verified'};return {outcome:'UNKNOWN',receipt:'Unrecognized runtime'};}
 };
 const collectEvidence=async({plan:p,phase})=>({planDigest:planDigest(p),observedAt:iso(clock),head:sha,artifactDigest:phase==='activate'?digest(await fs.readFile(stage)):p.artifactDigest,checks:{sha,total:1,items:[{name:'fixture-tests',appId:1,headSha:sha,status:'completed',conclusion:'success'}]},...Object.fromEntries(['provenance','review','security','configuration','dependencies','resources','backup','recovery','adapter'].map(k=>[k,'verified']))});
 const engine=(targets=[{policy,adapter,collectEvidence}])=>createExecutionEngine({store,targets,expectedOwner:owner,timeoutMs:timeout?100:5000});
 function prepare(key){
  let r=store.create({requestKey:key,plan});r=store.transition(r.id,'DISCOVERED','PREPARING','Fixture preparation');r=store.transition(r.id,'PREPARING','READY_FOR_REVIEW','Fixture ready');return store.approve(r.id,{owner,expectedDigest:r.plan_digest,expiresAt:iso(clock+3600000)});
 }
 return {engine,prepare,probe,counts:()=>({activations,rollbacks}),store:()=>store,now:()=>clock,advance:n=>clock+=n,reopen:()=>{store.close();store=openDeploymentStore(db,{now:()=>clock,maxConcurrent:1});}};
}
test('registered executor activates real disposable HTTP target and verifies actual bytes',async t=>{
 const f=await setup(t),r=f.prepare('fixture-success-123456');
 const result=await f.engine().execute(r.id);
 assert.equal(result.state,'COMPLETED');assert.deepEqual(await f.probe(),{healthy:true,artifactDigest:digest(candidate)});
 assert.deepEqual(f.counts(),{activations:1,rollbacks:0});assert.equal(f.store().locks().length,0);
 assert.ok(f.store().events(r.id).some(x=>x.state==='ACTIVATING'));
 await assert.rejects(f.engine().execute(r.id));assert.equal(f.counts().activations,1);
});
test('injected actual HTTP health failure rolls back and verifies previous runtime',async t=>{
 const f=await setup(t,{failHealth:true}),r=f.prepare('fixture-rollback-12345');
 assert.equal((await f.engine().execute(r.id)).state,'ROLLED_BACK');
 assert.deepEqual(await f.probe(),{healthy:true,artifactDigest:digest(previous)});
 assert.deepEqual(f.counts(),{activations:1,rollbacks:1});assert.equal(f.store().locks().length,0);
});
test('corrupt artifact never activates and ambiguous operations retain locks across restart',async t=>{
 const f=await setup(t,{corrupt:true}),r=f.prepare('fixture-corrupt-123456');
 assert.equal((await f.engine().execute(r.id)).state,'RECOVERY_REQUIRED');assert.equal(f.counts().activations,0);
 assert.equal(f.store().locks().length,2);f.reopen();assert.equal(f.store().get(r.id).state,'RECOVERY_REQUIRED');
 assert.equal((await f.engine().reconcile(r.id)).state,'ROLLED_BACK');assert.equal(f.store().locks().length,0);
});
test('timed out activation is not replayed and only verified recovery releases locks',async t=>{
 const f=await setup(t,{timeout:true}),r=f.prepare('fixture-timeout-123456');
 assert.equal((await f.engine().execute(r.id)).state,'RECOVERY_REQUIRED');
 assert.equal(f.counts().activations,1);assert.equal(f.counts().rollbacks,0);assert.equal(f.store().locks().length,2);
 f.reopen();assert.equal((await f.engine().reconcile(r.id)).state,'ROLLED_BACK');assert.equal(f.store().locks().length,0);
});
test('durable scheduler executes only exact due windows and cancels missed windows after restart',async t=>{
 const f=await setup(t),early=f.prepare('fixture-missed-123456'),due=f.prepare('fixture-due-123456789');
 f.store().schedule(early.id,{expectedDigest:early.plan_digest,notBefore:iso(f.now()+100),notAfter:iso(f.now()+200)});
 f.store().schedule(due.id,{expectedDigest:due.plan_digest,notBefore:iso(f.now()+300),notAfter:iso(f.now()+10000)});
 assert.deepEqual(await f.engine().tick(),{expired:[],results:[]});f.advance(500);f.reopen();
 const report=await f.engine().tick();assert.deepEqual(report.expired,[early.id]);assert.equal(report.results[0].id,due.id);assert.equal(report.results[0].state,'COMPLETED');
 assert.equal(f.store().get(early.id).state,'CANCELLED');assert.equal(f.counts().activations,1);
});
test('unregistered deployment targets have no execution authority',async t=>{
 const f=await setup(t),r=f.prepare('fixture-unenrolled-1234');
 await assert.rejects(f.engine([]).execute(r.id),/No exact registered adapter/);assert.equal(f.store().get(r.id).state,'APPROVED');assert.equal(f.counts().activations,0);
});
