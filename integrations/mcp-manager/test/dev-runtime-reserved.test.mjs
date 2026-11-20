import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createAdminServer } from '../admin.mjs';
import { runtimeInputs, directorySnapshot } from './fixtures/runtime-inputs.mjs';

test('DEV runtime plan filename cannot be reused as a manager control', async t => {
  const f = await runtimeInputs(t);
  await fs.copyFile(f.dev.config.tokenPath, f.planPath);
  f.dev.config.tokenPath = f.planPath;
  await f.saveConfig();
  const before = await directorySnapshot(f.dev.directory);
  let server;
  try {
    await assert.rejects(async () => {
      server = await createAdminServer(f.dev.config, { configPath: f.dev.configPath });
    }, /dev_control_path/);
    assert.deepEqual(await directorySnapshot(f.dev.directory), before);
  } finally {
    if (server) { await new Promise(resolve => server.close(resolve)); await server.managedClosed; }
  }
});
