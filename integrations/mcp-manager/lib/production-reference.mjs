import { createHash, KeyObject, randomBytes, sign, verify } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const PRODUCTION_REFERENCE_MAX_AGE_MS = 30000;
const MAX_PENDING = 8;
const MAX_NONCES = 64;
const REQUEST_LIMIT = 2048;
const ENVELOPE_LIMIT = 8192;
const SIGNING_DOMAIN = Buffer.from('MTerm-CLI production reference v1\n');
const HASH = /^[a-f0-9]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const clients = new WeakMap();
const proofs = new WeakMap();
const authorities = new WeakMap();
const ERROR_CODES = new Set(['invalid_production_reference', 'runtime_reference_required',
  'runtime_reference_untrusted', 'runtime_reference_mismatch', 'runtime_reference_expired',
  'runtime_reference_replayed', 'runtime_reference_busy', 'runtime_reference_unavailable',
  'runtime_reference_clock_unverified']);

class ReferenceFault extends Error {}
const fail = (code = 'invalid_production_reference') => { throw new ReferenceFault(code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const safe = error => {
  let message;
  try { message = error instanceof ReferenceFault ? Object.getOwnPropertyDescriptor(error, 'message')?.value : undefined; }
  catch { /* Rejected callback values may themselves have hostile proxy traps. */ }
  return new ReferenceFault(ERROR_CODES.has(message) ? message : 'runtime_reference_unavailable');
};

function record(value, keys, optional = []) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
        Object.getOwnPropertySymbols(value).length) fail();
    const fields = Object.getOwnPropertyDescriptors(value);
    if (keys.some(key => !Object.hasOwn(fields, key)) ||
        Object.keys(fields).some(key => ![...keys, ...optional].includes(key) ||
          !Object.hasOwn(fields[key], 'value') || !fields[key].enumerable)) fail();
  } catch { fail(); }
}
const hex = value => typeof value === 'string' && HASH.test(value);
const instance = value => typeof value === 'string' && value.length <= 48 && /^dev(?:-[a-z0-9]+)*$/.test(value);
const time = value => Number.isSafeInteger(value) && value >= 0;

function clockFrom(input) {
  if (input === undefined) return Object.freeze({ wall: Date.now, monotonic: () => performance.now() });
  record(input, ['wall', 'monotonic']);
  if (typeof input.wall !== 'function' || typeof input.monotonic !== 'function') fail();
  return Object.freeze({ wall: input.wall, monotonic: input.monotonic });
}
function now(clock) {
  try {
    const wall = clock.wall(), monotonic = clock.monotonic();
    if (!time(wall) || !Number.isFinite(monotonic) || monotonic < 0 || monotonic > Number.MAX_SAFE_INTEGER) {
      fail('runtime_reference_clock_unverified');
    }
    return { wall, monotonic };
  } catch { fail('runtime_reference_clock_unverified'); }
}
function fresh(clock, start, expiresAt, lastMonotonic = start.monotonic) {
  const current = now(clock);
  if (current.monotonic < lastMonotonic || current.monotonic < start.monotonic) {
    fail('runtime_reference_clock_unverified');
  }
  if (current.wall < start.wall || current.wall >= expiresAt ||
      current.monotonic - start.monotonic >= expiresAt - start.wall) fail('runtime_reference_expired');
  return current;
}
function key(value, type) {
  try {
    if (!(value instanceof KeyObject) || value.type !== type || value.asymmetricKeyType !== 'ed25519') fail();
    return value;
  } catch { fail(); }
}
function textJson(input, maximum) {
  if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > maximum) fail();
  try { return JSON.parse(input); } catch { fail(); }
}
function canonical(input, value) {
  if (JSON.stringify(value) !== input) fail();
  return Object.freeze(value);
}
function base64(value, maximum, length) {
  if (typeof value !== 'string' || value.length > maximum || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || (length !== undefined && bytes.length !== length)) fail();
  return bytes;
}
function validateRequest(input) {
  const value = textJson(input, REQUEST_LIMIT);
  record(value, ['schemaVersion', 'purpose', 'registrationSha256', 'instanceId', 'nonce',
    'issuedAt', 'expiresAt', 'configSha256', 'planSha256', 'controlsSha256']);
  if (value.schemaVersion !== 1 || value.purpose !== 'mterm-dev-production-reference' ||
      !hex(value.registrationSha256) || !instance(value.instanceId) ||
      typeof value.nonce !== 'string' || !NONCE.test(value.nonce) ||
      !time(value.issuedAt) || !time(value.expiresAt) || value.expiresAt <= value.issuedAt ||
      value.expiresAt - value.issuedAt > PRODUCTION_REFERENCE_MAX_AGE_MS ||
      !hex(value.configSha256) || !hex(value.planSha256) || !hex(value.controlsSha256)) fail();
  base64(value.nonce, 43, 32);
  return canonical(input, {
    schemaVersion: 1, purpose: value.purpose, registrationSha256: value.registrationSha256,
    instanceId: value.instanceId, nonce: value.nonce, issuedAt: value.issuedAt, expiresAt: value.expiresAt,
    configSha256: value.configSha256, planSha256: value.planSha256, controlsSha256: value.controlsSha256,
  });
}
function facts(value) {
  record(value, ['productionConfigSha256', 'productionObservationSha256', 'productionListener',
    'topologyVerified', 'credentialsDistinct']);
  if (!hex(value.productionConfigSha256) || !hex(value.productionObservationSha256) ||
      !['matched', 'mismatched', 'absent', 'unverified'].includes(value.productionListener) ||
      value.topologyVerified !== true || value.credentialsDistinct !== true) fail();
  return Object.freeze({ productionConfigSha256: value.productionConfigSha256,
    productionObservationSha256: value.productionObservationSha256, productionListener: value.productionListener,
    topologyVerified: true, credentialsDistinct: true });
}

// The stable aggregate stays inside each observation context. Only its nonce-bound
// commitment crosses the reference interface; no individual credential hash does.
export function productionControlCommitment(nonce, controlSnapshot) {
  if (typeof nonce !== 'string' || !NONCE.test(nonce) || !hex(controlSnapshot)) fail();
  base64(nonce, 43, 32);
  return hash('MTerm-CLI DEV controls v1\n' + nonce + '\n' + controlSnapshot);
}

function signalOption(options) {
  try {
    record(options, [], ['signal']);
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) fail();
    if (options.signal?.aborted) fail('runtime_reference_unavailable');
    return options.signal;
  } catch (error) { throw safe(error); }
}

// A timed-out caller does not release the concurrency slot for a callback that
// ignores cancellation. Only actual callback settlement invokes onSettled.
async function boundedCall(operation, milliseconds, externalSignal, onSettled) {
  const controller = new AbortController();
  let timer, rejectStopped;
  const stopped = new Promise((resolve, reject) => { rejectStopped = reject; });
  const cancel = code => {
    controller.abort();
    rejectStopped(new ReferenceFault(code));
  };
  const aborted = () => cancel('runtime_reference_unavailable');
  if (externalSignal) externalSignal.addEventListener('abort', aborted, { once: true });
  if (externalSignal?.aborted) aborted();
  timer = setTimeout(() => cancel('runtime_reference_expired'), Math.max(1, milliseconds));
  const work = Promise.resolve().then(() => {
    if (controller.signal.aborted) fail('runtime_reference_unavailable');
    return operation(controller.signal);
  });
  work.then(onSettled, onSettled);
  try { return await Promise.race([work, stopped]); }
  catch (error) { throw safe(error); }
  finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', aborted);
    controller.abort();
  }
}

// Trusted owner bootstrap supplies the signing key and a fixed registered-target
// observer. This function exposes no transport and does not authenticate requesters.
export function createProductionReferenceAuthority(options) {
  record(options, ['privateKey', 'registrationSha256', 'instanceId', 'observe'], ['clock']);
  const privateKey = key(options.privateKey, 'private');
  if (!hex(options.registrationSha256) || !instance(options.instanceId) || typeof options.observe !== 'function') fail();
  const registrationSha256 = options.registrationSha256, instanceId = options.instanceId;
  const observe = options.observe, clock = clockFrom(options.clock);
  const nonces = new Map();
  let active = 0;
  let idlePromise, resolveIdle;
  const authority = async function authority(input, requestOptions = {}) {
    const externalSignal = signalOption(requestOptions);
    const request = validateRequest(input);
    if (request.registrationSha256 !== registrationSha256 || request.instanceId !== instanceId) {
      fail('runtime_reference_mismatch');
    }
    const start = now(clock);
    if (start.wall < request.issuedAt || start.wall >= request.expiresAt) fail('runtime_reference_expired');
    if (start.monotonic + request.expiresAt - start.wall > Number.MAX_SAFE_INTEGER) {
      fail('runtime_reference_clock_unverified');
    }
    for (const [nonce, entry] of nonces) {
      if (!entry.pending && start.monotonic >= entry.monotonicDeadline) nonces.delete(nonce);
    }
    if (nonces.has(request.nonce)) fail('runtime_reference_replayed');
    if (active >= MAX_PENDING || nonces.size >= MAX_NONCES) fail('runtime_reference_busy');
    const entry = { pending: true, monotonicDeadline: start.monotonic + request.expiresAt - start.wall };
    nonces.set(request.nonce, entry);
    active++;
    try {
      const result = await boundedCall(signal => observe(request, { signal }), request.expiresAt - start.wall,
        externalSignal, () => {
          entry.pending = false; active--;
          if (active === 0 && resolveIdle) {
            const resolve = resolveIdle; resolveIdle = undefined; idlePromise = undefined; resolve();
          }
        });
      const observation = facts(result);
      const end = fresh(clock, start, request.expiresAt);
      const payload = JSON.stringify({ schemaVersion: 1, purpose: 'mterm-dev-production-observation',
        registrationSha256, requestSha256: hash(input), observedFrom: start.wall, observedThrough: end.wall,
        expiresAt: request.expiresAt, facts: observation });
      const bytes = Buffer.from(payload);
      const signature = sign(null, Buffer.concat([SIGNING_DOMAIN, bytes]), privateKey);
      fresh(clock, start, request.expiresAt, end.monotonic);
      return JSON.stringify({ schemaVersion: 1, payload: bytes.toString('base64url'), signature: signature.toString('base64url') });
    } catch (error) { throw safe(error); }
  };
  authorities.set(authority, () => {
    if (active === 0) return Promise.resolve();
    if (!idlePromise) idlePromise = new Promise(resolve => { resolveIdle = resolve; });
    return idlePromise;
  });
  return authority;
}

// This observes current idle state; callers must close admission first when
// using it as a shutdown barrier. Public abort/timeout does not settle observe.
export function waitForProductionReferenceAuthorityIdle(authority) {
  const idle = authorities.get(authority);
  if (!idle) fail('runtime_reference_required');
  return idle();
}

export function createProductionReferenceClient(options) {
  record(options, ['publicKey', 'registrationSha256', 'instanceId'], ['clock']);
  const publicKey = key(options.publicKey, 'public');
  if (!hex(options.registrationSha256) || !instance(options.instanceId)) fail();
  const client = Object.freeze(Object.create(null));
  clients.set(client, { publicKey, registrationSha256: options.registrationSha256,
    instanceId: options.instanceId, clock: clockFrom(options.clock), active: 0 });
  return client;
}

function verifyEnvelope(input, client, requestText, request, start) {
  fresh(client.clock, start, request.expiresAt);
  const envelope = textJson(input, ENVELOPE_LIMIT);
  record(envelope, ['schemaVersion', 'payload', 'signature']);
  if (envelope.schemaVersion !== 1) fail();
  canonical(input, { schemaVersion: 1, payload: envelope.payload, signature: envelope.signature });
  const payloadBytes = base64(envelope.payload, 4096), signature = base64(envelope.signature, 86, 64);
  if (!verify(null, Buffer.concat([SIGNING_DOMAIN, payloadBytes]), client.publicKey, signature)) {
    fail('runtime_reference_untrusted');
  }
  let payloadText;
  try { payloadText = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes); } catch { fail(); }
  const payload = textJson(payloadText, 2048);
  record(payload, ['schemaVersion', 'purpose', 'registrationSha256', 'requestSha256',
    'observedFrom', 'observedThrough', 'expiresAt', 'facts']);
  if (payload.schemaVersion !== 1 || payload.purpose !== 'mterm-dev-production-observation' ||
      !hex(payload.registrationSha256) || !hex(payload.requestSha256) ||
      !time(payload.observedFrom) || !time(payload.observedThrough) || !time(payload.expiresAt)) fail();
  const observation = facts(payload.facts);
  canonical(payloadText, { schemaVersion: 1, purpose: payload.purpose, registrationSha256: payload.registrationSha256,
    requestSha256: payload.requestSha256, observedFrom: payload.observedFrom, observedThrough: payload.observedThrough,
    expiresAt: payload.expiresAt, facts: observation });
  if (payload.registrationSha256 !== client.registrationSha256 || payload.requestSha256 !== hash(requestText)) {
    fail('runtime_reference_mismatch');
  }
  const current = fresh(client.clock, start, request.expiresAt);
  if (payload.expiresAt !== request.expiresAt || payload.observedFrom < request.issuedAt ||
      payload.observedThrough < payload.observedFrom || payload.observedThrough >= payload.expiresAt ||
      payload.observedThrough > current.wall) fail('runtime_reference_expired');
  const proof = Object.freeze(Object.create(null));
  proofs.set(proof, { valid: true, clock: client.clock, start, lastMonotonic: current.monotonic,
    facts: Object.freeze({ ...observation, registrationSha256: client.registrationSha256,
      referenceSha256: hash(input), observedFrom: payload.observedFrom, observedThrough: payload.observedThrough,
      expiresAt: payload.expiresAt }) });
  return proof;
}

export async function requestProductionReference(handle, binding, exchange) {
  const client = clients.get(handle);
  if (!client) fail('runtime_reference_required');
  record(binding, ['configSha256', 'planSha256', 'controlSnapshot']);
  if (!hex(binding.configSha256) || !hex(binding.planSha256) || !hex(binding.controlSnapshot) || typeof exchange !== 'function') fail();
  if (client.active >= MAX_PENDING) fail('runtime_reference_busy');
  const start = now(client.clock);
  const expiresAt = start.wall + PRODUCTION_REFERENCE_MAX_AGE_MS;
  if (!time(expiresAt) || !Number.isFinite(start.monotonic + PRODUCTION_REFERENCE_MAX_AGE_MS) ||
      start.monotonic + PRODUCTION_REFERENCE_MAX_AGE_MS > Number.MAX_SAFE_INTEGER) fail('runtime_reference_clock_unverified');
  const nonce = randomBytes(32).toString('base64url');
  const requestText = JSON.stringify({ schemaVersion: 1, purpose: 'mterm-dev-production-reference',
    registrationSha256: client.registrationSha256, instanceId: client.instanceId, nonce,
    issuedAt: start.wall, expiresAt, configSha256: binding.configSha256, planSha256: binding.planSha256,
    controlsSha256: productionControlCommitment(nonce, binding.controlSnapshot) });
  const request = validateRequest(requestText);
  client.active++;
  // There is one internally generated challenge and one verification attempt per
  // invocation. Neither caller bytes nor a serialized proof can restore a session.
  try {
    const response = await boundedCall(signal => exchange(requestText, { signal }), PRODUCTION_REFERENCE_MAX_AGE_MS,
      undefined, () => { client.active--; });
    return verifyEnvelope(response, client, requestText, request, start);
  } catch (error) { throw safe(error); }
}

export function getProductionReferenceFacts(proof) {
  const entry = proofs.get(proof);
  if (!entry || !entry.valid) fail('runtime_reference_required');
  try {
    const current = fresh(entry.clock, entry.start, entry.facts.expiresAt, entry.lastMonotonic);
    entry.lastMonotonic = current.monotonic;
    return entry.facts;
  } catch (error) {
    entry.valid = false;
    throw safe(error);
  }
}
