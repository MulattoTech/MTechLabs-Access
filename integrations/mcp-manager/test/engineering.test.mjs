import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fixture, gatewayFixture, TEST_TOKEN } from './helpers.mjs';
import { createAdminServer } from '../admin.mjs';
import { TOOLKIT_DEFAULTS, readToolkit, writeToolkit, validateToolkitUpdate,
  projectToolkit, allowedRepository } from '../lib/toolkit-config.mjs';
import { submitJob, jobStatus, jobLogs, cancelJob, resumeJob, jobSummary } from '../lib/jobs.mjs';
import { ENGINEERING_TOOLS } from '../lib/engineering-tools.mjs';
import { atomicWriteJson } from '../lib/policy.mjs';
import { runCommand } from '../lib/command-runner.mjs';

test('bounded commands terminate a timed-out or aborted direct child', async () => {
  const timed = await runCommand(process.execPath, ['-e', 'setTimeout(()=>{}, 3000)'],
    { timeoutMs: 150, maxOutput: 100 });
  assert.equal(timed.ok, false);
  assert.equal(timed.timedOut, true);
  const controller = new AbortController();
  const command = runCommand(process.execPath, ['-e', 'setTimeout(()=>{}, 3000)'],
    { signal: controller.signal, maxOutput: 100 });
  setTimeout(() => controller.abort(), 150);
  const aborted = await command;
  assert.equal(aborted.ok, false);
  assert.equal(aborted.aborted, true);
});

test('toolkit is deny-by-default for writes, roots are canonical and paths never reach web status', async t => {
  const f = await fixture(t);
  const initial = await readToolkit(f.config);
  assert.equal(initial.capabilities.vmPower, false);
  assert.equal(initial.capabilities.repoWrite, false);
  assert.equal(initial.capabilities.math, true);
  assert.deepEqual(initial.roots, []);
  const project = path.join(f.directory, 'projects');
  const inside = path.join(project, 'source');
  await fs.mkdir(inside, { recursive: true });
  const settings = await writeToolkit(f.config, { ...initial, roots: [{ id: 'dev', path: project }] });
  assert.equal(await allowedRepository(f.config, 'dev', 'source'), await fs.realpath(inside));
  await assert.rejects(allowedRepository(f.config, 'dev', '..'), /repository_root_denied/);
  const web = projectToolkit(settings);
  assert.deepEqual(web.roots, ['dev']);
  assert.equal(JSON.stringify(web).includes(project), false);
  assert.throws(() => validateToolkitUpdate({ ...web, roots: ['/private'] }, settings), /invalid_toolkit_update/);
  assert.throws(() => validateToolkitUpdate({ capabilities: { ...settings.capabilities, arbitrary: true },
    maxConcurrentJobs: 2, jobTimeoutSeconds: 600 }, settings), /invalid_toolkit/);
});

test('gateway advertises specialized tools, preserves read-only guardrails and reports structured denial', async t => {
  const f = await gatewayFixture(t);
  f.input.write(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list', params: {} }) + '\n');
  const list = await f.response(99);
  assert.ok(list.result.tools.some(tool => tool.name === 'mterm_math_evaluate'));
  assert.ok(list.result.tools.some(tool => tool.name === 'mterm_vm_inspect'));
  assert.ok(list.result.tools.some(tool => tool.name === 'mterm_job_submit'));
  assert.equal(new Set(ENGINEERING_TOOLS.map(tool => tool.name)).size, ENGINEERING_TOOLS.length);
  await atomicWriteJson(f.config.policyPath, { enabled: true, readOnly: true, maxInflight: 1 });
  f.send(101, 'mterm_vm_start', { name: 'test', confirmName: 'test' });
  assert.equal((await f.response(101)).error.code, -32011);
  f.send(102, 'mterm_repo_inspect', { rootId: 'unconfigured' });
  const result = await f.response(102);
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /repository_root_denied/);
});

test('persistent jobs support queued cancellation and explicit resume without automatic execution', async t => {
  const f = await fixture(t);
  const settings = await readToolkit(f.config);
  await writeToolkit(f.config, { ...settings, capabilities: { ...settings.capabilities, jobs: true } });
  const submitted = await submitJob(f.config, { kind: 'vm_inventory' });
  assert.equal(submitted.state, 'queued');
  assert.equal((await jobStatus(f.config, submitted.id)).state, 'queued');
  assert.equal((await jobSummary(f.config)).counts.queued, 1);
  assert.equal((await cancelJob(f.config, submitted.id)).state, 'cancelled');
  assert.equal((await jobLogs(f.config, submitted.id)).state, 'cancelled');
  await assert.rejects(resumeJob(f.config, submitted.id, false), /explicit_resume_confirmation_required/);
  assert.equal((await resumeJob(f.config, submitted.id, true)).state, 'queued');
  assert.equal((await jobSummary(f.config)).counts.queued, 1);
});

test('local HTTP toolkit controls require bearer and reject root/path injection', async t => {
  const f = await fixture(t, { cleanup: false });
  const server = await createAdminServer(f.config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(f.directory, { recursive: true, force: true }); });
  const port = server.address().port;
  function request(method, route, body, authenticated = true) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port, method, path: route,
        headers: { Host: '127.0.0.1:19740', ...(authenticated ? { Authorization: 'Bearer ' + TEST_TOKEN } : {}),
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
        let text = ''; res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject); req.end(data);
    });
  }
  assert.equal((await request('GET', '/v1/toolkit', undefined, false)).status, 401);
  assert.equal((await request('GET', '/v1/toolkit')).body.toolkit.capabilities.vmPower, false);
  const update = { capabilities: { ...TOOLKIT_DEFAULTS.capabilities, jobs: true }, maxConcurrentJobs: 3, jobTimeoutSeconds: 300 };
  assert.equal((await request('POST', '/v1/toolkit', { ...update, roots: [{ id: 'all', path: 'C:\\' }] })).status, 400);
  const result = await request('POST', '/v1/toolkit', update);
  assert.equal(result.status, 200);
  assert.equal(result.body.toolkit.maxConcurrentJobs, 3);
  assert.equal((await request('GET', '/v1/status')).body.toolkit.capabilities.jobs, true);
  assert.equal((await request('POST', '/v1/jobs/submit', { kind: 'vm_inventory', command: 'npm-test' })).status, 400);
  assert.equal((await request('POST', '/v1/jobs/submit', { kind: 'vm_inventory' }, false)).status, 401);
  const created = await request('POST', '/v1/jobs/submit', { kind: 'vm_inventory' });
  assert.equal(created.status, 200);
  assert.equal(created.body.job.kind, 'vm_inventory');
  assert.equal(created.body.job.state, 'queued');
});

test('code diagnostics inspects syntax across changed JavaScript modules safely', async t => {
  const f = await fixture(t);
  const repoDir = path.join(f.directory, 'sample-repo');
  await fs.mkdir(repoDir, { recursive: true });
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['-C', repoDir, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@example.invalid'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Test User'], { stdio: 'ignore' });
  await fs.writeFile(path.join(repoDir, 'index.mjs'), 'export const answer = 42;\n', 'utf8');
  execFileSync('git', ['-C', repoDir, 'add', 'index.mjs'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoDir, 'commit', '-q', '-m', 'init'], { stdio: 'ignore' });
  await fs.writeFile(path.join(repoDir, 'index.mjs'), 'export const answer = 84;\n', 'utf8');
  const { codeOperation } = await import('../providers/code.mjs');
  const diag = await codeOperation('mterm_code_diagnostics', { rootId: 'sample' }, repoDir, f.config);
  assert.equal(diag.whitespace.ok, true);
  assert.equal(diag.syntax.length, 1);
  assert.equal(diag.syntax[0].file, 'index.mjs');
  assert.equal(diag.syntax[0].ok, true);
});
