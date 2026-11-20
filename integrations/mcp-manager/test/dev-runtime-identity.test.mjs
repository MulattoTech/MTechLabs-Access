import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { captureWindowsRuntime, WINDOWS_POWERSHELL } from '../lib/runtime-identity.mjs';

const probe = fileURLToPath(new URL('../windows-runtime-probe.ps1', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/dev-runtime-identity.ps1', import.meta.url));
const listenerFixture = fileURLToPath(new URL('./fixtures/runtime-listener.mjs', import.meta.url));
const identityModule = new URL('../lib/runtime-identity.mjs', import.meta.url).href;
const hash = value => createHash('sha256').update(value).digest('hex');
const windowsOnly = process.platform !== 'win32' ? 'Requires hosted native Windows PowerShell 5.1' : false;
const titles = [
  'exact quoted listener invocation',
  'case variants preserve exact Windows paths',
  'tab separators use the native argument parser',
  'Unicode entry and config use the native argument parser',
  'native executable mismatch is unverified',
  'CIM executable mismatch is unverified',
  'entry suffix lookalike is unverified',
  'config suffix lookalike is unverified',
  'relative executable is unverified',
  'relative config is unverified',
  'extra private argument is rejected without disclosure',
  'literal config flag remains case sensitive',
  'Node preload flag is not the supported invocation',
  'missing command line is unverified',
  'NUL command line is unverified',
  'oversize command line is unverified',
  'wrong returned process PID is unverified',
  'ambiguous CIM process rows are unverified',
  'missing CIM creation time is unverified',
  'process query access failure is unverified',
  'native token or profile access failure is unverified',
  'native and CIM creation identities must agree',
  'malformed native creation time is unverified',
  'FILETIME submicrosecond remainder is accepted',
  'process creation change during inspection is unverified',
  'command change during inspection is unverified',
  'process disappearance disposes its retained snapshot',
  'exited native process is unverified',
  'no listener is absent',
  'listener query failure is not absence',
  'wildcard listener is unverified',
  'multiple listeners are unverified',
  'another local port is absent',
  'established connection is not a listener',
  'established connection does not hide a listener',
  'Bound state is not a listener',
  'null connection state is unverified',
  'unknown connection state is unverified',
  'Listen with a remote port is unverified',
  'zero listener PID is unverified',
  'changed final listener owner is unverified',
  'disappearing final listener is unverified',
  'ambiguous final listener disposes its snapshot',
  'final listener query failure disposes its snapshot',
  'current identity is the actual helper parent',
  'unrelated requested parent is unverified',
  'zero requested parent is unverified',
  'missing helper process is unverified',
  'missing parent process is unverified',
  'parent PID reused after helper creation is unverified',
  'parent native and CIM creation identities must agree',
  'parent executable mismatch is unverified',
  'exited parent is unverified and disposed',
  'unavailable parent token is unverified',
];

function cleanNodeEnvironment() {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return env;
}

async function within(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

if (process.platform !== 'win32') {
  test('runtime identity refuses unsupported operating systems before querying', async () => {
    await assert.rejects(captureWindowsRuntime(), { message: 'dev_runtime_platform_unsupported' });
  });
}

test('Windows DEV runtime probe qualifies invocation, listener state, process lifetime and disposal', {
  skip: windowsOnly, timeout: 45000,
}, async t => {
  const before = hash(fs.readFileSync(probe));
  const child = spawnSync(WINDOWS_POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fixture, '-ProbePath', probe], {
    cwd: path.dirname(fixture), env: cleanNodeEnvironment(), encoding: 'utf8', timeout: 30000,
    maxBuffer: 256 * 1024, windowsHide: true,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null, 'owned fixture must exit naturally');
  assert.equal(child.stderr, '', 'fixture must not emit uncontrolled diagnostics');
  const report = JSON.parse(child.stdout.replace(/^\uFEFF/, '').trim());
  t.diagnostic(JSON.stringify({ ...report, fixtureSha256: hash(fs.readFileSync(fixture)), childExitCode: child.status }));
  assert.equal(hash(fs.readFileSync(probe)), before, 'probe source must remain unchanged');
  assert.equal(report.sourceSha256, before);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.fixture, 'dev-runtime-identity');
  assert.equal(report.platform, 'Win32NT');
  assert.match(report.powerShellVersion, /^5\.1\./);
  assert.equal(report.powerShellEdition, 'Desktop');
  assert.equal(report.loadMode, 'top-level-function-definitions-only');
  assert.equal(report.executableBody, 'excluded-by-AST');
  assert.equal(report.listenerAndCimData, 'simulated');
  assert.equal(report.processSnapshots, 'simulated');
  assert.equal(report.argumentParser, 'native-CommandLineToArgvW');
  assert.ok(report.loadedFunctions.includes('Get-RuntimeCurrentObservation'));
  assert.ok(report.loadedFunctions.includes('Get-RuntimeListenerObservation'));
  assert.equal(report.blockedSideEffectAttempts, 0);
  assert.equal(report.queryFaults, 0);
  assert.equal(report.total, titles.length);
  assert.deepEqual(report.cases.map(value => value.name), titles);
  for (const observation of report.cases) {
    await t.test(observation.name, () => {
      assert.equal(observation.actual, observation.expected);
      assert.deepEqual(observation.queries, observation.expectedQueries);
      assert.equal(observation.identityPreserved, true);
      assert.equal(observation.privateArgumentLeaked, false);
      if (observation.actual === 'observed') assert.equal(observation.returnedPid, observation.expectedPid);
      assert.equal(observation.failed, false);
    });
  }
  assert.equal(report.failed, 0);
  assert.equal(report.passed, titles.length);
  assert.equal(child.status, 0);
});

test('native Windows identity inspects only its own Node parent and ignores spoofed profile environment', {
  skip: windowsOnly, timeout: 75000,
}, t => {
  const before = hash(fs.readFileSync(probe));
  // This owned child never requests a production/development listener. Env
  // changes remain inside it; no account, profile, state or network is created.
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import os from 'node:os';
    import path from 'node:path';
    import { captureWindowsRuntime, WINDOWS_POWERSHELL } from ${JSON.stringify(identityModule)};
    const canonical = value => path.win32.resolve(value).toLowerCase();
    const expectedProfile = canonical(os.userInfo().homedir);
    const first = await captureWindowsRuntime();
    assert.deepEqual(Object.keys(first).sort(), ['current', 'schemaVersion']);
    assert.equal(first.schemaVersion, 1);
    assert.equal(first.current.status, 'observed');
    assert.equal(first.current.pid, process.pid);
    assert.match(first.current.sid, /^S-1-5-21-\\d+-\\d+-\\d+-\\d+$/);
    assert.equal(canonical(first.current.profileDirectory), expectedProfile);
    assert.match(first.current.creationFileTime, /^\\d{1,20}$/);
    const spoofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-runtime-spoof-'));
    const spoofProfile = path.join(spoofRoot, 'profile');
    const spoof = {
      HOME: spoofProfile, USERPROFILE: spoofProfile,
      USERNAME: 'FixtureSpoofUser', USERDOMAIN: 'FixtureSpoofDomain',
      HOMEDRIVE: path.parse(spoofProfile).root.slice(0, 2), HOMEPATH: spoofProfile.slice(2),
      APPDATA: path.join(spoofProfile, 'Roaming'), LOCALAPPDATA: path.join(spoofProfile, 'Local'),
    };
    const original = Object.fromEntries(Object.keys(spoof).map(key => [key, process.env[key]]));
    let second;
    try {
      fs.mkdirSync(spoof.APPDATA, { recursive: true });
      fs.mkdirSync(spoof.LOCALAPPDATA, { recursive: true });
      Object.assign(process.env, spoof);
      second = await captureWindowsRuntime();
      assert.equal(second.current.status, 'observed');
      assert.equal(second.current.pid, process.pid);
      assert.equal(second.current.sid, first.current.sid);
      assert.equal(canonical(second.current.profileDirectory), expectedProfile);
      assert.equal(second.current.creationFileTime, first.current.creationFileTime);
      assert.equal(canonical(os.userInfo().homedir), expectedProfile);
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      fs.rmSync(spoofRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
    for (const roles of [{ currentProcessId: 1 }, { currentImage: 'C:\\\\Other\\\\node.exe' }, [], null]) {
      await assert.rejects(captureWindowsRuntime(roles), { message: 'invalid_observation_request' });
    }
    for (const key of ['NODE_OPTIONS', 'NODE_PATH']) {
      try {
        process.env[key] = 'fixture-preload-must-be-refused';
        await assert.rejects(captureWindowsRuntime(), { message: 'node_preload_environment_rejected' });
      } finally { delete process.env[key]; }
    }
    process.stdout.write(JSON.stringify({
      schemaVersion: 1, fixture: 'dev-runtime-native-current-parent',
      platform: process.platform, nodeVersion: process.version,
      fixedPowerShellPath: WINDOWS_POWERSHELL === 'C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe',
      source: 'process-primary-token-and-token-profile', listenerRolesRequested: 0,
      currentPidMatched: true, profileMatchedOsUserInfo: true,
      spoofedEnvironmentLeftIdentityUnchanged: true, spoofedEnvironmentLeftCreationUnchanged: true,
      measuredFieldsCannotBeOverridden: true, preloadEnvironmentRejected: true,
      operationalIsolationQualified: false,
    }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: path.dirname(fixture), env: cleanNodeEnvironment(), encoding: 'utf8', timeout: 60000,
    maxBuffer: 64 * 1024, windowsHide: true,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null, 'owned native smoke process must exit naturally');
  assert.equal(child.stderr, '', 'native smoke must not emit uncontrolled diagnostics');
  assert.equal(child.status, 0);
  const report = JSON.parse(child.stdout.trim());
  t.diagnostic(JSON.stringify({ ...report, probeSha256: before }));
  assert.equal(hash(fs.readFileSync(probe)), before);
  assert.deepEqual(report, {
    schemaVersion: 1, fixture: 'dev-runtime-native-current-parent',
    platform: 'win32', nodeVersion: process.version,
    fixedPowerShellPath: true, source: 'process-primary-token-and-token-profile', listenerRolesRequested: 0,
    currentPidMatched: true, profileMatchedOsUserInfo: true,
    spoofedEnvironmentLeftIdentityUnchanged: true, spoofedEnvironmentLeftCreationUnchanged: true,
    measuredFieldsCannotBeOverridden: true, preloadEnvironmentRejected: true,
    operationalIsolationQualified: false,
  });
});

test('native Windows listener observation qualifies the actual provider and Unicode fixture invocation', {
  skip: windowsOnly, timeout: 65000,
}, async t => {
  const before = hash(fs.readFileSync(probe));
  const listenerBefore = hash(fs.readFileSync(listenerFixture));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-runtime-native-'));
  const directory = path.join(root, 'owned fixture-\u00e9\u6f22');
  const entryPath = path.join(directory, 'listener fixture.mjs');
  const configPath = path.join(directory, 'fixture config.json');
  let child;
  let exited;
  let stderr = '';
  try {
    fs.mkdirSync(directory);
    fs.copyFileSync(listenerFixture, entryPath);
    fs.writeFileSync(configPath, JSON.stringify({ schemaVersion: 1, fixture: 'dev-runtime-listener' }), { flag: 'wx' });
    child = spawn(process.execPath, [entryPath, '--config', configPath], {
      cwd: directory, env: cleanNodeEnvironment(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    let stdout = '';
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 4096) {
        readyReject(new Error('owned_fixture_output_limit'));
        return;
      }
      if (!settled && stdout.includes('\n')) {
        settled = true;
        try { readyResolve(JSON.parse(stdout.trim())); }
        catch { readyReject(new Error('owned_fixture_invalid_readiness')); }
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(0, 4096); });
    child.stdin.on('error', () => {});
    exited = new Promise(resolve => {
      child.once('error', () => {
        readyReject(new Error('owned_fixture_spawn_failed'));
        resolve({ code: null, signal: null, spawnFailed: true });
      });
      child.once('exit', (code, signal) => {
        if (!settled) readyReject(new Error('owned_fixture_exited_before_ready'));
        resolve({ code, signal, spawnFailed: false });
      });
    });
    const receipt = await within(ready, 10000, 'owned_fixture_start_timeout');
    assert.deepEqual(Object.keys(receipt).sort(), ['pid', 'port', 'schemaVersion']);
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.pid, child.pid);
    assert.ok(Number.isInteger(receipt.port) && receipt.port >= 1024 && receipt.port <= 65535);
    const observation = await captureWindowsRuntime({ development: {
      nodePath: process.execPath, entryPath, configPath, port: receipt.port,
    } });
    assert.equal(observation.current.status, 'observed');
    assert.equal(observation.current.pid, process.pid);
    assert.equal(observation.development.status, 'observed');
    assert.equal(observation.development.pid, child.pid);
    assert.equal(observation.development.invocationMatched, true);
    assert.equal(observation.development.sid, observation.current.sid);
    const canonical = value => path.win32.resolve(value).toLowerCase();
    assert.equal(canonical(observation.current.profileDirectory), canonical(os.userInfo().homedir));
    assert.equal(canonical(observation.development.profileDirectory), canonical(os.userInfo().homedir));
    assert.match(observation.development.creationFileTime, /^\d{1,20}$/);
    assert.equal(Object.hasOwn(observation, 'production'), false);
    child.stdin.end();
    assert.deepEqual(await within(exited, 10000, 'owned_fixture_close_timeout'), { code: 0, signal: null, spawnFailed: false });
    assert.equal(stderr, '', 'owned inert fixture must not emit uncontrolled diagnostics');
    t.diagnostic(JSON.stringify({
      schemaVersion: 1, fixture: 'dev-runtime-native-listener', probeSha256: before,
      listenerFixtureSha256: listenerBefore, listenerRolesRequested: 1,
      listenerRole: 'owned-inert-fixture-only', listenerStateProvider: 'native-Get-NetTCPConnection',
      nativeCimCreationBound: true, unicodeInvocationMatched: true, currentUserProfileMatched: true,
      exactOwnedPidMatched: true, exitedOnStdinEof: true, operationalIsolationQualified: false,
    }));
  } finally {
    let forcedCleanup = false;
    let cleanupResult;
    if (child && exited && child.exitCode === null && child.signalCode === null) {
      child.stdin.end();
      try { cleanupResult = await within(exited, 5000, 'owned_fixture_cleanup_timeout'); }
      catch {
        // Only this retained child handle is eligible for cleanup. No PID is
        // rediscovered, and no manager or unrelated process can be targeted.
        child.kill();
        cleanupResult = await within(exited, 5000, 'owned_fixture_kill_timeout');
        forcedCleanup = true;
      }
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (cleanupResult) assert.equal(cleanupResult.spawnFailed, false, 'fixture cleanup must observe the owned process exit');
    assert.equal(hash(fs.readFileSync(probe)), before);
    assert.equal(hash(fs.readFileSync(listenerFixture)), listenerBefore);
    assert.equal(forcedCleanup, false, 'owned fixture must exit on stdin EOF without forced cleanup');
  }
});
