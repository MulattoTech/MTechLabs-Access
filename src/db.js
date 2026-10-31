export const nowSeconds = () => Math.floor(Date.now() / 1000);
export async function one(db, sql, ...args) { return db.prepare(sql).bind(...args).first(); }
export async function rows(db, sql, ...args) { return (await db.prepare(sql).bind(...args).all()).results; }
export async function run(db, sql, ...args) { return db.prepare(sql).bind(...args).run(); }
export function statement(db, sql, ...args) { return db.prepare(sql).bind(...args); }
export function normalizeEmail(value) {
  if (typeof value !== 'string') throw new Error('An individual email address is required.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(email) || email.includes('*')) throw new Error('Enter one valid email address, without wildcards.');
  return email;
}
export async function audit(db, actor, action, target, outcome='allowed', detail={}, appId=null) {
  await run(db, 'INSERT INTO audit(at,actor,action,target,app_id,outcome,detail) VALUES(?,?,?,?,?,?,?)', nowSeconds(), actor, action, target, appId, outcome, JSON.stringify(detail));
}
export async function rateLimit(db, key, limit, windowSeconds, now=nowSeconds()) {
  const row = await one(db, `INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,
    reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING count,reset_at`,key,now+windowSeconds,now,now);
  return {allowed:row.count<=limit, remaining:Math.max(0,limit-row.count), resetAt:row.reset_at};
}
export const ROLE_RANK = {denied:0,viewer:1,guild_member:1,access:1,editor:2,operator:3,administrator:4,owner:5};
export async function permission(db,email,appId,now=nowSeconds()) {
  const user = await one(db,'SELECT * FROM users WHERE email=?',email);
  const app = await one(db,'SELECT * FROM apps WHERE id=?',appId);
  if (!user || user.status!=='approved' || !app || !app.enabled) return {allowed:false,user,app,role:'denied'};
  if (user.is_owner) return {allowed:true,user,app,role:'owner'};
  if (!app.managed || ['owner_only','external'].includes(app.access_mode)) return {allowed:false,user,app,role:'denied'};
  const direct=await one(db,'SELECT role FROM grants WHERE user_id=? AND app_id=?',user.id,appId);
  if (direct) return {allowed:direct.role!=='denied',user,app,role:direct.role};
  const inherited=await rows(db,'SELECT gg.role FROM group_grants gg JOIN group_members gm ON gg.group_id=gm.group_id WHERE gm.user_id=? AND gg.app_id=?',user.id,appId);
  if(inherited.some(x=>x.role==='denied')) return {allowed:false,user,app,role:'denied'};
  const role=inherited.map(x=>x.role).sort((a,b)=>(ROLE_RANK[b]||0)-(ROLE_RANK[a]||0))[0]||'denied';
  return {allowed:role!=='denied',user,app,role};
}
export function validRole(app,role) {
  if (!Object.hasOwn(ROLE_RANK,role) || role==='owner') return false;
  if (role==='denied') return true;
  if (app.access_mode==='native') return ['viewer','guild_member','editor','operator','administrator'].includes(role);
  return app.access_mode==='gate' && role==='access';
}
