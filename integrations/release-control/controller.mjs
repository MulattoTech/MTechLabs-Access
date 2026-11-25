import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {PROJECTS} from './catalog.mjs';
import {normalizeInventory,reconcileInventory,compareObserved} from './inventory.mjs';
const run=promisify(execFile);
const validSha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const iso=()=>new Date().toISOString();
export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
function exact(data,keys){if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!keys.includes(k)))throw new ApiError(400,'Invalid request fields.');}
export function githubClient(executable='gh'){
 async function api(endpoint,jq){
  const {stdout}=await run(executable,['api','--method','GET',endpoint,'--jq',jq],{shell:false,windowsHide:true,timeout:15000,maxBuffer:1048576,env:{...process.env,GH_PROMPT_DISABLED:'1',GIT_TERMINAL_PROMPT:'0',GH_PAGER:'cat',GH_NO_UPDATE_NOTIFIER:'1'}});
  return stdout.trim();
 }
 return {
  async head(p){const sha=await api('repos/'+p.repo+'/git/ref/heads/'+p.branch.split('/').map(encodeURIComponent).join('/'),'.object.sha');if(!validSha(sha))throw Error('invalid_head');return sha;},
  async inventory(){
   const rows=[];
   for(let page=1;page<=10;page++){
    const batch=JSON.parse(await api('user/repos?affiliation=owner&per_page=100&page='+page,'[.[]|{full_name,archived,default_branch}]'));
    if(!Array.isArray(batch)||batch.length>100)throw Error('inventory_invalid');
    rows.push(...batch);
    if(batch.length<100)return normalizeInventory(rows);
   }
   throw Error('inventory_limit_exceeded');
  },
  async compare(p,base,head){
   if(!validSha(base)||!validSha(head))throw Error('invalid_sha');
   if(base===head)return {status:'identical',ahead:0,behind:0};
   const j=JSON.parse(await api('repos/'+p.repo+'/compare/'+base+'...'+head+'?per_page=1','{status,ahead:ahead_by,behind:behind_by}'));
   if(!['identical','ahead','behind','diverged'].includes(j.status)||!Number.isSafeInteger(j.ahead)||j.ahead<0||!Number.isSafeInteger(j.behind)||j.behind<0)throw Error('invalid_compare');
   return j;
  },
  async checks(p,sha){
   if(!validSha(sha))throw Error('invalid_sha');
   const j=JSON.parse(await api('repos/'+p.repo+'/commits/'+sha+'/check-runs?per_page=100','{total_count,check_runs:[.check_runs[]|{name,status,conclusion,appId:.app.id,headSha:.head_sha}]}'));
   if(!Number.isSafeInteger(j.total_count)||!Array.isArray(j.check_runs))throw Error('invalid_checks');
   return {total:j.total_count,returned:j.check_runs.length,checks:j.check_runs.slice(0,100).map(c=>({name:String(c.name||'').slice(0,160),status:String(c.status||'').slice(0,30),conclusion:c.conclusion===null?null:String(c.conclusion||'').slice(0,40),appId:Number.isSafeInteger(c.appId)?c.appId:null,headSha:validSha(c.headSha)?c.headSha:null}))};
  }
 };
}
const dockerNames={MJobs:['mjobs-micro-api-1','mjobs-micro-worker-1','mjobs-micro-scheduler-1','mjobs-micro-source-worker-1','mjobs-micro-ai-worker-1','mjobs-micro-company-discovery-worker-1','mjobs-micro-document-worker-1'],'Sat-Tracker':['babytracker-sprout']};
export async function observeDeployment(p){
 const unknown=detail=>({state:'unknown',detail,observedAt:iso()});
 const names=dockerNames[p.id];if(!names)return unknown('No verified deployment identity adapter enrolled.');
 try{
  const fmt='{{.Name}}|{{.State.Running}}|{{.Config.Image}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "org.opencontainers.image.source"}}';
  const {stdout}=await run('docker',['inspect','--format',fmt,...names],{shell:false,windowsHide:true,timeout:8000,maxBuffer:65536});
  const rows=stdout.trim().split(/\r?\n/).map(x=>x.split('|'));
  if(rows.length!==names.length||rows.some(r=>r.length!==5||r[1]!=='true'))return unknown('Expected running container set not confirmed.');
  const labels=rows.map(r=>r[3]), sources=rows.map(r=>r[4]);
  if(labels.every(s=>validSha(s)&&s===labels[0])&&sources.every(s=>s==='https://github.com/'+p.repo))return {state:'reported',sha:labels[0],detail:'Consistent runtime source labels, not signed attestation.',observedAt:iso()};
  const tags=rows.map(r=>r[2].match(/:sha-([a-f0-9]{40})$/)?.[1]);
  if(tags.every(s=>validSha(s)&&s===tags[0]))return {state:'hint',sha:tags[0],detail:'Consistent image tag; source identity not independently proven.',observedAt:iso()};
  return unknown('Container source labels do not establish this repository revision.');
 }catch{return unknown('Local deployment inspection unavailable.');}
}
export async function createController({stateFile,github=githubClient(),observe=observeDeployment,now=()=>Date.now()}){
 let state={schema:1,heads:{},plans:{},events:[],inventory:null,enrolled:{}},busy=false;
 await fs.mkdir(path.dirname(stateFile),{recursive:true});
 try{const raw=await fs.readFile(stateFile,'utf8');if(raw.length>8388608)throw Error('state_too_large');state=JSON.parse(raw);if(state.schema!==1||!state.heads||!state.plans||!Array.isArray(state.events))throw Error('invalid_state');}catch(e){if(e.code!=='ENOENT')throw e;}
 state.inventory??=null;state.enrolled??={};
 const projects=()=>state.inventory?.rows?reconcileInventory(state.inventory.rows,state.enrolled):PROJECTS.map(p=>({...p,inventoryStatus:'not-checked',enrollment:'configured'}));
 const project=id=>{const p=projects().find(p=>p.id===id);if(!p||p.archived||p.enrollment==='discovered'||['not-observed','archive-changed','default-branch-changed'].includes(p.inventoryStatus)||Object.hasOwn(Object.prototype,p.id))throw new ApiError(400,'Unknown, archived, unenrolled or changed project. Refresh inventory.');return p;};
 const save=async next=>{const tmp=stateFile+'.'+randomUUID()+'.tmp';const data=JSON.stringify(next,null,2)+'\n';if(Buffer.byteLength(data)>8388608)throw Error('state_too_large');try{await fs.writeFile(tmp,data,{flag:'wx',mode:0o600});await fs.rename(tmp,stateFile);state=next;}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}};
 const event=(next,type,id,extra={})=>{next.events=[...next.events,{at:iso(),type,id,...extra}].slice(-500);};
 const lock=async fn=>{if(busy)throw new ApiError(409,'Another operation is in progress.');busy=true;try{return await fn();}finally{busy=false;}};
 function snapshot(){return {schema:1,mode:'review-and-prepare',inventory:state.inventory?{status:state.inventory.status,checkedAt:state.inventory.checkedAt,attemptAt:state.inventory.attemptAt,count:state.inventory.rows?.length??null}:null,projects:projects().map(p=>({...p,head:Object.hasOwn(state.heads,p.id)?state.heads[p.id]:null,plan:Object.hasOwn(state.plans,p.id)?state.plans[p.id]:null})),events:state.events.slice(-30).reverse(),activation:'blocked-until-adapter-qualified'};}
 async function discover(data){
  exact(data,[]);
  return lock(async()=>{
   const old=state.inventory??{};
   if(old.attemptAt&&now()-Date.parse(old.attemptAt)<60000)return snapshot();
   const next=structuredClone(state);
   try{
    const rows=await github.inventory();
    // The trusted provider normalizes and validates all pages before returning.
    if(!Array.isArray(rows)||rows.length===0)throw Error('inventory_empty');
    const validated=normalizeInventory(rows.map(r=>({full_name:r.repo,archived:r.archived,default_branch:r.branch})));
    next.inventory={rows:validated,status:'ok',checkedAt:new Date(now()).toISOString(),attemptAt:new Date(now()).toISOString()};
    event(next,'inventory-observed','inventory',{count:validated.length});
   }catch{next.inventory={...old,status:'unavailable',attemptAt:new Date(now()).toISOString()};}
   await save(next);return snapshot();
  });
 }
 async function enroll(data){
  exact(data,['id','branch']);
  return lock(async()=>{
   if(state.inventory?.status!=='ok'||now()-Date.parse(state.inventory.checkedAt)>300000)throw new ApiError(409,'Refresh repository inventory before enrollment.');
   const p=projects().find(p=>p.id===data.id);
   if(!p||p.archived||p.enrollment!=='discovered'||p.branch!==data.branch||Object.hasOwn(Object.prototype,p.id))throw new ApiError(400,'Only a discovered active repository with its exact observed branch may be enrolled.');
   const next=structuredClone(state);next.enrolled[p.id]={branch:p.branch,enrolledAt:new Date(now()).toISOString()};
   event(next,'source-enrolled',p.id,{branch:p.branch});await save(next);return snapshot();
  });
 }
 async function check(data){
  exact(data,['ids']);if(!Array.isArray(data.ids)||data.ids.length<1||data.ids.length>6||new Set(data.ids).size!==data.ids.length)throw new ApiError(400,'Select one to six distinct projects.');
  const ps=data.ids.map(project);
  return lock(async()=>{
   const next=structuredClone(state);
   await Promise.all(ps.map(async p=>{
    const old=next.heads[p.id]||{};
    if(old.attemptAt&&now()-Date.parse(old.attemptAt)<60000)return;
    try{const sha=await github.head(p);if(!validSha(sha))throw Error('invalid_head');let deployment;try{deployment=await observe(p);}catch{deployment={state:'unknown',detail:'Deployment inspection unavailable.',observedAt:iso()};}
     let comparison=null;if(validSha(deployment?.sha)&&deployment.sha!==sha&&typeof github.compare==='function'){try{comparison=await github.compare(p,deployment.sha,sha);}catch{}}
     next.heads[p.id]={sha,previousSha:old.sha&&old.sha!==sha?old.sha:old.previousSha||null,checkedAt:iso(),attemptAt:iso(),status:'ok',deployment,comparison:compareObserved({deployment,head:sha,comparison})};
     if(old.sha!==sha)event(next,'head-observed',p.id,{sha});
    }catch{next.heads[p.id]={...old,status:'unavailable',attemptAt:iso(),error:'Lookup unavailable; last known data retained.'};}
   }));await save(next);return snapshot();
  });
 }
 async function prepare(data){
  exact(data,['id','sha']);const p=project(data.id);if(!validSha(data.sha))throw new ApiError(400,'Invalid exact commit.');
  return lock(async()=>{
   const current=state.heads[p.id];if(!current||current.status!=='ok'||current.sha!==data.sha)throw new ApiError(409,'Refresh and review the exact revision.');
   let head;try{head=await github.head(p);}catch{throw new ApiError(503,'GitHub verification unavailable.');}
   if(head!==data.sha)throw new ApiError(409,'Branch moved. Check again before preparing.');
   let checks=null;try{checks=await github.checks(p,head);}catch{}
   const old=state.plans[p.id],next=structuredClone(state);
   if(old?.sha===head){next.plans[p.id]={...old,checks,checksObservedAt:iso()};event(next,'check-evidence-refreshed',p.id,{planId:old.id,sha:head});await save(next);return snapshot();}
   if(old)event(next,'plan-superseded',p.id,{planId:old.id,sha:old.sha});
   const plan={id:randomUUID(),sha:head,branch:p.branch,createdAt:iso(),status:'prepared',notBefore:null,checks,checksObservedAt:iso(),requiredChecks:'unverified',activation:'not-enrolled',sourceUrl:'https://github.com/'+p.repo+'/commit/'+head};
   next.plans[p.id]=plan;event(next,'release-prepared',p.id,{planId:plan.id,sha:head});await save(next);return snapshot();
  });
 }
 async function decide(data){
  exact(data,['id','planId','sha','decision','notBefore']);const p=project(data.id);
  if(!['reviewed','hold'].includes(data.decision)||!validSha(data.sha)||typeof data.planId!=='string')throw new ApiError(400,'Invalid decision.');
  let notBefore=null;
  if(data.notBefore!=null){if(data.decision!=='hold'||typeof data.notBefore!=='string'||!Number.isFinite(Date.parse(data.notBefore))||Date.parse(data.notBefore)<now())throw new ApiError(400,'Hold date must be in the future.');notBefore=new Date(data.notBefore).toISOString();}
  return lock(async()=>{const plan=state.plans[p.id];if(!plan||plan.id!==data.planId||plan.sha!==data.sha)throw new ApiError(409,'Plan changed; refresh.');
   if(data.decision==='reviewed'){
    if(state.heads[p.id]?.status!=='ok'||state.heads[p.id]?.sha!==plan.sha)throw new ApiError(409,'Refresh the current head.');
    let latest;try{latest=await github.head(p);}catch{throw new ApiError(503,'GitHub verification unavailable.');}if(latest!==plan.sha)throw new ApiError(409,'Branch moved; refresh and review.');
   }
   const next=structuredClone(state);next.plans[p.id]={...plan,status:data.decision,notBefore,decisionAt:iso()};event(next,'release-'+data.decision,p.id,{planId:plan.id,sha:plan.sha,notBefore});await save(next);return snapshot();});
 }
 return {snapshot,check,prepare,decide,discover,enroll};
}