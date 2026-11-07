import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readToolkit, allowedRepository } from './toolkit-config.mjs';
import { readPolicy } from './policy.mjs';
import { codeOperation } from '../providers/code.mjs';
import { vmOperation } from '../providers/infrastructure.mjs';

const KINDS = new Set(['repo_diagnostics', 'run_tests', 'vm_inventory']);
const STATES = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted']);
const now = () => new Date().toISOString();
const idValid = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const jobFile = config => path.join(config.stateDirectory, 'toolkit-jobs.sqlite');

async function database(config) {
  const filename = jobFile(config);
  await fs.mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid_job_database');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const db = new DatabaseSync(filename, { timeout: 2000 });
  try {
    db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, root_id TEXT, relative_path TEXT,
        command TEXT, state TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
        result_json TEXT, error TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0,
        resume_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS jobs_state_created ON jobs(state, created_at);`);
    return db;
  } catch (error) { db.close(); throw error; }
}

function publicJob(row) {
  return row && { id: row.id, kind: row.kind, state: row.state,
    rootId: row.root_id ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
    startedAt: row.started_at, finishedAt: row.finished_at,
    cancelRequested: row.cancel_requested === 1, resumeCount: row.resume_count };
}

export async function submitJob(config, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || !KINDS.has(args.kind)) throw new Error('invalid_job_kind');
  const settings = await readToolkit(config);
  if (!settings.capabilities.jobs) throw new Error('job_submission_disabled');
  if (args.kind === 'vm_inventory') {
    if (!settings.capabilities.vmRead) throw new Error('vm_read_disabled');
  } else {
    if (typeof args.rootId !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(args.rootId) ||
        typeof args.relativePath !== 'string' || args.relativePath.length > 512) throw new Error('invalid_repository_path');
    if (!settings.capabilities.codeRead) throw new Error('code_read_disabled');
    await allowedRepository(config, args.rootId, args.relativePath);
    if (args.kind === 'run_tests' && (!settings.capabilities.testRun ||
        !['npm-test', 'npm-lint', 'pytest', 'git-diff-check'].includes(args.command))) throw new Error('test_execution_disabled');
  }
  const db = await database(config);
  try {
    const total = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
    if (total >= 1000) throw new Error('job_history_full_review_retention');
    const queued = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state='queued'").get().n;
    if (queued >= 100) throw new Error('job_queue_full');
    const job = { id: randomUUID(), kind: args.kind, root: args.rootId ?? null, relative: args.relativePath ?? null,
      command: args.command ?? null, created: now() };
    db.prepare(`INSERT INTO jobs (id,kind,root_id,relative_path,command,state,created_at,updated_at)
      VALUES (?,?,?,?,?,'queued',?,?)`).run(job.id, job.kind, job.root, job.relative, job.command, job.created, job.created);
    return { id: job.id, kind: job.kind, state: 'queued', createdAt: job.created };
  } finally { db.close(); }
}

export async function jobStatus(config, id) {
  if (!idValid(id)) throw new Error('invalid_job_id');
  const db = await database(config);
  try { return publicJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(id)); }
  finally { db.close(); }
}

export async function jobLogs(config, id) {
  if (!idValid(id)) throw new Error('invalid_job_id');
  const db = await database(config);
  try {
    const row = db.prepare('SELECT state,result_json,error FROM jobs WHERE id=?').get(id);
    if (!row) return null;
    return { state: row.state, error: row.error, result: row.result_json ? JSON.parse(row.result_json) : null,
      note: 'Results appear after completion. Logs are bounded and not streamed to the public dashboard.' };
  } finally { db.close(); }
}

export async function cancelJob(config, id) {
  if (!idValid(id)) throw new Error('invalid_job_id');
  const db = await database(config);
  try {
    const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
    if (!row) throw new Error('job_not_found');
    if (row.state === 'queued') {
      db.prepare("UPDATE jobs SET state='cancelled',updated_at=?,finished_at=? WHERE id=? AND state='queued'").run(now(), now(), id);
    } else if (row.state === 'running') {
      db.prepare("UPDATE jobs SET cancel_requested=1,updated_at=? WHERE id=? AND state='running'").run(now(), id);
    }
    return publicJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(id));
  } finally { db.close(); }
}

export async function resumeJob(config, id, confirm) {
  if (!idValid(id) || confirm !== true) throw new Error('explicit_resume_confirmation_required');
  const db = await database(config);
  try {
    const row = db.prepare('SELECT state,resume_count FROM jobs WHERE id=?').get(id);
    if (!row || !['interrupted', 'failed', 'cancelled'].includes(row.state)) throw new Error('job_not_resumable');
    if (row.resume_count >= 3) throw new Error('job_resume_limit');
    db.prepare(`UPDATE jobs SET state='queued',updated_at=?,started_at=NULL,finished_at=NULL,
      result_json=NULL,error=NULL,cancel_requested=0,resume_count=resume_count+1 WHERE id=?`).run(now(), id);
    return publicJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(id));
  } finally { db.close(); }
}

export async function jobSummary(config) {
  const db = await database(config);
  try {
    const counts = Object.fromEntries([...STATES].map(state => [state, 0]));
    for (const row of db.prepare('SELECT state,COUNT(*) AS n FROM jobs GROUP BY state').all()) counts[row.state] = row.n;
    const recent = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 15').all().map(publicJob);
    return { available: true, counts, recent };
  } finally { db.close(); }
}

export function startJobRunner(config) {
  let closed = false, ticking = false;
  const active = new Map();
  async function recover() {
    const db = await database(config);
    try {
      db.prepare("UPDATE jobs SET state='interrupted',error='manager_restarted_outcome_uncertain',updated_at=? WHERE state='running'").run(now());
    } finally { db.close(); }
  }
  async function finish(id, state, result, error = null) {
    const db = await database(config);
    try {
      const encoded = result ? JSON.stringify(result) : null;
      const bounded = encoded && encoded.length > 48000 ?
        JSON.stringify({ truncated: true, reason: 'job_result_too_large',
          note: 'The full result remains local to the originating command; only bounded job evidence is stored.' }) : encoded;
      db.prepare(`UPDATE jobs SET state=?,result_json=?,error=?,updated_at=?,finished_at=? WHERE id=? AND state='running'`)
        .run(state, bounded, error, now(), now(), id);
    } finally { db.close(); }
  }
  async function execute(row, signal) {
    if (row.kind === 'vm_inventory') return vmOperation('mterm_vm_list', {});
    const repository = await allowedRepository(config, row.root_id, row.relative_path);
    const disk = await fs.statfs(repository);
    const free = disk.bavail * disk.bsize;
    if (free < (config.minimumFreeDiskMiB ?? 10240) * 1048576 || os.freemem() < config.minimumFreeMemoryMiB * 1048576) {
      throw new Error('job_resource_preflight_failed');
    }
    if (row.kind === 'repo_diagnostics') {
      const details = await codeOperation('mterm_code_diagnostics', {}, repository, config, signal);
      return { ok: details.whitespace.ok && details.syntax.every(item => item.ok), details };
    }
    if (row.kind === 'run_tests') return codeOperation('mterm_test_run', { command: row.command }, repository, config, signal);
    throw new Error('unknown_job_kind');
  }
  async function run(row) {
    const controller = new AbortController();
    active.set(row.id, controller);
    let timedOut = false, timer;
    try {
      const settings = await readToolkit(config);
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, settings.jobTimeoutSeconds * 1000);
      timer.unref?.();
      const result = await execute(row, controller.signal);
      await finish(row.id, controller.signal.aborted ? 'interrupted' : result?.ok === false ? 'failed' : 'succeeded',
        result, controller.signal.aborted ? timedOut ? 'job_timeout_check_descendants' : 'cancellation_requested_check_descendants' : null);
    } catch (error) {
      await finish(row.id, controller.signal.aborted ? 'interrupted' : 'failed', null,
        controller.signal.aborted ? timedOut ? 'job_timeout_check_descendants' : 'cancellation_requested_check_descendants' : String(error?.message ?? 'job_failed').slice(0, 120));
    } finally { clearTimeout(timer); active.delete(row.id); }
  }
  async function tick() {
    if (closed || ticking) return;
    ticking = true;
    try {
      const [settings, policy] = await Promise.all([readToolkit(config), readPolicy(config.policyPath)]);
      const db = await database(config);
      try {
        for (const row of db.prepare("SELECT id FROM jobs WHERE state='running' AND cancel_requested=1").all()) {
          active.get(row.id)?.abort();
        }
        if (!settings.capabilities.jobs || !policy.enabled || policy.readOnly) return;
        const limit = Math.max(0, settings.maxConcurrentJobs - active.size);
        const rows = db.prepare("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at,id LIMIT ?").all(limit);
        for (const row of rows) {
          const changed = db.prepare("UPDATE jobs SET state='running',started_at=?,updated_at=? WHERE id=? AND state='queued'")
            .run(now(), now(), row.id).changes;
          if (changed) void run(row);
        }
      } finally { db.close(); }
    } catch { /* DB or policy failure blocks new job launches. */ }
    finally { ticking = false; }
  }
  void recover().then(tick).catch(() => {});
  const interval = setInterval(() => { void tick(); }, 2000);
  interval.unref?.();
  return { close() { closed = true; clearInterval(interval); for (const controller of active.values()) controller.abort(); } };
}
