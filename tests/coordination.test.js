import test from 'node:test';
import assert from 'node:assert/strict';
import { createDB, seedAuth } from './helpers/d1.js';
import { one, rows, run, rateLimit } from '../src/db.js';
import { acquireScan, executeScan, initializeSources, recomputeStatuses, aggregateEvidence, codeList, COOLDOWN_SECONDS } from '../src/codes.js';
import { HISTORICAL_CODES } from '../src/sources.js';

const time = () => Math.floor(Date.now() / 1000);

async function fixture(t) {
  const DB = createDB(); t.after(() => DB.close());
  const now = time();
  await initializeSources(DB, now);
  await run(DB, "UPDATE sources SET enabled=CASE WHEN id IN ('codex','wiki-active') THEN 1 ELSE 0 END");
  return { DB };
}

function mockSources(codes, options = {}) {
  const fetched = [];
  const fetcher = async url => {
    fetched.push(url);
    if (url.includes('api.tacticuscodex.com')) {
      return Response.json({ gameCodes: codes.map(code => ({ code, isActive: true,
        rewards: [{ type: 'gold', quantity: 100 }] })) });
    }
    if (url.includes('/wiki/Active_Codes')) {
      if (options.wikiStatus) return new Response('Source unavailable', { status: options.wikiStatus });
      return new Response(`<div class="mw-parser-output"><ul>${codes.map(code => `<li>${code} - 100 Coins</li>`).join('')}</ul></div><div class="printfooter">End</div>`,
        { headers: { 'Content-Type': 'text/html' } });
    }
    throw new Error(`Unexpected source ${url}`);
  };
  return { fetcher, fetched };
}

test('50 simultaneous visitors obtain one global scan lease and one scan run', async t => {
  const { DB } = await fixture(t), now = time();
  const results = await Promise.all(Array.from({ length: 50 }, () => acquireScan(DB, 'manual', now)));
  assert.equal(results.filter(result => result.acquired).length, 1);
  assert.equal((await one(DB, 'SELECT COUNT(*) AS n FROM scan_runs')).n, 1);
  assert.equal((await one(DB, 'SELECT * FROM scan_state WHERE id=1')).next_allowed, now + 900);
});

test('manual and scheduled callers share the same 15-minute cooldown after release', async t => {
  const { DB } = await fixture(t), now = time();
  const first = await acquireScan(DB, 'manual', now);
  assert.equal(first.acquired, true);
  await run(DB, 'UPDATE scan_state SET lease_id=NULL,lease_until=0 WHERE id=1');
  assert.equal((await acquireScan(DB, 'scheduled', now + 1)).acquired, false);
  assert.equal((await acquireScan(DB, 'manual', now + 899)).acquired, false);
  assert.equal((await acquireScan(DB, 'scheduled', now + 900)).acquired, true);
  assert.equal((await acquireScan(DB, 'manual', now + 900)).acquired, false);
});

test('a running lease cannot be replaced even if cooldown is accidentally expired', async t => {
  const { DB } = await fixture(t), now = time();
  const first = await acquireScan(DB, 'manual', now);
  await run(DB, 'UPDATE scan_state SET next_allowed=0 WHERE id=1');
  assert.equal((await acquireScan(DB, 'scheduled', now + 20)).acquired, false);
  assert.equal((await one(DB, 'SELECT lease_id FROM scan_state WHERE id=1')).lease_id, first.id);
});

test('atomic rate limiting caps concurrent callers and resets only at server time boundary', async t => {
  const { DB } = await fixture(t), now = time();
  const attempts = await Promise.all(Array.from({ length: 50 }, () => rateLimit(DB, 'guild-ip:hashed-ip', 8, 900, now)));
  assert.equal(attempts.filter(attempt => attempt.allowed).length, 8);
  assert.equal((await rateLimit(DB, 'guild-ip:hashed-ip', 8, 900, now + 899)).allowed, false);
  const reset = await rateLimit(DB, 'guild-ip:hashed-ip', 8, 900, now + 900);
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, 7);
});

test('all 13 historical seeds remain suppressed after successful corroboration', async t => {
  const env = await fixture(t), now = time();
  await initializeSources(env.DB, now); // Re-running deployment initialization is idempotent.
  const sources = mockSources(HISTORICAL_CODES);
  await executeScan(env, await acquireScan(env.DB, 'scheduled', now), { fetcher: sources.fetcher, now });
  const records = await rows(env.DB, 'SELECT * FROM codes');
  assert.equal(records.length, 13);
  assert.ok(records.every(record => record.historical === 1 && record.baseline === 1 && record.status === 'corroborated'));
  const notifications = await rows(env.DB, 'SELECT * FROM notifications');
  assert.equal(notifications.length, 13);
  assert.ok(notifications.every(item => item.state === 'suppressed'));
  assert.ok((await codeList(env.DB, 'user:owner', now)).codes.every(item => !item.isNew));
});

test('first live baseline is suppressed; newly discovered later codes queue exactly once', async t => {
  const env = await fixture(t), now = time();
  let sources = mockSources(['EXISTINGBASELINE', 'MiXeDCase', 'mixedcase']);
  await executeScan(env, await acquireScan(env.DB, 'scheduled', now), { fetcher: sources.fetcher, now });
  assert.equal((await one(env.DB, 'SELECT baseline_completed FROM scan_state')).baseline_completed, 1);
  assert.equal((await one(env.DB, "SELECT COUNT(*) AS n FROM codes WHERE code='mixedcase'")).n, 1);
  assert.equal((await one(env.DB, "SELECT state FROM notifications WHERE code='EXISTINGBASELINE'")).state, 'suppressed');
  assert.equal((await one(env.DB, "SELECT COUNT(*) AS n FROM notifications WHERE state='pending'")).n, 0);
  const later = now + COOLDOWN_SECONDS;
  sources = mockSources(['EXISTINGBASELINE', 'NEWAFTERBASELINE']);
  await executeScan(env, await acquireScan(env.DB, 'manual', later), { fetcher: sources.fetcher, now: later });
  assert.equal((await one(env.DB, "SELECT state FROM notifications WHERE code='NEWAFTERBASELINE'")).state, 'pending');
  await recomputeStatuses(env.DB, later);
  await recomputeStatuses(env.DB, later + 1);
  assert.equal((await one(env.DB, "SELECT COUNT(*) AS n FROM notifications WHERE code='NEWAFTERBASELINE'")).n, 1);
  const list = await codeList(env.DB, 'user:owner', later);
  assert.equal(list.codes.find(code => code.code === 'NEWAFTERBASELINE').isNew, true);
  assert.equal(list.codes.find(code => code.code === 'EXISTINGBASELINE').isNew, false);
});

test('a source recovering after initial failure does not announce its backlog as new', async t => {
  const env = await fixture(t), now = time();
  let sources = mockSources(['CODEXBACKLOG'], { wikiStatus: 429 });
  let result = await executeScan(env, await acquireScan(env.DB, 'scheduled', now), { fetcher: sources.fetcher, now });
  assert.equal(result.failures, 1);
  assert.equal((await one(env.DB, 'SELECT baseline_completed FROM scan_state')).baseline_completed, 0);
  const wiki = await one(env.DB, "SELECT * FROM sources WHERE id='wiki-active'");
  assert.equal(wiki.last_status, 429);
  assert.equal(wiki.backoff_until, now + 3600);
  const later = now + 3600;
  sources = mockSources(['CODEXBACKLOG', 'OLDWIKIBACKLOG']);
  result = await executeScan(env, await acquireScan(env.DB, 'scheduled', later), { fetcher: sources.fetcher, now: later });
  assert.equal(result.failures, 0);
  assert.equal((await one(env.DB, 'SELECT baseline_completed FROM scan_state')).baseline_completed, 1);
  assert.equal((await one(env.DB, "SELECT state FROM notifications WHERE code='OLDWIKIBACKLOG'")).state, 'suppressed');
});

test('source failures preserve cached evidence and display the upstream failure', async t => {
  const env = await fixture(t), now = time();
  const working = mockSources(['CACHEPRESERVED']);
  await executeScan(env, await acquireScan(env.DB, 'scheduled', now), { fetcher: working.fetcher, now });
  const before = await one(env.DB, "SELECT * FROM code_evidence WHERE code='CACHEPRESERVED' AND source_id='codex'");
  const later = now + 900;
  const result = await executeScan(env, await acquireScan(env.DB, 'manual', later), {
    fetcher: async () => new Response('Unavailable', { status: 503 }), now: later,
  });
  assert.equal(result.ok, false);
  assert.equal(result.successes, 0);
  assert.equal(result.failures, 2);
  const after = await one(env.DB, "SELECT * FROM code_evidence WHERE code='CACHEPRESERVED' AND source_id='codex'");
  assert.deepEqual(after, before);
  const state = await one(env.DB, 'SELECT * FROM scan_state');
  assert.match(state.last_error, /failed/);
  assert.equal((await one(env.DB, "SELECT last_status FROM sources WHERE id='codex'")).last_status, 503);
});

test('personal redeemed state does not verify global validity or leak to another person', async t => {
  const env = await fixture(t), now = time();
  await seedAuth(env.DB, now);
  await run(env.DB, 'INSERT INTO redemptions(subject,code,redeemed_at) VALUES(?,?,?)', 'user:alice', 'BALDRWEEN', now);
  await recomputeStatuses(env.DB, now);
  assert.equal((await one(env.DB, "SELECT status FROM codes WHERE code='BALDRWEEN'")).status, 'unverified');
  assert.equal((await codeList(env.DB, 'user:alice', now)).codes.find(code => code.code === 'BALDRWEEN').redeemed, true);
  assert.equal((await codeList(env.DB, 'user:bob', now)).codes.find(code => code.code === 'BALDRWEEN').redeemed, false);
  await run(env.DB, 'INSERT INTO reports(user_id,code,outcome,reported_at) VALUES(?,?,?,?)', 'alice', 'BALDRWEEN', 'working', now);
  await recomputeStatuses(env.DB, now);
  assert.equal((await one(env.DB, "SELECT status FROM codes WHERE code='BALDRWEEN'")).status, 'player_confirmed');
  await run(env.DB, 'UPDATE users SET status=? WHERE id=?', 'suspended', 'alice');
  await recomputeStatuses(env.DB, now);
  assert.equal((await one(env.DB, "SELECT status FROM codes WHERE code='BALDRWEEN'")).status, 'unverified');
});

test('two pages from one publication do not masquerade as independent corroboration', () => {
  const now = time();
  assert.equal(aggregateEvidence([
    { source_domain: 'tacticus.wiki.gg', source_status: 'active', observed_at: now },
    { source_domain: 'tacticus.wiki.gg', source_status: 'unknown', observed_at: now },
  ], [], now).status, 'likely_active');
  assert.equal(aggregateEvidence([
    { source_domain: 'one.example', source_status: 'active', observed_at: now - 8 * 86400 },
    { source_domain: 'two.example', source_status: 'active', observed_at: now - 8 * 86400 },
  ], [], now).status, 'unverified');
});
