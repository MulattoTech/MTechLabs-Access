import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { createProductionReferenceRegistration, createRegisteredProductionReferenceAuthority,
  inspectDevRuntimeWithReference } from '../lib/dev-runtime-reference.mjs';
import { createProductionReferenceAuthority, createProductionReferenceClient } from '../lib/production-reference.mjs';
import { captureWindowsRuntime } from '../lib/runtime-identity.mjs';
import { requireValidatedDevConfig } from '../lib/dev-instance.mjs';
import { windowsPath } from '../lib/dev-runtime-plan.mjs';
import { stableFileSnapshot } from '../lib/runtime-files.mjs';
import { runtimeInputs, directorySnapshot, hash } from './fixtures/runtime-inputs.mjs';

const native = { skip: process.platform !== 'win32' ? 'Requires native Windows reference filesystem and identity APIs' : false, timeout: 90000 };
const cases = [], completed = [];
const fixtureConfigFingerprint = hash('MTerm-CLI synthetic production config fingerprint v1');
const fixtureObservationFingerprint = hash('MTerm-CLI synthetic production observation fingerprint v1');
function nativeTest(name, body) {
  cases.push(name);
  test(name, native, async t => {
    const evidence = { name, nodeFilesystemWriteCalls: 0, requestedNativeRoles: [], realNative: false, unmodifiedControls: 0 };
    await body(t, evidence);
    assert.ok(evidence.unmodifiedControls >= 1, 'every native case must first complete an unmodified round trip');
    completed.push(evidence);
  });
}
function input(f) {
  return { id: 'disposable-reference', generation: 1, productionConfigPath: f.prod.configPath,
    developmentConfigPath: f.dev.configPath, planPath: f.planPath,
    production: f.prod.config, development: f.dev.config, plan: f.plan };
}
function pair(registration) {
  const keys = generateKeyPairSync('ed25519');
  return { ...keys, client: createProductionReferenceClient({ publicKey: keys.publicKey,
    registrationSha256: registration.sha256, instanceId: registration.instanceId }) };
}
const fixtureFacts = () => ({ productionConfigSha256: fixtureConfigFingerprint, productionObservationSha256: fixtureObservationFingerprint,
  productionListener: 'unverified', topologyVerified: true, credentialsDistinct: true });
function syntheticAuthority(registration, privateKey) {
  return createProductionReferenceAuthority({ privateKey, registrationSha256: registration.sha256,
    instanceId: registration.instanceId, observe: async () => fixtureFacts() });
}
function watchFilesystem(t, evidence, deny = () => false, beforeOpen = async () => {}) {
  const originals = Object.fromEntries(['open', 'lstat', 'realpath', 'opendir', 'writeFile', 'appendFile', 'mkdir', 'rmdir',
    'rm', 'unlink', 'rename', 'copyFile', 'truncate', 'chmod', 'chown', 'link', 'symlink'].map(key => [key, fs[key]]));
  for (const key of ['open', 'lstat', 'realpath', 'opendir']) {
    t.mock.method(fs, key, async (...args) => {
      if (deny(String(args[0]))) throw new Error('private_production_path_must_not_be_read');
      if (key === 'open') {
        assert.equal(args[1], 'r', 'reference integration opens files only for reading');
        await beforeOpen(String(args[0]));
      }
      return originals[key](...args);
    });
  }
  for (const key of ['writeFile', 'appendFile', 'mkdir', 'rmdir', 'rm', 'unlink', 'rename', 'copyFile', 'truncate', 'chmod', 'chown', 'link', 'symlink']) {
    t.mock.method(fs, key, async () => { evidence.nodeFilesystemWriteCalls++; throw new Error('reference_write_forbidden'); });
  }
  return { ...originals, restore: () => t.mock.restoreAll() };
}
function syntheticNative(t, evidence, response = async () => ({ status: 'unverified' }), current = { status: 'unverified' }) {
  t.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    const stdin = new PassThrough(); let text = '';
    stdin.on('data', chunk => { text += chunk; });
    stdin.on('finish', async () => {
      try {
        const request = JSON.parse(text), roles = ['production', 'development'].filter(key => request[key]);
        evidence.requestedNativeRoles.push(roles);
        const result = { schemaVersion: 1, current };
        for (const role of roles) result[role] = await response(role, request[role]);
        callback(null, JSON.stringify(result), '');
      } catch (error) { callback(error, '', ''); }
    });
    return { stdin };
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}
function realNativeSpy(t, evidence) {
  const original = childProcess.execFile;
  t.mock.method(childProcess, 'execFile', (...args) => {
    const child = original(...args), end = child.stdin.end.bind(child.stdin);
    child.stdin.end = (payload, ...rest) => {
      const request = JSON.parse(String(payload));
      evidence.requestedNativeRoles.push(['production', 'development'].filter(key => request[key]));
      return end(payload, ...rest);
    };
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
}
async function inspect(f, client, exchange) {
  return inspectDevRuntimeWithReference(f.dev.configPath, f.planPath, client, exchange);
}
async function control(f, client, exchange, evidence) {
  const report = await inspect(f, client, exchange);
  privateReport(report, f);
  assert.equal(report.productionReference.evidence, 'authenticated-point-in-time');
  assert.equal(report.productionReference.topologyVerified, true);
  assert.equal(report.productionReference.credentialsDistinct, true);
  evidence.unmodifiedControls++;
  return report;
}
function privateReport(report, f) {
  assert.equal(report.qualified, false); assert.equal(report.upstreamEnabled, false);
  assert.equal(report.runningSourceVerified, false); assert.equal(report.routing.liveVerified, false);
  assert.equal(report.routing.oauthGrantsVerified, false);
  const text = JSON.stringify(report);
  for (const value of [f.prod.directory, f.dev.directory, f.plan.production.principalSid,
    f.plan.production.routing.audience, 'test-bearer-not-a-production-token', 'TOP-SECRET-ARBITRARY-COMMAND']) {
    assert.equal(text.includes(JSON.stringify(value).slice(1, -1)), false, 'report keeps private inputs out');
  }
}

test('registered reference Windows integration refuses unsupported platforms before any I/O', { skip: process.platform === 'win32' }, async () => {
  assert.throws(() => createProductionReferenceRegistration({}), { message: 'dev_runtime_platform_unsupported' });
  assert.throws(() => createRegisteredProductionReferenceAuthority({}, {}), { message: 'dev_runtime_platform_unsupported' });
  await assert.rejects(inspectDevRuntimeWithReference('/unused', '/unused', {}, () => {}), { message: 'dev_runtime_platform_unsupported' });
});

test('synthetic reference fingerprints are distinct from the actual private fixture declarations', async t => {
  const f = await runtimeInputs(t), facts = fixtureFacts();
  const declaredStrings = [];
  function collect(value) {
    if (typeof value === 'string') declaredStrings.push(value);
    else if (value && typeof value === 'object') for (const item of Object.values(value)) collect(item);
  }
  collect({ plan: f.plan, production: f.prod.config, development: f.dev.config });
  for (const fingerprint of [facts.productionConfigSha256, facts.productionObservationSha256]) {
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(declaredStrings.includes(fingerprint), false, 'public synthetic fingerprint must not equal a private fixture declaration');
  }
  assert.notEqual(facts.productionConfigSha256, facts.productionObservationSha256);
});

nativeTest('registered reference handles privately pin deep copied configs and plan without writer authority', async (t, evidence) => {
  const f = await runtimeInputs(t), declaration = input(f), registration = createProductionReferenceRegistration(declaration);
  assert.deepEqual(Object.keys(registration).sort(), ['instanceId', 'sha256']);
  assert.ok(Object.isFrozen(registration));
  assert.throws(() => createProductionReferenceRegistration({ ...declaration, id: new String('boxed') }), /runtime_reference_registration_invalid/);
  const same = createProductionReferenceRegistration({ ...declaration });
  assert.equal(same.sha256, registration.sha256);
  assert.throws(() => requireValidatedDevConfig(f.dev.config), /dev_validation_required/);
  const keys = pair(registration);
  assert.throws(() => createRegisteredProductionReferenceAuthority({ ...registration }, keys.privateKey), /runtime_reference_registration_invalid/);
  syntheticNative(t, evidence);
  const authority = createRegisteredProductionReferenceAuthority(registration, keys.privateKey);
  declaration.production.tokenPath = path.join(f.prod.directory, 'unregistered-token');
  declaration.plan.production.routing.backendId = 'mutated-after-registration';
  const watch = watchFilesystem(t, evidence);
  try {
    const report = await control(f, keys.client, authority, evidence);
    assert.equal(report.productionReference.registrationSha256, registration.sha256);
    assert.equal(report.productionReference.topologyVerified, true);
    assert.equal(report.productionReference.credentialsDistinct, true);
    assert.equal(report.productionListener.status, 'unverified');
    privateReport(report, f);
  } finally { watch.restore(); syncBuiltinESMExports(); }
});

nativeTest('restricted reference consumer reads no production paths and requests no production native role', async (t, evidence) => {
  const f = await runtimeInputs(t), registration = createProductionReferenceRegistration(input(f)), keys = pair(registration);
  syntheticNative(t, evidence);
  const authority = syntheticAuthority(registration, keys.privateKey);
  const before = await Promise.all([directorySnapshot(f.prod.directory), directorySnapshot(f.dev.directory)]);
  let forbiddenReads = 0;
  const watch = watchFilesystem(t, evidence, filename => {
    if (filename.toLowerCase().startsWith(f.prod.directory.toLowerCase())) { forbiddenReads++; return true; }
    return false;
  });
  try {
    const report = await control(f, keys.client, authority, evidence);
    assert.equal(forbiddenReads, 0); assert.deepEqual(evidence.requestedNativeRoles, [['development']]);
    assert.equal(report.productionReference.evidence, 'authenticated-point-in-time');
    privateReport(report, f);
  } finally { watch.restore(); syncBuiltinESMExports(); }
  assert.deepEqual(await Promise.all([directorySnapshot(f.prod.directory), directorySnapshot(f.dev.directory)]), before);
  evidence.consumerProductionReads = forbiddenReads;
});

nativeTest('restricted reference treats wrong-account OS profiles as data without looking up production profile paths', async (t, evidence) => {
  const f = await runtimeInputs(t), registration = createProductionReferenceRegistration(input(f)), keys = pair(registration);
  const current = { status: 'observed', sid: f.plan.development.principalSid,
    profileDirectory: await fs.realpath(f.dev.profile), pid: process.pid, creationFileTime: '134385640000000000' };
  syntheticNative(t, evidence, async () => ({ status: 'unverified' }), current);
  t.mock.method(os, 'userInfo', () => ({ homedir: current.profileDirectory }));
  let productionReads = 0;
  const watch = watchFilesystem(t, evidence, filename => {
    if (filename.toLowerCase().startsWith(f.prod.directory.toLowerCase())) { productionReads++; return true; } return false;
  });
  try {
    const baseline = await control(f, keys.client, syntheticAuthority(registration, keys.privateKey), evidence);
    assert.equal(baseline.currentIdentity.status, 'matched');
    current.sid = f.plan.production.principalSid; current.profileDirectory = f.prod.profile;
    const report = await inspect(f, keys.client, syntheticAuthority(registration, keys.privateKey));
    assert.equal(report.currentIdentity.status, 'unverified');
    assert.equal(productionReads, 0); privateReport(report, f);
    evidence.wrongProfileComparedAsData = true;
  } finally { watch.restore(); syncBuiltinESMExports(); }
  evidence.consumerProductionReads = productionReads;
});

nativeTest('registered authority refuses config retargeting after its first config comparison without reading replacement paths', async (t, evidence) => {
  const f = await runtimeInputs(t), registration = createProductionReferenceRegistration(input(f)), keys = pair(registration);
  syntheticNative(t, evidence);
  const authority = createRegisteredProductionReferenceAuthority(registration, keys.privateKey);
  const unregistered = path.join(f.prod.directory, 'private-unregistered-target');
  const originalWrite = fs.writeFile;
  let enabled = false, changed = false, unexpectedReads = 0, attackExchangeCalls = 0;
  const watch = watchFilesystem(t, evidence, filename => {
    if (filename === unregistered) { unexpectedReads++; return true; } return false;
  }, async filename => {
    if (enabled && !changed && filename === f.prod.config.policyPath) {
      changed = true;
      await originalWrite(f.prod.configPath, JSON.stringify({ ...f.prod.config, tokenPath: unregistered }));
    }
  });
  try {
    await control(f, keys.client, authority, evidence);
    enabled = true;
    await assert.rejects(inspect(f, keys.client, (request, options) => {
      attackExchangeCalls++; return authority(request, options);
    }), { message: 'runtime_reference_unverified' });
    assert.equal(changed, true); assert.equal(unexpectedReads, 0);
    assert.equal(attackExchangeCalls, 1);
  } finally { watch.restore(); syncBuiltinESMExports(); }
  evidence.unregisteredPathReads = unexpectedReads;
  evidence.attackExchangeCalls = attackExchangeCalls; evidence.mutationApplied = changed;
});

nativeTest('registered authority refuses actual DEV control drift across production native observation', async (t, evidence) => {
  const f = await runtimeInputs(t), registration = createProductionReferenceRegistration(input(f)), keys = pair(registration);
  const originalWrite = fs.writeFile; let enabled = false, changed = false, attackExchangeCalls = 0;
  syntheticNative(t, evidence, async role => {
    if (enabled && role === 'production') { changed = true; await originalWrite(f.dev.config.policyPath, '{"changed":true}'); }
    return { status: 'unverified' };
  });
  const authority = createRegisteredProductionReferenceAuthority(registration, keys.privateKey);
  const watch = watchFilesystem(t, evidence);
  try {
    await control(f, keys.client, authority, evidence);
    enabled = true;
    await assert.rejects(inspect(f, keys.client, (request, options) => {
      attackExchangeCalls++; return authority(request, options);
    }), { message: 'runtime_reference_unverified' });
    assert.equal(changed, true);
    assert.equal(attackExchangeCalls, 1);
  } finally { watch.restore(); syncBuiltinESMExports(); }
  evidence.attackExchangeCalls = attackExchangeCalls; evidence.mutationApplied = changed;
});

nativeTest('restricted consumer refuses local retargeting after exchange before following substituted controls', async (t, evidence) => {
  const f = await runtimeInputs(t), registration = createProductionReferenceRegistration(input(f)), keys = pair(registration);
  syntheticNative(t, evidence);
  const authority = syntheticAuthority(registration, keys.privateKey);
  const unregistered = path.join(f.dev.config.stateDirectory, 'private-substitute');
  const originalWrite = fs.writeFile; let unexpectedReads = 0, attackExchangeCalls = 0, mutationApplied = false;
  const watch = watchFilesystem(t, evidence, filename => {
    if (filename === unregistered) { unexpectedReads++; return true; } return false;
  });
  try {
    await control(f, keys.client, authority, evidence);
    await assert.rejects(inspect(f, keys.client, async (request, options) => {
      attackExchangeCalls++;
      const result = await authority(request, options);
      await originalWrite(f.dev.configPath, JSON.stringify({ ...f.dev.config, tokenPath: unregistered }));
      mutationApplied = true;
      return result;
    }), { message: 'runtime_reference_unverified' });
    assert.equal(unexpectedReads, 0);
    assert.equal(attackExchangeCalls, 1); assert.equal(mutationApplied, true);
  } finally { watch.restore(); syncBuiltinESMExports(); }
  evidence.unregisteredPathReads = unexpectedReads;
  evidence.attackExchangeCalls = attackExchangeCalls; evidence.mutationApplied = mutationApplied;
});

nativeTest('registered authority compares actual digest-only credentials and never returns credential values', async (t, evidence) => {
  const f = await runtimeInputs(t), registration = createProductionReferenceRegistration(input(f)), keys = pair(registration);
  syntheticNative(t, evidence);
  const authority = createRegisteredProductionReferenceAuthority(registration, keys.privateKey);
  const devOriginal = await fs.readFile(f.dev.config.tokenPath);
  const originalCopy = fs.copyFile, originalWrite = fs.writeFile;
  let phase = 'control';
  const credentialReads = { overlap: { development: 0, production: 0 }, plaintext: { development: 0, production: 0 } };
  const exchanges = { overlap: 0, plaintext: 0 };
  const watch = watchFilesystem(t, evidence, () => false, async filename => {
    if (phase === 'control') return;
    if (filename === f.dev.config.tokenPath) credentialReads[phase].development++;
    if (filename === f.prod.config.tokenPath) credentialReads[phase].production++;
  });
  const exchange = (request, options) => { exchanges[phase]++; return authority(request, options); };
  try {
    await control(f, keys.client, authority, evidence);
    await originalCopy(f.prod.config.tokenPath, f.dev.config.tokenPath);
    phase = 'overlap';
    await assert.rejects(inspect(f, keys.client, exchange), { message: 'runtime_reference_unverified' });
    await originalWrite(f.dev.config.tokenPath, devOriginal);
    await originalWrite(f.prod.config.tokenPath, 'private-plaintext-fixture-0123456789abcdef');
    phase = 'plaintext';
    await assert.rejects(inspect(f, keys.client, exchange), error => {
      assert.equal(error.message, 'runtime_reference_unverified');
      assert.equal(String(error).includes('private-plaintext'), false); return true;
    });
    for (const name of ['overlap', 'plaintext']) {
      assert.equal(exchanges[name], 1);
      assert.ok(credentialReads[name].development > 0 && credentialReads[name].production > 0);
    }
  } finally { watch.restore(); syncBuiltinESMExports(); }
  evidence.credentialAttackExchanges = exchanges;
  evidence.actualCredentialFilesRead = { overlap: true, plaintext: true };
});

nativeTest('restricted reference inputs reject profile junctions and shared entry or control identities before exchange', async (t, evidence) => {
  const f = await runtimeInputs(t), registration = createProductionReferenceRegistration(input(f)), keys = pair(registration);
  syntheticNative(t, evidence);
  const authority = syntheticAuthority(registration, keys.privateKey);
  let calls = 0, rejections = 0;
  const exchange = () => { calls++; throw new Error('must-not-exchange'); };
  const originals = { rmdir: fs.rmdir, symlink: fs.symlink, unlink: fs.unlink, mkdir: fs.mkdir, link: fs.link, writeFile: fs.writeFile };
  const entry = await fs.readFile(f.dev.entryPath);
  const watch = watchFilesystem(t, evidence);
  async function refuses(name) {
    await assert.rejects(inspect(f, keys.client, exchange), { message: 'runtime_reference_unverified' });
    rejections++; evidence.rejectedMutations.push(name);
  }
  evidence.rejectedMutations = [];
  try {
    await control(f, keys.client, authority, evidence);
    await originals.rmdir(f.dev.profile); await originals.symlink(f.prod.profile, f.dev.profile, 'junction');
    await refuses('profile-junction');
    await originals.unlink(f.dev.profile); await originals.mkdir(f.dev.profile);
    await control(f, keys.client, authority, evidence);
    await originals.unlink(f.dev.entryPath); await originals.link(f.prod.entryPath, f.dev.entryPath);
    await refuses('entry-hardlink');
    await originals.unlink(f.dev.entryPath); await originals.writeFile(f.dev.entryPath, entry);
    await control(f, keys.client, authority, evidence);
    const alias = path.join(f.dev.config.stateDirectory, 'linked-token');
    await originals.link(f.dev.config.tokenPath, alias);
    await refuses('control-hardlink');
    await originals.unlink(alias);
    await control(f, keys.client, authority, evidence);
    assert.equal(calls, 0); assert.equal(rejections, 3);
  } finally { watch.restore(); syncBuiltinESMExports(); }
  evidence.exchangeCalls = calls;
});

nativeTest('restricted reference errors omit callback secrets and have no direct-read fallback', async (t, evidence) => {
  const f = await runtimeInputs(t), registration = createProductionReferenceRegistration(input(f)), keys = pair(registration);
  syntheticNative(t, evidence);
  let productionReads = 0, throwingExchangeCalls = 0, invalidClientExchangeCalls = 0;
  const watch = watchFilesystem(t, evidence, filename => {
    if (filename.toLowerCase().startsWith(f.prod.directory.toLowerCase())) { productionReads++; return true; } return false;
  });
  try {
    await control(f, keys.client, syntheticAuthority(registration, keys.privateKey), evidence);
    await assert.rejects(inspect(f, keys.client, () => { throwingExchangeCalls++; throw new Error('PrivateCallbackSecret0123456789'); }), { message: 'runtime_reference_unverified' });
    await assert.rejects(inspect(f, {}, () => { invalidClientExchangeCalls++; throw new Error('must-not-run'); }), { message: 'runtime_reference_unverified' });
    assert.equal(productionReads, 0);
    assert.equal(throwingExchangeCalls, 1); assert.equal(invalidClientExchangeCalls, 0);
  } finally { watch.restore(); syncBuiltinESMExports(); }
  evidence.consumerProductionReads = productionReads;
  evidence.throwingExchangeCalls = throwingExchangeCalls; evidence.invalidClientExchangeCalls = invalidClientExchangeCalls;
});

nativeTest('native restricted reference inspects its own caller and owned DEV listener without production observation or writes', async (t, evidence) => {
  const f = await runtimeInputs(t);
  realNativeSpy(t, evidence);
  const observed = await captureWindowsRuntime();
  assert.equal(observed.current.status, 'observed'); assert.equal(observed.current.pid, process.pid);
  f.plan.development.principalSid = observed.current.sid;
  f.plan.development.profileDirectory = observed.current.profileDirectory;
  // os.tmpdir() may be below the real DEV user's profile. The production role
  // is deliberately synthetic in this consumer-only case: choose an unrelated
  // declaration and prohibit looking it up instead of creating another account.
  f.plan.production.profileDirectory = path.join(path.parse(observed.current.profileDirectory).root,
    'unprovisioned-' + path.basename(f.prod.directory));
  // This inert owned listener never loads manager, SDK, model, or production
  // state. Its literal argv is the evidence under test, not loaded config/source.
  await fs.writeFile(f.dev.entryPath, "import net from 'node:net';\nconst s=net.createServer(c=>c.destroy());\nconst timeout=setTimeout(()=>{s.close();process.stdin.destroy();process.exitCode=2;},45000);\ns.once('close',()=>clearTimeout(timeout));\nprocess.stdin.once('end',()=>s.close());process.stdin.resume();\ns.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({port:s.address().port})+'\\n'));\n");
  const child = childProcess.spawn(process.execPath, [f.dev.entryPath, '--config', f.dev.configPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  t.after(async () => {
    child.stdin.end();
    let timeout;
    try { await Promise.race([exited, new Promise(resolve => { timeout = setTimeout(() => { child.kill(); resolve(); }, 5000); })]); }
    finally { clearTimeout(timeout); }
  });
  let text = '';
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.on('data', bytes => { text += bytes; if (text.includes('\n')) resolve(JSON.parse(text.split('\n')[0])); });
    child.once('exit', () => reject(new Error('owned_listener_exited_before_ready')));
  });
  const { port } = await ready;
  f.dev.config.instance.port = port; f.plan.development.manager.port = port;
  f.plan.development.routing.originHostHeader = '127.0.0.1:' + port;
  await f.saveConfig(); await f.savePlan();
  const registration = createProductionReferenceRegistration(input(f)), keys = pair(registration);
  const before = await Promise.all([directorySnapshot(f.prod.directory), directorySnapshot(f.dev.directory)]);
  let productionReads = 0;
  const watch = watchFilesystem(t, evidence, filename => {
    if ([f.prod.directory, f.plan.production.profileDirectory].some(root => filename.toLowerCase().startsWith(root.toLowerCase()))) { productionReads++; return true; } return false;
  });
  try {
    const report = await control(f, keys.client, syntheticAuthority(registration, keys.privateKey), evidence);
    assert.equal(report.currentIdentity.status, 'matched');
    assert.equal(report.developmentListener.status, 'matched');
    assert.deepEqual(evidence.requestedNativeRoles, [[], ['development']]);
    assert.equal(productionReads, 0); privateReport(report, f);
    evidence.realNative = true;
    evidence.productionAuthority = 'synthetic; production is not observed by this case';
    evidence.currentPidMatched = true;
    evidence.ownedDevListenerMatched = true;
    evidence.consumerProductionReads = productionReads;
  } finally { watch.restore(); syncBuiltinESMExports(); child.stdin.end(); await exited; }
  assert.deepEqual(await Promise.all([directorySnapshot(f.prod.directory), directorySnapshot(f.dev.directory)]), before);
});

nativeTest('registered reference binds differing declared and canonical config spellings to the same actual file identity', async (t, evidence) => {
  const f = await runtimeInputs(t), registration = createProductionReferenceRegistration(input(f)), keys = pair(registration);
  const declared = f.dev.configPath;
  const physical = path.join(f.dev.config.stateDirectory, 'canonical-manager-control.json');
  await fs.rename(declared, physical);
  const canonicalFilename = await fs.realpath(physical);
  assert.notEqual(windowsPath(declared), windowsPath(canonicalFilename),
    'the alias difference must survive case and dot normalization');
  // Deterministic ordinary-alias decision fixture. The file, handle, inode and
  // metadata are real Windows files; only resolution of selected spellings is
  // mapped. This is not a claim that native 8.3 allocation is enabled.
  let aliasHandleOpens = 0;
  const originals = { rename: fs.rename, mkdir: fs.mkdir, rmdir: fs.rmdir, realpath: fs.realpath };
  const aliases = new Map([[windowsPath(declared), physical]]);
  let attackAlias, attackAliasRead = false;
  for (const method of ['lstat', 'realpath', 'open']) {
    const original = fs[method];
    t.mock.method(fs, method, (filename, ...rest) => {
      const key = windowsPath(String(filename));
      const target = aliases.get(key);
      if (target && method === 'open') {
        if (key === windowsPath(declared)) aliasHandleOpens++;
        if (key === attackAlias) attackAliasRead = true;
      }
      return original(target ?? filename, ...rest);
    });
  }
  syntheticNative(t, evidence);
  const authority = createRegisteredProductionReferenceAuthority(registration, keys.privateKey);
  const watch = watchFilesystem(t, evidence);
  let attackExchanges = 0, placementCasesRead = 0;
  const rejectedPlacements = [];
  try {
    const throughAlias = await stableFileSnapshot(declared, 16384);
    const throughCanonical = await stableFileSnapshot(canonicalFilename, 16384);
    assert.deepEqual(throughAlias.identity, throughCanonical.identity);
    assert.deepEqual(throughAlias.bytes, throughCanonical.bytes);
    await control(f, keys.client, authority, evidence);
    assert.ok(aliasHandleOpens >= 5, 'both consumer and authority must read the registered alias repeatedly');
    // One reserved-name case for each control role, plus a nested config target.
    // Every relocation preserves file identity/content, reaches the alias read,
    // refuses before exchange, then restores and completes the full valid path.
    for (const [name, alias, targetName] of [
      ['config-reserved', declared, 'toolkit.json'],
      ['config-nested', declared, 'nested-control/manager.json'],
      ['policy-reserved', f.dev.config.policyPath, 'admission.sqlite'],
      ['token-reserved', f.dev.config.tokenPath, 'manager-owner.lock'],
      ['inventory-reserved', f.dev.config.inventoryPath, 'deployment.json'],
    ]) {
      const key = windowsPath(alias), previous = aliases.get(key), previousFile = previous ?? alias;
      const target = path.join(f.dev.config.stateDirectory, ...targetName.split('/'));
      const nested = targetName.includes('/');
      const baseline = await stableFileSnapshot(alias, 65536);
      if (nested) await originals.mkdir(path.dirname(target));
      await originals.rename(previousFile, target);
      aliases.set(key, target);
      try {
        const changed = await stableFileSnapshot(alias, 65536);
        assert.equal(changed.identity.filename, windowsPath(await originals.realpath(target)));
        for (const field of ['dev', 'ino', 'nlink', 'size']) assert.equal(changed.identity[field], baseline.identity[field]);
        assert.deepEqual(changed.bytes, baseline.bytes);
        const rolesBefore = evidence.requestedNativeRoles.length;
        attackAlias = key; attackAliasRead = false;
        await assert.rejects(inspect(f, keys.client, () => {
          attackExchanges++; throw new Error('canonical_placement_must_precede_exchange');
        }), { message: 'runtime_reference_unverified' });
        assert.equal(attackAliasRead, true, 'the rejected inspection must read the relocated alias');
        assert.equal(evidence.requestedNativeRoles.length, rolesBefore, 'canonical placement refuses before native observation');
        placementCasesRead++; rejectedPlacements.push(name);
      } finally {
        attackAlias = undefined;
        await originals.rename(target, previousFile);
        if (previous === undefined) aliases.delete(key); else aliases.set(key, previous);
        if (nested) await originals.rmdir(path.dirname(target));
      }
      await control(f, keys.client, authority, evidence);
    }
    assert.equal(attackExchanges, 0); assert.equal(placementCasesRead, 5);
    assert.deepEqual(evidence.requestedNativeRoles, Array.from({ length: 6 }, () => [['development'], ['production']]).flat());
  } finally { watch.restore(); syncBuiltinESMExports(); }
  evidence.canonicalAliasFixture = 'controlled filesystem alias; not a native 8.3 allocation';
  evidence.declaredCanonicalDifferent = true;
  evidence.actualFileIdentityEqual = true;
  evidence.aliasHandleOpens = aliasHandleOpens;
  evidence.canonicalPlacementRejections = rejectedPlacements;
  evidence.canonicalPlacementAttackExchanges = attackExchanges;
  evidence.canonicalPlacementCasesRead = placementCasesRead;
});

after(async () => {
  if (process.platform !== 'win32') return;
  const sourceSha256 = {};
  for (const file of ['dev-runtime-reference.mjs', 'runtime-files.mjs', 'dev-runtime.mjs', 'production-reference.mjs', 'runtime-identity.mjs']) {
    sourceSha256['lib/' + file] = createHash('sha256').update(await fs.readFile(new URL('../lib/' + file, import.meta.url))).digest('hex');
  }
  sourceSha256['test/dev-runtime-reference.test.mjs'] = hash(await fs.readFile(new URL('./dev-runtime-reference.test.mjs', import.meta.url)));
  sourceSha256['windows-runtime-probe.ps1'] = hash(await fs.readFile(new URL('../windows-runtime-probe.ps1', import.meta.url)));
  console.log('MTERM_DEV_REFERENCE_NATIVE_EVIDENCE ' + JSON.stringify({ schemaVersion: 1,
    scope: 'disposable hosted Windows source qualification; no deployment or account-isolation claim',
    nativeCaseTitles: cases, completedCases: completed, sourceSha256,
    writeObservationScope: 'Integration fs/promises calls; excludes fixture setup/drift and native compiler temporary activity',
    nativeCompilerTemporaryActivityNotExcluded: true, productionListenerLiveProbes: 0,
    activationAuthorized: false, qualified: false, upstreamEnabled: false }));
});
