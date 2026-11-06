import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './helpers.mjs';
import { createCoordinator } from '../lib/coordinator.mjs';
import { inspectAdmissions, resolveAdmission } from '../recover-admission.mjs';

async function recoveryFixture(t, { serverPid = 23457, close = true } = {}) {
  const { directory, config } = await fixture(t, { cleanup: false });
  const coordinator = await createCoordinator({
    ...config, sessionId: 'recovery-session', client: 'test-client', pid: 23456,
    serverPid, isAlive: () => true,
  });
  coordinator.enqueue({ ticketId: 'recovery-ticket', toolName: 'start_process', expiresAt: Date.now() + 30000 });
  assert.equal(coordinator.tryAcquire('recovery-ticket').granted, true);
  t.after(async () => {
    coordinator.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  if (close) coordinator.close();
  return { config, coordinator };
}

test('inspection reports dead-owner active work as uncertain without modifying its state', async t => {
  const { config } = await recoveryFixture(t, { close: false });
  const report = await inspectAdmissions(config, { isAlive: () => false });
  assert.equal(report.requests[0].recordedState, 'active');
  assert.equal(report.requests[0].effectiveState, 'uncertain');
  const again = await inspectAdmissions(config, { isAlive: () => true });
  assert.equal(again.requests[0].recordedState, 'active');
  assert.equal(again.requests[0].effectiveState, 'active');
  assert.equal(report.requests[0].serverPid, 23457);
});

test('recovery requires acknowledgement, paused policy, and both recorded processes stopped', async t => {
  const { config } = await recoveryFixture(t);
  await assert.rejects(resolveAdmission(config, 'recovery-ticket', ''), /confirm_detached/);
  await assert.rejects(resolveAdmission(config, 'recovery-ticket', 'work-ended', { isAlive: () => false }), /pause_managed/);
  await fs.writeFile(config.policyPath, JSON.stringify({ enabled: false, readOnly: true, maxInflight: 1, coordinationVersion: 1 }));
  const mismatched = { ...config, policyPath: path.join(config.stateDirectory, 'another-policy.json') };
  await fs.writeFile(mismatched.policyPath, JSON.stringify({ enabled: false, readOnly: true, maxInflight: 1 }));
  await assert.rejects(resolveAdmission(mismatched, 'recovery-ticket', 'work-ended', { isAlive: () => false }), /coordination_policy_mismatch/);
  await assert.rejects(resolveAdmission(config, 'recovery-ticket', 'work-ended', { isAlive: () => true }), /gateway_is_still_running/);
  await assert.rejects(resolveAdmission(config, 'recovery-ticket', 'work-ended', { isAlive: pid => pid === 23457 }), /upstream_is_still_running/);
  assert.equal((await inspectAdmissions(config, { isAlive: () => false })).requests.length, 1);
  const result = await resolveAdmission(config, 'recovery-ticket', 'work-ended', { isAlive: () => false });
  assert.deepEqual(result, { resolved: true, ticketId: 'recovery-ticket', client: 'test-client', toolName: 'start_process', retried: false });
  assert.equal((await inspectAdmissions(config)).requests.length, 0);
  const database = new DatabaseSync(path.join(config.stateDirectory, 'admission.sqlite'), { readOnly: true });
  try { assert.equal(database.prepare('SELECT type FROM events ORDER BY sequence DESC LIMIT 1').get().type, 'reconciled'); }
  finally { database.close(); }
});

test('unknown upstream PID is never treated as confirmed stopped', async t => {
  const { config } = await recoveryFixture(t, { serverPid: null });
  await fs.writeFile(config.policyPath, JSON.stringify({ enabled: false, readOnly: true, maxInflight: 1 }));
  await assert.rejects(resolveAdmission(config, 'recovery-ticket', 'work-ended', { isAlive: () => false }), /upstream_pid_unknown/);
  assert.equal((await inspectAdmissions(config, { isAlive: () => false })).requests[0].serverRunning, null);
});

test('one orphaned active ticket can be reconciled without altering another ticket', async t => {
  const { config, coordinator } = await recoveryFixture(t, { close: false });
  coordinator.enqueue({ ticketId: 'other-ticket', toolName: 'read_file', expiresAt: Date.now() + 30000 });
  await fs.writeFile(config.policyPath, JSON.stringify({ enabled: false, readOnly: true, maxInflight: 1 }));
  await resolveAdmission(config, 'recovery-ticket', 'work-ended', { isAlive: () => false });
  const report = await inspectAdmissions(config, { isAlive: () => true });
  assert.deepEqual(report.requests.map(row => row.ticketId), ['other-ticket']);
  await assert.rejects(resolveAdmission(config, 'other-ticket', 'work-ended', { isAlive: () => false }), /queued_not_uncertain/);
});
