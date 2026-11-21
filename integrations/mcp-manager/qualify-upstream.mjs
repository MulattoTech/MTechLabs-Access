// SPDX-License-Identifier: MIT
// AI-Change: 2026-11-12-upstream-033 (OpenAI / GPT-6 Astra Pro; self-reported)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { ConfiguredStdioTransport } from './verify-clients.mjs';
import { inspectToolInventory, EXPECTED_MANAGED_TOOLS } from './lib/verification-inventory.mjs';
import { readCoordinatorStatus } from './lib/coordinator.mjs';
import { atomicWriteJson } from './lib/policy.mjs';
import { recordPdfPhase } from './lib/pdf-phase-trace.mjs';
import {
  validateQualificationHost, createQualificationWorkspace, assertOwnedWorkspace,
  qualificationEnvironment, admitInstalledUpstream, compareToolContracts, sha256, isBlockedProbe,
  isOwnedConfiguration, isBoundedProcessTail, parseSearchProbe, observeToolFailure,
} from './lib/upstream-qualification.mjs';

const exec = promisify(execFile);
const managerRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(managerRoot, '../..');
const resultText = result => (result.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const searchObservation = result => {
  const input = result?.structuredContent ?? {}, output = { isError: result?.isError === true, structured: !!result?.structuredContent };
  for (const key of ['isComplete', 'totalResults', 'totalMatches', 'returnedCount', 'hasMoreResults']) {
    if (typeof input[key] === 'boolean' || (typeof input[key] === 'number' && Number.isFinite(input[key]))) output[key] = input[key];
  }
  if (['running', 'completed', 'failed', 'partial', 'timed_out', 'stopped', 'max_results'].includes(input.outcome)) output.outcome = input.outcome;
  output.hasSessionId = typeof input.sessionId === 'string';
  return output;
};
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const quote = value => process.platform === 'win32' ? "'" + value.replaceAll("'", "''") + "'" : "'" + value.replaceAll("'", "'\\''") + "'";
const shell = () => process.platform === 'win32'
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/sh';

async function until(predicate, timeoutMs, code) {
  const deadline = Date.now() + timeoutMs;
  do { if (await predicate()) return; await delay(100); } while (Date.now() < deadline);
  throw new Error(code);
}

async function writeReport(workspace, name, value) {
  await assertOwnedWorkspace(workspace);
  await fs.writeFile(path.join(workspace.root, 'reports', name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

async function npmCommand(npmEntry, args, { cwd, env, reportFile }) {
  try {
    const result = await exec(process.execPath, [npmEntry, ...args], { cwd, env, windowsHide: true,
      timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
    await fs.writeFile(reportFile, result.stdout + result.stderr, { mode: 0o600 });
  } catch (error) {
    await fs.writeFile(reportFile, (error.stdout ?? '') + (error.stderr ?? ''), { mode: 0o600 });
    throw new Error('qualification_dependency_install_failed');
  }
}

async function prepareLane(workspace, lane, env, npmEntry, expected) {
  await assertOwnedWorkspace(workspace);
  const root = path.join(workspace.root, lane), install = path.join(root, 'install');
  for (const [name, origin] of [['package.json', lane === 'control' ? 'qualification/control-package.json' : 'upstream-package.json'],
    ['package-lock.json', lane === 'control' ? 'qualification/control-package-lock.json' : 'upstream-package-lock.json']]) {
    await fs.copyFile(path.join(managerRoot, origin), path.join(install, name));
  }
  for (const directory of [env.APPDATA, env.LOCALAPPDATA, env.XDG_CONFIG_HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME,
    path.join(env.HOME, '.claude-server-commander')]) await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  for (const file of [env.npm_config_userconfig, env.npm_config_globalconfig]) await fs.writeFile(file, '', { flag: 'wx', mode: 0o600 });
  await fs.writeFile(path.join(env.HOME, '.claude-server-commander/config.json'), JSON.stringify({
    telemetryEnabled: false, allowedDirectories: [path.join(root, 'fixtures')],
    defaultShell: shell(), blockedCommands: ['mterm_qualification_blocked'],
    fileReadLineLimit: 1000, fileWriteLineLimit: 1000,
    welcomeOnboardingEligible: false, pendingWelcomeOnboarding: false,
  }), { flag: 'wx', mode: 0o600 });
  await npmCommand(npmEntry, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: install, env, reportFile: path.join(workspace.root, 'reports', lane + '-install.log'),
  });
  // The exact lock contains @vscode/ripgrep1.18.0, whose platform binaries ship
  // as optional npm packages. It has no postinstall/downloader to rebuild.
  const nativeName = `@vscode/ripgrep-${process.platform}-${process.arch}`;
  const nativeRoot = path.join(install, 'node_modules', nativeName);
  const nativePackage = JSON.parse(await fs.readFile(path.join(nativeRoot, 'package.json'), 'utf8'));
  assert.equal(nativePackage.name, nativeName); assert.equal(nativePackage.version, '1.18.0');
  const rgPath = path.join(nativeRoot, 'bin', process.platform === 'win32' ? 'rg.exe' : 'rg');
  const rgResult = await exec(rgPath, ['--version'], { cwd: install, env, windowsHide: true, timeout: 10000, maxBuffer: 16384 });
  const native = { package: nativeName, version: nativePackage.version, executable: rgPath,
    sha256: sha256(await fs.readFile(rgPath)), versionOutput: rgResult.stdout.slice(0, 1024) };
  await writeReport(workspace, lane + '-native-prerequisites.json', native);
  const admitted = await admitInstalledUpstream(workspace, lane, expected);
  const config = { schemaVersion: 1, nodePath: process.execPath, serverPath: admitted.entryPath,
    serverPackageJsonPath: admitted.packagePath, stateDirectory: path.join(root, 'state'),
    policyPath: path.join(root, 'state/policy.json'), tokenPath: path.join(root, 'state/unused-token'),
    inventoryPath: path.join(root, 'state/inventory.json'), minimumFreeMemoryMiB: 256, minimumFreeDiskMiB: 256 };
  await atomicWriteJson(config.policyPath, { enabled: true, readOnly: false, maxInflight: 1 });
  const configPath = path.join(root, 'state/manager.json');
  await fs.writeFile(configPath, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
  return { root, config, configPath, admitted };
}

async function qualifyLane(workspace, lane, env, prepared, expected) {
  const { root, config, configPath } = prepared;
  const report = { lane, version: expected.version, integrity: expected.integrity, admitted: prepared.admitted,
    stages: [], initialized: false, childExited: false, upstreamExited: false, pass: false };
  const client = new Client({ name: 'mterm-disposable-upstream-qualification', version: '1.0.0' }, { capabilities: {} });
  const transport = new ConfiguredStdioTransport({ command: process.execPath,
    args: [path.join(managerRoot, 'gateway.mjs'), '--config', configPath, '--client', 'qualification-' + lane],
    cwd: managerRoot, env, env_vars: [] });
  const fixtureRoot = path.join(root, 'fixtures');
  let stage = 'initialize', managedPid, upstreamPid, ownedPids = [];
  const stageRun = async (name, action) => {
    stage = name; const started = Date.now(); await assertOwnedWorkspace(workspace); await action();
    report.stages.push({ name, pass: true, durationMs: Date.now() - started });
  };
  const call = async (name, args, timeout = 30000) => {
    const response = await client.callTool({ name, arguments: args }, CallToolResultSchema, { timeout });
    if (response.isError === true && stage === 'pdf_create_and_read_fidelity' && name === 'write_pdf') {
      report.pdfFailure = { tool: name, stage, fixture: 'owned-fixed-markdown-v1', ...observeToolFailure(response) };
    }
    assert.notEqual(response.isError, true, name + '_tool_error');
    return response;
  };
  try {
    await stageRun('initialize', async () => {
      await client.connect(transport, { timeout: 60000 }); report.initialized = true;
      const instances = (await fs.readdir(path.join(config.stateDirectory, 'instances')))
        .filter(name => /^[a-f0-9-]{36}\.json$/i.test(name));
      assert.equal(instances.length, 1, 'unexpected_gateway_instances');
      const instance = JSON.parse(await fs.readFile(path.join(config.stateDirectory, 'instances', instances[0]), 'utf8'));
      assert.equal(instance.pid, transport.pid); assert.ok(Number.isInteger(instance.serverPid) && instance.serverPid > 0);
      upstreamPid = instance.serverPid; report.gatewayPid = transport.pid; report.upstreamPid = upstreamPid;
    });
    await stageRun('full_tool_contract', async () => {
      const inventory = await inspectToolInventory(client);
      assert.equal(inventory.toolCount, EXPECTED_MANAGED_TOOLS.length, 'unexpected_additional_tools');
      report.tools = inventory.tools; report.toolCount = inventory.toolCount;
      await writeReport(workspace, lane + '-tools.json', inventory.tools);
    });
    await stageRun('owned_configuration', async () => {
      const response = await call('get_config', {});
      assert.equal(isOwnedConfiguration(response, { telemetryEnabled: false, allowedDirectories: [fixtureRoot],
        blockedCommands: ['mterm_qualification_blocked'], defaultShell: shell() }), true, 'upstream_returned_configuration_mismatch');
      const stored = JSON.parse(await fs.readFile(path.join(env.HOME, '.claude-server-commander/config.json'), 'utf8'));
      assert.equal(stored.telemetryEnabled, false); assert.deepEqual(stored.allowedDirectories, [fixtureRoot]);
    });
    await stageRun('file_read_write_metadata', async () => {
      const file = path.join(fixtureRoot, 'roundtrip.txt'), contents = 'MTERM_QUALIFICATION_ALPHA\nUnicode: café 雪\n';
      await call('write_file', { path: file, content: contents, mode: 'rewrite' });
      assert.equal(await fs.readFile(file, 'utf8'), contents, 'file_bytes_mismatch');
      assert.match(resultText(await call('read_file', { path: file })), /MTERM_QUALIFICATION_ALPHA/);
      assert.ok(resultText(await call('get_file_info', { path: file })).length > 0);
    });
    await stageRun('manager_read_only_denial', async () => {
      const target = path.join(fixtureRoot, 'must-not-exist.txt');
      await atomicWriteJson(config.policyPath, { enabled: true, readOnly: true, maxInflight: 1 });
      await assert.rejects(client.callTool({ name: 'write_file', arguments: { path: target, content: 'denied' } },
        CallToolResultSchema, { timeout: 10000 }), { code: -32011 });
      await assert.rejects(fs.stat(target), { code: 'ENOENT' });
      await atomicWriteJson(config.policyPath, { enabled: true, readOnly: false, maxInflight: 1 });
    });
    await stageRun('content_search_completion_and_pagination', async () => {
      const searchRoot = path.join(fixtureRoot, 'search'); await fs.mkdir(searchRoot);
      for (let index = 0; index < 6; index++) await fs.writeFile(path.join(searchRoot, `match-${index}.txt`), `MTERM_SEARCH_NEEDLE_${index}\n`);
      const start = await call('start_search', { path: searchRoot, pattern: 'MTERM_SEARCH_NEEDLE', searchType: 'content', contextLines: 0,
        timeout_ms: 10000, maxResults: 20, literalSearch: true });
      const started = parseSearchProbe(start, { kind: 'start', root: searchRoot });
      report.search = { start: { ...searchObservation(start), public: started } };
      const sessionId = started.sessionId;
      let page;
      await until(async () => { const response = await call('get_more_search_results', { sessionId, offset: 0, length: 2 });
        page = parseSearchProbe(response, { kind: 'page', root: searchRoot, sessionId, offset: 0, length: 2 });
        report.search.firstPage = page; return page.isComplete; }, 15000, 'search_completion_timeout');
      assert.equal(page.outcome, 'completed', 'search_outcome_not_completed');
      assert.equal(page.totalMatches, 6, 'search_match_count_mismatch');
      assert.equal(page.returnedCount, 2, 'search_first_page_count_mismatch');
      assert.equal(page.hasMoreResults, true, 'search_first_page_more_mismatch');
      const middle = parseSearchProbe(await call('get_more_search_results', { sessionId, offset: 2, length: 2 }),
        { kind: 'page', root: searchRoot, sessionId, offset: 2, length: 2, requireComplete: true });
      report.search.middlePage = middle;
      const tail = await call('get_more_search_results', { sessionId, offset: 4, length: 2 });
      const last = parseSearchProbe(tail, { kind: 'page', root: searchRoot, sessionId, offset: 4, length: 2, requireComplete: true });
      report.search.lastPage = last;
      assert.equal(last.returnedCount, 2, 'search_last_page_count_mismatch');
      assert.equal(last.hasMoreResults, false, 'search_last_page_more_mismatch');
      assert.deepEqual([...page.markers, ...middle.markers, ...last.markers].sort(), [0, 1, 2, 3, 4, 5], 'search_page_coverage_mismatch');
    });
    await stageRun('shell_blocklist', async () => {
      const marker = path.join(fixtureRoot, 'blocked-prefix-must-not-run.txt');
      const prefixScript = path.join(fixtureRoot, 'blocked-prefix.cjs');
      await fs.writeFile(prefixScript, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected execution');`);
      const command = (process.platform === 'win32' ? '& ' : '') + quote(process.execPath) + ' ' + quote(prefixScript) + '; mterm_qualification_blocked';
      const response = await client.callTool({ name: 'start_process', arguments: { command, shell: shell(), timeout_ms: 1000 } }, CallToolResultSchema, { timeout: 10000 });
      let markerExists = true;
      try { await fs.stat(marker); } catch (error) { if (error.code !== 'ENOENT') throw error; markerExists = false; }
      assert.equal(isBlockedProbe(response, command, markerExists), true, 'blocked_command_was_not_rejected_before_execution');
    });
    await stageRun('owned_process_output_and_tree_cleanup', async () => {
      const marker = path.join(fixtureRoot, 'owned-process.json'), script = path.join(fixtureRoot, 'owned-process.cjs');
      const source = `const fs=require('node:fs');const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({nonce:${JSON.stringify(workspace.nonce)},pid:process.pid,childPid:child.pid}));for(let i=0;i<300;i++)console.log('MTERM_PROCESS_LINE_'+i);setInterval(()=>{},1000);`;
      await fs.writeFile(script, source);
      const command = (process.platform === 'win32' ? '& ' : '') + quote(process.execPath) + ' ' + quote(script);
      const response = await call('start_process', { command, shell: shell(), timeout_ms: 1000 });
      managedPid = Number(resultText(response).match(/^Process started with PID ([1-9]\d*) \(shell: [^\n]+\)\n/)?.[1]);
      assert.ok(Number.isInteger(managedPid) && managedPid > 0, 'missing_managed_process_pid');
      let markerValue;
      await until(async () => { try { markerValue = JSON.parse(await fs.readFile(marker, 'utf8')); return true; } catch { return false; } }, 10000, 'owned_process_start_timeout');
      assert.equal(markerValue.nonce, workspace.nonce); ownedPids = [markerValue.pid, markerValue.childPid];
      assert.ok(ownedPids.every(pid => Number.isInteger(pid) && pid > 0 && alive(pid)), 'owned_process_identity_missing');
      assert.equal(isBoundedProcessTail(await call('read_process_output', { pid: managedPid, offset: -3, length: 3, timeout_ms: 1000 })),
        true, 'process_output_tail_not_bounded');
      // 0.3.3 changed kill_process to use the same managed-session tree cleanup.
      // The control exercises its existing force_terminate contract instead.
      report.terminationTool = lane === 'candidate' ? 'kill_process' : 'force_terminate';
      await call(report.terminationTool, { pid: managedPid }); managedPid = undefined;
      await until(() => ownedPids.every(pid => !alive(pid)), 15000, 'owned_process_tree_still_alive');
      report.ownedProcessTreeExited = true;
    });
    await stageRun('pdf_create_and_read_fidelity', async () => {
      const pdf = path.join(fixtureRoot, 'qualification.pdf');
      await recordPdfPhase(report, 'write_pdf_rpc', async () => {
        await call('write_pdf', { path: pdf, content: '# MTERM PDF FIXTURE\n\nDisposable qualification document.\n' }, 90000);
      });
      let bytes;
      await recordPdfPhase(report, 'pdf_magic_and_size', async () => {
        bytes = await fs.readFile(pdf);
        assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
        assert.ok(bytes.length > 1000);
      });
      await recordPdfPhase(report, 'read_pdf_fidelity', async () => {
        assert.match(resultText(await call('read_file', { path: pdf }, 90000)), /MTERM PDF FIXTURE/);
      });
      report.pdfSha256 = sha256(bytes); report.pdfBytes = bytes.length;
    });
    await stageRun('admission_released', async () => {
      const status = await readCoordinatorStatus(config.stateDirectory, { policyPath: config.policyPath });
      assert.equal(status.available, true); assert.equal(status.inflight, 0); assert.equal(status.queued, 0); assert.equal(status.uncertain, 0);
    });
  } catch (error) {
    report.failedStage = stage; report.failureCode = /^[a-z][a-z0-9_]{1,100}$/i.test(error.message ?? '') ? error.message : 'qualification_assertion_failed';
    report.rpcErrorCode = Number.isInteger(error.code) ? error.code : null;
  } finally {
    if (managedPid) {
      try { await atomicWriteJson(config.policyPath, { enabled: true, readOnly: false, maxInflight: 1 }); await call('force_terminate', { pid: managedPid }); }
      catch { report.processCleanupUncertain = true; }
    }
    await client.close().catch(() => {}); await transport.close().catch(() => {});
    let timer;
    const closed = await Promise.race([transport.completed, new Promise(resolve => { timer = setTimeout(() => resolve({ exited: false }), 20000); })]);
    clearTimeout(timer); report.childExited = closed.exited; report.childExitCode = closed.exitCode ?? null;
    report.upstreamExited = upstreamPid !== undefined && !alive(upstreamPid);
    report.ownedProcessTreeExited = ownedPids.every(pid => !alive(pid));
    if (!closed.exited) transport.releaseWaitingHandles();
    report.pass = report.initialized && !report.failedStage && closed.exited && closed.exitCode === 0 && !closed.signaled &&
      report.upstreamExited && report.ownedProcessTreeExited && !report.processCleanupUncertain;
    await writeReport(workspace, lane + '-result.json', { ...report, tools: undefined });
  }
  return report;
}

export async function runQualification({ env = process.env } = {}) {
  validateQualificationHost(env); // Must precede installation, mutation and process launch.
  const npmEntry = env.npm_execpath;
  if (!npmEntry || !path.isAbsolute(npmEntry) || !(await fs.stat(npmEntry)).isFile()) throw new Error('qualification_npm_entry_required');
  const git = async args => (await exec('git', args, { cwd: sourceRoot, windowsHide: true, timeout: 10000 })).stdout.trim();
  const sourceSha = await git(['rev-parse', 'HEAD']); assert.equal(sourceSha, env.GITHUB_SHA, 'qualification_source_sha_mismatch');
  assert.equal(await git(['status', '--porcelain', '--untracked-files=no']), '', 'qualification_source_dirty');
  const workspace = await createQualificationWorkspace({ runnerTemp: env.RUNNER_TEMP, sourceRoot });
  const managerPackage = JSON.parse(await fs.readFile(path.join(managerRoot, 'package.json'), 'utf8'));
  const sdkPackage = JSON.parse(await fs.readFile(path.join(managerRoot, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8'));
  assert.equal(sdkPackage.version, '1.32.2', 'qualification_sdk_mismatch');
  const report = { schemaVersion: 1, testedAt: new Date().toISOString(), sourceSha, sourceTree: await git(['rev-parse', 'HEAD^{tree}']),
    candidateSha: env.MTERM_QUALIFICATION_CANDIDATE_SHA ?? sourceSha, platform: process.platform, arch: process.arch,
    node: process.version, libuv: process.versions.uv, host: 'github-hosted', managerVersion: managerPackage.version, sdkVersion: sdkPackage.version,
    launch: 'managed gateway -> node dist/index.js --no-onboarding (stdio)', modelCalls: 0, lanes: [], pass: false,
    limitations: ['No production deployment, credentials, account OAuth, public remote mode, Docker or macOS qualification.',
      'Environment redirection is not OS isolation; the fresh disposable hosted account is required.',
      'Package installation includes prebuilt ripgrep artifacts and uses the network; upstream may discover or download Chrome.',
      'This is a bounded compatibility qualification, not full security certification or full mission acceptance.'] };
  const flags = createServer((request, response) => {
    if (request.url !== '/flags') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ version: 'qualification', flags: {} }));
  });
  await new Promise((resolve, reject) => { flags.once('error', reject); flags.listen(0, '127.0.0.1', resolve); });
  const flagUrl = `http://127.0.0.1:${flags.address().port}/flags`;
  try {
    const delta = JSON.parse(await fs.readFile(path.join(managerRoot, 'qualification/lock-delta.json'), 'utf8'));
    for (const lane of ['control', 'candidate']) {
      const expected = { version: delta[lane + 'Version'], integrity: delta[lane + 'Integrity'] };
      const childEnv = qualificationEnvironment(workspace, lane, env, flagUrl);
      const prepared = await prepareLane(workspace, lane, childEnv, npmEntry, expected);
      report.lanes.push(await qualifyLane(workspace, lane, childEnv, prepared, expected));
    }
    if (report.lanes.every(lane => lane.tools)) {
      report.contractComparison = compareToolContracts(report.lanes[0].tools, report.lanes[1].tools);
      await writeReport(workspace, 'tool-contract-comparison.json', report.contractComparison);
    }
    const comparison = report.contractComparison;
    report.pass = report.lanes.length === 2 && report.lanes.every(lane => lane.pass) && !!comparison &&
      comparison.added.length === 0 && comparison.removed.length === 0 && comparison.contractChanges.length === 0;
  } catch (error) {
    report.failureCode = /^[a-z][a-z0-9_]{1,100}$/i.test(error.message ?? '') ? error.message : 'qualification_setup_failed';
  } finally {
    flags.closeAllConnections(); await new Promise(resolve => flags.close(resolve));
    report.lanes = report.lanes.map(({ tools, ...lane }) => lane);
    report.completedAt = new Date().toISOString();
    await writeReport(workspace, 'qualification.json', report);
    console.log(JSON.stringify({ pass: report.pass, sourceSha, platform: report.platform, lanes: report.lanes.map(lane => ({ lane: lane.lane, pass: lane.pass, failedStage: lane.failedStage })), reportDirectory: path.join(workspace.root, 'reports') }));
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('qualification_arguments');
    if (!(await runQualification()).pass) process.exitCode = 1;
  } catch (error) {
    console.error(/^[a-z][a-z0-9_]{1,100}$/i.test(error.message ?? '') ? error.message : 'qualification_failed'); process.exitCode = 1;
  }
}
