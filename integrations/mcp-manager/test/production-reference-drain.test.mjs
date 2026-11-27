import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import * as protocol from '../lib/production-reference.mjs';

// Additive tests: the original frozen 49-group protocol matrix is unchanged.
// An absent idle API is a capability gap, not an observed regression.
const available = typeof protocol.waitForProductionReferenceAuthorityIdle === 'function';
const drainTest = (name, body) => test(name, {
  skip: available ? false : 'Baseline authority-idle API is absent; no behavioral pass claimed', timeout: 5000,
}, body);
const hash = input => createHash('sha256').update(input).digest('hex');
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const facts = () => ({ productionConfigSha256: hash('reference drain production config v1'),
  productionObservationSha256: hash('reference drain production observation v1'), productionListener: 'unverified',
  topologyVerified: true, credentialsDistinct: true });
function fixture(observe) {
  const keys = generateKeyPairSync('ed25519'), clock = { wall: () => 1000000, monotonic: () => 1000 };
  const options = { instanceId: 'dev-drain-fixture', registrationSha256: hash('reference drain registration v1'), clock };
  const authority = protocol.createProductionReferenceAuthority({ ...options, privateKey: keys.privateKey, observe });
  const client = protocol.createProductionReferenceClient({ ...options, publicKey: keys.publicKey });
  const request = (exchange = authority) => protocol.requestProductionReference(client, {
    configSha256: hash('reference drain development config v1'), planSha256: hash('reference drain plan v1'),
    controlSnapshot: hash('reference drain private control snapshot v1'),
  }, exchange);
  return { authority, request };
}

test('production reference idle-drain capability is available without replacing the original protocol', () => {
  assert.equal(available, true, 'new idle API absence is a capability gap');
  for (const key of ['createProductionReferenceAuthority', 'createProductionReferenceClient',
    'requestProductionReference', 'getProductionReferenceFacts']) assert.equal(typeof protocol[key], 'function', key);
});

drainTest('authority idle wait rejects forged cloned and noncore handles synchronously without invoking them', () => {
  let calls = 0;
  const fake = () => { calls++; return Promise.resolve('private-fake-response'); };
  const f = fixture(async () => facts());
  for (const input of [undefined, null, {}, fake, async () => {}, { authority: f.authority },
    Object.assign(function cloned() {}, f.authority)]) {
    assert.throws(() => protocol.waitForProductionReferenceAuthorityIdle(input), { message: 'runtime_reference_required' });
  }
  assert.equal(calls, 0);
});

drainTest('idle authority resolves without creating requests or invoking an observer', async () => {
  let observations = 0;
  const f = fixture(async () => { observations++; return facts(); });
  const idle = protocol.waitForProductionReferenceAuthorityIdle(f.authority);
  assert.ok(idle instanceof Promise);
  await idle;
  assert.equal(observations, 0);
  const proof = await f.request();
  assert.equal(protocol.getProductionReferenceFacts(proof).productionListener, 'unverified');
  await protocol.waitForProductionReferenceAuthorityIdle(f.authority);
  assert.equal(observations, 1, 'a real neighboring signed exchange succeeds');
});

drainTest('active authority shares one pending idle promise and releases every waiter only at actual settlement', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture(async () => { entered.resolve(); return release.promise; });
  const request = f.request(); await entered.promise;
  const first = protocol.waitForProductionReferenceAuthorityIdle(f.authority);
  const second = protocol.waitForProductionReferenceAuthorityIdle(f.authority);
  assert.equal(first, second, 'coalesced waiters share the actual current drain promise');
  let settled = 0;
  first.then(() => { settled++; }); second.then(() => { settled++; });
  await turn(); assert.equal(settled, 0);
  release.resolve(facts());
  const proof = await request; await Promise.all([first, second]);
  assert.equal(settled, 2);
  assert.equal(protocol.getProductionReferenceFacts(proof).credentialsDistinct, true);
});

drainTest('an aborted public authority call cannot release idle while its ignored-abort observer is still running', async () => {
  const entered = deferred(), release = deferred(), controller = new AbortController();
  let observerSignal;
  const f = fixture(async (_request, { signal }) => { observerSignal = signal; entered.resolve(); return release.promise; });
  const request = f.request((text) => f.authority(text, { signal: controller.signal }));
  const rejection = assert.rejects(request, { message: 'runtime_reference_unavailable' });
  await entered.promise;
  const idle = protocol.waitForProductionReferenceAuthorityIdle(f.authority); let idleSettled = false;
  idle.then(() => { idleSettled = true; });
  controller.abort(); await rejection; await turn();
  assert.equal(observerSignal.aborted, true);
  assert.equal(idleSettled, false, 'public cancellation is not completion of hidden observer work');
  assert.equal(protocol.waitForProductionReferenceAuthorityIdle(f.authority), idle);
  release.resolve(facts()); await idle;
  assert.equal(idleSettled, true);
});

drainTest('observer rejection after caller cancellation still releases idle only when the observer actually rejects', async () => {
  const entered = deferred(), release = deferred(), controller = new AbortController();
  const f = fixture(async () => { entered.resolve(); return release.promise; });
  const request = f.request(text => f.authority(text, { signal: controller.signal }));
  const rejectedCaller = assert.rejects(request, { message: 'runtime_reference_unavailable' });
  await entered.promise;
  const idle = protocol.waitForProductionReferenceAuthorityIdle(f.authority); let settled = false;
  idle.then(() => { settled = true; });
  controller.abort(); await rejectedCaller; await turn(); assert.equal(settled, false);
  release.reject(new Error('PRIVATE_OBSERVER_COMPLETION_FAILURE'));
  await idle; assert.equal(settled, true);
});

drainTest('idle waits for every concurrent observer rather than the first completion', async () => {
  const both = deferred(), releases = [deferred(), deferred()]; let count = 0;
  const f = fixture(async () => {
    const index = count++; if (count === 2) both.resolve();
    return releases[index].promise;
  });
  const requests = [f.request(), f.request()]; await both.promise;
  const idle = protocol.waitForProductionReferenceAuthorityIdle(f.authority); let settled = false;
  idle.then(() => { settled = true; });
  releases[0].resolve(facts()); await requests[0]; await turn();
  assert.equal(settled, false);
  releases[1].resolve(facts()); await requests[1]; await idle;
  assert.equal(settled, true); assert.equal(count, 2);
});

drainTest('a new observer cycle obtains a fresh pending drain after an earlier idle wait completed', async () => {
  const entered = deferred(), release = deferred(); let calls = 0;
  const f = fixture(async () => {
    if (++calls === 1) return facts();
    entered.resolve(); return release.promise;
  });
  await f.request(); const oldIdle = protocol.waitForProductionReferenceAuthorityIdle(f.authority); await oldIdle;
  const request = f.request(); await entered.promise;
  const current = protocol.waitForProductionReferenceAuthorityIdle(f.authority); assert.notEqual(current, oldIdle);
  let settled = false; current.then(() => { settled = true; }); await turn(); assert.equal(settled, false);
  release.resolve(facts()); await request; await current; assert.equal(settled, true);
});

drainTest('malformed or already-aborted requests cannot leave phantom authority work for idle waiters', async () => {
  let observations = 0;
  const f = fixture(async () => { observations++; return facts(); });
  await assert.rejects(f.authority('{}'), { message: 'invalid_production_reference' });
  await protocol.waitForProductionReferenceAuthorityIdle(f.authority); assert.equal(observations, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.request(text => f.authority(text, { signal: controller.signal })),
    { message: 'runtime_reference_unavailable' });
  await protocol.waitForProductionReferenceAuthorityIdle(f.authority); assert.equal(observations, 0);
  await f.request(); await protocol.waitForProductionReferenceAuthorityIdle(f.authority); assert.equal(observations, 1);
});
