import {normalizePolicy,policyDigest} from './admission.mjs';

const operations=['preflight','backup','build','stage','validate','activate','health','rollback','reconcile'];
function fail(message){throw new Error(message);}
function receipt(result){if(typeof result?.receipt!=='string'||!result.receipt.trim()||result.receipt.length>400)fail('Invalid adapter receipt');return result.receipt;}
async function bounded(fn,timeoutMs){
 const abort=new AbortController();let timer;
 try{return await Promise.race([Promise.resolve().then(()=>fn(abort.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('operation_deadline_exceeded'));},timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
// Internal local supervisor API. Never construct a target or evidence provider from
// request data. Production enrollment requires independent per-target qualification.
// No arbitrary shell, command string, or path is accepted by this engine.
export function createExecutionEngine({store,targets,expectedOwner,timeoutMs=30000}){
 if(!store||!Array.isArray(targets)||typeof expectedOwner!=='string'||!expectedOwner||!Number.isSafeInteger(timeoutMs)||timeoutMs<20||timeoutMs>3600000)fail('Invalid supervisor configuration');
 const registry=new Map();
 for(const target of targets){
  const policy=normalizePolicy(target.policy);
  if(registry.has(policy.targetId)||typeof target.collectEvidence!=='function'||!operations.every(k=>typeof target.adapter?.[k]==='function'))fail('Invalid or duplicate adapter registration');
  registry.set(policy.targetId,{policy,adapter:target.adapter,collectEvidence:target.collectEvidence});
 }
 const targetFor=r=>{
  const x=registry.get(r.plan.targetId);
  if(!x||r.plan.policyDigest!==policyDigest(x.policy)||r.plan.environment!==x.policy.environment)fail('No exact registered adapter and policy');
  return x;
 };
 const call=(target,method,r)=>bounded(signal=>target.adapter[method]({id:r.id,plan:r.plan,signal}),timeoutMs);
 const gate=async(target,r,phase)=>({policy:target.policy,expectedOwner,expectedDigest:r.plan_digest,evidence:await bounded(signal=>target.collectEvidence({id:r.id,plan:r.plan,phase,signal}),timeoutMs)});
 async function execute(id){
  let r=store.get(id);const target=targetFor(r);
  // Only the transaction-winning executor may perform side effects.
  r=store.start(id,await gate(target,r,'start'));
  try{
   for(const [method,to] of [['preflight','BACKING_UP'],['backup','BUILDING'],['build','STAGING'],['stage','VALIDATING']]){
    const result=await call(target,method,r);r=store.transition(id,r.state,to,receipt(result));
   }
   const validated=await call(target,'validate',r);
   if(validated?.artifactDigest!==r.plan.artifactDigest)fail('Staged artifact digest does not match approved plan');
   receipt(validated);
   r=store.activate(id,await gate(target,r,'activate'));
   const activated=await call(target,'activate',r);
   r=store.transition(id,r.state,'HEALTH_CHECKING',receipt(activated));
   const health=await call(target,'health',r);
   if(health?.healthy===true&&health.artifactDigest===r.plan.artifactDigest)return store.transition(id,r.state,'COMPLETED',receipt(health));
   if(health?.healthy!==false||health.artifactDigest!==r.plan.artifactDigest)fail('Health or active identity uncertain; reconciliation required');
   r=store.transition(id,r.state,'ROLLING_BACK',receipt(health));
   const rollback=await call(target,'rollback',r);receipt(rollback);
   const reconciled=await call(target,'reconcile',r);
   if(reconciled?.outcome!=='ROLLED_BACK'||reconciled.quiescent!==true)fail('Previous known-good runtime not verified');
   return store.transition(id,r.state,'ROLLED_BACK',receipt(reconciled));
  }catch{
   // No automatic retry or speculative rollback after a timeout/exception; an
   // operation may already have mutated the target. Retain durable locks.
   const current=store.get(id);
   if(['COMPLETED','ROLLED_BACK','FAILED','CANCELLED','RECOVERY_REQUIRED'].includes(current.state))return current;
   return store.transition(id,current.state,'RECOVERY_REQUIRED','Operation failed or outcome uncertain at '+current.state+'; verified reconciliation required');
  }
 }
 async function reconcile(id){
  const r=store.get(id);if(r.state!=='RECOVERY_REQUIRED')fail('Recovery is not pending');
  const target=targetFor(r),result=await call(target,'reconcile',r);
  if(result?.outcome==='COMPLETED'&&result.artifactDigest!==r.plan.artifactDigest)fail('Recovered active identity does not match approved artifact');
  if(result?.quiescent!==true||!['COMPLETED','ROLLED_BACK','FAILED'].includes(result?.outcome))fail('Adapter could not establish a definite recovery outcome');
  return store.resolveRecovery(id,{outcome:result.outcome,evidenceReceipt:receipt(result)});
 }
 async function tick(){
  const expired=store.expireScheduled().map(r=>r.id),results=[];
  for(const r of store.due()){
   try{const updated=await execute(r.id);results.push({id:r.id,state:updated.state});}
   catch{results.push({id:r.id,state:store.get(r.id).state,blocked:true});}
  }
  return {expired,results};
 }
 return {execute,reconcile,tick};
}
