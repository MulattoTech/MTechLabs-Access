import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadReferenceBootstrap, createBootstrappedReferenceAuthority } from './lib/reference-bootstrap.mjs';
import { serveReferenceTransport } from './lib/reference-transport.mjs';
import { waitForProductionReferenceAuthorityIdle } from './lib/production-reference.mjs';

export async function startReferenceServer(argv = process.argv.slice(2)) {
  if (!Array.isArray(argv) || argv.length) throw new Error('runtime_reference_bootstrap_invalid');
  const bootstrap = await loadReferenceBootstrap('authority');
  const authority = createBootstrappedReferenceAuthority(bootstrap);
  const server = serveReferenceTransport(bootstrap, authority);
  await server.ready;
  // Observe idle only after transport admission closes and all its callback
  // invocations settle; an already-resolved startup idle promise is not a drain.
  const closed = server.closed.then(() => waitForProductionReferenceAuthorityIdle(authority));
  return Object.freeze({ ready: server.ready, closed, close: () => { server.close(); return closed; } });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const server = await startReferenceServer();
    const shutdown = () => { server.close(); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    process.stdin.once('end', shutdown); process.stdin.resume();
    process.stdout.write(JSON.stringify({ status: 'reference_ready', qualified: false, upstreamEnabled: false }) + '\n');
    await server.closed;
    process.stdin.pause();
  } catch {
    process.stderr.write(JSON.stringify({ error: 'runtime_reference_unavailable', qualified: false, upstreamEnabled: false }) + '\n');
    process.exitCode = 1;
  }
}
