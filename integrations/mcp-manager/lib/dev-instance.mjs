import fs from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { managerInstance, readBoundedJson, validateConfig } from './config.mjs';
import { loadTokenDigest } from './token.mjs';

const CONTROL_KEYS = ['policyPath', 'tokenPath', 'inventoryPath'];
const OWNER_FILE = 'manager-owner.lock';
const validated = new WeakSet();
const owned = new WeakSet();

export function requireValidatedDevConfig(config) {
  if (managerInstance(config) && !validated.has(config)) throw new Error('dev_validation_required');
}

export function requireDevOwnership(config) {
  requireValidatedDevConfig(config);
  if (config.instance && !owned.has(config)) throw new Error('dev_ownership_required');
}
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
const within = (parent, child) => {
  const relative = path.relative(fold(parent), fold(child));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};
const overlap = (a, b) => within(a, b) || within(b, a);

// Reject links in every ancestor, not just the final component. realpath also
// resolves ordinary Windows short names; comparisons use native case semantics.
async function ordinaryPath(filename, directory = false) {
  if (process.platform === 'win32') {
    const { root } = path.parse(filename);
    // Local drive paths only. Do not let ADS, device/UNC namespaces or Win32
    // trailing-dot/space normalization evade reserved names or file identity.
    if (!/^[a-z]:[\\/]$/i.test(root) || filename.slice(root.length).split(/[\\/]/).some(part =>
      part !== '.' && part !== '..' && (/[ .]$/.test(part) || /[<>:"|?*\x00-\x1f]/.test(part)))) {
      throw new Error('dev_invalid_path');
    }
  }
  let current = path.resolve(filename);
  const leaf = await fs.lstat(current, { bigint: true });
  if (directory ? !leaf.isDirectory() : !leaf.isFile()) throw new Error('dev_invalid_path');
  while (true) {
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('dev_linked_path');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { filename: await fs.realpath(filename), stat: leaf };
}

async function scanState(directory) {
  let count = 0;
  async function walk(root, depth) {
    if (depth > 8) throw new Error('dev_state_scan_limit');
    const entries = await fs.opendir(root);
    for await (const entry of entries) {
      if (++count > 4096) throw new Error('dev_state_scan_limit');
      const filename = path.join(root, entry.name);
      const stat = await fs.lstat(filename, { bigint: true });
      if (stat.isSymbolicLink()) throw new Error('dev_linked_state');
      if (stat.isDirectory()) await walk(filename, depth + 1);
      else if (!stat.isFile() || stat.nlink !== 1n) throw new Error('dev_shared_state_file');
    }
  }
  await walk(directory, 0);
}

function reserved(state, filename) {
  const relative = fold(path.relative(state, filename)).split(path.sep);
  return relative.length !== 1 || ['toolkit.json', 'toolkit-jobs.sqlite', 'toolkit-jobs.sqlite-wal',
    'toolkit-jobs.sqlite-shm', 'admission.sqlite', 'admission.sqlite-wal', 'admission.sqlite-shm',
    'deployment.json', 'instances', OWNER_FILE].includes(relative[0]);
}

// This is a startup topology check against an operator-selected authoritative
// production reference. It is not a sandbox against concurrent local retargeting.
export async function validateDevIsolation(input, configPath) {
  const config = validateConfig(input);
  if (!config.instance) return config;
  if (typeof configPath !== 'string' || !path.isAbsolute(configPath) || configPath.includes('\0')) {
    throw new Error('dev_config_required');
  }
  try {
    const ownConfig = await ordinaryPath(configPath);
    const protectedConfig = await ordinaryPath(config.instance.productionConfigPath);
    const onDisk = validateConfig(await readBoundedJson(ownConfig.filename, 16 * 1024));
    if (!isDeepStrictEqual(config, onDisk)) {
      throw new Error('dev_config_mismatch');
    }
    const production = validateConfig(await readBoundedJson(protectedConfig.filename, 16 * 1024));
    if (production.instance) throw new Error('dev_production_reference_required');
    const state = await ordinaryPath(config.stateDirectory, true);
    const prodState = await ordinaryPath(production.stateDirectory, true);
    if (overlap(state.filename, prodState.filename)) throw new Error('dev_state_overlap');
    const controls = [ownConfig, ...await Promise.all(CONTROL_KEYS.map(key => ordinaryPath(config[key])))];
    const protectedFiles = [protectedConfig, ...await Promise.all(CONTROL_KEYS.map(key => ordinaryPath(production[key])))];
    if (new Set(controls.map(item => fold(item.filename))).size !== controls.length) throw new Error('dev_control_overlap');
    for (const item of controls) {
      if (!within(state.filename, item.filename) || reserved(state.filename, item.filename) || item.stat.nlink !== 1n) {
        throw new Error('dev_control_path');
      }
    }
    // Read-only runtime files may be shared, but must never be inside DEV state.
    for (const filename of [...protectedFiles.map(item => item.filename),
      ...['nodePath', 'serverPath', 'serverPackageJsonPath'].flatMap(key => [config[key], production[key]])]) {
      const actual = await ordinaryPath(filename);
      if (overlap(state.filename, actual.filename)) throw new Error('dev_protected_path_overlap');
    }
    await scanState(state.filename);
    if (timingSafeEqual(await loadTokenDigest(config.tokenPath), await loadTokenDigest(production.tokenPath))) {
      throw new Error('dev_credential_overlap');
    }
    validated.add(config);
    return config;
  } catch (error) {
    if (typeof error.message === 'string' && /^dev_[a-z_]+$/.test(error.message)) throw error;
    throw new Error('dev_isolation_unverified');
  }
}

export async function acquireDevOwnership(config) {
  requireValidatedDevConfig(config);
  const filename = path.join(config.stateDirectory, OWNER_FILE);
  let handle;
  try { handle = await fs.open(filename, 'wx', 0o600); }
  catch (error) { throw new Error(error.code === 'EEXIST' ? 'dev_state_owned' : 'dev_owner_unavailable'); }
  let identity;
  try { identity = await handle.stat({ bigint: true }); }
  catch { await handle.close(); throw new Error('dev_owner_unavailable'); }
  let releasePromise;
  function release() {
    if (releasePromise) return releasePromise;
    // Revoke the proof synchronously: no new runner may begin while the
    // identity check/unlink is awaiting filesystem completion.
    owned.delete(config);
    return releasePromise = (async () => {
      try {
        const current = await fs.lstat(filename, { bigint: true });
        if (!current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) {
          throw new Error('dev_owner_changed');
        }
        await fs.unlink(filename);
      } finally { await handle.close(); }
    })();
  }
  try { await handle.writeFile(JSON.stringify({ id: config.instance.id, port: config.instance.port, pid: process.pid })); }
  catch { await release(); throw new Error('dev_owner_unavailable'); }
  owned.add(config);
  return { release };
}
