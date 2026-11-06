import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { sanitizeInventory } from '../lib/status.mjs';
import { createAdminServer } from '../admin.mjs';
import { fixture, TEST_TOKEN } from './helpers.mjs';

test('inventory exposes bounded display labels and discards private configuration fields', () => {
  const result = sanitizeInventory({ generatedAt: 'not a date', token: 'PRIVATE_ROOT_TOKEN', entries: [{
    id: 'path/PRIVATE_ID', name: '<script>PRIVATE_LABEL</script>', client: 'PRIVATE\nCLIENT',
    transport: 'stdio', management: 'managed', configured: true, tested: true,
    connection: 'connected', command: 'PRIVATE_COMMAND', args: ['PRIVATE_ARGUMENT'],
    env: { SECRET: 'PRIVATE_ENV_VALUE' }, token: 'PRIVATE_TOKEN',
  }, {
    id: 'valid-id', name: 'Local Desktop Commander', client: 'codex',
    transport: 'unsupported', management: 'unsupported',
  }, { id: 'long', name: 'x'.repeat(81), client: 'x'.repeat(65) }] });
  assert.equal(result.generatedAt, null);
  assert.equal(result.entries[0].id, 'unknown');
  assert.equal(result.entries[0].name, 'MCP server');
  assert.equal(result.entries[0].client, 'unknown');
  assert.equal(result.entries[0].connection, 'unknown');
  assert.equal(result.entries[1].name, 'Local Desktop Commander');
  assert.equal(result.entries[1].transport, 'unknown');
  assert.equal(result.entries[1].management, 'unmanaged');
  assert.equal(result.entries[2].name, 'MCP server');
  assert.equal(result.entries[2].client, 'unknown');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|<script>|SECRET|command|args|env|token/);
  assert.equal(sanitizeInventory({ entries: Array.from({ length: 100 }, () => ({})) }).entries.length, 64);
});

test('real HTTP initialize observations reject unsafe labels, redact invalid versions and retain at most eight labels', async t => {
  const base = await fixture(t, { cleanup: false });
  base.config.serverPath = fileURLToPath(new URL('./fixtures/protocol-server.mjs', import.meta.url));
  const configPath = path.join(base.directory, 'manager.json');
  await fs.writeFile(configPath, JSON.stringify(base.config));
  const server = await createAdminServer(base.config, { configPath });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await server.closeManagedMcp();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(base.directory, { recursive: true, force: true });
  });
  async function request(url, body) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port,
        path: url, method: body ? 'POST' : 'GET', headers: {
          Host: '127.0.0.1:19740', Authorization: 'Bearer ' + TEST_TOKEN,
          Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
        } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.once('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
        response.once('error', reject);
      });
      req.once('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  async function initialize(name, version = '1.0.0') {
    const result = await request('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name, version },
    } });
    assert.equal(result.status, 200);
    assert.ok(result.body.result);
  }
  for (const name of ['PRIVATE\nLABEL', 'Bearer:PRIVATE_TOKEN', '<img src=PRIVATE>', 'C:\\PRIVATE\\CONFIG', 'x'.repeat(81)]) await initialize(name);
  let status = (await request('/v1/status')).body;
  assert.deepEqual(status.remoteMcp.observedClients, []);
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE|Bearer:|<img/);
  await initialize('Valid client', 'PRIVATE_VERSION=secret');
  status = (await request('/v1/status')).body;
  assert.deepEqual(status.remoteMcp.observedClients.map(({ name, version, evidence }) => ({ name, version, evidence })), [
    { name: 'Valid client', version: null, evidence: 'protocol-initialize' },
  ]);
  assert.equal(status.remoteMcp.clientIdentityTracked, false);
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE_VERSION|secret/);
  for (let index = 0; index < 10; index += 1) await initialize('client-' + index);
  status = (await request('/v1/status')).body;
  assert.deepEqual(status.remoteMcp.observedClients.map(item => item.name), Array.from({ length: 8 }, (_, index) => 'client-' + (index + 2)));
  assert.equal(status.remoteMcp.lastSuccessfulToolAt, null);
  const toolRequest = returnToolError => request('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'read_file', arguments: { returnToolError } },
  });
  assert.equal((await toolRequest(true)).body.result.isError, true);
  status = (await request('/v1/status')).body;
  assert.ok(status.remoteMcp.lastSuccessfulRequestAt);
  assert.equal(status.remoteMcp.lastSuccessfulToolAt, null, 'An error result is protocol completion, not successful tool execution');
  assert.equal((await toolRequest(false)).body.result.isError, false);
  status = (await request('/v1/status')).body;
  const successfulAt = status.remoteMcp.lastSuccessfulToolAt;
  assert.ok(successfulAt);
  assert.equal((await toolRequest(true)).body.result.isError, true);
  assert.equal((await request('/v1/status')).body.remoteMcp.lastSuccessfulToolAt, successfulAt);
});
