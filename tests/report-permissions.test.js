import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createDB, seedAuth } from './helpers/d1.js';
import { initializeSources } from '../src/codes.js';
import { createSession, CODE_COOKIE } from '../src/auth.js';
import { one, run } from '../src/db.js';

async function fixture(t, role = 'viewer') {
  const DB = createDB();
  t.after(() => DB.close());
  const now = Math.floor(Date.now() / 1000);
  await seedAuth(DB, now);
  await initializeSources(DB, now);
  const env = { DB, CODE_HOST: 'codes.m-techlabs.com', HUB_HOST: 'm-techlabs.com', OWNER_EMAIL: 'owner@example.com' };
  await run(DB, 'INSERT INTO grants(user_id,app_id,role,updated_at) VALUES(?,?,?,?)', 'alice', 'codes', role, now);
  const user = await one(DB, "SELECT * FROM users WHERE id='alice'");
  const session = await createSession(env, { kind: 'google', user }, now);
  return { env, session, now };
}

async function post(env, session, path, body, headers = {}) {
  const request = new Request(`https://codes.m-techlabs.com${path}`, {
    method: 'POST', headers: {
      Cookie: `${CODE_COOKIE}=${session.token}`,
      Origin: 'https://codes.m-techlabs.com',
      'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf,
      'CF-Connecting-IP': '192.0.2.20', ...headers,
    }, body: JSON.stringify(body),
  });
  return worker.fetch(request, env, { waitUntil() { throw new Error('No background scan is expected in report-permission tests.'); } });
}

test('a Viewer with a valid session and CSRF token cannot create a global player report', async t => {
  const { env, session } = await fixture(t);
  const response = await post(env, session, '/api/report', { code: 'BALDRWEEN', outcome: 'working' });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /role cannot submit/);
  assert.equal((await one(env.DB, 'SELECT COUNT(*) AS n FROM reports')).n, 0);
  assert.equal((await one(env.DB, "SELECT status FROM codes WHERE code='BALDRWEEN'")).status, 'unverified');
});

test('individually approved Guild Member and higher native roles can report without marking personal redemption', async t => {
  const { env, session, now } = await fixture(t, 'guild_member');
  for (const role of ['guild_member', 'editor', 'operator', 'administrator']) {
    await run(env.DB, "UPDATE grants SET role=?,updated_at=? WHERE user_id='alice' AND app_id='codes'", role, now);
    const response = await post(env, session, '/api/report', { code: 'BALDRWEEN', outcome: 'working' });
    assert.equal(response.status, 200, `${role} should retain player reporting`);
    assert.equal((await one(env.DB, "SELECT outcome FROM reports WHERE user_id='alice' AND code='BALDRWEEN'")).outcome, 'working');
  }
  assert.equal((await one(env.DB, 'SELECT COUNT(*) AS n FROM reports')).n, 1);
  assert.equal((await one(env.DB, 'SELECT COUNT(*) AS n FROM redemptions')).n, 0);
  assert.equal((await one(env.DB, "SELECT status FROM codes WHERE code='BALDRWEEN'")).status, 'player_confirmed');
});

test('Viewer redeemed controls and cached refresh remain available without changing global validity', async t => {
  const { env, session, now } = await fixture(t);
  const marked = await post(env, session, '/api/redeemed', { code: 'BALDRWEEN', redeemed: true });
  assert.equal(marked.status, 200);
  assert.equal((await one(env.DB, "SELECT COUNT(*) AS n FROM redemptions WHERE subject='user:alice' AND code='BALDRWEEN'")).n, 1);
  assert.equal((await one(env.DB, 'SELECT COUNT(*) AS n FROM reports')).n, 0);
  assert.equal((await one(env.DB, "SELECT status FROM codes WHERE code='BALDRWEEN'")).status, 'unverified');
  await run(env.DB, 'UPDATE scan_state SET next_allowed=? WHERE id=1', now + 900);
  const refresh = await post(env, session, '/api/refresh', {});
  assert.equal(refresh.status, 200);
  assert.equal((await refresh.json()).started, false);
  const unmarked = await post(env, session, '/api/redeemed', { code: 'BALDRWEEN', redeemed: false });
  assert.equal(unmarked.status, 200);
  assert.equal((await one(env.DB, 'SELECT COUNT(*) AS n FROM redemptions')).n, 0);
});

test('downgrading a live individual session to Viewer blocks its next report request', async t => {
  const { env, session, now } = await fixture(t, 'guild_member');
  await run(env.DB, "UPDATE grants SET role='viewer',updated_at=? WHERE user_id='alice' AND app_id='codes'", now);
  const response = await post(env, session, '/api/report', { code: 'BALDRWEEN', outcome: 'failed' });
  assert.equal(response.status, 403);
  assert.equal((await one(env.DB, 'SELECT COUNT(*) AS n FROM reports')).n, 0);
});

test('shared guild sessions still cannot submit public reports but can use their own checklist', async t => {
  const { env, now } = await fixture(t);
  await run(env.DB, 'UPDATE guild_access SET enabled=1,version=7 WHERE id=1');
  const session = await createSession(env, { kind: 'guild', guildVersion: 7 }, now);
  const denied = await post(env, session, '/api/report', { code: 'BALDRWEEN', outcome: 'working' });
  assert.equal(denied.status, 403);
  assert.match((await denied.json()).error, /individually approved/);
  const personal = await post(env, session, '/api/redeemed', { code: 'BALDRWEEN', redeemed: true });
  assert.equal(personal.status, 200);
  assert.equal((await one(env.DB, 'SELECT COUNT(*) AS n FROM redemptions WHERE subject=?', `guild:${session.id}`)).n, 1);
  assert.equal((await one(env.DB, 'SELECT COUNT(*) AS n FROM reports')).n, 0);
});

test('a reporting-capable role cannot bypass report CSRF or exact-origin protection', async t => {
  const { env, session } = await fixture(t, 'guild_member');
  const missingCsrf = await post(env, session, '/api/report', { code: 'BALDRWEEN', outcome: 'working' }, { 'X-CSRF-Token': '' });
  assert.equal(missingCsrf.status, 403);
  const siblingOrigin = await post(env, session, '/api/report', { code: 'BALDRWEEN', outcome: 'working' }, { Origin: 'https://tracker.m-techlabs.com' });
  assert.equal(siblingOrigin.status, 403);
  assert.equal((await one(env.DB, 'SELECT COUNT(*) AS n FROM reports')).n, 0);
});
