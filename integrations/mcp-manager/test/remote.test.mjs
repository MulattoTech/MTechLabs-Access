import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createAdminServer } from '../admin.mjs';
import { fixture, TEST_TOKEN } from './helpers.mjs';
import { ENGINEERING_TOOLS } from '../lib/engineering-tools.mjs';

const HEADERS = {
  Host: '127.0.0.1:19740', Authorization: 'Bearer ' + TEST_TOKEN,
  Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
};

// Tests bind an ephemeral port while exercising the production Host allowlist.
// Node fetch may overwrite Host, so use a real HTTP request with the test Host.
async function testFetch(input, init = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(input), {
      method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)),
      signal: init.signal,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.once('end', () => resolve(new Response(
        [204, 205, 304].includes(res.statusCode) ? null : Buffer.concat(chunks),
        { status: res.statusCode, headers: res.headers },
      )));
      res.once('error', reject);
    });
    req.once('error', reject);
    req.end(init.body);
  });
}

async function remoteFixture(t, { noResources = false, slowInitialize = false, ...remoteOptions } = {}) {
  const base = await fixture(t, { cleanup: false });
  const fixtureName = noResources ? 'protocol-no-resources.mjs' : slowInitialize ? 'protocol-slow-initialize.mjs' : 'protocol-server.mjs';
  base.config.serverPath = fileURLToPath(new URL('./fixtures/' + fixtureName, import.meta.url));
  const configPath = path.join(base.directory, 'manager.json');
  await fs.writeFile(configPath, JSON.stringify(base.config));
  const server = await createAdminServer(base.config, { configPath, remoteOptions });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map(client => client.close()));
    await server.closeManagedMcp();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(base.directory, { recursive: true, force: true });
  });
  const getStatus = async () => (await testFetch(url + '/v1/status', { headers: HEADERS })).json();
  const raw = async (body, headers = {}) => testFetch(url + '/mcp', {
    method: 'POST', headers: { ...HEADERS, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  async function client() {
    const connection = new Client({ name: 'integration-test', version: '1.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(url + '/mcp'), { fetch: testFetch, requestInit: { headers: HEADERS } });
    clients.push(connection);
    await connection.connect(transport, { timeout: 5000 });
    return connection;
  }
  return { ...base, server, url, getStatus, raw, client };
}

test('remote MCP denies unauthenticated and hostile-origin requests before loading SDK or spawning children', async t => {
  let loads = 0;
  const f = await remoteFixture(t, { sdkLoader: async () => { loads += 1; throw new Error('PRIVATE-ERROR'); } });
  let response = await f.raw({ jsonrpc: '2.0', id: 1, method: 'initialize' }, { Authorization: '' });
  assert.equal(response.status, 401);
  response = await f.raw({ jsonrpc: '2.0', id: 1, method: 'initialize' }, { Origin: 'https://attacker.invalid' });
  assert.equal(response.status, 403);
  response = await f.raw({ jsonrpc: '2.0', id: 1, method: 'initialize' }, { Host: 'attacker.invalid' });
  assert.equal(response.status, 403);
  assert.equal(loads, 0);
  assert.equal((await f.getStatus()).remoteMcp.state, 'idle');
  response = await f.raw({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /PRIVATE-ERROR|Bearer|admin-token/);
  assert.equal((await f.getStatus()).remoteMcp.state, 'unavailable');
});

test('real SDK HTTP initialize/list/call forwards actual tools, resources, prompts and UI metadata through managed gateway', async t => {
  const f = await remoteFixture(t);
  assert.equal((await f.getStatus()).remoteMcp.sdkLoaded, false);
  const client = await f.client();
  const capabilities = client.getServerCapabilities();
  assert.deepEqual(capabilities, { tools: {}, resources: {}, prompts: {} });
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 2 + ENGINEERING_TOOLS.length);
  assert.equal(tools.tools[0]._meta['ui/resourceUri'], 'ui://desktop-commander/file-preview');
  assert.equal(tools.tools[0]._meta['openai/outputTemplate'], 'ui://desktop-commander/file-preview');
  assert.equal(tools.tools[0].annotations.readOnlyHint, true);
  const result = await client.callTool({ name: 'read_file', arguments: { echo: 'hello' } });
  assert.equal(JSON.parse(result.content[0].text).echo, 'hello');
  const resources = await client.listResources();
  assert.equal(resources.resources.length, 1);
  assert.deepEqual(await client.listResourceTemplates(), { resourceTemplates: [] });
  assert.match((await client.readResource({ uri: resources.resources[0].uri })).contents[0].text, /Safe fixture/);
  assert.equal((await client.listPrompts()).prompts[0].name, 'fixture');
  assert.match((await client.getPrompt({ name: 'fixture' })).messages[0].content.text, /harmless/);
  const status = await f.getStatus();
  assert.equal(status.remoteMcp.state, 'ready');
  assert.equal(status.remoteMcp.lastToolListCount, 2 + ENGINEERING_TOOLS.length);
  assert.equal(status.remoteMcp.clientIdentityTracked, false);
  assert.equal(status.remoteMcp.resourceSupport, true);
  assert.ok(status.remoteMcp.lastSuccessfulToolAt);
  assert.ok(Array.isArray(status.remoteMcp.recentToolCalls));
  assert.equal(status.remoteMcp.recentToolCalls[0].toolName,'read_file');
  assert.equal(status.remoteMcp.recentToolCalls[0].outcome,'succeeded');
  assert.equal(status.remoteMcp.recentToolCalls[0].clientAttribution,'unknown');
  assert.equal(typeof status.remoteMcp.recentToolCalls[0].durationMs,'number');
  assert.equal(JSON.stringify(status.remoteMcp.recentToolCalls).includes('hello'),false);
  assert.equal(status.remoteMcp.observedClients.length, 1);
  assert.equal(status.remoteMcp.observedClients[0].name, 'integration-test');
  assert.equal(status.remoteMcp.observedClients[0].evidence, 'protocol-initialize');
  assert.ok(status.remoteMcp.observedClients[0].lastInitializedAt);
});

test('remote calls preserve read-only and pause policy; protocol discovery remains available', async t => {
  const f = await remoteFixture(t);
  await fs.writeFile(f.config.policyPath, JSON.stringify({ enabled: true, readOnly: true, maxInflight: 1 }));
  const client = await f.client();
  await assert.rejects(client.callTool({ name: 'start_process', arguments: {} }), error => error.code === -32011);
  await assert.rejects(client.callTool({ name: 'set_config_value', arguments: {} }), error => error.code === -32011);
  assert.equal((await f.getStatus()).remoteMcp.idleTeardownDeferred, false);
  assert.equal((await client.callTool({ name: 'read_file', arguments: {} })).isError, false);
  await fs.writeFile(f.config.policyPath, JSON.stringify({ enabled: false, readOnly: true, maxInflight: 1 }));
  await assert.rejects(client.callTool({ name: 'read_file', arguments: {} }), error => error.code === -32010);
  assert.equal((await client.listTools()).tools.length, 2 + ENGINEERING_TOOLS.length);
  const entries=(await f.getStatus()).remoteMcp.recentToolCalls;
  assert.ok(entries.some(item=>item.toolName==='start_process'&&item.outcome==='denied'));
  assert.ok(entries.some(item=>item.toolName==='read_file'&&item.outcome==='succeeded'));
  assert.ok(entries.some(item=>item.toolName==='read_file'&&item.outcome==='denied'));
  assert.ok(entries.every(item=>!('arguments' in item)&&!('output' in item)&&item.clientAttribution==='unknown'));
});

test('concurrent cold-start clients wait for the same complete upstream initialization', async t => {
  const f = await remoteFixture(t, { slowInitialize: true });
  const firstClient = f.client();
  let startingStatus;
  for (let attempts = 0; attempts < 100; attempts += 1) {
    startingStatus = await f.getStatus();
    if (startingStatus.remoteMcp.state === 'starting' && startingStatus.remoteMcp.sdkLoaded) break;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.equal(startingStatus.remoteMcp.state, 'starting');
  assert.equal(startingStatus.remoteMcp.sdkLoaded, true);
  const clients = await Promise.all([firstClient, f.client()]);
  for (const client of clients) {
    assert.deepEqual(client.getServerCapabilities(), { tools: {}, resources: {}, prompts: {} });
    assert.equal((await client.listTools()).tools.length, 2 + ENGINEERING_TOOLS.length);
  }
  assert.equal((await f.getStatus()).instances.filter(instance => instance.client === 'remote-web').length, 1);
});

test('concurrent HTTP requests share one gateway, unique upstream IDs, bounded admission and sanitized status', async t => {
  const f = await remoteFixture(t, { maxHttpRequests: 8 });
  const client = await f.client();
  await client.listTools();
  const calls = Array.from({ length: 9 }, (_, index) => f.raw({
    jsonrpc: '2.0', id: 7, method: 'tools/call',
    params: { name: 'read_file', arguments: { delayMs: 100, echo: index, diagnosticSecret: TEST_TOKEN } },
  }));
  const responses = await Promise.all(calls);
  assert.equal(responses.filter(response => response.status === 429).length, 1);
  const results = await Promise.all(responses.map(response => response.json()));
  const accepted = results.filter(result => result.result).map(result => JSON.parse(result.result.content[0].text));
  assert.equal(accepted.length, 8);
  assert.equal(new Set(accepted.map(result => result.echo)).size, 8);
  assert.ok(accepted.every(result => result.greatestActive === 1));
  const status = await f.getStatus();
  assert.equal(status.instances.filter(instance => instance.client === 'remote-web').length, 1);
  assert.doesNotMatch(JSON.stringify(status), /test-bearer|diagnosticSecret|TOP-SECRET|admin-token/);
});

test('a 32-session remote burst passes through the higher HTTP and shared admission limits', async t => {
  const f = await remoteFixture(t);
  await fs.writeFile(f.config.policyPath, JSON.stringify({ enabled: true, readOnly: false, maxInflight: 32, coordinationVersion: 1 }));
  const client = await f.client();
  await client.listTools();
  assert.equal((await f.getStatus()).remoteMcp.maxHttpRequests, 64);
  const responses = await Promise.all(Array.from({ length: 32 }, (_, index) => f.raw({
    jsonrpc: '2.0', id: 7, method: 'tools/call',
    params: { name: 'read_file', arguments: { delayMs: 125, echo: index } },
  })));
  assert.ok(responses.every(response => response.status === 200));
  const replies = await Promise.all(responses.map(response => response.json()));
  const accepted = replies.map(reply => JSON.parse(reply.result.content[0].text));
  assert.equal(new Set(accepted.map(result => result.echo)).size, 32);
  assert.ok(accepted.some(result => result.greatestActive > 8), 'requests execute beyond the former 8-request ceiling');
  const status = await f.getStatus();
  assert.equal(status.coordinator.inflight, 0);
  assert.equal(status.coordinator.queued, 0);
});

test('idle read-only backend closes gracefully; possible background work defers automatic teardown', async t => {
  const f = await remoteFixture(t, { idleTimeoutMs: 60 });
  const client = await f.client();
  await client.callTool({ name: 'read_file', arguments: {} });
  let status;
  for (let attempts = 0; attempts < 100; attempts += 1) {
    status = await f.getStatus();
    if (status.remoteMcp.state === 'idle') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(status.remoteMcp.state, 'idle');
  await client.callTool({ name: 'start_process', arguments: {} });
  await new Promise(resolve => setTimeout(resolve, 120));
  status = await f.getStatus();
  assert.equal(status.remoteMcp.state, 'ready');
  assert.equal(status.remoteMcp.idleTeardownDeferred, true);
});

test('stateless endpoint rejects sessions, oversized/batched input and unsupported UI metadata honestly', async t => {
  const f = await remoteFixture(t, { noResources: true });
  for (const method of ['GET', 'DELETE']) {
    const response = await testFetch(f.url + '/mcp', { method, headers: HEADERS });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  let response = await f.raw([{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  assert.equal(response.status, 400);
  response = await f.raw(' '.repeat(1024 * 1024 + 1));
  assert.equal(response.status, 400);
  assert.equal((await f.getStatus()).remoteMcp.sdkLoaded, false);
  const client = await f.client();
  assert.equal(client.getServerCapabilities().resources, undefined);
  const tools = await client.listTools();
  assert.equal(tools.tools[0]._meta['ui/resourceUri'], undefined);
  assert.equal(tools.tools[0]._meta['openai/outputTemplate'], undefined);
  assert.equal(tools.tools[0]._meta['fixture/preserve'], true);
  assert.equal((await f.getStatus()).remoteMcp.resourceSupport, false);
});
