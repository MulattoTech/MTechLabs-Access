import fs from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_PATHS = [
  'nodePath', 'serverPath', 'serverPackageJsonPath', 'stateDirectory',
  'policyPath', 'tokenPath', 'inventoryPath',
];
const ALLOWED_KEYS = new Set(['schemaVersion', ...REQUIRED_PATHS, 'minimumFreeMemoryMiB']);

export function parseArguments(argv, allowed = ['config', 'client']) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]?.replace(/^--/, '');
    const value = argv[index + 1];
    if (!argv[index]?.startsWith('--') || !allowed.includes(name) ||
        typeof value !== 'string' || value.startsWith('--') || Object.hasOwn(result, name)) {
      throw new Error('invalid_arguments');
    }
    result[name] = value;
  }
  if (!result.config || !path.isAbsolute(result.config)) throw new Error('absolute_config_required');
  return result;
}

export async function readBoundedJson(filePath, maximumBytes = 64 * 1024) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximumBytes) throw new Error('invalid_file');
    const bytes = Buffer.alloc(maximumBytes + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > maximumBytes) throw new Error('file_too_large');
    return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, ''));
  } finally {
    await handle.close();
  }
}

export async function loadConfig(configPath) {
  const input = await readBoundedJson(configPath, 16 * 1024);
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      input.schemaVersion !== 1 || Object.keys(input).some(key => !ALLOWED_KEYS.has(key))) {
    throw new Error('invalid_config');
  }
  for (const key of REQUIRED_PATHS) {
    if (typeof input[key] !== 'string' || !path.isAbsolute(input[key]) || input[key].includes('\0')) {
      throw new Error('invalid_config');
    }
  }
  const minimumFreeMemoryMiB = input.minimumFreeMemoryMiB ?? 4096;
  if (!Number.isInteger(minimumFreeMemoryMiB) ||
      minimumFreeMemoryMiB < 256 || minimumFreeMemoryMiB > 65536) throw new Error('invalid_config');
  if (new Set(REQUIRED_PATHS.map(key => path.resolve(input[key]))).size !== REQUIRED_PATHS.length) {
    throw new Error('overlapping_config_paths');
  }
  return Object.freeze({ ...input, minimumFreeMemoryMiB });
}
