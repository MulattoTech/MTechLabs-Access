import {one,rows,run,rateLimit,audit,permission,normalizeEmail,nowSeconds} from './db.js';
import {verifyPassphrase,sha256,sameOrigin,externalEvaluation,evaluationPublicKeys} from './security.js';
import {HttpError,ownerIdentity,accessIdentity,createSession,codeIdentity,requireCsrf,sessionCookie,CODE_COOKIE,cookieValue,gateway} from './auth.js';
import {adminApi,jsonBody} from './admin.js';
import {homepageApi} from './homepage.js';
import {mcpApi} from './mcp.js';
import {remoteMcp} from './mcp-remote.js';
import {acquireScan,executeScan,codeList,recomputeStatuses} from './codes.js';
import {PUBLIC_HTML,ADMIN_HTML,PUBLIC_JS,ADMIN_JS,CSS,MCP_HTML,MCP_JS,MCP_CSS} from './ui.generated.js';

const json=(body,status=200,headers={})=>Response.json(body,{status,headers});
const asset=(text,type)=>new Response(text,{headers:{'Content-Type':type}});
const has=(x,key)=>Object.prototype.hasOwnProperty.call(x,key);

async function abuseLimit(request,env,scope,limit=20,period=900) {
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const key=scope+':'+await sha256(ip);
  const state=await rateLimit(env.DB,key,limit,period);
  if(!state.allowed)throw new HttpError(429,`Too many attempts. Try again after ${new Date(state.resetAt*1000).toISOString()}.`);
}
async function handle(request,env,ctx) {
  const url=new URL(request.url),path=url.pathname,db=env.DB;
  // The dedicated MCP host has its own Access audience and owner check. It
  // never enters the website's D1 application-grant or legacy-gateway paths.
  if(url.hostname==='mcp.m-techlabs.com')return remoteMcp(request,env,ctx);
  const isCodes=url.hostname===env.CODE_HOST;
  const isHub=[env.HUB_HOST,`www.${env.HUB_HOST}`].includes(url.hostname);
  if(!isCodes&&!isHub){
    const app=await one(db,'SELECT * FROM apps WHERE hostname=?',url.hostname);
    if(!app?.managed||app.access_mode!=='gate')throw new HttpError(404,'Not found.');
    return gateway(request,env,ctx,app);
  }
  if(isHub) {
    if(path.startsWith('/admin/mcp/api/'))return mcpApi(request,env,ctx,path.slice('/admin/mcp/api'.length));
    const mcpAssets={
      '/admin/mcp':[MCP_HTML,'text/html; charset=utf-8'],
      '/admin/mcp/':[MCP_HTML,'text/html; charset=utf-8'],
      '/admin/mcp/assets/mcp.js':[MCP_JS,'application/javascript; charset=utf-8'],
      '/admin/mcp/assets/mcp.css':[MCP_CSS,'text/css; charset=utf-8'],
      '/admin/mcp/assets/style.css':[CSS,'text/css; charset=utf-8'],
    };
    if(Object.hasOwn(mcpAssets,path)) {
      if(request.method!=='GET')throw new HttpError(405,'Method not allowed.');
      await ownerIdentity(request,env);return asset(...mcpAssets[path]);
    }
    if(path==='/admin/access/api/homepage'&&request.method==='GET')return homepageApi(request,env);
    if(path.startsWith('/admin/access/api/'))return adminApi(request,env,ctx,path.slice('/admin/access/api'.length));
    if(path==='/admin/access/assets/admin.js') {await ownerIdentity(request,env);return asset(ADMIN_JS,'application/javascript; charset=utf-8');}
    if(path==='/admin/access/assets/style.css') {await ownerIdentity(request,env);return asset(CSS,'text/css; charset=utf-8');}
    if(path==='/admin/access'||path==='/admin/access/'){await ownerIdentity(request,env);return asset(ADMIN_HTML,'text/html; charset=utf-8');}
    if(path==='/'||path==='/__access-gateway-check.txt')return gateway(request,env,ctx,await one(db,'SELECT * FROM apps WHERE hostname=?',url.hostname));
    throw new HttpError(404,'Not found.');
  }
  if(path==='/health'&&request.method==='GET')return json({ok:true,service:'mtechlabs-access-codes',version:'1.0.0',aiInference:false});
  if(path==='/.well-known/access-evaluation-keys'&&request.method==='GET')return json(await evaluationPublicKeys(env));
  if(path.startsWith('/__access/evaluate/')) {
    const appId=path.slice('/__access/evaluate/'.length);
    if(!/^[a-z][a-z0-9_-]{1,63}$/.test(appId))throw new HttpError(404,'Not found.');
    return externalEvaluation(request,env,async({email})=>{
      const decision=await permission(db,email,appId);
      await audit(db,email,'access.evaluate',appId,decision.allowed?'allowed':'denied',{},appId);
      return decision.allowed;
    });
  }
  if(path==='/assets/app.js'&&request.method==='GET')return asset(PUBLIC_JS,'application/javascript; charset=utf-8');
  if(path==='/assets/style.css'&&request.method==='GET')return asset(CSS,'text/css; charset=utf-8');
  if(path==='/'&&request.method==='GET')return asset(PUBLIC_HTML,'text/html; charset=utf-8');
  if(path==='/auth/access'&&request.method==='GET') {
    const app=await one(db,"SELECT * FROM apps WHERE id='codes'");
    const identity=await accessIdentity(request,env,app),grant=await permission(db,identity.email,'codes');
    if(!grant.allowed)throw new HttpError(403,'This account has not been approved for the Code Bot.');
    if(grant.user.revoke_before&&Number(identity.claims.iat)<=grant.user.revoke_before)throw new HttpError(403,'Your previous session was revoked. Sign out of Cloudflare Access and sign in again.');
    const created=await createSession(env,{kind:grant.user.is_owner?'owner':'google',user:grant.user});
    await audit(db,identity.email,'login.success','codes','allowed',{},'codes');
    return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':sessionCookie(CODE_COOKIE,created.token,created.age)}});
  }
  if(path==='/api/session'&&request.method==='GET') {
    let identity;try{identity=await codeIdentity(request,env);}catch{}
    const [guild,google]=await Promise.all([one(db,'SELECT enabled FROM guild_access WHERE id=1'),one(db,"SELECT value FROM settings WHERE key='google_idp_id'")]);
    return json({authenticated:!!identity,kind:identity?.kind||null,email:identity?.user?.email||null,role:identity?.role||null,csrf:identity?.csrf||null,guildEnabled:!!guild?.enabled,googleConfigured:!!google?.value,ownerUrl:`https://${env.HUB_HOST}/admin/access`});
  }
  if(path==='/api/guild-login'&&request.method==='POST') {
    if(!sameOrigin(request))throw new HttpError(403,'Open this website to sign in.');
    await abuseLimit(request,env,'guild-login',8,900);
    const global=await rateLimit(db,'guild-login:global',120,3600);if(!global.allowed)throw new HttpError(429,'Guild sign-in is temporarily rate-limited.');
    const body=await jsonBody(request,1024),guild=await one(db,'SELECT * FROM guild_access WHERE id=1');
    if(!guild?.enabled||typeof body.passphrase!=='string'||body.passphrase.length>256||!await verifyPassphrase(body.passphrase,guild.password_hash)){
      await audit(db,'anonymous','guild.login','codes','denied');throw new HttpError(401,'The guild passphrase is unavailable or incorrect.');
    }
    const created=await createSession(env,{kind:'guild',guildVersion:guild.version});
    await audit(db,`guild:${created.id}`,'guild.login','codes');
    return json({ok:true,csrf:created.csrf},200,{'Set-Cookie':sessionCookie(CODE_COOKIE,created.token,created.age)});
  }
  if(path==='/api/request-access'&&request.method==='POST') {
    if(!sameOrigin(request))throw new HttpError(403,'Open this website to request access.');
    await abuseLimit(request,env,'request-access',3,3600);
    const body=await jsonBody(request,1024);let email;try{email=normalizeEmail(body.email);}catch{throw new HttpError(400,'Enter one valid Google email address.');}
    if(!body.website){
      const now=nowSeconds();
      await run(db,"INSERT OR IGNORE INTO users(id,email,display_name,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?)",crypto.randomUUID(),email,String(body.displayName||'').slice(0,80),now,now);
      await audit(db,'anonymous','access.request',email,'pending',{identityVerified:false});
    }
    return json({ok:true,message:'Request recorded for owner review. This does not grant access or verify ownership of that email.'});
  }
  if(path.startsWith('/api/')) {
    const identity=await codeIdentity(request,env);
    if(path==='/api/codes'&&request.method==='GET')return json(await codeList(db,identity.subject));
    if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
    await requireCsrf(request,identity);await abuseLimit(request,env,'member-action',60,900);
    const body=await jsonBody(request,2048);
    if(path==='/api/logout'){
      await run(db,'UPDATE sessions SET revoked_at=? WHERE id=?',nowSeconds(),identity.id);
      return json({ok:true},200,{'Set-Cookie':sessionCookie(CODE_COOKIE,'',0)});
    }
    if(path==='/api/refresh'){
      const personal=await rateLimit(db,'refresh:'+identity.subject,5,900);if(!personal.allowed)throw new HttpError(429,'Refresh requests are limited. Your cached code list is still available.');
      const lease=await acquireScan(db,'manual');if(lease.acquired)ctx.waitUntil(executeScan(env,lease).catch(()=>{}));
      return json({started:lease.acquired,scan:lease.state,message:lease.acquired?'A shared scan has started.':'Showing cached data. The global refresh cooldown is active.'},lease.acquired?202:200);
    }
    if(path==='/api/redeemed'||path==='/api/report'){
      const code=String(body.code||'').trim().toUpperCase();if(!await one(db,'SELECT code FROM codes WHERE code=?',code))throw new HttpError(404,'Code not found.');
      if(path==='/api/redeemed'){
        if(body.redeemed===false)await run(db,'DELETE FROM redemptions WHERE subject=? AND code=?',identity.subject,code);
        else await run(db,'INSERT INTO redemptions(subject,code,redeemed_at) VALUES(?,?,?) ON CONFLICT(subject,code) DO UPDATE SET redeemed_at=excluded.redeemed_at',identity.subject,code,nowSeconds());
        return json({ok:true});
      }
      if(identity.kind==='guild')throw new HttpError(403,'Use an individually approved Google account to submit a public redemption report.');
      if(!['guild_member','editor','operator','administrator','owner'].includes(identity.role))throw new HttpError(403,'Your Code Watch role cannot submit public redemption reports. You can still use your personal checklist.');
      if(!['working','failed'].includes(body.outcome))throw new HttpError(400,'Choose working or failed.');
      await run(db,'INSERT INTO reports(user_id,code,outcome,note,reported_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,code) DO UPDATE SET outcome=excluded.outcome,note=excluded.note,reported_at=excluded.reported_at',identity.user.id,code,body.outcome,String(body.note||'').slice(0,240),nowSeconds());
      await recomputeStatuses(db);return json({ok:true,message:'Player report recorded separately from your redeemed checklist.'});
    }
    throw new HttpError(404,'Unknown action.');
  }
  throw new HttpError(404,'Not found.');
}

export function secureResponse(response) {
  if(response.status===101)return response;
  const headers=new Headers(response.headers);
  headers.set('Cache-Control','no-store');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  headers.set('X-Frame-Options','DENY');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export default {
  async fetch(request,env,ctx) {
    try {
      const response=await handle(request,env,ctx);
      // Do not replace legacy applications' own CSP; their gate adds only no-store.
      if(response.headers.get('X-MTechLabs-Authorization')==='enforced'||response.status===101)return response;
      return secureResponse(response);
    }catch(error){
      const status=error instanceof HttpError?error.status:500;
      if(status===500)console.error('Request failed',error?.name||'Error');
      return secureResponse(json({error:status===500?'The service is temporarily unavailable. Please try again.':error.message},status));
    }
  },
  async scheduled(controller,env,ctx) {
    const lease=await acquireScan(env.DB,'scheduled');
    if(lease.acquired)ctx.waitUntil(executeScan(env,lease));
  }
};
