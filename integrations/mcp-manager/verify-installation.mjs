import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {EXPECTED_LOCAL_TOOLS} from './verify-clients.mjs';
import {hasConfigurationObject} from './lib/verification-results.mjs';

const root = 'H:\\MTechLabs\\MCP';
const startedAt = new Date().toISOString();
const directory = await fs.mkdtemp(path.join(root,'state','verification-'));
const config = JSON.parse(await fs.readFile(path.join(root,'state','manager.json'),'utf8'));
config.stateDirectory = directory;
config.policyPath = path.join(directory,'policy.json');
const configPath = path.join(directory,'manager.json');
const policy = {enabled:true,readOnly:false,maxInflight:1};
await fs.writeFile(configPath,JSON.stringify(config));
await fs.writeFile(config.policyPath,JSON.stringify(policy));
const client = new Client({name:'mtechlabs-live-verification',version:'1.0.0'},{capabilities:{}});
const transport = new StdioClientTransport({command:config.nodePath,args:[fileURLToPath(new URL('./gateway.mjs',import.meta.url)),'--config',configPath,'--client','installation-test'],stderr:'pipe'});
transport.stderr?.on('data',()=>{});
const results = [];
const ownedPids = new Set();
const successfulTools = new Set();
const deniedTools = new Set();
const getText = result => (result.content||[]).filter(item=>item.type==='text').map(item=>item.text).join('\n');
async function call(name,args={}) {
  const result = await client.callTool({name,arguments:args});
  assert.equal(result.isError===true,false,'Tool returned an error');
  successfulTools.add(name);
  return result;
}
async function check(name,fn) {
  try { await fn(); results.push({name,pass:true}); }
  // Assertions and SDK errors can contain raw config/history/tool contents.
  catch (error) { results.push({name,pass:false,error:'verification_check_failed',...(Number.isInteger(error?.code)?{rpcErrorCode:error.code}:{})}); }
}
async function rejected(name,args,pattern) {
  let rejected=false;
  try { const result=await client.callTool({name,arguments:args}); rejected=result.isError===true && pattern.test(getText(result)); }
  catch (error) { rejected=pattern.test(error.message); }
  assert(rejected,'Expected managed policy rejection');
  deniedTools.add(name);
}
let manifest=[];
try {
  await client.connect(transport);
  const capabilities=client.getServerCapabilities()??{};
  console.log(JSON.stringify({capabilities:{tools:!!capabilities.tools,resources:!!capabilities.resources,prompts:!!capabilities.prompts}}));
  manifest=(await client.listTools()).tools;
  assert.equal(manifest.length,25);
  results.push({name:'MCP initialize and all 25 tool definitions',pass:true});
  const files=path.join(directory,'files'),first=path.join(files,'sample.txt'),moved=path.join(files,'renamed.txt');
  await check('directory creation',()=>call('create_directory',{path:files}));
  await check('text write',()=>call('write_file',{path:first,content:'MTECH_TEST_ALPHA\nSecond line\n',mode:'rewrite'}));
  await check('text read',async()=>assert.match(getText(await call('read_file',{path:first})),/MTECH_TEST_ALPHA/));
  await check('file metadata',()=>call('get_file_info',{path:first}));
  await check('directory listing',async()=>assert.match(getText(await call('list_directory',{path:files,depth:1})),/sample.txt/));
  await check('surgical edit',async()=>{await call('edit_block',{file_path:first,old_string:'MTECH_TEST_ALPHA',new_string:'MTECH_TEST_BETA',expected_replacements:1});assert.match(getText(await call('read_file',{path:first})),/MTECH_TEST_BETA/);});
  await check('move file',()=>call('move_file',{source:first,destination:moved}));
  await check('multiple file read',async()=>assert.match(getText(await call('read_multiple_files',{paths:[moved]})),/MTECH_TEST_BETA/));
  await check('search lifecycle',async()=>{
    const started=await call('start_search',{path:files,pattern:'MTECH_TEST_BETA',searchType:'content',literalSearch:true,timeout_ms:1000,maxResults:10});
    const session=getText(started).match(/search_[A-Za-z0-9_]+/)?.[0];
    assert(session,'No search session identifier returned');
    const more=await call('get_more_search_results',{sessionId:session,offset:0,length:20});
    assert.match(getText(started)+'\n'+getText(more),/MTECH_TEST_BETA/);
    await call('list_searches');
    await call('stop_search',{sessionId:session});
  });
  await check('terminal and output',async()=>{
    const started=await call('start_process',{command:"Write-Output 'MTECH_MCP_SMOKE_OK'",shell:'powershell',timeout_ms:1500});
    const pid=Number(getText(started).match(/PID\s+(\d+)/i)?.[1]);
    assert(pid,'No terminal PID returned');
    let output=getText(started);
    output+='\n'+getText(await call('read_process_output',{pid,timeout_ms:1000,length:30}));
    assert.match(output,/MTECH_MCP_SMOKE_OK/);
    await call('list_sessions');
  });
  await check('interactive process',async()=>{
    const started=await call('start_process',{command:"& 'C:\\Program Files\\nodejs\\node.exe' -i",shell:'powershell',timeout_ms:1000});
    const pid=Number(getText(started).match(/PID\s+(\d+)/i)?.[1]);
    assert(pid,'No interactive PID returned');ownedPids.add(pid);
    assert.match(getText(await call('interact_with_process',{pid,input:'2 + 3\n',timeout_ms:1000})),/5/);
    await call('interact_with_process',{pid,input:'.exit\n',timeout_ms:1000});ownedPids.delete(pid);
  });
  for(const terminator of ['force_terminate','kill_process']) {
    await check(terminator+' own disposable process',async()=>{
      const started=await call('start_process',{command:'Start-Sleep -Seconds 45',shell:'powershell',timeout_ms:500});
      const pid=Number(getText(started).match(/PID\s+(\d+)/i)?.[1]);
      assert(pid,'No disposable PID returned');ownedPids.add(pid);
      await call(terminator,{pid});ownedPids.delete(pid);
    });
  }
  await check('process listing',()=>call('list_processes'));
  await check('usage statistics',()=>call('get_usage_stats'));
  await check('configuration read without reporting values',async()=>{
    const result=await call('get_config');
    assert(hasConfigurationObject(result),'Configuration response did not contain a configuration object');
  });
  await check('bounded recent metadata-call history without reporting values',async()=>{
    const schema=manifest.find(tool=>tool.name==='get_recent_tool_calls')?.inputSchema;
    assert(schema?.properties?.maxResults&&schema.properties.since&&schema.properties.toolName,'Expected bounded history parameters');
    const result=await call('get_recent_tool_calls',{maxResults:1,since:startedAt,toolName:'get_file_info'});
    assert(getText(result).trim().length>0,'History response was empty');
  });
  await check('DOCX write and read',async()=>{
    const file=path.join(files,'test.docx');await call('write_file',{path:file,content:'# MCP document test\n\nMTECH_DOCX_OK',mode:'rewrite'});
    assert.match(getText(await call('read_file',{path:file})),/MTECH_DOCX_OK/);
  });
  await check('spreadsheet write and read',async()=>{
    const file=path.join(files,'test.xlsx');await call('write_file',{path:file,content:JSON.stringify([['Test','Result'],['MTECH_XLSX_OK',1]]),mode:'rewrite'});
    assert.match(getText(await call('read_file',{path:file})),/MTECH_XLSX_OK/);
  });
  await check('PDF write and read',async()=>{
    const file=path.join(files,'test.pdf');await call('write_pdf',{path:file,content:'# MCP PDF test\n\nMTECH_PDF_OK'});
    assert.match(getText(await call('read_file',{path:file})),/MTECH_PDF_OK/);
  });
  await fs.writeFile(config.policyPath,JSON.stringify({...policy,readOnly:true}));
  await check('read-only preserves safe reads',()=>call('get_file_info',{path:moved}));
  await check('read-only blocks writes',()=>rejected('write_file',{path:moved,content:'SHOULD_NOT_BE_WRITTEN'},/Read-only policy/));
  await check('read-only blocks configuration',()=>rejected('set_config_value',{key:'telemetryEnabled',value:false},/Read-only policy/));
  await fs.writeFile(config.policyPath,JSON.stringify({...policy,enabled:false}));
  await check('pause blocks new reads',()=>rejected('get_file_info',{path:moved},/paused/));
  await check('pause does not break MCP tool discovery',async()=>assert.equal((await client.listTools()).tools.length,25));
} catch(error) {
  results.push({name:'MCP verification harness completion',pass:false,error:'protocol_or_harness_failed',...(Number.isInteger(error?.code)?{rpcErrorCode:error.code}:{})});
} finally {
  // Only PIDs returned for processes launched by this test are eligible cleanup targets.
  if(ownedPids.size)await fs.writeFile(config.policyPath,JSON.stringify(policy));
  for(const pid of ownedPids)await client.callTool({name:'force_terminate',arguments:{pid}}).catch(()=>{});
  await client.close();
  const expectedNames=new Set(EXPECTED_LOCAL_TOOLS);
  const successful=EXPECTED_LOCAL_TOOLS.filter(name=>successfulTools.has(name));
  const denied=EXPECTED_LOCAL_TOOLS.filter(name=>deniedTools.has(name));
  const toolResponseCoverage={
    successful,denied,denialOnly:denied.filter(name=>!successfulTools.has(name)),
    notExercised:EXPECTED_LOCAL_TOOLS.filter(name=>!successfulTools.has(name)&&!deniedTools.has(name)),
    successfulSharedCoreCount:successful.filter(name=>name!=='give_feedback_to_desktop_commander').length,
    expectedAdvertisedCount:manifest.filter(tool=>expectedNames.has(tool.name)).length,
    unexpectedAdvertisedCount:manifest.filter(tool=>!expectedNames.has(tool.name)).length,
    note:'Successful tool responses and explicit policy denials are separate. Schema coverage does not prove full hosted-product parity.',
  };
  const report={testedAt:new Date().toISOString(),fixtureDirectory:directory,toolCount:manifest.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,toolResponseCoverage,results};
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(report.failed)process.exitCode=1;
}
