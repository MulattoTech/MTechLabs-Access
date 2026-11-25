import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {normalizePlan,policyDigest,planDigest,createApproval,evaluateAdmission} from './admission.mjs';
import {openDeploymentStore} from './deployment-store.mjs';

const A='a'.repeat(40),B='b'.repeat(40);
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const timestamp=n=>new Date(n).toISOString();
const owner='owner@example.test';
const policy={targetId:'fixture-one',environment:'fixture',repo:'MulattoTech/MTechLabs-Access',branch:'main',requiredChecks:[{name:'tests',appId:1},{name:'security',appId:2}],maxEvidenceAgeMs:60000,resources:['target:fixture-one','database:shared']};
const plan={targetId:policy.targetId,environment:policy.environment,repo:policy.repo,branch:policy.branch,sha:A,artifactDigest:hash('candidate'),policyDigest:policyDigest(policy),resources:['target:fixture-one','database:shared']};
const startTime=Date.parse('2026-11-25T21:00:00.000Z');
function evidence(p=plan,now=startTime){return {planDigest:planDigest(p),observedAt:timestamp(now),head:p.sha,artifactDigest:p.artifactDigest,checks:{sha:p.sha,total:2,items:[{name:'tests',appId:1,headSha:p.sha,status:'completed',conclusion:'success'},{name:'security',appId:2,headSha:p.sha,status:'completed',conclusion:'success'}]},...Object.fromEntries(['provenance','review','security','configuration','dependencies','resources','backup','recovery','adapter'].map(k=>[k,'verified']))};}
const gate=(p=plan,now=startTime)=>({plan:p,policy,expectedOwner:owner,now,approval:createApproval(p,{owner,approvedAt:timestamp(now-1000),expiresAt:timestamp(now+3600000)}),evidence:evidence(p,now)});
function args(p=plan,now=startTime,q=policy){return {policy:q,evidence:evidence(p,now),expectedOwner:owner,expectedDigest:planDigest(p)};}
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rc-ledger-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function approved(s,p=plan,key='request-1234567890',now=startTime){const r=s.create({requestKey:key,plan:p});s.transition(r.id,'DISCOVERED','PREPARING','Start immutable preparation');s.transition(r.id,'PREPARING','READY_FOR_REVIEW','Candidate staged for review');return s.approve(r.id,{owner,expectedDigest:r.plan_digest,expiresAt:timestamp(now+3600000)});}
function toValidate(s,id){for(const [from,to] of [['PREFLIGHT','BACKING_UP'],['BACKING_UP','BUILDING'],['BUILDING','STAGING'],['STAGING','VALIDATING']])s.transition(id,from,to,'Fixture stage '+to);}

test('strict immutable identity and policy hashes',()=>{
 assert.equal(planDigest({...plan,resources:[...plan.resources].reverse()}),planDigest(plan));
 assert.notEqual(planDigest({...plan,sha:B}),planDigest(plan));
 assert.throws(()=>normalizePlan({...plan,resources:['database:shared']}),/target lock/);
 assert.throws(()=>normalizePlan({...plan,extra:'x'}),/plan fields/);
 assert.throws(()=>normalizePlan({...plan,repo:'Other/project'}));
 assert.throws(()=>normalizePlan({...plan,artifactDigest:'latest'}));
 assert.throws(()=>policyDigest({...policy,requiredChecks:[]}));
});
test('admission fails closed on missing, stale, moved, incomplete, wrong publisher, ambiguous, skipped and corrupt evidence',()=>{
 const base=gate();
 assert.deepEqual(evaluateAdmission(base),{eligible:true,reasons:[]});
 const bad=[{head:B},{observedAt:timestamp(startTime-61000)},{artifactDigest:hash('corrupt')},{adapter:'reported'},{review:undefined},{checks:{...base.evidence.checks,total:3}},{checks:{...base.evidence.checks,items:base.evidence.checks.items.map(x=>({...x,appId:99}))}},{checks:{...base.evidence.checks,items:base.evidence.checks.items.map(x=>({...x,conclusion:'skipped'}))}},{checks:{...base.evidence.checks,items:[...base.evidence.checks.items,base.evidence.checks.items[0]],total:3}},{checks:{...base.evidence.checks,sha:B}},{planDigest:hash('another-plan')}];
 for(const x of bad)assert.equal(evaluateAdmission({...base,evidence:{...base.evidence,...x}}).eligible,false,JSON.stringify(x));
 for(const approval of [null,{...base.approval,owner:'other'},{...base.approval,planDigest:hash('changed')},{...base.approval,expiresAt:timestamp(startTime)}])assert.equal(evaluateAdmission({...base,approval}).eligible,false);
 assert.equal(evaluateAdmission({...base,plan:{...plan,artifactDigest:hash('new')}}).eligible,false);
 const less={...plan,resources:['target:fixture-one']};assert.equal(evaluateAdmission({...gate(less),policy}).eligible,false);
});
test('durable idempotency, illegal transition, shared-resource lock, cancellation and restart recovery',async t=>{
 const dir=await fixture(t),file=path.join(dir,'ledger.db');let clock=startTime;
 let s=openDeploymentStore(file,{now:()=>clock,maxConcurrent:2});
 try{
 const first=approved(s);const again=s.create({requestKey:'request-1234567890',plan});assert.equal(again.id,first.id);
 assert.throws(()=>s.create({requestKey:'request-1234567890',plan:{...plan,sha:B}}),/Idempotency/);
 assert.throws(()=>s.transition(first.id,'APPROVED','ACTIVATING','invalid'),/Illegal/);
 s.start(first.id,args());assert.equal(s.locks().length,2);
 const p2={...plan,targetId:'fixture-two',resources:['target:fixture-two','database:shared']};const q2={...policy,targetId:p2.targetId,resources:p2.resources};p2.policyDigest=policyDigest(q2);
 const second=approved(s,p2,'request-1234567891');
 const peer=openDeploymentStore(file,{now:()=>clock});
 try{assert.throws(()=>peer.start(second.id,args(p2,clock,q2)),/Resource locked/);}finally{peer.close();}
 toValidate(s,first.id);
 assert.throws(()=>s.activate(first.id,{...args(),evidence:{...evidence(),head:B}}),/branch_moved/);
 assert.equal(s.get(first.id).state,'VALIDATING');
 s.activate(first.id,args());
 s.close();s=openDeploymentStore(file,{now:()=>clock});
 assert.equal(s.recoverInterrupted()[0].state,'RECOVERY_REQUIRED');assert.equal(s.locks().length,2);
 assert.equal(s.recoverInterrupted().length,0);
 assert.throws(()=>s.start(second.id,args(p2,clock,q2)),/Resource locked/);
 s.resolveRecovery(first.id,{outcome:'ROLLED_BACK',evidenceReceipt:'Verified fixture restored'});
 assert.equal(s.locks().length,0);
 assert.equal(s.events(first.id).at(-1).state,'ROLLED_BACK');
 s.transition(second.id,'APPROVED','CANCELLED','Owner cancelled');
 assert.equal(s.get(second.id).state,'CANCELLED');
 }finally{s.close();}
});
test('maintenance windows are bound to approval, reject early/late activation, and survive restart',async t=>{
 const dir=await fixture(t),file=path.join(dir,'ledger.db');let clock=startTime;
 let s=openDeploymentStore(file,{now:()=>clock});
 try{const r=approved(s);assert.throws(()=>s.schedule(r.id,{expectedDigest:r.plan_digest,notBefore:timestamp(clock+1000),notAfter:timestamp(clock+7200000)}),/window/);
 s.schedule(r.id,{expectedDigest:r.plan_digest,notBefore:timestamp(clock+1000),notAfter:timestamp(clock+3000)});
 s.close();s=openDeploymentStore(file,{now:()=>clock});assert.equal(s.get(r.id).state,'SCHEDULED');
 assert.throws(()=>s.start(r.id,args()),/Outside/);clock+=2000;s.start(r.id,args(plan,clock));toValidate(s,r.id);
 clock+=2000;assert.throws(()=>s.activate(r.id,args(plan,clock)),/Outside/);
 s.transition(r.id,'VALIDATING','FAILED','Maintenance window expired before activation');assert.equal(s.locks().length,0);
 }finally{s.close();}
});
test('real isolated files: backup, stage, verify digest, activate, health failure and restore; success path',async t=>{
 const dir=await fixture(t);const file=path.join(dir,'ledger.db');const runtime=path.join(dir,'runtime.txt'),backup=path.join(dir,'backup.txt'),stage=path.join(dir,'stage.txt');
 const s=openDeploymentStore(file,{now:()=>startTime});
 const original='known-good';const candidate='candidate';await fs.writeFile(runtime,original);
 try{
 for(const [i,healthy] of [[0,false],[1,true]]){
  const r=approved(s,plan,'fixture-execution-'+i+'-123456');
  s.start(r.id,args());s.transition(r.id,'PREFLIGHT','BACKING_UP','Fixture preflight');
  await fs.copyFile(runtime,backup);assert.equal(hash(await fs.readFile(backup)),hash(original));
  s.transition(r.id,'BACKING_UP','BUILDING','Verified backup digest');
  await fs.writeFile(stage,candidate);s.transition(r.id,'BUILDING','STAGING','Artifact built in isolated directory');
  assert.equal(hash(await fs.readFile(stage)),plan.artifactDigest);s.transition(r.id,'STAGING','VALIDATING','Staged bytes match immutable digest');
  s.activate(r.id,args());await fs.rename(stage,runtime);assert.equal(hash(await fs.readFile(runtime)),plan.artifactDigest);
  s.transition(r.id,'ACTIVATING','HEALTH_CHECKING','Fixture activation observed');
  if(!healthy){s.transition(r.id,'HEALTH_CHECKING','ROLLING_BACK','Injected health failure');await fs.copyFile(backup,runtime);assert.equal(hash(await fs.readFile(runtime)),hash(original));s.transition(r.id,'ROLLING_BACK','ROLLED_BACK','Restored backup digest verified');}
  else{s.transition(r.id,'HEALTH_CHECKING','COMPLETED','Fixture content health verified');assert.equal(await fs.readFile(runtime,'utf8'),candidate);}
  assert.equal(s.locks().length,0);
 }
 }finally{s.close();}
});
