import test from 'node:test';
import assert from 'node:assert/strict';
import { createDB } from './helpers/d1.js';
import { one, run } from '../src/db.js';
import { initializeSources, acquireScan, executeScan, recomputeStatuses, aggregateEvidence, codeList } from '../src/codes.js';

const NOW = Math.floor(Date.now() / 1000);

async function fixture(t, ids = ['codex', 'wiki-active']) {
  const DB = createDB();
  t.after(() => DB.close());
  await initializeSources(DB, NOW);
  await run(DB, 'UPDATE sources SET enabled=0');
  for (const id of ids) await run(DB, 'UPDATE sources SET enabled=1 WHERE id=?', id);
  return { DB };
}

function fetcherFor(codes, { wikiCodes = codes, expiresAt = null } = {}) {
  return async url => {
    if (url.includes('api.tacticuscodex.com')) return Response.json({ gameCodes: codes.map(code => ({ code, isActive: true, expiresAt, rewards: [{ type: 'gold', quantity: 100 }] })) });
    if (url.includes('/wiki/Active_Codes')) return new Response(`<div class="mw-parser-output"><ul>${wikiCodes.map(code => `<li>${code} - 100 Coins</li>`).join('')}</ul></div><div class="printfooter">End</div>`, { headers: { 'content-type': 'text/html' } });
    throw new Error('Unexpected endpoint');
  };
}

async function scan(env, now, fetcher) {
  const lease = await acquireScan(env.DB, 'scheduled', now);
  assert.equal(lease.acquired, true);
  return executeScan(env, lease, { now, fetcher });
}

function instrumentCalls(db) {
  let count = 0;
  const originalPrepare = db.prepare.bind(db);
  const originalBatch = db.batch.bind(db);
  const wrap = stmt => ({
    bind(...values) { return wrap(stmt.bind(...values)); },
    first(...args) { count++; return stmt.first(...args); },
    all(...args) { count++; return stmt.all(...args); },
    run(...args) { count++; return stmt.run(...args); },
    execute(...args) { return stmt.execute(...args); },
  });
  db.prepare = sql => wrap(originalPrepare(sql));
  db.batch = statements => { count++; return originalBatch(statements); };
  return { get count() { return count; }, reset() { count = 0; } };
}

test('identical reordered snapshots write no evidence/code rows while effective last_seen advances', async t => {
  const env = await fixture(t);
  await scan(env, NOW, fetcherFor(['UNCHANGEDONE', 'UNCHANGEDTWO']));
  const evidence = await one(env.DB, "SELECT * FROM code_evidence WHERE code='UNCHANGEDONE' AND source_id='codex'");
  const code = await one(env.DB, "SELECT * FROM codes WHERE code='UNCHANGEDONE'");
  const source = await one(env.DB, "SELECT * FROM sources WHERE id='codex'");
  const later = NOW + 1800;
  const result = await scan(env, later, fetcherFor(['UNCHANGEDTWO', 'UNCHANGEDONE']));
  assert.equal(result.changed, false);
  assert.equal(result.discovered, 0);
  assert.deepEqual(await one(env.DB, "SELECT * FROM code_evidence WHERE code='UNCHANGEDONE' AND source_id='codex'"), evidence);
  assert.deepEqual(await one(env.DB, "SELECT * FROM codes WHERE code='UNCHANGEDONE'"), code);
  const after = await one(env.DB, "SELECT * FROM sources WHERE id='codex'");
  assert.equal(after.snapshot_hash, source.snapshot_hash);
  assert.equal(after.current_generation, source.current_generation);
  assert.equal(after.last_success, later);
  const listed = (await codeList(env.DB, 'owner', later)).codes.find(item => item.code === 'UNCHANGEDONE');
  assert.equal(listed.last_seen, later);
  assert.ok(listed.sources.every(item => item.observed_at === later));
});

test('omission freezes prior observation and later unchanged snapshots cannot keep it fresh', async t => {
  const env = await fixture(t);
  await scan(env, NOW, fetcherFor(['STILLPRESENT', 'DISAPPEARED']));
  const lastSeen = NOW + 1800;
  await scan(env, lastSeen, fetcherFor(['STILLPRESENT', 'DISAPPEARED']));
  const changedAt = NOW + 3600;
  await scan(env, changedAt, fetcherFor(['STILLPRESENT']));
  const omitted = await one(env.DB, "SELECT * FROM code_evidence WHERE code='DISAPPEARED' AND source_id='codex'");
  assert.equal(omitted.observed_at, lastSeen);
  assert.equal(omitted.snapshot_generation, 1);
  assert.equal((await one(env.DB, "SELECT current_generation FROM sources WHERE id='codex'")).current_generation, 2);
  const future = lastSeen + 8 * 86400;
  await scan(env, future, fetcherFor(['STILLPRESENT']));
  const list = await codeList(env.DB, 'owner', future);
  const missing = list.codes.find(item => item.code === 'DISAPPEARED');
  const present = list.codes.find(item => item.code === 'STILLPRESENT');
  assert.equal(missing.status, 'unverified');
  assert.equal(missing.last_seen, lastSeen);
  assert.ok(missing.sources.every(item => item.in_current_snapshot === 0 && item.observed_at === lastSeen));
  assert.equal(present.status, 'corroborated');
  assert.equal(present.last_seen, future);
});

test('large cold import stays below 30 D1 calls and 48 unchanged scans stay far below 20000 writes', async t => {
  const env = await fixture(t);
  const calls = instrumentCalls(env.DB);
  const codes = Array.from({ length: 600 }, (_, i) => `ARCHIVECODE${String(i).padStart(4, '0')}`);
  const fetcher = fetcherFor(codes);
  await scan(env, NOW, fetcher);
  assert.ok(calls.count < 30, `cold import used ${calls.count} D1 calls`);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM code_evidence').get().n, 1200);
  const initialWrites = Number(env.DB.sqlite.prepare('SELECT total_changes() AS n').get().n);
  const firstEvidence = env.DB.sqlite.prepare("SELECT observed_at FROM code_evidence WHERE code='ARCHIVECODE0000' AND source_id='codex'").get().observed_at;
  calls.reset();
  for (let i = 1; i <= 48; i++) await scan(env, NOW + i * 1800, fetcher);
  const writes = Number(env.DB.sqlite.prepare('SELECT total_changes() AS n').get().n) - initialWrites;
  assert.ok(writes < 1000, `steady daily workload wrote ${writes} rows`);
  assert.equal(env.DB.sqlite.prepare("SELECT observed_at FROM code_evidence WHERE code='ARCHIVECODE0000' AND source_id='codex'").get().observed_at, firstEvidence);
  assert.ok(calls.count / 48 < 30);
  t.diagnostic(`1200-observation archive: ${writes} SQLite row changes for 48 unchanged scans; ${calls.count / 48} D1 calls per scan. Index billing and unrelated app writes are separate.`);
});

test('source Retry-After is honored beyond the default backoff without another upstream request', async t => {
  const env = await fixture(t, ['codex']);
  let fetched = 0;
  await scan(env, NOW, async () => { fetched++; return new Response('Wait', { status: 429, headers: { 'retry-after': '7200' } }); });
  const source = await one(env.DB, "SELECT * FROM sources WHERE id='codex'");
  assert.equal(source.backoff_until, NOW + 7200);
  const deferred = await scan(env, NOW + 1800, async () => { fetched++; throw new Error('must not fetch during backoff'); });
  assert.equal(fetched, 1);
  assert.equal(deferred.successes, 0);
  assert.equal(deferred.failures, 0);
  assert.equal((await one(env.DB, 'SELECT status FROM scan_runs ORDER BY started_at DESC LIMIT 1')).status, 'deferred');
});

test('a source enabled after bootstrap suppresses its first-seen historical backlog', async t => {
  const env = await fixture(t, ['codex']);
  await scan(env, NOW, fetcherFor(['BASELINEOLD']));
  assert.equal((await one(env.DB, 'SELECT baseline_completed FROM scan_state')).baseline_completed, 1);
  await run(env.DB, "UPDATE sources SET enabled=1 WHERE id='wiki-active'");
  await scan(env, NOW + 1800, fetcherFor(['BASELINEOLD'], { wikiCodes: ['BASELINEOLD', 'LATEWIKIARCHIVE'] }));
  assert.equal((await one(env.DB, "SELECT baseline FROM codes WHERE code='LATEWIKIARCHIVE'")).baseline, 1);
  assert.equal((await one(env.DB, "SELECT state FROM notifications WHERE code='LATEWIKIARCHIVE'")).state, 'suppressed');
});

test('date-only expiry remains active through its UTC day and expires at next midnight in JS and SQL', async t => {
  const env = await fixture(t, ['codex']);
  const noon = Date.parse('2026-12-01T12:00:00Z') / 1000;
  const midnight = Date.parse('2026-12-02T00:00:00Z') / 1000;
  await scan(env, noon, fetcherFor(['DATEDCODE'], { expiresAt: '2026-12-01' }));
  assert.equal((await one(env.DB, "SELECT status FROM codes WHERE code='DATEDCODE'")).status, 'likely_active');
  await recomputeStatuses(env.DB, midnight - 1);
  assert.equal((await one(env.DB, "SELECT status FROM codes WHERE code='DATEDCODE'")).status, 'likely_active');
  await recomputeStatuses(env.DB, midnight);
  assert.equal((await one(env.DB, "SELECT status FROM codes WHERE code='DATEDCODE'")).status, 'expired');
  const evidence = [{ source_domain: 'example.com', source_status: 'active', expires_at: '2026-12-01', observed_at: noon }];
  assert.equal(aggregateEvidence(evidence, [], midnight - 1).status, 'likely_active');
  assert.equal(aggregateEvidence(evidence, [], midnight).status, 'expired');
});

test('source snapshot publication rolls back atomically if an evidence insert fails', async t => {
  const env = await fixture(t, ['codex']);
  env.DB.sqlite.exec("CREATE TRIGGER reject_test BEFORE INSERT ON code_evidence WHEN NEW.code='ROLLBACKCODE' BEGIN SELECT RAISE(ABORT,'injected evidence failure'); END");
  await assert.rejects(scan(env, NOW, fetcherFor(['ROLLBACKCODE'])), /injected evidence failure/);
  assert.equal(await one(env.DB, "SELECT code FROM codes WHERE code='ROLLBACKCODE'"), null);
  const source = await one(env.DB, "SELECT * FROM sources WHERE id='codex'");
  assert.equal(source.snapshot_hash, null);
  assert.equal(source.current_generation, 0);
  assert.equal(source.last_success, null);
  assert.equal((await one(env.DB, 'SELECT lease_id FROM scan_state')).lease_id, null);
});
