import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixture } from './helpers.mjs';
import { atomicWriteJson } from '../lib/policy.mjs';
import { readCoordinatorStatus } from '../lib/coordinator.mjs';
import { createLineFramer } from '../lib/framing.mjs';

async function waitFor(predicate, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('shared_admission_test_timeout');
}

async function processFixture(t, labels, options = {}) {
  const base = await fixture(t, { cleanup: false });
  const configPath = path.join(base.directory, 'manager.json');
  await fs.writeFile(configPath, JSON.stringify(base.config));
  const children = [];
  t.after(async () => {
    for (const handle of children) handle.child.stdin.end();
    await Promise.all(children.map(handle => handle.closed));
    await fs.rm(base.directory, { recursive: true, force: true });
  });
  function launch(label) {
    const child = spawn(process.execPath, [
      fileURLToPath(new URL('./fixtures/gateway-process.mjs', import.meta.url)), configPath, label,
      String(options.requestTimeoutMs ?? 3000), String(options.queueTimeoutMs ?? 5000),
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const messages = [];
    const closed = new Promise(resolve => child.once('close', code => resolve(code)));
    child.stderr.resume();
    const decoder = createLineFramer({ maxBytes: 1024 * 1024, onLine: line => messages.push(JSON.parse(line)), onError: () => {} });
    child.stdout.on('data', chunk => decoder.push(chunk));
    const handle = {
      child, closed, messages,
      send(id, name, args = {}) {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
      },
      release(barrier) {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/test-release', params: { barrier } }) + '\n');
      },
      response(id) { return waitFor(() => messages.find(message => message.id === id)); },
    };
    children.push(handle);
    // Send immediately, before the child has loaded SQLite or written metadata.
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'initialize', method: 'initialize', params: {} }) + '\n');
    return handle;
  }
  const handles = labels.map(launch);
  await Promise.all(handles.map(handle => handle.response('initialize')));
  // Atomic heartbeat updates may have a private .tmp file in flight. Count
  // published instance records, as the runtime status reader does.
  const instanceFiles = (await fs.readdir(path.join(base.config.stateDirectory, 'instances')))
    .filter(name => /^[a-f0-9-]{36}\.json$/i.test(name));
  assert.equal(instanceFiles.length, labels.length, 'initial responses have durable instance metadata');
  return { ...base, handles, launch };
}

function peakConcurrency(responses) {
  const events = responses.flatMap(response => [
    { time: response.result.startedAt, delta: 1 },
    { time: response.result.finishedAt, delta: -1 },
  ]).sort((a, b) => a.time - b.time || a.delta - b.delta);
  let active = 0;
  let peak = 0;
  for (const event of events) { active += event.delta; peak = Math.max(peak, active); }
  return peak;
}

test('separate native and remote gateway processes obey one shared 1..2 limit', async t => {
  const f = await processFixture(t, ['claude-desktop', 'remote-bridge']);
  const [native, remote] = f.handles;
  assert.notEqual(native.child.pid, remote.child.pid);
  for (const maxInflight of [1, 2]) {
    await atomicWriteJson(f.config.policyPath, { enabled: true, readOnly: false, maxInflight, coordinationVersion: 1 });
    const promises = [];
    const barrier = 'shared-limit-' + maxInflight;
    for (let count = 0; count < 4; count++) {
      for (const handle of f.handles) {
        const id = maxInflight * 10 + count;
        handle.send(id, 'read_file', { delayMs: 70, barrier });
        promises.push(handle.response(id));
      }
    }
    await waitFor(async () => (await readCoordinatorStatus(f.config.stateDirectory)).queued === 8 - maxInflight);
    await waitFor(() => f.handles.flatMap(handle => handle.messages)
      .filter(message => message.method === 'notifications/test-started' && message.params?.barrier === barrier).length === maxInflight);
    for (const handle of f.handles) handle.release(barrier);
    const responses = await Promise.all(promises);
    for (const response of responses) assert.equal(response.result?.executed, true, JSON.stringify(response));
    assert.equal(new Set(responses.map(response => response.result.pid)).size, 2);
    assert.equal(peakConcurrency(responses), maxInflight);
    const status = await readCoordinatorStatus(f.config.stateDirectory);
    assert.equal(status.inflight, 0);
    assert.equal(status.queued, 0);
  }
});

test('one flooding process cannot overtake another queued client', async t => {
  const f = await processFixture(t, ['a-native', 'b-remote']);
  const [a, b] = f.handles;
  a.send('a1', 'read_file', { barrier: 'fairness' });
  await waitFor(async () => (await readCoordinatorStatus(f.config.stateDirectory)).inflight === 1);
  for (const id of ['a2', 'a3']) a.send(id, 'read_file', { delayMs: 40 });
  for (const id of ['b1', 'b2']) b.send(id, 'read_file', { delayMs: 40 });
  await waitFor(async () => (await readCoordinatorStatus(f.config.stateDirectory)).queued === 4);
  a.release('fairness');
  const responses = await Promise.all([a.response('a1'), a.response('a2'), a.response('a3'), b.response('b1'), b.response('b2')]);
  assert.deepEqual(responses.sort((left, right) => left.result.startedAt - right.result.startedAt).map(response => response.id),
    ['a1', 'b1', 'a2', 'b2', 'a3']);
});

test('a timed-out call blocks a different process until its late definitive response', async t => {
  const f = await processFixture(t, ['a-native', 'b-remote'], { requestTimeoutMs: 150, queueTimeoutMs: 10000 });
  const [a, b] = f.handles;
  a.send('slow', 'read_file', { barrier: 'timeout' });
  await waitFor(() => a.messages.some(message => message.method === 'notifications/test-started' &&
    message.params?.requestId === 'slow' && message.params?.barrier === 'timeout'));
  b.send('waiting', 'read_file', { delayMs: 5 });
  assert.equal((await a.response('slow')).error.code, -32002);
  // The timeout frame and durable accounting update cross different process
  // boundaries. Observe both the retained uncertainty and queued follower before
  // releasing the held tool; no short wall-clock duration establishes ordering.
  const status = await waitFor(async () => {
    const observed = await readCoordinatorStatus(f.config.stateDirectory);
    return observed.available && observed.inflight === 1 && observed.uncertain === 1 && observed.queued === 1
      ? observed : undefined;
  });
  assert.equal(status.inflight, 1);
  assert.equal(status.uncertain, 1);
  assert.equal(status.queued, 1);
  assert.equal(b.messages.some(message => message.id === 'waiting'), false);
  a.release('timeout');
  const completed = await b.response('waiting');
  assert.equal(completed.result.executed, true);
  assert.equal(a.messages.filter(message => message.id === 'slow').length, 1);
  assert.equal((await readCoordinatorStatus(f.config.stateDirectory)).uncertain, 0);
});

test('an exited gateway preserves uncertainty across a newly started client', async t => {
  const f = await processFixture(t, ['a-native', 'b-remote'], { queueTimeoutMs: 300 });
  const [a, b] = f.handles;
  a.send('crash', 'read_file', { exitBeforeReply: true });
  assert.equal((await a.response('crash')).error.code, -32020);
  await a.closed;
  const fresh = f.launch('c-new-client');
  await fresh.response('initialize');
  b.send('blocked', 'read_file');
  fresh.send('also-blocked', 'read_file');
  assert.equal((await b.response('blocked')).error.code, -32016);
  assert.equal((await fresh.response('also-blocked')).error.code, -32016);
  const status = await readCoordinatorStatus(f.config.stateDirectory);
  assert.equal(status.inflight, 1);
  assert.equal(status.uncertain, 1);
  assert.equal(status.queued, 0);
});
