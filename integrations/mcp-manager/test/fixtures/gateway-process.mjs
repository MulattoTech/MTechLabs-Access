import { startGateway } from '../../gateway.mjs';
import { loadConfig } from '../../lib/config.mjs';

const config = await loadConfig(process.argv[2]);
const gateway = await startGateway({
  config, client: process.argv[3],
  requestTimeoutMs: Number(process.argv[4] ?? 3000),
  queueTimeoutMs: Number(process.argv[5] ?? 5000),
});
process.exitCode = (await gateway.completed).exitCode;
