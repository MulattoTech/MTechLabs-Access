import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkToolPolicy, validatePolicy, atomicWriteJson, readPolicy, READ_ONLY_TOOLS } from '../lib/policy.mjs';
import { createLineFramer } from '../lib/framing.mjs';
import { loadConfig } from '../lib/config.mjs';
import { fixture } from './helpers.mjs';

test('policy requires exactly three typed fields and a 1..2 request limit', () => {
  assert.deepEqual(validatePolicy({ enabled: true, readOnly: true, maxInflight: 1 }),
    { enabled: true, readOnly: true, maxInflight: 1 });
  for (const value of [
    null, [], {}, { enabled: 'true', readOnly: true, maxInflight: 1 },
    { enabled: true, readOnly: true, maxInflight: 0 },
    { enabled: true, readOnly: true, maxInflight: 3 },
    { enabled: true, readOnly: true, maxInflight: 1.5 },
    { enabled: true, readOnly: true, maxInflight: 1, command: 'extra' },
  ]) assert.throws(() => validatePolicy(value), /invalid_policy/);
});

test('read-only explicitly permits safe reads and denies writes, configuration, launch and unknown tools', () => {
  const policy = { enabled: true, readOnly: true, maxInflight: 1 };
  for (const name of READ_ONLY_TOOLS) assert.equal(checkToolPolicy(policy, name), null, name);
  for (const name of [
    'write_file', 'write_pdf', 'edit_block', 'move_file', 'create_directory', 'set_config_value', 'get_config',
    'start_process', 'interact_with_process', 'start_search', 'force_terminate', 'kill_process', 'shutdown',
    'future_tool', '__proto__',
  ]) assert.equal(checkToolPolicy(policy, name)?.code, -32011, name);
  assert.equal(checkToolPolicy(policy, 'read_file', { isUrl: true, path: 'https://example.com' })?.code, -32011);
  assert.equal(checkToolPolicy(policy, 'read_multiple_files', { paths: ['https://example.com'] })?.code, -32011);
});

test('pause and low-memory admission never claim to stop existing commands', () => {
  assert.equal(checkToolPolicy({ enabled: false, readOnly: false, maxInflight: 2 }, 'read_file')?.code, -32010);
  const policy = { enabled: true, readOnly: false, maxInflight: 1 };
  const resources = { freeMemoryBytes: 100, lowMemoryFloorBytes: 200 };
  assert.equal(checkToolPolicy(policy, 'start_process', {}, resources)?.code, -32012);
  assert.equal(checkToolPolicy(policy, 'start_search', {}, resources)?.code, -32012);
  assert.equal(checkToolPolicy(policy, 'read_file', {}, resources), null);
});

test('atomic policy replacement preserves unrelated files and rejects symlinks', async t => {
  const { config, directory } = await fixture(t);
  const unrelated = path.join(directory, 'existing-client-config.json');
  const original = '{"mcpServers":{"existing":{"command":"preserved"}}}';
  await fs.writeFile(unrelated, original);
  const next = { enabled: false, readOnly: true, maxInflight: 2 };
  await atomicWriteJson(config.policyPath, next);
  assert.deepEqual(await readPolicy(config.policyPath), next);
  assert.equal(await fs.readFile(unrelated, 'utf8'), original);
  if (process.platform !== 'win32') {
    const symlink = path.join(directory, 'linked-policy.json');
    await fs.symlink(unrelated, symlink);
    await assert.rejects(atomicWriteJson(symlink, next), /invalid_target/);
    assert.equal(await fs.readFile(unrelated, 'utf8'), original);
  }
});

test('JSON line framing handles split unicode, multiple frames, CRLF, and bounded oversize recovery', () => {
  const lines = [];
  const errors = [];
  const framing = createLineFramer({ maxBytes: 64, onLine: line => lines.push(line), onError: error => errors.push(error) });
  const bytes = Buffer.from('{"text":"🌙"}\r\n{"next":true}\n');
  for (const byte of bytes) framing.push(Buffer.from([byte]));
  framing.push(Buffer.from('x'.repeat(80) + '\n{"recovered":true}\n'));
  assert.deepEqual(lines.map(JSON.parse), [{ text: '🌙' }, { next: true }, { recovered: true }]);
  assert.deepEqual(errors, ['frame_too_large']);
});

test('configuration requires absolute distinct paths and known fields', async t => {
  const { config, directory } = await fixture(t);
  const configPath = path.join(directory, 'manager.json');
  await fs.writeFile(configPath, JSON.stringify(config));
  assert.equal((await loadConfig(configPath)).minimumFreeMemoryMiB, 256);
  await fs.writeFile(configPath, JSON.stringify({ ...config, tokenPath: config.policyPath }));
  await assert.rejects(loadConfig(configPath), /overlapping_config_paths/);
  await fs.writeFile(configPath, JSON.stringify({ ...config, arbitraryCommand: 'not-supported' }));
  await assert.rejects(loadConfig(configPath), /invalid_config/);
});
