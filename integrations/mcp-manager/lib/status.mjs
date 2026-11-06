import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readBoundedJson } from './config.mjs';
import { readPolicy, QUEUE_CAPACITY } from './policy.mjs';

export const MANAGER_VERSION = '0.1.0';
const ID = /^[a-zA-Z0-9_.-]{1,64}$/;
const LABEL = /^[a-zA-Z0-9][a-zA-Z0-9 _().-]{0,79}$/;
export const BOUNDARIES = [
  'Management applies only to enrolled native clients and the authenticated remote bridge using this managed gateway.',
  'Website permissions do not restrict separately configured native or hosted MCP connections.',
  'Concurrency limits count in-flight tool requests per instance, not detached commands or CPU usage.',
  'Pausing rejects new tool calls; existing commands are not terminated.',
  'Desktop Commander folder and command restrictions are guardrails, not an OS security sandbox.',
  'The self-hosted remote MCP route needs upstream OAuth authorization; native stdio and existing vendor-hosted connections remain separate.',
  'Remote backend status is not proof that a ChatGPT or Claude browser account completed its login.',
  'Upstream Desktop Commander may keep shared user-profile logs; this manager does not delete them.',
  'Inventory is a timestamped configuration snapshot, not proof of a live remote connection.',
];

function isoOrNull(input) {
  return typeof input === 'string' && Number.isFinite(Date.parse(input)) ? new Date(input).toISOString() : null;
}

export function sanitizeInventory(input) {
  const entries = Array.isArray(input?.entries) ? input.entries.slice(0, 64) : [];
  return {
    generatedAt: isoOrNull(input?.generatedAt),
    entries: entries.filter(entry => entry && typeof entry === 'object').map(entry => ({
      id: typeof entry.id === 'string' && ID.test(entry.id) ? entry.id : 'unknown',
      name: typeof entry.name === 'string' && LABEL.test(entry.name) ? entry.name : 'MCP server',
      client: typeof entry.client === 'string' && ID.test(entry.client) ? entry.client : 'unknown',
      transport: ['stdio', 'http', 'unknown'].includes(entry.transport) ? entry.transport : 'unknown',
      management: ['managed', 'hosted', 'unmanaged'].includes(entry.management) ? entry.management : 'unmanaged',
      configured: entry.configured === true,
      connection: 'unknown',
      tested: entry.tested === true,
    })),
  };
}

async function readInstances(stateDirectory) {
  const directory = path.join(stateDirectory, 'instances');
  let files;
  try {
    files = (await fs.readdir(directory)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).slice(-64);
  } catch {
    return [];
  }
  const now = Date.now();
  const instances = await Promise.all(files.map(async name => {
    try {
      const value = await readBoundedJson(path.join(directory, name), 4096);
      const id = name.slice(0, -5);
      const startedAt = isoOrNull(value.startedAt);
      const lastSeenAt = isoOrNull(value.lastSeenAt);
      if (value.id !== id || !startedAt || !lastSeenAt) return null;
      return {
        id,
        client: typeof value.client === 'string' && ID.test(value.client) ? value.client : 'unknown',
        state: now - Date.parse(lastSeenAt) < 45000 && now >= Date.parse(lastSeenAt) ? 'active' : 'stale',
        startedAt,
        lastSeenAt,
        inflight: Number.isInteger(value.inflight) ? Math.min(64, Math.max(0, value.inflight)) : 0,
        queued: Number.isInteger(value.queued) ? Math.min(QUEUE_CAPACITY, Math.max(0, value.queued)) : 0,
        initialized: value.initialized === true,
      };
    } catch {
      return null;
    }
  }));
  return instances.filter(Boolean);
}

export async function collectStatus(config, startedAt = Date.now()) {
  let policy = null;
  const warnings = [];
  try { policy = await readPolicy(config.policyPath); } catch { warnings.push('Policy is unavailable or invalid; managed tool execution fails closed.'); }
  let packageVersion = null;
  let installed = false;
  try {
    const version = (await readBoundedJson(config.serverPackageJsonPath)).version;
    if (typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) packageVersion = version;
    installed = (await fs.stat(config.serverPath)).isFile() && (await fs.stat(config.nodePath)).isFile();
  } catch { warnings.push('The configured Desktop Commander installation could not be verified.'); }
  let inventory;
  try { inventory = sanitizeInventory(await readBoundedJson(config.inventoryPath)); } catch {
    inventory = sanitizeInventory(null);
    warnings.push('The MCP configuration inventory is unavailable.');
  }
  let disk = null;
  try {
    const stat = await fs.statfs(config.stateDirectory);
    disk = { freeBytes: stat.bavail * stat.bsize, totalBytes: stat.blocks * stat.bsize };
  } catch { warnings.push('Installation-volume disk availability could not be read.'); }
  const instances = await readInstances(config.stateDirectory);
  for (const item of inventory.entries) {
    if (item.management === 'managed' &&
        instances.some(instance => instance.client === item.client && instance.state === 'active' && instance.initialized)) {
      item.connection = 'connected';
    }
  }
  const freeMemoryBytes = os.freemem();
  const lowMemoryFloorBytes = config.minimumFreeMemoryMiB * 1024 * 1024;
  return {
    schemaVersion: 1,
    service: {
      name: 'M-TechLabs MCP Manager',
      version: MANAGER_VERSION,
      state: 'running',
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    },
    policy,
    policyValid: policy !== null,
    runtime: { nodeVersion: process.version, packageVersion, installed },
    resources: {
      freeMemoryBytes,
      totalMemoryBytes: os.totalmem(),
      lowMemoryFloorBytes,
      admissionOpen: policy !== null && policy.enabled && !policy.readOnly && freeMemoryBytes >= lowMemoryFloorBytes,
      disk,
    },
    limits: {
      maxInflightPerInstance: policy?.maxInflight ?? 1,
      queueCapacityPerInstance: QUEUE_CAPACITY,
      detachedJobsCapped: false,
    },
    instances,
    inventory,
    boundaries: [...BOUNDARIES],
    warnings,
  };
}
