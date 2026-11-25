(() => {
'use strict';
const root='/admin/releases';
let state=null,working=false;
const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
const $=id=>document.getElementById(id);
function link(label,url,cls){const a=el('a',cls,label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function time(s){return s?new Date(s).toLocaleString():'Not yet checked';}
function short(s){return s?s.slice(0,10):'Unknown';}
function message(s){$('message').textContent=s;}
async function api(route,data){
 const r=await fetch(root+'/api/'+route,{method:data?'POST':'GET',cache:'no-store',credentials:'same-origin',...(data?{headers:{'Content-Type':'application/json','X-MTech-Release':'1'},body:JSON.stringify(data)}:{})});
 const j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');return j;
}
function button(label,fn,disabled=false){const b=el('button','',label);b.disabled=disabled||working;b.addEventListener('click',fn);return b;}
function setBusy(v){working=v;$('check-all').disabled=v||!state;render();}
async function perform(fn,start,end){if(working)return;setBusy(true);message(start);try{state=await fn();message(end);}catch(e){message(e.message||'Operation failed.');}finally{setBusy(false);}}
function render(){
 if(!state)return;
 const ps=state.projects,active=ps.filter(p=>!p.archived);
 $('count').textContent=active.length;$('checked').textContent=active.filter(p=>p.head?.status==='ok').length;$('changed').textContent=active.filter(p=>p.head?.sha&&p.head.previousSha&&p.head.sha!==p.head.previousSha).length;$('queued').textContent=active.filter(p=>p.plan).length;
 $('check-all').disabled=working;
 const q=$('search').value.toLowerCase(),f=$('filter').value;
 const rows=$('rows');rows.replaceChildren();
 for(const p of ps){
  if(![p.name,p.repo,p.target,p.kind].join(' ').toLowerCase().includes(q))continue;
  if(f==='active'&&p.archived||f==='changed'&&!(p.head?.previousSha&&p.head.sha!==p.head.previousSha)||f==='plans'&&!p.plan||f==='mapped'&&['Repository','Archived'].includes(p.kind))continue;
  const h=p.head,plan=p.plan,d=h?.deployment,row=el('article','row'),name=el('div'),head=el('div'),deploy=el('div'),act=el('div');
  name.append(el('h3','',p.name),el('small','',p.repo),el('small','',p.kind+' · '+p.target));
  head.append(el('span','pill '+(h?.status==='ok'?'ok':h?.status==='unavailable'?'warn':''),p.archived?'Archived':h?.status==='ok'?(h.previousSha&&h.sha!==h.previousSha?'New head observed':'Head checked'):h?.status==='unavailable'?'Check unavailable':'Not checked'));
  if(h?.sha)head.append(link(short(h.sha),'https://github.com/'+p.repo+'/commit/'+h.sha,'commit'));else head.append(el('span','commit','—'));
  head.append(el('small','',p.branch+' · '+time(h?.checkedAt)));
  deploy.append(el('span','pill '+(d?.state==='hint'?'warn':''),d?.state==='reported'?'Runtime label':d?.state==='hint'?'Image-tag hint':'Deployment unknown'),el('span','commit',short(d?.sha)),el('small','',d?.detail||'No enrolled deployment identity.'));
  if(d?.sha&&h?.sha&&d.sha!==h.sha)deploy.append(link('Compare observed reference','https://github.com/'+p.repo+'/compare/'+d.sha+'...'+h.sha));
  const actions=el('div','actions');
  actions.append(button('Check',()=>perform(()=>api('check',{ids:[p.id]}),'Checking '+p.name+'…','Repository check complete.'),p.archived),button('Prepare',()=>perform(()=>api('prepare',{id:p.id,sha:h.sha}),'Preparing exact revision…','Release preparation saved. Nothing deployed.'),p.archived||h?.status!=='ok'),link('GitHub','https://github.com/'+p.repo),link('Actions','https://github.com/'+p.repo+'/actions'));
  if(p.url)actions.append(link('Service',p.url));
  act.append(actions,el('small','',plan?'Plan: '+plan.status+' · '+short(plan.sha):'No release prepared'));
  row.append(name,head,deploy,act);
  if(plan){
   const detail=el('div','detail'),stats=plan.checks,stale=h?.sha!==plan.sha||h?.status!=='ok';
   detail.append(el('strong','', 'Release '+short(plan.sha)+' · '+plan.status+(stale?' · HEAD unconfirmed/changed':'')),el('p','muted',stats?'Check runs returned '+stats.returned+' of '+stats.total+'; '+stats.checks.filter(c=>c.conclusion==='success').length+' successful, '+stats.checks.filter(c=>c.status!=='completed').length+' incomplete. Required checks not verified.':'Check evidence unavailable. Required checks not verified.'));
   const controls=el('div','actions'),dt=el('input');dt.type='datetime-local';dt.setAttribute('aria-label','Hold until local time');
   if(plan.notBefore){const x=new Date(plan.notBefore);dt.value=new Date(x.getTime()-x.getTimezoneOffset()*60000).toISOString().slice(0,16);}
   const decision=(decision,notBefore)=>perform(()=>api('decision',{id:p.id,planId:plan.id,sha:plan.sha,decision,notBefore}),'Saving your decision…','Decision recorded. No deployment triggered.');
   controls.append(link('Review exact commit',plan.sourceUrl),button('Mark reviewed',()=>decision('reviewed',null),stale),dt,button('Hold',()=>{const n=dt.value?new Date(dt.value):null;if(n&&(!Number.isFinite(n.getTime())||n<=new Date())){message('Choose a future hold time.');return;}decision('hold',n?n.toISOString():null);}),button('Deploy — adapter required',()=>{},true));
   detail.append(controls,el('small','',plan.notBefore?'Held until '+time(plan.notBefore)+' (manual release only).':'No automatic activation; deployment requires an independently qualified adapter.'));
   row.append(detail);
  }
  rows.append(row);
 }
 if(!rows.children.length)rows.append(el('p','empty','No projects match the selected view.'));
 const events=$('events');events.replaceChildren();
 for(const e of state.events){const item=el('div','event');item.append(el('span','',e.id+' · '+e.type+(e.sha?' · '+short(e.sha):'')),el('small','muted',time(e.at)));events.append(item);}
 if(!events.children.length)events.append(el('p','muted','No release activity yet.'));
}
$('search').addEventListener('input',render);$('filter').addEventListener('change',render);
$('check-all').addEventListener('click',()=>perform(async()=>{let result=state;const ids=state.projects.filter(p=>!p.archived).map(p=>p.id);for(let i=0;i<ids.length;i+=6){message('Checking '+Math.min(i+6,ids.length)+' of '+ids.length+' repositories…');result=await api('check',{ids:ids.slice(i,i+6)});state=result;render();}return result;},'Checking repositories…','Check complete. Unknown deployment versions remain explicitly unknown.'));
api('status').then(s=>{state=s;message('Ready. Checks are on demand; deployments require a qualified adapter.');render();}).catch(()=>message('Release controller unavailable or owner authorization required.'));
})();
