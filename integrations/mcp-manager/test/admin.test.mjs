import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createAdminServer, loadTokenDigest } from '../admin.mjs';
import { fixture, TEST_TOKEN } from './helpers.mjs';
import { readPolicy } from '../lib/policy.mjs';

async function adminFixture(t) {
  const f = await fixture(t, { cleanup: false });
  const server = await createAdminServer(f.config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(f.directory, { recursive: true, force: true });
  });
  const port = server.address().port;
  function request({ method = 'GET', url = '/v1/status', bearer = TEST_TOKEN, host = '127.0.0.1:19740', origin, body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1', port, method, path: url,
        headers: {
          Host: host,
          ...(bearer === null ? {} : { Authorization: 'Bearer ' + bearer }),
          ...(origin ? { Origin: origin } : {}),
          ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }),
          ...headers,
        },
      }, res => {
        let text = '';
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, body: JSON.parse(text) }));
      });
      req.once('error', reject);
      req.end(data);
    });
  }
  return { ...f, request };
}

test('admin requires bearer authentication for every path and never returns CORS permission', async t => {
  const f = await adminFixture(t);
  for (const bearer of [null, '', 'wrong-token-even-though-it-is-long-enough-1234']) {
    const result = await f.request({ bearer });
    assert.equal(result.status, 401);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
    assert.equal(result.text.includes(TEST_TOKEN), false);
  }
  assert.equal((await f.request({ url: '/unknown', bearer: null })).status, 401);
});

test('admin enforces Host and Origin without trusting forwarded headers', async t => {
  const f = await adminFixture(t);
  assert.equal((await f.request({ host: 'attacker.test', headers: { 'X-Forwarded-Host': 'mcp-origin.m-techlabs.com' } })).status, 403);
  assert.equal((await f.request({ origin: 'https://attacker.test' })).status, 403);
  assert.equal((await f.request({ host: 'mcp-origin.m-techlabs.com' })).status, 200);
  assert.equal((await f.request({ origin: 'https://m-techlabs.com' })).status, 200);
});

test('status is sanitized and distinguishes configured inventory from a live connection', async t => {
  const f = await adminFixture(t);
  const result = await f.request();
  assert.equal(result.status, 200);
  assert.equal(result.body.schemaVersion, 1);
  assert.equal(result.body.runtime.packageVersion, '0.3.1');
  assert.equal(result.body.inventory.entries[0].configured, true);
  assert.equal(result.body.inventory.entries[0].connection, 'unknown');
  assert.equal(result.body.limits.detachedJobsCapped, false);
  for (const secret of [TEST_TOKEN, f.config.tokenPath, f.config.serverPath, 'TOP-SECRET-ARBITRARY-COMMAND', '/private/unrelated']) {
    assert.equal(result.text.includes(secret), false, secret);
  }
  assert.equal(result.headers['cache-control'], 'no-store');
  await fs.writeFile(f.config.policyPath, JSON.stringify({ enabled: true, readOnly: true, maxInflight: 1 }));
  assert.equal((await f.request()).body.resources.admissionOpen, false);
  assert.ok(result.body.resources.managerResidentBytes > 0);
  assert.ok(result.body.resources.managerHeapUsedBytes > 0);
  assert.equal(result.body.deployment, null);
  await fs.writeFile(path.join(f.config.stateDirectory, 'deployment.json'), JSON.stringify({
    sourceCommit: 'a'.repeat(40), completedAt: '2026-11-06T04:00:00.000Z',
    cloudflare: { version: '12345678-1234-1234-1234-123456789abc', credential: TEST_TOKEN },
    sourceManifest: { privatePath: f.config.tokenPath },
  }));
  const deployed = await f.request();
  assert.deepEqual(deployed.body.deployment, {
    sourceCommit: 'a'.repeat(40), installedAt: '2026-11-06T04:00:00.000Z',
    workerVersion: '12345678-1234-1234-1234-123456789abc', evidence: 'installation-record',
  });
  assert.doesNotMatch(deployed.text, /test-bearer|privatePath|credential/);
});

test('policy writes require exact validated fields and cannot mutate unrelated configuration', async t => {
  const f = await adminFixture(t);
  const beforeInventory = await fs.readFile(f.config.inventoryPath, 'utf8');
  const beforeToken = await fs.readFile(f.config.tokenPath, 'utf8');
  const input = { enabled: false, readOnly: true, maxInflight: 64 };
  assert.equal((await f.request({ method: 'POST', url: '/v1/policy', body: input, bearer: null })).status, 401);
  for (const body of [
    {}, '{broken', { ...input, maxInflight: 65 }, { ...input, readOnly: 'true' }, { ...input, command: 'launch' },
    { ...input, tokenPath: '/elsewhere' }, 'x'.repeat(5000),
  ]) assert.equal((await f.request({ method: 'POST', url: '/v1/policy', body })).status, 400);
  const result = await f.request({ method: 'POST', url: '/v1/policy', body: input });
  assert.equal(result.status, 200);
  assert.deepEqual(await readPolicy(f.config.policyPath), input);
  assert.equal(result.body.runningCommandsInterrupted, false);
  assert.equal(result.body.appliesTo, 'new_tool_calls');
  assert.equal(await fs.readFile(f.config.inventoryPath, 'utf8'), beforeInventory);
  assert.equal(await fs.readFile(f.config.tokenPath, 'utf8'), beforeToken);
  assert.equal((await f.request({ method: 'POST', url: '/v1/execute', body: { command: 'no' } })).status, 404);
  assert.equal((await f.request({ method: 'GET', url: '/v1/policy' })).status, 405);
});

test('digest-token format is preferred; malformed digest fails closed', async t => {
  const { config } = await fixture(t);
  assert.equal((await loadTokenDigest(config.tokenPath)).toString('hex'), createHash('sha256').update(TEST_TOKEN).digest('hex'));
  await fs.writeFile(config.tokenPath, 'sha256:not-a-real-digest');
  await assert.rejects(loadTokenDigest(config.tokenPath), /invalid_token_file/);
  await fs.writeFile(config.tokenPath, TEST_TOKEN);
  assert.equal((await loadTokenDigest(config.tokenPath)).toString('hex'), createHash('sha256').update(TEST_TOKEN).digest('hex'));
});
