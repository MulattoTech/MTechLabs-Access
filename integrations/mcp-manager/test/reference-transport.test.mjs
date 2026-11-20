import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

// Independent contract fixtures. A missing new module is an explicit baseline
// capability gap, never evidence that a behavioral or security assertion passed.
async function optionalImport(url) {
  try { return { module: await import(url) }; }
  catch (error) { return { error, absent: error?.code === 'ERR_MODULE_NOT_FOUND' }; }
}
const bootstrapImport = await optionalImport('../lib/reference-bootstrap.mjs');
const transportImport = await optionalImport('../lib/reference-transport.mjs');
const bootstrap = bootstrapImport.module;
const transport = transportImport.module;
const contractTest = (name, body) => test(name, {
  skip: bootstrapImport.absent ? 'Baseline protected bootstrap capability is absent; no behavioral pass claimed' : false,
}, body);
const transportTest = (name, body) => test(name, {
  skip: bootstrapImport.absent || transportImport.absent ? 'Baseline authenticated reference transport is absent; no behavioral pass claimed' : false,
}, body);

const SOURCE_FILES = [
  'package.json', 'inspect-dev-runtime.mjs', 'reference-server.mjs', 'manage-dev.ps1',
  'windows-reference.ps1', 'windows-reference-native.cs', 'windows-runtime-probe.ps1',
  'lib/reference-bootstrap.mjs', 'lib/reference-transport.mjs', 'lib/production-reference.mjs',
  'lib/dev-runtime-reference.mjs', 'lib/runtime-files.mjs', 'lib/runtime-identity.mjs',
  'lib/dev-runtime-plan.mjs', 'lib/dev-instance.mjs', 'lib/config.mjs', 'lib/token.mjs',
];
const TRUST_KEYS = ['schemaVersion', 'instanceId', 'generation', 'authoritySid', 'developmentSid',
  'registrationSha256', 'publicKeySpki', 'developmentConfigPath', 'planPath', 'nodePath',
  'nodeSha256', 'sourceSha256'];
const hash = text => createHash('sha256').update(text).digest('hex');
const keys = generateKeyPairSync('ed25519');
const publicSpki = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
const privatePkcs8 = keys.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url');

function fixture() {
  return {
    schemaVersion: 1, instanceId: 'dev-reference-fixture', generation: 1,
    authoritySid: 'S-1-5-21-100-200-300-1001', developmentSid: 'S-1-5-21-100-200-300-1002',
    registrationSha256: hash('protected reference fixture registration v1'), publicKeySpki: publicSpki,
    developmentConfigPath: 'C:\\ReferenceFixture\\dev-state\\manager.json',
    planPath: 'C:\\ReferenceFixture\\dev-state\\dev-runtime-plan.json',
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    nodeSha256: hash('protected reference fixture executable v1'),
    sourceSha256: Object.fromEntries(SOURCE_FILES.map(file => [file, hash('protected reference fixture source v1\n' + file)])),
  };
}

function control() {
  const input = fixture(), output = bootstrap.validateReferenceTrust(input);
  assert.deepEqual(output, input, 'an unmodified valid trust declaration must first succeed');
  return output;
}
function invalid(change, label) {
  control();
  const input = fixture(); change(input);
  assert.throws(() => bootstrap.validateReferenceTrust(input),
    { message: 'runtime_reference_bootstrap_invalid' }, label);
}
function forbiddenIo(t) {
  const attempts = [];
  for (const [object, method] of [
    ...['open', 'readFile', 'writeFile', 'lstat', 'stat', 'realpath', 'mkdir'].map(key => [fs, key]),
    ...['spawn', 'execFile', 'exec', 'spawnSync', 'execFileSync'].map(key => [childProcess, key]),
  ]) t.mock.method(object, method, () => { attempts.push(method); throw new Error('PRIVATE_FORBIDDEN_IO'); });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return attempts;
}

test('protected reference bootstrap capability exposes the agreed validator and opaque loader', () => {
  assert.equal(bootstrapImport.error, undefined, 'missing module is a new capability gap');
  assert.equal(typeof bootstrap?.validateReferenceTrust, 'function');
  assert.equal(typeof bootstrap?.loadReferenceBootstrap, 'function');
  assert.equal(typeof bootstrap?.createBootstrappedReferenceAuthority, 'function');
  assert.equal(typeof bootstrap?.inspectRegisteredDevRuntime, 'function');
  assert.deepEqual(bootstrap?.REFERENCE_SOURCE_FILES, SOURCE_FILES);
  assert.equal(Object.isFrozen(bootstrap.REFERENCE_SOURCE_FILES), true);
});

test('authenticated reference transport capability exposes fixed bootstrap-bound server and exchange factories', () => {
  assert.equal(transportImport.error, undefined, 'missing module is a new capability gap');
  assert.equal(typeof transport?.serveReferenceTransport, 'function');
  assert.equal(typeof transport?.createReferenceExchange, 'function');
});

contractTest('protected trust declaration is canonically ordered deeply copied and frozen without granting authority', () => {
  const input = fixture(), output = bootstrap.validateReferenceTrust(input);
  assert.deepEqual(Object.keys(output), TRUST_KEYS);
  assert.deepEqual(Object.keys(output.sourceSha256), SOURCE_FILES);
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.sourceSha256), true);
  input.authoritySid = 'S-1-5-21-100-200-300-9999'; input.sourceSha256['package.json'] = '0'.repeat(64);
  assert.equal(output.authoritySid, fixture().authoritySid);
  assert.equal(output.sourceSha256['package.json'], fixture().sourceSha256['package.json']);
  for (const key of ['qualified', 'upstreamEnabled', 'activationAuthorized', 'trusted', 'aclVerified']) {
    assert.equal(Object.hasOwn(output, key), false, 'validated declarations must not masquerade as verified trust');
  }
});

contractTest('protected trust requires every field and rejects unknown readiness targets or private material', () => {
  for (const key of TRUST_KEYS) invalid(value => { delete value[key]; }, key);
  for (const [key, value] of [
    ['qualified', true], ['upstreamEnabled', true], ['activationAuthorized', true], ['trusted', true],
    ['aclVerified', true], ['endpoint', '\\\\.\\pipe\\caller-selected'], ['server', 'remote.example.test'],
    ['privateKey', privatePkcs8], ['signingKeyPath', 'C:\\Private\\caller.pk8'],
    ['registrationPath', 'C:\\Private\\caller.json'], ['productionConfigPath', 'C:\\Private\\production.json'],
  ]) invalid(trust => { trust[key] = value; }, key);
});

contractTest('protected trust rejects nonrecord array class and inherited-data schemas', () => {
  control();
  for (const value of [null, undefined, [], 'trust', 1, new Date(), new Map(),
    Object.assign(Object.create({ inherited: 'private' }), fixture())]) {
    assert.throws(() => bootstrap.validateReferenceTrust(value), { message: 'runtime_reference_bootstrap_invalid' });
  }
  const nullRecord = Object.assign(Object.create(null), fixture());
  nullRecord.sourceSha256 = Object.assign(Object.create(null), nullRecord.sourceSha256);
  assert.deepEqual(bootstrap.validateReferenceTrust(nullRecord), fixture());
});

contractTest('protected trust rejects accessors symbols and hidden fields without invoking getters', () => {
  for (const nested of [false, true]) {
    let getters = 0;
    invalid(value => {
      const target = nested ? value.sourceSha256 : value, key = Object.keys(target)[0];
      Object.defineProperty(target, key, { enumerable: true, get() { getters++; return 'PRIVATE_GETTER'; } });
    });
    assert.equal(getters, 0);
    invalid(value => Object.defineProperty(nested ? value.sourceSha256 : value, 'hidden', { value: true }));
    invalid(value => { (nested ? value.sourceSha256 : value)[Symbol('unexpected')] = true; });
  }
});

contractTest('protected trust pins schema version and positive safe integer generation', () => {
  for (const value of [0, 2, '1', true, null]) invalid(trust => { trust.schemaVersion = value; });
  for (const value of [0, -1, 1.5, '1', true, null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    invalid(trust => { trust.generation = value; });
  }
  const input = fixture(); input.generation = Number.MAX_SAFE_INTEGER;
  assert.equal(bootstrap.validateReferenceTrust(input).generation, Number.MAX_SAFE_INTEGER);
});

contractTest('protected trust accepts only bounded canonical DEV instance identifiers', () => {
  for (const value of ['dev', 'dev-' + 'x'.repeat(44)]) {
    const input = fixture(); input.instanceId = value;
    assert.equal(bootstrap.validateReferenceTrust(input).instanceId, value);
  }
  for (const value of ['', 'production', 'DEV', 'dev_', 'dev-', 'dev--test', 'dev-' + 'x'.repeat(45),
    'dev\n', 'dev\r', 'dev\0', 'dev\u007f']) invalid(trust => { trust.instanceId = value; });
});

contractTest('protected trust requires distinct canonical user SID declarations with DWORD components', () => {
  for (const key of ['authoritySid', 'developmentSid']) {
    for (const value of ['S-1-5-18', 'S-1-5-32-544', 'S-1-5-21-1-2-3',
      'S-1-5-21-1-2-3-01', 's-1-5-21-1-2-3-1001', 'S-1-5-21-1-2-3-4294967296',
      'S-1-5-21-4294967296-2-3-1001', 'S-1-5-21-1-2-3-1001\n',
      'S-1-5-21-1-2-3-1001\u007f', 'S-1-5-21-1-2-3-1001-extra']) {
      invalid(trust => { trust[key] = value; }, key);
    }
  }
  invalid(trust => { trust.developmentSid = trust.authoritySid; });
  const boundary = fixture(); boundary.authoritySid = 'S-1-5-21-4294967295-2-3-4294967295';
  assert.equal(bootstrap.validateReferenceTrust(boundary).authoritySid, boundary.authoritySid);
});

contractTest('protected trust accepts an Ed25519 public SPKI and rejects private or alternate key types', () => {
  assert.equal(control().publicKeySpki, publicSpki);
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const x25519 = generateKeyPairSync('x25519');
  for (const value of [privatePkcs8,
    rsa.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    x25519.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    keys.publicKey.export({ type: 'spki', format: 'pem' }), keys.publicKey, {}, null]) {
    invalid(trust => { trust.publicKeySpki = value; });
  }
});

contractTest('protected trust refuses alternate or malformed public-key encodings', () => {
  const der = Buffer.from(publicSpki, 'base64url');
  for (const value of ['', publicSpki + '=', publicSpki + '\n', publicSpki + ' ',
    ' ' + publicSpki, publicSpki.slice(0, -1), '*'.repeat(publicSpki.length),
    Buffer.concat([der, Buffer.from([0])]).toString('base64url'), 'A'.repeat(16384)]) {
    invalid(trust => { trust.publicKeySpki = value; });
  }
});

contractTest('protected trust digests require lowercase exact-length hex without whitespace aliases', () => {
  for (const key of ['registrationSha256', 'nodeSha256']) {
    for (const value of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64),
      'a'.repeat(64) + '\n', 'a'.repeat(64) + '\r', 'a'.repeat(64) + '\u007f', null, 0]) {
      invalid(trust => { trust[key] = value; }, key);
    }
  }
});

contractTest('protected trust source pins require exactly the complete fixed dependency set', () => {
  for (const file of SOURCE_FILES) {
    invalid(trust => { delete trust.sourceSha256[file]; }, file);
    invalid(trust => { trust.sourceSha256[file] = 'a'.repeat(63); }, file);
  }
  for (const file of ['../private-key.pk8', '/absolute.mjs', 'lib\\config.mjs',
    'lib/config.mjs\n', 'extra.mjs', 'reference-bootstrap/trust.json']) {
    invalid(trust => { trust.sourceSha256[file] = hash(file); }, file);
  }
});

contractTest('protected trust source pins reject record inheritance and digest control characters', () => {
  for (const value of [null, [], new Map(), Object.create({ inherited: true })]) {
    invalid(trust => { trust.sourceSha256 = value; });
  }
  for (const value of ['A'.repeat(64), 'a'.repeat(64) + '\n', 'a'.repeat(64) + '\u007f', false, null]) {
    invalid(trust => { trust.sourceSha256['lib/config.mjs'] = value; });
  }
});

contractTest('protected trust keeps ordinary Windows declarations without pretending to resolve filesystem aliases', () => {
  const input = fixture();
  input.developmentConfigPath = 'c:/ReferenceFixture/dev-state/./manager.json';
  input.planPath = 'C:\\REFERE~1\\dev-state\\dev-runtime-plan.json';
  input.nodePath = 'C:\\Program Files\\nodejs\\..\\nodejs\\node.exe';
  const output = bootstrap.validateReferenceTrust(input);
  for (const key of ['developmentConfigPath', 'planPath', 'nodePath']) assert.equal(output[key], input[key]);
  assert.equal(Object.hasOwn(output, 'canonicalIdentityVerified'), false);
});

contractTest('protected trust refuses remote relative device and alternate-stream path declarations', () => {
  for (const key of ['developmentConfigPath', 'planPath', 'nodePath']) {
    for (const value of ['', 'relative.json', 'C:relative.json', '/tmp/reference',
      '\\\\host.invalid\\share\\trust.json', '\\\\?\\C:\\ReferenceFixture\\trust.json',
      '\\\\.\\pipe\\other', 'C:\\ReferenceFixture\\file.json:stream',
      'C:\\ReferenceFixture\\CON', 'C:\\ReferenceFixture\\nul.json',
      'C:\\ReferenceFixture\\COM1\\file', 'C:\\ReferenceFixture\\name.\\file',
      'C:\\ReferenceFixture\\name \\file', 'C:\\ReferenceFixture\\file\n',
      'C:\\ReferenceFixture\\file\u007f', 'C:\\' + 'x'.repeat(1022)]) {
      invalid(trust => { trust[key] = value; }, key);
    }
  }
});

contractTest('protected trust declaration validation performs no filesystem process or network operations', t => {
  const attempts = forbiddenIo(t);
  t.mock.method(globalThis, 'fetch', () => { attempts.push('fetch'); throw new Error('PRIVATE_FETCH'); });
  control();
  invalid(trust => { trust.signingKeyPath = 'C:\\PRIVATE\\secret.pk8'; });
  assert.deepEqual(attempts, []);
});

transportTest('plain validated cloned or caller-claimed bootstrap handles cannot open an exchange', t => {
  const declaration = control(), attempts = forbiddenIo(t);
  const apparent = Object.freeze({ instanceId: declaration.instanceId, registrationSha256: declaration.registrationSha256 });
  for (const handle of [{}, declaration, apparent, structuredClone(apparent),
    { ...apparent, trusted: true, role: 'client', publicKey: keys.publicKey }]) {
    assert.throws(() => transport.createReferenceExchange(handle), { message: 'runtime_reference_bootstrap_untrusted' });
  }
  assert.deepEqual(attempts, []);
});

transportTest('caller-claimed authority bootstrap cannot start a privileged callback or native helper', t => {
  const declaration = control(), attempts = forbiddenIo(t); let invocations = 0;
  for (const handle of [{}, declaration,
    { instanceId: declaration.instanceId, registrationSha256: declaration.registrationSha256 },
    { ...declaration, role: 'authority', privateKey: keys.privateKey, aclVerified: true }]) {
    assert.throws(() => transport.serveReferenceTransport(handle, async () => {
      invocations++; throw new Error('PRIVATE_UNAUTHORIZED_OBSERVER');
    }), { message: 'runtime_reference_bootstrap_untrusted' });
  }
  assert.equal(invocations, 0); assert.deepEqual(attempts, []);
});

contractTest('registered authority construction refuses fake bootstrap without opening a key registration or production file', t => {
  const declaration = control(), attempts = forbiddenIo(t);
  for (const value of [{}, declaration, { instanceId: declaration.instanceId, registrationSha256: declaration.registrationSha256 },
    { ...declaration, privateKey: keys.privateKey, registration: {}, role: 'authority', aclVerified: true }]) {
    assert.throws(() => bootstrap.createBootstrappedReferenceAuthority(value),
      { message: 'runtime_reference_bootstrap_untrusted' });
  }
  assert.deepEqual(attempts, []);
});

contractTest('protected bootstrap refuses Node preload before invoking a native helper on Windows', async t => {
  if (process.platform !== 'win32') return t.skip('Requires Windows ordering; Linux refuses the unsupported platform first');
  const attempts = forbiddenIo(t), original = { NODE_OPTIONS: process.env.NODE_OPTIONS, NODE_PATH: process.env.NODE_PATH };
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  for (const key of ['NODE_OPTIONS', 'NODE_PATH']) {
    delete process.env.NODE_OPTIONS; delete process.env.NODE_PATH;
    process.env[key] = 'PRIVATE_PRELOAD_MUST_NOT_APPEAR';
    await assert.rejects(bootstrap.loadReferenceBootstrap('client'), { message: 'node_preload_environment_rejected' });
    await assert.rejects(bootstrap.loadReferenceBootstrap('authority'), { message: 'node_preload_environment_rejected' });
  }
  assert.deepEqual(attempts, []);
});

contractTest('unsupported platform refuses protected bootstrap before file or native access', async t => {
  if (process.platform === 'win32') return t.skip('Linux-only platform refusal; Windows uses actual protected bootstrap fixtures');
  const attempts = forbiddenIo(t);
  for (const role of ['client', 'authority']) {
    await assert.rejects(bootstrap.loadReferenceBootstrap(role), { message: 'dev_runtime_platform_unsupported' });
  }
  assert.deepEqual(attempts, []);
});
