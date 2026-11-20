import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { loadConfig, parseArguments } from './lib/config.mjs';
import { readPolicySync } from './lib/policy.mjs';
import { canonicalPolicyPath } from './lib/coordinator.mjs';
import { requireValidatedDevConfig } from './lib/dev-instance.mjs';

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('invalid_recorded_pid');
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}

async function openDatabase(config, readOnly) {
  requireValidatedDevConfig(config);
  const { stateDirectory } = config;
  const directory = await fs.lstat(stateDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('invalid_state_directory');
  const filename = path.join(stateDirectory, 'admission.sqlite');
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('invalid_coordination_file');
  const database = new DatabaseSync(filename, { readOnly });
  try {
    database.exec('PRAGMA busy_timeout = 250');
    if (!readOnly) database.exec('PRAGMA synchronous = FULL');
    const metadata = database.prepare('SELECT version, policy_path FROM metadata WHERE id = 1').get();
    if (metadata?.version !== 1) {
      throw new Error('unsupported_coordination_version');
    }
    if (metadata.policy_path !== canonicalPolicyPath(config.policyPath)) throw new Error('coordination_policy_mismatch');
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

/** Local owner diagnostics only. This is never exposed through the HTTP API. */
export async function inspectAdmissions(config, { isAlive = processIsAlive } = {}) {
  let database;
  try {
    try { database = await openDatabase(config, true); }
    catch (error) {
      if (error?.code === 'ENOENT') return { requests: [], evidence: 'local-reservation-state' };
      throw error;
    }
    const rows = database.prepare(`SELECT ticket_id, client, tool_name, owner_pid, server_pid,
      state, queued_at, acquired_at FROM requests ORDER BY sequence LIMIT 1025`).all();
    if (rows.length > 1024) throw new Error('oversized_coordination_state');
    return {
      evidence: 'local-reservation-state',
      requests: rows.map(row => {
        const ownerRunning = isAlive(row.owner_pid);
        const serverRunning = row.server_pid === null ? null : isAlive(row.server_pid);
        return {
          ticketId: row.ticket_id, client: row.client, toolName: row.tool_name,
          ownerPid: row.owner_pid, serverPid: row.server_pid,
          recordedState: row.state,
          effectiveState: row.state === 'active' && !ownerRunning ? 'uncertain' : row.state,
          ownerRunning, serverRunning,
          queuedAt: new Date(row.queued_at).toISOString(),
          admittedAt: row.acquired_at === null ? null : new Date(row.acquired_at).toISOString(),
        };
      }),
    };
  } finally { database?.close(); }
}

/**
 * A stopped gateway or upstream is not proof that detached work has ended.
 * Require an explicit owner acknowledgement as well as a paused policy and
 * both recorded processes being gone. Never resend a request or delete the DB.
 */
export async function resolveAdmission(config, ticketId, confirmation, {
  isAlive = processIsAlive, now = Date.now,
} = {}) {
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(ticketId ?? '')) throw new Error('invalid_ticket_id');
  if (confirmation !== 'work-ended') throw new Error('confirm_detached_work_has_ended');
  const database = await openDatabase(config, false);
  try {
    database.exec('BEGIN IMMEDIATE');
    if (readPolicySync(config.policyPath).enabled) throw new Error('pause_managed_tools_before_recovery');
    const row = database.prepare('SELECT * FROM requests WHERE ticket_id = ?').get(ticketId);
    if (!row) throw new Error('ticket_not_found');
    if (row.state === 'queued') throw new Error('ticket_is_queued_not_uncertain');
    if (isAlive(row.owner_pid)) throw new Error('recorded_gateway_is_still_running');
    if (row.server_pid === null) throw new Error('upstream_pid_unknown_cannot_confirm_stopped');
    if (isAlive(row.server_pid)) throw new Error('recorded_upstream_is_still_running');
    if (row.state !== 'active' && row.state !== 'uncertain') throw new Error('invalid_ticket_state');
    database.prepare('DELETE FROM requests WHERE ticket_id = ?').run(ticketId);
    database.prepare('INSERT INTO events (at, type, client, tool_name) VALUES (?, ?, ?, ?)')
      .run(now(), 'reconciled', row.client, row.tool_name);
    database.exec('DELETE FROM events WHERE sequence NOT IN (SELECT sequence FROM events ORDER BY sequence DESC LIMIT 100)');
    database.exec('COMMIT');
    return { resolved: true, ticketId, client: row.client, toolName: row.tool_name, retried: false };
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* preserve the refusal */ }
    throw error;
  } finally { database.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = parseArguments(process.argv.slice(2), ['config', 'action', 'ticket', 'confirm']);
    const config = await loadConfig(args.config);
    let result;
    if ((args.action ?? 'inspect') === 'inspect' && !args.ticket && !args.confirm) {
      result = await inspectAdmissions(config);
    } else if (args.action === 'resolve') {
      result = await resolveAdmission(config, args.ticket, args.confirm);
    } else throw new Error('invalid_recovery_arguments');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    const reason = /^[a-z_]+$/.test(error?.message ?? '') ? error.message : 'coordination_recovery_failed';
    process.stderr.write('MCP admission recovery refused: ' + reason + '\n');
    process.exitCode = 1;
  }
}
