import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createAdminServer} from './admin.mjs';
import {inspectToolInventory} from './lib/verification-inventory.mjs';

const root='H:\\MTechLabs\\MCP';
const directory=await fs.mkdtemp(path.join(root,'state','remote-verification-'));
const config=JSON.parse(await fs.readFile(path.join(root,'state','manager.json'),'utf8'));
Object.assign(config,{stateDirectory:directory,policyPath:path.join(directory,'policy.json'),tokenPath:path.join(directory,'token-digest')});
const configPath=path.join(directory,'manager.json');
const token=randomBytes(32).toString('hex');
await fs.writeFile(configPath,JSON.stringify(config));
await fs.writeFile(config.policyPath,JSON.stringify({enabled:true,readOnly:true,maxInflight:1}));
await fs.writeFile(config.tokenPath,'sha256:'+createHash('sha256').update(token).digest('hex'));
const server=await createAdminServer(config,{configPath});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const base='http://127.0.0.1:'+server.address().port;
const headers={Host:'127.0.0.1:19740',Authorization:'Bearer '+token};
const client=new Client({name:'mtechlabs-http-verification',version:'1.0.0'},{capabilities:{}});
const result={testedAt:new Date().toISOString(),checks:[]};
// Node fetch replaces Host on ephemeral-port requests. Preserve the exact
// production Host allowlist for this local test; do not weaken server checks.
async function localFetch(input,init={}) {
  return new Promise((resolve,reject)=>{
    const request=http.request(new URL(input),{method:init.method??'GET',headers:Object.fromEntries(new Headers(init.headers)),signal:init.signal},response=>{
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));
      response.once('end',()=>resolve(new Response([204,205,304].includes(response.statusCode)?null:Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
      response.once('error',reject);
    });request.once('error',reject);request.end(init.body);
  });
}
try {
  assert.equal((await localFetch(base+'/v1/status',{headers:{Host:'127.0.0.1:19740'}})).status,401);result.checks.push('anonymous denied');
  const transport=new StreamableHTTPClientTransport(new URL(base+'/mcp'),{fetch:localFetch,requestInit:{headers}});
  await client.connect(transport);
  const inventory=await inspectToolInventory(client);
  const {tools,lastPageCount,...inventoryEvidence}=inventory;
  result.inventory=inventoryEvidence;result.checks.push('HTTP initialize and validated native plus engineering tools');
  const read=await client.callTool({name:'get_file_info',arguments:{path:path.join(root,'package.json')}});assert(!read.isError);result.checks.push('HTTP safe read');
  let denied=false;try{await client.callTool({name:'write_file',arguments:{path:path.join(directory,'must-not-exist.txt'),content:'NO'}});}catch(error){denied=/read-only/.test(error.message);}
  assert(denied);result.checks.push('HTTP write denied by readonly policy');
  const resources=await client.listResources();const prompts=await client.listPrompts();
  result.resources=resources.resources.length;result.prompts=prompts.prompts.length;
  if(resources.resources.length){const r=await client.readResource({uri:resources.resources[0].uri});assert(r.contents.length>0);result.checks.push('resource content forwarded');}
  result.checks.push('resources and prompts forwarded');
  const status=await (await localFetch(base+'/v1/status',{headers})).json();
  assert.equal(status.remoteMcp.state,'ready');assert.equal(status.remoteMcp.lastToolListCount,lastPageCount);result.checks.push('live backend evidence recorded');
  await localFetch(base+'/v1/policy',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({enabled:false,readOnly:true,maxInflight:1})});
  denied=false;try{await client.callTool({name:'get_file_info',arguments:{path:path.join(root,'package.json')}});}catch(error){denied=/paused/.test(error.message);}
  assert(denied);result.checks.push('HTTP pause enforced');
  result.pass=true;
} catch(error){result.pass=false;result.error=String(error.message).slice(0,600);process.exitCode=1;}
finally {
  await client.close();
  await new Promise(resolve=>server.close(resolve));
  await server.closeManagedMcp();
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({...result,fixtureDirectory:directory}));
}
