import fs from 'node:fs/promises';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readBoundedJson } from './config.mjs';

export const MIN_INFLIGHT = 1;
export const MAX_INFLIGHT = 64;
export function clampInflightLimit(value, fallback = 2) {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(16, Math.max(1, value));
}

export const QUEUE_CAPACITY = 64;
export const MAX_PENDING_REQUESTS = 128;
export const READ_ONLY_TOOLS = new Set([
  'read_file',
  'read_multiple_files',
  'list_directory',
  'get_file_info',
  'list_sessions',
  'read_process_output',
  'list_searches',
  'get_more_search_results',
  'get_usage_stats',
  'mterm_math_evaluate', 'mterm_math_solve', 'mterm_math_verify', 'mterm_math_convert_units',
  'mterm_system_inventory', 'mterm_container_list',
  'mterm_vm_list', 'mterm_vm_inspect', 'mterm_vm_network_map', 'mterm_vm_disk_health',
  'mterm_vm_diagnostics', 'mterm_vm_change_plan',
  'mterm_repo_inspect', 'mterm_code_diagnostics', 'mterm_code_review_diff',
  'mterm_code_symbols', 'mterm_code_references',
  'mterm_job_status', 'mterm_job_logs',
]);
export const RESOURCE_GATED_TOOLS = new Set(['start_process', 'start_search', 'interact_with_process', 'write_pdf',
  'mterm_code_diagnostics', 'mterm_test_run', 'mterm_git_worktree_create',
  'mterm_vm_start', 'mterm_vm_checkpoint_create']);

export function validatePolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== 3 ||
      !['enabled', 'readOnly', 'maxInflight'].every(key => Object.hasOwn(input, key)) ||
      typeof input.enabled !== 'boolean' || typeof input.readOnly !== 'boolean' ||
      !Number.isInteger(input.maxInflight) || input.maxInflight < MIN_INFLIGHT || input.maxInflight > MAX_INFLIGHT) {
    throw new Error('invalid_policy');
  }
  return { enabled: input.enabled, readOnly: input.readOnly, maxInflight: input.maxInflight };
}

function validateStoredPolicy(input) {
  // This private marker fences older gateways, whose strict three-field
  // validator fails closed. The public policy API still has exactly 3 fields.
  if (input && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(input, 'coordinationVersion')) {
    if (input.coordinationVersion !== 1) throw new Error('invalid_policy');
    const { coordinationVersion, ...policy } = input;
    return validatePolicy(policy);
  }
  return validatePolicy(input);
}

export async function readPolicy(filePath) {
  return validateStoredPolicy(await readBoundedJson(filePath, 4096));
}

// Admission reads the current policy while holding the SQLite transaction.
// A bounded synchronous read keeps that transaction short and avoids an await
// allowing another connection in this process to wait on our own write lock.
export function readPolicySync(filePath) {
  const descriptor = openSync(filePath, 'r');
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 4096) throw new Error('invalid_policy');
    const bytes = Buffer.alloc(4097);
    const count = readSync(descriptor, bytes, 0, bytes.length, 0);
    if (count > 4096) throw new Error('invalid_policy');
    return validateStoredPolicy(JSON.parse(bytes.subarray(0, count).toString('utf8').replace(/^\uFEFF/, '')));
  } finally {
    closeSync(descriptor);
  }
}

export function checkToolPolicy(policy, name, args = {}, resources = {}) {
  if (!policy.enabled) return { code: -32010, message: 'Managed tools are paused. This request was not executed.' };
  if (policy.readOnly && !READ_ONLY_TOOLS.has(name)) {
    return { code: -32011, message: 'Read-only policy blocks this tool. This request was not executed.' };
  }
  if (policy.readOnly && name === 'read_file' &&
      (args?.isUrl === true || (typeof args?.path === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(args.path)))) {
    return { code: -32011, message: 'Read-only policy permits local file reads only.' };
  }
  if (policy.readOnly && name === 'read_multiple_files' &&
      Array.isArray(args?.paths) && args.paths.some(value => typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(value))) {
    return { code: -32011, message: 'Read-only policy permits local file reads only.' };
  }
  if (RESOURCE_GATED_TOOLS.has(name)) {
    if (!Number.isFinite(resources.freeMemoryBytes) || !Number.isFinite(resources.lowMemoryFloorBytes) ||
        resources.freeMemoryBytes < resources.lowMemoryFloorBytes) {
      return { code: -32012, message: 'Available memory is below the admission threshold or could not be measured. This request was not executed.' };
    }
    if (!Number.isFinite(resources.freeDiskBytes) || !Number.isFinite(resources.lowDiskFloorBytes) ||
        resources.freeDiskBytes < resources.lowDiskFloorBytes) {
      return { code: -32018, message: 'Available disk space is below the admission threshold or could not be measured. This request was not executed.' };
    }
  }
  return null;
}

export async function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const target = await fs.lstat(filePath);
    if (!target.isFile() || target.isSymbolicLink()) throw new Error('invalid_target');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temporaryPath = path.join(directory, '.' + path.basename(filePath) + '.' + randomUUID() + '.tmp');
  let handle;
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}
