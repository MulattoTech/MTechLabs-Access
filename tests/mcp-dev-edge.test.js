import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateRuntimePlan } from '../integrations/mcp-manager/lib/dev-runtime-plan.mjs';

// Contract tests authored independently of the implementation. Missing APIs
// are a baseline capability gap; routing assertions also run on the old entry.
async function optionalImport(relative) {
  try { return { module: await import(relative), missing: false }; }
  catch (error) { return { error, missing: error?.code === 'ERR_MODULE_NOT_FOUND' }; }
}
const edgeImport = await optionalImport('../src/mcp-dev-edge.js');
const entryImport = await optionalImport('../src/mcp-dev-entry.js');
const workerImport = await optionalImport('../src/index.js');
const edge = edgeImport.module;
const entry = entryImport.module?.default;
const worker = workerImport.module?.default;
const apiTest = (name, body) => test(name, {
  skip: edgeImport.missing ? 'Baseline DEV edge API is absent; not a passing behavioral result' : false,
  timeout: 15000,
}, body);
const entryTest = (name, body) => test(name, {
  skip: edgeImport.missing || entryImport.missing ? 'Baseline dedicated DEV entry is absent' : false,
}, body);
const routeTest = (name, body) => test(name, {
  skip: workerImport.missing ? 'Worker module cannot be loaded' : false,
}, body);

const TEAM = 'dev-edge-contract-test.cloudflareaccess.com';
const OWNER = 'owner@example.test';
const SUBJECT = 'dev-edge-owner-subject';
const PROD_RESOURCE = 'https://mcp.m-techlabs.com/mcp';
const PROD_ORIGIN = 'https://mcp-origin.m-techlabs.com/mcp';
const DEV_RESOURCE = 'https://mcp-dev.m-techlabs.com/mcp';
const DEV_ORIGIN = 'https://mcp-dev-origin.m-techlabs.com/mcp';
const METADATA = 'https://mcp-dev.m-techlabs.com/.well-known/oauth-protected-resource';
const PROD_TOKEN = 'fixture-production-private-bearer-000000000000000000000001';
const DEV_TOKEN = 'fixture-development-private-bearer-000000000000000000000002';
const hash = value => createHash('sha256').update(value).digest('hex');
const PROD_AUD = hash('DEV edge fixture production audience v1');
const DEV_AUD = hash('DEV edge fixture development audience v1');
const PRIVATE_BODY = 'private-tool-argument-must-not-be-read-or-logged';
const OWNER_SQL = 'SELECT id,email,status,is_owner,revoke_before FROM users WHERE email=?';
const FALSE_FLAGS = ['activationAuthorized', 'qualified', 'upstreamEnabled',
  'productionReferenceVerified', 'authorizationStoreVerified', 'liveRoutingVerified',
  'grantsVerified', 'sourceVerified'];
let privateKey, publicJwk;
before(async () => {
  const pair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify']);
  privateKey = pair.privateKey;
  publicJwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'dev-edge-contract-key' };
});
function role(production) {
  return {
    resource: production ? PROD_RESOURCE : DEV_RESOURCE,
    origin: production ? PROD_ORIGIN : DEV_ORIGIN,
    backendId: production ? 'production-edge-fixture' : 'development-edge-fixture',
    accessAppId: production ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222',
    audience: production ? PROD_AUD : DEV_AUD,
    connectorAppId: 'asdk_app_' + (production ? '1' : '2').repeat(32),
    authorizationStoreId: production ? '33333333-3333-4333-8333-333333333333' : '44444444-4444-4444-8444-444444444444',
    credentialSha256: hash(production ? PROD_TOKEN : DEV_TOKEN),
    credentialBinding: production ? 'MCP_MANAGER_TOKEN' : 'MCP_DEV_MANAGER_TOKEN',
    authorizationStoreBinding: production ? 'DB' : 'MCP_DEV_AUTH_DB',
    managerPort: production ? 19740 : 19741,
    originHostHeader: production ? 'mcp-origin.m-techlabs.com' : '127.0.0.1:19741',
  };
}
function descriptor() {
  return {
    schemaVersion: 1, instanceId: 'dev-edge-fixture', authorizationMode: 'owner-only',
    upstreamEnabled: false, owner: { email: OWNER, subject: SUBJECT },
    production: role(true), development: role(false),
    accessIssuer: 'https://' + TEAM, resourceMetadata: METADATA,
  };
}
const clone = value => structuredClone(value);
const validDescriptor = () => edge.validateDevEdgeDescriptor(descriptor());
function rejectsDescriptor(mutator) {
  assert.deepEqual(validDescriptor(), descriptor(), 'the neighboring descriptor control must succeed');
  const value = descriptor();
  mutator(value);
  assert.throws(() => edge.validateDevEdgeDescriptor(value), { message: 'invalid_dev_edge_descriptor' });
}
function runtimePlan(d = descriptor()) {
  const selected = r => ({
    manager: { port: r.managerPort },
    routing: Object.fromEntries(['resource', 'origin', 'backendId', 'accessAppId',
      'audience', 'connectorAppId', 'originHostHeader'].map(key => [key, r[key]])),
  });
  return { schemaVersion: 1, platform: 'win32', instanceId: d.instanceId,
    authorizationMode: d.authorizationMode, production: selected(d.production),
    development: selected(d.development) };
}
function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function enteredStage(entered, pending, label) {
  await Promise.race([entered.promise, pending.then(() => {
    assert.fail('request completed before reaching the intended ' + label + ' stage');
  })]);
}
async function jwt(extra = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = encode({ alg: 'RS256', kid: publicJwk.kid, ...header }) + '.' +
    encode({ iss: 'https://' + TEAM, aud: [DEV_AUD], type: 'app', email: OWNER,
      sub: SUBJECT, iat: now - 10, exp: now + 3600, ...extra });
  return input + '.' + Buffer.from(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(input))).toString('base64url');
}
function fixture() {
  const state = {
    row: { id: 'private-dev-owner-row-id', email: OWNER, status: 'approved', is_owner: 1, revoke_before: 0 },
    devPrepares: 0, devReads: 0, productionReads: 0, writes: 0, bodyReads: 0,
    keyFetches: [], backendCalls: [], logs: [], throwDB: false, firstWait: null, jwksWait: null,
  };
  const DB = {
    prepare(sql) {
      assert.equal(this, DB, 'captured prepare must retain its original receiver');
      state.devPrepares++;
      assert.equal(sql, OWNER_SQL, 'no application, grant, session or audit query is admitted');
      return {
        bind(email) {
          assert.equal(email, OWNER);
          return {
            async first() {
              state.devReads++;
              if (state.firstWait) { state.firstWait.entered.resolve(); await state.firstWait.release.promise; }
              if (state.throwDB) throw new Error('PRIVATE_DEV_DB_FAILURE');
              return state.row;
            },
            async run() { state.writes++; throw new Error('database writes are forbidden'); },
            async all() { throw new Error('grant enumeration is forbidden'); },
          };
        },
      };
    },
  };
  const productionDB = { prepare() { state.productionReads++; throw new Error('PRIVATE_PRODUCTION_DB_MUST_NOT_BE_USED'); } };
  const d = descriptor();
  const env = { MCP_DEV_EDGE_DESCRIPTOR: JSON.stringify(d), MCP_DEV_MANAGER_TOKEN: DEV_TOKEN,
    MCP_DEV_AUTH_DB: DB, DB: productionDB };
  return { state, env, descriptor: d, DB, productionDB };
}
function observe(t, f) {
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === 'https://' + TEAM + '/cdn-cgi/access/certs') {
      f.state.keyFetches.push({ url, options });
      if (f.state.jwksWait) { f.state.jwksWait.entered.resolve(); await f.state.jwksWait.release.promise; }
      return Response.json({ keys: [publicJwk] });
    }
    f.state.backendCalls.push({ url, options });
    throw new Error('PRIVATE_UNEXPECTED_BACKEND_DISPATCH');
  });
  for (const method of ['log', 'warn', 'error']) {
    t.mock.method(console, method, (...values) => f.state.logs.push(values));
  }
}
async function request(f, { url = DEV_RESOURCE, method = 'POST', token, claims,
  headers = {}, unreadBody = true } = {}) {
  const h = new Headers(headers);
  const assertion = token === undefined ? await jwt(claims) : token;
  if (assertion !== null) h.set('Cf-Access-Jwt-Assertion', assertion);
  const req = new Request(url, {
    method, headers: h, ...(!['GET', 'HEAD'].includes(method) ? { body: PRIVATE_BODY } : {}),
  });
  if (unreadBody) {
    for (const key of ['body', 'json', 'text', 'arrayBuffer', 'formData', 'blob']) {
      Object.defineProperty(req, key, { configurable: true, get() {
        f.state.bodyReads++; throw new Error('PRIVATE_REQUEST_BODY_MUST_NOT_BE_READ');
      } });
    }
  }
  return req;
}
function activity(f) {
  return { prepares: f.state.devPrepares, reads: f.state.devReads,
    production: f.state.productionReads, writes: f.state.writes,
    body: f.state.bodyReads, keys: f.state.keyFetches.length, backend: f.state.backendCalls.length };
}
function noSideEffects(f) {
  assert.equal(f.state.productionReads, 0);
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.bodyReads, 0);
  assert.equal(f.state.backendCalls.length, 0);
}
async function result(response, status, code, ownerAuthorized = false, f) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const value = await response.json();
  assert.deepEqual(Object.keys(value).sort(), ['error', 'ownerAuthorized', ...FALSE_FLAGS].sort());
  assert.equal(value.error, code);
  assert.equal(value.ownerAuthorized, ownerAuthorized);
  for (const key of FALSE_FLAGS) assert.equal(value[key], false, key);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Location'), null);
  const serialized = JSON.stringify(value);
  for (const secret of [DEV_TOKEN, PROD_TOKEN, OWNER, SUBJECT, PRIVATE_BODY,
    'PRIVATE_DEV_DB_FAILURE', 'PRIVATE_PRODUCTION_DB_MUST_NOT_BE_USED', 'private-dev-owner-row-id',
    DEV_AUD, PROD_AUD, DEV_ORIGIN, PROD_ORIGIN]) assert.equal(serialized.includes(secret), false);
  if (f) noSideEffects(f);
  return value;
}
async function positive(f) {
  const before = f.state.devReads;
  await result(await edge.devRemoteMcp(await request(f), f.env), 503, 'dev_activation_disabled', true, f);
  assert.equal(f.state.devReads, before + 1, 'positive control reaches the current DEV owner row');
}

test('DEV edge descriptor and authorization API capability is available', () => {
  assert.equal(edgeImport.error, undefined, 'missing module is a capability gap, not a behavioral regression');
  for (const key of ['validateDevEdgeDescriptor', 'matchDevEdgeRuntimePlan', 'devRemoteMcp']) {
    assert.equal(typeof edge?.[key], 'function', key);
  }
  assert.equal(edge.DEV_MCP_HOST, 'mcp-dev.m-techlabs.com');
  assert.equal(edge.DEV_MCP_ORIGIN_HOST, 'mcp-dev-origin.m-techlabs.com');
});

test('dedicated DEV entry capability exists without a scheduled production worker', () => {
  assert.equal(entryImport.error, undefined, 'missing dedicated entry is a capability gap');
  assert.equal(typeof entry?.fetch, 'function');
  assert.equal(Object.hasOwn(entry, 'scheduled'), false);
});

apiTest('DEV descriptor is canonically ordered deeply copied and frozen without activation', () => {
  const input = descriptor(), output = edge.validateDevEdgeDescriptor(input);
  assert.deepEqual(output, input);
  assert.equal(JSON.stringify(output), JSON.stringify(input));
  for (const object of [output, output.owner, output.production, output.development]) assert.equal(Object.isFrozen(object), true);
  input.owner.subject = 'mutated'; input.development.backendId = 'retargeted';
  assert.equal(output.owner.subject, SUBJECT);
  assert.equal(output.development.backendId, 'development-edge-fixture');
  const loopback = descriptor(); loopback.production.originHostHeader = '127.0.0.1:19740';
  assert.deepEqual(edge.validateDevEdgeDescriptor(loopback), loopback);
});

apiTest('DEV descriptor rejects missing unknown array null and nonplain records', () => {
  validDescriptor();
  for (const value of [null, [], 1, 'descriptor', new Date(), new Map()]) {
    assert.throws(() => edge.validateDevEdgeDescriptor(value), { message: 'invalid_dev_edge_descriptor' });
  }
  for (const record of [null, [], Object.create({ inherited: true })]) {
    for (const key of ['owner', 'production', 'development']) rejectsDescriptor(d => { d[key] = record; });
  }
  for (const key of Object.keys(descriptor())) rejectsDescriptor(d => { delete d[key]; });
  for (const path of [[], ['owner'], ['production'], ['development']]) {
    rejectsDescriptor(d => { const target = path.length ? d[path[0]] : d; target.unreviewed = true; });
  }
});

apiTest('DEV descriptor refuses getters hidden keys and symbols without invoking accessors', () => {
  for (const path of [[], ['owner'], ['production'], ['development']]) {
    let calls = 0;
    rejectsDescriptor(d => {
      const target = path.length ? d[path[0]] : d, key = Object.keys(target)[0];
      Object.defineProperty(target, key, { enumerable: true, get() { calls++; return 'private getter'; } });
    });
    assert.equal(calls, 0);
    rejectsDescriptor(d => Object.defineProperty(path.length ? d[path[0]] : d, 'hidden', { value: true }));
    rejectsDescriptor(d => { (path.length ? d[path[0]] : d)[Symbol('extra')] = true; });
  }
});

apiTest('DEV descriptor rejects authority claims owner aliases and malformed instance identifiers', () => {
  for (const value of [0, 2, '1']) rejectsDescriptor(d => { d.schemaVersion = value; });
  for (const value of ['dev-', 'DEV-test', 'prod', 'dev--test', 'dev-' + 'x'.repeat(45), 'dev\n']) {
    rejectsDescriptor(d => { d.instanceId = value; });
  }
  for (const value of ['public', 'delegated', true]) rejectsDescriptor(d => { d.authorizationMode = value; });
  for (const value of [true, 0, null]) rejectsDescriptor(d => { d.upstreamEnabled = value; });
  rejectsDescriptor(d => { d.activationAuthorized = true; });
  for (const value of [' Owner@example.test', 'OWNER@example.test', '*@example.test', 'owner@example.test\n']) {
    rejectsDescriptor(d => { d.owner.email = value; });
  }
  for (const value of ['', 'subject with spaces', 'nonascii-é', 'x'.repeat(513), 'subject\u007f']) {
    rejectsDescriptor(d => { d.owner.subject = value; });
  }
});

apiTest('DEV descriptor rejects every production or development endpoint alias and retarget', () => {
  for (const which of ['production', 'development']) {
    for (const key of ['resource', 'origin']) {
      const expected = descriptor()[which][key];
      for (const value of [expected + '/', expected + '?target=production', expected + '#fragment',
        expected.replace('https:', 'http:'), expected.replace('.com/', '.com:443/'),
        expected.replace('.com/', '.com:8443/'), expected.replace('.com/', '.com.attacker.invalid/'),
        expected.replace('/mcp', '/admin'), expected.replace('https://', 'https://user:pass@'),
        expected.toUpperCase(), expected + '\n']) rejectsDescriptor(d => { d[which][key] = value; });
    }
  }
});

apiTest('DEV descriptor independently separates all routing store and credential identities', () => {
  for (const key of ['backendId', 'accessAppId', 'audience', 'connectorAppId',
    'authorizationStoreId', 'credentialSha256']) {
    rejectsDescriptor(d => { d.development[key] = d.production[key]; });
  }
  for (const which of ['production', 'development']) {
    for (const [key, bad] of [['backendId', 'bad_backend'], ['accessAppId', 'not-a-uuid'],
      ['audience', 'A'.repeat(64)], ['connectorAppId', 'custom-app'],
      ['authorizationStoreId', '00000000-0000-0000-0000-00000000000Z'], ['credentialSha256', 'f'.repeat(63)]]) {
      rejectsDescriptor(d => { d[which][key] = bad; });
    }
    rejectsDescriptor(d => { d[which].backendId += '\n'; });
  }
});

apiTest('DEV descriptor fixes credential and authorization bindings without production defaults', () => {
  for (const which of ['production', 'development']) {
    for (const key of ['credentialBinding', 'authorizationStoreBinding']) {
      rejectsDescriptor(d => { d[which][key] = d[which === 'production' ? 'development' : 'production'][key]; });
      rejectsDescriptor(d => { d[which][key] = 'CALLER_SELECTED_BINDING'; });
      rejectsDescriptor(d => { delete d[which][key]; });
    }
  }
});

apiTest('DEV descriptor binds exact manager ports and loopback Host declarations', () => {
  for (const port of [1024, 65535]) {
    const d = descriptor(); d.development.managerPort = port; d.development.originHostHeader = '127.0.0.1:' + port;
    assert.deepEqual(edge.validateDevEdgeDescriptor(d), d);
  }
  for (const port of [0, 1023, 65536, 19740, 19741.5, '19741', true]) {
    rejectsDescriptor(d => { d.development.managerPort = port; d.development.originHostHeader = '127.0.0.1:' + port; });
  }
  rejectsDescriptor(d => { d.production.managerPort = 19741; });
  for (const value of ['localhost:19741', '127.0.0.1:19740', 'mcp-dev-origin.m-techlabs.com',
    '127.0.0.1:19741/path', '127.0.0.1:19741\r\nInjected: yes']) rejectsDescriptor(d => { d.development.originHostHeader = value; });
  for (const value of ['mcp-origin.m-techlabs.com.attacker.invalid', 'mcp-origin.m-techlabs.com:443',
    '127.0.0.1:19741', 'mcp.m-techlabs.com']) rejectsDescriptor(d => { d.production.originHostHeader = value; });
});

apiTest('DEV descriptor pins issuer and challenge metadata to canonical dedicated URLs', () => {
  for (const value of ['http://' + TEAM, 'https://' + TEAM + '/', 'https://' + TEAM + ':443',
    'https://attacker.invalid', 'https://user:pass@' + TEAM, 'https://' + TEAM + '\n']) {
    rejectsDescriptor(d => { d.accessIssuer = value; });
  }
  for (const value of [METADATA + '/', METADATA + '?x=1', METADATA.replace('mcp-dev.', 'mcp.'),
    METADATA.replace('https:', 'http:'), DEV_RESOURCE]) rejectsDescriptor(d => { d.resourceMetadata = value; });
});

apiTest('DEV runtime matcher proves declarations only and returns no runtime or activation authority', () => {
  const d = descriptor(), plan = runtimePlan(d);
  plan.production.principalSid = 'deliberately not an observed SID';
  plan.development.profileDirectory = 'not a runtime-validated path';
  const output = edge.matchDevEdgeRuntimePlan(d, plan);
  assert.deepEqual(output, { matched: true, evidence: 'declared-routing-only',
    runtimePlanValidated: false, ...Object.fromEntries(FALSE_FLAGS.map(key => [key, false])) });
  assert.equal(Object.isFrozen(output), true);
});

apiTest('DEV runtime matcher is compatible with the complete existing validated runtime plan schema', () => {
  const d = descriptor(), input = runtimePlan(d);
  for (const [index, name] of ['production', 'development'].entries()) {
    input[name].principalSid = 'S-1-5-21-100-200-300-' + (1001 + index);
    input[name].profileDirectory = 'C:\\Users\\edge-fixture-' + name;
    input[name].manager = {
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      entryPath: 'C:\\EdgeFixture\\' + name + '\\admin.mjs',
      configPath: 'C:\\EdgeFixture\\' + name + '\\manager.json',
      port: d[name].managerPort,
    };
  }
  const complete = validateRuntimePlan(input);
  assert.equal(Object.isFrozen(complete), true);
  assert.deepEqual(edge.matchDevEdgeRuntimePlan(d, complete), {
    matched: true, evidence: 'declared-routing-only', runtimePlanValidated: false,
    ...Object.fromEntries(FALSE_FLAGS.map(key => [key, false])),
  });
});

apiTest('DEV runtime matcher rejects every mismatched routing field port and top-level binding', () => {
  for (const [key, value] of [['schemaVersion', 2], ['platform', 'linux'],
    ['instanceId', 'dev-another'], ['authorizationMode', 'delegated']]) {
    assert.equal(edge.matchDevEdgeRuntimePlan(descriptor(), runtimePlan()).matched, true);
    const p = runtimePlan(); p[key] = value;
    assert.throws(() => edge.matchDevEdgeRuntimePlan(descriptor(), p), { message: 'dev_edge_runtime_plan_mismatch' });
  }
  for (const which of ['production', 'development']) {
    for (const key of Object.keys(runtimePlan()[which].routing)) {
      const p = runtimePlan(); p[which].routing[key] += '-mismatch';
      assert.throws(() => edge.matchDevEdgeRuntimePlan(descriptor(), p), { message: 'dev_edge_runtime_plan_mismatch' });
    }
    const p = runtimePlan(); p[which].manager.port++;
    assert.throws(() => edge.matchDevEdgeRuntimePlan(descriptor(), p), { message: 'dev_edge_runtime_plan_mismatch' });
  }
  for (const value of [null, {}, { ...runtimePlan(), development: null }]) {
    assert.throws(() => edge.matchDevEdgeRuntimePlan(descriptor(), value), { message: 'dev_edge_runtime_plan_mismatch' });
  }
  const invalid = descriptor(); invalid.upstreamEnabled = true;
  assert.throws(() => edge.matchDevEdgeRuntimePlan(invalid, runtimePlan()), { message: 'invalid_dev_edge_descriptor' });
});

apiTest('DEV valid owner reaches the disabled terminal with no body backend or production work', async t => {
  const f = fixture(); observe(t, f);
  await positive(f);
  assert.equal(f.state.devReads, 1);
  assert.ok(f.state.keyFetches.length >= 1);
  for (const call of f.state.keyFetches) {
    assert.equal(call.url, 'https://' + TEAM + '/cdn-cgi/access/certs');
    assert.equal(call.options.redirect, 'manual');
  }
  assert.deepEqual(f.state.logs, []);
});

apiTest('DEV rejects invalid routes before reading configuration keys database or body', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  let envReads = 0;
  const poison = Object.defineProperty({}, 'MCP_DEV_EDGE_DESCRIPTOR', { get() { envReads++; throw new Error('must-not-read'); } });
  for (const url of [PROD_RESOURCE, DEV_ORIGIN, 'http://mcp-dev.m-techlabs.com/mcp',
    DEV_RESOURCE + '/', DEV_RESOURCE + '?route=production', DEV_RESOURCE.replace('.com/', '.com:8443/'),
    DEV_RESOURCE.replace('/mcp', '/admin/mcp')]) {
    const before = activity(f);
    await result(await edge.devRemoteMcp(await request(f, { url }), poison), 404, 'dev_edge_not_found', false, f);
    assert.deepEqual(activity(f), before);
  }
  assert.equal(envReads, 0);
});

apiTest('DEV method and explicit Origin refusals precede all configuration and identity work', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  for (const [url, method, allow] of [[DEV_RESOURCE, 'GET', 'POST'], [DEV_RESOURCE, 'DELETE', 'POST'],
    [DEV_RESOURCE, 'OPTIONS', 'POST'], [METADATA, 'POST', 'GET']]) {
    const before = activity(f), response = await edge.devRemoteMcp(await request(f, { url, method }), {});
    assert.equal(response.headers.get('Allow'), allow);
    await result(response, 405, 'dev_edge_method_not_allowed', false, f);
    assert.deepEqual(activity(f), before);
  }
  for (const Origin of ['null', 'https://mcp.m-techlabs.com', 'https://attacker.invalid',
    'https://chatgpt.com.attacker.invalid', 'http://chatgpt.com', 'https://gemini.google.com']) {
    const before = activity(f);
    await result(await edge.devRemoteMcp(await request(f, { headers: { Origin } }), {}),
      403, 'dev_edge_origin_denied', false, f);
    assert.deepEqual(activity(f), before);
  }
});

apiTest('DEV permits only declared browser origins or absent Origin while staying disabled', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  for (const Origin of ['https://mcp-dev.m-techlabs.com', 'https://chatgpt.com', 'https://claude.ai']) {
    const before = f.state.devReads;
    await result(await edge.devRemoteMcp(await request(f, { headers: { Origin } }), f.env),
      503, 'dev_activation_disabled', true, f);
    assert.equal(f.state.devReads, before + 1);
  }
});

apiTest('DEV metadata remains explicitly unavailable without fabricated OAuth discovery or owner lookup', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  const before = activity(f);
  const response = await edge.devRemoteMcp(await request(f, { url: METADATA, method: 'GET', token: null }), f.env);
  const value = await result(response, 503, 'dev_activation_disabled', false, f);
  assert.equal(response.headers.get('WWW-Authenticate'), null);
  assert.equal(Object.hasOwn(value, 'authorization_servers'), false);
  assert.equal(Object.hasOwn(value, 'resource'), false);
  assert.deepEqual(activity(f), before);
});

apiTest('DEV config requires exact canonical JSON and rejects duplicate reordered or oversized text before authentication', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  const canonical = JSON.stringify(descriptor());
  const reversed = Object.fromEntries(Object.entries(descriptor()).reverse());
  for (const text of [undefined, null, descriptor(), '', ' ' + canonical, canonical + '\n',
    JSON.stringify(descriptor(), null, 2), JSON.stringify(reversed),
    canonical.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    canonical.replace('"dev-edge-fixture"', '"dev-edge-\\u0066ixture"'), ' '.repeat(16385)]) {
    const before = activity(f);
    await result(await edge.devRemoteMcp(await request(f), { ...f.env, MCP_DEV_EDGE_DESCRIPTOR: text }),
      503, 'dev_edge_unconfigured', false, f);
    assert.deepEqual(activity(f), before);
  }
});

apiTest('DEV captures only data environment bindings and rejects relevant accessors without invoking them', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  for (const key of ['MCP_DEV_EDGE_DESCRIPTOR', 'MCP_DEV_MANAGER_TOKEN', 'MCP_DEV_AUTH_DB']) {
    let reads = 0;
    const env = { ...f.env };
    Object.defineProperty(env, key, { get() { reads++; throw new Error('PRIVATE_ENV_ACCESSOR'); } });
    const before = activity(f);
    await result(await edge.devRemoteMcp(await request(f), env), 503, 'dev_edge_unconfigured', false, f);
    assert.equal(reads, 0); assert.deepEqual(activity(f), before);
  }
});

apiTest('DEV bearer bytes must match their declaration and cannot reuse production credentials', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  for (const token of [undefined, null, '', 'x'.repeat(31), 'x'.repeat(513), DEV_TOKEN + ' ',
    DEV_TOKEN + '\n', 'nonascii-é-token-' + 'x'.repeat(40), PROD_TOKEN, 'different-valid-length-private-token-00000']) {
    const before = activity(f);
    await result(await edge.devRemoteMcp(await request(f), { ...f.env, MCP_DEV_MANAGER_TOKEN: token }),
      503, 'dev_edge_unconfigured', false, f);
    assert.deepEqual(activity(f), before);
  }
  const d = descriptor(); d.development.credentialSha256 = d.production.credentialSha256;
  await result(await edge.devRemoteMcp(await request(f), { ...f.env,
    MCP_DEV_EDGE_DESCRIPTOR: JSON.stringify(d), MCP_DEV_MANAGER_TOKEN: PROD_TOKEN }),
  503, 'dev_edge_unconfigured', false, f);
});

apiTest('DEV authorization store is mandatory distinct by handle and never falls back to production DB', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  for (const DB of [undefined, null, {}, { prepare: null }, f.productionDB]) {
    const before = activity(f);
    await result(await edge.devRemoteMcp(await request(f), { ...f.env, MCP_DEV_AUTH_DB: DB }),
      503, 'dev_edge_unconfigured', false, f);
    assert.deepEqual(activity(f), before);
  }
  let getters = 0;
  const db = Object.defineProperty({}, 'prepare', { get() { getters++; throw new Error('PRIVATE_PREPARE_ACCESSOR'); } });
  await result(await edge.devRemoteMcp(await request(f), { ...f.env, MCP_DEV_AUTH_DB: db }),
    503, 'dev_edge_unconfigured', false, f);
  assert.equal(getters, 0);
});

apiTest('DEV ignores a poison production DB getter and does not read production bearer configuration', async t => {
  const f = fixture(); observe(t, f);
  let touched = 0;
  for (const key of ['DB', 'MCP_MANAGER_TOKEN', 'MCP_MANAGER_ORIGIN', 'MCP_ACCESS_AUD']) {
    Object.defineProperty(f.env, key, { configurable: true, get() { touched++; throw new Error('PRIVATE_PRODUCTION_BINDING'); } });
  }
  await positive(f);
  assert.equal(touched, 0);
});

apiTest('DEV human authentication requires a real assertion rather than cookies bearer or descriptive identity', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  for (const token of [null, '', 'invalid.jwt.value']) {
    const before = f.state.devReads;
    const response = await edge.devRemoteMcp(await request(f, { token,
      headers: { Authorization: 'Bearer fake', Cookie: 'CF_Authorization=fake',
        'Cf-Access-Authenticated-User-Email': OWNER } }), f.env);
    await result(response, 401, 'dev_edge_unauthorized', false, f);
    assert.match(response.headers.get('WWW-Authenticate') || '',
      /^Bearer resource_metadata="https:\/\/mcp-dev\.m-techlabs\.com\/\.well-known\/oauth-protected-resource", error="invalid_token"$/);
    assert.equal(f.state.devReads, before);
  }
});

apiTest('DEV signed assertions bind exact issuer signature algorithm and application token type', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  for (const claims of [{ iss: 'https://another.cloudflareaccess.com' }, { type: undefined },
    { type: 'service' }, { type: 'App' }, { identity: 'service' }, { nonce: 'evaluation' }]) {
    const before = f.state.devReads;
    await result(await edge.devRemoteMcp(await request(f, { token: await jwt(claims) }), f.env),
      401, 'dev_edge_unauthorized', false, f);
    assert.equal(f.state.devReads, before);
  }
  const signed = await jwt();
  const [header, payload] = signed.split('.');
  for (const token of [header + '.' + payload + '.' + Buffer.alloc(256).toString('base64url'),
    await jwt({}, { alg: 'HS256' }), await jwt({}, { jku: 'https://attacker.invalid/keys' }),
    await jwt({}, { jwk: publicJwk })]) {
    const before = f.state.devReads;
    await result(await edge.devRemoteMcp(await request(f, { token }), f.env), 401, 'dev_edge_unauthorized', false, f);
    assert.equal(f.state.devReads, before);
  }
});

apiTest('DEV admits one exact audience and rejects production mixed duplicate or malformed audiences', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  await result(await edge.devRemoteMcp(await request(f, { token: await jwt({ aud: DEV_AUD }) }), f.env),
    503, 'dev_activation_disabled', true, f);
  for (const aud of [PROD_AUD, [PROD_AUD], [DEV_AUD, PROD_AUD], [DEV_AUD, 'hub-audience'],
    [DEV_AUD, DEV_AUD], [], null, [DEV_AUD, null], DEV_AUD + ',extra']) {
    const before = f.state.devReads;
    await result(await edge.devRemoteMcp(await request(f, { token: await jwt({ aud }) }), f.env),
      401, 'dev_edge_unauthorized', false, f);
    assert.equal(f.state.devReads, before);
  }
});

apiTest('DEV JWT lifetime and human identity shape are checked before owner state access', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [{ exp: now - 1 }, { exp: undefined }, { nbf: now + 60 },
    { iat: now + 120 }, { iat: null }, { sub: '' }, { sub: null }, { email: null }]) {
    const before = f.state.devReads;
    await result(await edge.devRemoteMcp(await request(f, { token: await jwt(claims) }), f.env),
      401, 'dev_edge_unauthorized', false, f);
    assert.equal(f.state.devReads, before);
  }
});

apiTest('DEV exact owner subject and normalized email must both match before database access', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  await result(await edge.devRemoteMcp(await request(f, { token: await jwt({ email: ' OWNER@EXAMPLE.TEST ' }) }), f.env),
    503, 'dev_activation_disabled', true, f);
  for (const claims of [{ sub: 'another-owner-subject' }, { sub: SUBJECT.toUpperCase() },
    { email: 'guest@example.test' }, { email: 'owner+different@example.test' }]) {
    const before = f.state.devReads;
    await result(await edge.devRemoteMcp(await request(f, { token: await jwt(claims) }), f.env),
      403, 'dev_edge_owner_denied', false, f);
    assert.equal(f.state.devReads, before);
  }
});

apiTest('DEV owner row must be currently approved strictly typed and match the pinned owner', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  const good = clone(f.state.row);
  for (const row of [null, { ...good, email: 'other@example.test' }, { ...good, is_owner: 0 },
    { ...good, is_owner: '1' }, { ...good, is_owner: true }, { ...good, status: 'pending' },
    { ...good, status: 'revoked' }, { ...good, status: 'suspended' }, { ...good, revoke_before: -1 },
    { ...good, revoke_before: null }, { ...good, revoke_before: '0' },
    { ...good, revoke_before: Number.MAX_SAFE_INTEGER + 1 }]) {
    f.state.row = good; await positive(f);
    f.state.row = row;
    const before = f.state.devReads;
    await result(await edge.devRemoteMcp(await request(f), f.env), 403, 'dev_edge_owner_denied', false, f);
    assert.equal(f.state.devReads, before + 1);
  }
});

apiTest('DEV owner revocation is read on every request and equality revokes the prior token', async t => {
  const f = fixture(); observe(t, f);
  const now = Math.floor(Date.now() / 1000), issued = now - 20, token = await jwt({ iat: issued });
  await result(await edge.devRemoteMcp(await request(f, { token }), f.env), 503, 'dev_activation_disabled', true, f);
  f.state.row.revoke_before = issued;
  await result(await edge.devRemoteMcp(await request(f, { token }), f.env), 403, 'dev_edge_owner_denied', false, f);
  await result(await edge.devRemoteMcp(await request(f, { token: await jwt({ iat: issued + 1 }) }), f.env),
    503, 'dev_activation_disabled', true, f);
  assert.equal(f.state.devReads, 3);
});

apiTest('DEV authorization storage failure remains private and never consults grants or retries', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  f.state.throwDB = true;
  const before = f.state.devReads;
  await result(await edge.devRemoteMcp(await request(f), f.env),
    503, 'dev_edge_authorization_unavailable', false, f);
  assert.equal(f.state.devReads, before + 1);
  assert.deepEqual(f.state.logs, []);
});

apiTest('DEV descriptor token store and prepare are captured before the first asynchronous digest', async t => {
  const f = fixture(); observe(t, f);
  const entered = gate(), release = gate(), original = crypto.subtle.digest.bind(crypto.subtle);
  let held = false, retargeted = 0;
  t.mock.method(crypto.subtle, 'digest', async (...args) => {
    if (!held) { held = true; entered.resolve(); await release.promise; }
    return original(...args);
  });
  const pending = edge.devRemoteMcp(await request(f), f.env);
  await enteredStage(entered, pending, 'digest');
  const replacement = descriptor(); replacement.owner.subject = 'changed-during-digest';
  f.env.MCP_DEV_EDGE_DESCRIPTOR = JSON.stringify(replacement);
  f.env.MCP_DEV_MANAGER_TOKEN = PROD_TOKEN;
  f.env.MCP_DEV_AUTH_DB = { prepare() { retargeted++; throw new Error('retargeted DB'); } };
  f.DB.prepare = () => { retargeted++; throw new Error('retargeted prepare'); };
  release.resolve();
  await result(await pending, 503, 'dev_activation_disabled', true, f);
  assert.equal(retargeted, 0); assert.equal(f.state.devReads, 1);
});

apiTest('DEV pending key verification cannot retarget its captured descriptor or authorization store', async t => {
  const f = fixture(); observe(t, f);
  f.state.jwksWait = { entered: gate(), release: gate() };
  let retargeted = 0;
  const pending = edge.devRemoteMcp(await request(f), f.env);
  await enteredStage(f.state.jwksWait.entered, pending, 'JWKS');
  const replacement = descriptor(); replacement.development.audience = PROD_AUD;
  f.env.MCP_DEV_EDGE_DESCRIPTOR = JSON.stringify(replacement);
  f.env.MCP_DEV_AUTH_DB = { prepare() { retargeted++; throw new Error('retargeted'); } };
  f.state.jwksWait.release.resolve();
  await result(await pending, 503, 'dev_activation_disabled', true, f);
  assert.equal(retargeted, 0); assert.equal(f.state.devReads, 1);
});

apiTest('DEV rechecks token expiry after the awaited owner-row lookup', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  let nowMs = Date.now();
  t.mock.method(Date, 'now', () => nowMs);
  const now = Math.floor(nowMs / 1000);
  f.state.firstWait = { entered: gate(), release: gate() };
  const pending = edge.devRemoteMcp(await request(f, { token: await jwt({ exp: now + 2 }) }), f.env);
  await enteredStage(f.state.firstWait.entered, pending, 'owner-row');
  nowMs = (now + 3) * 1000;
  f.state.firstWait.release.resolve();
  await result(await pending, 401, 'dev_edge_unauthorized', false, f);
  assert.equal(f.state.devReads, 2);
});

apiTest('DEV request claims headers and body cannot enable activation or leak private traces', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  await result(await edge.devRemoteMcp(await request(f, { headers: {
    Authorization: 'Bearer ' + PROD_TOKEN, Cookie: 'private-cookie=' + DEV_TOKEN,
    'X-Forwarded-Host': 'mcp.m-techlabs.com', 'X-Backend-Origin': PROD_ORIGIN,
    'X-Activation-Authorized': 'true', 'X-Owner': OWNER,
  } }), f.env), 503, 'dev_activation_disabled', true, f);
  assert.deepEqual(f.state.logs, []);
  noSideEffects(f);
});

entryTest('dedicated DEV entry exposes only the disabled DEV surface and no production fallback', async t => {
  const f = fixture(); observe(t, f);
  await result(await entry.fetch(await request(f), f.env), 503, 'dev_activation_disabled', true, f);
  const before = activity(f);
  for (const url of [PROD_RESOURCE, DEV_ORIGIN, 'https://m-techlabs.com/admin/access', DEV_RESOURCE + '?fallback=production']) {
    await result(await entry.fetch(await request(f, { url }), f.env), 404, 'dev_edge_not_found', false, f);
  }
  assert.deepEqual(activity(f), before);
  assert.equal(Object.hasOwn(entry, 'scheduled'), false);
});

function gatewayFixture(t) {
  const counters = { reads: 0, writes: 0, outbound: [], waitUntil: 0, logs: [] };
  const guest = { id: 'delegated-web-user', email: 'guest@example.test', status: 'approved', is_owner: 0, revoke_before: 0 };
  const app = { id: 'legacy-fixture', hostname: 'legacy.example.test', enabled: 1, managed: 1,
    access_mode: 'gate', audience: DEV_AUD };
  const DB = {
    prepare(sql) {
      counters.reads++;
      return { bind(...args) {
        return {
          async first() {
            if (sql === 'SELECT * FROM apps WHERE hostname=?') return { ...app, hostname: args[0] };
            if (sql === 'SELECT * FROM apps WHERE id=?') return app;
            if (sql === 'SELECT * FROM users WHERE email=?') return guest;
            if (sql === 'SELECT role FROM grants WHERE user_id=? AND app_id=?') return { role: 'access' };
            throw new Error('unexpected generic gateway SQL');
          },
          async run() { counters.writes++; return { success: true }; },
          async all() { throw new Error('unexpected group lookup'); },
        };
      } };
    },
  };
  const env = { DB, ACCESS_TEAM: TEAM, OWNER_EMAIL: OWNER, CODE_HOST: 'codes.m-techlabs.com', HUB_HOST: 'm-techlabs.com' };
  const ctx = { waitUntil(promise) { counters.waitUntil++; promise.catch(() => {}); } };
  t.mock.method(globalThis, 'fetch', async input => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === 'https://' + TEAM + '/cdn-cgi/access/certs') return Response.json({ keys: [publicJwk] });
    counters.outbound.push(url);
    return Response.json({ legacyFixtureReached: true });
  });
  t.mock.method(console, 'error', (...args) => counters.logs.push(args));
  return { counters, env, ctx };
}
async function gatewayControl(f) {
  const response = await worker.fetch(new Request('https://legacy.example.test/mcp', {
    method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await jwt({ email: 'guest@example.test' }) },
    body: PRIVATE_BODY,
  }), f.env, f.ctx);
  assert.equal(response.status, 200, 'the neighboring legacy delegated gateway must actually work');
  assert.deepEqual(await response.json(), { legacyFixtureReached: true });
  assert.equal(response.headers.get('X-MTechLabs-Authorization'), 'enforced');
}

routeTest('Worker reserves the canonical DEV resource even when a website grant would allow its hostname', async t => {
  const f = gatewayFixture(t); await gatewayControl(f);
  const before = clone(f.counters);
  const response = await worker.fetch(new Request(DEV_RESOURCE, {
    method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await jwt({ email: 'guest@example.test' }) }, body: PRIVATE_BODY,
  }), f.env, f.ctx);
  assert.equal(response.status, 503);
  const value = await response.json();
  assert.equal(value.error, 'dev_edge_unconfigured');
  assert.equal(value.ownerAuthorized, false);
  for (const key of FALSE_FLAGS) assert.equal(value[key], false);
  assert.deepEqual(f.counters, before, 'reserved DEV must not perform generic DB, activity write, grant, gateway or cron work');
});

routeTest('Worker reserves the DEV origin hostname and malformed DEV paths before generic grant routing', async t => {
  const f = gatewayFixture(t); await gatewayControl(f);
  for (const url of [DEV_ORIGIN, 'https://mcp-dev-origin.m-techlabs.com/v1/status',
    'https://mcp-dev.m-techlabs.com/admin', DEV_RESOURCE + '?fallback=production',
    'http://mcp-dev.m-techlabs.com/mcp', DEV_RESOURCE.replace('.com/', '.com:8443/')]) {
    const before = clone(f.counters);
    const response = await worker.fetch(new Request(url, {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await jwt({ email: 'guest@example.test' }) }, body: PRIVATE_BODY,
    }), f.env, f.ctx);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'dev_edge_not_found');
    assert.deepEqual(f.counters, before);
  }
});

routeTest('Worker reserved DEV routes do not eagerly touch a poison production DB binding', async t => {
  const f = fixture(); observe(t, f);
  let productionGetterReads = 0;
  const env = Object.defineProperty({}, 'DB', { get() { productionGetterReads++; throw new Error('poison production DB'); } });
  for (const [url, expected] of [[DEV_RESOURCE, 'dev_edge_unconfigured'], [DEV_ORIGIN, 'dev_edge_not_found']]) {
    const response = await worker.fetch(await request(f, { url, token: null }), env, {});
    assert.equal(response.status, url === DEV_RESOURCE ? 503 : 404);
    assert.equal((await response.json()).error, expected);
  }
  assert.equal(productionGetterReads, 0);
  assert.equal(f.state.keyFetches.length, 0);
  assert.equal(f.state.backendCalls.length, 0);
  assert.equal(f.state.bodyReads, 0);
});

entryTest('Worker configured DEV route authorizes only its captured DEV owner and remains activation disabled', async t => {
  const f = fixture(); observe(t, f); await positive(f);
  await result(await worker.fetch(await request(f), f.env, {}),
    503, 'dev_activation_disabled', true, f);
  assert.equal(f.state.devReads, 2);
  const before = activity(f);
  await result(await worker.fetch(await request(f, { url: METADATA, method: 'GET', token: null }), f.env, {}),
    503, 'dev_activation_disabled', false, f);
  assert.deepEqual(activity(f), before);
});

routeTest('Worker terminally rejects trailing-dot DEV hostname aliases before generic grants or outbound routing', async t => {
  const f = gatewayFixture(t); await gatewayControl(f);
  for (const host of ['mcp-dev.m-techlabs.com.', 'mcp-dev.m-techlabs.com..',
    'mcp-dev-origin.m-techlabs.com.', 'mcp-dev-origin.m-techlabs.com..']) {
    const before = clone(f.counters);
    const response = await worker.fetch(new Request('https://' + host + '/mcp', {
      method: 'POST', headers: { 'Cf-Access-Jwt-Assertion': await jwt({ email: 'guest@example.test' }) },
      body: PRIVATE_BODY,
    }), f.env, f.ctx);
    assert.equal(response.status, 404, host);
    const value = await response.json();
    assert.equal(value.error, 'dev_edge_not_found', host);
    assert.equal(value.ownerAuthorized, false);
    for (const key of FALSE_FLAGS) assert.equal(value[key], false);
    assert.deepEqual(f.counters, before, 'hostname aliases cannot reach the working neighboring grant path');
  }
});
