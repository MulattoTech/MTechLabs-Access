import { assertReferenceBootstrap, startReferenceTransportHelper } from './reference-bootstrap.mjs';

const LIMIT = 8;
const MAX_AGE = 30000;
const fail = code => { throw new Error(code); };
const ERROR = new Set(['runtime_reference_invalid', 'runtime_reference_unavailable', 'runtime_reference_busy',
  'runtime_reference_expired', 'runtime_reference_cancelled', 'runtime_reference_bootstrap_untrusted']);
function safe(error) {
  let message;
  try { message = error instanceof Error ? Object.getOwnPropertyDescriptor(error, 'message')?.value : undefined; }
  catch { /* Rejected callback values are not trusted objects. */ }
  return new Error(ERROR.has(message) ? message : 'runtime_reference_unavailable');
}
function requestBytes(value, handle) {
  try {
    if (typeof value !== 'string' || Buffer.byteLength(value) > 2048) throw new Error();
    const parsed = JSON.parse(value);
    const fields = ['schemaVersion', 'purpose', 'registrationSha256', 'instanceId', 'nonce',
      'issuedAt', 'expiresAt', 'configSha256', 'planSha256', 'controlsSha256'];
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).join(',') !== fields.join(',') ||
        JSON.stringify(parsed) !== value || parsed.schemaVersion !== 1 || parsed.purpose !== 'mterm-dev-production-reference' ||
        parsed.registrationSha256 !== handle.registrationSha256 || parsed.instanceId !== handle.instanceId ||
        typeof parsed.nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(parsed.nonce) ||
        Buffer.from(parsed.nonce, 'base64url').toString('base64url') !== parsed.nonce ||
        !Number.isSafeInteger(parsed.issuedAt) || parsed.issuedAt < 0 || !Number.isSafeInteger(parsed.expiresAt) ||
        parsed.expiresAt <= parsed.issuedAt || parsed.expiresAt - parsed.issuedAt > MAX_AGE ||
        ['configSha256', 'planSha256', 'controlsSha256'].some(key => typeof parsed[key] !== 'string' || parsed[key].length !== 64 || !/^[a-f0-9]{64}$/.test(parsed[key]))) throw new Error();
    return Buffer.from(value);
  } catch { fail('runtime_reference_invalid'); }
}
function lines(stream, consume, broken) {
  let pending = Buffer.alloc(0);
  stream.on('data', chunk => {
    try {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > 131072) throw new Error();
      while (true) {
        const at = pending.indexOf(10);
        if (at < 0) break;
        if (at > 16384) throw new Error();
        const bytes = pending.subarray(0, at);
        pending = pending.subarray(at + 1);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r$/, '');
        consume(text);
      }
      if (pending.length > 16384) throw new Error();
    } catch { broken(); }
  });
  stream.on('end', () => { if (pending.length) broken(); });
  stream.on('error', broken);
}
function decode(value, maximum) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('runtime_reference_invalid');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maximum || bytes.toString('base64') !== value) fail('runtime_reference_invalid');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Trusted owner integration only. Received bytes never select this callback. */
export function serveReferenceTransport(handle, authority) {
  assertReferenceBootstrap(handle, 'authority');
  if (typeof authority !== 'function') fail('runtime_reference_invalid');
  const native = startReferenceTransportHelper(handle, 'Server'), child = native.child;
  const active = new Map();
  let readyResolve, readyReject, closeResolve, closing = false, exited = false, readyDone = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const closed = new Promise(resolve => { closeResolve = resolve; });
  const drained = () => { if (exited && active.size === 0) closeResolve(); };
  const write = line => {
    if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.write(line + '\n', () => {});
  };
  function stop(error = new Error('runtime_reference_unavailable')) {
    if (!closing) {
      closing = true;
      clearTimeout(startupTimer);
      if (!readyDone) readyReject(safe(error));
      for (const entry of active.values()) entry.controller.abort();
      child.stdin.end('STOP\n');
      // Shutdown kills only the helper created by this server. Admission slots
      // and the drain promise still wait for actual callback settlement.
      const timer = setTimeout(() => { if (!exited) child.kill(); }, 1500);
      timer.unref();
    }
    drained();
    return closed;
  }
  const startupTimer = setTimeout(() => stop(new Error('runtime_reference_expired')), 25000);
  child.stdin.on('error', () => stop());
  child.stderr.on('data', () => stop());
  child.on('error', () => stop());
  child.on('close', () => { exited = true; stop(); drained(); });
  lines(child.stdout, line => {
    if (!readyDone) {
      if (line !== `READY ${native.snapshotSha256}`) { stop(new Error('runtime_reference_bootstrap_untrusted')); return; }
      clearTimeout(startupTimer); readyDone = true; readyResolve(); return;
    }
    if (closing) return;
    const parts = line.split(' ');
    if (parts[0] === 'C' && parts.length === 2 && /^[1-9]\d{0,15}$/.test(parts[1])) {
      active.get(parts[1])?.controller.abort(); return;
    }
    if (parts[0] !== 'Q' || parts.length !== 3 || !/^[1-9]\d{0,15}$/.test(parts[1]) || active.has(parts[1])) { stop(); return; }
    const id = parts[1];
    if (active.size >= LIMIT) { write(`E ${id} runtime_reference_busy`); return; }
    let request;
    try { request = decode(parts[2], 2048); requestBytes(request, handle); }
    catch { write(`E ${id} runtime_reference_invalid`); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MAX_AGE);
    const entry = { controller, timer };
    active.set(id, entry);
    // Do not race this task against abort/timeout: its slot is held until the
    // callback itself settles, even if it ignores the supplied signal.
    Promise.resolve().then(() => authority(request, { signal: controller.signal })).then(response => {
      if (controller.signal.aborted) { write(`E ${id} runtime_reference_expired`); return; }
      if (typeof response !== 'string' || !response || Buffer.byteLength(response) > 8192) {
        write(`E ${id} runtime_reference_invalid`); return;
      }
      write(`R ${id} ${Buffer.from(response).toString('base64')}`);
    }, error => write(`E ${id} ${safe(error).message}`)).finally(() => {
      clearTimeout(timer); active.delete(id); drained();
    });
  }, () => stop());
  return Object.freeze({ ready, closed, close: () => stop() });
}

export function createReferenceExchange(handle) {
  assertReferenceBootstrap(handle, 'client');
  let active = 0;
  return async function exchange(request, options = {}) {
    const bytes = requestBytes(request, handle);
    let signal;
    try {
      if (!options || typeof options !== 'object' || Array.isArray(options) ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw new Error();
      const descriptors = Object.getOwnPropertyDescriptors(options);
      if (Reflect.ownKeys(descriptors).some(key => key !== 'signal' || !descriptors[key].enumerable ||
          !Object.hasOwn(descriptors[key], 'value'))) throw new Error();
      signal = descriptors.signal?.value;
      if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error();
    } catch { fail('runtime_reference_invalid'); }
    if (signal?.aborted) fail('runtime_reference_cancelled');
    if (active >= LIMIT) fail('runtime_reference_busy');
    active++;
    let native;
    try { native = startReferenceTransportHelper(handle, 'Exchange'); }
    catch (error) { active--; throw safe(error); }
    const child = native.child;
    return new Promise((resolve, reject) => {
      let result, failure, ready = false, response = false;
      const stop = code => { failure ??= new Error(code); child.kill(); };
      const aborted = () => stop('runtime_reference_cancelled');
      const timer = setTimeout(() => stop('runtime_reference_expired'), MAX_AGE);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
      child.stdin.on('error', () => stop('runtime_reference_unavailable'));
      child.stderr.on('data', () => stop('runtime_reference_unavailable'));
      child.on('error', () => stop('runtime_reference_unavailable'));
      lines(child.stdout, line => {
        if (!ready) {
          if (line !== `READY ${native.snapshotSha256}`) { stop('runtime_reference_bootstrap_untrusted'); return; }
          ready = true; child.stdin.end(bytes); return;
        }
        if (response) { stop('runtime_reference_invalid'); return; }
        if (line.startsWith('ERROR ')) {
          const code = line.slice(6); stop(ERROR.has(code) ? code : 'runtime_reference_unavailable'); return;
        }
        if (!line.startsWith('RESPONSE ')) { stop('runtime_reference_invalid'); return; }
        try { result = decode(line.slice(9), 8192); response = true; }
        catch { stop('runtime_reference_invalid'); }
      }, () => stop('runtime_reference_invalid'));
      child.on('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', aborted); active--;
        if (failure || code !== 0 || !ready || !response) reject(failure ?? new Error('runtime_reference_unavailable'));
        else resolve(result);
      });
    });
  };
}
