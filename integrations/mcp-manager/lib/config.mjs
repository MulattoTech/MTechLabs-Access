import fs from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_PATHS = [
  'nodePath', 'serverPath', 'serverPackageJsonPath', 'stateDirectory',
  'policyPath', 'tokenPath', 'inventoryPath',
];
const ALLOWED_KEYS = new Set(['schemaVersion', ...REQUIRED_PATHS, 'minimumFreeMemoryMiB', 'minimumFreeDiskMiB', 'instance']);

export function normalizePortNumber(value, fallback = 19740) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1024 || value > 65535) return fallback;
  return value;
}

export function managerInstance(config) {
  if (!Object.hasOwn(config, 'instance')) return null;
  const value = config.instance;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'id,kind,port,productionConfigPath' ||
      value.kind !== 'dev' || typeof value.id !== 'string' ||
      !/^dev(?:-[a-z0-9]+)*$/.test(value.id) || value.id.length > 48 ||
      !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 || value.port === 19740 ||
      typeof value.productionConfigPath !== 'string' || !path.isAbsolute(value.productionConfigPath) ||
      value.productionConfigPath.includes('\0')) throw new Error('invalid_instance');
  return Object.freeze({ ...value });
}

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
  const config = validateConfig(input);
  // Existing CLI writers also consume this loader. A new DEV descriptor must
  // never make an otherwise-rejected production alias writable through them.
  if (config.instance) {
    const { validateDevIsolation } = await import('./dev-instance.mjs');
    return validateDevIsolation(config, configPath);
  }
  return config;
}

export function validateConfig(input) {
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
  const minimumFreeDiskMiB = input.minimumFreeDiskMiB ?? 10240;
  if (!Number.isInteger(minimumFreeDiskMiB) ||
      minimumFreeDiskMiB < 256 || minimumFreeDiskMiB > 1048576) throw new Error('invalid_config');
  if (new Set(REQUIRED_PATHS.map(key => path.resolve(input[key]))).size !== REQUIRED_PATHS.length) {
    throw new Error('overlapping_config_paths');
  }
  const instance = managerInstance(input);
  return Object.freeze({ ...input, minimumFreeMemoryMiB, minimumFreeDiskMiB, ...(instance ? { instance } : {}) });
}

export function isNonEmptyString(value, maxLen = 1024) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLen;
}

export function clampPositiveInt(value, fallback, min = 1, max = 1000000) {
  if (typeof value !== "number" || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
