import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from '../lib/policy.mjs';
import { collectStatus } from '../lib/status.mjs';
import { gatewayFixture } from './helpers.mjs';

test('gateway preserves initialization and fragmented concurrent JSON-RPC requests', async t => {
  const f = await gatewayFixture(t);
  const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n';
  f.input.write(initialize.slice(0, 10));
  f.input.write(initialize.slice(10));
  assert.equal((await f.response(1)).result.serverInfo.name, 'test-child');
  f.send(2, 'read_file', { delayMs: 40, echo: '🌙' });
  f.send(3, 'read_file', { delayMs: 5 });
  assert.equal((await f.response(2)).result.echo, '🌙');
  assert.equal((await f.response(3)).result.greatestActive, 1);
  const status = await collectStatus(f.config);
  assert.equal(status.limits.detachedJobsCapped, false);
});

test('policy changes are read on each call and read-only blocks writes, config and process launch', async t => {
  const f = await gatewayFixture(t);
  f.send(1, 'write_file');
  assert.equal((await f.response(1)).result.executed, true);
  await atomicWriteJson(f.config.policyPath, { enabled: true, readOnly: true, maxInflight: 1 });
  const names = ['write_file', 'set_config_value', 'get_config', 'start_process', 'start_search', 'future_tool'];
  names.forEach((name, index) => f.send(index + 2, name));
  for (let index = 0; index < names.length; index++) assert.equal((await f.response(index + 2)).error.code, -32011);
  f.send(20, 'read_file');
  assert.equal((await f.response(20)).result.ordinal, 2);
});

test('pause rejects queued work without killing an already dispatched command', async t => {
  const f = await gatewayFixture(t);
  f.send(1, 'start_process', { delayMs: 150 });
  await new Promise(resolve => setTimeout(resolve, 50));
  f.send(2, 'read_file');
  await atomicWriteJson(f.config.policyPath, { enabled: false, readOnly: false, maxInflight: 1 });
  assert.equal((await f.response(1)).result.executed, true);
  assert.equal((await f.response(2)).error.code, -32010);
});

test('low memory blocks only new process/search admission and policy corruption fails closed', async t => {
  const f = await gatewayFixture(t, { freeMemory: () => 1 });
  f.send(1, 'start_process');
  f.send(2, 'start_search');
  f.send(3, 'read_file');
  assert.equal((await f.response(1)).error.code, -32012);
  assert.equal((await f.response(2)).error.code, -32012);
  assert.equal((await f.response(3)).result.executed, true);
  await fs.writeFile(f.config.policyPath, '{broken');
  f.send(4, 'read_file');
  assert.equal((await f.response(4)).error.code, -32014);
});

test('configured limit two permits concurrency but does not exceed it', async t => {
  const f = await gatewayFixture(t);
  await atomicWriteJson(f.config.policyPath, { enabled: true, readOnly: false, maxInflight: 2 });
  for (let id = 1; id <= 5; id++) f.send(id, 'read_file', { delayMs: 40 });
  const responses = await Promise.all([1, 2, 3, 4, 5].map(id => f.response(id)));
  assert.equal(Math.max(...responses.map(result => result.result.greatestActive)), 2);
});

test('queue is bounded and tool calls without IDs cannot bypass admission', async t => {
  const f = await gatewayFixture(t);
  for (let id = 1; id <= 24; id++) f.send(id, 'read_file', { delayMs: 20 });
  const responses = await Promise.all(Array.from({ length: 24 }, (_, index) => f.response(index + 1)));
  assert.ok(responses.some(result => result.error?.code === -32013));
  f.input.write(JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'start_process' } }) + '\n');
  assert.equal((await f.response(null)).error.code, -32600);
});

test('timed-out tool keeps its admission slot and is not silently retried', async t => {
  const f = await gatewayFixture(t, { requestTimeoutMs: 40, queueTimeoutMs: 500 });
  f.send(1, 'start_process', { delayMs: 120 });
  await new Promise(resolve => setTimeout(resolve, 10));
  f.send(2, 'read_file');
  assert.equal((await f.response(1)).error.code, -32002);
  assert.equal((await f.response(2)).result.greatestActive, 1);
  assert.equal((await f.response(2)).result.ordinal, 2);
  assert.equal(f.messages.filter(message => message.id === 1).length, 1);
});

test('a cancelled queued request is never dispatched and protocol discovery works while paused', async t => {
  const f = await gatewayFixture(t);
  f.send(1, 'read_file', { delayMs: 100 });
  await new Promise(resolve => setTimeout(resolve, 30));
  f.send(2, 'read_file');
  f.input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } }) + '\n');
  assert.equal((await f.response(2)).error.code, -32800);
  await f.response(1);
  f.send(3, 'read_file');
  assert.equal((await f.response(3)).result.ordinal, 2);
  await atomicWriteJson(f.config.policyPath, { enabled: false, readOnly: true, maxInflight: 1 });
  f.input.write(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list' }) + '\n');
  assert.deepEqual((await f.response(4)).result.tools, []);
});

test('status and diagnostics contain no tool arguments or raw child secrets and preserve unrelated metadata', async t => {
  const f = await gatewayFixture(t);
  const preserved = path.join(f.config.stateDirectory, 'owner-note.json');
  await fs.writeFile(preserved, '{"keep":true}');
  f.send(1, 'read_file', { diagnosticSecret: 'THIS_MUST_NOT_APPEAR_IN_MANAGER_LOGS' });
  await f.response(1);
  assert.equal(f.diagnostics().includes('THIS_MUST_NOT_APPEAR'), false);
  const status = JSON.stringify(await collectStatus(f.config));
  assert.equal(status.includes('THIS_MUST_NOT_APPEAR'), false);
  assert.equal(status.includes('TOP-SECRET-ARBITRARY-COMMAND'), false);
  f.input.end();
  await f.gateway.completed;
  assert.equal(await fs.readFile(preserved, 'utf8'), '{"keep":true}');
  const files = await fs.readdir(path.join(f.config.stateDirectory, 'instances'));
  assert.equal(files.includes(f.gateway.id + '.json'), false);
});
