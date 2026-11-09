import {one} from './db.js';
import {normalizeEmail,verifyAccessJWT} from './security.js';
import {managerConfiguration} from './mcp.js';

const RESOURCE_METADATA='https://mcp.m-techlabs.com/.well-known/oauth-protected-resource';
const MAX_REQUEST_BYTES=1024*1024;
const MAX_RESPONSE_BYTES=8*1024*1024;
const REQUEST_BODY_TIMEOUT_MS=15000;
const TIMEOUT_MS=110000;
const ORIGINS=new Set(['https://mcp.m-techlabs.com','https://m-techlabs.com','https://www.m-techlabs.com','https://chatgpt.com','https://claude.ai']);
const VERSION=/^\d{4}-\d{2}-\d{2}$/;
const JSON_TYPE=/^application\/json(?:\s*;|$)/i;
const SAFE_RPC_METHOD=/^(?:initialize|notifications\/initialized|notifications\/cancelled|tools\/call|tools\/list|ping|resources\/list|resources\/read|prompts\/list|prompts\/get)$/;
const UNKNOWN_OUTCOME='The local MCP response could not be verified. The operation may still be running. Check its status before retrying; it was not automatically retried or killed.';

const failure=(status,message,headers={})=>Response.json({jsonrpc:'2.0',id:null,error:{code:-32020,message}},{status,headers:{'Cache-Control':'no-store',...headers}});
const unauthorized=()=>failure(401,'Sign in with the owner account through Cloudflare Access.',{
  'WWW-Authenticate':`Bearer resource_metadata="${RESOURCE_METADATA}", error="invalid_token"`,
});

class BodyError extends Error {}

async function discard(body) {
  if(body && !body.locked)await body.cancel().catch(()=>{});
}

// Both advertised and actual byte counts are bounded. A forged Content-Length
// cannot turn this endpoint into an unbounded buffer, even on chunked input.
async function boundedText(message,limit,signal) {
  const length=message.headers.get('Content-Length');
  if(length!==null && (!/^\d+$/.test(length) || Number(length)>limit)) {
    await discard(message.body);throw new BodyError('body_limit');
  }
  if(!message.body)return '';
  const reader=message.body.getReader(),chunks=[];let size=0,abort;
  const deadline=signal?new Promise((_,reject)=>{
    abort=()=>reject(new BodyError('deadline'));
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();
  }):null;
  try {
    while(true) {
      const part=await (deadline?Promise.race([reader.read(),deadline]):reader.read());if(part.done)break;
      size+=part.value.byteLength;
      if(size>limit)throw new BodyError('body_limit');
      chunks.push(part.value);
    }
  } catch(error) {
    await reader.cancel().catch(()=>{});throw error;
  } finally {if(abort)signal.removeEventListener('abort',abort);reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{throw new BodyError('invalid_utf8');}
}

function identityConfiguration(env) {
  if(!env.DB || typeof env.DB.prepare!=='function' || typeof env.MCP_ACCESS_AUD!=='string' ||
     !env.MCP_ACCESS_AUD || env.MCP_ACCESS_AUD.length>256 || /[\s,]/.test(env.MCP_ACCESS_AUD))return null;
  try {
    const email=normalizeEmail(env.OWNER_EMAIL);
    if(email!==env.OWNER_EMAIL)return null;
    if(typeof env.ACCESS_TEAM!=='string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM))return null;
    return {email,teamDomain:env.ACCESS_TEAM,audiences:[env.MCP_ACCESS_AUD]};
  } catch{return null;}
}

/**
 * Cloudflare Access owns OAuth/DCR/PKCE and injects the signed application JWT.
 * The OAuth bearer, cookies and identity headers never travel to the PC. This
 * adapter is deliberately owner-only and stateless; website grants cannot
 * delegate shell/filesystem access, and it creates no extra login mechanism.
 */
async function remoteMcpCore(request,env,_ctx,trace) {
  const url=new URL(request.url);
  if(url.origin!=='https://mcp.m-techlabs.com' || url.pathname!=='/mcp' || url.search)return failure(404,'Not found.');
  trace.phase='configuration';
  const config=managerConfiguration(env),identity=identityConfiguration(env);
  if(!config || !identity)return failure(503,'Remote MCP is not configured. No tool request was sent.');
  trace.phase='access-authentication';
  const assertion=request.headers.get('Cf-Access-Jwt-Assertion');
  if(!assertion)return unauthorized();
  let claims;
  try {claims=await verifyAccessJWT(assertion,identity);}
  catch{return unauthorized();}
  if(normalizeEmail(claims.email)!==identity.email)return failure(403,'Owner authorization is required.');
  trace.phase='owner-authorization';
  let user;
  try {user=await one(env.DB,'SELECT id,email,status,is_owner,revoke_before FROM users WHERE email=?',identity.email);}
  catch{return failure(503,'Owner authorization is temporarily unavailable. No tool request was sent.');}
  if(!user || user.email!==identity.email || user.status!=='approved' || user.is_owner!==1 ||
     !Number.isSafeInteger(user.revoke_before) || user.revoke_before<0 || claims.iat<=user.revoke_before) {
    return failure(403,'Owner authorization is required or this session was revoked.');
  }
  trace.phase='request-validation';
  const origin=request.headers.get('Origin');
  if(origin!==null && !ORIGINS.has(origin))return failure(403,'This request origin is not allowed.');
  if(request.method!=='POST')return failure(405,'This stateless MCP endpoint accepts POST only.',{Allow:'POST'});
  if(!JSON_TYPE.test(request.headers.get('Content-Type')||''))return failure(415,'Send an application/json MCP request.');
  const encoding=request.headers.get('Content-Encoding');
  if(encoding!==null && encoding.toLowerCase()!=='identity')return failure(415,'Compressed MCP request bodies are not accepted.');
  const accept=request.headers.get('Accept');
  if(accept && !/(?:^|,)\s*(?:application\/json|\*\/\*)(?:\s*;[^,]*)?\s*(?:,|$)/i.test(accept))return failure(406,'The client must accept application/json.');
  const version=request.headers.get('MCP-Protocol-Version');
  if(version!==null && !VERSION.test(version))return failure(400,'Invalid MCP protocol version.');
  let body;
  const inputController=new AbortController(),inputTimer=setTimeout(()=>inputController.abort(),REQUEST_BODY_TIMEOUT_MS);
  try {
    body=await boundedText(request,MAX_REQUEST_BYTES,inputController.signal);
    const message=JSON.parse(body);
    trace.rpcMethod=typeof message?.method==='string' && SAFE_RPC_METHOD.test(message.method) ? message.method : 'other';
    if(!message || typeof message!=='object' || Array.isArray(message) || message.jsonrpc!=='2.0') {
      return failure(400,'Send one JSON-RPC 2.0 message. No tool request was sent.');
    }
  } catch(error) {
    return failure(inputController.signal.aborted?408:error instanceof BodyError && error.message==='body_limit'?413:400,
      'Send one valid UTF-8 JSON-RPC message no larger than 1 MiB. No tool request was sent.');
  } finally {clearTimeout(inputTimer);}

  // Construct a new header set; never clone cookies, Access assertions, caller
  // Authorization, Origin, session IDs, forwarding headers or arbitrary URLs.
  const headers={Accept:'application/json, text/event-stream','Content-Type':'application/json',Authorization:`Bearer ${config.token}`};
  if(version!==null)headers['MCP-Protocol-Version']=version;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  trace.phase='origin-dispatch';
  try {
    const response=await fetch(config.origin+'/mcp',{
      method:'POST',headers,body,redirect:'manual',signal:controller.signal,
    });
    trace.originStatus=response.status;
    trace.phase='origin-response';
    if(response.status<200 || response.status>=300 && response.status<400 || [401,403].includes(response.status)) {
      await discard(response.body);return failure(502,UNKNOWN_OUTCOME);
    }
    // Notifications have no response body. No cookies/session headers are
    // forwarded, including on this branch, because the local bridge is stateless.
    if(response.status===202) {
      const empty=await boundedText(response,MAX_RESPONSE_BYTES,controller.signal);
      if(empty!=='')return failure(502,UNKNOWN_OUTCOME);
      return new Response(null,{status:202,headers:{'Cache-Control':'no-store'}});
    }
    if(!JSON_TYPE.test(response.headers.get('Content-Type')||'')) {
      await discard(response.body);return failure(502,UNKNOWN_OUTCOME);
    }
    const text=await boundedText(response,MAX_RESPONSE_BYTES,controller.signal);
    const message=JSON.parse(text);
    if(!message || typeof message!=='object' || Array.isArray(message) || message.jsonrpc!=='2.0' || text.includes(config.token)) {
      return failure(502,UNKNOWN_OUTCOME);
    }
    // Retain valid MCP tool/resource metadata and protocol errors, not arbitrary
    // origin HTTP headers. There is intentionally no automatic POST retry.
    return new Response(text,{status:response.status,headers:{
      'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    }});
  } catch {
    return failure(controller.signal.aborted?504:502,UNKNOWN_OUTCOME);
  } finally {clearTimeout(timer);}
}

// The edge generates its own correlation ID. Never log the Access assertion,
// OAuth bearer, tool arguments, file paths, response body, or raw error text.
function logMcpTrace(trace,status) {
  const entry={event:'mterm_mcp_request',requestId:trace.id,phase:trace.phase,rpcMethod:trace.rpcMethod,
    status,originStatus:trace.originStatus,durationMs:Math.max(0,Math.round(performance.now()-trace.startedAt))};
  (status>=500?console.error:console.log)(JSON.stringify(entry));
}

export async function remoteMcp(request,env,ctx) {
  const trace={id:crypto.randomUUID(),phase:'request-routing',rpcMethod:'unparsed',originStatus:null,startedAt:performance.now()};
  try {
    const response=await remoteMcpCore(request,env,ctx,trace);
    response.headers.set('X-MTech-MCP-Request-ID',trace.id);
    logMcpTrace(trace,response.status);
    return response;
  } catch(error) {
    logMcpTrace(trace,500);
    throw error;
  }
}
