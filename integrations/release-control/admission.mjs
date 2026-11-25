import {createHash} from 'node:crypto';

const sha=/^[a-f0-9]{40}$/;
const digest=/^sha256:[a-f0-9]{64}$/;
const identifier=/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/;
const timestamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(Date.parse(x)).toISOString()===x;
export const canonicalDigest=x=>'sha256:'+createHash('sha256').update(JSON.stringify(x)).digest('hex');
function requireValue(ok,what){if(!ok)throw new TypeError('Invalid '+what);}
export function normalizePlan(p){
 requireValue(p&&typeof p==='object','plan');
 const keys=['repo','branch','sha','artifactDigest','targetId','environment','resources','policyDigest'];
 requireValue(Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k)),'plan fields');
 requireValue(typeof p.repo==='string'&&/^MulattoTech\/[A-Za-z0-9._-]+$/.test(p.repo),'repository');
 requireValue(typeof p.branch==='string'&&identifier.test(p.branch)&&!p.branch.includes('..'),'branch');
 requireValue(typeof p.sha==='string'&&sha.test(p.sha),'revision');
 requireValue(typeof p.artifactDigest==='string'&&digest.test(p.artifactDigest),'artifact digest');
 requireValue(typeof p.policyDigest==='string'&&digest.test(p.policyDigest),'policy digest');
 requireValue(typeof p.targetId==='string'&&identifier.test(p.targetId),'target');
 requireValue(['production','staging','development','fixture'].includes(p.environment),'environment');
 requireValue(Array.isArray(p.resources)&&p.resources.length>=1&&p.resources.length<=32&&p.resources.every(x=>typeof x==='string'&&identifier.test(x))&&new Set(p.resources).size===p.resources.length,'resource locks');
 requireValue(p.resources.includes('target:'+p.targetId),'target lock');
 return {repo:p.repo,branch:p.branch,sha:p.sha,artifactDigest:p.artifactDigest,targetId:p.targetId,environment:p.environment,resources:[...p.resources].sort(),policyDigest:p.policyDigest};
}
export function normalizePolicy(p){
 requireValue(p&&typeof p==='object'&&Object.keys(p).length===7&&['targetId','environment','repo','branch','requiredChecks','maxEvidenceAgeMs','resources'].every(k=>Object.hasOwn(p,k)),'policy');
 requireValue(typeof p.targetId==='string'&&identifier.test(p.targetId),'policy target');
 requireValue(['production','staging','development','fixture'].includes(p.environment),'policy environment');
 requireValue(typeof p.repo==='string'&&/^MulattoTech\/[A-Za-z0-9._-]+$/.test(p.repo),'policy repository');
 requireValue(typeof p.branch==='string'&&identifier.test(p.branch)&&!p.branch.includes('..'),'policy branch');
 requireValue(Array.isArray(p.requiredChecks)&&p.requiredChecks.length>0&&p.requiredChecks.length<=100,'required checks');
 const checks=p.requiredChecks.map(c=>{
  requireValue(c&&Object.keys(c).length===2&&typeof c.name==='string'&&c.name.length>0&&c.name.length<=160&&Number.isSafeInteger(c.appId)&&c.appId>0,'required check identity');
  return {name:c.name,appId:c.appId};
 }).sort((a,b)=>a.name.localeCompare(b.name)||a.appId-b.appId);
 requireValue(new Set(checks.map(c=>JSON.stringify(c))).size===checks.length,'duplicate check identity');
 requireValue(Number.isSafeInteger(p.maxEvidenceAgeMs)&&p.maxEvidenceAgeMs>=1000&&p.maxEvidenceAgeMs<=900000,'evidence lifetime');
 requireValue(Array.isArray(p.resources)&&p.resources.length>=1&&p.resources.length<=32&&p.resources.every(x=>typeof x==='string'&&identifier.test(x))&&new Set(p.resources).size===p.resources.length&&p.resources.includes('target:'+p.targetId),'policy resource locks');
 return {targetId:p.targetId,environment:p.environment,repo:p.repo,branch:p.branch,requiredChecks:checks,maxEvidenceAgeMs:p.maxEvidenceAgeMs,resources:[...p.resources].sort()};
}
export const planDigest=p=>canonicalDigest(normalizePlan(p));
export const policyDigest=p=>canonicalDigest(normalizePolicy(p));
export function createApproval(plan,{owner,approvedAt,expiresAt}){
 requireValue(typeof owner==='string'&&owner.length>0&&owner.length<=254,'owner');
 requireValue(timestamp(approvedAt)&&timestamp(expiresAt)&&Date.parse(expiresAt)>Date.parse(approvedAt)&&Date.parse(expiresAt)-Date.parse(approvedAt)<=86400000,'approval lifetime');
 return {planDigest:planDigest(plan),owner,approvedAt,expiresAt};
}
export function evaluateAdmission({plan,policy,approval,evidence,expectedOwner,now=Date.now()}){
 const reasons=[];let p,q;
 try{p=normalizePlan(plan);q=normalizePolicy(policy);}catch{return {eligible:false,reasons:['invalid_plan_or_policy']};}
 const block=(ok,reason)=>{if(!ok)reasons.push(reason);};
 block(p.policyDigest===policyDigest(q)&&['repo','branch','targetId','environment'].every(k=>p[k]===q[k])&&JSON.stringify(p.resources)===JSON.stringify(q.resources),'policy_mismatch');
 block(typeof expectedOwner==='string'&&expectedOwner.length>0&&approval?.owner===expectedOwner&&approval?.planDigest===planDigest(p)&&timestamp(approval.approvedAt)&&timestamp(approval.expiresAt)&&Date.parse(approval.approvedAt)<=now&&Date.parse(approval.expiresAt)>now&&Date.parse(approval.expiresAt)-Date.parse(approval.approvedAt)<=86400000,'approval_missing_stale_or_changed');
 block(evidence?.planDigest===planDigest(p)&&timestamp(evidence?.observedAt)&&Date.parse(evidence.observedAt)<=now&&now-Date.parse(evidence.observedAt)<=q.maxEvidenceAgeMs,'evidence_stale_or_mismatched');
 block(evidence?.head===p.sha,'branch_moved_or_unavailable');
 block(evidence?.artifactDigest===p.artifactDigest,'artifact_mismatch');
 const runs=evidence?.checks;
 const complete=Array.isArray(runs?.items)&&runs.total===runs.items.length&&runs.total>0&&runs.total<=100&&runs.sha===p.sha;
 block(complete,'checks_incomplete');
 if(complete)for(const c of q.requiredChecks){
  const matches=runs.items.filter(r=>r.name===c.name&&r.appId===c.appId&&r.headSha===p.sha);
  block(matches.length===1&&matches[0].status==='completed'&&matches[0].conclusion==='success','required_check_not_passed:'+c.name+':'+c.appId);
 }
 for(const k of ['provenance','review','security','configuration','dependencies','resources','backup','recovery','adapter'])block(evidence?.[k]==='verified','unverified_'+k);
 return {eligible:reasons.length===0,reasons};
}
