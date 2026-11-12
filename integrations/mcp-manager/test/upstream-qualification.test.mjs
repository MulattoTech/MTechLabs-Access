// SPDX-License-Identifier: MIT
// AI-Change: 2026-11-12-upstream-033 (OpenAI / GPT-6 Astra Pro; self-reported)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  validateQualificationHost, createQualificationWorkspace, assertOwnedWorkspace,
  qualificationEnvironment, admitInstalledUpstream, compareToolContracts, isBlockedProbe,
  isOwnedConfiguration, isBoundedProcessTail,
} from '../lib/upstream-qualification.mjs';
import { runQualification } from '../qualify-upstream.mjs';

const host = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
  MTERM_DISPOSABLE_UPSTREAM_QUALIFICATION: '1', GITHUB_SHA: 'a'.repeat(40), RUNNER_TEMP: os.tmpdir() };
const version = '0.3.3';
const integrity = 'sha512-' + Buffer.alloc(64, 7).toString('base64');

test('command-not-found and an executed marker cannot masquerade as pre-execution blocklist denial', () => {
  const command = 'safe-prefix; mterm_qualification_blocked';
  const notFound = { isError: true, content: [{ type: 'text', text: 'mterm_qualification_blocked: command not found' }] };
  assert.equal(isBlockedProbe(notFound, command, false), false);
  const blocked = { isError: true, content: [{ type: 'text', text: 'Error: Command not allowed: ' + command }],
    structuredContent: { blocked: true, command } };
  assert.equal(isBlockedProbe(blocked, command, false), true);
  assert.equal(isBlockedProbe(blocked, command, true), false);
  assert.equal(isBlockedProbe(blocked, 'another-command', false), false);
});

test('configuration proof validates returned ownership and policy fields, not only an object', () => {
  const expected = { allowedDirectories: ['/owned/fixtures'], telemetryEnabled: false, blockedCommands: ['mterm_qualification_blocked'] };
  const wrong = { structuredContent: { config: { allowedDirectories: ['/outside'], telemetryEnabled: true, blockedCommands: [] } } };
  assert.equal(isOwnedConfiguration(wrong, expected), false);
  assert.equal(isOwnedConfiguration({ structuredContent: { config: { ...expected, harmlessExtra: true } } }, expected), true);
  assert.equal(isOwnedConfiguration({ isError: true, structuredContent: { config: expected } }, expected), false);
});

test('tail proof rejects a full buffer or oversized output that happens to contain the last marker', () => {
  const response = lines => ({ content: [{ type: 'text', text: lines.join('\n') }] });
  assert.equal(isBoundedProcessTail(response(Array.from({ length: 300 }, (_, i) => 'MTERM_PROCESS_LINE_' + i))), false);
  assert.equal(isBoundedProcessTail(response([297, 298, 299].map(i => 'MTERM_PROCESS_LINE_' + i))), true);
  assert.equal(isBoundedProcessTail(response(['x'.repeat(100000), 'MTERM_PROCESS_LINE_297', 'MTERM_PROCESS_LINE_298', 'MTERM_PROCESS_LINE_299'])), false);
  assert.equal(isBoundedProcessTail(response(['MTERM_PROCESS_LINE_297', 'MTERM_PROCESS_LINE_299'])), false);
});

test('import is inert and the real entry refuses local execution before mutation', async () => {
  await assert.rejects(runQualification({ env: {} }), /qualification_host/);
});

test('targeted upstream bump preserves every existing unrelated dependency and native platform selector', async () => {
  const control = JSON.parse(await fs.readFile(new URL('../qualification/control-package-lock.json', import.meta.url), 'utf8'));
  const candidate = JSON.parse(await fs.readFile(new URL('../upstream-package-lock.json', import.meta.url), 'utf8'));
  for (const [name, entry] of Object.entries(control.packages)) {
    if (name === '' || name === 'node_modules/@wonderwhy-er/desktop-commander' ||
        name === 'node_modules/@wonderwhy-er/desktop-commander/node_modules/@desktop-commander/telemetry-contract') continue;
    assert.deepEqual(candidate.packages[name], entry, name + ' must keep its reviewed version, integrity and platform restrictions');
  }
  assert.equal(candidate.packages['node_modules/@modelcontextprotocol/sdk'].version, '1.32.2');
});

async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'mterm-qualification-unit-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const runnerTemp = path.join(parent, 'runner-temp'), sourceRoot = path.join(parent, 'source');
  await fs.mkdir(runnerTemp); await fs.mkdir(sourceRoot);
  const workspace = await createQualificationWorkspace({ runnerTemp, sourceRoot });
  return { parent, runnerTemp, sourceRoot, workspace };
}

async function fakeInstallation(workspace) {
  const install = path.join(workspace.root, 'candidate', 'install');
  const packageRoot = path.join(install, 'node_modules', '@wonderwhy-er', 'desktop-commander');
  await fs.mkdir(path.join(packageRoot, 'dist'), { recursive: true });
  await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: '@wonderwhy-er/desktop-commander', version, bin: { 'desktop-commander': 'dist/index.js' },
  }));
  await fs.writeFile(path.join(packageRoot, 'dist/index.js'), '// inert unit fixture; never executed\n');
  await fs.writeFile(path.join(install, 'package.json'), JSON.stringify({ dependencies: { '@wonderwhy-er/desktop-commander': version } }));
  await fs.writeFile(path.join(install, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
    '': { dependencies: { '@wonderwhy-er/desktop-commander': version } },
    'node_modules/@wonderwhy-er/desktop-commander': { version, integrity,
      resolved: 'https://registry.npmjs.org/@wonderwhy-er/desktop-commander/-/desktop-commander-0.3.3.tgz' },
  } }));
  return { install, packageRoot };
}

test('real qualification requires explicit disposable hosted Linux/Windows Node24 context', () => {
  assert.doesNotThrow(() => validateQualificationHost(host, 'linux', '24.22.1'));
  assert.doesNotThrow(() => validateQualificationHost(host, 'win32', '24.22.1'));
  for (const env of [{}, { ...host, RUNNER_ENVIRONMENT: 'self-hosted' }, { ...host, CI: 'false' },
    { ...host, GITHUB_ACTIONS: 'false' }, { ...host, MTERM_DISPOSABLE_UPSTREAM_QUALIFICATION: undefined },
    { ...host, GITHUB_SHA: 'main' }, { ...host, RUNNER_TEMP: 'relative' }]) {
    assert.throws(() => validateQualificationHost(env, 'linux', '24.22.1'), /qualification_host/);
  }
  assert.throws(() => validateQualificationHost(host, 'darwin', '24.22.1'), /qualification_host/);
  assert.throws(() => validateQualificationHost(host, 'linux', '27.0.0-alpha'), /qualification_host/);
});

test('new owned workspaces canonicalize ordinary temporary names and separate stores from source', async t => {
  const { workspace, runnerTemp, sourceRoot } = await fixture(t);
  assert.equal(path.dirname(workspace.root), await fs.realpath(runnerTemp));
  assert.equal(await fs.realpath(workspace.root), workspace.root);
  assert.notEqual(workspace.root, sourceRoot);
  await assertOwnedWorkspace(workspace);
  for (const lane of ['control', 'candidate']) for (const sub of ['install', 'home', 'state', 'fixtures', 'temp']) {
    assert.equal((await fs.stat(path.join(workspace.root, lane, sub))).isDirectory(), true);
  }
  if (process.platform !== 'win32') assert.equal((await fs.stat(workspace.root)).mode & 0o077, 0);
});

test('overlapping or linked runner roots fail before creating a qualification store', async t => {
  const { runnerTemp, sourceRoot, parent } = await fixture(t);
  await assert.rejects(createQualificationWorkspace({ runnerTemp: sourceRoot, sourceRoot }), /qualification_root/);
  await assert.rejects(createQualificationWorkspace({ runnerTemp, sourceRoot: parent }), /qualification_root/);
  const linked = path.join(parent, 'linked');
  await fs.symlink(runnerTemp, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createQualificationWorkspace({ runnerTemp: linked, sourceRoot }), /qualification_root/);
});

test('replacement directory or owner marker cannot be reused as the admitted workspace', async t => {
  const { workspace } = await fixture(t);
  const old = workspace.root + '-saved';
  await fs.rename(workspace.root, old); await fs.mkdir(workspace.root);
  await fs.copyFile(path.join(old, 'owner.json'), path.join(workspace.root, 'owner.json'));
  await assert.rejects(assertOwnedWorkspace(workspace), /qualification_ownership/);
});

test('environment preserves Windows runtime essentials while removing credentials and preload hooks', async t => {
  const { workspace } = await fixture(t);
  const inherited = { PATH: '/trusted/bin', ProgramData: 'C:\\ProgramData', SystemRoot: 'C:\\Windows',
    GITHUB_TOKEN: 'secret', NODE_OPTIONS: '--require poison', NODE_PATH: '/poison', NPM_TOKEN: 'secret',
    AWS_SECRET_ACCESS_KEY: 'secret', CF_ACCESS_CLIENT_SECRET: 'secret', MCP_SERVER_URL: 'https://prod.invalid',
    DC_API_KEY: 'secret', USERPROFILE: '/real-user', HOME: '/real-user', npm_config_userconfig: '/real-npmrc' };
  const env = qualificationEnvironment(workspace, 'candidate', inherited, 'http://127.0.0.1:32123/flags');
  assert.equal(env.ProgramData, inherited.ProgramData); assert.equal(env.SystemRoot, inherited.SystemRoot);
  assert.equal(env.HOME, path.join(workspace.root, 'candidate/home'));
  assert.equal(env.USERPROFILE, env.HOME);
  assert.equal(env.DESKTOP_COMMANDER_DISABLE_TELEMETRY, '1');
  assert.equal(env.DC_FLAG_URL, 'http://127.0.0.1:32123/flags');
  for (const key of ['GITHUB_TOKEN', 'NODE_OPTIONS', 'NODE_PATH', 'NPM_TOKEN', 'AWS_SECRET_ACCESS_KEY',
    'CF_ACCESS_CLIENT_SECRET', 'MCP_SERVER_URL', 'DC_API_KEY']) assert.equal(env[key], undefined, key);
  assert.doesNotMatch(JSON.stringify(env), /secret|real-user|real-npmrc|poison|prod.invalid/);
});

test('feature flags cannot redirect qualification to arbitrary or authenticated endpoints', async t => {
  const { workspace } = await fixture(t);
  for (const url of ['https://example.com/flags', 'http://localhost:12/flags', 'http://127.0.0.1:12/other',
    'http://secret@127.0.0.1:12/flags', 'http://127.0.0.1:12/flags?key=secret']) {
    assert.throws(() => qualificationEnvironment(workspace, 'candidate', {}, url), /qualification_flags/);
  }
  assert.throws(() => qualificationEnvironment(workspace, '../prod', {}, 'http://127.0.0.1:12/flags'), /qualification_lane/);
});

test('installed entry admission binds exact name, version, lock pin, integrity and owned path', async t => {
  const { workspace } = await fixture(t);
  const { packageRoot } = await fakeInstallation(workspace);
  const result = await admitInstalledUpstream(workspace, 'candidate', { version, integrity });
  assert.equal(result.entryPath, path.join(packageRoot, 'dist/index.js'));
  assert.match(result.entrySha256, /^[a-f0-9]{64}$/);
  await assert.rejects(admitInstalledUpstream(workspace, 'candidate', { version: '0.3.1', integrity }), /qualification_package/);
  await assert.rejects(admitInstalledUpstream(workspace, 'candidate', { version, integrity: integrity + 'bad' }), /qualification_package/);
});

test('retargeted package bin, linked entry and replaced install directory are rejected', async t => {
  const { workspace, parent } = await fixture(t);
  const { packageRoot, install } = await fakeInstallation(workspace);
  const manifest = path.join(packageRoot, 'package.json');
  const original = await fs.readFile(manifest, 'utf8');
  await fs.writeFile(manifest, original.replace('dist/index.js', '../../../outside.js'));
  await assert.rejects(admitInstalledUpstream(workspace, 'candidate', { version, integrity }), /qualification_package/);
  await fs.writeFile(manifest, original);
  await fs.rename(install, path.join(parent, 'external'));
  await fs.symlink(path.join(parent, 'external'), install, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(admitInstalledUpstream(workspace, 'candidate', { version, integrity }), /qualification_path/);
});

const tools = [
  { name: 'read', description: 'Old description', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, annotations: { readOnlyHint: true } },
  { name: 'write', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } },
];
test('contract comparison covers each name, input schema and annotation independent of list order', () => {
  assert.deepEqual(compareToolContracts(tools, [...tools].reverse()).contractChanges, []);
  const changed = structuredClone(tools); changed[0].inputSchema.required = [];
  assert.deepEqual(compareToolContracts(tools, changed).contractChanges, [{ name: 'read', fields: ['inputSchema'] }]);
  changed[0].annotations.readOnlyHint = false;
  assert.deepEqual(compareToolContracts(tools, changed).contractChanges[0].fields, ['inputSchema', 'annotations']);
  assert.deepEqual(compareToolContracts(tools, [tools[0]]).removed, ['write']);
  assert.deepEqual(compareToolContracts([tools[0]], tools).added, ['write']);
  assert.throws(() => compareToolContracts(tools, [tools[0], tools[0]]), /qualification_inventory/);
});

test('description changes are recorded without weakening contract checks', () => {
  const changed = structuredClone(tools); changed[0].description = 'New\nreadable description';
  const report = compareToolContracts(tools, changed);
  assert.deepEqual(report.contractChanges, []); assert.deepEqual(report.descriptionChanges, ['read']);
  assert.match(report.controlSha256, /^[a-f0-9]{64}$/); assert.notEqual(report.controlSha256, report.candidateSha256);
});
