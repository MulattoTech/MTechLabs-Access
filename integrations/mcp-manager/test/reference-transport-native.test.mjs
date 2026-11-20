import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = path.join(root, 'test', 'fixtures', 'reference-transport-native.ps1');
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const marker = 'MTERM_REFERENCE_TRANSPORT_NATIVE_EVIDENCE ';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = [
  'package.json', 'inspect-dev-runtime.mjs', 'reference-server.mjs', 'manage-dev.ps1',
  'windows-reference.ps1', 'windows-reference-native.cs', 'windows-runtime-probe.ps1',
  'lib/reference-bootstrap.mjs', 'lib/reference-transport.mjs', 'lib/production-reference.mjs',
  'lib/dev-runtime-reference.mjs', 'lib/runtime-files.mjs', 'lib/runtime-identity.mjs',
  'lib/dev-runtime-plan.mjs', 'lib/dev-instance.mjs', 'lib/config.mjs', 'lib/token.mjs',
  'test/fixtures/reference-transport-child.mjs', 'test/fixtures/reference-transport-pipe.ps1',
  'test/fixtures/reference-transport-native.ps1', 'test/reference-transport-native.test.mjs',
];
const cases = [
  'separate reference accounts have actual standard tokens and independently loaded profiles',
  'actual standard DEV receives a registered signed reference without production reads or writer effects',
  'public Inspect and Status use protected bootstrap and the real cross-account reference',
  'unauthorized real requester is rejected before any registered authority invocation',
  'DEV cannot read private signing material or create replacements in protected bootstrap',
  'protected selections and source pins reject overrides before authority or altered entry execution',
  'unsafe public private and ancestor ACLs fail closed with restored signed controls',
  'a fresh DEV logon with Administrators membership is refused then standard access is restored',
  'DEV cannot add a pipe server or impersonate the pinned authority endpoint',
  'actual remote pipe clients are denied beside an authenticated allow-remote control',
  'a substituted public response pin rejects a real signed observation without reader fallback',
  'native runtime probes ignore a hostile module search path after a real neighbor executes it',
  'oversized malformed truncated and coalesced frames are refused before callback dispatch',
  'an observed delayed extra byte cancels one admitted callback and prevents its response',
  'captured cancellation and hostile callback values preserve bounded errors and real settlement',
  'a real transport deadline refuses the response while retaining an ignored-abort callback',
  'eight admitted callbacks retain capacity through cancellation and drain after multi-connection shutdown',
  'qualification leaves manager state unchanged and closes all owned account processes',
];
const controls = [3, 1, 2, 1, 1, 3, 5, 1, 3, 2, 1, 1, 2, 1, 1, 1, 1, 1];

function capture(args, milliseconds) {
  return new Promise(resolve => {
    const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, ...args], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env },
    });
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), timedOut = false, overflow = false, finished = false;
    const finish = (exitCode, signal, spawnError = false) => {
      if (finished) return;
      finished = true; clearTimeout(timer); clearTimeout(forceTimer);
      resolve({ stdout, stderr, exitCode, signal, timedOut, overflow, spawnError });
    };
    let forceTimer;
    const timer = setTimeout(() => {
      timedOut = true; child.kill();
      // An orphan must not retain this parent's stdio and block the recovery
      // controller. The test still fails after mandatory ownership cleanup.
      forceTimer = setTimeout(() => finish(null, 'watchdog'), 1000);
    }, milliseconds);
    const collect = name => chunk => {
      if (name === 'stdout') stdout = Buffer.concat([stdout, chunk]);
      else stderr = Buffer.concat([stderr, chunk]);
      if (stdout.length + stderr.length > 1048576) { overflow = true; child.kill(); }
    };
    child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
    child.on('error', () => finish(null, null, true));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

const skip = process.platform !== 'win32' ? 'Requires a disposable hosted Windows runner and explicit fixture opt-in' :
  process.env.MTERM_DISPOSABLE_REFERENCE_QUALIFICATION !== '1' ? 'Disposable account qualification is not opted in on this Windows machine' : false;

test('protected reference transport qualifies separate disposable Windows identities and mandatory cleanup', { skip, timeout: 490000 }, async t => {
  // These checks precede PowerShell launch, account creation, or filesystem
  // provisioning. Privilege failures on opted-in hosted runners never skip.
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'fixture requires GitHub Actions');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'fixture requires a disposable hosted runner');
  assert.equal(process.env.RUNNER_OS, 'Windows');
  assert.equal(Boolean(process.env.NODE_OPTIONS || process.env.NODE_PATH), false);
  const before = Object.fromEntries(await Promise.all(sources.map(async name => [name, sha256(await fs.readFile(path.join(root, name)))])));
  const fixtureId = randomBytes(16).toString('hex');
  const observed = await capture(['-FixtureId', fixtureId, '-SourceRoot', root, '-NodeSource', process.execPath], 420000);
  let report;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(observed.stdout).replace(/^\uFEFF/, '').trim();
    report = JSON.parse(text);
  } catch { /* Never print raw child output or private logon diagnostics. */ }
  const privacyViolation = Boolean(report && /S-1-5-21-|[A-Za-z]:\\\\|PRIVATE-FIXTURE|\.example\.test/.test(JSON.stringify(report)));
  if (privacyViolation) report = null;
  let recovery = null;
  if (observed.timedOut || observed.overflow || !report?.cleanup || Object.entries(report.cleanup)
    .some(([name, value]) => name !== 'forcedChildCleanup' && value !== true)) {
    const recovered = await capture(['-FixtureId', fixtureId, '-CleanupOnly'], 60000);
    try { recovery = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(recovered.stdout).trim()); }
    catch { recovery = { emergencyCleanup: true, failure: 'fixture_recovery_report_invalid' }; }
    recovery.exitCode = recovered.exitCode;
    recovery.stderrBytes = recovered.stderr.length;
    recovery.stderrSha256 = sha256(recovered.stderr);
  }
  const after = Object.fromEntries(await Promise.all(sources.map(async name => [name, sha256(await fs.readFile(path.join(root, name)))])));
  const evidence = { schemaVersion: 1, fixture: 'protected-reference-transport', nativeCaseTitles: cases,
    report: report ?? null, sourceSha256: before, sourceUnchanged: JSON.stringify(before) === JSON.stringify(after),
    controller: { exitCode: observed.exitCode, signal: observed.signal, timedOut: observed.timedOut,
      overflow: observed.overflow, spawnError: observed.spawnError,
      privacyViolation,
      stderrBytes: observed.stderr.length, stderrSha256: sha256(observed.stderr) },
    emergencyCleanup: recovery, watchdog: { workMilliseconds: 360000, cleanupMilliseconds: 60000, outerMilliseconds: 420000 },
    nativeCompilerTemporaryActivityNotExcluded: true, mappedNetworkDriveQualification: false,
    realProductionAccountQualification: false, cloudflareOrConnectorGrantQualification: false,
    activationAuthorized: false, qualified: false, upstreamEnabled: false };
  process.stdout.write(marker + JSON.stringify(evidence) + '\n');
  assert.deepEqual(after, before, 'source fixture bytes remain unchanged');
  assert.equal(observed.timedOut, false, 'native watchdog expired; mandatory recovery evidence is retained');
  assert.equal(observed.overflow, false);
  assert.equal(observed.spawnError, false);
  assert.equal(privacyViolation, false, 'native report contained a private fixture value');
  assert.equal(observed.stderr.length, 0, 'native controller emitted stderr; only its digest is public');
  assert.equal(observed.exitCode, 0, report?.failure ?? 'native controller did not finish');
  assert.equal(recovery, null, 'native acceptance requires natural cleanup without emergency recovery');
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.failure, null);
  assert.deepEqual(report.cleanupErrors, []);
  assert.equal(report.failedStage, null);
  assert.deepEqual(report.watchdog, evidence.watchdog);
  assert.equal(report.nativeRuntime.platform, 'Win32NT');
  assert.equal(report.nativeRuntime.powerShellEdition, 'Desktop');
  assert.match(report.nativeRuntime.powerShellVersion, /^5\.1\.\d+\.\d+$/);
  assert.equal(report.nativeRuntime.is64BitProcess, true);
  assert.equal(report.activationAuthorized, false); assert.equal(report.qualified, false); assert.equal(report.upstreamEnabled, false);
  assert.equal(report.ownerHostTouched, false);
  assert.equal(report.copiedNodeSha256, sha256(await fs.readFile(process.execPath)));
  assert.deepEqual(report.sourceSha256, Object.fromEntries(sources.slice(0, 19).map(name => [name, before[name]])));
  assert.deepEqual(report.completedCases.map(item => item.name), cases);
  for (const [name, value] of Object.entries(report.cleanup)) assert.equal(value, name === 'forcedChildCleanup' ? 0 : true, name);
  assert.equal(report.elapsedMilliseconds <= 420000, true);
  for (let index = 0; index < cases.length; index++) {
    await t.test(cases[index], () => {
      const item = report.completedCases[index];
      assert.equal(item.passed, true); assert.equal(item.positiveControls, controls[index]);
      assert.equal(typeof item.details, 'object');
    });
  }
});
