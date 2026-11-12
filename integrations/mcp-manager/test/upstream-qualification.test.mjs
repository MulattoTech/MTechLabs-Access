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
  isOwnedConfiguration, isBoundedProcessTail, parseSearchProbe, observeToolFailure,
} from '../lib/upstream-qualification.mjs';
import { runQualification } from '../qualify-upstream.mjs';

const host = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
  MTERM_DISPOSABLE_UPSTREAM_QUALIFICATION: '1', GITHUB_SHA: 'a'.repeat(40), RUNNER_TEMP: os.tmpdir() };
const version = '0.3.3';
const integrity = 'sha512-' + Buffer.alloc(64, 7).toString('base64');

test('hosted tool failures retain fixed diagnostic signals and hashes without raw error payloads', () => {
  const secret = 'fixture-secret-value-not-to-log';
  const message = `Error: Failed to launch the browser process!\nNo usable sandbox!\n/home/private/${secret}\nhttps://user:${secret}@example.invalid/?token=${secret}`;
  const result = observeToolFailure({ isError: true, content: [{ type: 'text', text: message }] });
  assert.deepEqual(result.signals, ['browser_launch', 'browser_sandbox']);
  assert.equal(result.textBytes, Buffer.byteLength(message));
  assert.match(result.textSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.malformed, false); assert.equal(result.textEncoding, 'utf-8');
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|private|example|https|No usable/);
  const missing = observeToolFailure({ isError: true, content: [{ type: 'text', text: 'Cannot find package secret-package; ERR_MODULE_NOT_FOUND' }] });
  assert.deepEqual(missing.signals, ['module_load']);
  assert.deepEqual(missing.errorCodes, ['ERR_MODULE_NOT_FOUND']);
  assert.doesNotMatch(JSON.stringify(missing), /secret-package/);
  const unknown = observeToolFailure({ isError: true, content: [{ type: 'text', text: secret.repeat(2000) }] });
  assert.deepEqual(unknown.signals, []); assert.equal(unknown.inspectionTruncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(unknown)) < 1024);
  const malformed = observeToolFailure({ isError: true, content: [{ type: 'image', data: secret }] });
  assert.equal(malformed.malformed, true); assert.equal(malformed.textSha256, null); assert.deepEqual(malformed.signals, []);
  assert.doesNotMatch(JSON.stringify(malformed), /fixture-secret/);
});

const searchRoot = path.resolve('/owned/search');
const searchId = 'search_1_1234567890123';
const wire = text => ({ content: [{ type: 'text', text }] });
// Public content rows contain the matched substring, not the entire file line.
const searchRows = markers => markers.map(i => '📄 ' + path.join(searchRoot, `match-${i}.txt`) + ':1 - MTERM_SEARCH_NEEDLE').join('\n');
const searchPage = (offset, markers, more) => wire(`Search session: ${searchId}\nStatus: COMPLETED\nRuntime: 1s\nTotal results: 6 matches\nShowing results ${offset}-${offset + markers.length - 1}\n\nResults:\n${searchRows(markers)}\n${more ? '\n📖 More results available. Use get_more_search_results with offset: ' + (offset + markers.length) + '\n' : ''}\n✅ Search completed.`);

test('qualification reads actual public text-only search receipts after upstream strips internal facts', () => {
  const start = wire(`Started content search session: ${searchId}\nPattern: "MTERM_SEARCH_NEEDLE"\nPath: ${searchRoot}\nStatus: COMPLETED\nRuntime: 12ms\nTotal results: 6 matches\n\nInitial results:\n${searchRows([0, 1, 2, 3, 4, 5])}\n\n✅ Search completed.`);
  const a = parseSearchProbe(start, { kind: 'start', root: searchRoot });
  assert.equal(a.sessionId, searchId); assert.equal(a.isComplete, true); assert.equal(a.totalMatches, 6);
  const b = parseSearchProbe(searchPage(0, [2, 5], true), { kind: 'page', root: searchRoot, sessionId: searchId, offset: 0, length: 2 });
  assert.deepEqual(b.markers, [2, 5]); assert.equal(b.returnedCount, 2); assert.equal(b.hasMoreResults, true);
  assert.equal(parseSearchProbe(searchPage(4, [1, 4], false), { kind: 'page', root: searchRoot, sessionId: searchId, offset: 4, length: 2 }).hasMoreResults, false);
});

test('public search accepts one running match and rejects inconsistent count grammar', () => {
  const start = wire(`Started content search session: ${searchId}\nPattern: "MTERM_SEARCH_NEEDLE"\nPath: ${searchRoot}\nStatus: RUNNING\nRuntime: 1ms\nTotal results: 1 match\n\nInitial results:\n${searchRows([0])}\n\nSearch in progress.`);
  const options = { kind: 'start', root: searchRoot };
  assert.equal(parseSearchProbe(start, options).totalMatches, 1);
  assert.equal(parseSearchProbe(start, options).isComplete, false);
  const page = wire(`Search session: ${searchId}\nStatus: IN PROGRESS\nRuntime: 0s\nTotal results: 1 match\nShowing results 0-0\n\nResults:\n${searchRows([0])}\n\nSearch in progress.`);
  assert.equal(parseSearchProbe(page, { kind: 'page', root: searchRoot, sessionId: searchId }).returnedCount, 1);
  assert.throws(() => parseSearchProbe(wire(start.content[0].text.replace('1 match\n', '1 matches\n')), options), /qualification_search_count_grammar/);
  assert.throws(() => parseSearchProbe(wire(start.content[0].text.replace('1 match\n', '2 match\n')), options), /qualification_search_count_grammar/);
});

test('every completed search page proves full count and range; later pages must remain complete', () => {
  const options = { kind: 'page', root: searchRoot, sessionId: searchId, offset: 2, length: 2, requireComplete: true };
  const middle = searchPage(2, [2, 3], true);
  const undercount = searchPage(2, [2, 3], false);
  assert.throws(() => parseSearchProbe(wire(undercount.content[0].text.replace('6 matches', '2 matches')), options), /qualification_search_completed_count|qualification_search_page_bounds/);
  assert.throws(() => parseSearchProbe(wire(middle.content[0].text.replace('COMPLETED', 'IN PROGRESS')), options), /qualification_search_not_complete/);
  assert.throws(() => parseSearchProbe(searchPage(6, [2, 3], false), { ...options, offset: 6 }), /qualification_search_page_bounds/);
  assert.throws(() => parseSearchProbe(searchPage(2, [2], true), options), /qualification_search_completed_page_count/);
  assert.equal(parseSearchProbe(middle, options).totalMatches, 6);
});

test('public search parsing refuses partial completion, duplicate or outside rows, stale IDs and oversized pages', () => {
  const options = { kind: 'page', root: searchRoot, sessionId: searchId, offset: 0, length: 2 };
  const good = searchPage(0, [0, 1], true);
  assert.throws(() => parseSearchProbe({ ...good, isError: true }, options), /qualification_search/);
  assert.throws(() => parseSearchProbe(wire(good.content[0].text.replace('✅ Search completed.', '✅ Search completed.\n⚠️ Permission warning')), options), /qualification_search_not_clean/);
  assert.throws(() => parseSearchProbe(searchPage(0, [0, 0], true), options), /qualification_search_duplicate_rows/);
  assert.throws(() => parseSearchProbe(searchPage(0, [0, 1, 2], true), options), /qualification_search_page_bounds/);
  assert.throws(() => parseSearchProbe(good, { ...options, sessionId: 'search_2_1234567890123' }), /qualification_search_identity/);
  assert.throws(() => parseSearchProbe(wire(good.content[0].text.replace(path.join(searchRoot, 'match-0.txt'), path.resolve('/outside/match-0.txt'))), options), /qualification_search_fixture_row/);
  assert.throws(() => parseSearchProbe(wire('x'.repeat(65537)), options), /qualification_search_wire/);
});

test('public blocklist proof accepts the two published wire forms without internal structured fields', () => {
  const command = 'safe-prefix; mterm_qualification_blocked';
  assert.equal(isBlockedProbe({ ...wire('Error: Command not allowed: ' + command), isError: true }, command, false), true);
  assert.equal(isBlockedProbe({ ...wire('Error: Command not allowed: "mterm_qualification_blocked" is in the blockedCommands setting.'), isError: true }, command, false), true);
  assert.equal(isBlockedProbe({ ...wire('Error: Command not allowed: the check for blocked commands failed (parser_error), so nothing was run.'), isError: true }, command, false), false);
});

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
