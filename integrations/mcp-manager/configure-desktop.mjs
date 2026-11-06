import fs from 'node:fs/promises';
import path from 'node:path';

// Run only during the authorized installation, under Dylan's Windows account.
// Merge the one managed entry; never replace other user settings or servers.
const file = 'C:\\Users\\Dylan\\AppData\\Roaming\\Claude\\claude_desktop_config.json';
const backupDirectory = 'H:\\MTechLabs\\MCP\\backups';
const serverName = 'desktop-commander-local';
let original;
try { original = await fs.readFile(file, 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const config = original === undefined ? {} : JSON.parse(original.replace(/^\uFEFF/, ''));
if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('Invalid existing Claude Desktop configuration');
if (config.mcpServers !== undefined && (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers))) {
  throw new Error('Invalid existing MCP server configuration');
}
config.mcpServers ??= {};
if (Object.hasOwn(config.mcpServers, serverName)) throw new Error('Managed entry already exists; inspect it before changing');
if (original !== undefined) {
  await fs.mkdir(backupDirectory, {recursive:true});
  const backup = path.join(backupDirectory, 'claude-desktop-before-' + Date.now() + '.json');
  await fs.writeFile(backup, original, {flag:'wx'});
}
config.mcpServers[serverName] = {
  command:'C:\\Program Files\\nodejs\\node.exe',
  args:['H:\\MTechLabs\\MCP\\runtime\\gateway.mjs','--config','H:\\MTechLabs\\MCP\\state\\manager.json','--client','claude-desktop'],
};
await fs.mkdir(path.dirname(file), {recursive:true});
const temporary = file + '.mtechlabs-' + Date.now() + '.tmp';
await fs.writeFile(temporary, JSON.stringify(config, null, 2) + '\n', {flag:'wx'});
await fs.rename(temporary, file);
console.log(JSON.stringify({configured:true,server:serverName,otherServersPreserved:Object.keys(config.mcpServers).length-1,restartRequired:true}));
