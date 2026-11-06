import fs from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({name:'mtechlabs-tool-inventory',version:'1.0.0'},{capabilities:{}});
const transport = new StdioClientTransport({
  command:'C:\\Program Files\\nodejs\\node.exe',
  args:['H:\\MTechLabs\\MCP\\node_modules\\@wonderwhy-er\\desktop-commander\\dist\\index.js','--no-onboarding'],
  stderr:'pipe',
});
transport.stderr?.on('data',()=>{});
try {
  await client.connect(transport);
  const {tools} = await client.listTools();
  await fs.writeFile('H:\\MTechLabs\\MCP\\state\\tool-manifest.json',JSON.stringify(tools,null,2)+'\n');
  console.log(JSON.stringify({toolCount:tools.length,tools:tools.map(t=>({
    name:t.name,required:t.inputSchema.required||[],parameters:Object.keys(t.inputSchema.properties||{}),
  }))}));
} finally { await client.close(); }
