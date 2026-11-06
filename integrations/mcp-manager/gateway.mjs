import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig, parseArguments } from './lib/config.mjs';
import { atomicWriteJson, checkToolPolicy, readPolicy, QUEUE_CAPACITY, MAX_PENDING_REQUESTS } from './lib/policy.mjs';
import { createLineFramer, errorResponse, requestKey } from './lib/framing.mjs';

export async function startGateway({
  config,
  client = 'local-client',
  input = process.stdin,
  output = process.stdout,
  diagnostics = process.stderr,
  spawnImpl = spawn,
  freeMemory = () => os.freemem(),
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
  let activeTools = 0;
  let pumping = false;
  let initialized = false;
  let closing = false;
  let closed = false;
  let metadataTimer;
  let metadataChain = Promise.resolve();
  let diagnosticShown = false;
  let resolveCompleted;
  const completed = new Promise(resolve => { resolveCompleted = resolve; });
  const child = spawnImpl(config.nodePath, [config.serverPath, '--no-onboarding'], {
    cwd: path.dirname(config.serverPath),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    env: process.env,
  });

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

  function rejectQueued(record, error) {
    const index = queue.indexOf(record);
    if (index !== -1) queue.splice(index, 1);
    forget(record);
    send(errorResponse(record.message.id, error.code, error.message));
    touch();
  }

  function dispatch(message, isTool, recordKey) {
    const record = {
      message, key: recordKey, isTool, timedOut: false,
      timeout: setTimeout(() => {
        record.timedOut = true;
        send(errorResponse(message.id, -32002,
          'The upstream response timed out. The operation may still be running and was not killed; do not retry it blindly.'));
        if (!isTool) {
          pending.delete(recordKey);
          reserved.delete(recordKey);
        }
        // A timed-out tool keeps its slot until the child replies or exits.
        // This prevents a lost response from turning into unbounded new work.
        touch();
      }, requestTimeoutMs),
    };
    record.timeout.unref?.();
    pending.set(recordKey, record);
    if (isTool) activeTools += 1;
    try {
      sendToChild(message);
    } catch {
      pending.delete(recordKey);
      if (isTool) activeTools -= 1;
      forget(record);
      send(errorResponse(message.id, -32020, 'The local MCP child is unavailable.'));
    }
    touch();
  }

  async function pump() {
    if (pumping || closed || closing) return;
    pumping = true;
    try {
      while (queue.length && !closed && !closing) {
        const record = queue[0];
        let policy;
        try {
          policy = await readPolicy(config.policyPath);
        } catch {
          rejectQueued(record, { code: -32014, message: 'Managed policy is unavailable or invalid. This request was not executed.' });
          continue;
        }
        // A timeout or shutdown can remove this record during the disk read.
        if (queue[0] !== record) continue;
        const denied = checkToolPolicy(policy, record.message.params.name, record.message.params.arguments, {
          freeMemoryBytes: freeMemory(),
          lowMemoryFloorBytes: config.minimumFreeMemoryMiB * 1024 * 1024,
        });
        if (denied) {
          rejectQueued(record, denied);
          continue;
        }
        if (activeTools >= policy.maxInflight) break;
        queue.shift();
        clearTimeout(record.timeout);
        dispatch(record.message, true, record.key);
      }
    } finally {
      pumping = false;
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
        message, key,
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
    let key;
    try { key = requestKey(message.id); } catch { diagnostic(); return; }
    const record = pending.get(key);
    if (!record) { diagnostic(); return; }
    pending.delete(key);
    forget(record);
    if (record.isTool) activeTools -= 1;
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
  input.on('data', onInput);
  input.once('end', onInputEnd);
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
    input.removeListener('data', onInput);
    input.removeListener('end', onInputEnd);
    input.pause?.();
    for (const record of [...queue]) rejectQueued(record, { code: -32020, message: 'The local MCP child exited before this request was executed.' });
    for (const record of pending.values()) {
      forget(record);
      if (!record.timedOut) send(errorResponse(record.message.id, -32020, 'The local MCP child exited before its response completed.'));
    }
    pending.clear();
    await metadataChain.catch(() => {});
    await fs.unlink(instancePath).catch(() => {});
    resolveCompleted({ exitCode: Number.isInteger(code) ? code : 1 });
  });
  await writeMetadata();
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
