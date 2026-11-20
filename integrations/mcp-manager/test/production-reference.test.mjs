import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createSecretKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';

// Pure protocol fixtures: generated ephemeral keys, synthetic hashes and clocks,
// controlled callbacks. No files, OS identities, credentials or routes are read.
// An absent baseline API is a capability gap, never a passing regression run.
const moduleUrl = new URL('../lib/production-reference.mjs', import.meta.url);
let protocol, importError;
try { protocol = await import(moduleUrl.href); } catch (error) { importError = error; }
const missingCapability = importError?.code === 'ERR_MODULE_NOT_FOUND' && importError?.url === moduleUrl.href;
const MAX_AGE = 30_000;
const WALL = 1_800_000_000_000;
const REGISTRATION = 'a'.repeat(64);
const INSTANCE = 'dev-reference-fixture';
const INPUTS = Object.freeze({ configSha256: 'b'.repeat(64), planSha256: 'c'.repeat(64), controlSnapshot: 'd'.repeat(64) });
const PAIR = generateKeyPairSync('ed25519');
const OTHER_PAIR = generateKeyPairSync('ed25519');
const EC_PAIR = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const REQUEST_KEYS = ['schemaVersion', 'purpose', 'registrationSha256', 'instanceId', 'nonce',
  'issuedAt', 'expiresAt', 'configSha256', 'planSha256', 'controlsSha256'];
const FACT_KEYS = ['productionConfigSha256', 'productionObservationSha256', 'productionListener',
  'topologyVerified', 'credentialsDistinct'];
const VIEW_KEYS = [...FACT_KEYS, 'registrationSha256', 'referenceSha256', 'observedFrom', 'observedThrough', 'expiresAt'];
const sha = value => createHash('sha256').update(value).digest('hex');
const nonce = number => { const bytes = Buffer.alloc(32); bytes.writeUInt32BE(number, 28); return bytes.toString('base64url'); };
const commitment = (value, snapshot = INPUTS.controlSnapshot) => sha('MTerm-CLI DEV controls v1\n' + value + '\n' + snapshot);
const signatureInput = payload => Buffer.concat([Buffer.from('MTerm-CLI production reference v1\n'), Buffer.from(payload)]);
const freshFacts = (listener = 'matched') => ({ productionConfigSha256: 'e'.repeat(64),
  productionObservationSha256: 'f'.repeat(64), productionListener: listener,
  topologyVerified: true, credentialsDistinct: true });

function api() {
  assert.ok(protocol, `production-reference API unavailable: ${importError?.code ?? importError?.name ?? 'missing'}`);
  for (const name of ['createProductionReferenceAuthority', 'createProductionReferenceClient',
    'requestProductionReference', 'getProductionReferenceFacts', 'productionControlCommitment']) {
    assert.equal(typeof protocol[name], 'function', name);
  }
  assert.equal(protocol.PRODUCTION_REFERENCE_MAX_AGE_MS, MAX_AGE);
  return protocol;
}
function protocolTest(name, body) {
  test(name, { timeout: 4000, skip: missingCapability ? 'Baseline API absent; the availability test must fail.' : false }, async t => {
    api(); await body(t);
  });
}
function clockFixture() {
  const state = { wall: WALL, monotonic: 1000 };
  return { state, clock: { wall: () => state.wall, monotonic: () => state.monotonic },
    advance: milliseconds => { state.wall += milliseconds; state.monotonic += milliseconds; } };
}
function fixture(options = {}) {
  const time = options.time ?? clockFixture();
  const observe = options.observe ?? (() => freshFacts());
  return { ...time,
    client: api().createProductionReferenceClient({ publicKey: PAIR.publicKey,
      registrationSha256: REGISTRATION, instanceId: INSTANCE, clock: time.clock }),
    authority: api().createProductionReferenceAuthority({ privateKey: PAIR.privateKey,
      registrationSha256: REGISTRATION, instanceId: INSTANCE, observe, clock: time.clock }) };
}
function request(number = 1, changes = {}) {
  const value = nonce(number);
  return JSON.stringify({ schemaVersion: 1, purpose: 'mterm-dev-production-reference',
    registrationSha256: REGISTRATION, instanceId: INSTANCE, nonce: value,
    issuedAt: WALL, expiresAt: WALL + MAX_AGE, configSha256: INPUTS.configSha256,
    planSha256: INPUTS.planSha256, controlsSha256: commitment(value), ...changes });
}
function payloadFor(requestText, changes = {}) {
  const input = JSON.parse(requestText);
  return { schemaVersion: 1, purpose: 'mterm-dev-production-observation',
    registrationSha256: REGISTRATION, requestSha256: sha(requestText),
    observedFrom: input.issuedAt, observedThrough: input.issuedAt,
    expiresAt: input.expiresAt, facts: freshFacts(), ...changes };
}
function signed(payload, key = PAIR.privateKey, prefix = 'MTerm-CLI production reference v1\n') {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return JSON.stringify({ schemaVersion: 1, payload: Buffer.from(text).toString('base64url'),
    signature: sign(null, Buffer.concat([Buffer.from(prefix), Buffer.from(text)]), key).toString('base64url') });
}
function errorCode(...codes) {
  return error => { assert.ok(codes.includes(error?.message), `expected ${codes.join(' or ')}, received ${error?.message}`); return true; };
}
const rejects = (operation, ...codes) => assert.rejects(Promise.resolve().then(operation), errorCode(...codes));
const INVALID = 'invalid_production_reference';
const REQUIRED = 'runtime_reference_required';
const UNTRUSTED = 'runtime_reference_untrusted';
const MISMATCH = 'runtime_reference_mismatch';
const EXPIRED = 'runtime_reference_expired';
const REPLAYED = 'runtime_reference_replayed';
const BUSY = 'runtime_reference_busy';
const UNAVAILABLE = 'runtime_reference_unavailable';
const CLOCK = 'runtime_reference_clock_unverified';
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const track = promise => Promise.resolve(promise).then(value => ({ ok: true, value }), error => ({ ok: false, error }));
function assertResultError(result, ...codes) { assert.equal(result.ok, false); errorCode(...codes)(result.error); }
const inspect = (f, exchange = f.authority, inputs = INPUTS) => api().requestProductionReference(f.client, inputs, exchange);

test('production reference protocol capability is available with the agreed public API', () => { api(); });

protocolTest('control commitment binds the exact nonce and private control snapshot with domain separation', () => {
  const value = nonce(1);
  const result = protocol.productionControlCommitment(value, INPUTS.controlSnapshot);
  assert.equal(result, commitment(value));
  assert.match(result, /^[a-f0-9]{64}$/);
  assert.notEqual(result, protocol.productionControlCommitment(nonce(2), INPUTS.controlSnapshot));
  assert.notEqual(result, protocol.productionControlCommitment(value, '0'.repeat(64)));
  for (const [badNonce, badSnapshot] of [[value + '=', INPUTS.controlSnapshot], ['short', INPUTS.controlSnapshot],
    [value, 'D'.repeat(64)], [value, 'd'.repeat(63)], [value, null]]) {
    assert.throws(() => protocol.productionControlCommitment(badNonce, badSnapshot), errorCode(INVALID));
  }
});

protocolTest('authority and client require correctly typed Ed25519 KeyObjects', () => {
  const time = clockFixture();
  const authorityOptions = { privateKey: PAIR.privateKey, registrationSha256: REGISTRATION,
    instanceId: INSTANCE, observe: freshFacts, clock: time.clock };
  const clientOptions = { publicKey: PAIR.publicKey, registrationSha256: REGISTRATION,
    instanceId: INSTANCE, clock: time.clock };
  for (const key of [PAIR.publicKey, EC_PAIR.privateKey, createSecretKey(Buffer.alloc(32)),
    PAIR.privateKey.export({ type: 'pkcs8', format: 'pem' }), null]) {
    assert.throws(() => protocol.createProductionReferenceAuthority({ ...authorityOptions, privateKey: key }), errorCode(INVALID));
  }
  for (const key of [PAIR.privateKey, EC_PAIR.publicKey, createSecretKey(Buffer.alloc(32)),
    PAIR.publicKey.export({ type: 'spki', format: 'pem' }), null]) {
    assert.throws(() => protocol.createProductionReferenceClient({ ...clientOptions, publicKey: key }), errorCode(INVALID));
  }
});

protocolTest('trusted factory options reject unknown fields, invalid registrations, instance aliases and accessors', () => {
  const base = { publicKey: PAIR.publicKey, registrationSha256: REGISTRATION, instanceId: INSTANCE };
  for (const extra of [{ qualified: true }, { keyPath: 'C:\\PRIVATE\\key.pem' },
    { registrationSha256: REGISTRATION.toUpperCase() }, { registrationSha256: 'a'.repeat(63) },
    { instanceId: 'production' }, { instanceId: 'dev--alias' }, { instanceId: 'dev-' + 'a'.repeat(45) }]) {
    assert.throws(() => protocol.createProductionReferenceClient({ ...base, ...extra }), errorCode(INVALID));
  }
  let accessed = 0;
  const accessor = { ...base };
  Object.defineProperty(accessor, 'clock', { enumerable: true, get() { accessed++; throw new Error('private getter'); } });
  assert.throws(() => protocol.createProductionReferenceClient(accessor), errorCode(INVALID));
  assert.equal(accessed, 0, 'validation never invokes an option getter');
  assert.throws(() => protocol.createProductionReferenceAuthority({ privateKey: PAIR.privateKey,
    registrationSha256: REGISTRATION, instanceId: INSTANCE, observe: 'command-to-execute' }), errorCode(INVALID));
});

protocolTest('a valid exchange returns opaque, private and independently verifiable production facts', async () => {
  const f = fixture(); let requestText, envelopeText;
  const proof = await inspect(f, async (text, options) => {
    requestText = text;
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    envelopeText = await f.authority(text, options); return envelopeText;
  });
  const input = JSON.parse(requestText), envelope = JSON.parse(envelopeText);
  const payloadBytes = Buffer.from(envelope.payload, 'base64url');
  assert.deepEqual(Object.keys(input), REQUEST_KEYS);
  assert.equal(input.registrationSha256, REGISTRATION); assert.equal(input.instanceId, INSTANCE);
  assert.equal(input.configSha256, INPUTS.configSha256); assert.equal(input.planSha256, INPUTS.planSha256);
  assert.equal(input.issuedAt, WALL); assert.equal(input.expiresAt, WALL + MAX_AGE);
  assert.match(input.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(input.nonce, 'base64url').length, 32);
  assert.equal(input.controlsSha256, commitment(input.nonce));
  assert.equal(requestText.includes(INPUTS.controlSnapshot), false);
  assert.equal(verify(null, signatureInput(payloadBytes.toString()), PAIR.publicKey,
    Buffer.from(envelope.signature, 'base64url')), true);
  const view = protocol.getProductionReferenceFacts(proof);
  assert.deepEqual(Object.keys(view).sort(), [...VIEW_KEYS].sort());
  for (const key of FACT_KEYS) assert.deepEqual(view[key], freshFacts()[key]);
  assert.equal(view.registrationSha256, REGISTRATION);
  assert.match(view.referenceSha256, /^[a-f0-9]{64}$/);
  assert.equal(view.observedFrom, WALL); assert.equal(view.observedThrough, WALL);
  assert.equal(view.expiresAt, WALL + MAX_AGE);
  for (const output of [JSON.stringify(proof) ?? '', JSON.stringify(view), envelopeText]) {
    assert.equal(output.includes(input.nonce), false); assert.equal(output.includes(INPUTS.controlSnapshot), false);
  }
  for (const name of ['qualified', 'upstreamEnabled', 'runningSourceVerified', 'liveVerified', 'oauthGrantsVerified']) {
    assert.equal(Object.hasOwn(view, name), false, 'protocol facts do not award activation or remote qualification');
  }
});

protocolTest('default clocks support a real immediate round trip without fixture time overrides', async () => {
  const client = protocol.createProductionReferenceClient({ publicKey: PAIR.publicKey, registrationSha256: REGISTRATION, instanceId: INSTANCE });
  const authority = protocol.createProductionReferenceAuthority({ privateKey: PAIR.privateKey, registrationSha256: REGISTRATION,
    instanceId: INSTANCE, observe: () => freshFacts('absent') });
  const proof = await protocol.requestProductionReference(client, INPUTS, authority);
  assert.equal(protocol.getProductionReferenceFacts(proof).productionListener, 'absent');
});

protocolTest('separate requests use fresh nonces and commitments even with identical private snapshots', async () => {
  const f = fixture(); const captured = [];
  const exchange = async (text, options) => { captured.push(JSON.parse(text)); return f.authority(text, options); };
  const [one, two] = await Promise.all([inspect(f, exchange), inspect(f, exchange)]);
  assert.equal(captured.length, 2); assert.notEqual(captured[0].nonce, captured[1].nonce);
  assert.notEqual(captured[0].controlsSha256, captured[1].controlsSha256);
  assert.notEqual(protocol.getProductionReferenceFacts(one).referenceSha256, protocol.getProductionReferenceFacts(two).referenceSha256);
});

protocolTest('opaque clients and proofs cannot be forged, cloned or revived by serialization', async () => {
  const f = fixture(); let exchanges = 0;
  for (const client of [null, {}, { registrationSha256: REGISTRATION }, { ...f.client }]) {
    await rejects(() => protocol.requestProductionReference(client, INPUTS, () => { exchanges++; }), REQUIRED);
  }
  assert.equal(exchanges, 0);
  const proof = await inspect(f);
  for (const fake of [null, {}, freshFacts(), { ...proof }, JSON.parse(JSON.stringify(proof) ?? 'null')]) {
    assert.throws(() => protocol.getProductionReferenceFacts(fake), errorCode(REQUIRED));
  }
  const view = protocol.getProductionReferenceFacts(proof);
  try { view.credentialsDistinct = false; view.productionListener = 'mismatched'; } catch (error) { assert.ok(error instanceof TypeError); }
  assert.equal(protocol.getProductionReferenceFacts(proof).credentialsDistinct, true);
  assert.equal(protocol.getProductionReferenceFacts(proof).productionListener, 'matched');
});

for (const listener of ['matched', 'mismatched', 'absent', 'unverified']) {
  protocolTest(`reference facts preserve the ${listener} production listener observation`, async () => {
    const f = fixture({ observe: () => freshFacts(listener) });
    assert.equal(protocol.getProductionReferenceFacts(await inspect(f)).productionListener, listener);
  });
}

for (const [name, mutate] of [
  ['a request object instead of canonical text', text => JSON.parse(text)],
  ['leading whitespace', text => ' ' + text],
  ['trailing newline', text => text + '\n'],
  ['reordered JSON keys', text => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text)).reverse()))],
  ['duplicate schema keys', text => text.replace('{', '{"schemaVersion":1,')],
  ['alternate Unicode encoding', text => text.replace('mterm-dev', '\\u006dterm-dev')],
  ['arbitrary filesystem paths', text => JSON.stringify({ ...JSON.parse(text), path: 'C:\\PRIVATE\\production.json' })],
  ['arbitrary commands', text => JSON.stringify({ ...JSON.parse(text), command: 'do-not-execute' })],
  ['caller-selected algorithms', text => JSON.stringify({ ...JSON.parse(text), alg: 'none' })],
  ['oversized input', () => ' '.repeat(2049)],
]) {
  protocolTest(`authority rejects ${name} before observation`, async () => {
    let calls = 0; const f = fixture({ observe: () => { calls++; return freshFacts(); } });
    await rejects(() => f.authority(mutate(request())), INVALID);
    assert.equal(calls, 0);
    await f.authority(request(2)); assert.equal(calls, 1, 'a valid neighboring request still works');
  });
}

protocolTest('authority rejects malformed request fields and unknown registration bindings before observation', async () => {
  for (const changes of [{ nonce: nonce(1) + '=' }, { nonce: 'short' }, { controlsSha256: 'D'.repeat(64) },
    { configSha256: 'x'.repeat(64) }, { planSha256: null }, { purpose: 'mterm-dev-production-observation' },
    { schemaVersion: 2 }, { instanceId: 'production' }]) {
    let calls = 0; const f = fixture({ observe: () => { calls++; return freshFacts(); } });
    await rejects(() => f.authority(request(1, changes)), INVALID, MISMATCH);
    assert.equal(calls, 0);
  }
  for (const changes of [{ registrationSha256: '0'.repeat(64) }, { instanceId: 'dev-other' }]) {
    let calls = 0; const f = fixture({ observe: () => { calls++; return freshFacts(); } });
    await rejects(() => f.authority(request(1, changes)), MISMATCH);
    assert.equal(calls, 0);
  }
});

protocolTest('authority rejects future, expired and excessive request windows before observation', async () => {
  for (const changes of [{ issuedAt: WALL + 1, expiresAt: WALL + 1 + MAX_AGE },
    { issuedAt: WALL - MAX_AGE, expiresAt: WALL }, { expiresAt: WALL },
    { expiresAt: WALL - 1 }, { expiresAt: WALL + MAX_AGE + 1 }]) {
    let calls = 0; const f = fixture({ observe: () => { calls++; return freshFacts(); } });
    await rejects(() => f.authority(request(1, changes)), EXPIRED, INVALID);
    assert.equal(calls, 0);
  }
});

protocolTest('request inputs remain exact, private data fields and never admit caller readiness claims', async () => {
  const f = fixture(); let calls = 0;
  for (const changes of [{ controlSnapshot: 'D'.repeat(64) }, { configSha256: 'b'.repeat(63) },
    { planSha256: null }, { nonce: nonce(1) }, { qualified: true }, { path: 'C:\\PRIVATE' }]) {
    await rejects(() => inspect(f, () => { calls++; }, { ...INPUTS, ...changes }), INVALID);
  }
  let touched = 0;
  const accessor = { ...INPUTS };
  Object.defineProperty(accessor, 'controlSnapshot', { enumerable: true, get() { touched++; return INPUTS.controlSnapshot; } });
  await rejects(() => inspect(f, () => { calls++; }, accessor), INVALID);
  assert.equal(calls, 0); assert.equal(touched, 0);
});

for (const [name, mutate] of [
  ['unknown envelope keys', envelope => ({ ...envelope, alg: 'none' })],
  ['a padded payload encoding', envelope => ({ ...envelope, payload: envelope.payload + '=' })],
  ['a padded signature encoding', envelope => ({ ...envelope, signature: envelope.signature + '=' })],
  ['a truncated signature', envelope => ({ ...envelope, signature: Buffer.alloc(63).toString('base64url') })],
  ['an unsupported envelope version', envelope => ({ ...envelope, schemaVersion: 2 })],
]) {
  protocolTest(`consumer rejects ${name}`, async () => {
    const f = fixture();
    await rejects(() => inspect(f, text => JSON.stringify(mutate(JSON.parse(signed(payloadFor(text)))))), INVALID, UNTRUSTED);
  });
}

protocolTest('consumer refuses noncanonical, duplicated and oversized envelope text', async () => {
  for (const mutate of [text => ' ' + text, text => text + '\n',
    text => text.replace('{', '{"schemaVersion":1,'),
    text => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text)).reverse())),
    () => ' '.repeat(8193)]) {
    const f = fixture(); await rejects(() => inspect(f, requestText => mutate(signed(payloadFor(requestText)))), INVALID);
  }
});

protocolTest('consumer rejects wrong signing keys, modified signed facts and the wrong signature domain', async () => {
  const f = fixture();
  await rejects(() => inspect(f, text => signed(payloadFor(text), OTHER_PAIR.privateKey)), UNTRUSTED);
  await rejects(() => inspect(f, text => signed(payloadFor(text), PAIR.privateKey, 'different protocol\n')), UNTRUSTED);
  await rejects(() => inspect(f, text => {
    const envelope = JSON.parse(signed(payloadFor(text)));
    const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString());
    payload.facts.productionListener = 'absent';
    envelope.payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return JSON.stringify(envelope);
  }), UNTRUSTED);
});

protocolTest('a valid signature cannot bypass strict payload and fact schemas', async () => {
  for (const mutate of [p => ({ ...p, command: 'do-not-execute' }), p => ({ ...p, alg: 'Ed25519' }),
    p => ({ ...p, purpose: 'different-purpose' }), p => ({ ...p, schemaVersion: 2 }),
    p => ({ ...p, facts: { ...p.facts, qualified: true } }),
    p => ({ ...p, facts: { ...p.facts, topologyVerified: false } }),
    p => ({ ...p, facts: { ...p.facts, credentialsDistinct: false } }),
    p => ({ ...p, facts: { ...p.facts, productionListener: 'running' } }),
    p => ({ ...p, facts: { ...p.facts, productionConfigSha256: 'E'.repeat(64) } }),
    p => { const copy = { ...p, facts: { ...p.facts } }; delete copy.facts.productionObservationSha256; return copy; }]) {
    const f = fixture(); await rejects(() => inspect(f, text => signed(mutate(payloadFor(text)))), INVALID);
  }
  for (const mutate of [text => ' ' + text, text => text.replace('{', '{"schemaVersion":1,'),
    text => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text)).reverse()))]) {
    const f = fixture(); await rejects(() => inspect(f, text => signed(mutate(JSON.stringify(payloadFor(text))))), INVALID);
  }
});

protocolTest('consumer binds trusted signed responses to the exact registration and request bytes', async () => {
  for (const mutate of [p => ({ ...p, registrationSha256: '0'.repeat(64) }),
    p => ({ ...p, requestSha256: '0'.repeat(64) }), p => ({ ...p, expiresAt: p.expiresAt - 1 })]) {
    const f = fixture(); await rejects(() => inspect(f, text => signed(mutate(payloadFor(text)))), MISMATCH, EXPIRED);
  }
  for (const field of ['configSha256', 'planSha256', 'controlsSha256', 'instanceId', 'nonce']) {
    const f = fixture();
    await rejects(() => inspect(f, text => {
      const changed = JSON.parse(text);
      changed[field] = field === 'instanceId' ? 'dev-other' : field === 'nonce' ? nonce(999) : '0'.repeat(64);
      return signed(payloadFor(JSON.stringify(changed)));
    }), MISMATCH);
  }
});

protocolTest('consumer refuses authenticated observation windows outside the pending request', async () => {
  for (const mutate of [p => ({ ...p, observedFrom: WALL - 1 }),
    p => ({ ...p, observedThrough: p.expiresAt + 1 }),
    p => ({ ...p, observedFrom: WALL + 1, observedThrough: WALL })]) {
    const f = fixture(); await rejects(() => inspect(f, text => signed(mutate(payloadFor(text)))), EXPIRED, INVALID);
  }
});

protocolTest('old responses cannot be reused for a new nonce or a changed control snapshot', async () => {
  const f = fixture(); let response;
  const first = await inspect(f, async (text, options) => { response = await f.authority(text, options); return response; });
  assert.equal(protocol.getProductionReferenceFacts(first).credentialsDistinct, true);
  await rejects(() => inspect(f, () => response), MISMATCH);
  await rejects(() => inspect(f, () => response, { ...INPUTS, controlSnapshot: '0'.repeat(64) }), MISMATCH);
});

protocolTest('exchange failures have no retry and redact private callback errors', async () => {
  const f = fixture(); let calls = 0;
  const sentinel = 'PRIVATE_REFERENCE_FAILURE_' + INPUTS.controlSnapshot;
  await assert.rejects(inspect(f, () => { calls++; throw new Error(sentinel); }), error => {
    errorCode(UNAVAILABLE)(error);
    assert.equal(JSON.stringify(error, Object.getOwnPropertyNames(error)).includes(sentinel), false);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(protocol.getProductionReferenceFacts(await inspect(f)).credentialsDistinct, true);
});

protocolTest('observer failures and malformed facts are sanitized and consume the reserved nonce', async () => {
  let calls = 0; const f = fixture({ observe: () => { calls++; throw new Error('PRIVATE_OBSERVER_PATH'); } });
  await rejects(() => f.authority(request()), UNAVAILABLE);
  await rejects(() => f.authority(request()), REPLAYED);
  assert.equal(calls, 1);
  for (const facts of [{ ...freshFacts(), token: INPUTS.controlSnapshot },
    { ...freshFacts(), topologyVerified: false }, { ...freshFacts(), credentialsDistinct: false }]) {
    const other = fixture({ observe: () => facts });
    await rejects(() => other.authority(request()), INVALID, UNAVAILABLE);
    await rejects(() => other.authority(request()), REPLAYED);
  }
});

protocolTest('authority reserves a nonce before awaiting observation and rejects concurrent replay', async t => {
  const gate = deferred(), entered = deferred(); let calls = 0;
  const f = fixture({ observe: () => { calls++; entered.resolve(); return gate.promise; } });
  const first = track(f.authority(request()));
  t.after(async () => { gate.resolve(freshFacts()); await first; });
  await entered.promise;
  await rejects(() => f.authority(request()), REPLAYED);
  assert.equal(calls, 1);
  gate.resolve(freshFacts()); assert.equal((await first).ok, true);
  await rejects(() => f.authority(request()), REPLAYED);
});

protocolTest('authority rejects already-aborted calls without observing or reserving the nonce', async () => {
  let calls = 0; const f = fixture({ observe: () => { calls++; return freshFacts(); } });
  const controller = new AbortController(); controller.abort();
  await rejects(() => f.authority(request(), { signal: controller.signal }), UNAVAILABLE);
  assert.equal(calls, 0);
  await f.authority(request()); assert.equal(calls, 1);
});

protocolTest('authority bounds eight observations and retains aborted work until actual settlement', async t => {
  const entered = deferred(), pending = [], gates = [], signals = [];
  const f = fixture({ observe: (_request, { signal }) => {
    const gate = deferred(); gates.push(gate); signals.push(signal);
    if (gates.length === 8) entered.resolve(); return gate.promise;
  } });
  const controllers = Array.from({ length: 8 }, () => new AbortController());
  for (let i = 0; i < 8; i++) pending.push(track(f.authority(request(i + 1), { signal: controllers[i].signal })));
  t.after(async () => { for (const gate of gates) gate.resolve(freshFacts()); await Promise.all(pending); });
  await entered.promise;
  await rejects(() => f.authority(request(99)), BUSY); assert.equal(gates.length, 8);
  controllers[0].abort(); assertResultError(await pending[0], UNAVAILABLE);
  assert.equal(signals[0].aborted, true);
  await rejects(() => f.authority(request(100)), BUSY); assert.equal(gates.length, 8);
  await rejects(() => f.authority(request(1)), REPLAYED, BUSY);
  gates[0].resolve(freshFacts()); await nextTurn();
  const replacement = track(f.authority(request(101))); pending.push(replacement);
  await nextTurn(); assert.equal(gates.length, 9, 'settled observation releases exactly one slot');
  gates[8].resolve(freshFacts()); assert.equal((await replacement).ok, true);
});

protocolTest('authority retains all sixty-four nonce reservations without evicting live or failed entries', async () => {
  let observed = 0;
  const f = fixture({ observe: () => { observed++; if (observed <= 3) throw new Error('owned failure'); return freshFacts(); } });
  for (let i = 1; i <= 64; i++) {
    if (i <= 3) await rejects(() => f.authority(request(i)), UNAVAILABLE);
    else await f.authority(request(i));
  }
  assert.equal(observed, 64);
  await rejects(() => f.authority(request(65)), BUSY);
  await rejects(() => f.authority(request(1)), REPLAYED, BUSY);
  assert.equal(observed, 64);
  f.advance(MAX_AGE);
  await f.authority(request(66, { issuedAt: f.state.wall, expiresAt: f.state.wall + MAX_AGE }));
  assert.equal(observed, 65, 'expired reservations are reclaimable');
});

protocolTest('client bounds eight independent exchanges and releases capacity only after settlement', async t => {
  const f = fixture(), entered = deferred(), gates = [], pending = [];
  const exchange = (text, { signal }) => {
    const gate = deferred(); gates.push({ ...gate, text, signal });
    if (gates.length === 8) entered.resolve(); return gate.promise;
  };
  for (let i = 0; i < 8; i++) pending.push(track(inspect(f, exchange)));
  t.after(async () => { for (const gate of gates) gate.resolve(signed(payloadFor(gate.text))); await Promise.all(pending); });
  await entered.promise;
  await rejects(() => inspect(f, exchange), BUSY); assert.equal(gates.length, 8);
  const otherClient = fixture();
  assert.equal(protocol.getProductionReferenceFacts(await inspect(otherClient)).credentialsDistinct, true);
  gates[0].resolve(signed(payloadFor(gates[0].text))); assert.equal((await pending[0]).ok, true);
  const replacement = track(inspect(f, exchange)); pending.push(replacement);
  await nextTurn(); assert.equal(gates.length, 9);
  gates[8].resolve(signed(payloadFor(gates[8].text))); assert.equal((await replacement).ok, true);
});

protocolTest('client deadline aborts exchanges without freeing ignored-abort capacity or retrying', async t => {
  // Node24 documented MockTimers API; no real thirty-second wait.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), entered = deferred(), gates = [], pending = [];
  const exchange = (text, { signal }) => {
    const gate = deferred(); gates.push({ ...gate, text, signal });
    if (gates.length === 8) entered.resolve(); return gate.promise;
  };
  for (let i = 0; i < 8; i++) pending.push(track(inspect(f, exchange)));
  t.after(async () => { for (const gate of gates) gate.resolve(signed(payloadFor(gate.text))); await Promise.all(pending); });
  await entered.promise;
  f.advance(MAX_AGE); t.mock.timers.tick(MAX_AGE);
  for (const result of await Promise.all(pending)) assertResultError(result, EXPIRED);
  assert.equal(gates.length, 8); assert.ok(gates.every(gate => gate.signal.aborted));
  await rejects(() => inspect(f, exchange), BUSY); assert.equal(gates.length, 8);
  gates[0].resolve(signed(payloadFor(gates[0].text))); await nextTurn();
  const replacement = track(inspect(f, exchange)); pending.push(replacement);
  await nextTurn(); assert.equal(gates.length, 9);
  gates[8].resolve(signed(payloadFor(gates[8].text))); assert.equal((await replacement).ok, true);
});

protocolTest('late observer or exchange completion cannot authenticate an expired request', async () => {
  const time = clockFixture();
  const f = fixture({ time, observe: () => { time.advance(MAX_AGE); return freshFacts(); } });
  await rejects(() => f.authority(request()), EXPIRED);
  const other = fixture();
  await rejects(() => inspect(other, text => { const answer = signed(payloadFor(text)); other.advance(MAX_AGE); return answer; }), EXPIRED);
});

protocolTest('proof expiry is enforced at the exact wall deadline and cannot be rolled back', async () => {
  const f = fixture(), proof = await inspect(f);
  f.advance(MAX_AGE - 1); assert.equal(protocol.getProductionReferenceFacts(proof).credentialsDistinct, true);
  f.advance(1); assert.throws(() => protocol.getProductionReferenceFacts(proof), errorCode(EXPIRED));
  f.state.wall = WALL; f.state.monotonic = 1000;
  assert.throws(() => protocol.getProductionReferenceFacts(proof), errorCode(EXPIRED, CLOCK, REQUIRED));
});

protocolTest('monotonic expiry and backwards clocks independently invalidate proofs permanently', async () => {
  const elapsed = fixture(), expired = await inspect(elapsed);
  elapsed.state.monotonic += MAX_AGE;
  assert.throws(() => protocol.getProductionReferenceFacts(expired), errorCode(EXPIRED));
  const backwards = fixture(), proof = await inspect(backwards);
  backwards.state.monotonic -= 1;
  assert.throws(() => protocol.getProductionReferenceFacts(proof), errorCode(CLOCK));
  backwards.state.monotonic = 1000;
  assert.throws(() => protocol.getProductionReferenceFacts(proof), errorCode(CLOCK, EXPIRED, REQUIRED));
  const wall = fixture(), wallProof = await inspect(wall);
  wall.state.wall -= 1;
  assert.throws(() => protocol.getProductionReferenceFacts(wallProof), errorCode(EXPIRED, CLOCK));
});

protocolTest('invalid or overflowing clocks reject without private callback execution', async () => {
  for (const [field, value] of [['wall', -1], ['wall', NaN], ['wall', Infinity], ['wall', WALL + 0.5],
    ['wall', Number.MAX_SAFE_INTEGER], ['monotonic', -1], ['monotonic', NaN],
    ['monotonic', Infinity], ['monotonic', Number.MAX_SAFE_INTEGER + 1]]) {
    let called = 0;
    const clock = { wall: () => field === 'wall' ? value : WALL,
      monotonic: () => field === 'monotonic' ? value : 1000 };
    await rejects(() => {
      const client = protocol.createProductionReferenceClient({ publicKey: PAIR.publicKey,
        registrationSha256: REGISTRATION, instanceId: INSTANCE, clock });
      return protocol.requestProductionReference(client, INPUTS, () => { called++; });
    }, CLOCK);
    assert.equal(called, 0);
  }
  const fractional = clockFixture(); fractional.state.monotonic = 1000.25;
  const valid = fixture({ time: fractional });
  assert.equal(protocol.getProductionReferenceFacts(await inspect(valid)).credentialsDistinct, true);
});

protocolTest('clock callback failures are sanitized and invalidate an existing proof', async () => {
  const time = clockFixture(); let broken = false;
  time.clock.monotonic = () => { if (broken) throw new Error('PRIVATE_CLOCK_PATH'); return time.state.monotonic; };
  const f = fixture({ time }), proof = await inspect(f);
  broken = true;
  assert.throws(() => protocol.getProductionReferenceFacts(proof), error => {
    errorCode(CLOCK)(error); assert.equal(String(error).includes('PRIVATE_CLOCK_PATH'), false); return true;
  });
  broken = false;
  assert.throws(() => protocol.getProductionReferenceFacts(proof), errorCode(CLOCK, EXPIRED, REQUIRED));
});
