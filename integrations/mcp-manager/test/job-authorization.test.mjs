// SPDX-License-Identifier: MIT
// AI-Change: 2026-11-12-job-reauthorization (OpenAI / GPT-6 Astra Pro; self-reported)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { fixture, gatewayFixture } from './helpers.mjs';
import { readToolkit, writeToolkit } from '../lib/toolkit-config.mjs';
import { submitJob, cancelJob, resumeJob, jobStatus, jobLogs, startJobRunner } from '../lib/jobs.mjs';

const exec = promisify(execFile);
const argsFor = kind => kind === 'vm_inventory' ? { kind } :
  { kind, rootId: 'fixture', relativePath: '.', ...(kind === 'run_tests' ? { command: 'git-diff-check' } : {}) };

async function configure(f) {
  // All commands below target this disposable Git repository. No project test
  // scripts, VM commands, upstream package or owner repository are executed.
  const repository = path.join(f.directory, 'repository');
  const hooks = path.join(f.directory, 'empty-hooks');
  await fs.mkdir(hooks);
  await exec('git', ['-c', 'init.defaultBranch=main', 'init', '--quiet', '--template=', repository]);
  await fs.writeFile(path.join(repository, 'fixture.js'), 'export const fixture = true;\n');
  await exec('git', ['-C', repository, 'add', 'fixture.js']);
  await exec('git', ['-C', repository, '-c', 'user.name=MTerm Test', '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=' + hooks, 'commit', '--quiet', '-m', 'owned test fixture']);
  f.config.minimumFreeMemoryMiB = 0; f.config.minimumFreeDiskMiB = 0;
  const settings = await readToolkit(f.config);
  await writeToolkit(f.config, { ...settings, roots: [{ id: 'fixture', path: repository }],
    capabilities: { ...settings.capabilities, jobs: true, testRun: true } });
  return repository;
}

async function capability(config, name, enabled) {
  const settings = await readToolkit(config);
  await writeToolkit(config, { ...settings, capabilities: { ...settings.capabilities, [name]: enabled } });
}

async function terminalJob(config, kind, state = 'failed') {
  const job = await submitJob(config, argsFor(kind));
  await cancelJob(config, job.id);
  const db = new DatabaseSync(path.join(config.stateDirectory, 'toolkit-jobs.sqlite'));
  try {
    db.prepare("UPDATE jobs SET state=?,result_json=?,error=?,resume_count=1 WHERE id=?")
      .run(state, JSON.stringify({ evidence: 'preserve-until-authorized' }), 'prior-outcome', job.id);
  } finally { db.close(); }
  return job;
}

async function terminal(config, id, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const row = await jobStatus(config, id);
    if (['succeeded', 'failed', 'interrupted', 'cancelled'].includes(row.state)) return row;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('job_test_completion_timeout');
}

test('resume rechecks jobs and every kind capability without clearing previous evidence', async t => {
  for (const [kind, flag, error] of [
    ['vm_inventory', 'vmRead', 'vm_read_disabled'],
    ['repo_diagnostics', 'codeRead', 'code_read_disabled'],
    ['run_tests', 'codeRead', 'code_read_disabled'],
    ['run_tests', 'testRun', 'test_execution_disabled'],
    ['vm_inventory', 'jobs', 'job_submission_disabled'],
  ]) await t.test(kind + ' / ' + flag, async t => {
    const f = await fixture(t); await configure(f);
    const job = await terminalJob(f.config, kind);
    const before = { status: await jobStatus(f.config, job.id), logs: await jobLogs(f.config, job.id) };
    await capability(f.config, flag, false);
    await assert.rejects(resumeJob(f.config, job.id, true), { message: error });
    assert.deepEqual({ status: await jobStatus(f.config, job.id), logs: await jobLogs(f.config, job.id) }, before);
  });
});

test('initial and resumed queued repository work observes capability revocation before provider dispatch', async t => {
  for (const [kind, flag, error, resumed] of [
    ['repo_diagnostics', 'codeRead', 'code_read_disabled', false],
    ['run_tests', 'codeRead', 'code_read_disabled', false],
    ['run_tests', 'testRun', 'test_execution_disabled', false],
    ['run_tests', 'testRun', 'test_execution_disabled', true],
  ]) await t.test(kind + ' / ' + flag + (resumed ? ' / resumed' : ' / initial'), async t => {
    const f = await fixture(t); await configure(f);
    const job = resumed ? await terminalJob(f.config, kind) : await submitJob(f.config, argsFor(kind));
    if (resumed) await resumeJob(f.config, job.id, true);
    await capability(f.config, flag, false);
    const runner = startJobRunner(f.config);
    try {
      assert.equal((await terminal(f.config, job.id)).state, 'failed');
      const logs = await jobLogs(f.config, job.id);
      assert.equal(logs.error, error); assert.equal(logs.result, null);
    } finally { runner.close(); }
  });
});

test('allowed jobs still execute and terminal states resume once with explicit confirmation', async t => {
  const f = await fixture(t); await configure(f);
  const queued = await submitJob(f.config, argsFor('run_tests'));
  const runner = startJobRunner(f.config);
  try {
    assert.equal((await terminal(f.config, queued.id)).state, 'succeeded');
    const logs = await jobLogs(f.config, queued.id);
    assert.equal(logs.error, null); assert.equal(logs.result.ok, true);
    assert.equal(logs.result.command, 'git-diff-check');
  } finally { runner.close(); }
  for (const state of ['failed', 'interrupted', 'cancelled']) {
    const job = await terminalJob(f.config, 'run_tests', state);
    await assert.rejects(resumeJob(f.config, job.id, false), /explicit_resume_confirmation_required/);
    const attempts = await Promise.allSettled([resumeJob(f.config, job.id, true), resumeJob(f.config, job.id, true)]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    const current = await jobStatus(f.config, job.id);
    assert.equal(current.state, 'queued'); assert.equal(current.resumeCount, 2);
    assert.equal((await jobLogs(f.config, job.id)).result, null);
    await cancelJob(f.config, job.id);
  }
});

test('MCP resume reaches the shared kind check while status and logs stay readable with jobs disabled', async t => {
  const f = await gatewayFixture(t); await configure(f);
  const job = await terminalJob(f.config, 'run_tests');
  await capability(f.config, 'testRun', false);
  f.send(51, 'mterm_job_resume', { id: job.id, confirm: true });
  const result = (await f.response(51)).result;
  assert.equal(result.isError, true); assert.equal(result.content[0].text, 'test_execution_disabled');
  assert.equal((await jobStatus(f.config, job.id)).resumeCount, 1);
  await capability(f.config, 'jobs', false);
  f.send(52, 'mterm_job_status', { id: job.id });
  f.send(53, 'mterm_job_logs', { id: job.id });
  assert.equal(JSON.parse((await f.response(52)).result.content[0].text).state, 'failed');
  assert.equal(JSON.parse((await f.response(53)).result.content[0].text).result.evidence, 'preserve-until-authorized');
});

test('malformed settings and invalid persisted kinds or commands cannot requeue a stored job', async t => {
  const f = await fixture(t); await configure(f);
  const job = await terminalJob(f.config, 'run_tests');
  const settings = await readToolkit(f.config);
  await fs.writeFile(path.join(f.config.stateDirectory, 'toolkit.json'), '{}');
  await assert.rejects(resumeJob(f.config, job.id, true), /invalid_toolkit/);
  assert.equal((await jobStatus(f.config, job.id)).state, 'failed');
  await writeToolkit(f.config, settings);
  const db = new DatabaseSync(path.join(f.config.stateDirectory, 'toolkit-jobs.sqlite'));
  try {
    db.prepare('UPDATE jobs SET kind=? WHERE id=?').run('unknown', job.id);
    await assert.rejects(resumeJob(f.config, job.id, true), /invalid_job_kind/);
    db.prepare('UPDATE jobs SET kind=?,command=? WHERE id=?').run('run_tests', 'arbitrary-command', job.id);
    await assert.rejects(resumeJob(f.config, job.id, true), /test_execution_disabled/);
  } finally { db.close(); }
  assert.equal((await jobStatus(f.config, job.id)).resumeCount, 1);
  assert.equal((await jobLogs(f.config, job.id)).result.evidence, 'preserve-until-authorized');
});
