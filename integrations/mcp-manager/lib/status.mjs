import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readBoundedJson } from './config.mjs';
import { readPolicy, QUEUE_CAPACITY } from './policy.mjs';
import { readCoordinatorStatus, GLOBAL_QUEUE_CAPACITY } from './coordinator.mjs';
import { readToolkit, projectToolkit } from './toolkit-config.mjs';
import { jobSummary } from './jobs.mjs';
import { requireValidatedDevConfig } from './dev-instance.mjs';

export const MANAGER_VERSION = '0.4.0';
const ID = /^[a-zA-Z0-9_.-]{1,64}$/;
const LABEL = /^[a-zA-Z0-9][a-zA-Z0-9 _().-]{0,79}$/;
export const BOUNDARIES = [
  'Management applies only to enrolled native clients and the authenticated remote bridge using this managed gateway.',
  'Website permissions do not restrict separately configured native or hosted MCP connections.',
  'The shared coordinator limits in-flight tool requests across enrolled gateways, not detached commands or CPU usage.',
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

async function readDeployment(stateDirectory) {
  try {
    const value = await readBoundedJson(path.join(stateDirectory, 'deployment.json'), 16 * 1024);
    return {
      sourceCommit: typeof value.sourceCommit === 'string' && /^[a-f0-9]{40}$/.test(value.sourceCommit) ? value.sourceCommit : null,
      installedAt: isoOrNull(value.completedAt),
      workerVersion: typeof value.cloudflare?.version === 'string' && /^[a-f0-9-]{36}$/.test(value.cloudflare.version) ? value.cloudflare.version : null,
      evidence: 'installation-record',
    };
  } catch { return null; }
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
        managerVersion: typeof value.managerVersion === 'string' && /^\d+\.\d+\.\d+$/.test(value.managerVersion) ? value.managerVersion : null,
        residentBytes: Number.isSafeInteger(value.residentBytes) && value.residentBytes >= 0 ? value.residentBytes : null,
      };
    } catch {
      return null;
    }
  }));
  return instances.filter(Boolean);
}

export async function collectStatus(config, startedAt = Date.now()) {
  if (!config || typeof config !== 'object') throw new Error('invalid_status_config');
  const safeStartedAt = typeof startedAt === 'number' && Number.isFinite(startedAt) ? startedAt : Date.now();
  const warnings = [];
  const [policy, toolkit, toolkitJobs, packageInfo, inventory, disk, instances, coordinator, deployment] = await Promise.all([
    readPolicy(config.policyPath).catch(() => {
      warnings.push('Policy is unavailable or invalid; managed tool execution fails closed.');
      return null;
    }),
    readToolkit(config).then(projectToolkit).catch(() => {
      warnings.push('Engineering toolkit configuration is unavailable; specialized execution fails closed.');
      return null;
    }),
    jobSummary(config).catch(() => {
      warnings.push('Durable job history could not be inspected.');
      return null;
    }),
    (async () => {
      let pkgVersion = null;
      let pkgInstalled = false;
      try {
        const version = (await readBoundedJson(config.serverPackageJsonPath)).version;
        if (typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) pkgVersion = version;
        const [serverStat, nodeStat] = await Promise.all([fs.stat(config.serverPath), fs.stat(config.nodePath)]);
        pkgInstalled = serverStat.isFile() && nodeStat.isFile();
      } catch {
        warnings.push('The configured Desktop Commander installation could not be verified.');
      }
      return { packageVersion: pkgVersion, installed: pkgInstalled };
    })(),
    readBoundedJson(config.inventoryPath).then(sanitizeInventory).catch(() => {
      warnings.push('The MCP configuration inventory is unavailable.');
      return sanitizeInventory(null);
    }),
    fs.statfs(config.stateDirectory).then(stat => ({ freeBytes: stat.bavail * stat.bsize, totalBytes: stat.blocks * stat.bsize })).catch(() => {
      warnings.push('Installation-volume disk availability could not be read.');
      return null;
    }),
    readInstances(config.stateDirectory),
    readCoordinatorStatus(config.stateDirectory, { policyPath: config.policyPath }),
    readDeployment(config.stateDirectory),
  ]);
  const { packageVersion, installed } = packageInfo;
  const activeInitializedClients = new Set(
    instances
      .filter(instance => instance.state === 'active' && instance.initialized)
      .map(instance => instance.client)
  );
  for (const item of inventory.entries) {
    if (item.management === 'managed' && activeInitializedClients.has(item.client)) {
      item.connection = 'connected';
    }
  }
  const freeMemoryBytes = os.freemem();
  const lowMemoryFloorBytes = config.minimumFreeMemoryMiB * 1024 * 1024;
  const lowDiskFloorBytes = (config.minimumFreeDiskMiB ?? 10240) * 1024 * 1024;
  const processMemory = process.memoryUsage();
  if (!coordinator.available) warnings.push('The shared admission coordinator is unavailable; managed tool execution fails closed.');
  return {
    schemaVersion: 1,
    service: {
      name: config.instance ? 'MTerm-CLI Manager DEV' : 'MTerm-CLI Manager',
      version: MANAGER_VERSION,
      state: 'running',
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - safeStartedAt) / 1000)),
      ...(config.instance ? { instance: { kind: 'dev', id: config.instance.id, port: config.instance.port, upstreamEnabled: false } } : {}),
    },
    policy,
    policyValid: policy !== null,
    toolkit,
    toolkitJobs,
    runtime: { nodeVersion: process.version, packageVersion, installed },
    deployment,
    resources: {
      freeMemoryBytes,
      totalMemoryBytes: os.totalmem(),
      lowMemoryFloorBytes,
      lowDiskFloorBytes,
      managerResidentBytes: processMemory.rss,
      managerHeapUsedBytes: processMemory.heapUsed,
      admissionOpen: !config.instance && policy !== null && policy.enabled && !policy.readOnly && freeMemoryBytes >= lowMemoryFloorBytes && disk !== null && disk.freeBytes >= lowDiskFloorBytes && coordinator.available && coordinator.uncertain < policy.maxInflight,
      disk,
    },
    limits: {
      scope: 'shared-state-directory',
      maxInflightGlobal: policy?.maxInflight ?? 1,
      queueCapacityGlobal: GLOBAL_QUEUE_CAPACITY,
      maxInflightPerInstance: policy?.maxInflight ?? 1,
      queueCapacityPerInstance: QUEUE_CAPACITY,
      detachedJobsCapped: false,
    },
    coordinator,
    instances,
    inventory,
    boundaries: [...BOUNDARIES],
    warnings,
  };
}
