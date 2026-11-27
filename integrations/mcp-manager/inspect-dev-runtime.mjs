import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArguments } from './lib/config.mjs';
import { inspectRegisteredDevRuntime } from './lib/reference-bootstrap.mjs';

export async function inspect(argv = process.argv.slice(2)) {
  const args = parseArguments(argv, ['config', 'plan']);
  if (!args.plan || !path.isAbsolute(args.plan) || args.plan.includes('\0')) throw new Error('absolute_runtime_plan_required');
  return inspectRegisteredDevRuntime({ configPath: args.config, planPath: args.plan });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const report = await inspect();
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    // A completed diagnostic is not an activation grant; qualified remains false.
  } catch (error) {
    const code = /^[a-z_]{1,80}$/.test(error?.message ?? '') ? error.message : 'runtime_inspection_failed';
    process.stderr.write(JSON.stringify({ error: code, qualified: false, upstreamEnabled: false }) + '\n');
    process.exitCode = 1;
  }
}
