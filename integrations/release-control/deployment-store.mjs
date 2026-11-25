import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {normalizePlan,planDigest,createApproval,evaluateAdmission} from './admission.mjs';

const states=Object.freeze({
 DISCOVERED:['PREPARING','CANCELLED'],
 PREPARING:['BLOCKED','READY_FOR_REVIEW','FAILED','CANCELLED'],
 BLOCKED:['PREPARING','CANCELLED'],
 READY_FOR_REVIEW:['CANCELLED'],
 APPROVED:['CANCELLED'],
 SCHEDULED:['CANCELLED'],
 PREFLIGHT:['BACKING_UP','BLOCKED','FAILED','RECOVERY_REQUIRED'],
 BACKING_UP:['BUILDING','FAILED','RECOVERY_REQUIRED'],
 BUILDING:['STAGING','FAILED','RECOVERY_REQUIRED'],
 STAGING:['VALIDATING','FAILED','RECOVERY_REQUIRED'],
 VALIDATING:['FAILED','RECOVERY_REQUIRED'],
 ACTIVATING:['HEALTH_CHECKING','ROLLING_BACK','RECOVERY_REQUIRED'],
 HEALTH_CHECKING:['COMPLETED','ROLLING_BACK','RECOVERY_REQUIRED'],
 ROLLING_BACK:['ROLLED_BACK','RECOVERY_REQUIRED'],
 RECOVERY_REQUIRED:[],
 COMPLETED:[],FAILED:[],ROLLED_BACK:[],CANCELLED:[]
});
const terminal=new Set(['COMPLETED','FAILED','ROLLED_BACK','CANCELLED']);
const active=new Set(['PREFLIGHT','BACKING_UP','BUILDING','STAGING','VALIDATING','ACTIVATING','HEALTH_CHECKING','ROLLING_BACK','RECOVERY_REQUIRED']);
const fmt=t=>new Date(t).toISOString();
const validTime=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&fmt(Date.parse(x))===x;
function conflict(message){const e=new Error(message);e.code='CONFLICT';return e;}
function assert(ok,message){if(!ok)throw conflict(message);}
function note(v){assert(typeof v==='string'&&v.trim().length>0&&v.length<=500,'A bounded non-sensitive evidence receipt is required');return v;}
export function openDeploymentStore(file,{now=()=>Date.now(),maxConcurrent=2}={}){
 assert(Number.isSafeInteger(maxConcurrent)&&maxConcurrent>=1&&maxConcurrent<=8,'Invalid concurrency bound');
 const db=new DatabaseSync(file);
 try{
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 db.exec(`CREATE TABLE IF NOT EXISTS deployments(
  id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, plan TEXT NOT NULL,
  plan_digest TEXT NOT NULL, state TEXT NOT NULL, approval TEXT,
  not_before TEXT, not_after TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS deployment_events(
  seq INTEGER PRIMARY KEY, deployment_id TEXT NOT NULL REFERENCES deployments(id),
  at TEXT NOT NULL, state TEXT NOT NULL, receipt TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS resource_locks(
  resource TEXT PRIMARY KEY, deployment_id TEXT NOT NULL REFERENCES deployments(id));
 CREATE INDEX IF NOT EXISTS events_by_deployment ON deployment_events(deployment_id,seq);`);
 }catch(e){db.close();throw e;}
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}};
 const query=id=>{const r=db.prepare('SELECT * FROM deployments WHERE id=?').get(id);assert(r,'Unknown deployment');return {...r,plan:JSON.parse(r.plan),approval:r.approval?JSON.parse(r.approval):null};};
 const receipt=(id,state,detail)=>db.prepare('INSERT INTO deployment_events(deployment_id,at,state,receipt) VALUES(?,?,?,?)').run(id,fmt(now()),state,note(detail));
 const change=(id,state,detail)=>{db.prepare('UPDATE deployments SET state=?,updated_at=? WHERE id=?').run(state,fmt(now()),id);receipt(id,state,detail);if(terminal.has(state)||state==='BLOCKED')db.prepare('DELETE FROM resource_locks WHERE deployment_id=?').run(id);return query(id);};
 function create({requestKey,plan}){
  assert(typeof requestKey==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(requestKey),'Invalid request key');
  const p=normalizePlan(plan),d=planDigest(p);
  return tx(()=>{const old=db.prepare('SELECT id,plan_digest FROM deployments WHERE request_key=?').get(requestKey);
   if(old){assert(old.plan_digest===d,'Idempotency key already bound to another plan');return query(old.id);}
   const id=randomUUID(),at=fmt(now());
   db.prepare('INSERT INTO deployments(id,request_key,plan,plan_digest,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,requestKey,JSON.stringify(p),d,'DISCOVERED',at,at);
   receipt(id,'DISCOVERED','Immutable plan registered');return query(id);
  });
 }
 function transition(id,expected,to,detail){
  return tx(()=>{const r=query(id);assert(r.state===expected,'State changed; reconcile rather than retry');assert(states[expected]?.includes(to),'Illegal transition');
   // No transition into an active operation except start(), which acquires all locks.
   if(active.has(to))assert(active.has(expected),'Activation requires admission and locks');
   return change(id,to,detail);
  });
 }
 function approve(id,{owner,expectedDigest,expiresAt}){
  return tx(()=>{const r=query(id);assert(r.state==='READY_FOR_REVIEW','Not ready for review');assert(expectedDigest===r.plan_digest,'Plan changed');
   const a=createApproval(r.plan,{owner,approvedAt:fmt(now()),expiresAt});
   db.prepare('UPDATE deployments SET approval=? WHERE id=?').run(JSON.stringify(a),id);
   return change(id,'APPROVED','Owner approval recorded for exact plan');
  });
 }
 function schedule(id,{expectedDigest,notBefore,notAfter}){
  return tx(()=>{const r=query(id);assert(['APPROVED','SCHEDULED'].includes(r.state)&&r.plan_digest===expectedDigest,'Approval or plan changed');
   assert(validTime(notBefore)&&validTime(notAfter)&&Date.parse(notBefore)>=now()&&Date.parse(notAfter)>Date.parse(notBefore)&&Date.parse(notAfter)<=Date.parse(r.approval.expiresAt),'Invalid or expired maintenance window');
   db.prepare('UPDATE deployments SET not_before=?,not_after=? WHERE id=?').run(notBefore,notAfter,id);return change(id,'SCHEDULED','Exact plan scheduled in UTC');
  });
 }
 function start(id,{policy,evidence,expectedOwner,expectedDigest}){
  return tx(()=>{const r=query(id),t=now();assert(['APPROVED','SCHEDULED'].includes(r.state)&&r.plan_digest===expectedDigest,'Not approved or plan changed');
   if(r.state==='SCHEDULED')assert(t>=Date.parse(r.not_before)&&t<Date.parse(r.not_after),'Outside approved maintenance window');
   const gate=evaluateAdmission({plan:r.plan,policy,approval:r.approval,evidence,expectedOwner,now:t});
   assert(gate.eligible,'Admission refused: '+gate.reasons.join(', '));
   const count=db.prepare('SELECT COUNT(DISTINCT deployment_id) AS n FROM resource_locks').get().n;
   assert(count<maxConcurrent,'Deployment concurrency limit reached');
   for(const resource of r.plan.resources){assert(!db.prepare('SELECT 1 FROM resource_locks WHERE resource=?').get(resource),'Resource locked: '+resource);}
   for(const resource of r.plan.resources)db.prepare('INSERT INTO resource_locks(resource,deployment_id) VALUES(?,?)').run(resource,id);
   return change(id,'PREFLIGHT','Fresh admission passed; all resource locks acquired');
  });
 }
 function activate(id,{policy,evidence,expectedOwner,expectedDigest}){
  return tx(()=>{const r=query(id),t=now();assert(r.state==='VALIDATING'&&r.plan_digest===expectedDigest,'Not ready to activate or plan changed');
   if(r.not_after)assert(t>=Date.parse(r.not_before)&&t<Date.parse(r.not_after),'Outside approved maintenance window');
   const gate=evaluateAdmission({plan:r.plan,policy,approval:r.approval,evidence,expectedOwner,now:t});assert(gate.eligible,'Activation refused: '+gate.reasons.join(', '));
   const locks=db.prepare('SELECT resource FROM resource_locks WHERE deployment_id=? ORDER BY resource').all(id).map(x=>x.resource);
   assert(JSON.stringify(locks)===JSON.stringify(r.plan.resources),'Resource locks changed');
   return change(id,'ACTIVATING','Fresh exact-revision admission and lock verification passed');
  });
 }
 // Caller must establish exclusive ownership of the execution supervisor before invoking
 // on startup. Ambiguous mutations are never repeated and locks remain held.
 function recoverInterrupted(){
  return tx(()=>{const rows=db.prepare('SELECT id,state FROM deployments').all().filter(r=>active.has(r.state)&&r.state!=='RECOVERY_REQUIRED');
   return rows.map(r=>change(r.id,'RECOVERY_REQUIRED','Interrupted at '+r.state+'; reconcile observed runtime before any retry'));
  });
 }
 function resolveRecovery(id,{outcome,evidenceReceipt}){
  return tx(()=>{const r=query(id);assert(r.state==='RECOVERY_REQUIRED','Recovery not pending');
   assert(['COMPLETED','ROLLED_BACK','FAILED'].includes(outcome),'Invalid recovery outcome');
   // Internal supervisor only: a verified adapter must supply the outcome and receipt.
   return change(id,outcome,'Reconciled: '+note(evidenceReceipt));
  });
 }
 function due(limit=8){assert(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'Invalid due limit');const at=fmt(now());return db.prepare("SELECT id FROM deployments WHERE state='SCHEDULED' AND not_before<=? AND not_after>? ORDER BY not_before,id LIMIT ?").all(at,at,limit).map(r=>query(r.id));}
 function expireScheduled(){return tx(()=>db.prepare("SELECT id FROM deployments WHERE state='SCHEDULED' AND not_after<=?").all(fmt(now())).map(r=>change(r.id,'CANCELLED','Approved maintenance window missed; new exact approval required')));}
 function list(limit=100){assert(Number.isSafeInteger(limit)&&limit>=1&&limit<=500,'Invalid history limit');return db.prepare('SELECT id FROM deployments ORDER BY created_at DESC,id DESC LIMIT ?').all(limit).map(r=>query(r.id));}
 return {create,transition,approve,schedule,start,activate,recoverInterrupted,resolveRecovery,due,expireScheduled,list,get:query,
  events:id=>db.prepare('SELECT seq,at,state,receipt FROM deployment_events WHERE deployment_id=? ORDER BY seq').all(id),
  locks:()=>db.prepare('SELECT resource,deployment_id FROM resource_locks ORDER BY resource').all(),
  close:()=>db.close()};
}
