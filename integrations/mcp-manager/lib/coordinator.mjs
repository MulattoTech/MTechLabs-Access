import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { readPolicySync } from './policy.mjs';

export const GLOBAL_QUEUE_CAPACITY = 128;
export const CLIENT_QUEUE_CAPACITY = 64;
const EVENT_CAPACITY = 100;
const MAX_DATABASE_BYTES = 16 * 1024 * 1024;
const IDENTIFIER = /^[a-zA-Z0-9_.-]{1,100}$/;
const SESSION_ID = /^[a-zA-Z0-9_.-]{1,128}$/;
const retryableBusyErrors = new WeakSet();
const COORDINATION_ERROR = Object.freeze({
  code: -32017,
  message: 'Shared admission coordination is unavailable. This request was not executed.',
});

export function coordinationError() { return { ...COORDINATION_ERROR }; }

function isSqliteBusy(error) {
  return error?.code === 'ERR_SQLITE_ERROR' && Number.isInteger(error.errcode) && (error.errcode & 255) === 5;
}

// Only transaction failures known to have no committed effects are retryable.
// Callers must never infer this from an arbitrary error message or I/O error.
export function isCoordinationBusy(error) {
  return error !== null && typeof error === 'object' && retryableBusyErrors.has(error);
}

export function canonicalPolicyPath(policyPath) {
  const resolved = path.resolve(policyPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function processIsAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}

function emptyStatus() {
  return {
    available: true, scope: 'shared-state-directory', inflight: 0, queued: 0,
    uncertain: 0, queueCapacity: GLOBAL_QUEUE_CAPACITY, clients: [], recentEvents: [],
  };
}

async function checkedDatabasePath(stateDirectory, { create = false } = {}) {
  if (typeof stateDirectory !== 'string' || !path.isAbsolute(stateDirectory)) throw new Error('invalid_state_directory');
  if (create) await fs.mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const directory = await fs.lstat(stateDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('invalid_state_directory');
  const filename = path.join(stateDirectory, 'admission.sqlite');
  if (create) {
    try {
      const handle = await fs.open(filename, 'wx', 0o600);
      await handle.close();
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DATABASE_BYTES) throw new Error('invalid_coordination_file');
  if (create && process.platform !== 'win32') await fs.chmod(filename, 0o600);
  return filename;
}

function transaction(database, operation) {
  try { database.exec('BEGIN IMMEDIATE'); }
  catch (error) {
    if (isSqliteBusy(error)) retryableBusyErrors.add(error);
    throw error;
  }
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
      if (isSqliteBusy(error)) retryableBusyErrors.add(error);
    } catch { /* an unconfirmed rollback must never be retried automatically */ }
    throw error;
  }
}

function appendEvent(database, type, row, now) {
  database.prepare('INSERT INTO events (at, type, client, tool_name) VALUES (?, ?, ?, ?)')
    .run(now, type, row.client, row.tool_name);
  database.prepare('DELETE FROM events WHERE sequence NOT IN (SELECT sequence FROM events ORDER BY sequence DESC LIMIT ?)')
    .run(EVENT_CAPACITY);
}

// Dead owners can leave detached work behind. Never recycle their active
// reservations based on PID death, a stale heartbeat, elapsed time, or restart.
// PID reuse and permission errors are treated as alive, which is conservative.
function prune(database, now, isAlive) {
  const rows = database.prepare('SELECT * FROM requests').all();
  const alive = new Map();
  for (const row of rows) {
    if (!alive.has(row.owner_pid)) alive.set(row.owner_pid, isAlive(row.owner_pid));
    if (row.state === 'queued' && (row.expires_at <= now || !alive.get(row.owner_pid))) {
      database.prepare('DELETE FROM requests WHERE ticket_id = ?').run(row.ticket_id);
      appendEvent(database, row.expires_at <= now ? 'expired' : 'cancelled', row, now);
    } else if (row.state === 'active' && !alive.get(row.owner_pid)) {
      database.prepare("UPDATE requests SET state = 'uncertain' WHERE ticket_id = ?").run(row.ticket_id);
      appendEvent(database, 'orphaned', row, now);
    }
  }
}

/**
 * Durable admission shared by every gateway using one private state directory.
 * Methods after construction are synchronous and bounded. No transaction spans
 * an await, no daemon or idle timer is needed, and an admitted call is never
 * retried here. SQLite commits the reservation before the caller writes stdin.
 */
export async function createCoordinator({
  stateDirectory, sessionId, client, pid = process.pid, serverPid = null,
  policyPath, now = Date.now, isAlive = processIsAlive,
}) {
  if (!SESSION_ID.test(sessionId) || !/^[a-zA-Z0-9_.-]{1,64}$/.test(client) ||
      !Number.isSafeInteger(pid) || pid <= 0 ||
      (serverPid !== null && (!Number.isSafeInteger(serverPid) || serverPid <= 0)) ||
      typeof policyPath !== 'string' || !path.isAbsolute(policyPath)) throw new Error('invalid_coordinator_options');
  const filename = await checkedDatabasePath(stateDirectory, { create: true });
  let database;
  const initializationDeadline = Date.now() + 5000;
  for (;;) {
    try {
      database = new DatabaseSync(filename);
      // Keep lock waits short so a busy gateway can continue servicing replies
      // and cancellations. WAL avoids creating/deleting a rollback journal on
      // every admission, and readers do not delay the durable writer commit.
      database.exec('PRAGMA busy_timeout = 20');
      if (database.prepare('PRAGMA journal_mode = WAL').get()?.journal_mode !== 'wal') {
        throw new Error('shared_local_wal_required');
      }
      database.exec(`
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS metadata (
        id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL,
        last_client TEXT NOT NULL DEFAULT '', policy_path TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS requests (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL,
        client TEXT NOT NULL, owner_pid INTEGER NOT NULL, server_pid INTEGER,
        tool_name TEXT NOT NULL, queued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        acquired_at INTEGER,
        state TEXT NOT NULL CHECK (state IN ('queued', 'active', 'uncertain'))
      ) STRICT;
      CREATE INDEX IF NOT EXISTS requests_queue ON requests (state, client, sequence);
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
        type TEXT NOT NULL, client TEXT NOT NULL, tool_name TEXT NOT NULL
      ) STRICT;
      `);
      database.prepare('INSERT OR IGNORE INTO metadata (id, version, policy_path) VALUES (1, 1, ?)')
        .run(canonicalPolicyPath(policyPath));
      const metadata = database.prepare('SELECT version, policy_path FROM metadata WHERE id = 1').get();
      if (metadata?.version !== 1) throw new Error('unsupported_coordination_version');
      if (metadata.policy_path !== canonicalPolicyPath(policyPath)) throw new Error('coordination_policy_mismatch');
      break;
    } catch (error) {
      try { database?.close(); } catch { /* no tool could have been dispatched during initialization */ }
      if (!isSqliteBusy(error) || Date.now() >= initializationDeadline) throw error;
      // Only idempotent schema setup has run; closing releases any open lock.
      await delay(40 + Math.floor(Math.random() * 20));
    }
  }
  let closed = false;
  const owned = ticketId => database.prepare('SELECT * FROM requests WHERE ticket_id = ? AND session_id = ?')
    .get(ticketId, sessionId);
  function operate(operation) {
    if (closed) throw new Error('coordinator_closed');
    return transaction(database, () => {
      const timestamp = now();
      prune(database, timestamp, isAlive);
      return operation(timestamp);
    });
  }
  return {
    setServerPid(value) {
      if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) throw new Error('invalid_server_pid');
      serverPid = value;
    },

    enqueue({ ticketId, toolName, expiresAt }) {
      if (!SESSION_ID.test(ticketId) || !IDENTIFIER.test(toolName) || !Number.isSafeInteger(expiresAt)) {
        throw new Error('invalid_admission_ticket');
      }
      return operate(timestamp => {
        if (expiresAt <= timestamp) return { accepted: false, error: { code: -32016, message: 'The queued request expired before execution.' } };
        const existing = owned(ticketId);
        if (existing) return { accepted: true };
        const queued = database.prepare("SELECT COUNT(*) AS count FROM requests WHERE state = 'queued'").get().count;
        const clientQueued = database.prepare("SELECT COUNT(*) AS count FROM requests WHERE state = 'queued' AND client = ?").get(client).count;
        const row = { client, tool_name: toolName };
        if (queued >= GLOBAL_QUEUE_CAPACITY || clientQueued >= CLIENT_QUEUE_CAPACITY) {
          appendEvent(database, 'rejected', row, timestamp);
          return { accepted: false, error: { code: -32013, message: 'The shared managed tool queue is full. This request was not executed.' } };
        }
        database.prepare(`INSERT INTO requests
          (ticket_id, session_id, client, owner_pid, server_pid, tool_name, queued_at, expires_at, state)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')`)
          .run(ticketId, sessionId, client, pid, serverPid, toolName, timestamp, expiresAt);
        appendEvent(database, 'queued', row, timestamp);
        return { accepted: true };
      });
    },

    tryAcquire(ticketId, checkAdmission = () => null) {
      return operate(timestamp => {
        const row = owned(ticketId);
        if (!row) return { granted: false, error: { code: -32016, message: 'The queued request expired or was cancelled before execution.' } };
        // Idempotent reservation lookup is safe: the gateway dispatches a ticket
        // once, after this method returns, and never requeues an active ticket.
        if (row.state !== 'queued') return { granted: true };
        let policy;
        try { policy = readPolicySync(policyPath); }
        catch {
          database.prepare('DELETE FROM requests WHERE ticket_id = ?').run(ticketId);
          appendEvent(database, 'rejected', row, timestamp);
          return { granted: false, error: { code: -32014, message: 'Managed policy is unavailable or invalid. This request was not executed.' } };
        }
        const denied = checkAdmission(policy);
        if (denied || !policy.enabled) {
          database.prepare('DELETE FROM requests WHERE ticket_id = ?').run(ticketId);
          appendEvent(database, 'rejected', row, timestamp);
          return { granted: false, error: denied ?? { code: -32010, message: 'Managed tools are paused. This request was not executed.' } };
        }
        const inflight = database.prepare("SELECT COUNT(*) AS count FROM requests WHERE state != 'queued'").get().count;
        if (inflight >= policy.maxInflight) return { granted: false };
        const heads = database.prepare("SELECT client, MIN(sequence) AS sequence FROM requests WHERE state = 'queued' GROUP BY client ORDER BY client").all();
        const lastClient = database.prepare('SELECT last_client FROM metadata WHERE id = 1').get().last_client;
        const next = heads.find(head => head.client > lastClient) ?? heads[0];
        if (!next || next.sequence !== row.sequence) return { granted: false };
        database.prepare("UPDATE requests SET state = 'active', acquired_at = ? WHERE ticket_id = ?").run(timestamp, ticketId);
        database.prepare('UPDATE metadata SET last_client = ? WHERE id = 1').run(client);
        appendEvent(database, 'admitted', row, timestamp);
        return { granted: true };
      });
    },

    cancel(ticketId) {
      return operate(timestamp => {
        const row = owned(ticketId);
        if (!row || row.state !== 'queued') return false;
        database.prepare('DELETE FROM requests WHERE ticket_id = ?').run(ticketId);
        appendEvent(database, 'cancelled', row, timestamp);
        return true;
      });
    },

    release(ticketId) {
      return operate(timestamp => {
        const row = owned(ticketId);
        if (!row) return false;
        database.prepare('DELETE FROM requests WHERE ticket_id = ?').run(ticketId);
        appendEvent(database, row.state === 'queued' ? 'cancelled' : 'completed', row, timestamp);
        return true;
      });
    },

    markUncertain(ticketId) {
      return operate(timestamp => {
        const row = owned(ticketId);
        if (!row || row.state !== 'active') return false;
        database.prepare("UPDATE requests SET state = 'uncertain' WHERE ticket_id = ?").run(ticketId);
        appendEvent(database, 'uncertain', row, timestamp);
        return true;
      });
    },

    close() {
      if (closed) return;
      try {
        operate(timestamp => {
          for (const row of database.prepare('SELECT * FROM requests WHERE session_id = ?').all(sessionId)) {
            if (row.state === 'queued') {
              database.prepare('DELETE FROM requests WHERE ticket_id = ?').run(row.ticket_id);
              appendEvent(database, 'cancelled', row, timestamp);
            } else if (row.state === 'active') {
              database.prepare("UPDATE requests SET state = 'uncertain' WHERE ticket_id = ?").run(row.ticket_id);
              appendEvent(database, 'uncertain', row, timestamp);
            }
          }
        });
      } finally {
        closed = true;
        database.close();
      }
    },
  };
}

/** Sanitized, bounded status; missing DB means no client has needed admission. */
export async function readCoordinatorStatus(stateDirectory, { policyPath } = {}) {
  let database;
  try {
    let filename;
    try { filename = await checkedDatabasePath(stateDirectory); }
    catch (error) {
      if (error?.code === 'ENOENT') return emptyStatus();
      throw error;
    }
    database = new DatabaseSync(filename, { readOnly: true });
    database.exec('PRAGMA busy_timeout = 250; BEGIN');
    const metadata = database.prepare('SELECT version, policy_path FROM metadata WHERE id = 1').get();
    if (metadata?.version !== 1 || typeof metadata.policy_path !== 'string' ||
        (policyPath && metadata.policy_path !== canonicalPolicyPath(policyPath))) throw new Error('invalid_coordination_state');
    const rows = database.prepare('SELECT client, owner_pid, state, expires_at FROM requests LIMIT 1024').all();
    const status = emptyStatus();
    const groups = new Map();
    const alive = new Map();
    const timestamp = Date.now();
    for (const row of rows) {
      if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(row.client)) throw new Error('invalid_coordination_state');
      if (!alive.has(row.owner_pid)) alive.set(row.owner_pid, processIsAlive(row.owner_pid));
      if (row.state === 'queued' && (row.expires_at <= timestamp || !alive.get(row.owner_pid))) continue;
      const group = groups.get(row.client) ?? { client: row.client, inflight: 0, queued: 0, uncertain: 0 };
      if (row.state === 'queued') {
        status.queued += 1;
        group.queued += 1;
      } else {
        status.inflight += 1;
        group.inflight += 1;
        if (row.state === 'uncertain' || !alive.get(row.owner_pid)) {
          status.uncertain += 1;
          group.uncertain += 1;
        }
      }
      groups.set(row.client, group);
    }
    status.clients = [...groups.values()].sort((a, b) => a.client.localeCompare(b.client));
    status.recentEvents = database.prepare('SELECT at, type, client, tool_name FROM events ORDER BY sequence DESC LIMIT ?').all(EVENT_CAPACITY)
      .filter(row => /^(queued|admitted|completed|cancelled|expired|rejected|uncertain|orphaned|reconciled)$/.test(row.type) &&
        /^[a-zA-Z0-9_.-]{1,64}$/.test(row.client) && IDENTIFIER.test(row.tool_name) && Number.isSafeInteger(row.at))
      .map(row => ({ time: new Date(row.at).toISOString(), type: row.type, client: row.client, toolName: row.tool_name }));
    database.exec('COMMIT');
    return status;
  } catch {
    return { ...emptyStatus(), available: false, reason: 'Shared admission state is unavailable.' };
  } finally {
    try { database?.close(); } catch { /* status reads must not crash the admin service */ }
  }
}
