// Runtime-neutral Web Crypto primitives. No credentials are logged here.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const JWKS_TTL_SECONDS = 300;
const JWKS_REFRESH_SECONDS = 30;
const MAX_TOKEN_LENGTH = 16_384;
const PBKDF2_ITERATIONS = 100_000;
const jwksCaches = new WeakMap();

export class SecurityError extends Error {
  constructor(code = 'invalid_identity') {
    super(code);
    this.name = 'SecurityError';
    this.code = code;
  }
}

function bytes(value) {
  return typeof value === 'string' ? encoder.encode(value) : value;
}

function base64url(value) {
  let result = '';
  for (const byte of new Uint8Array(value)) result += String.fromCharCode(byte);
  return btoa(result).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decode64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new SecurityError('invalid_encoding');
  }
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const result = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
    if (base64url(result) !== value) throw new Error('noncanonical');
    return result;
  } catch {
    throw new SecurityError('invalid_encoding');
  }
}

export function normalizeEmail(email) {
  if (typeof email !== 'string') throw new SecurityError('invalid_email');
  const normalized = email.trim().toLowerCase();
  // Preserve dots and plus-addressing. No provider-dependent alias rewriting.
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new SecurityError('invalid_email');
  }
  return normalized;
}

function teamIssuer(teamDomain) {
  if (typeof teamDomain !== 'string') throw new SecurityError('missing_team');
  const domain = teamDomain.replace(/^https:\/\//, '').replace(/\/$/, '');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(domain)) {
    throw new SecurityError('invalid_team');
  }
  return `https://${domain}`;
}

function readJWT(token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) throw new SecurityError('invalid_token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new SecurityError('invalid_token');
  let header, payload;
  try {
    header = JSON.parse(decoder.decode(decode64(parts[0])));
    payload = JSON.parse(decoder.decode(decode64(parts[1])));
  } catch {
    throw new SecurityError('invalid_token');
  }
  if (!header || typeof header !== 'object' || Array.isArray(header) ||
      !payload || typeof payload !== 'object' || Array.isArray(payload) ||
      header.alg !== 'RS256' || typeof header.kid !== 'string' ||
      !header.kid || header.kid.length > 256 || header.crit !== undefined ||
      header.jku !== undefined || header.jwk !== undefined || header.b64 === false) {
    throw new SecurityError('invalid_token');
  }
  const signature = decode64(parts[2]);
  if (signature.length < 256 || signature.length > 1024) throw new SecurityError('invalid_signature');
  return { header, payload, signature, input: encoder.encode(`${parts[0]}.${parts[1]}`) };
}

function cacheFor(fetcher) {
  let cache = jwksCaches.get(fetcher);
  if (!cache) {
    cache = new Map();
    jwksCaches.set(fetcher, cache);
  }
  return cache;
}

async function readLimited(response, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new SecurityError('body_too_large');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return decoder.decode(result);
}

async function signingKey(issuer, kid, fetcher, now) {
  const cache = cacheFor(fetcher);
  let entry = cache.get(issuer);
  if (!entry) {
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    entry = { keys: new Map(), expiresAt: 0, nextRefreshAt: 0, pending: null };
    cache.set(issuer, entry);
  }
  if (entry.expiresAt > now && entry.keys.has(kid)) return entry.keys.get(kid);
  if (!entry.pending && now >= entry.nextRefreshAt) {
    entry.nextRefreshAt = now + JWKS_REFRESH_SECONDS;
    entry.pending = (async () => {
      const response = await fetcher(`${issuer}/cdn-cgi/access/certs`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new SecurityError('identity_keys_unavailable');
      const document = JSON.parse(await readLimited(response, 65_536));
      if (!Array.isArray(document.keys) || !document.keys.length || document.keys.length > 16) {
        throw new SecurityError('invalid_identity_keys');
      }
      const keys = new Map();
      for (const jwk of document.keys) {
        if (jwk.kty !== 'RSA' || (jwk.alg && jwk.alg !== 'RS256') ||
            (jwk.use && jwk.use !== 'sig') || typeof jwk.kid !== 'string' ||
            !jwk.kid || jwk.kid.length > 256 || !jwk.n || !jwk.e || jwk.d) continue;
        if (decode64(jwk.n).length < 256) continue;
        const key = await crypto.subtle.importKey('jwk', jwk,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
        keys.set(jwk.kid, key);
      }
      if (!keys.size) throw new SecurityError('invalid_identity_keys');
      entry.keys = keys;
      entry.expiresAt = now + JWKS_TTL_SECONDS;
    })().finally(() => { entry.pending = null; });
  }
  if (entry.pending) await entry.pending;
  if (entry.expiresAt <= now || !entry.keys.has(kid)) throw new SecurityError('unknown_signing_key');
  return entry.keys.get(kid);
}

async function verifiedClaims(token, { teamDomain, fetcher = fetch, now = Math.floor(Date.now() / 1000) }) {
  if (!Number.isSafeInteger(now) || now <= 0) throw new SecurityError('invalid_clock');
  const jwt = readJWT(token);
  const issuer = teamIssuer(teamDomain);
  const key = await signingKey(issuer, jwt.header.kid, fetcher, now);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, jwt.signature, jwt.input)) {
    throw new SecurityError('invalid_signature');
  }
  const claims = jwt.payload;
  if (!Number.isSafeInteger(claims.exp) || claims.exp <= now ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now)) ||
      (claims.iat !== undefined && (!Number.isSafeInteger(claims.iat) || claims.iat > now + 30))) {
    throw new SecurityError('invalid_token_time');
  }
  return { claims, issuer };
}

/** Verify a human Access application JWT, never a service/global/evaluation token. */
export async function verifyAccessJWT(token, options) {
  const { claims, issuer } = await verifiedClaims(token, options);
  const expected = options.audiences;
  if (!Array.isArray(expected) || !expected.length || expected.some(x => typeof x !== 'string' || !x)) {
    throw new SecurityError('missing_audience');
  }
  const actual = typeof claims.aud === 'string' ? [claims.aud] : claims.aud;
  if (claims.iss !== issuer || !Array.isArray(actual) ||
      !actual.some(audience => typeof audience === 'string' && expected.includes(audience))) {
    throw new SecurityError('wrong_token_scope');
  }
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 512 ||
      !Number.isSafeInteger(claims.iat) || claims.identity !== undefined || claims.nonce !== undefined) {
    throw new SecurityError('invalid_user_identity');
  }
  normalizeEmail(claims.email);
  return claims;
}

export function randomToken(byteLength = 32) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 16 || byteLength > 128) {
    throw new SecurityError('invalid_random_length');
  }
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function checkPassphrase(passphrase, creating) {
  if (typeof passphrase !== 'string' || passphrase.length > 256 ||
      (creating && (passphrase.length < 16 || !passphrase.trim()))) {
    throw new SecurityError('invalid_passphrase');
  }
}

async function derivePassphrase(passphrase, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS,
  }, key, 256));
}

/** Stored representation includes version/algorithm, work factor, random salt and derived key. */
export async function hashPassphrase(passphrase) {
  checkPassphrase(passphrase, true);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassphrase(passphrase, salt);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${base64url(salt)}$${base64url(hash)}`;
}

export async function verifyPassphrase(passphrase, encoded) {
  try {
    checkPassphrase(passphrase, false);
    if (typeof encoded !== 'string' || encoded.length > 256) return false;
    const parts = encoded.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== String(PBKDF2_ITERATIONS)) return false;
    const salt = decode64(parts[2]);
    const expected = decode64(parts[3]);
    if (salt.length !== 16 || expected.length !== 32) return false;
    const actual = await derivePassphrase(passphrase, salt);
    if (typeof crypto.subtle.timingSafeEqual === 'function') {
      return crypto.subtle.timingSafeEqual(actual, expected);
    }
    // Compare through HMAC verification on standard Web Crypto runtimes.
    const comparisonKey = await crypto.subtle.importKey('raw', expected, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const signature = await crypto.subtle.sign('HMAC', comparisonKey, actual);
    return crypto.subtle.verify('HMAC', comparisonKey, signature, expected);
  } catch {
    return false;
  }
}

/** Require this plus a session-bound CSRF token on all browser mutations. */
export function sameOrigin(request) {
  try {
    const expected = new URL(request.url).origin;
    const origin = request.headers.get('Origin');
    const fetchSite = request.headers.get('Sec-Fetch-Site');
    return origin === expected && (!fetchSite || fetchSite === 'same-origin');
  } catch {
    return false;
  }
}

function configuredEvaluationKey(env) {
  let privateJwk;
  try {
    privateJwk = JSON.parse(env.EVALUATION_PRIVATE_JWK);
  } catch {
    throw new SecurityError('evaluation_not_configured');
  }
  if (privateJwk.kty !== 'RSA' || !privateJwk.d || !privateJwk.n || !privateJwk.e ||
      (privateJwk.alg && privateJwk.alg !== 'RS256') || decode64(privateJwk.n).length < 256) {
    throw new SecurityError('evaluation_not_configured');
  }
  return privateJwk;
}

/** Only public RSA fields are returned, even if a private JWK was supplied. */
export async function evaluationPublicKeys(env) {
  const key = configuredEvaluationKey(env);
  const kid = typeof key.kid === 'string' && key.kid ? key.kid : await sha256(`${key.n}.${key.e}`);
  return { keys: [{ kty: 'RSA', n: key.n, e: key.e, alg: 'RS256', use: 'sig', kid }] };
}

async function signEvaluationResult(env, payload) {
  const jwk = configuredEvaluationKey(env);
  const { keys } = await evaluationPublicKeys(env);
  const key = await crypto.subtle.importKey('jwk', { ...jwk, alg: 'RS256', key_ops: ['sign'] },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const input = `${base64url(encoder.encode(JSON.stringify({ alg: 'RS256', kid: keys[0].kid, typ: 'JWT' })))}.${base64url(encoder.encode(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(input));
  return `${input}.${base64url(signature)}`;
}

function evaluationJSON(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

/**
 * Cloudflare External Evaluation protocol. Application selection must be bound
 * by the caller to its trusted route/configuration, never supplied by a client.
 * Evaluation JWTs have identity/nonce instead of the app JWT's email/sub/aud.
 */
export async function externalEvaluation(request, env, authorizeCallback, options = {}) {
  if (request.method !== 'POST') return evaluationJSON({ error: 'method_not_allowed' }, 405);
  const now = options.now ?? Math.floor(Date.now() / 1000);
  try {
    const body = JSON.parse(await readLimited(request, MAX_TOKEN_LENGTH + 512));
    const { claims, issuer } = await verifiedClaims(body?.token, {
      teamDomain: env.ACCESS_TEAM, fetcher: options.fetcher ?? fetch, now,
    });
    if ((claims.iss !== undefined && claims.iss !== issuer) ||
        typeof claims.nonce !== 'string' || !claims.nonce || claims.nonce.length > 256 ||
        !claims.identity || typeof claims.identity !== 'object' || Array.isArray(claims.identity) ||
        claims.identity.email_verified === false || claims.identity.email_verified === 'false') {
      throw new SecurityError('invalid_evaluation_identity');
    }
    const email = normalizeEmail(claims.identity.email);
    const allowed = await authorizeCallback({ email, identity: claims.identity, claims }) === true;
    const token = await signEvaluationResult(env, { success: allowed, iat: now, exp: now + 60, nonce: claims.nonce });
    return evaluationJSON({ token });
  } catch (error) {
    // Never return the token, JWK, account claims, exception stack, or callback details.
    const status = error?.code === 'evaluation_not_configured' ? 503 : 403;
    return evaluationJSON({ error: status === 503 ? 'evaluation_unavailable' : 'evaluation_denied' }, status);
  }
}
