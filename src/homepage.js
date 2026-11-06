import {one,rows,permission} from './db.js';
import {HttpError,accessIdentity} from './auth.js';
import {HUB_CARDS,visibilityKey,userVisibilityKey} from './hub-catalog.js';

// The nginx homepage contains no application names or URLs. The edge only
// returns cards to a verified, approved Cloudflare Access identity.
export async function homepageApi(request,env) {
  if(request.method!=='GET')throw new HttpError(405,'Method not allowed.');
  const db=env.DB;
  // www shares the canonical hub registration and its Cloudflare Access audience.
  const hub=await one(db,'SELECT * FROM apps WHERE hostname=?',env.HUB_HOST);
  const identity=await accessIdentity(request,env,hub);
  const user=await one(db,'SELECT * FROM users WHERE email=?',identity.email);
  if(!user||user.status!=='approved')throw new HttpError(403,'An approved account is required.');
  const owner=Boolean(user.is_owner&&identity.email===env.OWNER_EMAIL);
  const settings=await rows(db,"SELECT key,value FROM settings WHERE key LIKE 'hub_visible:%' OR key LIKE ?",'hub_user_visible:'+user.id+':%');
  const overrides=new Map(settings.map(row=>[row.key,row.value]));
  const cards=[];
  for(const card of HUB_CARDS){
    if(overrides.get(visibilityKey(card.id))==='0'||overrides.get(userVisibilityKey(user.id,card.id))==='0')continue;
    if(!owner){
      if(card.audience!=='grant'||!card.appId)continue;
      const decision=await permission(db,identity.email,card.appId);
      if(!decision.allowed)continue;
    }
    cards.push(card);
  }
  return Response.json({cards,owner},{headers:{'Cache-Control':'private, no-store','Vary':'Cf-Access-Jwt-Assertion'}});
}
