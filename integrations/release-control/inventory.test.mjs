import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PROJECTS} from './catalog.mjs';
import {normalizeInventory,reconcileInventory,compareObserved} from './inventory.mjs';
import {createController} from './controller.mjs';
import {createServer} from './server.mjs';

const A='a'.repeat(40),B='b'.repeat(40);
const rows=PROJECTS.map(p=>({full_name:p.repo,default_branch:p.branch,archived:p.archived}));
const newRepo={full_name:'MulattoTech/New-Repo',default_branch:'feature/default',archived:false};
const project=(s,id)=>s.projects.find(x=>x.id===id);
test('inventory reconciles every configured repository, changes, newly archived and discovered rows without granting deployment authority',()=>{
 const normalized=normalizeInventory([...rows,newRepo,{full_name:'Other/Not-owned',default_branch:'main',archived:false}]);
 assert.equal(normalized.length,33);
 assert.equal(reconcileInventory(normalized).filter(p=>p.inventoryStatus==='observed').length,33);
 assert.equal(reconcileInventory(normalized).find(p=>p.id==='New-Repo').enrollment,'discovered');
 const changed=rows.filter(x=>x.full_name!=='MulattoTech/MBody').map(x=>x.full_name==='MulattoTech/MJobs'?{...x,archived:true}:x.full_name==='MulattoTech/MTerm-CLI'?{...x,default_branch:'release'}:x);
 const ps=reconcileInventory(normalizeInventory(changed));
 assert.equal(ps.find(p=>p.id==='MBody').inventoryStatus,'not-observed');
 assert.equal(ps.find(p=>p.id==='MJobs').archived,true);
 assert.equal(ps.find(p=>p.id==='MTerm-CLI').inventoryStatus,'default-branch-changed');
 assert.equal(ps.find(p=>p.id==='MTerm-CLI').branch,'main');
 assert.throws(()=>normalizeInventory([...rows,rows[0]]),/duplicate/);
 assert.throws(()=>normalizeInventory([{...newRepo,default_branch:'bad?query'}]));
});
test('comparison preserves runtime provenance and does not infer an unrelated revision from missing evidence',()=>{
 for(const status of ['ahead','behind','diverged','unrelated']){
  const x=compareObserved({deployment:{sha:A,state:'hint'},head:B,comparison:{status,ahead:2,behind:1}});
  assert.equal(x.status,status);assert.equal(x.confidence,'hint');
 }
 assert.equal(compareObserved({deployment:{sha:A,state:'reported'},head:A}).status,'identical');
 assert.equal(compareObserved({deployment:{sha:A,state:'reported'},head:B}).status,'unavailable');
 assert.equal(compareObserved({deployment:{state:'unknown'},head:B}).status,'unavailable');
});
test('discovery, source-only enrollment, persistence, stale review rejection and fresh same-SHA check evidence',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rc-inventory-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let clock=Date.now(),head=A,inventory=normalizeInventory([...rows,newRepo]),fail=false,checkCount=0;
 const github={inventory:async()=>{if(fail)throw Error('offline');return inventory;},head:async()=>head,checks:async()=>({total:1,returned:1,checks:[{name:'unit',status:'completed',conclusion:++checkCount===1?'failure':'success',headSha:head,appId:1}]}),compare:async()=>({status:'ahead',ahead:2,behind:0})};
 const opts={stateFile:path.join(dir,'state.json'),github,observe:async()=>({state:'hint',sha:B}),now:()=>clock};
 let c=await createController(opts),s=await c.discover({});
 assert.equal(s.inventory.count,33);
 await assert.rejects(c.check({ids:['New-Repo']}),{status:400});
 await assert.rejects(c.enroll({id:'New-Repo',branch:'main'}),{status:400});
 await assert.rejects(c.enroll({id:'MTerm',branch:'main'}),{status:400});
 s=await c.enroll({id:'New-Repo',branch:'feature/default'});
 assert.equal(project(s,'New-Repo').enrollment,'source-only');
 c=await createController(opts);assert.equal(project(c.snapshot(),'New-Repo').enrollment,'source-only');
 s=await c.check({ids:['New-Repo']});assert.equal(project(s,'New-Repo').head.comparison.status,'ahead');
 s=await c.prepare({id:'New-Repo',sha:A});const p=project(s,'New-Repo').plan;assert.equal(p.checks.checks[0].conclusion,'failure');
 s=await c.prepare({id:'New-Repo',sha:A});assert.equal(project(s,'New-Repo').plan.id,p.id);assert.equal(project(s,'New-Repo').plan.checks.checks[0].conclusion,'success');
 head=B;await assert.rejects(c.decide({id:'New-Repo',planId:p.id,sha:A,decision:'reviewed'}),{status:409});
 clock+=61000;fail=true;s=await c.discover({});assert.equal(s.inventory.status,'unavailable');assert.equal(s.inventory.count,33);
 await assert.rejects(c.enroll({id:'New-Repo',branch:'feature/default'}),{status:409});
 clock+=61000;fail=false;inventory=normalizeInventory(rows);s=await c.discover({});assert.equal(s.inventory.count,32);
 await assert.rejects(c.check({ids:['New-Repo']}),{status:400});
});
test('discovery and enrollment HTTP endpoints require authentication and same-origin protection',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rc-inventory-http-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const c=await createController({stateFile:path.join(dir,'state.json'),github:{inventory:async()=>normalizeInventory([...rows,newRepo])}});
 const server=await createServer({controller:c,verify:async token=>token==='fixture'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+'/admin/releases/api/';
 const headers={Host:'m-techlabs.com',Origin:'https://m-techlabs.com','Content-Type':'application/json','X-MTech-Release':'1','Cf-Access-Jwt-Assertion':'fixture'};
 // Node fetch sets Host itself in some releases; use node:http to pin the exact origin.
 const {request}=await import('node:http');
 const post=(route,h,data)=>new Promise((resolve,reject)=>{const r=request(url+route,{method:'POST',headers:h},res=>{let raw='';res.on('data',b=>raw+=b);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(raw)}));});r.on('error',reject);r.end(JSON.stringify(data));});
 assert.equal((await post('discover',{...headers,'Cf-Access-Jwt-Assertion':''},{})).status,401);
 assert.equal((await post('discover',{...headers,Origin:'https://evil.example'},{})).status,403);
 assert.equal((await post('discover',headers,{})).data.inventory.count,33);
 assert.equal((await post('enroll',{...headers,'X-MTech-Release':''},{id:'New-Repo',branch:'feature/default'})).status,403);
 assert.equal((await post('enroll',headers,{id:'New-Repo',branch:'feature/default'})).status,200);
 assert.equal((await post('deploy',headers,{id:'New-Repo'})).status,404);
});
