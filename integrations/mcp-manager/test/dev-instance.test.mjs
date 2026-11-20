import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createAdminServer } from '../admin.mjs';
import { startGateway } from '../gateway.mjs';
import { loadConfig } from '../lib/config.mjs';
import { jobSummary, startJobRunner } from '../lib/jobs.mjs';
import { writeToolkit, readToolkit } from '../lib/toolkit-config.mjs';
import { configure } from '../configure-toolkit.mjs';
import { inspectAdmissions } from '../recover-admission.mjs';
import { fixture, TEST_TOKEN } from './helpers.mjs';

const DEV_TOKEN = 'dev-fixture-only-independent-token-0123456789abcdef';
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const digest = value => createHash('sha256').update(value).digest('hex');

async function close(server) {
  await new Promise(resolve => server.close(resolve));
  await server.managedClosed;
}

async function freePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await close(server);
  return port === 19740 ? freePort() : port;
}

async function pair(t) {
  const prod = await fixture(t, { cleanup: false });
  const dev = await fixture(t, { cleanup: false });
  const servers = [];
  t.after(async () => {
    for (const server of servers.reverse()) await close(server);
    await fs.rm(dev.directory, { recursive: true, force: true });
    await fs.rm(prod.directory, { recursive: true, force: true });
  });
  prod.configPath = path.join(prod.directory, 'manager.json');
  await fs.writeFile(prod.configPath, JSON.stringify(prod.config));
  for (const key of ['policyPath', 'tokenPath', 'inventoryPath']) {
    const previous = dev.config[key];
    dev.config[key] = path.join(dev.config.stateDirectory, path.basename(previous));
    await fs.rename(previous, dev.config[key]);
  }
  await fs.writeFile(dev.config.tokenPath, 'sha256:' + digest(DEV_TOKEN));
  dev.configPath = path.join(dev.config.stateDirectory, 'manager.json');
  dev.config.instance = { kind: 'dev', id: 'dev-fixture', port: await freePort(), productionConfigPath: prod.configPath };
  await fs.writeFile(dev.configPath, JSON.stringify(dev.config));
  for (const [label, target] of [['production-fixture', prod], ['development-fixture', dev]]) {
    await fs.writeFile(target.config.inventoryPath, JSON.stringify({ entries: [{ id: label, name: label, client: label, configured: true }] }));
  }
  let sdkLoads = 0;
  async function construct(target = dev) {
    const server = await createAdminServer(target.config, {
      configPath: target.configPath,
      remoteOptions: { sdkLoader: () => { sdkLoads++; throw new Error('fixture_must_not_load_sdk'); } },
    });
    servers.push(server);
    return server;
  }
  async function start(target = dev) {
    const server = await construct(target);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(target.config.instance?.port ?? 0, '127.0.0.1', resolve);
    });
    return server;
  }
  return { prod, dev, construct, start, sdkLoads: () => sdkLoads };
}

function request(server, { token = DEV_TOKEN, host, origin, url = '/v1/status', method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method, headers: {
      Host: host ?? '127.0.0.1:' + server.address().port, Authorization: 'Bearer ' + token,
      ...(origin ? { Origin: origin } : {}), ...headers,
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, res => {
      let text = '';
      res.on('data', value => { text += value; });
      res.on('end', () => resolve({ status: res.statusCode, text, body: JSON.parse(text), headers: res.headers }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function snapshot(directory) {
  const result = {};
  async function walk(root) {
    for (const name of (await fs.readdir(root)).sort()) {
      const filename = path.join(root, name);
      const stat = await fs.lstat(filename);
      if (stat.isSymbolicLink()) result[path.relative(directory, filename)] = await fs.readlink(filename);
      else if (stat.isDirectory()) await walk(filename);
      else result[path.relative(directory, filename)] = digest(await fs.readFile(filename));
    }
  }
  await walk(directory);
  return result;
}

async function seedRunning(config) {
  if (config.instance) config = await loadConfig(path.join(config.stateDirectory, 'manager.json'));
  await jobSummary(config);
  const db = new DatabaseSync(path.join(config.stateDirectory, 'toolkit-jobs.sqlite'));
  try {
    db.prepare('INSERT INTO jobs(id,kind,state,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(JOB_ID, 'vm_inventory', 'running', '2026-01-01', '2026-01-01');
  } finally { db.close(); }
}

test('DEV descriptor is strict and legacy defaults remain compatible', async t => {
  const f = await pair(t);
  assert.equal((await loadConfig(f.prod.configPath)).instance, undefined);
  const loaded = await loadConfig(f.dev.configPath);
  assert.deepEqual(loaded.instance, f.dev.config.instance);
  assert.ok(Object.isFrozen(loaded.instance));
  for (const invalid of [null, [], {}, { ...loaded.instance, kind: 'production' },
    { ...loaded.instance, id: 'prod' }, { ...loaded.instance, id: '../dev' },
    { ...loaded.instance, port: 19740 }, { ...loaded.instance, port: 0 },
    { ...loaded.instance, port: '19741' }, { ...loaded.instance, port: 65536 },
    { ...loaded.instance, host: '0.0.0.0' }, { ...loaded.instance, productionConfigPath: 'relative' }]) {
    await fs.writeFile(f.dev.configPath, JSON.stringify({ ...f.dev.config, instance: invalid }));
    await assert.rejects(loadConfig(f.dev.configPath), /invalid_instance/);
  }
});

test('two inert managers coexist with independent routing, credentials, policy and job state', async t => {
  const f = await pair(t);
  const prodServer = await f.start(f.prod);
  const devServer = await f.start();
  const prodRequest = options => request(prodServer, { token: TEST_TOKEN, host: '127.0.0.1:19740', ...options });
  const before = await prodRequest();
  assert.equal(before.status, 200);
  const devStatus = await request(devServer);
  assert.equal(devStatus.status, 200);
  assert.equal(devStatus.body.service.name, 'MTerm-CLI Manager DEV');
  assert.deepEqual(devStatus.body.service.instance, { kind: 'dev', id: 'dev-fixture', port: f.dev.config.instance.port, upstreamEnabled: false });
  assert.equal(before.body.service.instance, undefined);
  assert.equal(devStatus.body.remoteMcp.state, 'unavailable');
  assert.equal(devStatus.body.remoteMcp.unavailableReason, 'dev_upstream_disabled');
  assert.equal(devStatus.body.inventory.entries[0].id, 'development-fixture');
  assert.equal(before.body.inventory.entries[0].id, 'production-fixture');
  for (const value of [DEV_TOKEN, TEST_TOKEN, digest(DEV_TOKEN), f.prod.directory, f.dev.directory]) {
    assert.equal(devStatus.text.includes(value), false);
  }
  for (const url of ['/v1/status', '/v1/policy', '/mcp']) {
    assert.equal((await request(devServer, { url, token: TEST_TOKEN })).status, 401);
    assert.equal((await prodRequest({ url, token: DEV_TOKEN })).status, 401);
  }
  for (const host of ['127.0.0.1:19740', 'localhost:19740', 'mcp-origin.m-techlabs.com', 'attacker.test']) {
    assert.equal((await request(devServer, { host, headers: { 'X-Forwarded-Host': '127.0.0.1:' + f.dev.config.instance.port } })).status, 403);
  }
  assert.equal((await prodRequest({ host: '127.0.0.1:' + f.dev.config.instance.port })).status, 403);
  assert.equal((await prodRequest({ origin: 'http://localhost:' + f.dev.config.instance.port })).status, 403);
  assert.equal((await request(devServer, { origin: 'https://m-techlabs.com' })).status, 403);
  assert.equal((await request(devServer, { origin: 'http://localhost:' + f.dev.config.instance.port })).status, 200);
  assert.equal((await request(devServer, { url: '/mcp', method: 'POST', body: {} })).status, 503);
  assert.equal(f.sdkLoads(), 0);
  assert.equal(devStatus.headers['access-control-allow-origin'], undefined);
  const prodPolicy = await fs.readFile(f.prod.config.policyPath, 'utf8');
  const changedDev = { enabled: false, readOnly: true, maxInflight: 2 };
  assert.equal((await request(devServer, { url: '/v1/policy', method: 'POST', body: changedDev })).status, 200);
  assert.equal(await fs.readFile(f.prod.config.policyPath, 'utf8'), prodPolicy);
  const devPolicy = await fs.readFile(f.dev.config.policyPath, 'utf8');
  assert.equal((await prodRequest({ url: '/v1/policy', method: 'POST', body: { enabled: false, readOnly: true, maxInflight: 3 } })).status, 200);
  assert.equal(await fs.readFile(f.dev.config.policyPath, 'utf8'), devPolicy);
  const devDb = new DatabaseSync(path.join(f.dev.config.stateDirectory, 'toolkit-jobs.sqlite'));
  try { devDb.prepare('INSERT INTO jobs(id,kind,state,created_at,updated_at) VALUES(?,?,?,?,?)').run(JOB_ID, 'vm_inventory', 'succeeded', '2026-01-01', '2026-01-01'); }
  finally { devDb.close(); }
  assert.equal((await request(devServer)).body.toolkitJobs.counts.succeeded, 1);
  assert.equal((await prodRequest()).body.toolkitJobs.counts.succeeded, 0);
});

test('DEV rejects equal effective credentials including plaintext versus digest', async t => {
  const f = await pair(t);
  for (const value of [TEST_TOKEN, 'sha256:' + digest(TEST_TOKEN)]) {
    await fs.writeFile(f.dev.config.tokenPath, value);
    await assert.rejects(f.construct(), /dev_credential_overlap/);
  }
});

test('DEV rejects missing, changed or mismatched configuration references before writes', async t => {
  const f = await pair(t);
  const before = await snapshot(f.prod.directory);
  await assert.rejects(createAdminServer(f.dev.config), /dev_config_required/);
  const original = f.dev.configPath;
  f.dev.configPath = f.prod.configPath;
  await assert.rejects(f.construct(), /dev_/);
  f.dev.configPath = original;
  await fs.writeFile(original, JSON.stringify({ ...f.dev.config, minimumFreeMemoryMiB: 512 }));
  await assert.rejects(f.construct(), /dev_config_mismatch/);
  assert.deepEqual(await snapshot(f.prod.directory), before);
});

test('DEV rejects equal, nested and normalized production state overlaps before recovery', async t => {
  const f = await pair(t);
  await seedRunning(f.prod.config);
  const before = await snapshot(f.prod.directory);
  for (const stateDirectory of [f.prod.config.stateDirectory, path.join(f.prod.config.stateDirectory, 'child'),
    f.prod.directory, path.join(f.prod.config.stateDirectory, '..', 'state')]) {
    const config = { ...f.dev.config, stateDirectory };
    await fs.writeFile(f.dev.configPath, JSON.stringify(config));
    await assert.rejects(createAdminServer(config, { configPath: f.dev.configPath }), /dev_/);
  }
  assert.deepEqual(await snapshot(f.prod.directory), before);
});

test('DEV rejects policy, token and inventory references outside its own state', async t => {
  const f = await pair(t);
  for (const key of ['policyPath', 'tokenPath', 'inventoryPath']) {
    const config = { ...f.dev.config, [key]: f.prod.config[key] };
    await fs.writeFile(f.dev.configPath, JSON.stringify(config));
    await assert.rejects(createAdminServer(config, { configPath: f.dev.configPath }), /dev_/);
  }
});

test('DEV rejects linked state and ancestor junctions before touching protected files', async t => {
  const f = await pair(t);
  const before = await snapshot(f.prod.directory);
  const link = path.join(f.dev.directory, 'alias');
  await fs.symlink(f.prod.directory, link, process.platform === 'win32' ? 'junction' : 'dir');
  for (const stateDirectory of [link, path.join(link, 'state')]) {
    const config = { ...f.dev.config, stateDirectory };
    await fs.writeFile(f.dev.configPath, JSON.stringify(config));
    await assert.rejects(createAdminServer(config, { configPath: f.dev.configPath }), /dev_/);
  }
  assert.deepEqual(await snapshot(f.prod.directory), before);
});

test('DEV rejects hardlinked controls, database files and sidecars', async t => {
  const f = await pair(t);
  const protectedFile = path.join(f.prod.config.stateDirectory, 'protected-bytes');
  await fs.writeFile(protectedFile, 'unchanged-production-fixture');
  const before = await snapshot(f.prod.directory);
  for (const name of ['manager.json', 'admin-token', 'policy.json', 'toolkit.json', 'toolkit-jobs.sqlite', 'toolkit-jobs.sqlite-wal', 'toolkit-jobs.sqlite-shm', 'admission.sqlite', 'admission.sqlite-wal', 'admission.sqlite-shm', 'inventory.json']) {
    const target = path.join(f.dev.config.stateDirectory, name);
    const previous = await fs.readFile(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.rm(target, { force: true });
    await fs.link(protectedFile, target);
    await assert.rejects(f.construct(), /dev_/);
    await fs.unlink(target);
    if (previous) await fs.writeFile(target, previous);
  }
  assert.deepEqual(await snapshot(f.prod.directory), before);
});

test('DEV rejects nested links and control files using reserved state names', async t => {
  const f = await pair(t);
  const link = path.join(f.dev.config.stateDirectory, 'nested-alias');
  await fs.symlink(f.prod.config.stateDirectory, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.construct(), /dev_linked_state/);
  await fs.unlink(link);
  for (const name of ['toolkit.json', 'toolkit-jobs.sqlite', 'admission.sqlite-wal', 'deployment.json', 'manager-owner.lock']) {
    const tokenPath = path.join(f.dev.config.stateDirectory, name);
    await fs.copyFile(f.dev.config.tokenPath, tokenPath);
    const config = { ...f.dev.config, tokenPath };
    await fs.writeFile(f.dev.configPath, JSON.stringify(config));
    await assert.rejects(createAdminServer(config, { configPath: f.dev.configPath }), /dev_control_path/);
    await fs.unlink(tokenPath);
  }
});

test('Windows case aliases of production state are rejected', { skip: process.platform !== 'win32' }, async t => {
  const f = await pair(t);
  const config = { ...f.dev.config, stateDirectory: f.prod.config.stateDirectory.toUpperCase() };
  await fs.writeFile(f.dev.configPath, JSON.stringify(config));
  await assert.rejects(createAdminServer(config, { configPath: f.dev.configPath }), /dev_state_overlap/);
});

test('Windows DEV rejects alternate streams and trailing-dot or space control aliases', { skip: process.platform !== 'win32' }, async t => {
  const f = await pair(t);
  for (const suffix of [':stream', '.', ' ']) {
    const config = { ...f.dev.config, tokenPath: f.dev.config.tokenPath + suffix };
    await fs.writeFile(f.dev.configPath, JSON.stringify(config));
    await assert.rejects(createAdminServer(config, { configPath: f.dev.configPath }), /dev_invalid_path/);
  }
});

test('DEV refuses a duplicate owner before it can recover running jobs and drains before release', async t => {
  const f = await pair(t);
  const first = await f.construct();
  await seedRunning(f.dev.config);
  const before = await snapshot(f.dev.config.stateDirectory);
  await assert.rejects(f.construct(), /dev_state_owned/);
  assert.deepEqual(await snapshot(f.dev.config.stateDirectory), before);
  await close(first);
  const second = await f.start();
  await close(second);
  const third = await f.construct();
  await close(third);
});

test('DEV listener cannot bind a different port or public interface', async t => {
  const f = await pair(t);
  const server = await f.construct();
  for (const args of [[0, '127.0.0.1'], [f.dev.config.instance.port, '0.0.0.0'], [f.dev.config.instance.port]]) {
    assert.throws(() => server.listen(...args), /dev_listener_required/);
    assert.equal(server.listening, false);
  }
});

test('DEV close prevents same-turn first listen before its asynchronous close event', async t => {
  const f = await pair(t);
  const server = await f.construct();
  const closed = close(server);
  assert.throws(() => server.listen(f.dev.config.instance.port, '127.0.0.1'), /dev_listener_consumed/);
  await closed;
  assert.equal(server.listening, false);
  const next = await f.start();
  await close(next);
});

test('DEV keeps ownership until deferred job recovery drains after close', async t => {
  const f = await pair(t);
  const server = await f.construct();
  const original = fs.mkdir;
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let held = false;
  fs.mkdir = async (...args) => {
    if (args[0] === f.dev.config.stateDirectory && !held) { held = true; enter(); await gate; }
    return original(...args);
  };
  t.after(() => { fs.mkdir = original; release(); });
  try {
    await new Promise(resolve => server.listen(f.dev.config.instance.port, '127.0.0.1', resolve));
    await entered;
    let closed = false;
    const drained = close(server).then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false);
    await assert.rejects(f.construct(), /dev_state_owned/);
    release();
    await drained;
    const next = await f.construct();
    await close(next);
  } finally { fs.mkdir = original; release(); }
});

test('DEV cleanup refuses to delete a replaced ownership file', async t => {
  const f = await pair(t);
  const server = await createAdminServer(f.dev.config, { configPath: f.dev.configPath });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const lock = path.join(f.dev.config.stateDirectory, 'manager-owner.lock');
  // Renaming keeps the original inode alive; the replacement cannot reuse it.
  await fs.rename(lock, path.join(f.dev.config.stateDirectory, 'previous-owner.lock'));
  await fs.writeFile(lock, 'replacement-owner');
  await assert.rejects(close(server), /dev_owner_changed/);
  assert.equal(await fs.readFile(lock, 'utf8'), 'replacement-owner');
});

test('occupied DEV port fails before recovery, releases only its own lock, and never takes over stale locks', async t => {
  const f = await pair(t);
  await seedRunning(f.dev.config);
  const occupied = http.createServer();
  await new Promise(resolve => occupied.listen(f.dev.config.instance.port, '127.0.0.1', resolve));
  t.after(() => close(occupied));
  const server = await f.construct();
  const error = await new Promise(resolve => {
    server.once('error', resolve);
    server.listen(f.dev.config.instance.port, '127.0.0.1');
  });
  assert.equal(error.code, 'EADDRINUSE');
  await server.managedClosed;
  const status = await jobSummary(await loadConfig(f.dev.configPath));
  assert.equal(status.counts.running, 1);
  const next = await f.construct();
  await close(next);
  const lock = path.join(f.dev.config.stateDirectory, 'manager-owner.lock');
  await fs.writeFile(lock, '{"pid":999999999,"id":"stale-fixture"}');
  await assert.rejects(f.construct(), /dev_state_owned/);
  assert.equal(await fs.readFile(lock, 'utf8'), '{"pid":999999999,"id":"stale-fixture"}');
});

test('direct DEV gateway entry fails before state creation or any upstream spawn', async t => {
  const f = await pair(t);
  const before = await snapshot(f.dev.config.stateDirectory);
  let spawned = 0;
  await assert.rejects(startGateway({ config: f.dev.config, spawnImpl() { spawned++; throw new Error('unexpected_spawn'); } }), /dev_upstream_disabled/);
  assert.equal(spawned, 0);
  assert.deepEqual(await snapshot(f.dev.config.stateDirectory), before);
});

test('DEV config validation protects existing toolkit CLI and direct state writers', async t => {
  const f = await pair(t);
  const before = await snapshot(f.prod.directory);
  const unsafe = { ...f.dev.config, stateDirectory: f.prod.config.stateDirectory };
  await fs.writeFile(f.dev.configPath, JSON.stringify(unsafe));
  await assert.rejects(jobSummary(unsafe), /dev_validation_required/);
  await assert.rejects(configure(['--config', f.dev.configPath, '--add-root', 'fixture', f.prod.directory]), /dev_/);
  await assert.rejects(writeToolkit(unsafe, await readToolkit(f.prod.config)), /dev_validation_required/);
  await assert.rejects(inspectAdmissions(unsafe), /dev_validation_required/);
  assert.throws(() => startJobRunner(unsafe), /dev_validation_required/);
  assert.deepEqual(await snapshot(f.prod.directory), before);
  await fs.writeFile(f.dev.configPath, JSON.stringify(f.dev.config));
  const valid = await loadConfig(f.dev.configPath);
  assert.throws(() => startJobRunner(valid), /dev_ownership_required/);
  await writeToolkit(valid, await readToolkit(valid));
  assert.equal((await jobSummary(valid)).available, true);
});
