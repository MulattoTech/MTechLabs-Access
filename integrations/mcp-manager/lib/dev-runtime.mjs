import path from 'node:path';
import os from 'node:os';
import { validateConfig } from './config.mjs';
import { ordinaryPath, validateDevIsolation } from './dev-instance.mjs';
import { validateRuntimePlan, evaluateRuntime, windowsPath, profileOverlap } from './dev-runtime-plan.mjs';
import { captureWindowsRuntime } from './runtime-identity.mjs';
import { readBytes, snapshot } from './runtime-files.mjs';

async function digestOnly(filename) {
  if (!/^sha256:[a-fA-F0-9]{64}$/.test((await readBytes(filename, 1024)).toString('utf8').trim())) {
    throw new Error('runtime_digest_only_credentials_required');
  }
}
async function sameFile(left, right) {
  const [a, b] = await Promise.all([ordinaryPath(left), ordinaryPath(right)]);
  if (windowsPath(a.filename) !== windowsPath(b.filename)) throw new Error('runtime_reference_mismatch');
}

export async function readRuntimeInputs(configPath, planPath) {
  if (process.platform !== 'win32') throw new Error('dev_runtime_platform_unsupported');
  try {
    const own = await snapshot(configPath), config = validateConfig(own.value);
    if (!config.instance) throw new Error('runtime_dev_config_required');
    const expectedPlan = path.join(config.stateDirectory, 'dev-runtime-plan.json');
    await sameFile(planPath, expectedPlan);
    const selected = await snapshot(planPath), plan = validateRuntimePlan(selected.value);
    const production = await snapshot(config.instance.productionConfigPath);
    const prod = validateConfig(production.value);
    if (prod.instance || plan.instanceId !== config.instance.id || plan.development.manager.port !== config.instance.port) {
      throw new Error('runtime_reference_mismatch');
    }
    // Never recommend exposing a legacy plaintext production bearer to DEV.
    await digestOnly(config.tokenPath); await digestOnly(prod.tokenPath);
    await validateDevIsolation(config, configPath);
    await sameFile(plan.production.manager.configPath, config.instance.productionConfigPath);
    await sameFile(plan.development.manager.configPath, configPath);
    await sameFile(plan.development.manager.nodePath, process.execPath);
    const managers = [];
    const files = [];
    for (const role of [plan.production, plan.development]) {
      const canonical = { ...role.manager };
      for (const key of ['nodePath', 'entryPath', 'configPath']) {
        const actual = await ordinaryPath(role.manager[key]);
        canonical[key] = actual.filename;
        if (key !== 'nodePath') files.push(actual);
      }
      managers.push(canonical);
    }
    if (new Set(files.map(file => windowsPath(file.filename))).size !== 4 ||
        new Set(files.map(file => file.stat.dev + ':' + file.stat.ino)).size !== 4) throw new Error('runtime_entry_overlap');
    const prodProfile = await ordinaryPath(plan.production.profileDirectory, true);
    const devProfile = await ordinaryPath(plan.development.profileDirectory, true);
    if (profileOverlap(prodProfile.filename, devProfile.filename)) throw new Error('runtime_profile_overlap');
    const canonicalPlan = validateRuntimePlan({ ...plan,
      production: { ...plan.production, manager: managers[0], profileDirectory: prodProfile.filename },
      development: { ...plan.development, manager: managers[1], profileDirectory: devProfile.filename } });
    return { config, plan: canonicalPlan, fingerprints: { evidence: 'current-file-snapshots', config: own.sha256,
      productionConfig: production.sha256, plan: selected.sha256 } };
  } catch (error) {
    if (/^(runtime_|dev_|invalid_dev_runtime_plan)/.test(error?.message ?? '')) throw error;
    throw new Error('runtime_reference_unavailable');
  }
}

export async function inspectDevRuntime(configPath, planPath) {
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH) throw new Error('node_preload_environment_rejected');
  const { plan, fingerprints } = await readRuntimeInputs(configPath, planPath);
  const observations = await captureWindowsRuntime({ production: plan.production.manager, development: plan.development.manager });
  for (const key of ['current', 'production', 'development']) {
    if (observations[key]?.status !== 'observed') continue;
    try { observations[key].profileDirectory = (await ordinaryPath(observations[key].profileDirectory, true)).filename; }
    catch { observations[key] = { status: 'unverified' }; }
  }
  // This independent OS lookup cannot be replaced by the environment home.
  try {
    if (observations.current?.status === 'observed' &&
        windowsPath((await ordinaryPath(os.userInfo().homedir, true)).filename) !== windowsPath(observations.current.profileDirectory)) {
      observations.current = { status: 'unverified' };
    }
  } catch { observations.current = { status: 'unverified' }; }
  return { ...evaluateRuntime(plan, observations, process.env), fingerprints };
}
