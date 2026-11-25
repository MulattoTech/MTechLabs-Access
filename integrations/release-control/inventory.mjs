import {PROJECTS} from './catalog.mjs';

const OWNER='MulattoTech';
const validName=s=>typeof s==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(s)&&s!=='.'&&s!=='..';
const validBranch=s=>typeof s==='string'&&s.length>0&&s.length<=250&&!/[\x00-\x20\x7f~^:?*\[\\]/.test(s)&&!s.includes('..')&&!s.includes('@{')&&!s.startsWith('/')&&!s.endsWith('/')&&!s.endsWith('.');
export function normalizeInventory(rows){
 if(!Array.isArray(rows)||rows.length>1000)throw Error('inventory_invalid');
 const seen=new Set(),out=[];
 for(const r of rows){
  if(!r||typeof r.full_name!=='string')throw Error('inventory_invalid');
  const parts=r.full_name.split('/');
  if(parts.length!==2||parts[0].toLowerCase()!==OWNER.toLowerCase())continue;
  if(!validName(parts[1])||typeof r.archived!=='boolean'||!validBranch(r.default_branch))throw Error('inventory_invalid');
  const key=parts[1].toLowerCase();
  if(seen.has(key))throw Error('inventory_duplicate');
  seen.add(key);out.push({id:parts[1],repo:OWNER+'/'+parts[1],branch:r.default_branch,archived:r.archived});
 }
 return out.sort((a,b)=>a.id.localeCompare(b.id,'en'));
}
export function reconcileInventory(rows,enrolled={}){
 const actual=new Map(rows.map(r=>[r.id.toLowerCase(),r]));
 const configured=new Map(PROJECTS.map(p=>[p.id.toLowerCase(),p]));
 const result=[];
 for(const p of PROJECTS){
  const r=actual.get(p.id.toLowerCase());
  result.push({...p,archived:p.archived||r?.archived===true,inventoryStatus:!r?'not-observed':r.archived!==p.archived?'archive-changed':r.branch!==p.branch?'default-branch-changed':'observed',observedDefaultBranch:r?.branch??null,enrollment:'configured'});
 }
 for(const r of rows){
  if(configured.has(r.id.toLowerCase()))continue;
  const p=Object.hasOwn(enrolled,r.id)?enrolled[r.id]:null;
  result.push({...r,name:r.id,kind:r.archived?'Archived':'Repository',target:r.archived?'Archived; no activation':'Deployment mapping not qualified',url:'',inventoryStatus:'observed',observedDefaultBranch:r.branch,enrollment:p?'source-only':'discovered',...(p?{branch:p.branch,inventoryStatus:p.branch===r.branch?'observed':'default-branch-changed'}:{})});
 }
 return result;
}
export function compareObserved({deployment,head,comparison}){
 const confidence=deployment?.state??'unknown';
 if(!deployment?.sha||!head)return {status:'unavailable',confidence,detail:'Source or runtime revision unknown.'};
 if(deployment.sha===head)return {status:'identical',confidence,detail:'Observed references match; confidence unchanged.'};
 if(!comparison||!['identical','ahead','behind','diverged','unrelated'].includes(comparison.status))return {status:'unavailable',confidence,detail:'GitHub comparison unavailable.'};
 return {status:comparison.status,confidence,ahead:comparison.ahead,behind:comparison.behind,detail:'GitHub source comparison; runtime confidence unchanged.'};
}
