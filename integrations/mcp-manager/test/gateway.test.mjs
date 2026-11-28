import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { atomicWriteJson } from '../lib/policy.mjs';
import { collectStatus } from '../lib/status.mjs';
import { readCoordinatorStatus } from '../lib/coordinator.mjs';
import { gatewayFixture } from './helpers.mjs';
import { ENGINEERING_TOOLS } from '../lib/engineering-tools.mjs';

async function waitFor(predicate, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('gateway_test_condition_timeout');
}

function releaseBarrier(fixture, barrier) {
  fixture.input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/test-release', params: { barrier } }) + '\n');
}

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

test('readJsonBody handles BOM, invalid maxBytes, and early socket close safely', async () => {
  const { readJsonBody } = await import('../lib/http-body.mjs');
  const { EventEmitter } = await import('node:events');

  await assert.rejects(
    readJsonBody({ headers: { 'content-type': 'application/json' } }, 0),
    /invalid_max_bytes/,
  );

  const bomReq = new EventEmitter();
  bomReq.headers = { 'content-type': 'application/json; charset=utf-8' };
  const bomPromise = readJsonBody(bomReq, 1024);
  bomReq.emit('data', Buffer.from('\uFEFF{"ok":true}', 'utf8'));
  bomReq.emit('end');
  assert.deepEqual(await bomPromise, { ok: true });

  const closedReq = new EventEmitter();
  closedReq.headers = { 'content-type': 'application/json' };
  closedReq.readableEnded = false;
  closedReq.resume = () => {};
  const closedPromise = readJsonBody(closedReq, 1024);
  closedReq.emit('close');
  await assert.rejects(closedPromise, /aborted/);
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
  const barrier = 'pause-active-command';
  f.send(1, 'start_process', { barrier });
  await waitFor(() => f.messages.some(message => message.method === 'notifications/test-started' &&
    message.params?.barrier === barrier));
  f.send(2, 'read_file');
  await waitFor(async () => (await readCoordinatorStatus(f.config.stateDirectory)).queued === 1);
  await atomicWriteJson(f.config.policyPath, { enabled: false, readOnly: false, maxInflight: 1 });
  assert.equal((await f.response(2)).error.code, -32010);
  assert.equal(f.messages.some(message => message.id === 1), false, 'pause must not kill the active command');
  releaseBarrier(f, barrier);
  assert.equal((await f.response(1)).result.executed, true);
});

test('low memory blocks heavy admission and policy corruption fails closed', async t => {
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

test('low or unknown disk blocks heavy work while safe reads remain available', async t => {
  let disk = 1;
  const f = await gatewayFixture(t, { freeDisk: () => disk });
  for (const [index, name] of ['start_process', 'start_search', 'interact_with_process', 'write_pdf'].entries()) {
    f.send(index + 1, name);
    assert.equal((await f.response(index + 1)).error.code, -32018);
  }
  disk = NaN;
  f.send(5, 'start_process');
  assert.equal((await f.response(5)).error.code, -32018);
  f.send(6, 'read_file');
  assert.equal((await f.response(6)).result.ordinal, 1);
});

test('configured limit two permits concurrency but does not exceed it', async t => {
  const f = await gatewayFixture(t);
  await atomicWriteJson(f.config.policyPath, { enabled: true, readOnly: false, maxInflight: 2 });
  for (let id = 1; id <= 5; id++) f.send(id, 'read_file', { delayMs: 40, barrier: 'two-active' });
  await waitFor(() => f.messages.filter(message => message.method === 'notifications/test-started').length === 2);
  releaseBarrier(f, 'two-active');
  const responses = await Promise.all([1, 2, 3, 4, 5].map(id => f.response(id)));
  assert.equal(Math.max(...responses.map(result => result.result.greatestActive)), 2);
});

test('transient SQLite contention queues safely and retries completion accounting without redispatch', async t => {
  const f = await gatewayFixture(t);
  const locker = new DatabaseSync(path.join(f.config.stateDirectory, 'admission.sqlite'));
  try {
    locker.exec('BEGIN IMMEDIATE');
    f.send(1, 'read_file', { barrier: 'accounting' });
    assert.equal(f.messages.some(message => message.id === 1), false, 'a known busy lock does not reject the call');
    locker.exec('ROLLBACK');
    await waitFor(() => f.messages.some(message => message.method === 'notifications/test-started'));
    locker.exec('BEGIN IMMEDIATE');
    releaseBarrier(f, 'accounting');
    const result = await f.response(1);
    assert.equal(result.result.ordinal, 1);
    assert.equal((await readCoordinatorStatus(f.config.stateDirectory)).inflight, 1, 'busy completion keeps its reservation');
    locker.exec('ROLLBACK');
    f.send(2, 'read_file');
    assert.equal((await f.response(2)).result.ordinal, 2, 'only the original two tool calls were sent');
    assert.equal((await readCoordinatorStatus(f.config.stateDirectory)).inflight, 0);
  } finally {
    try { locker.exec('ROLLBACK'); } catch { /* no transaction remains on success */ }
    locker.close();
  }
});

test('queue is bounded and tool calls without IDs cannot bypass admission', async t => {
  const f = await gatewayFixture(t);
  const burstSize = 72; // one active call, 64 queued calls, and overflow
  for (let id = 1; id <= burstSize; id++) f.send(id, 'read_file', { delayMs: 20 });
  const responses = await Promise.all(Array.from({ length: burstSize }, (_, index) => f.response(index + 1, 10000)));
  assert.ok(responses.some(result => result.error?.code === -32013));
  f.input.write(JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'start_process' } }) + '\n');
  assert.equal((await f.response(null)).error.code, -32600);
});

test('timed-out tool keeps its admission slot and is not silently retried', async t => {
  const f = await gatewayFixture(t, { requestTimeoutMs: 40, queueTimeoutMs: 500 });
  f.send(1, 'start_process', { barrier: 'timeout' });
  f.send(2, 'read_file');
  assert.equal((await f.response(1)).error.code, -32002);
  const uncertain = await readCoordinatorStatus(f.config.stateDirectory);
  assert.equal(uncertain.inflight, 1);
  assert.equal(uncertain.uncertain, 1);
  releaseBarrier(f, 'timeout');
  assert.equal((await f.response(2)).result.greatestActive, 1);
  assert.equal((await f.response(2)).result.ordinal, 2);
  assert.equal(f.messages.filter(message => message.id === 1).length, 1);
  assert.equal((await readCoordinatorStatus(f.config.stateDirectory)).inflight, 0);
});

test('an exited child leaves its unresolved reservation for explicit reconciliation', async t => {
  const f = await gatewayFixture(t);
  f.send(1, 'read_file', { exitBeforeReply: true });
  assert.equal((await f.response(1)).error.code, -32020);
  await f.gateway.completed;
  const status = await readCoordinatorStatus(f.config.stateDirectory);
  assert.equal(status.inflight, 1);
  assert.equal(status.uncertain, 1);
  assert.equal(status.queued, 0);
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
  assert.deepEqual((await f.response(4)).result.tools.map(item => item.name), ENGINEERING_TOOLS.map(item => item.name));
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
