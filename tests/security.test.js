import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyAccessJWT, externalEvaluation, evaluationPublicKeys,
  hashPassphrase, verifyPassphrase, randomToken, sha256, sameOrigin, normalizeEmail,
} from '../src/security.js';

const NOW = 1_793_400_000;
const TEAM = 'test-owner.cloudflareaccess.com';
let signer, publicJwk, privateJwk;

function b64(value) {
  return Buffer.from(value).toString('base64url');
}

async function sign(payload, header = { alg: 'RS256', kid: 'test-signing-key' }, key = signer) {
  const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return `${input}.${b64(signature)}`;
}

function userClaims(overrides = {}) {
  return { iss: `https://${TEAM}`, aud: ['codes-audience'], sub: 'user-1', email: 'person@example.com',
    iat: NOW - 30, exp: NOW + 300, ...overrides };
}

function keyFetcher(counter = { calls: 0 }) {
  return async (url, options) => {
    counter.calls++;
    assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
    assert.equal(options.redirect, 'manual');
    return Response.json({ keys: [publicJwk] });
  };
}

function verify(token, extra = {}) {
  return verifyAccessJWT(token, { teamDomain: TEAM, audiences: ['codes-audience'], fetcher: keyFetcher(), now: NOW, ...extra });
}

function evalRequest(token) {
  return new Request('https://codes.example.com/access/evaluate/codes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
  });
}

function evalEnv() {
  return { ACCESS_TEAM: TEAM, EVALUATION_PRIVATE_JWK: JSON.stringify(privateJwk) };
}

before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  signer = pair.privateKey;
  publicJwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-signing-key', alg: 'RS256', use: 'sig' };
  privateJwk = { ...await crypto.subtle.exportKey('jwk', pair.privateKey), kid: 'evaluation-key' };
});

test('accepts authentic Access JWT for exact issuer and application', async () => {
  assert.equal((await verify(await sign(userClaims()))).email, 'person@example.com');
  assert.equal((await verify(await sign(userClaims({ aud: 'codes-audience' })))).sub, 'user-1');
});

test('accepts the documented human application-token shape without confusing identity_nonce with evaluation nonce', async () => {
  const claims = userClaims({ type: 'app', identity_nonce: '6ei69kawdKzMIAPF', nbf: NOW - 30, country: 'US' });
  assert.deepEqual(await verify(await sign(claims, { alg: 'RS256', kid: 'test-signing-key', typ: 'JWT' })), claims);
});

test('rejects wrong application, issuer and missing audience configuration', async () => {
  await assert.rejects(verify(await sign(userClaims({ aud: ['admin-audience'] }))));
  await assert.rejects(verify(await sign(userClaims({ iss: 'https://attacker.cloudflareaccess.com' }))));
  await assert.rejects(verify(await sign(userClaims()), { audiences: [] }));
  await assert.rejects(verify(await sign(userClaims({ aud: { 'codes-audience': true } }))));
});

test('rejects expired, missing expiry, premature and future-issued tokens', async () => {
  for (const patch of [{ exp: NOW }, { exp: NOW - 1 }, { exp: undefined }, { exp: '9999999999' },
    { nbf: NOW + 1 }, { iat: NOW + 31 }, { iat: undefined }]) {
    await assert.rejects(verify(await sign(userClaims(patch))));
  }
});

test('rejects forged signatures and unapproved algorithm/header key selectors', async () => {
  const legitimate = await sign(userClaims());
  const parts = legitimate.split('.');
  parts[1] = b64(JSON.stringify(userClaims({ email: 'owner@example.com' })));
  await assert.rejects(verify(parts.join('.')));
  for (const header of [{ alg: 'none', kid: 'test-signing-key' }, { alg: 'HS256', kid: 'test-signing-key' },
    { alg: 'RS256', kid: 'test-signing-key', jku: 'https://attacker.invalid/keys' },
    { alg: 'RS256', kid: 'test-signing-key', crit: ['unknown'] }]) {
    await assert.rejects(verify(await sign(userClaims(), header)));
  }
});

test('service tokens and evaluation tokens are not human application identities', async () => {
  for (const patch of [{ email: undefined }, { sub: undefined }, { sub: '' }, { email: 'not-an-email' },
    { nonce: 'evaluation-nonce', identity: { email: 'person@example.com' } }]) {
    await assert.rejects(verify(await sign(userClaims(patch))));
  }
});

test('pins JWKS fetch to Cloudflare team domain, blocks arbitrary issuer URL', async () => {
  for (const teamDomain of ['http://test-owner.cloudflareaccess.com', 'test-owner.cloudflareaccess.com.evil.invalid',
    'test-owner.cloudflareaccess.com/path', '127.0.0.1', 'https://test-owner.cloudflareaccess.com:444']) {
    await assert.rejects(verify(await sign(userClaims()), { teamDomain }));
  }
});

test('parallel requests share bounded JWKS fetch and unknown kids do not stampede', async () => {
  const counter = { calls: 0 }, fetcher = keyFetcher(counter);
  const token = await sign(userClaims());
  await Promise.all(Array.from({ length: 20 }, () => verify(token, { fetcher })));
  assert.equal(counter.calls, 1);
  const unknown = await sign(userClaims(), { alg: 'RS256', kid: 'attacker-random-kid' });
  await assert.rejects(verify(unknown, { fetcher }));
  await assert.rejects(verify(unknown, { fetcher }));
  assert.equal(counter.calls, 1);
  await verify(token, { fetcher, now: NOW + 31 });
  assert.equal(counter.calls, 1);
});

test('JWKS outage and oversized token fail closed', async () => {
  const token = await sign(userClaims());
  await assert.rejects(verify(token, { fetcher: async () => new Response('', { status: 503 }) }));
  await assert.rejects(verify('x'.repeat(20_000)));
  await assert.rejects(verify('not.a.jwt'));
});

test('uses Workers-supported manual redirects and refuses redirected signing keys', async () => {
  const token = await sign(userClaims());
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    const fetcher = async (url, options) => {
      calls++;
      assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
      assert.equal(options.redirect, 'manual');
      // A redirect body must never be accepted even if it contains valid keys.
      return Response.json({ keys: [publicJwk] }, { status, headers: { Location: 'https://attacker.invalid/keys' } });
    };
    await assert.rejects(verify(token, { fetcher }), { code: 'identity_keys_unavailable' });
    assert.equal(calls, 1);
  }
});

test('external evaluation authorizes only verified identity and signs the nonce-bound result', async () => {
  const claims = { exp: NOW + 60, iat: NOW, nonce: 'unique-request-nonce', identity: { email: 'PERSON@example.com' } };
  let callbackCalls = 0;
  const response = await externalEvaluation(evalRequest(await sign(claims)), evalEnv(), async identity => {
    callbackCalls++;
    assert.equal(identity.email, 'person@example.com');
    return true;
  }, { fetcher: keyFetcher(), now: NOW });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const { token } = await response.json();
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
  assert.deepEqual(payload, { success: true, iat: NOW, exp: NOW + 60, nonce: claims.nonce });
  const publicKeys = await evaluationPublicKeys(evalEnv());
  const key = await crypto.subtle.importKey('jwk', publicKeys.keys[0], { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, Buffer.from(parts[2], 'base64url'), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)), true);
  assert.equal(callbackCalls, 1);
});

test('external evaluation signs denials and never accepts a truthy nonboolean callback result', async () => {
  const claims = { exp: NOW + 60, nonce: 'request-nonce', identity: { email: 'person@example.com' } };
  for (const callbackResult of [false, undefined, { allowed: true }, 'true']) {
    const response = await externalEvaluation(evalRequest(await sign(claims)), evalEnv(), async () => callbackResult,
      { fetcher: keyFetcher(), now: NOW });
    const { token } = await response.json();
    assert.equal(JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).success, false);
  }
});

test('external evaluation rejects ordinary user tokens, expiry and issuer mismatch before callback', async () => {
  const tokens = [await sign(userClaims()),
    await sign({ exp: NOW - 1, nonce: 'request-nonce', identity: { email: 'person@example.com' } }),
    await sign({ exp: NOW + 60, nonce: 'request-nonce', identity: { email: 'person@example.com', email_verified: false } }),
    await sign({ exp: NOW + 60, iss: 'https://evil.invalid', nonce: 'request-nonce', identity: { email: 'person@example.com' } })];
  for (const token of tokens) {
    let called = false;
    const response = await externalEvaluation(evalRequest(token), evalEnv(), () => { called = true; return true; },
      { fetcher: keyFetcher(), now: NOW });
    assert.equal(response.status, 403);
    assert.equal(called, false);
    assert.deepEqual(await response.json(), { error: 'evaluation_denied' });
  }
});

test('external evaluation has no GET authorization or exception/secret disclosure', async () => {
  const getResponse = await externalEvaluation(new Request('https://codes.example.com/access/evaluate'), evalEnv(), () => true);
  assert.equal(getResponse.status, 405);
  const claims = { exp: NOW + 60, nonce: 'request-nonce', identity: { email: 'person@example.com' } };
  const response = await externalEvaluation(evalRequest(await sign(claims)), evalEnv(), () => { throw new Error('SECRET database credentials'); },
    { fetcher: keyFetcher(), now: NOW });
  assert.equal(response.status, 403);
  assert.equal((await response.text()).includes('SECRET'), false);
  const keys = JSON.stringify(await evaluationPublicKeys(evalEnv()));
  assert.equal(keys.includes(privateJwk.d), false);
  assert.equal(keys.includes('"d"'), false);
});

test('password hashes use independent salts and authenticate exact case-sensitive passphrases', async () => {
  const passphrase = 'A long guild passphrase 420!';
  const first = await hashPassphrase(passphrase), second = await hashPassphrase(passphrase);
  assert.notEqual(first, second);
  assert.equal(first.includes(passphrase), false);
  assert.equal(await verifyPassphrase(passphrase, first), true);
  assert.equal(await verifyPassphrase(passphrase.toLowerCase(), first), false);
  assert.equal(await verifyPassphrase('wrong passphrase', first), false);
  assert.equal(await verifyPassphrase(passphrase, first.replace('$100000$', '$1$')), false);
  assert.equal(await verifyPassphrase(passphrase, 'invalid'), false);
  await assert.rejects(hashPassphrase('short'));
  await assert.rejects(hashPassphrase(' '.repeat(20)));
});

test('CSRF origin check blocks absent, null, same-site sibling and other origins', () => {
  const url = 'https://m-techlabs.com/admin/access/api/users';
  const request = headers => new Request(url, { method: 'POST', headers });
  assert.equal(sameOrigin(request({ Origin: 'https://m-techlabs.com', 'Sec-Fetch-Site': 'same-origin' })), true);
  for (const headers of [{}, { Origin: 'null' }, { Origin: 'https://codes.m-techlabs.com' },
    { Origin: 'https://evil.invalid' }, { Origin: 'http://m-techlabs.com' },
    { Origin: 'https://m-techlabs.com', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'https://m-techlabs.com', 'Sec-Fetch-Site': 'same-site' }]) {
    assert.equal(sameOrigin(request(headers)), false);
  }
});

test('tokens are independent random values and hashes normalize neither passwords nor email aliases', async () => {
  const tokens = new Set(Array.from({ length: 100 }, () => randomToken()));
  assert.equal(tokens.size, 100);
  for (const token of tokens) assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(normalizeEmail(' A.B+guild@Gmail.com '), 'a.b+guild@gmail.com');
  assert.throws(() => randomToken(8));
  assert.throws(() => normalizeEmail('not an email'));
});
