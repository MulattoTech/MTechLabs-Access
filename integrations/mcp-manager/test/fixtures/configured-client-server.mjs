import readline from 'node:readline';
import { EXPECTED_LOCAL_TOOLS, PROBE_PATH } from '../../verify-clients.mjs';

const validLaunch = process.argv[2] === '--configured-argument' &&
  process.argv[3] === 'fixture argument with spaces' &&
  process.env.MTECH_VERIFY_FIXTURE === 'PRIVATE_FIXTURE_ENVIRONMENT_VALUE';
const mode = process.argv[4];
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const tools = EXPECTED_LOCAL_TOOLS.map(name => ({ name,
  inputSchema: name === 'get_file_info' ? { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } : { type: 'object' },
}));
// Verify the transport consumes diagnostics without echoing private strings.
process.stderr.write('PRIVATE_FIXTURE_DIAGNOSTIC\n');
lines.on('line', line => {
  const message = JSON.parse(line);
  if (!Object.hasOwn(message, 'id')) return;
  if (message.method === 'initialize') {
    if (!validLaunch) return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'PRIVATE_LAUNCH_ERROR' } }) + '\n');
    return reply(message.id, { protocolVersion: '2025-03-26', capabilities: { tools: {} },
      serverInfo: { name: 'PRIVATE_FIXTURE_SERVER_NAME', version: '1.0.0' } });
  }
  if (message.method === 'tools/list') {
    if (mode === 'missing-tool') return reply(message.id, { tools: tools.slice(1) });
    if (mode === 'repeating-cursor') return reply(message.id, { tools: [], nextCursor: 'PRIVATE_CURSOR' });
    return message.params?.cursor === 'PRIVATE_CURSOR'
      ? reply(message.id, { tools: tools.slice(24) })
      : reply(message.id, { tools: tools.slice(0, 24), nextCursor: 'PRIVATE_CURSOR' });
  }
  if (message.method === 'tools/call' && message.params?.name === 'get_file_info' && message.params?.arguments?.path === PROBE_PATH) {
    return reply(message.id, { isError: mode === 'metadata-error', content: [{ type: 'text', text: 'PRIVATE_FILE_METADATA_RESULT' }] });
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'PRIVATE_UNEXPECTED_CALL' } }) + '\n');
});
// EOF naturally closes the only input handle; no detached work is started.
