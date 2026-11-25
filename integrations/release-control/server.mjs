import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyAccessJWT,normalizeEmail} from '../../src/security.js';
import {createController,githubClient,ApiError} from './controller.mjs';
import {PROJECTS} from './catalog.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const prefix='/admin/releases',host='m-techlabs.com',origin='https://'+host;
const scope={teamDomain:'broken-breeze-d0bb.cloudflareaccess.com',audiences:['07ab5d3b657038e3da3af279994f36c3e8deb8cb1c79adcc43e01e3df6ccb785']};
const headers={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
export async function ownerCheck(token,options={}){
 try{const c=await verifyAccessJWT(token,{...scope,...options});return normalizeEmail(c.email)==='dylanmellor@gmail.com';}catch{return false;}
}
function reply(res,status,value,type='application/json; charset=utf-8'){res.writeHead(status,{...headers,'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(value):value);}
async function body(req){
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw new ApiError(415,'JSON required.');
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>16384)throw new ApiError(413,'Request too large.');chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'Invalid JSON.');}
}
export async function createServer({controller,verify=ownerCheck}){
 const assets=new Map(await Promise.all([['/','index.html','text/html; charset=utf-8'],['/app.js','app.js','text/javascript; charset=utf-8'],['/style.css','style.css','text/css; charset=utf-8']].map(async([route,file,type])=>[prefix+route,{data:await fs.readFile(path.join(here,file)),type}])));
 const methods=new Map([['/api/check',controller.check],['/api/prepare',controller.prepare],['/api/decision',controller.decide]]);
 return http.createServer({requestTimeout:45000,headersTimeout:10000,maxHeaderSize:32768},async(req,res)=>{
  try{
   if(req.headers.host!==host)throw new ApiError(403,'Use the owner hub.');
   if(!await verify(req.headers['cf-access-jwt-assertion']))throw new ApiError(401,'Sign in through Cloudflare Access.');
   const u=new URL(req.url,origin);
   if(u.origin!==origin||u.search||u.hash)throw new ApiError(404,'Not found.');
   if(req.method==='GET'&&u.pathname===prefix){res.writeHead(308,{...headers,Location:prefix+'/'});return res.end();}
   if(req.method==='GET'&&assets.has(u.pathname)){const a=assets.get(u.pathname);return reply(res,200,a.data,a.type);}
   if(req.method==='GET'&&u.pathname===prefix+'/api/status')return reply(res,200,controller.snapshot());
   if(req.method==='POST'){
    if(req.headers.origin!==origin||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')||req.headers['x-mtech-release']!=='1')throw new ApiError(403,'Same-origin owner request required.');
    const handler=u.pathname.startsWith(prefix+'/api/')?methods.get(u.pathname.slice(prefix.length)):null;
    if(handler)return reply(res,200,await handler(await body(req)));
   }
   throw new ApiError(404,'Not found.');
  }catch(e){if(!res.headersSent)reply(res,e instanceof ApiError?e.status:500,{error:e instanceof ApiError?e.message:'Release controller unavailable.'});else res.destroy();}
 });
}
async function main(){
 const local=process.env.LOCALAPPDATA;if(!local)throw Error('Local state directory unavailable');
 const controller=await createController({stateFile:path.join(local,'MTechLabs','ReleaseControl','state.json'),github:githubClient('C:\\Program Files\\GitHub CLI\\gh.exe')});
 if(process.argv.includes('--scan')){
  const ids=PROJECTS.filter(p=>!p.archived).map(p=>p.id);
  for(let i=0;i<ids.length;i+=6)await controller.check({ids:ids.slice(i,i+6)});
  const s=controller.snapshot();console.log(JSON.stringify({active:ids.length,checked:s.projects.filter(p=>p.head?.status==='ok').length,unavailable:s.projects.filter(p=>p.head?.status==='unavailable').map(p=>p.id),deployments:s.projects.filter(p=>p.head?.deployment?.sha).map(p=>({id:p.id,state:p.head.deployment.state,sha:p.head.deployment.sha}))}));return;
 }
 const server=await createServer({controller});
 server.on('error',()=>{console.error('Release Control listener failed');process.exitCode=1;});
 server.listen(20881,'127.0.0.1',()=>console.log('Release Control listening on loopback'));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Release Control initialization failed');process.exitCode=1;});
