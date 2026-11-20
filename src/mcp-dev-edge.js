import {normalizeEmail, sha256, verifyAccessJWT} from './security.js';

export const DEV_MCP_HOST = 'mcp-dev.m-techlabs.com';
export const DEV_MCP_ORIGIN_HOST = 'mcp-dev-origin.m-techlabs.com';

const DEV_ORIGIN = `https://${DEV_MCP_HOST}`;
const DEV_RESOURCE = `${DEV_ORIGIN}/mcp`;
const DEV_METADATA = `${DEV_ORIGIN}/.well-known/oauth-protected-resource`;
const PRODUCTION_RESOURCE = 'https://mcp.m-techlabs.com/mcp';
const PRODUCTION_ORIGIN = 'https://mcp-origin.m-techlabs.com/mcp';
const ROLE_KEYS = Object.freeze([
  'resource', 'origin', 'backendId', 'accessAppId', 'audience', 'connectorAppId',
  'authorizationStoreId', 'credentialSha256', 'credentialBinding',
  'authorizationStoreBinding', 'managerPort', 'originHostHeader',
]);
const DESCRIPTOR_KEYS = Object.freeze([
  'schemaVersion', 'instanceId', 'authorizationMode', 'upstreamEnabled', 'owner',
  'production', 'development', 'accessIssuer', 'resourceMetadata',
]);
const ROUTING_KEYS = Object.freeze([
  'resource', 'origin', 'backendId', 'accessAppId', 'audience', 'connectorAppId', 'originHostHeader',
]);
const DISTINCT_KEYS = Object.freeze([
  'backendId', 'accessAppId', 'audience', 'connectorAppId', 'authorizationStoreId', 'credentialSha256',
]);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ACCESS_ISSUER = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const BROWSER_ORIGINS = new Set([DEV_ORIGIN, 'https://chatgpt.com', 'https://claude.ai']);
const OWNER_SQL = 'SELECT id,email,status,is_owner,revoke_before FROM users WHERE email=?';
const encoder = new TextEncoder();
const NOT_QUALIFIED = Object.freeze({
  activationAuthorized: false,
  qualified: false,
  upstreamEnabled: false,
  productionReferenceVerified: false,
  authorizationStoreVerified: false,
  liveRoutingVerified: false,
  grantsVerified: false,
  sourceVerified: false,
});

const invalidDescriptor = () => { throw new Error('invalid_dev_edge_descriptor'); };
const text = (value, pattern) => typeof value === 'string' &&
  !/[^\x21-\x7e]/.test(value) && pattern.test(value);

// Read data descriptors rather than invoking getters supplied by a caller.
// JSON configuration has ordinary records; a null-prototype data record is
// equally unambiguous and is copied into an ordinary canonical output record.
function dataRecord(value, requiredKeys, exact = true) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((exact && keys.length !== requiredKeys.length) ||
      keys.some(key => typeof key !== 'string' || !descriptors[key].enumerable ||
        !Object.hasOwn(descriptors[key], 'value')) ||
      requiredKeys.some(key => !Object.hasOwn(descriptors, key))) throw new Error();
  const result = Object.create(null);
  for (const key of keys) result[key] = descriptors[key].value;
  return result;
}

function role(input, production) {
  const value = dataRecord(input, ROLE_KEYS);
  if (value.resource !== (production ? PRODUCTION_RESOURCE : DEV_RESOURCE) ||
      value.origin !== (production ? PRODUCTION_ORIGIN : `https://${DEV_MCP_ORIGIN_HOST}/mcp`) ||
      !text(value.backendId, /^[a-z][a-z0-9-]{0,63}$/) ||
      !text(value.accessAppId, UUID) || !text(value.audience, SHA256) ||
      !text(value.connectorAppId, /^asdk_app_[a-f0-9]{32}$/) ||
      !text(value.authorizationStoreId, UUID) || !text(value.credentialSha256, SHA256) ||
      value.credentialBinding !== (production ? 'MCP_MANAGER_TOKEN' : 'MCP_DEV_MANAGER_TOKEN') ||
      value.authorizationStoreBinding !== (production ? 'DB' : 'MCP_DEV_AUTH_DB') ||
      !Number.isInteger(value.managerPort) || value.managerPort < 1024 || value.managerPort > 65535 ||
      (production ? value.managerPort !== 19740 : value.managerPort === 19740) ||
      (value.originHostHeader !== `127.0.0.1:${value.managerPort}` &&
        !(production && value.originHostHeader === 'mcp-origin.m-techlabs.com'))) invalidDescriptor();
  const result = {};
  for (const key of ROLE_KEYS) result[key] = value[key];
  return Object.freeze(result);
}

/** Validate declarations only. No provider, filesystem, or backend is queried. */
export function validateDevEdgeDescriptor(input) {
  try {
    const value = dataRecord(input, DESCRIPTOR_KEYS);
    const owner = dataRecord(value.owner, ['email', 'subject']);
    if (value.schemaVersion !== 1 ||
        !text(value.instanceId, /^dev(?:-[a-z0-9]+)*$/) || value.instanceId.length > 48 ||
        value.authorizationMode !== 'owner-only' || value.upstreamEnabled !== false ||
        typeof owner.email !== 'string' || /[\x00-\x1f\x7f*]/.test(owner.email) ||
        normalizeEmail(owner.email) !== owner.email ||
        !text(owner.subject, /^[\x21-\x7e]{1,512}$/) ||
        !text(value.accessIssuer, ACCESS_ISSUER) || value.resourceMetadata !== DEV_METADATA) invalidDescriptor();
    const production = role(value.production, true);
    const development = role(value.development, false);
    if (DISTINCT_KEYS.some(key => production[key] === development[key])) invalidDescriptor();
    return Object.freeze({
      schemaVersion: 1,
      instanceId: value.instanceId,
      authorizationMode: 'owner-only',
      upstreamEnabled: false,
      owner: Object.freeze({email: owner.email, subject: owner.subject}),
      production,
      development,
      accessIssuer: value.accessIssuer,
      resourceMetadata: value.resourceMetadata,
    });
  } catch {
    invalidDescriptor();
  }
}

/** Compare selected plan declarations; this does not validate a Windows plan. */
export function matchDevEdgeRuntimePlan(descriptor, plan) {
  const expected = validateDevEdgeDescriptor(descriptor);
  try {
    const declared = dataRecord(plan,
      ['schemaVersion', 'platform', 'instanceId', 'authorizationMode', 'production', 'development'], false);
    if (declared.schemaVersion !== 1 || declared.platform !== 'win32' ||
        declared.instanceId !== expected.instanceId || declared.authorizationMode !== 'owner-only') throw new Error();
    for (const name of ['production', 'development']) {
      const current = dataRecord(declared[name], ['manager', 'routing'], false);
      const manager = dataRecord(current.manager, ['port'], false);
      const routing = dataRecord(current.routing, ROUTING_KEYS, false);
      if (manager.port !== expected[name].managerPort ||
          ROUTING_KEYS.some(key => routing[key] !== expected[name][key])) throw new Error();
    }
    return Object.freeze({
      matched: true,
      evidence: 'declared-routing-only',
      runtimePlanValidated: false,
      ...NOT_QUALIFIED,
    });
  } catch {
    throw new Error('dev_edge_runtime_plan_mismatch');
  }
}

function ownData(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error();
  return descriptor.value;
}

function capturedPrepare(database) {
  if (!database || typeof database !== 'object') throw new Error();
  // D1 exposes methods on its prototype. Do not invoke an accessor, and do not
  // reread the method after any asynchronous credential or identity operation.
  let current = database;
  for (let depth = 0; current && depth < 8; depth++, current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'prepare');
    if (!descriptor) continue;
    if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') throw new Error();
    return Function.prototype.bind.call(descriptor.value, database);
  }
  throw new Error();
}

function captureConfiguration(env) {
  const raw = ownData(env, 'MCP_DEV_EDGE_DESCRIPTOR');
  if (typeof raw !== 'string' || raw.length > 16_384 || encoder.encode(raw).length > 16_384) throw new Error();
  const descriptor = validateDevEdgeDescriptor(JSON.parse(raw));
  if (JSON.stringify(descriptor) !== raw) throw new Error();
  const token = ownData(env, 'MCP_DEV_MANAGER_TOKEN');
  if (!text(token, /^[\x21-\x7e]{32,512}$/)) throw new Error();
  const database = ownData(env, 'MCP_DEV_AUTH_DB');
  const productionDatabase = Object.getOwnPropertyDescriptor(env, 'DB');
  if (productionDatabase && Object.hasOwn(productionDatabase, 'value') &&
      productionDatabase.value === database) throw new Error();
  const prepare = capturedPrepare(database);
  return Object.freeze({descriptor, token, prepare, fetcher: fetch});
}

function response(error, status, ownerAuthorized = false, headers = {}) {
  return Response.json({error, ownerAuthorized, ...NOT_QUALIFIED}, {
    status,
    headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers},
  });
}

function unauthorized() {
  return response('dev_edge_unauthorized', 401, false, {
    'WWW-Authenticate': `Bearer resource_metadata="${DEV_METADATA}", error="invalid_token"`,
  });
}

function currentToken(claims) {
  const now = Math.floor(Date.now() / 1000);
  return Number.isSafeInteger(now) && now > 0 && Number.isSafeInteger(claims.exp) && claims.exp > now;
}

function approvedOwner(row, ownerEmail, issuedAt) {
  try {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
    const email = ownData(row, 'email'), status = ownData(row, 'status');
    const isOwner = ownData(row, 'is_owner'), revoked = ownData(row, 'revoke_before');
    return email === ownerEmail && status === 'approved' && isOwner === 1 &&
      Number.isSafeInteger(revoked) && revoked >= 0 && issuedAt > revoked;
  } catch { return false; }
}

/** Closed DEV entry. Owner authorization is diagnostic; dispatch stays disabled. */
export async function devRemoteMcp(request, env) {
  let metadata, assertion;
  try {
    const url = new URL(request.url);
    metadata = url.pathname === '/.well-known/oauth-protected-resource';
    if (url.origin !== DEV_ORIGIN || (!metadata && url.pathname !== '/mcp') ||
        url.href !== `${DEV_ORIGIN}${url.pathname}`) return response('dev_edge_not_found', 404);
    const method = metadata ? 'GET' : 'POST';
    if (request.method !== method) return response('dev_edge_method_not_allowed', 405, false, {Allow: method});
    const origin = request.headers.get('Origin');
    if (origin !== null && !BROWSER_ORIGINS.has(origin)) return response('dev_edge_origin_denied', 403);
    assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  } catch { return response('dev_edge_not_found', 404); }

  let configuration;
  try {
    // Everything that can select a declaration, credential, binding, or method
    // is captured before the first await. Production credentials are not read.
    configuration = captureConfiguration(env);
    const digest = await sha256(configuration.token);
    if (digest !== configuration.descriptor.development.credentialSha256 ||
        digest === configuration.descriptor.production.credentialSha256) throw new Error();
  } catch { return response('dev_edge_unconfigured', 503); }
  if (metadata) return response('dev_activation_disabled', 503);

  const {descriptor, prepare, fetcher} = configuration;
  let claims;
  try {
    claims = await verifyAccessJWT(assertion, {
      teamDomain: descriptor.accessIssuer,
      audiences: [descriptor.development.audience],
      fetcher,
    });
    const exactAudience = claims.aud === descriptor.development.audience ||
      (Array.isArray(claims.aud) && claims.aud.length === 1 && claims.aud[0] === descriptor.development.audience);
    if (claims.type !== 'app' || !exactAudience || !currentToken(claims)) return unauthorized();
  } catch { return unauthorized(); }
  if (claims.sub !== descriptor.owner.subject || normalizeEmail(claims.email) !== descriptor.owner.email) {
    return response('dev_edge_owner_denied', 403);
  }

  let row;
  try { row = await prepare(OWNER_SQL).bind(descriptor.owner.email).first(); }
  catch { return response('dev_edge_authorization_unavailable', 503); }
  // An assertion may expire while the authorization query is outstanding.
  if (!currentToken(claims)) return unauthorized();
  if (!approvedOwner(row, descriptor.owner.email, claims.iat)) return response('dev_edge_owner_denied', 403);
  return response('dev_activation_disabled', 503, true);
}
