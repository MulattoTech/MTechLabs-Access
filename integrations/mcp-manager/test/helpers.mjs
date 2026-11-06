import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { startGateway } from '../gateway.mjs';
import { createLineFramer } from '../lib/framing.mjs';

export const TEST_TOKEN = 'test-bearer-not-a-production-token-0123456789abcdef';

export async function fixture(test, { cleanup = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mtech-mcp-test-'));
  if (cleanup) test.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const stateDirectory = path.join(directory, 'state');
  await fs.mkdir(stateDirectory);
  const config = {
    schemaVersion: 1,
    nodePath: process.execPath,
    serverPath: fileURLToPath(new URL('./fixtures/fake-server.mjs', import.meta.url)),
    serverPackageJsonPath: path.join(directory, 'upstream-package.json'),
    stateDirectory,
    policyPath: path.join(directory, 'policy.json'),
    tokenPath: path.join(directory, 'admin-token'),
    inventoryPath: path.join(directory, 'inventory.json'),
    minimumFreeMemoryMiB: 256,
  };
  await fs.writeFile(config.serverPackageJsonPath, JSON.stringify({ version: '0.3.1' }));
  await fs.writeFile(config.policyPath, JSON.stringify({ enabled: true, readOnly: false, maxInflight: 1 }));
  await fs.writeFile(config.tokenPath, 'sha256:' + createHash('sha256').update(TEST_TOKEN).digest('hex') + '\n');
  await fs.writeFile(config.inventoryPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    privateToken: TEST_TOKEN,
    entries: [{
      id: 'claude-local', name: 'Desktop Commander local', client: 'claude-desktop',
      transport: 'stdio', management: 'managed', configured: true, connection: 'connected', tested: false,
      token: TEST_TOKEN, command: 'TOP-SECRET-ARBITRARY-COMMAND', path: '/private/unrelated',
    }],
  }));
  return { directory, config };
}

export async function gatewayFixture(test, options = {}) {
  const base = await fixture(test, { cleanup: false });
  const input = new PassThrough();
  const output = new PassThrough();
  const diagnostics = new PassThrough();
  const messages = [];
  let diagnosticText = '';
  diagnostics.on('data', data => { diagnosticText += data.toString(); });
  const decoder = createLineFramer({ maxBytes: 1024 * 1024, onLine: line => messages.push(JSON.parse(line)), onError: () => {} });
  output.on('data', chunk => decoder.push(chunk));
  const gateway = await startGateway({
    config: base.config, client: 'claude-desktop', input, output, diagnostics,
    requestTimeoutMs: 3000, queueTimeoutMs: 3000, ...options,
  });
  test.after(async () => {
    input.end();
    await gateway.completed;
    await fs.rm(base.directory, { recursive: true, force: true });
  });
  function send(id, name, args = {}) {
    input.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  }
  async function response(id, timeout = 4000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = messages.find(message => Object.hasOwn(message, 'id') && message.id === id);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('test_response_timeout');
  }
  return { ...base, gateway, input, output, messages, diagnostics: () => diagnosticText, send, response };
}
