import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {PROJECTS,byId} from './catalog.mjs';
const run=promisify(execFile);
const validSha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const iso=()=>new Date().toISOString();
export class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
const project=id=>{const p=byId.get(id);if(!p||p.archived)throw new ApiError(400,'Unknown or archived project.');return p;};
function exact(data,keys){if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!keys.includes(k)))throw new ApiError(400,'Invalid request fields.');}
export function githubClient(executable='gh'){
 async function api(endpoint,jq){
  const {stdout}=await run(executable,['api','--method','GET',endpoint,'--jq',jq],{shell:false,windowsHide:true,timeout:15000,maxBuffer:1048576,env:{...process.env,GH_PROMPT_DISABLED:'1',GIT_TERMINAL_PROMPT:'0',GH_PAGER:'cat',GH_NO_UPDATE_NOTIFIER:'1'}});
  return stdout.trim();
 }
 return {
  async head(p){const sha=await api('repos/'+p.repo+'/git/ref/heads/'+p.branch,'.object.sha');if(!validSha(sha))throw Error('invalid_head');return sha;},
  async checks(p,sha){
   if(!validSha(sha))throw Error('invalid_sha');
   const j=JSON.parse(await api('repos/'+p.repo+'/commits/'+sha+'/check-runs?per_page=100','{total_count,check_runs:[.check_runs[]|{name,status,conclusion}]}'));
   if(!Number.isSafeInteger(j.total_count)||!Array.isArray(j.check_runs))throw Error('invalid_checks');
   return {total:j.total_count,returned:j.check_runs.length,checks:j.check_runs.slice(0,100).map(c=>({name:String(c.name||'').slice(0,160),status:String(c.status||'').slice(0,30),conclusion:c.conclusion===null?null:String(c.conclusion||'').slice(0,40)}))};
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
 let state={schema:1,heads:{},plans:{},events:[]},busy=false;
 await fs.mkdir(path.dirname(stateFile),{recursive:true});
 try{const raw=await fs.readFile(stateFile,'utf8');if(raw.length>8388608)throw Error('state_too_large');state=JSON.parse(raw);if(state.schema!==1||!state.heads||!state.plans||!Array.isArray(state.events))throw Error('invalid_state');}catch(e){if(e.code!=='ENOENT')throw e;}
 const save=async next=>{const tmp=stateFile+'.'+randomUUID()+'.tmp';const data=JSON.stringify(next,null,2)+'\n';if(Buffer.byteLength(data)>8388608)throw Error('state_too_large');try{await fs.writeFile(tmp,data,{flag:'wx',mode:0o600});await fs.rename(tmp,stateFile);state=next;}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}};
 const event=(next,type,id,extra={})=>{next.events=[...next.events,{at:iso(),type,id,...extra}].slice(-500);};
 const lock=async fn=>{if(busy)throw new ApiError(409,'Another operation is in progress.');busy=true;try{return await fn();}finally{busy=false;}};
 function snapshot(){return {schema:1,mode:'review-and-prepare',projects:PROJECTS.map(p=>({...p,head:state.heads[p.id]||null,plan:state.plans[p.id]||null})),events:state.events.slice(-30).reverse(),activation:'blocked-until-adapter-qualified'};}
 async function check(data){
  exact(data,['ids']);if(!Array.isArray(data.ids)||data.ids.length<1||data.ids.length>6||new Set(data.ids).size!==data.ids.length)throw new ApiError(400,'Select one to six distinct projects.');
  const ps=data.ids.map(project);
  return lock(async()=>{
   const next=structuredClone(state);
   await Promise.all(ps.map(async p=>{
    const old=next.heads[p.id]||{};
    if(old.attemptAt&&now()-Date.parse(old.attemptAt)<60000)return;
    try{const sha=await github.head(p);if(!validSha(sha))throw Error('invalid_head');const deployment=await observe(p);
     next.heads[p.id]={sha,previousSha:old.sha&&old.sha!==sha?old.sha:old.previousSha||null,checkedAt:iso(),attemptAt:iso(),status:'ok',deployment};
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
   if(old?.sha===head)return snapshot();
   if(old)event(next,'plan-superseded',p.id,{planId:old.id,sha:old.sha});
   const plan={id:randomUUID(),sha:head,branch:p.branch,createdAt:iso(),status:'prepared',notBefore:null,checks,requiredChecks:'unverified',activation:'not-enrolled',sourceUrl:'https://github.com/'+p.repo+'/commit/'+head};
   next.plans[p.id]=plan;event(next,'release-prepared',p.id,{planId:plan.id,sha:head});await save(next);return snapshot();
  });
 }
 async function decide(data){
  exact(data,['id','planId','sha','decision','notBefore']);const p=project(data.id);
  if(!['reviewed','hold'].includes(data.decision)||!validSha(data.sha)||typeof data.planId!=='string')throw new ApiError(400,'Invalid decision.');
  let notBefore=null;
  if(data.notBefore!=null){if(data.decision!=='hold'||typeof data.notBefore!=='string'||!Number.isFinite(Date.parse(data.notBefore))||Date.parse(data.notBefore)<now())throw new ApiError(400,'Hold date must be in the future.');notBefore=new Date(data.notBefore).toISOString();}
  return lock(async()=>{const plan=state.plans[p.id];if(!plan||plan.id!==data.planId||plan.sha!==data.sha)throw new ApiError(409,'Plan changed; refresh.');
   if(data.decision==='reviewed'&&(state.heads[p.id]?.status!=='ok'||state.heads[p.id]?.sha!==plan.sha))throw new ApiError(409,'Refresh the current head.');
   const next=structuredClone(state);next.plans[p.id]={...plan,status:data.decision,notBefore,decisionAt:iso()};event(next,'release-'+data.decision,p.id,{planId:plan.id,sha:plan.sha,notBefore});await save(next);return snapshot();});
 }
 return {snapshot,check,prepare,decide};
}
