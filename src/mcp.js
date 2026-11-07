import {audit,nowSeconds} from './db.js';
import {HttpError,ownerIdentity,readSession,createSession,requireCsrf,ADMIN_COOKIE,sessionCookie} from './auth.js';
import {jsonBody} from './admin.js';

const MANAGER_ORIGIN = 'https://mcp-origin.m-techlabs.com';
const MAX_RESPONSE_BYTES = 65536;
const TIMEOUT_MS = 6000;
const json = (body,status=200,headers={}) => Response.json(body,{status,headers});
const object = value => !!value && typeof value==='object' && !Array.isArray(value);
const bool = value => typeof value==='boolean' ? value : null;
const count = value => Number.isSafeInteger(value) && value>=0 ? value : null;
const text = (value,max=100) => typeof value==='string' ? value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max) : '';
const choice = (value,allowed,fallback='unknown') => allowed.includes(value) ? value : fallback;
const date = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function managerConfiguration(env) {
  if(env.MCP_MANAGER_ORIGIN!==MANAGER_ORIGIN || typeof env.MCP_MANAGER_TOKEN!=='string' ||
     env.MCP_MANAGER_TOKEN.length<32 || env.MCP_MANAGER_TOKEN.length>512 || /[\r\n]/.test(env.MCP_MANAGER_TOKEN)) return null;
  return {origin:MANAGER_ORIGIN,token:env.MCP_MANAGER_TOKEN};
}

export function validatePolicy(value) {
  if(!object(value) || Object.keys(value).length!==3 ||
     !['enabled','readOnly','maxInflight'].every(key=>Object.hasOwn(value,key)) ||
     typeof value.enabled!=='boolean' || typeof value.readOnly!=='boolean' ||
     !Number.isInteger(value.maxInflight) || value.maxInflight<1 || value.maxInflight>64) {
    throw new HttpError(400,'Use only enabled, readOnly and maxInflight (1..64).');
  }
  return {enabled:value.enabled,readOnly:value.readOnly,maxInflight:value.maxInflight};
}

function projectedPolicy(value) {
  try{return validatePolicy(value);}catch{return null;}
}

// Project only the public status contract. Never relay raw upstream JSON,
// request headers, URLs, credentials, local paths or arbitrary command output.
export function projectManagerStatus(value) {
  if(!object(value) || value.schemaVersion!==1 || !object(value.service) || value.service.state!=='running') {
    throw new Error('invalid_manager_status');
  }
  const runtime=object(value.runtime)?value.runtime:{},resources=object(value.resources)?value.resources:{};
  const limits=object(value.limits)?value.limits:{},inventory=object(value.inventory)?value.inventory:{};
  const remote=object(value.remoteMcp)?value.remoteMcp:null;
  const coordinator=object(value.coordinator)?value.coordinator:null;
  const coordinatorAvailable=coordinator?.available===true&&coordinator.scope==='shared-state-directory';
  const deployment=object(value.deployment)&&value.deployment.evidence==='installation-record'?value.deployment:null;
  const policy=projectedPolicy(value.policy);
  const version=value=>typeof value==='string' && /^v?\d[0-9A-Za-z.+-]{0,63}$/.test(value)?value:null;
  return {
    schemaVersion:1,
    service:{name:'MTerm-CLI Manager',version:version(value.service.version),state:'running',uptimeSeconds:count(value.service.uptimeSeconds)},
    policy,policyValid:value.policyValid===true && policy!==null,
    runtime:{nodeVersion:version(runtime.nodeVersion),packageVersion:version(runtime.packageVersion),installed:bool(runtime.installed)},
    deployment:deployment?{
      sourceCommit:typeof deployment.sourceCommit==='string'&&/^[a-f0-9]{40}$/.test(deployment.sourceCommit)?deployment.sourceCommit:null,
      installedAt:date(deployment.installedAt),
      workerVersion:typeof deployment.workerVersion==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(deployment.workerVersion)?deployment.workerVersion:null,
      evidence:'installation-record',
    }:null,
    resources:{freeMemoryBytes:count(resources.freeMemoryBytes),totalMemoryBytes:count(resources.totalMemoryBytes),
      lowMemoryFloorBytes:count(resources.lowMemoryFloorBytes),admissionOpen:bool(resources.admissionOpen),
      lowDiskFloorBytes:count(resources.lowDiskFloorBytes),managerResidentBytes:count(resources.managerResidentBytes),managerHeapUsedBytes:count(resources.managerHeapUsedBytes),
      disk:object(resources.disk)?{freeBytes:count(resources.disk.freeBytes),totalBytes:count(resources.disk.totalBytes)}:null},
    limits:{scope:choice(limits.scope,['shared-state-directory']),
      maxInflightGlobal:limits.scope==='shared-state-directory'&&Number.isInteger(limits.maxInflightGlobal)&&limits.maxInflightGlobal>=1&&limits.maxInflightGlobal<=64?limits.maxInflightGlobal:null,
      queueCapacityGlobal:limits.scope==='shared-state-directory'?count(limits.queueCapacityGlobal):null,
      maxInflightPerInstance:Number.isInteger(limits.maxInflightPerInstance)&&limits.maxInflightPerInstance>=1&&limits.maxInflightPerInstance<=64?limits.maxInflightPerInstance:null,
      queueCapacityPerInstance:count(limits.queueCapacityPerInstance),detachedJobsCapped:bool(limits.detachedJobsCapped)},
    coordinator:coordinator?{
      available:bool(coordinator.available),scope:choice(coordinator.scope,['shared-state-directory']),
      inflight:coordinatorAvailable?count(coordinator.inflight):null,queued:coordinatorAvailable?count(coordinator.queued):null,
      uncertain:coordinatorAvailable?count(coordinator.uncertain):null,queueCapacity:count(coordinator.queueCapacity),
      clients:(coordinatorAvailable&&Array.isArray(coordinator.clients)?coordinator.clients:[]).slice(0,64).filter(object).map(item=>({
        client:typeof item.client==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(item.client)?item.client:'unknown',inflight:count(item.inflight),queued:count(item.queued),uncertain:count(item.uncertain),
      })),
      recentEvents:(coordinatorAvailable&&Array.isArray(coordinator.recentEvents)?coordinator.recentEvents:[]).slice(0,100).filter(item=>object(item)&&['queued','admitted','completed','cancelled','expired','rejected','uncertain','orphaned','reconciled'].includes(item.type)).map(item=>({
        time:date(item.time),type:item.type,
        client:typeof item.client==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(item.client)?item.client:'unknown',
        toolName:typeof item.toolName==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(item.toolName)?item.toolName:null,
      })),
    }:null,
    instances:(Array.isArray(value.instances)?value.instances:[]).slice(0,64).filter(object).map(item=>({
      id:text(item.id,80),client:text(item.client,80),state:choice(item.state,['active','stale']),
      startedAt:date(item.startedAt),lastSeenAt:date(item.lastSeenAt),inflight:count(item.inflight),queued:count(item.queued),initialized:bool(item.initialized),
      managerVersion:version(item.managerVersion),residentBytes:count(item.residentBytes),
    })),
    inventory:{generatedAt:date(inventory.generatedAt),entries:(Array.isArray(inventory.entries)?inventory.entries:[]).slice(0,100).filter(object).map(item=>({
      id:text(item.id,80),name:text(item.name,100),client:text(item.client,80),transport:choice(item.transport,['stdio','http','unknown']),
      management:choice(item.management,['managed','hosted','unmanaged'],'unmanaged'),configured:bool(item.configured),
      connection:choice(item.connection,['unknown','connected','disconnected']),tested:bool(item.tested),
    }))},
    // Origin observations are not evidence of a particular browser OAuth login.
    remoteMcp:remote?{
      transport:choice(remote.transport,['streamable-http']),endpoint:remote.endpoint==='/mcp'?'/mcp':null,
      state:choice(remote.state,['idle','starting','ready','closing','unavailable','stopped']),
      sdkLoaded:bool(remote.sdkLoaded),sharedBackend:bool(remote.sharedBackend),
      activeHttpRequests:count(remote.activeHttpRequests),maxHttpRequests:count(remote.maxHttpRequests),activeUpstreamRequests:count(remote.activeUpstreamRequests),
      idleTimeoutSeconds:count(remote.idleTimeoutSeconds),idleTeardownDeferred:bool(remote.idleTeardownDeferred),
      lastToolListCount:count(remote.lastToolListCount),lastSuccessfulRequestAt:date(remote.lastSuccessfulRequestAt),
      lastSuccessfulToolAt:date(remote.lastSuccessfulToolAt),clientIdentityTracked:false,
      resourceSupport:bool(remote.resourceSupport),promptSupport:bool(remote.promptSupport),
      observedClients:(Array.isArray(remote.observedClients)?remote.observedClients:[]).slice(0,8).filter(item=>object(item)&&item.evidence==='protocol-initialize'&&typeof item.name==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9 _.@()-]{0,79}$/.test(item.name)).map(item=>({
        name:item.name,version:typeof item.version==='string'&&/^[a-zA-Z0-9_.+-]{1,40}$/.test(item.version)?item.version:null,
        lastInitializedAt:date(item.lastInitializedAt),evidence:'protocol-initialize',
      })),
    }:null,
    // Diagnostic text may contain paths/command arguments. Keep counts only;
    // detailed diagnostics remain on the owner's PC.
    diagnosticCounts:{boundaries:Array.isArray(value.boundaries)?Math.min(value.boundaries.length,100):0,
      warnings:Array.isArray(value.warnings)?Math.min(value.warnings.length,100):0},
  };
}

async function boundedJson(response) {
  if(!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type')||''))throw new Error('manager_unavailable');
  const length=response.headers.get('Content-Length');
  if(length!==null && (!/^\d+$/.test(length) || Number(length)>MAX_RESPONSE_BYTES))throw new Error('manager_response_too_large');
  if(!response.body)throw new Error('manager_empty_response');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    while(true) {
      const part=await reader.read();if(part.done)break;
      size+=part.value.byteLength;
      if(size>MAX_RESPONSE_BYTES){await reader.cancel();throw new Error('manager_response_too_large');}
      chunks.push(part.value);
    }
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function managerRequest(config,path,policy,fetcher=fetch) {
  if(!['/v1/status','/v1/policy'].includes(path) || (path==='/v1/status')!==(policy===undefined))throw new Error('unsupported_manager_route');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  try {
    const headers={Accept:'application/json',Authorization:`Bearer ${config.token}`};
    if(policy!==undefined)headers['Content-Type']='application/json';
    const response=await fetcher(config.origin+path,{
      method:policy===undefined?'GET':'POST',headers,redirect:'manual',signal:controller.signal,
      ...(policy===undefined?{}:{body:JSON.stringify(policy)}),
    });
    // In particular, never follow redirects with the service credential.
    return await boundedJson(response);
  } finally {clearTimeout(timer);}
}

export async function mcpApi(request,env,ctx,path) {
  const owner=await ownerIdentity(request,env);
  if(!['/status','/policy'].includes(path))throw new HttpError(404,'Unknown MCP management action.');
  if((path==='/status' && request.method!=='GET') || (path==='/policy' && request.method!=='POST'))throw new HttpError(405,'Method not allowed.');
  let session=await readSession(request,env,ADMIN_COOKIE),cookie;
  if(path==='/status') {
    if(!session || session.kind!=='owner' || session.user_id!==owner.user.id) {
      const created=await createSession(env,{kind:'owner',user:owner.user});
      cookie=sessionCookie(ADMIN_COOKIE,created.token,created.age);session={csrf:created.csrf};
    }
    const config=managerConfiguration(env),base={owner:owner.email,csrf:session.csrf,configured:!!config,connected:false,observedAt:new Date().toISOString()};
    if(!config)return json({...base,status:null,reason:'not_configured'},200,cookie?{'Set-Cookie':cookie}:{});
    try {
      const status=projectManagerStatus(await managerRequest(config,'/v1/status'));
      // Treat an accidental credential echo in even an allowlisted label as an
      // invalid response instead of sending that credential to the browser.
      if(JSON.stringify(status).includes(config.token))throw new Error('invalid_manager_status');
      return json({...base,connected:true,status,reason:null},200,cookie?{'Set-Cookie':cookie}:{});
    } catch {
      return json({...base,status:null,reason:'manager_unavailable'},200,cookie?{'Set-Cookie':cookie}:{});
    }
  }
  if(!session || session.kind!=='owner' || session.user_id!==owner.user.id)throw new HttpError(401,'Refresh the MCP manager before changing policy.');
  await requireCsrf(request,session);
  const policy=validatePolicy(await jsonBody(request,1024)),config=managerConfiguration(env);
  if(!config)throw new HttpError(503,'The local manager connection is not configured. No policy change was sent.');
  // A failed request is never automatically retried: a lost response could hide
  // an applied change. Re-read status before a deliberate retry.
  await audit(env.DB,owner.email,'mcp.policy.request','mcp-manager','requested',policy);
  let result;
  try {
    result=await managerRequest(config,'/v1/policy',policy);
    const applied=projectedPolicy(result?.policy);
    if(!object(result) || result.ok!==true || !applied ||
       applied.enabled!==policy.enabled || applied.readOnly!==policy.readOnly || applied.maxInflight!==policy.maxInflight ||
       result.appliesTo!=='new_tool_calls' || result.runningCommandsInterrupted!==false)throw new Error('unverified_policy_result');
  } catch {
    await audit(env.DB,owner.email,'mcp.policy.result','mcp-manager','unverified',{verificationRequired:true});
    throw new HttpError(502,'The policy result could not be verified. Refresh status before retrying; a lost response may hide an applied change.');
  }
  await audit(env.DB,owner.email,'mcp.policy.result','mcp-manager','allowed',policy);
  return json({ok:true,policy,appliesTo:'new_tool_calls',runningCommandsInterrupted:false,verifiedAt:nowSeconds()});
}
