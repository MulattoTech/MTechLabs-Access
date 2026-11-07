import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from './policy.mjs';

const CAPABILITY_NAMES = Object.freeze([
  'math', 'systemRead', 'vmRead', 'codeRead',
  'testRun', 'repoWrite', 'vmPower', 'jobs',
]);
export const TOOLKIT_DEFAULTS = Object.freeze({
  schemaVersion: 1,
  capabilities: Object.freeze({
    math: true, systemRead: true, vmRead: true, codeRead: true,
    testRun: false, repoWrite: false, vmPower: false, jobs: false,
  }),
  roots: Object.freeze([]),
  maxConcurrentJobs: 2,
  jobTimeoutSeconds: 600,
});

export function toolkitPath(config) {
  return path.join(config.stateDirectory, 'toolkit.json');
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateToolkit(input) {
  if (!isObject(input) || Object.keys(input).sort().join(',') !==
    'capabilities,jobTimeoutSeconds,maxConcurrentJobs,roots,schemaVersion' || input.schemaVersion !== 1 ||
    !isObject(input.capabilities) || Object.keys(input.capabilities).sort().join(',') !== [...CAPABILITY_NAMES].sort().join(',') ||
    !CAPABILITY_NAMES.every(k => typeof input.capabilities[k] === 'boolean') ||
    !Array.isArray(input.roots) || input.roots.length > 8 ||
    !Number.isInteger(input.maxConcurrentJobs) || input.maxConcurrentJobs < 1 || input.maxConcurrentJobs > 8 ||
    !Number.isInteger(input.jobTimeoutSeconds) || input.jobTimeoutSeconds < 30 || input.jobTimeoutSeconds > 3600) {
    throw new Error('invalid_toolkit');
  }
  const seen = new Set();
  for (const root of input.roots) {
    if (!isObject(root) || Object.keys(root).sort().join(',') !== 'id,path' ||
      typeof root.id !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(root.id) || seen.has(root.id) ||
      typeof root.path !== 'string' || root.path.length > 320 || !path.isAbsolute(root.path)) {
      throw new Error('invalid_toolkit');
    }
    seen.add(root.id);
  }
  return {
    schemaVersion: 1,
    capabilities: Object.fromEntries(CAPABILITY_NAMES.map(k => [k, input.capabilities[k]])),
    roots: input.roots.map(root => ({ id: root.id, path: root.path })),
    maxConcurrentJobs: input.maxConcurrentJobs,
    jobTimeoutSeconds: input.jobTimeoutSeconds,
  };
}

export async function readToolkit(config) {
  let bytes;
  try { bytes = await fs.readFile(toolkitPath(config)); }
  catch (error) {
    if (error.code === 'ENOENT') return validateToolkit(TOOLKIT_DEFAULTS);
    throw error;
  }
  if (bytes.length > 16 * 1024) throw new Error('invalid_toolkit');
  return validateToolkit(JSON.parse(bytes.toString('utf8')));
}

export async function writeToolkit(config, input) {
  const data = validateToolkit(input);
  await atomicWriteJson(toolkitPath(config), data);
  return data;
}

export function projectToolkit(data) {
  return {
    schemaVersion: 1,
    capabilities: { ...data.capabilities },
    roots: data.roots.map(root => root.id), // Do not send local paths to a browser.
    maxConcurrentJobs: data.maxConcurrentJobs,
    jobTimeoutSeconds: data.jobTimeoutSeconds,
  };
}

export function validateToolkitUpdate(input, previous) {
  if (!isObject(input) || Object.keys(input).sort().join(',') !==
    'capabilities,jobTimeoutSeconds,maxConcurrentJobs' || !isObject(input.capabilities)) {
    throw new Error('invalid_toolkit_update');
  }
  return validateToolkit({ ...previous, ...input, roots: previous.roots, schemaVersion: 1 });
}

export async function allowedRepository(config, rootId, relative = '.') {
  const toolkit = await readToolkit(config);
  const root = toolkit.roots.find(item => item.id === rootId);
  if (!root || typeof relative !== 'string' || relative.length > 512 || path.isAbsolute(relative) ||
    relative.includes('\0') || /^[a-zA-Z]:/.test(relative)) throw new Error('repository_root_denied');
  const canonicalRoot = await fs.realpath(root.path);
  const canonicalTarget = await fs.realpath(path.resolve(canonicalRoot, relative));
  const difference = path.relative(canonicalRoot, canonicalTarget);
  if (difference === '..' || difference.startsWith('..' + path.sep) || path.isAbsolute(difference)) {
    throw new Error('repository_root_denied');
  }
  if (!(await fs.stat(canonicalTarget)).isDirectory()) throw new Error('repository_directory_required');
  return canonicalTarget;
}
