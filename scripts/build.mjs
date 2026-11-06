import {readFile,mkdir,writeFile} from 'node:fs/promises';
const names={PUBLIC_HTML:'index.html',ADMIN_HTML:'admin.html',PUBLIC_JS:'app.js',ADMIN_JS:'admin.js',CSS:'style.css',MCP_HTML:'mcp.html',MCP_JS:'mcp.js',MCP_CSS:'mcp.css'};
const lines=[];for(const [name,file] of Object.entries(names))lines.push(`export const ${name} = ${JSON.stringify((await readFile(new URL('../public/'+file,import.meta.url),'utf8')).replace(/\r\n/g,'\n'))};`);
await writeFile(new URL('../src/ui.generated.js',import.meta.url),lines.join('\n')+'\n');
await mkdir(new URL('../dist',import.meta.url),{recursive:true});
console.log(`Embedded ${Object.keys(names).length} UI assets into the Worker module.`);
