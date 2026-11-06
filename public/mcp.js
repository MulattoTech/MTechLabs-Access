'use strict';
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let snapshot=null,csrf=null,busy=false,dirty=false,noticeKind=null;
const time=value=>value?new Date(value).toLocaleString():'Unknown';
const bool=value=>value===true?'Yes':value===false?'No':'Unknown';
const memory=value=>typeof value==='number'?(value<1073741824?(value/1048576).toFixed(1)+' MiB':(value/1073741824).toFixed(1)+' GiB'):'Unknown';
const amount=value=>Number.isInteger(value)?String(value):'Unknown';
const metric=(label,value)=>`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;
const shared=status=>status?.limits?.scope==='shared-state-directory'&&[1,2].includes(status.limits.maxInflightGlobal);
function notice(message,error=false,kind='policy'){const node=$('#mcp-notice');node.textContent=message;node.classList.remove('hidden');node.classList.toggle('error',error);noticeKind=kind;}
async function api(path,body){const response=await fetch('/admin/mcp/api'+path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf||''},body:JSON.stringify(body),cache:'no-store'});const value=await response.json();if(!response.ok)throw Error(value.error||'The request could not be completed.');return value;}
function evidence(label,state,detail){return `<article><h3>${esc(label)}</h3><span class="mcp-state" data-state="${state===true?'yes':state===false?'no':'unknown'}">${state===true?'Verified':state===false?'Not verified':'Unknown'}</span><p class="small muted">${esc(detail)}</p></article>`;}
function remoteStatus(remote){
  if(!remote)return '<p class="muted">Remote protocol status is unknown. No client sign-in or endpoint health has been assumed.</p>';
  const clients=remote.observedClients||[];
  const metrics=[['Local backend state',remote.state],['Streamable HTTP SDK loaded',bool(remote.sdkLoaded)],['Shared backend',bool(remote.sharedBackend)],
    ['Active / maximum HTTP requests',amount(remote.activeHttpRequests)+' / '+amount(remote.maxHttpRequests)],['Active upstream requests',amount(remote.activeUpstreamRequests)],
    ['Idle timeout (seconds)',amount(remote.idleTimeoutSeconds)],['Idle teardown deferred',bool(remote.idleTeardownDeferred)],['Last tool-list page size',amount(remote.lastToolListCount)],
    ['Resource support reported',bool(remote.resourceSupport)],['Prompt support reported',bool(remote.promptSupport)],['Last successful protocol request',time(remote.lastSuccessfulRequestAt)],
    ['Last successful tool request',time(remote.lastSuccessfulToolAt)]];
  return `<dl class="mcp-metrics">${metrics.map(([label,value])=>metric(label,value)).join('')}</dl><h3>Clients observed at protocol initialization</h3>`+
    (clients.length?`<div class="table-wrap"><table><thead><tr><th>Client-reported name</th><th>Version</th><th>Last initialized</th></tr></thead><tbody>${clients.map(client=>`<tr><td>${esc(client.name)}</td><td>${esc(client.version||'Unknown')}</td><td>${esc(time(client.lastInitializedAt))}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No client initialization has been recorded since this manager started.</p>')+
    '<p class="small muted">These labels are supplied by clients. They identify protocol observations, not a verified OAuth account or a persistent connection. Confirm sign-in in each client.</p>';
}
function coordinatorStatus(status){
  const coordinator=status?.coordinator,limits=status?.limits;
  if(!shared(status)||!coordinator||coordinator.scope!=='shared-state-directory')return '<p class="notice">Shared scheduling is not verified. Older gateways may still apply their limit per instance. Finish existing work and reconnect those clients after upgrading.</p>';
  const available=coordinator.available===true,observedCount=value=>available?amount(value):'Unknown';
  const health=available?'Available':coordinator.available===false?'Blocked — coordinator unavailable':'Unknown — shared admission is not verified';
  let result=`<dl class="mcp-metrics">${metric('Coordinator',health)}${metric('Shared in-flight limit',amount(limits.maxInflightGlobal))}${metric('Reserved slots (including uncertain calls)',observedCount(coordinator.inflight))}${metric('Queued / shared queue capacity',observedCount(coordinator.queued)+' / '+amount(coordinator.queueCapacity))}${metric('Uncertain reservations',observedCount(coordinator.uncertain))}</dl>`;
  if(!available)result+='<p class="notice">Shared state could not be verified. New tool execution fails closed; reservation and queue counts are unknown.</p>';
  if(available&&coordinator.uncertain>0)result+='<p class="notice">An uncertain call may still be running. Its reservation remains until a definitive response arrives or the owner verifies completion and repairs the reservation. No automatic retries are made.</p>';
  const clients=available?coordinator.clients||[]:[];
  if(clients.length)result+=`<h3>Shared reservations by client</h3><div class="table-wrap"><table><thead><tr><th>Client</th><th>Reserved</th><th>Queued</th><th>Uncertain</th></tr></thead><tbody>${clients.map(client=>`<tr><td>${esc(client.client)}</td><td>${amount(client.inflight)}</td><td>${amount(client.queued)}</td><td>${amount(client.uncertain)}</td></tr>`).join('')}</tbody></table></div>`;
  const events=available?coordinator.recentEvents||[]:[];
  result+='<details class="mcp-events"><summary>Recent scheduler events</summary>'+(events.length?`<div class="table-wrap"><table><thead><tr><th>Time</th><th>Event</th><th>Client</th><th>Tool</th></tr></thead><tbody>${events.map(event=>`<tr><td>${esc(time(event.time))}</td><td>${esc(event.type)}</td><td>${esc(event.client||'Unknown')}</td><td>${esc(event.toolName||'—')}</td></tr>`).join('')}</tbody></table></div>`:`<p class="muted">${available?'No recent scheduler events were returned.':'Scheduler event history is unavailable.'}</p>`)+'<p class="small muted">Bounded operational history only. Tool arguments and command output are not displayed.</p></details>';
  return result;
}
function deploymentStatus(status){
  if(!status)return '<p class="muted">Version evidence is unavailable while the manager is offline.</p>';
  const record=status.deployment;
  return `<dl class="mcp-metrics">${metric('Running manager version',status.service?.version||'Unknown')}${metric('Node.js version',status.runtime?.nodeVersion||'Unknown')}${metric('Desktop Commander version',status.runtime?.packageVersion||'Unknown')}${metric('Desktop Commander installed',bool(status.runtime?.installed))}${metric('Manager uptime (seconds)',amount(status.service?.uptimeSeconds))}${metric('Recorded source commit',record?.sourceCommit||'No installation record')}${metric('Recorded installed time',time(record?.installedAt))}${metric('Recorded Worker version',record?.workerVersion||'No installation record')}</dl>`;
}
function render(){
  const value=snapshot,status=value?.status,entries=status?.inventory?.entries||[],tested=entries.filter(item=>item.tested===true).length,isShared=shared(status);
  $('#mcp-owner').textContent=value?`Signed in as ${value.owner}. Local tool management remains owner-only.`:'Owner session unavailable.';
  $('#mcp-observed').textContent=value?`Checked ${time(value.observedAt)}`:'Not checked';
  $('#mcp-evidence').innerHTML=evidence('Service configuration',value?.configured,value?.configured?'The Worker has an approved fixed origin and protected service credential.':'The private local-manager connection is not configured.')+
    evidence('Manager connection',value?.connected,value?.connected?'The local manager returned a valid status response.':'The PC, manager or private route may be unavailable. Controls remain disabled.')+
    evidence('Recorded client tests',entries.length?tested>0:null,entries.length?`${tested} of ${entries.length} inventory entries have recorded passing tests. These do not verify current browser sign-in.`:'No client test evidence has been returned.');
  $('#mcp-policy-fields').disabled=busy||!value?.connected||!status?.policyValid;
  if(!dirty&&status?.policy){$('#mcp-enabled').checked=status.policy.enabled;$('#mcp-readonly').checked=status.policy.readOnly;$('#mcp-inflight').value=String(status.policy.maxInflight);}
  $('#mcp-inflight-label').textContent=isShared?'Simultaneous tool calls across enrolled gateways':'Simultaneous tool calls per managed instance (legacy)';
  $('#mcp-policy-scope').textContent=isShared?'The shared limit applies across upgraded local clients and the remote bridge. It does not cap CPU use or detached background jobs.':'Shared coordination is not verified. This older status reports only per-instance limits; it does not establish a combined request cap.';
  $('#mcp-policy-state').textContent=dirty?'Unsaved edits. Background refresh is paused.':!value?.connected?'Policy is unavailable. Refresh status before sending or retrying a change.':!status?.policyValid?'Local policy is invalid. Repair it on the PC before making changes here.':`Current policy: ${status.policy.enabled?(isShared&&status.coordinator?.available!==true?'enabled, execution blocked until shared admission is verified':'accepting new calls'):'paused'}, ${status.policy.readOnly?'read-only tools':'write-capable tools'}, up to ${status.policy.maxInflight} concurrent call(s) ${isShared?'across enrolled gateways':'per instance (legacy)'}.`;
  $('#mcp-policy-state').classList.toggle('mcp-policy-dirty',dirty);
  $('#mcp-remote-status').innerHTML=remoteStatus(status?.remoteMcp);
  $('#mcp-coordinator').innerHTML=status?coordinatorStatus(status):'<p class="muted">Scheduler status is unknown while the manager is offline.</p>';
  $('#mcp-deployment').innerHTML=deploymentStatus(status);
  const resources=status?.resources,limits=status?.limits;
  $('#mcp-resources').innerHTML=status?`<dl class="mcp-metrics">${metric('Available / total RAM',memory(resources?.freeMemoryBytes)+' / '+memory(resources?.totalMemoryBytes))}${metric('Memory admission floor',memory(resources?.lowMemoryFloorBytes))}${metric('Manager resident memory',memory(resources?.managerResidentBytes))}${metric('Manager JavaScript heap used',memory(resources?.managerHeapUsedBytes))}${metric('Resource-gated tool admission',resources?.admissionOpen===true?'Open':resources?.admissionOpen===false?'Closed':'Unknown')}${metric('Installation disk free / total',memory(resources?.disk?.freeBytes)+' / '+memory(resources?.disk?.totalBytes))}${metric('Disk admission floor',memory(resources?.lowDiskFloorBytes))}${metric(isShared?'Shared queue capacity':'Queue capacity per instance (legacy)',amount(isShared?limits?.queueCapacityGlobal:limits?.queueCapacityPerInstance))}${metric('Detached jobs capped',bool(limits?.detachedJobsCapped))}</dl>${status.diagnosticCounts?.warnings?'<p class="notice">The local manager reported '+amount(status.diagnosticCounts.warnings)+' warning(s). Detailed diagnostics stay on the PC.</p>':''}`:'<p class="muted">Resources are unknown while the local manager is offline. No zero or healthy value has been assumed.</p>';
  $('#mcp-inventory').innerHTML=entries.length?`<table><thead><tr><th>Server / client</th><th>Route</th><th>Managed policy</th><th>Configured</th><th>Live evidence</th><th>Recorded test</th></tr></thead><tbody>${entries.map(item=>`<tr><td class="mcp-client-name"><strong>${esc(item.name||item.id)}</strong><span class="small">${esc(item.client)}</span></td><td>${esc(item.transport)}</td><td>${item.management==='managed'?'Managed local':item.management==='hosted'?'Hosted — own controls':'Unmanaged — own controls'}</td><td>${bool(item.configured)}</td><td>${item.management==='managed'&&item.connection==='connected'?'Active initialized heartbeat':esc(item.connection)}</td><td>${bool(item.tested)}</td></tr>`).join('')}</tbody></table><p class="small muted">Inventory captured ${esc(time(status.inventory.generatedAt))}. Hosted and unmanaged entries are informational, not controlled by this page.</p>`:'<p class="muted">No inventory evidence is available. This does not mean no other MCP servers exist.</p>';
  const instances=status?.instances||[],older=instances.filter(item=>item.state==='active'&&item.managerVersion!==status?.service?.version);
  $('#mcp-instances').innerHTML=(instances.length?`<table><thead><tr><th>Client</th><th>Heartbeat</th><th>Initialized</th><th>Manager version</th><th>Resident memory</th><th>In flight</th><th>Queued</th><th>Last seen</th></tr></thead><tbody>${instances.map(item=>`<tr><td class="mcp-client-name">${esc(item.client||item.id)}</td><td>${esc(item.state)}</td><td>${bool(item.initialized)}</td><td>${esc(item.managerVersion||'Unknown')}</td><td>${memory(item.residentBytes)}</td><td>${amount(item.inflight)}</td><td>${amount(item.queued)}</td><td>${esc(time(item.lastSeenAt))}</td></tr>`).join('')}</tbody></table>`:'<p class="muted">No managed instance heartbeats reported. Local clients normally start their MCP processes on demand.</p>')+
    (older.length?`<p class="notice">${older.length} active instance(s) report an older or unknown manager version. Their shared scheduling is not verified. Finish existing work, then reopen those client connections to load the current gateway.</p>`:'');
}
async function refresh(){if(busy)return;busy=true;$('#mcp-refresh').disabled=true;try{snapshot=await api('/status');csrf=snapshot.csrf;if(!snapshot.connected)notice(snapshot.configured?'Local manager is unavailable. Policy state could not be verified; check its PC service and private route before retrying.':'Private manager connection is not configured. Status is unavailable and controls are disabled.',true,'connection');else if(noticeKind==='connection'){$('#mcp-notice').classList.add('hidden');noticeKind=null;}}catch(error){snapshot=null;csrf=null;notice(error.message,true,'connection');}finally{busy=false;$('#mcp-refresh').disabled=false;render();}}
$('#mcp-refresh').addEventListener('click',()=>refresh());
$('#mcp-copy-endpoint').addEventListener('click',async()=>{const input=$('#mcp-endpoint');try{await navigator.clipboard.writeText(input.value);notice('Endpoint URL copied. Complete OAuth owner sign-in separately in each AI client.');}catch{input.focus();input.select();notice('Select and copy the endpoint URL, then complete owner sign-in separately in each AI client.');}});
$('#mcp-policy').addEventListener('change',()=>{dirty=true;$('#mcp-policy-state').textContent='Unsaved edits. Background refresh is paused.';$('#mcp-policy-state').classList.add('mcp-policy-dirty');});
$('#mcp-policy').addEventListener('submit',async event=>{event.preventDefault();if(busy||!csrf||!snapshot?.connected||!snapshot.status?.policyValid)return;
  const policy={enabled:$('#mcp-enabled').checked,readOnly:$('#mcp-readonly').checked,maxInflight:Number($('#mcp-inflight').value)};
  if(!policy.readOnly&&snapshot.status.policy.readOnly&&!confirm('Allow write-capable tools in managed local Desktop Commander clients? This can permit file changes and terminal commands within their existing local permissions. Hosted and unmanaged clients are unaffected.'))return;
  busy=true;$('#mcp-policy-fields').disabled=true;$('#mcp-refresh').disabled=true;
  try{await api('/policy',policy);dirty=false;notice('Policy verified by the local manager. It applies to new managed tool calls; running commands were not interrupted.');}
  catch(error){notice(error.message,true);dirty=false;}
  finally{busy=false;$('#mcp-refresh').disabled=false;await refresh();}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && !dirty)refresh();});
setInterval(()=>{if(!document.hidden && !dirty && !busy)refresh();},30000);
refresh();
