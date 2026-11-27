import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readRuntimeInputs, inspectDevRuntime } from '../lib/dev-runtime.mjs';
import { WINDOWS_POWERSHELL } from '../lib/runtime-identity.mjs';
import { runtimeInputs, directorySnapshot, hash } from './fixtures/runtime-inputs.mjs';

const native = { skip: process.platform !== 'win32' ? 'Requires native Windows filesystem and identity APIs' : false, timeout: 60000 };
const inspector = fileURLToPath(new URL('../inspect-dev-runtime.mjs', import.meta.url));
const launcher = fileURLToPath(new URL('../manage-dev.ps1', import.meta.url));
const cleanEnvironment = () => ({ ...process.env, NODE_OPTIONS: '', NODE_PATH: '' });

test('runtime inspector explicitly refuses unsupported operating systems', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(readRuntimeInputs('/unused-config', '/unused-plan'), /dev_runtime_platform_unsupported/);
});

test('runtime input snapshots bind selected DEV and production files without state writes', native, async t => {
  const f = await runtimeInputs(t);
  const before = await Promise.all([directorySnapshot(f.prod.directory), directorySnapshot(f.dev.directory)]);
  const result = await readRuntimeInputs(f.dev.configPath, f.planPath);
  assert.equal(result.config.instance.id, f.dev.config.instance.id);
  assert.ok(Object.isFrozen(result.plan.development));
  for (const [key, filename] of [['config', f.dev.configPath], ['productionConfig', f.prod.configPath], ['plan', f.planPath]]) {
    assert.equal(result.fingerprints[key], hash(await fs.readFile(filename)));
  }
  assert.equal(result.fingerprints.evidence, 'current-file-snapshots');
  assert.deepEqual(await Promise.all([directorySnapshot(f.prod.directory), directorySnapshot(f.dev.directory)]), before);
});

test('runtime inputs refuse plaintext credentials and unknown, oversized or mismatched plans', native, async t => {
  const f = await runtimeInputs(t);
  const original = await fs.readFile(f.prod.config.tokenPath);
  await fs.writeFile(f.prod.config.tokenPath, 'fixture-plaintext-must-not-be-returned-0123456789');
  await assert.rejects(readRuntimeInputs(f.dev.configPath, f.planPath), { message: 'runtime_digest_only_credentials_required' });
  await fs.writeFile(f.prod.config.tokenPath, original);
  const unrelated = path.join(f.dev.directory, 'unrelated-plan.json');
  await fs.copyFile(f.planPath, unrelated);
  await assert.rejects(readRuntimeInputs(f.dev.configPath, unrelated), /runtime_reference_mismatch/);
  for (const change of [p => { p.instanceId = 'dev-other'; }, p => { p.qualified = true; },
    p => { p.development.manager.configPath = unrelated; }]) {
    const plan = structuredClone(f.plan); change(plan);
    await fs.writeFile(f.planPath, JSON.stringify(plan));
    await assert.rejects(readRuntimeInputs(f.dev.configPath, f.planPath), /runtime_reference_mismatch|invalid_dev_runtime_plan/);
  }
  await fs.writeFile(f.planPath, ' '.repeat(16385));
  await assert.rejects(readRuntimeInputs(f.dev.configPath, f.planPath), /runtime_file_unverified/);
});

test('runtime inputs reject linked plans, profile junctions and shared entry files', native, async t => {
  const f = await runtimeInputs(t);
  const originalPlan = await fs.readFile(f.planPath);
  const linkedPlan = path.join(f.dev.directory, 'linked-plan.json');
  await fs.link(f.planPath, linkedPlan);
  await assert.rejects(readRuntimeInputs(f.dev.configPath, f.planPath), /runtime_file_unverified/);
  await fs.unlink(linkedPlan);
  await fs.rmdir(f.dev.profile);
  await fs.symlink(f.prod.profile, f.dev.profile, 'junction');
  await assert.rejects(readRuntimeInputs(f.dev.configPath, f.planPath), /dev_(?:linked|invalid)_path/);
  await fs.unlink(f.dev.profile); await fs.mkdir(f.dev.profile);
  await fs.unlink(f.dev.entryPath); await fs.link(f.prod.entryPath, f.dev.entryPath);
  await assert.rejects(readRuntimeInputs(f.dev.configPath, f.planPath), /runtime_entry_overlap/);
  assert.deepEqual(await fs.readFile(f.planPath), originalPlan);
});

test('runtime token path validation refuses UNC before any filesystem network lookup', native, async t => {
  const f = await runtimeInputs(t);
  const unc = '\\\\unreachable.invalid\\share\\token';
  f.dev.config.tokenPath = unc;
  await f.saveConfig();
  const original = fs.lstat;
  let networkLookups = 0;
  t.mock.method(fs, 'lstat', async (...args) => {
    if (args[0] === unc) { networkLookups++; throw new Error('unexpected_network_lookup'); }
    return original(...args);
  });
  await assert.rejects(readRuntimeInputs(f.dev.configPath, f.planPath), /dev_invalid_path/);
  assert.equal(networkLookups, 0);
});

test('runtime inputs compare all four canonical entry and config identities', native, async t => {
  const f = await runtimeInputs(t);
  const original = fs.realpath;
  const actualConfig = await original(f.dev.configPath);
  // Simulate a canonical short-name resolution, independent of whether the
  // hosted NTFS volume enables 8.3 names. This is a decision test, not proof
  // that a short-name alias was provisioned on this filesystem.
  t.mock.method(fs, 'realpath', async (...args) => args[0] === f.prod.entryPath ? actualConfig : original(...args));
  await assert.rejects(readRuntimeInputs(f.dev.configPath, f.planPath), /runtime_entry_overlap/);
});

test('runtime inspection reports unqualified fixture identities and does not change either store', native, async t => {
  const f = await runtimeInputs(t);
  const before = await Promise.all([directorySnapshot(f.prod.directory), directorySnapshot(f.dev.directory)]);
  const report = await inspectDevRuntime(f.dev.configPath, f.planPath);
  assert.notEqual(report.currentIdentity.status, 'matched', 'fixture account/profile declarations are not real Windows users');
  assert.equal(report.qualified, false); assert.equal(report.upstreamEnabled, false);
  assert.equal(report.routing.liveVerified, false); assert.equal(report.runningSourceVerified, false);
  const serialized = JSON.stringify(report);
  for (const value of [f.prod.directory, f.dev.directory, f.plan.production.principalSid,
    f.plan.development.principalSid, f.plan.production.routing.audience]) assert.equal(serialized.includes(value), false);
  assert.deepEqual(await Promise.all([directorySnapshot(f.prod.directory), directorySnapshot(f.dev.directory)]), before);
});

test('DEV launcher refuses activation and Node preload before executing its supplied command', native, async t => {
  const f = await runtimeInputs(t);
  const marker = path.join(f.dev.directory, 'must-not-execute');
  const fakeNode = path.join(f.dev.directory, 'fake-node.cmd');
  await fs.writeFile(fakeNode, '@echo off\r\necho executed>"' + marker + '"\r\n');
  const invoke = (action, extra = {}) => spawnSync(WINDOWS_POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', launcher,
    '-Action', action, '-NodePath', fakeNode, '-ConfigPath', f.dev.configPath, '-PlanPath', f.planPath], {
    windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 8192, env: { ...cleanEnvironment(), ...extra },
  });
  for (const action of ['Start', 'Install', 'Open']) {
    const child = invoke(action);
    assert.ifError(child.error); assert.equal(child.status, 1); assert.equal(child.stdout, '');
    assert.equal(JSON.parse(child.stderr).error, 'dev_activation_not_qualified');
  }
  for (const env of [{ NODE_OPTIONS: '--require=private-preload' }, { NODE_PATH: 'private-module-path' }]) {
    const child = invoke('Inspect', env);
    assert.ifError(child.error); assert.equal(child.status, 1); assert.equal(child.stdout, '');
    assert.equal(JSON.parse(child.stderr).error, 'node_preload_environment_rejected');
  }
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
});

test('DEV launcher Inspect and Status refuse missing protected reference trust without fallback', native, async t => {
  const f = await runtimeInputs(t);
  const before = await Promise.all([directorySnapshot(f.prod.directory), directorySnapshot(f.dev.directory)]);
  for (const action of ['Inspect', 'Status']) {
    const child = spawnSync(WINDOWS_POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', launcher,
      '-Action', action, '-NodePath', process.execPath, '-ConfigPath', f.dev.configPath, '-PlanPath', f.planPath], {
      windowsHide: true, encoding: 'utf8', timeout: 25000, maxBuffer: 8192, env: cleanEnvironment(),
    });
    assert.ifError(child.error); assert.equal(child.status, 1); assert.equal(child.stdout, '');
    const report = JSON.parse(child.stderr);
    assert.equal(report.error, 'runtime_reference_bootstrap_untrusted');
    assert.equal(report.qualified, false); assert.equal(report.upstreamEnabled, false);
    assert.equal(child.stderr.includes(f.prod.directory), false); assert.equal(child.stderr.includes(f.dev.directory), false);
  }
  assert.deepEqual(await Promise.all([directorySnapshot(f.prod.directory), directorySnapshot(f.dev.directory)]), before);
});

test('runtime CLI rejects unknown or incomplete arguments without echoing private values', async () => {
  for (const argv of [['--private', 'sensitive-marker'], ['--config', path.resolve('absent')],
    ['--config', path.resolve('absent'), '--plan', 'relative']]) {
    const child = spawnSync(process.execPath, [inspector, ...argv], {
      encoding: 'utf8', timeout: 15000, maxBuffer: 8192, env: cleanEnvironment(),
    });
    assert.ifError(child.error); assert.equal(child.status, 1); assert.equal(child.stdout, '');
    const report = JSON.parse(child.stderr);
    assert.match(report.error, /^[a-z_]+$/); assert.equal(report.qualified, false); assert.equal(report.upstreamEnabled, false);
    assert.equal(child.stderr.includes('sensitive-marker'), false);
  }
});
