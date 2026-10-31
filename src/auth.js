import {verifyAccessJWT,randomToken,sha256,sameOrigin} from './security.js';
import {one,run,permission,audit,nowSeconds} from './db.js';

export class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
export const ADMIN_COOKIE='__Host-mtl-admin';
export const CODE_COOKIE='__Host-mtl-codes';
export function cookieValue(request,name) {
  const cookie=request.headers.get('Cookie')||'';
  return cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||null;
}
export function sessionCookie(name,token,age=14400) {return `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;}
export async function accessIdentity(request,env,app) {
  const token=request.headers.get('Cf-Access-Jwt-Assertion');
  if(!token||!app?.audience)throw new HttpError(401,'Sign in through Cloudflare Access.');
  let claims;
  try{claims=await verifyAccessJWT(token,{teamDomain:env.ACCESS_TEAM,audiences:[app.audience]});}
  catch(error){const code=/^[a-z_]{1,60}$/.test(error?.code||'')?error.code:'verification_failed';console.warn('Access identity verification',code);if(code==='verification_failed')await audit(env.DB,'system','identity.failure',app.id,'denied',{name:error?.name,reason:String(error?.message||'').slice(0,180)});throw new HttpError(401,`Cloudflare identity could not be verified (${code}). Please sign in again.`);}
  if(typeof claims.email!=='string')throw new HttpError(401,'An individual account is required.');
  const email=claims.email.trim().toLowerCase();
  return {email,claims};
}
export async function ownerIdentity(request,env) {
  const hostname=new URL(request.url).hostname;
  const app=await one(env.DB,'SELECT * FROM apps WHERE hostname=?',hostname);
  const identity=await accessIdentity(request,env,app);
  const user=await one(env.DB,'SELECT * FROM users WHERE email=?',identity.email);
  if(identity.email!==env.OWNER_EMAIL||!user?.is_owner||user.status!=='approved')throw new HttpError(403,'Owner access is required.');
  return {...identity,user,app,role:'owner'};
}
export async function createSession(env,{kind,user=null,guildVersion=null},now=nowSeconds()) {
  const token=randomToken(),id=crypto.randomUUID();
  const csrf=await sha256(token+':csrf');
  const age=kind==='guild'?4*3600:12*3600;
  await run(env.DB,'INSERT INTO sessions(token_hash,id,kind,user_id,version,guild_version,csrf_hash,created_at,expires_at,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?)',await sha256(token),id,kind,user?.id||null,user?.session_version||0,guildVersion,await sha256(csrf),now,now+age,now);
  return {token,id,csrf,age};
}
export async function readSession(request,env,cookie=CODE_COOKIE,now=nowSeconds()) {
  const token=cookieValue(request,cookie);
  if(!token||!/^[A-Za-z0-9_-]{32,128}$/.test(token))return null;
  const session=await one(env.DB,'SELECT * FROM sessions WHERE token_hash=?',await sha256(token));
  if(!session||session.revoked_at||session.expires_at<=now)return null;
  let user=null;
  if(session.kind==='guild'){
    const guild=await one(env.DB,'SELECT enabled,version FROM guild_access WHERE id=1');
    if(!guild?.enabled||guild.version!==session.guild_version)return null;
  }else{
    user=await one(env.DB,'SELECT * FROM users WHERE id=?',session.user_id);
    if(!user||user.status!=='approved'||user.session_version!==session.version)return null;
  }
  return {...session,user,subject:user?`user:${user.id}`:`guild:${session.id}`,csrf:await sha256(token+':csrf')};
}
export async function requireCsrf(request,session) {
  if(!sameOrigin(request))throw new HttpError(403,'This action must come from this website.');
  const token=request.headers.get('X-CSRF-Token');
  if(!token||!session||await sha256(token)!==session.csrf_hash)throw new HttpError(403,'Refresh this page before trying again.');
}
export async function codeIdentity(request,env) {
  const session=await readSession(request,env);
  if(!session)throw new HttpError(401,'Sign in to view the guild code tracker.');
  if(session.kind==='guild')return {...session,role:'guild_member'};
  const grant=await permission(env.DB,session.user.email,'codes');
  if(!grant.allowed)throw new HttpError(403,'Code Bot access has not been granted for this account.');
  return {...session,role:grant.role};
}
export async function gateway(request,env,ctx,app) {
  const identity=await accessIdentity(request,env,app);
  const grant=await permission(env.DB,identity.email,app.id);
  if(!grant.allowed||(grant.user.revoke_before&&Number(identity.claims.iat)<=grant.user.revoke_before)){
    await audit(env.DB,identity.email,'application.request',app.id,'denied',{},app.id);
    throw new HttpError(403,'Access to this application is not approved.');
  }
  // No decision cache: revocation is enforced on the next HTTP request.
  // Existing upgraded WebSockets belong to the origin and require origin-level session controls.
  ctx.waitUntil(run(env.DB,`INSERT INTO app_activity(user_id,app_id,last_seen) VALUES(?,?,?)
    ON CONFLICT(user_id,app_id) DO UPDATE SET last_seen=excluded.last_seen WHERE app_activity.last_seen<excluded.last_seen-300`,grant.user.id,app.id,nowSeconds()));
  const headers=new Headers(request.headers);
  for(const h of ['X-MTechLabs-User','X-MTechLabs-Role','X-MTechLabs-App'])headers.delete(h);
  // These headers are descriptive only; legacy origin applications must not treat them as an internal role.
  // Preserve Access JWT for cloudflared's independent origin validation.
  const response=await fetch(new Request(request,{headers}));
  if(response.status===101)return response;
  const out=new Response(response.body,response);
  out.headers.set('Cache-Control','private, no-store');
  out.headers.set('X-MTechLabs-Authorization','enforced');
  return out;
}
