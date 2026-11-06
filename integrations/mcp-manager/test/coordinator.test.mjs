import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { atomicWriteJson } from '../lib/policy.mjs';
import { createCoordinator, readCoordinatorStatus, GLOBAL_QUEUE_CAPACITY } from '../lib/coordinator.mjs';
import { fixture } from './helpers.mjs';

function ticket(name = 'read_file', lifetime = 30000) {
  return { ticketId: randomUUID(), toolName: name, expiresAt: Date.now() + lifetime };
}

async function coordinators(t, labels = ['claude-desktop', 'remote-bridge']) {
  const base = await fixture(t, { cleanup: false });
  const instances = [];
  for (const client of labels) instances.push(await createCoordinator({
    stateDirectory: base.config.stateDirectory, policyPath: base.config.policyPath,
    sessionId: randomUUID(), client,
  }));
  t.after(async () => {
    for (const instance of instances) instance.close();
    await fs.rm(base.directory, { recursive: true, force: true });
  });
  return { ...base, instances };
}

test('an unused shared directory is available with zero reservations', async t => {
  const { config } = await fixture(t);
  const status = await readCoordinatorStatus(config.stateDirectory);
  assert.equal(status.available, true);
  assert.equal(status.inflight, 0);
  assert.equal(status.queued, 0);
  assert.equal(status.scope, 'shared-state-directory');
});

test('one shared state directory is bound to one private policy path', async t => {
  const { config, directory } = await coordinators(t);
  const alternate = path.join(directory, 'alternate-policy.json');
  await atomicWriteJson(alternate, { enabled: true, readOnly: false, maxInflight: 2 });
  await assert.rejects(createCoordinator({
    stateDirectory: config.stateDirectory, policyPath: alternate,
    sessionId: randomUUID(), client: 'misconfigured-client',
  }), /coordination_policy_mismatch/);
  assert.equal((await readCoordinatorStatus(config.stateDirectory, { policyPath: alternate })).available, false);
  const status = await readCoordinatorStatus(config.stateDirectory, { policyPath: config.policyPath });
  assert.equal(status.available, true);
  assert.equal(JSON.stringify(status).includes(config.policyPath), false);
});

test('independent coordinators share permits, FIFO and client round robin', async t => {
  const { config, instances: [a, b] } = await coordinators(t);
  const a1 = ticket(), a2 = ticket(), a3 = ticket(), b1 = ticket(), b2 = ticket();
  a.enqueue(a1);
  assert.equal(a.tryAcquire(a1.ticketId).granted, true);
  for (const request of [a2, a3]) a.enqueue(request);
  for (const request of [b1, b2]) b.enqueue(request);
  assert.equal(b.tryAcquire(b1.ticketId).granted, false);
  a.release(a1.ticketId);
  assert.equal(a.tryAcquire(a2.ticketId).granted, false, 'another waiting client gets the next turn');
  assert.equal(b.tryAcquire(b2.ticketId).granted, false, 'FIFO inside a client');
  assert.equal(b.tryAcquire(b1.ticketId).granted, true);
  b.release(b1.ticketId);
  assert.equal(a.tryAcquire(a2.ticketId).granted, true);
  a.release(a2.ticketId);
  assert.equal(b.tryAcquire(b2.ticketId).granted, true);
  b.release(b2.ticketId);
  assert.equal(a.tryAcquire(a3.ticketId).granted, true);
  assert.equal((await readCoordinatorStatus(config.stateDirectory)).inflight, 1);
  a.release(a3.ticketId);
});

test('global and per-client queue capacity are bounded without deleting active work', async t => {
  const { config, instances } = await coordinators(t, ['a', 'b', 'c', 'd', 'e']);
  for (const instance of instances.slice(0, 4)) {
    for (let count = 0; count < 16; count++) assert.equal(instance.enqueue(ticket()).accepted, true);
    assert.equal(instance.enqueue(ticket()).error.code, -32013);
  }
  assert.equal(instances[4].enqueue(ticket()).error.code, -32013);
  const status = await readCoordinatorStatus(config.stateDirectory);
  assert.equal(status.queued, GLOBAL_QUEUE_CAPACITY);
  assert.equal(status.inflight, 0);
  assert.equal(status.clients.length, 4);
  assert.ok(status.recentEvents.length <= 100);
});

test('lowering a shared limit never interrupts admitted work and blocks new calls', async t => {
  const { config, instances: [a, b] } = await coordinators(t);
  await atomicWriteJson(config.policyPath, { enabled: true, readOnly: false, maxInflight: 2, coordinationVersion: 1 });
  const a1 = ticket(), b1 = ticket(), a2 = ticket();
  a.enqueue(a1); b.enqueue(b1);
  assert.equal(a.tryAcquire(a1.ticketId).granted, true);
  assert.equal(b.tryAcquire(b1.ticketId).granted, true);
  await atomicWriteJson(config.policyPath, { enabled: true, readOnly: false, maxInflight: 1, coordinationVersion: 1 });
  a.enqueue(a2);
  assert.equal(a.tryAcquire(a2.ticketId).granted, false);
  a.release(a1.ticketId);
  assert.equal(a.tryAcquire(a2.ticketId).granted, false);
  b.release(b1.ticketId);
  assert.equal(a.tryAcquire(a2.ticketId).granted, true);
  a.release(a2.ticketId);
});

test('uncertainty survives a session close and coordinator restart', async t => {
  const { config, instances: [a, b] } = await coordinators(t);
  const a1 = ticket(), b1 = ticket();
  a.enqueue(a1);
  assert.equal(a.tryAcquire(a1.ticketId).granted, true);
  a.markUncertain(a1.ticketId);
  a.close();
  b.enqueue(b1);
  assert.equal(b.tryAcquire(b1.ticketId).granted, false);
  const status = await readCoordinatorStatus(config.stateDirectory);
  assert.equal(status.inflight, 1);
  assert.equal(status.uncertain, 1);
  assert.equal(status.queued, 1);
  assert.equal(status.recentEvents.some(event => event.type === 'uncertain'), true);
});

test('stale queued tickets expire but an old active reservation is never recycled', async t => {
  const base = await fixture(t, { cleanup: false });
  let clock = Date.now();
  let alive = true;
  const owner = await createCoordinator({
    stateDirectory: base.config.stateDirectory, policyPath: base.config.policyPath,
    sessionId: randomUUID(), client: 'dead-client', now: () => clock, isAlive: () => alive,
  });
  const follower = await createCoordinator({
    stateDirectory: base.config.stateDirectory, policyPath: base.config.policyPath,
    sessionId: randomUUID(), client: 'new-client', now: () => clock, isAlive: () => alive,
  });
  t.after(async () => {
    owner.close(); follower.close();
    await fs.rm(base.directory, { recursive: true, force: true });
  });
  const active = ticket(), expired = ticket();
  owner.enqueue(active);
  assert.equal(owner.tryAcquire(active.ticketId).granted, true);
  owner.enqueue(expired);
  clock += 1000000;
  alive = false;
  follower.cancel('not-a-ticket'); // triggers conservative dead-owner cleanup
  const status = await readCoordinatorStatus(base.config.stateDirectory);
  assert.equal(status.queued, 0);
  assert.equal(status.inflight, 1);
  assert.equal(status.uncertain, 1);
});

test('coordinator status and event history exclude arguments and bound retained records', async t => {
  const { config, instances: [a] } = await coordinators(t);
  for (let count = 0; count < 45; count++) {
    const request = { ...ticket(), arguments: { private: 'DO_NOT_STORE_TOOL_ARGUMENTS' } };
    a.enqueue(request);
    assert.equal(a.tryAcquire(request.ticketId).granted, true);
    a.release(request.ticketId);
  }
  const status = await readCoordinatorStatus(config.stateDirectory);
  assert.equal(status.recentEvents.length, 100);
  assert.equal(JSON.stringify(status).includes('DO_NOT_STORE'), false);
  assert.deepEqual(Object.keys(status.recentEvents[0]).sort(), ['client', 'time', 'toolName', 'type']);
  assert.equal(status.inflight, 0);
  const db = new DatabaseSync(path.join(config.stateDirectory, 'admission.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM requests').get().count, 0); }
  finally { db.close(); }
});

test('a corrupt or symlinked database fails closed instead of starting a new admission domain', async t => {
  const { config, directory } = await fixture(t);
  const filename = path.join(config.stateDirectory, 'admission.sqlite');
  await fs.writeFile(filename, 'not sqlite');
  assert.equal((await readCoordinatorStatus(config.stateDirectory)).available, false);
  await assert.rejects(createCoordinator({ stateDirectory: config.stateDirectory, policyPath: config.policyPath, sessionId: randomUUID(), client: 'test' }));
  if (process.platform !== 'win32') {
    await fs.unlink(filename);
    const unrelated = path.join(directory, 'unrelated');
    await fs.writeFile(unrelated, 'preserve');
    await fs.symlink(unrelated, filename);
    await assert.rejects(createCoordinator({ stateDirectory: config.stateDirectory, policyPath: config.policyPath, sessionId: randomUUID(), client: 'test' }));
    assert.equal(await fs.readFile(unrelated, 'utf8'), 'preserve');
  }
});
