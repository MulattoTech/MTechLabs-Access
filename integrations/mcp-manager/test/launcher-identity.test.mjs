import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const launcher = fileURLToPath(new URL('../manage.ps1', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/launcher-identity.ps1', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const titles = [
  'supported quoted invocation',
  'unquoted entry and configuration without spaces',
  'Windows path case variants',
  'tab argument separators',
  'different configuration',
  'configuration suffix lookalike',
  'missing configuration argument',
  'duplicate configuration argument',
  'extra trailing argument',
  'entry suffix lookalike',
  'expected entry appears only in unrelated argument',
  'expected entry appears in eval text',
  'unsupported Node flag',
  'literal config flag is case sensitive',
  'relative executable argument',
  'unavailable command line',
  'empty command line',
  'different executable',
  'returned process PID differs from listener',
  'process disappeared before query',
  'no listener',
  'non-loopback listener',
  'multiple listeners',
  'established connection is not a listener',
  'established connection does not hide the listener',
  'foreign private argument stays out of diagnostics',
];

test('Windows launcher verifies executable, entry, configuration and listener identity', {
  skip: process.platform !== 'win32' ? 'Requires native Windows PowerShell and Windows argument parsing' : false,
  timeout: 45000,
}, async t => {
  assert.ok(path.isAbsolute(process.env.SystemRoot ?? ''), 'absolute Windows system directory is required');
  const executable = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const before = hash(fs.readFileSync(launcher));
  const child = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fixture, '-LauncherPath', launcher], {
    cwd: path.dirname(fixture), encoding: 'utf8', timeout: 30000,
    maxBuffer: 256 * 1024, windowsHide: true,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null, 'owned fixture must exit naturally');
  assert.equal(child.stderr, '', 'fixture must not emit uncontrolled diagnostics');
  const report = JSON.parse(child.stdout.trim());
  // Retain the complete first observation, including original RED, before assertions.
  t.diagnostic(JSON.stringify({ ...report, fixtureSha256: hash(fs.readFileSync(fixture)), childExitCode: child.status }));
  assert.equal(hash(fs.readFileSync(launcher)), before);
  assert.equal(report.sourceSha256, before);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.fixture, 'manager-launcher-identity');
  assert.equal(report.platform, 'Win32NT');
  assert.match(report.powerShellVersion, /^5\.1\./);
  assert.equal(report.powerShellEdition, 'Desktop');
  assert.equal(report.loadMode, 'top-level-function-definitions-only');
  assert.equal(report.listenerAndCimData, 'simulated');
  assert.equal(report.launchBodySelection, 'excluded-by-AST');
  assert.ok(report.loadedFunctions.includes('Get-OwnedManager'));
  assert.equal(report.blockedSideEffectAttempts, 0);
  assert.equal(report.queryFaults, 0);
  assert.equal(report.total, titles.length);
  assert.deepEqual(report.cases.map(value => value.name), titles);
  for (const observation of report.cases) {
    await t.test(observation.name, () => {
      assert.equal(observation.actual, observation.expected);
      if (observation.actual === 'owned') assert.equal(observation.returnedPid, 4242);
      assert.equal(observation.listenerQueries, 1);
      assert.equal(observation.cimQueries, observation.expectedCimQueries);
      assert.equal(observation.privateArgumentLeaked, false);
    });
  }
  assert.equal(report.failed, 0);
  assert.equal(report.passed, titles.length);
  assert.equal(child.status, 0);
});
