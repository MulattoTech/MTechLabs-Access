import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readBoundedJson } from './config.mjs';

export const QUEUE_CAPACITY = 16;
export const MAX_PENDING_REQUESTS = 64;
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
]);
export const RESOURCE_GATED_TOOLS = new Set(['start_process', 'start_search']);

export function validatePolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== 3 ||
      !['enabled', 'readOnly', 'maxInflight'].every(key => Object.hasOwn(input, key)) ||
      typeof input.enabled !== 'boolean' || typeof input.readOnly !== 'boolean' ||
      !Number.isInteger(input.maxInflight) || input.maxInflight < 1 || input.maxInflight > 2) {
    throw new Error('invalid_policy');
  }
  return { enabled: input.enabled, readOnly: input.readOnly, maxInflight: input.maxInflight };
}

export async function readPolicy(filePath) {
  return validatePolicy(await readBoundedJson(filePath, 4096));
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
  if (RESOURCE_GATED_TOOLS.has(name) && Number.isFinite(resources.freeMemoryBytes) &&
      resources.freeMemoryBytes < resources.lowMemoryFloorBytes) {
    return { code: -32012, message: 'Available memory is below the admission threshold. No new process or search was started.' };
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
