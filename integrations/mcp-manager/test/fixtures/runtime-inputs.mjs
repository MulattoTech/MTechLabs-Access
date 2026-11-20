import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fixture } from '../helpers.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export async function runtimeInputs(t) {
  const prod = await fixture(t), dev = await fixture(t);
  prod.configPath = path.join(prod.directory, 'manager.json');
  await fs.writeFile(prod.configPath, JSON.stringify(prod.config));
  for (const key of ['policyPath', 'tokenPath', 'inventoryPath']) {
    const previous = dev.config[key];
    dev.config[key] = path.join(dev.config.stateDirectory, path.basename(previous));
    await fs.rename(previous, dev.config[key]);
  }
  await fs.writeFile(dev.config.tokenPath, 'sha256:' + hash('independent-runtime-fixture-token'));
  dev.configPath = path.join(dev.config.stateDirectory, 'manager.json');
  dev.config.instance = { kind: 'dev', id: 'dev-runtime-fixture', port: 19741, productionConfigPath: prod.configPath };
  await fs.writeFile(dev.configPath, JSON.stringify(dev.config));
  for (const target of [prod, dev]) {
    target.entryPath = path.join(target.directory, 'admin.mjs');
    target.profile = path.join(target.directory, 'profile');
    await fs.writeFile(target.entryPath, '// inert fixture; never executed\n');
    await fs.mkdir(target.profile);
  }
  const makeRole = (target, production) => ({
    principalSid: 'S-1-5-21-111-222-333-' + (production ? '1001' : '1002'),
    profileDirectory: target.profile,
    manager: { nodePath: process.execPath, entryPath: target.entryPath, configPath: target.configPath,
      port: production ? 19740 : 19741 },
    routing: { resource: 'https://' + (production ? 'mcp' : 'mcp-dev') + '.example.test/mcp',
      origin: 'https://' + (production ? 'origin' : 'origin-dev') + '.example.test/mcp',
      backendId: production ? 'production-fixture' : 'development-fixture',
      accessAppId: (production ? '1' : '2').repeat(8) + '-1111-4111-8111-111111111111',
      audience: (production ? 'a' : 'b').repeat(64),
      connectorAppId: 'asdk_app_' + (production ? '1' : '2').repeat(32),
      originHostHeader: '127.0.0.1:' + (production ? 19740 : 19741) },
  });
  const plan = { schemaVersion: 1, platform: 'win32', instanceId: dev.config.instance.id,
    authorizationMode: 'owner-only', production: makeRole(prod, true), development: makeRole(dev, false) };
  const planPath = path.join(dev.config.stateDirectory, 'dev-runtime-plan.json');
  await fs.writeFile(planPath, JSON.stringify(plan));
  return { prod, dev, plan, planPath, savePlan: () => fs.writeFile(planPath, JSON.stringify(plan)),
    saveConfig: () => fs.writeFile(dev.configPath, JSON.stringify(dev.config)) };
}

export async function directorySnapshot(directory) {
  const result = {};
  async function walk(root) {
    for (const name of (await fs.readdir(root)).sort()) {
      const filename = path.join(root, name), relative = path.relative(directory, filename);
      const stat = await fs.lstat(filename);
      if (stat.isSymbolicLink()) result[relative] = { link: await fs.readlink(filename) };
      else if (stat.isDirectory()) { result[relative] = 'directory'; await walk(filename); }
      else result[relative] = hash(await fs.readFile(filename));
    }
  }
  await walk(directory);
  return result;
}
