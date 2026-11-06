import {one,rows,run,statement,nowSeconds,normalizeEmail,validRole} from './db.js';
import {HttpError,ownerIdentity,readSession,createSession,requireCsrf,ADMIN_COOKIE,sessionCookie} from './auth.js';
import {hashPassphrase} from './security.js';
import {acquireScan,executeScan,recomputeStatuses} from './codes.js';
import {MCP_MANAGEMENT_CATALOG} from './mcp-catalog.js';
import {HUB_CARDS,HUB_CARD_IDS,visibilityKey} from './hub-catalog.js';

const states=new Set(['pending','approved','denied','suspended','revoked']);
export async function jsonBody(request,max=16384) {
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new HttpError(415,'Send JSON.');
  if(Number(request.headers.get('Content-Length')||0)>max)throw new HttpError(413,'Request is too large.');
  const reader=request.body?.getReader(),chunks=[];let size=0;
  if(reader){try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();throw new HttpError(413,'Request is too large.');}chunks.push(part.value);}}finally{reader.releaseLock();}}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  const text=new TextDecoder().decode(bytes);
  try{return JSON.parse(text);}catch{throw new HttpError(400,'Invalid JSON.');}
}
const json=(data,status=200,headers={})=>Response.json(data,{status,headers});
const aStmt=(db,actor,action,target,detail={})=>statement(db,'INSERT INTO audit(at,actor,action,target,outcome,detail) VALUES(?,?,?,?,?,?)',nowSeconds(),actor,action,target,'allowed',JSON.stringify(detail));
async function subject(db,id) {
  const user=await one(db,'SELECT * FROM users WHERE id=?',id);
  if(!user)throw new HttpError(404,'User not found.');
  if(user.is_owner)throw new HttpError(403,'The recovery owner cannot be changed here.');
  return user;
}
async function grantApp(db,id,role) {
  const app=await one(db,'SELECT * FROM apps WHERE id=?',id);
  if(!app||!app.managed||app.access_mode==='external'||app.access_mode==='owner_only')throw new HttpError(400,'This application is inventoried but is not delegated through this dashboard.');
  if(!validRole(app,role))throw new HttpError(400,'That role is not supported by this application.');
  return app;
}

export async function adminApi(request,env,ctx,path) {
  const owner=await ownerIdentity(request,env),db=env.DB,now=nowSeconds();
  let session=await readSession(request,env,ADMIN_COOKIE),cookie;
  if(request.method==='GET'&&path==='/bootstrap') {
    if(!session||session.kind!=='owner'||session.user_id!==owner.user.id){
      const created=await createSession(env,{kind:'owner',user:owner.user});
      cookie=sessionCookie(ADMIN_COOKIE,created.token,created.age);
      session={csrf:created.csrf};
    }
    const [users,apps,grants,groups,members,groupGrants,defaults,events,sessions,guild,activity,settings,scans,homeVisibility]=await Promise.all([
      rows(db,'SELECT * FROM users ORDER BY is_owner DESC,created_at DESC'),rows(db,'SELECT * FROM apps ORDER BY name'),rows(db,'SELECT * FROM grants'),
      rows(db,'SELECT * FROM groups ORDER BY name'),rows(db,'SELECT * FROM group_members'),rows(db,'SELECT * FROM group_grants'),rows(db,'SELECT * FROM default_grants'),
      rows(db,'SELECT * FROM audit ORDER BY id DESC LIMIT 150'),rows(db,'SELECT id,kind,user_id,created_at,expires_at,last_seen,revoked_at FROM sessions WHERE expires_at>? ORDER BY created_at DESC LIMIT 100',now),
      one(db,'SELECT enabled,version,updated_at FROM guild_access WHERE id=1'),rows(db,'SELECT * FROM app_activity'),rows(db,"SELECT key,value FROM settings WHERE key IN ('google_idp_id','google_status','deployment_version')"),
      rows(db,'SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 10'),
      rows(db,"SELECT key,value FROM settings WHERE key LIKE 'hub_visible:%'")
    ]);
    return json({owner:owner.email,csrf:session.csrf,users,apps,management:[MCP_MANAGEMENT_CATALOG],grants,groups,members,groupGrants,defaults,events,sessions,guild,activity,settings,scans,homeCards:HUB_CARDS.map(({id,name,category,audience})=>({id,name,category,audience})),homeHidden:homeVisibility.filter(x=>x.value==='0').map(x=>x.key.slice('hub_visible:'.length)),
      google:{configured:settings.some(x=>x.key==='google_idp_id'&&x.value),callback:`https://${env.ACCESS_TEAM}/cdn-cgi/access/callback`,setupUrl:'https://one.dash.cloudflare.com/'+env.ACCOUNT_ID+'/settings/authentication',requires:'Google OAuth client ID and client secret; keep the Cloudflare owner provider enabled.'},serverTime:now},200,cookie?{'Set-Cookie':cookie}:{});
  }
  if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
  if(!session||session.kind!=='owner'||session.user_id!==owner.user.id)throw new HttpError(401,'Refresh the owner dashboard.');
  await requireCsrf(request,session);
  const body=await jsonBody(request),actor=owner.email;
  if(path==='/homepage') {
    if(typeof body.id!=='string'||!HUB_CARD_IDS.has(body.id)||typeof body.visible!=='boolean')throw new HttpError(400,'Choose a registered homepage card and a visibility setting.');
    await db.batch([
      statement(db,'INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',visibilityKey(body.id),body.visible?'1':'0',now),
      aStmt(db,actor,'homepage.visibility',body.id,{visible:body.visible})
    ]);
    return json({ok:true,message:body.visible?'App is now shown on the homepage for eligible viewers.':'App is now hidden from the homepage. Direct access rules are unchanged.'});
  }
  if(path==='/users') {
    let email;try{email=normalizeEmail(body.email);}catch(e){throw new HttpError(400,e.message);}
    if(email===env.OWNER_EMAIL)throw new HttpError(403,'The recovery owner is already registered.');
    if(await one(db,'SELECT id FROM users WHERE email=?',email))throw new HttpError(409,'This account is already registered.');
    const status=body.status==='approved'?'approved':'pending',id=crypto.randomUUID(),displayName=String(body.displayName||'').slice(0,80);
    const defaults=body.applyDefaults?await rows(db,'SELECT d.* FROM default_grants d JOIN apps a ON a.id=d.app_id WHERE a.managed=1'):[];
    await db.batch([
      statement(db,'INSERT INTO users(id,email,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?)',id,email,displayName,status,now,now),
      ...defaults.map(x=>statement(db,'INSERT INTO grants(user_id,app_id,role,updated_at) VALUES(?,?,?,?)',id,x.app_id,x.role,now)),
      aStmt(db,actor,'user.invite',email,{status,defaultsApplied:!!body.applyDefaults})
    ]);
    return json({ok:true,id,message:'Account saved. Application access remains separately controlled; no email was sent.'});
  }
  if(path==='/users/status') {
    const user=await subject(db,body.userId);
    if(!states.has(body.status))throw new HttpError(400,'Unknown account status.');
    await db.batch([
      statement(db,'UPDATE users SET status=?,session_version=session_version+1,revoke_before=?,updated_at=? WHERE id=?',body.status,now,now,user.id),
      statement(db,'UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',now,user.id),
      aStmt(db,actor,'user.status',user.email,{status:body.status})
    ]);
    return json({ok:true});
  }
  if(path==='/grants') {
    const user=await subject(db,body.userId);await grantApp(db,body.appId,body.role);
    await db.batch([
      statement(db,'INSERT INTO grants(user_id,app_id,role,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,app_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at',user.id,body.appId,body.role,now),
      aStmt(db,actor,'permission.change',user.email,{app:body.appId,role:body.role})
    ]);
    return json({ok:true,message:'Permission saved. The next request uses this decision.'});
  }
  if(path==='/defaults') {
    await grantApp(db,body.appId,body.role);
    await db.batch([statement(db,'INSERT INTO default_grants(app_id,role) VALUES(?,?) ON CONFLICT(app_id) DO UPDATE SET role=excluded.role',body.appId,body.role),aStmt(db,actor,'default.change',body.appId,{role:body.role})]);return json({ok:true});
  }
  if(path==='/groups') {
    const name=String(body.name||'').trim().slice(0,80);if(!name)throw new HttpError(400,'Group name is required.');
    const id=crypto.randomUUID();await db.batch([statement(db,'INSERT INTO groups(id,name,description,created_at) VALUES(?,?,?,?)',id,name,String(body.description||'').slice(0,200),now),aStmt(db,actor,'group.create',name)]);return json({ok:true,id});
  }
  if(path==='/groups/member') {
    const user=await subject(db,body.userId);if(!await one(db,'SELECT id FROM groups WHERE id=?',body.groupId))throw new HttpError(404,'Group not found.');
    await db.batch([body.remove?statement(db,'DELETE FROM group_members WHERE group_id=? AND user_id=?',body.groupId,user.id):statement(db,'INSERT OR IGNORE INTO group_members(group_id,user_id) VALUES(?,?)',body.groupId,user.id),aStmt(db,actor,body.remove?'group.remove_member':'group.add_member',user.email,{group:body.groupId})]);return json({ok:true});
  }
  if(path==='/groups/grant') {
    await grantApp(db,body.appId,body.role);if(!await one(db,'SELECT id FROM groups WHERE id=?',body.groupId))throw new HttpError(404,'Group not found.');
    await db.batch([statement(db,'INSERT INTO group_grants(group_id,app_id,role,updated_at) VALUES(?,?,?,?) ON CONFLICT(group_id,app_id) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at',body.groupId,body.appId,body.role,now),aStmt(db,actor,'group.permission',body.groupId,{app:body.appId,role:body.role})]);return json({ok:true});
  }
  if(path==='/sessions/revoke') {
    const user=await subject(db,body.userId);
    await db.batch([
      statement(db,'UPDATE users SET session_version=session_version+1,revoke_before=?,updated_at=? WHERE id=?',now,now,user.id),
      statement(db,'UPDATE sessions SET revoked_at=? WHERE user_id=?',now,user.id),aStmt(db,actor,'sessions.revoke',user.email)
    ]);return json({ok:true,message:'Application sessions revoked. Existing Cloudflare tokens are denied by the gateway until the user signs in again. An already-open legacy WebSocket may require termination in that application.'});
  }
  if(path==='/guild') {
    const guild=await one(db,'SELECT * FROM guild_access WHERE id=1');
    if(body.enabled!==false&&body.enabled!==true)throw new HttpError(400,'Choose whether guild access is enabled.');
    let hash=guild.password_hash;
    if(body.passphrase){if(typeof body.passphrase!=='string'||body.passphrase.length<16||body.passphrase.length>256)throw new HttpError(400,'Use a unique guild passphrase of 16 to 256 characters.');hash=await hashPassphrase(body.passphrase);}
    if(body.enabled&&!hash)throw new HttpError(400,'Set a guild passphrase first.');
    await db.batch([
      statement(db,'UPDATE guild_access SET enabled=?,password_hash=?,version=version+1,updated_at=? WHERE id=1',body.enabled?1:0,hash,now),
      statement(db,"UPDATE sessions SET revoked_at=? WHERE kind='guild'",now),aStmt(db,actor,'guild.rotate','guild',{enabled:body.enabled})
    ]);return json({ok:true,message:'Guild access updated. All older guild sessions have been revoked.'});
  }
  if(path==='/codes/manual') {
    const code=String(body.code||'').trim().toUpperCase();if(!/^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(code))throw new HttpError(400,'Enter a valid redemption code.');
    const rewards=String(body.rewards||'').trim().slice(0,500)||null;
    let source;try{source=new URL(body.sourceUrl);if(source.protocol!=='https:')throw 0;}catch{throw new HttpError(400,'Include the HTTPS URL where this was announced.');}
    await db.batch([
      statement(db,'INSERT INTO codes(code,rewards,first_seen,last_seen,last_changed) VALUES(?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET rewards=COALESCE(excluded.rewards,codes.rewards),last_seen=excluded.last_seen',code,rewards,now,now,now),
      statement(db,`INSERT INTO code_evidence(code,source_id,source_url,source_domain,source_status,rewards,observed_at) VALUES(?,'manual',?,?,'unknown',?,?)
        ON CONFLICT(code,source_id) DO UPDATE SET source_url=excluded.source_url,rewards=excluded.rewards,observed_at=excluded.observed_at`,code,source.href,source.hostname,rewards,now),
      aStmt(db,actor,'code.submit',code)
    ]);await recomputeStatuses(db,now);return json({ok:true});
  }
  if(path==='/scan') {
    const lease=await acquireScan(db,'owner',now);if(lease.acquired)ctx.waitUntil(executeScan(env,lease).catch(()=>{}));
    return json({ok:true,started:lease.acquired,scan:lease.state},lease.acquired?202:200);
  }
  throw new HttpError(404,'Unknown dashboard action.');
}
