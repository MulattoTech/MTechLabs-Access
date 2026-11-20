import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateConfig } from './config.mjs';
import { ordinaryPath } from './dev-instance.mjs';
import { evaluateRuntime, validateRuntimePlan, windowsPath, profileOverlap } from './dev-runtime-plan.mjs';
import { captureWindowsRuntime } from './runtime-identity.mjs';
import { fileIdentity, stableFileSnapshot } from './runtime-files.mjs';
import { createProductionReferenceAuthority, requestProductionReference,
  getProductionReferenceFacts, productionControlCommitment } from './production-reference.mjs';

const registrations = new WeakMap();
const CONTROL_KEYS = ['policyPath', 'tokenPath', 'inventoryPath'];
const RUNTIME_KEYS = ['nodePath', 'serverPath', 'serverPackageJsonPath'];
const RESERVED = new Set(['toolkit.json', 'toolkit-jobs.sqlite', 'toolkit-jobs.sqlite-wal',
  'toolkit-jobs.sqlite-shm', 'admission.sqlite', 'admission.sqlite-wal', 'admission.sqlite-shm',
  'deployment.json', 'instances', 'dev-runtime-plan.json', 'manager-owner.lock']);
const fail = () => { throw new Error('runtime_reference_unverified'); };
const hash = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function immutable(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); }
  return value;
}
const copy = value => JSON.parse(JSON.stringify(value));
const samePath = (a, b) => windowsPath(a) === windowsPath(b);
const within = (parent, child) => {
  const relative = path.win32.relative(windowsPath(parent), windowsPath(child));
  return relative === '' || (!path.win32.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\'));
};
const overlap = (a, b) => within(a, b) || within(b, a);
function supported() {
  if (process.platform !== 'win32') throw new Error('dev_runtime_platform_unsupported');
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH) throw new Error('node_preload_environment_rejected');
}
function checkSignal(signal) { if (signal?.aborted) fail(); }
function json(snapshot) { return JSON.parse(snapshot.bytes.toString('utf8').replace(/^\uFEFF/, '')); }
function token(snapshot) {
  const value = snapshot.bytes.toString('utf8').trim();
  if (!/^sha256:[a-fA-F0-9]{64}$/.test(value)) fail();
  return Buffer.from(value.slice(7), 'hex');
}
function distinct(files) {
  if (new Set(files.map(file => windowsPath(file.filename))).size !== files.length ||
      new Set(files.map(file => file.stat.dev + ':' + file.stat.ino)).size !== files.length ||
      files.some(file => file.stat.nlink !== 1n)) fail();
}
async function actual(filename, directory = false) {
  const result = await ordinaryPath(filename, directory);
  if (!directory && result.stat.nlink !== 1n) fail();
  return { ...result, identity: fileIdentity(result) };
}

// A bounded metadata walk. Contents outside the five selected DEV control
// files are never read; links, shared files and excessive trees are refused.
async function stateTopology(directory, signal) {
  let count = 0;
  const records = [];
  async function walk(root, depth) {
    checkSignal(signal);
    if (depth > 8) fail();
    const entries = await fs.opendir(root);
    for await (const entry of entries) {
      checkSignal(signal);
      if (++count > 4096) fail();
      const filename = path.join(root, entry.name);
      const stat = await fs.lstat(filename, { bigint: true });
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1n))) fail();
      records.push(fileIdentity({ filename, stat }));
      if (stat.isDirectory()) await walk(filename, depth + 1);
    }
  }
  await walk(directory, 0);
  return records.sort((a, b) => a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0);
}

function localDeclarations(config, plan, configPath, planPath) {
  if (!config.instance || config.instance.id !== plan.instanceId || config.instance.port !== plan.development.manager.port ||
      !samePath(configPath, plan.development.manager.configPath) ||
      !samePath(planPath, path.join(config.stateDirectory, 'dev-runtime-plan.json')) ||
      !samePath(config.instance.productionConfigPath, plan.production.manager.configPath)) fail();
  // Reject obvious overlaps before following any DEV-config-derived paths.
  for (const file of [configPath, ...CONTROL_KEYS.map(key => config[key])]) {
    const relative = path.win32.relative(windowsPath(config.stateDirectory), windowsPath(file));
    if (!within(config.stateDirectory, file) || relative.includes('\\') || !relative || RESERVED.has(relative)) fail();
  }
  for (const file of [plan.production.manager.configPath, plan.production.manager.entryPath,
    ...RUNTIME_KEYS.map(key => config[key]), plan.development.manager.nodePath, plan.development.manager.entryPath]) {
    if (overlap(config.stateDirectory, file)) fail();
  }
  if (profileOverlap(plan.production.profileDirectory, plan.development.profileDirectory)) fail();
}

async function devSnapshot(configPath, planPath, expected, signal) {
  checkSignal(signal);
  const own = await stableFileSnapshot(configPath, 16384);
  const selected = await stableFileSnapshot(planPath, 16384);
  const readConfig = validateConfig(json(own)), readPlan = validateRuntimePlan(json(selected));
  if (expected && (!isDeepStrictEqual(readConfig, expected.development) || !isDeepStrictEqual(readPlan, expected.plan))) fail();
  // An authority always follows its registered objects, never a freshly read
  // object's paths, including after a successful comparison with that object.
  const config = expected?.development ?? readConfig, plan = expected?.plan ?? readPlan;
  localDeclarations(config, plan, configPath, planPath);
  const state = await actual(config.stateDirectory, true);
  const profile = await actual(plan.development.profileDirectory, true);
  const controls = [own, selected];
  for (const [key, limit] of [['policyPath', 4096], ['tokenPath', 1024], ['inventoryPath', 65536]]) {
    checkSignal(signal);
    controls.push(await stableFileSnapshot(config[key], limit));
  }
  distinct(controls);
  for (const file of controls) {
    if (!within(state.filename, file.filename)) fail();
  }
  if (!samePath(selected.filename, path.join(state.filename, 'dev-runtime-plan.json'))) fail();
  const manager = {};
  for (const key of ['nodePath', 'entryPath', 'configPath']) {
    checkSignal(signal);
    manager[key] = await actual(plan.development.manager[key]);
    if (key !== 'configPath' && overlap(state.filename, manager[key].filename)) fail();
  }
  // Compare independently resolved identities, not a canonical filename with
  // an unexpanded declaration (ordinary Windows TEMP may use an 8.3 name).
  // Retain every identity/drift field; an alias must resolve to this exact file.
  if (canonical(own.identity) !== canonical(manager.configPath.identity)) fail();
  distinct([manager.entryPath, own]);
  const runtime = [];
  for (const key of RUNTIME_KEYS) {
    const file = await actual(config[key]);
    if (overlap(state.filename, file.filename)) fail();
    runtime.push(file.identity);
  }
  const topology = await stateTopology(state.filename, signal);
  const privateSnapshot = { controls: controls.map(file => ({ identity: file.identity, sha256: file.sha256 })),
    state: state.identity, profile: profile.identity, manager: Object.fromEntries(Object.entries(manager).map(([k, v]) => [k, v.identity])),
    runtime, topology };
  const canonicalPlan = validateRuntimePlan({ ...plan, development: { ...plan.development,
    profileDirectory: profile.filename, manager: { ...plan.development.manager,
      ...Object.fromEntries(Object.entries(manager).map(([key, value]) => [key, value.filename])) } } });
  return { config, plan: canonicalPlan, declaredPlan: plan, own, selected, controls, state, profile, manager,
    controlSnapshot: hash(canonical(privateSnapshot)), credential: token(controls[3]) };
}

/** Called only by trusted bootstrap. The handle is not proof of deployment ACLs. */
export function createProductionReferenceRegistration(input) {
  supported();
  try {
    if (!input || Object.keys(input).sort().join(',') !==
      'development,developmentConfigPath,generation,id,plan,planPath,production,productionConfigPath' ||
      typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.id) || !Number.isSafeInteger(input.generation) || input.generation < 1) fail();
    const production = validateConfig(copy(input.production)), development = validateConfig(copy(input.development));
    const plan = validateRuntimePlan(copy(input.plan));
    if (production.instance || !development.instance) fail();
    const registered = immutable({ id: input.id, generation: input.generation,
      productionConfigPath: input.productionConfigPath, developmentConfigPath: input.developmentConfigPath,
      planPath: input.planPath, production, development, plan });
    for (const file of [registered.productionConfigPath, registered.developmentConfigPath, registered.planPath,
      ...[production, development].flatMap(config => [...RUNTIME_KEYS, 'stateDirectory', ...CONTROL_KEYS].map(key => config[key]))]) windowsPath(file);
    if (!samePath(registered.productionConfigPath, plan.production.manager.configPath) ||
        !samePath(registered.productionConfigPath, development.instance.productionConfigPath)) fail();
    localDeclarations(development, plan, registered.developmentConfigPath, registered.planPath);
    const handle = Object.freeze({ sha256: hash(canonical(registered)), instanceId: plan.instanceId });
    registrations.set(handle, registered);
    return handle;
  } catch { throw new Error('runtime_reference_registration_invalid'); }
}

async function authoritySnapshot(registration, signal) {
  checkSignal(signal);
  const productionConfig = await stableFileSnapshot(registration.productionConfigPath, 16384);
  if (!isDeepStrictEqual(validateConfig(json(productionConfig)), registration.production)) fail();
  const dev = await devSnapshot(registration.developmentConfigPath, registration.planPath, registration, signal);
  const prod = registration.production;
  const state = await actual(prod.stateDirectory, true);
  const profile = await actual(registration.plan.production.profileDirectory, true);
  if (overlap(state.filename, dev.state.filename) || profileOverlap(profile.filename, dev.profile.filename)) fail();
  const controls = [productionConfig];
  for (const [key, limit] of [['policyPath', 4096], ['tokenPath', 1024], ['inventoryPath', 65536]]) {
    checkSignal(signal);
    controls.push(await stableFileSnapshot(prod[key], limit));
  }
  distinct([...dev.controls, ...controls]);
  const manager = {};
  for (const key of ['nodePath', 'entryPath', 'configPath']) manager[key] = await actual(registration.plan.production.manager[key]);
  distinct([manager.entryPath, manager.configPath, dev.manager.entryPath, dev.manager.configPath]);
  const runtime = [];
  for (const file of [...controls, ...Object.values(manager)]) if (overlap(dev.state.filename, file.filename)) fail();
  for (const key of RUNTIME_KEYS) {
    const file = await actual(prod[key]);
    if (overlap(dev.state.filename, file.filename)) fail();
    runtime.push(file.identity);
  }
  if (timingSafeEqual(dev.credential, token(controls[2]))) fail();
  const snapshot = hash(canonical({ dev: dev.controlSnapshot,
    production: { controls: controls.map(file => ({ identity: file.identity, sha256: file.sha256 })), state: state.identity,
      profile: profile.identity, manager: Object.fromEntries(Object.entries(manager).map(([k, v]) => [k, v.identity])), runtime } }));
  return { dev, productionConfig, snapshot,
    plan: validateRuntimePlan({ ...dev.plan, production: { ...registration.plan.production, profileDirectory: profile.filename,
      manager: { ...registration.plan.production.manager,
        ...Object.fromEntries(Object.entries(manager).map(([key, value]) => [key, value.filename])) } } }) };
}

export function createRegisteredProductionReferenceAuthority(handle, privateKey, options = {}) {
  supported();
  const registration = registrations.get(handle);
  if (!registration || !options || Object.keys(options).some(key => key !== 'clock')) throw new Error('runtime_reference_registration_invalid');
  return createProductionReferenceAuthority({ privateKey, registrationSha256: handle.sha256, instanceId: handle.instanceId,
    ...(options.clock ? { clock: options.clock } : {}), observe: async (request, { signal }) => {
      try {
        const before = await authoritySnapshot(registration, signal);
        if (request.configSha256 !== before.dev.own.sha256 || request.planSha256 !== before.dev.selected.sha256 ||
            request.controlsSha256 !== productionControlCommitment(request.nonce, before.dev.controlSnapshot)) fail();
        checkSignal(signal);
        const observation = await captureWindowsRuntime({ production: before.plan.production.manager });
        checkSignal(signal);
        const after = await authoritySnapshot(registration, signal);
        if (before.snapshot !== after.snapshot) fail();
        const productionListener = evaluateRuntime(before.plan, { production: observation.production }).productionListener.status;
        return { productionConfigSha256: before.productionConfig.sha256,
          productionObservationSha256: hash(canonical(observation.production ?? { status: 'unverified' })),
          productionListener, topologyVerified: true, credentialsDistinct: true };
      } catch { throw new Error('runtime_reference_unverified'); }
    } });
}

/** Restricted read-only path. It never grants the writer's validated/owned proof. */
export async function inspectDevRuntimeWithReference(configPath, planPath, referenceClient, exchange) {
  supported();
  try {
    const before = await devSnapshot(configPath, planPath);
    if (!samePath(before.plan.development.manager.nodePath, (await actual(process.execPath)).filename)) fail();
    const observations = await captureWindowsRuntime({ development: before.plan.development.manager });
    // OS-returned profile strings are comparison data only. Even when invoked
    // under the wrong account, they never become additional filesystem targets.
    if (observations.current?.status === 'observed') {
      try {
        if (!samePath(os.userInfo().homedir, before.profile.filename) ||
            !samePath(observations.current.profileDirectory, before.profile.filename)) observations.current = { status: 'unverified' };
        else observations.current.profileDirectory = before.profile.filename;
      } catch { observations.current = { status: 'unverified' }; }
    }
    const proof = await requestProductionReference(referenceClient, { configSha256: before.own.sha256,
      planSha256: before.selected.sha256, controlSnapshot: before.controlSnapshot }, exchange);
    const after = await devSnapshot(configPath, planPath, { development: before.config, plan: before.declaredPlan });
    if (before.controlSnapshot !== after.controlSnapshot) fail();
    const reference = getProductionReferenceFacts(proof);
    const report = evaluateRuntime(before.plan, observations, process.env);
    report.productionListener = { status: reference.productionListener };
    report.reasons = report.reasons.filter(reason => !reason.startsWith('production_listener_'));
    if (report.productionListener.status !== 'matched') report.reasons.push('production_listener_' + report.productionListener.status);
    return { ...report, fingerprints: { evidence: 'current-file-snapshots-and-authenticated-reference',
      config: before.own.sha256, plan: before.selected.sha256, productionConfig: reference.productionConfigSha256 },
      productionReference: { evidence: 'authenticated-point-in-time', registrationSha256: reference.registrationSha256,
        referenceSha256: reference.referenceSha256, observedFrom: reference.observedFrom,
        observedThrough: reference.observedThrough, expiresAt: reference.expiresAt,
        productionObservationSha256: reference.productionObservationSha256,
        topologyVerified: reference.topologyVerified, credentialsDistinct: reference.credentialsDistinct } };
  } catch { throw new Error('runtime_reference_unverified'); }
}
