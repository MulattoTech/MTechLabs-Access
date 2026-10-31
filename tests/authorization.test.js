import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createDB, seedAuth } from './helpers/d1.js';
import { permission, validRole, one, run, statement } from '../src/db.js';
import { createSession, readSession, codeIdentity, ownerIdentity, requireCsrf, gateway, ADMIN_COOKIE, CODE_COOKIE } from '../src/auth.js';
import { adminApi } from '../src/admin.js';

const TEAM = 'test-owner.cloudflareaccess.com';
let signer, publicKey;
before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  signer = pair.privateKey;
  publicKey = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'integration-signing-key' };
});

async function identityToken(email = 'owner@example.com', audience = 'hub-audience', patch = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', kid: publicKey.kid })}.${encode({ iss: `https://${TEAM}`, aud: [audience],
    email, sub: email, iat: now - 30, exp: now + 3600, ...patch })}`;
  return input + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, new TextEncoder().encode(input))).toString('base64url');
}

async function fixture(t) {
  const DB = createDB();
  t.after(() => DB.close());
  await seedAuth(DB);
  return { DB, ACCESS_TEAM: TEAM, OWNER_EMAIL: 'owner@example.com', ACCOUNT_ID: 'test-account' };
}

function requestFor(session, name = CODE_COOKIE, headers = {}) {
  return new Request('https://codes.m-techlabs.com/api/codes', { headers: { Cookie: `${name}=${session.token}`, ...headers } });
}

function mockKeys(t, originCallback) {
  t.mock.method(globalThis, 'fetch', async input => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [publicKey] });
    return originCallback ? originCallback(input) : new Response('Unexpected origin request', { status: 500 });
  });
}

async function ownerRequest(env, route, body, token) {
  const owner = await one(env.DB, 'SELECT * FROM users WHERE id=?', 'owner');
  const session = await createSession(env, { kind: 'owner', user: owner });
  return new Request(`https://m-techlabs.com/admin/access/api${route}`, { method: 'POST', headers: {
    'Cf-Access-Jwt-Assertion': token || await identityToken(), Cookie: `${ADMIN_COOKIE}=${session.token}`,
    Origin: 'https://m-techlabs.com', 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf,
  }, body: JSON.stringify(body) });
}

test('new approved users, unknown accounts and unregistered applications default to deny', async t => {
  const env = await fixture(t);
  for (const [email, app] of [['alice@example.com', 'codes'], ['unknown@example.com', 'codes'],
    ['pending@example.com', 'codes'], ['owner@example.com', 'not-registered']]) {
    assert.equal((await permission(env.DB, email, app)).allowed, false);
  }
});

test('a per-app grant does not authorize another app, owner admin or other users', async t => {
  const env = await fixture(t);
  await run(env.DB, 'INSERT INTO grants(user_id,app_id,role,updated_at) VALUES(?,?,?,?)', 'alice', 'codes', 'guild_member', 1);
  assert.equal((await permission(env.DB, 'alice@example.com', 'codes')).role, 'guild_member');
  for (const [email, app] of [['alice@example.com', 'tracker'], ['alice@example.com', 'hub'],
    ['alice@example.com', 'fleet'], ['alice@example.com', 'external'], ['bob@example.com', 'codes']]) {
    assert.equal((await permission(env.DB, email, app)).allowed, false);
  }
});

test('pending, suspended and revoked account state defeats existing per-app grants', async t => {
  const env = await fixture(t);
  await run(env.DB, 'INSERT INTO grants(user_id,app_id,role,updated_at) VALUES(?,?,?,?)', 'alice', 'codes', 'administrator', 1);
  for (const status of ['pending', 'suspended', 'denied', 'revoked']) {
    await run(env.DB, 'UPDATE users SET status=? WHERE id=?', status, 'alice');
    assert.equal((await permission(env.DB, 'alice@example.com', 'codes')).allowed, false);
  }
});

test('owner access survives direct denials; dashboard cannot alter the recovery owner', async t => {
  const env = await fixture(t); mockKeys(t);
  await run(env.DB, 'INSERT INTO grants(user_id,app_id,role,updated_at) VALUES(?,?,?,?)', 'owner', 'codes', 'denied', 1);
  assert.equal((await permission(env.DB, 'owner@example.com', 'codes')).role, 'owner');
  for (const [route, body] of [
    ['/users/status', { userId: 'owner', status: 'suspended' }],
    ['/grants', { userId: 'owner', appId: 'codes', role: 'denied' }],
    ['/sessions/revoke', { userId: 'owner' }],
  ]) {
    const request = await ownerRequest(env, route, body);
    await assert.rejects(adminApi(request, env, {}, route), error => error.status === 403);
  }
  assert.equal((await one(env.DB, 'SELECT status FROM users WHERE id=?', 'owner')).status, 'approved');
});

test('explicit user grant overrides groups; inherited deny beats inherited allow', async t => {
  const env = await fixture(t);
  await env.DB.batch([
    statement(env.DB, 'INSERT INTO groups(id,name,created_at) VALUES(?,?,?)', 'allow', 'Allowed group', 1),
    statement(env.DB, 'INSERT INTO groups(id,name,created_at) VALUES(?,?,?)', 'deny', 'Denied group', 1),
    statement(env.DB, 'INSERT INTO group_members(group_id,user_id) VALUES(?,?)', 'allow', 'alice'),
    statement(env.DB, 'INSERT INTO group_members(group_id,user_id) VALUES(?,?)', 'deny', 'alice'),
    statement(env.DB, 'INSERT INTO group_grants(group_id,app_id,role,updated_at) VALUES(?,?,?,?)', 'allow', 'codes', 'editor', 1),
    statement(env.DB, 'INSERT INTO group_grants(group_id,app_id,role,updated_at) VALUES(?,?,?,?)', 'deny', 'codes', 'denied', 1),
  ]);
  assert.equal((await permission(env.DB, 'alice@example.com', 'codes')).allowed, false);
  await run(env.DB, 'INSERT INTO grants(user_id,app_id,role,updated_at) VALUES(?,?,?,?)', 'alice', 'codes', 'viewer', 1);
  assert.equal((await permission(env.DB, 'alice@example.com', 'codes')).role, 'viewer');
  await run(env.DB, 'UPDATE grants SET role=? WHERE user_id=? AND app_id=?', 'denied', 'alice', 'codes');
  await run(env.DB, 'DELETE FROM group_grants WHERE group_id=?', 'deny');
  assert.equal((await permission(env.DB, 'alice@example.com', 'codes')).allowed, false);
});

test('legacy apps reject pretend viewer/editor roles and owner assignment is never delegated', async t => {
  const env = await fixture(t); mockKeys(t);
  const app = await one(env.DB, 'SELECT * FROM apps WHERE id=?', 'tracker');
  assert.equal(validRole(app, 'access'), true);
  for (const role of ['viewer', 'editor', 'administrator', 'owner', 'made-up']) {
    assert.equal(validRole(app, role), false);
    const request = await ownerRequest(env, '/grants', { userId: 'alice', appId: 'tracker', role });
    await assert.rejects(adminApi(request, env, {}, '/grants'), error => error.status === 400);
  }
  assert.equal(await one(env.DB, 'SELECT * FROM grants WHERE user_id=?', 'alice'), null);
});

test('code sessions check the latest grant, user status, expiry and revocation version', async t => {
  const env = await fixture(t), now = Math.floor(Date.now() / 1000);
  await run(env.DB, 'INSERT INTO grants(user_id,app_id,role,updated_at) VALUES(?,?,?,?)', 'alice', 'codes', 'viewer', now);
  const user = await one(env.DB, 'SELECT * FROM users WHERE id=?', 'alice');
  const created = await createSession(env, { kind: 'google', user }, now);
  const request = requestFor(created);
  assert.equal((await codeIdentity(request, env)).role, 'viewer');
  assert.equal(await readSession(request, env, CODE_COOKIE, now + created.age), null);
  await run(env.DB, 'UPDATE grants SET role=? WHERE user_id=?', 'denied', user.id);
  await assert.rejects(codeIdentity(request, env), error => error.status === 403);
  await run(env.DB, 'UPDATE grants SET role=? WHERE user_id=?', 'viewer', user.id);
  await run(env.DB, 'UPDATE users SET session_version=session_version+1 WHERE id=?', user.id);
  assert.equal(await readSession(request, env), null);
  const replaced = await createSession(env, { kind: 'google', user: await one(env.DB, 'SELECT * FROM users WHERE id=?', user.id) });
  await run(env.DB, 'UPDATE sessions SET revoked_at=? WHERE id=?', now, replaced.id);
  assert.equal(await readSession(requestFor(replaced), env), null);
});

test('guild passphrase rotation and disable invalidate every old anonymous session', async t => {
  const env = await fixture(t);
  await run(env.DB, 'UPDATE guild_access SET enabled=1,version=5 WHERE id=1');
  const created = await createSession(env, { kind: 'guild', guildVersion: 5 });
  assert.equal((await codeIdentity(requestFor(created), env)).role, 'guild_member');
  assert.equal((await readSession(requestFor(created), env)).user, null);
  await run(env.DB, 'UPDATE guild_access SET version=6 WHERE id=1');
  assert.equal(await readSession(requestFor(created), env), null);
  const replaced = await createSession(env, { kind: 'guild', guildVersion: 6 });
  await run(env.DB, 'UPDATE guild_access SET enabled=0 WHERE id=1');
  assert.equal(await readSession(requestFor(replaced), env), null);
});

test('owner routes reject forged identity headers, non-owner tokens and tokens for Code Bot', async t => {
  const env = await fixture(t); mockKeys(t);
  await assert.rejects(ownerIdentity(new Request('https://m-techlabs.com/admin/access', { headers: { 'Cf-Access-Authenticated-User-Email': 'owner@example.com' } }), env), error => error.status === 401);
  for (const [email, audience, expectedStatus] of [['alice@example.com', 'hub-audience', 403], ['owner@example.com', 'codes-audience', 401]]) {
    const request = new Request('https://m-techlabs.com/admin/access', { headers: { 'Cf-Access-Jwt-Assertion': await identityToken(email, audience) } });
    await assert.rejects(ownerIdentity(request, env), error => error.status === expectedStatus);
  }
});

test('CSRF token is bound to the session as well as the exact origin', async t => {
  const env = await fixture(t);
  const first = await createSession(env, { kind: 'guild', guildVersion: 0 });
  const second = await createSession(env, { kind: 'guild', guildVersion: 0 });
  const session = await one(env.DB, 'SELECT * FROM sessions WHERE id=?', first.id);
  const request = (csrf, origin = 'https://codes.m-techlabs.com') => new Request('https://codes.m-techlabs.com/api/refresh', { method: 'POST', headers: { Origin: origin, 'X-CSRF-Token': csrf } });
  await requireCsrf(request(first.csrf), session);
  await assert.rejects(requireCsrf(request(second.csrf), session), error => error.status === 403);
  await assert.rejects(requireCsrf(request(first.csrf, 'https://m-techlabs.com'), session), error => error.status === 403);
});

test('gateway revocation denies an old Access JWT before contacting its origin', async t => {
  const env = await fixture(t), now = Math.floor(Date.now() / 1000), tasks = [];
  let originCalls = 0; mockKeys(t, () => { originCalls++; return new Response('origin'); });
  await run(env.DB, 'INSERT INTO grants(user_id,app_id,role,updated_at) VALUES(?,?,?,?)', 'alice', 'tracker', 'access', now);
  await run(env.DB, 'UPDATE users SET revoke_before=? WHERE id=?', now - 100, 'alice');
  const app = await one(env.DB, 'SELECT * FROM apps WHERE id=?', 'tracker');
  const request = async iat => new Request('https://tracker.m-techlabs.com/api/private', { headers: { 'Cf-Access-Jwt-Assertion': await identityToken('alice@example.com', 'tracker-audience', { iat }) } });
  await assert.rejects(gateway(await request(now - 200), env, { waitUntil: p => tasks.push(p) }, app), error => error.status === 403);
  assert.equal(originCalls, 0);
  const response = await gateway(await request(now), env, { waitUntil: p => tasks.push(p) }, app);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(originCalls, 1);
  await Promise.all(tasks);
});

test('D1-style batches roll back all mutations if one statement fails', async t => {
  const env = await fixture(t);
  await assert.rejects(env.DB.batch([
    statement(env.DB, 'UPDATE users SET status=? WHERE id=?', 'suspended', 'alice'),
    statement(env.DB, 'INSERT INTO users(id,email,created_at,updated_at) VALUES(?,?,?,?)', 'duplicate', 'owner@example.com', 1, 1),
  ]));
  assert.equal((await one(env.DB, 'SELECT status FROM users WHERE id=?', 'alice')).status, 'approved');
});
