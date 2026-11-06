import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { statfsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig, parseArguments } from './lib/config.mjs';
import { atomicWriteJson, checkToolPolicy, RESOURCE_GATED_TOOLS, QUEUE_CAPACITY, MAX_PENDING_REQUESTS } from './lib/policy.mjs';
import { createCoordinator, coordinationError, isCoordinationBusy } from './lib/coordinator.mjs';
import { createLineFramer, errorResponse, requestKey } from './lib/framing.mjs';

export async function startGateway({
  config,
  client = 'local-client',
  input = process.stdin,
  output = process.stdout,
  diagnostics = process.stderr,
  spawnImpl = spawn,
  freeMemory = () => os.freemem(),
  freeDisk = () => {
    const disk = statfsSync(config.stateDirectory);
    return Number(disk.bavail) * Number(disk.bsize);
  },
  requestTimeoutMs = 120000,
  queueTimeoutMs = 30000,
}) {
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(client)) throw new Error('invalid_client');
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const instancesDirectory = path.join(config.stateDirectory, 'instances');
  const instancePath = path.join(instancesDirectory, id + '.json');
  await fs.mkdir(instancesDirectory, { recursive: true, mode: 0o700 });
  const pending = new Map();
  const reserved = new Set();
  const queue = [];
  const bookkeeping = new Map();
  let activeTools = 0;
  let pumping = false;
  let initialized = false;
  let closing = false;
  let closed = false;
  let metadataTimer;
  let queuePollTimer;
  let metadataChain = Promise.resolve();
  let diagnosticShown = false;
  let resolveCompleted;
  const completed = new Promise(resolve => { resolveCompleted = resolve; });
  let coordinator;
  try {
    coordinator = await createCoordinator({
      stateDirectory: config.stateDirectory, sessionId: id, client,
      policyPath: config.policyPath,
    });
  } catch { diagnostic(); }
  let child;
  try {
    child = spawnImpl(config.nodePath, [config.serverPath, '--no-onboarding'], {
      cwd: path.dirname(config.serverPath),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      env: process.env,
    });
    coordinator?.setServerPid(child.pid ?? null);
  } catch (error) {
    try { coordinator?.close(); } catch { /* no request has been admitted */ }
    throw error;
  }

  function diagnostic() {
    if (!diagnosticShown) {
      diagnosticShown = true;
      diagnostics.write('MCP Manager: a local child diagnostic occurred; raw child logs are not forwarded.\n');
    }
  }

  function send(message) {
    if (output.destroyed || output.writableEnded) return;
    try {
      if (!output.write(JSON.stringify(message) + '\n')) {
        child.stdout.pause();
        input.pause?.();
        output.once('drain', () => {
          if (!closed) child.stdout.resume();
          if (!closing) input.resume?.();
        });
      }
    } catch {
      close();
    }
  }

  function sendToChild(message) {
    if (closed || child.stdin.destroyed || child.stdin.writableEnded) throw new Error('child_closed');
    if (!child.stdin.write(JSON.stringify(message) + '\n')) {
      input.pause?.();
      child.stdin.once('drain', () => { if (!closing) input.resume?.(); });
    }
  }

  function writeMetadata() {
    const snapshot = {
      id, client, pid: process.pid, serverPid: child.pid ?? null, startedAt,
      lastSeenAt: new Date().toISOString(), initialized,
      inflight: activeTools, queued: queue.length,
      managerVersion: '0.3.0', coordinationVersion: 1,
      residentBytes: process.memoryUsage().rss,
    };
    metadataChain = metadataChain.then(() => atomicWriteJson(instancePath, snapshot)).catch(diagnostic);
    return metadataChain;
  }

  function touch() {
    if (metadataTimer || closed) return;
    metadataTimer = setTimeout(() => {
      metadataTimer = undefined;
      if (!closed) void writeMetadata();
    }, 250);
    metadataTimer.unref?.();
  }

  function forget(record) {
    clearTimeout(record.timeout);
    reserved.delete(record.key);
  }

  function updateReservation(ticketId, action) {
    // A definitive response supersedes a pending uncertainty update. These are
    // idempotent accounting operations only: retrying never writes child stdin.
    const previous = bookkeeping.get(ticketId);
    if (previous?.action === 'release' && action !== 'release') return;
    try {
      coordinator?.[action](ticketId);
      bookkeeping.delete(ticketId);
    } catch (error) {
      if (isCoordinationBusy(error)) {
        bookkeeping.set(ticketId, { action, deadline: previous?.action === action ? previous.deadline : Date.now() + 5000 });
        schedulePump();
      } else {
        bookkeeping.delete(ticketId);
        diagnostic();
      }
    }
  }

  function flushBookkeeping() {
    for (const [ticketId, task] of bookkeeping) {
      try {
        coordinator?.[task.action](ticketId);
        bookkeeping.delete(ticketId);
      } catch (error) {
        if (isCoordinationBusy(error) && Date.now() < task.deadline) return;
        // Exhausted/unknown failures retain the database reservation. They do
        // not turn an uncertain outcome into new capacity or a tool retry.
        bookkeeping.delete(ticketId);
        diagnostic();
      }
    }
  }

  function rejectQueued(record, error) {
    const index = queue.indexOf(record);
    if (index === -1) return;
    queue.splice(index, 1);
    if (record.registered) updateReservation(record.ticketId, 'cancel');
    forget(record);
    send(errorResponse(record.message.id, error.code, error.message));
    touch();
  }

  function dispatch(message, isTool, recordKey, ticketId) {
    const record = {
      message, key: recordKey, isTool, ticketId, timedOut: false,
      timeout: setTimeout(() => {
        record.timedOut = true;
        send(errorResponse(message.id, -32002,
          'The upstream response timed out. The operation may still be running and was not killed; do not retry it blindly.'));
        if (!isTool) {
          pending.delete(recordKey);
          reserved.delete(recordKey);
        } else {
          updateReservation(ticketId, 'markUncertain');
        }
        // A timed-out tool keeps its shared reservation until a definitive
        // response arrives. Child exit cannot prove detached work has ended.
        touch();
      }, requestTimeoutMs),
    };
    record.timeout.unref?.();
    pending.set(recordKey, record);
    if (isTool) activeTools += 1;
    try {
      sendToChild(message);
    } catch {
      if (isTool) {
        // A failed stream write can still have reached the child. Keep the
        // durable permit and never dispatch this request a second time.
        record.timedOut = true;
        clearTimeout(record.timeout);
        updateReservation(ticketId, 'markUncertain');
        send(errorResponse(message.id, -32020,
          'The local MCP transport failed. The operation may still be running; do not retry it blindly.'));
      } else {
        pending.delete(recordKey);
        forget(record);
        send(errorResponse(message.id, -32020, 'The local MCP child is unavailable.'));
      }
    }
    touch();
  }

  function schedulePump() {
    if (queuePollTimer || (!queue.length && !bookkeeping.size) || closed || (closing && !bookkeeping.size)) return;
    // Other gateway processes release permits independently. Poll only while
    // there is queued work or bounded accounting cleanup; idle clients have no
    // admission timer, and closing clients only finish accounting.
    queuePollTimer = setTimeout(() => {
      queuePollTimer = undefined;
      pump();
    }, 40 + Math.floor(Math.random() * 20));
    queuePollTimer.unref?.();
  }

  function admissionCheck(policy, record) {
    const resources = {
      lowMemoryFloorBytes: (config.minimumFreeMemoryMiB ?? 4096) * 1024 * 1024,
      lowDiskFloorBytes: (config.minimumFreeDiskMiB ?? 10240) * 1024 * 1024,
    };
    if (RESOURCE_GATED_TOOLS.has(record.message.params.name)) {
      try { resources.freeMemoryBytes = freeMemory(); } catch { resources.freeMemoryBytes = NaN; }
      try { resources.freeDiskBytes = freeDisk(); } catch { resources.freeDiskBytes = NaN; }
    }
    return checkToolPolicy(policy, record.message.params.name, record.message.params.arguments, resources);
  }

  function pump() {
    if (pumping || closed) return;
    pumping = true;
    try {
      flushBookkeeping();
      if (closing) return;
      // Registration can be briefly blocked by another process's commit. Keep
      // those not-yet-accepted requests in the already bounded local queue and
      // retry only confirmed SQLITE_BUSY rollbacks, preserving arrival order.
      for (const record of [...queue]) {
        if (record.registered) continue;
        let registration;
        try {
          if (!coordinator) throw new Error('coordinator_unavailable');
          registration = coordinator.enqueue({
            ticketId: record.ticketId, toolName: record.message.params.name,
            expiresAt: record.expiresAt,
          });
        } catch (error) {
          if (isCoordinationBusy(error)) break;
          rejectQueued(record, coordinationError());
          continue;
        }
        if (!registration.accepted) rejectQueued(record, registration.error);
        else record.registered = true;
      }
      while (queue.length && !closed && !closing) {
        const record = queue[0];
        if (!record.registered) break;
        let admission;
        try {
          if (!coordinator) throw new Error('coordinator_unavailable');
          admission = coordinator.tryAcquire(record.ticketId, policy => admissionCheck(policy, record));
        } catch (error) {
          if (isCoordinationBusy(error)) break;
          rejectQueued(record, coordinationError());
          continue;
        }
        if (admission.error) {
          rejectQueued(record, admission.error);
          continue;
        }
        if (!admission.granted) break;
        queue.shift();
        clearTimeout(record.timeout);
        dispatch(record.message, true, record.key, record.ticketId);
      }
    } finally {
      pumping = false;
      schedulePump();
    }
  }

  function receiveClientLine(line) {
    let message;
    try { message = JSON.parse(line); } catch {
      send(errorResponse(null, -32700, 'Invalid JSON frame.'));
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
      send(errorResponse(null, -32600, 'Invalid JSON-RPC message.'));
      return;
    }
    if (closed || closing) {
      if (Object.hasOwn(message, 'id')) send(errorResponse(message.id, -32020, 'The local MCP child is unavailable.'));
      return;
    }
    if (typeof message.method !== 'string') {
      // Responses to a server-initiated MCP request are passed back to it.
      if (Object.hasOwn(message, 'id') && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) {
        try { requestKey(message.id); sendToChild(message); } catch {
          send(errorResponse(null, -32600, 'Invalid response or unavailable child.'));
        }
      } else {
        send(errorResponse(null, -32600, 'Invalid JSON-RPC message.'));
      }
      return;
    }
    const hasId = Object.hasOwn(message, 'id');
    if (!hasId) {
      // Tool calls must be requests so they cannot bypass admission tracking.
      if (message.method === 'tools/call') {
        send(errorResponse(null, -32600, 'Tool calls require a request identifier.'));
      } else {
        if (message.method === 'notifications/cancelled' && Object.hasOwn(message.params ?? {}, 'requestId')) {
          try {
            const key = requestKey(message.params.requestId);
            const queued = queue.find(record => record.key === key);
            if (queued) {
              rejectQueued(queued, { code: -32800, message: 'The request was cancelled before execution.' });
              void pump();
              return;
            }
          } catch {
            diagnostic();
            return;
          }
        }
        try { sendToChild(message); } catch { diagnostic(); }
      }
      return;
    }
    let key;
    try { key = requestKey(message.id); } catch {
      send(errorResponse(null, -32600, 'Invalid request identifier.'));
      return;
    }
    if (reserved.has(key)) {
      send(errorResponse(message.id, -32600, 'Duplicate request identifier.'));
      return;
    }
    if (reserved.size >= MAX_PENDING_REQUESTS) {
      send(errorResponse(message.id, -32013, 'The managed request capacity is full. This request was not executed.'));
      return;
    }
    if (message.method === 'tools/call') {
      if (!message.params || typeof message.params !== 'object' || Array.isArray(message.params) ||
          typeof message.params.name !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(message.params.name)) {
        send(errorResponse(message.id, -32602, 'Invalid tool-call parameters.'));
        return;
      }
      if (queue.length >= QUEUE_CAPACITY) {
        send(errorResponse(message.id, -32013, 'The managed tool queue is full. This request was not executed.'));
        return;
      }
      reserved.add(key);
      const record = {
        message, key, ticketId: randomUUID(), registered: false,
        expiresAt: Date.now() + queueTimeoutMs,
        timeout: setTimeout(() => {
          rejectQueued(record, { code: -32016, message: 'The queued request expired before execution.' });
          void pump();
        }, queueTimeoutMs),
      };
      record.timeout.unref?.();
      queue.push(record);
      touch();
      void pump();
      return;
    }
    reserved.add(key);
    dispatch(message, false, key);
  }

  function receiveChildLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { diagnostic(); return; }
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
      diagnostic();
      return;
    }
    if (typeof message.method === 'string') {
      send(message);
      return;
    }
    if (!Object.hasOwn(message, 'id')) { diagnostic(); return; }
    const hasResult = Object.hasOwn(message, 'result');
    const hasError = Object.hasOwn(message, 'error');
    if (hasResult === hasError || (hasError && (!message.error || typeof message.error !== 'object' ||
        !Number.isInteger(message.error.code) || typeof message.error.message !== 'string'))) {
      diagnostic();
      return;
    }
    let key;
    try { key = requestKey(message.id); } catch { diagnostic(); return; }
    const record = pending.get(key);
    if (!record) { diagnostic(); return; }
    pending.delete(key);
    forget(record);
    if (record.isTool) {
      activeTools -= 1;
      updateReservation(record.ticketId, 'release');
    }
    if (record.message.method === 'initialize' && Object.hasOwn(message, 'result') && !message.error) initialized = true;
    if (!record.timedOut) send(message);
    touch();
    void pump();
  }

  const clientFrames = createLineFramer({
    maxBytes: 1024 * 1024,
    onLine: receiveClientLine,
    onError: () => send(errorResponse(null, -32600, 'The client message exceeded the managed frame limit.')),
  });
  const childFrames = createLineFramer({
    maxBytes: 8 * 1024 * 1024,
    onLine: receiveChildLine,
    onError: diagnostic,
  });
  const onInput = chunk => clientFrames.push(chunk);
  const onInputEnd = () => { clientFrames.end(); close(); };
  input.once('error', close);
  output.once('error', close);
  child.stdout.on('data', chunk => childFrames.push(chunk));
  child.stdout.once('end', () => childFrames.end());
  child.stderr.on('data', diagnostic);
  child.stdin.on('error', diagnostic);
  child.once('error', diagnostic);
  const heartbeat = setInterval(() => { if (!closed) { void writeMetadata(); void pump(); } }, 15000);
  heartbeat.unref?.();

  function close() {
    if (closing || closed) return;
    closing = true;
    clearTimeout(queuePollTimer);
    queuePollTimer = undefined;
    for (const record of [...queue]) {
      rejectQueued(record, { code: -32020, message: 'The local client is disconnecting. This queued request was not executed.' });
    }
    // Close only our owned MCP transport. Never kill a process tree or an
    // independently running command, and never alter another client session.
    child.stdin.end();
  }

  child.once('close', async code => {
    closed = true;
    closing = true;
    clearInterval(heartbeat);
    clearTimeout(metadataTimer);
    clearTimeout(queuePollTimer);
    queuePollTimer = undefined;
    input.removeListener('data', onInput);
    input.removeListener('end', onInputEnd);
    input.pause?.();
    for (const record of [...queue]) rejectQueued(record, { code: -32020, message: 'The local MCP child exited before this request was executed.' });
    for (const record of pending.values()) {
      forget(record);
      if (!record.timedOut) send(errorResponse(record.message.id, -32020, 'The local MCP child exited before its response completed.'));
    }
    pending.clear();
    const accountingDeadline = Date.now() + 5000;
    while (bookkeeping.size && Date.now() < accountingDeadline) {
      flushBookkeeping();
      if (bookkeeping.size) await delay(40);
    }
    try { coordinator?.close(); } catch { diagnostic(); }
    await metadataChain.catch(() => {});
    await fs.unlink(instancePath).catch(() => {});
    resolveCompleted({ exitCode: Number.isInteger(code) ? code : 1 });
  });
  await writeMetadata();
  // Persist the initial heartbeat before consuming buffered client input. A
  // cold initialize response must never precede the existence of its session.
  if (!closed && !closing) {
    input.on('data', onInput);
    input.once('end', onInputEnd);
    if (input.readableEnded) close();
  }
  return { id, child, completed, close };
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2));
    const config = await loadConfig(args.config);
    const gateway = await startGateway({ config, client: args.client ?? 'local-client' });
    process.once('SIGINT', gateway.close);
    process.once('SIGTERM', gateway.close);
    process.exitCode = (await gateway.completed).exitCode;
  } catch {
    process.stderr.write('MCP Manager gateway could not start. Check the local configuration and installation.\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
