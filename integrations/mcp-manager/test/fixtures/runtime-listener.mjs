// Inert hosted-test process. It has no manager, SDK, credentials or upstream.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

try {
  if (process.argv.length !== 4 || process.argv[2] !== '--config' || !path.isAbsolute(process.argv[3])) {
    throw new Error('unsupported_fixture_arguments');
  }
  const config = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  if (Object.keys(config).sort().join(',') !== 'fixture,schemaVersion' ||
      config.schemaVersion !== 1 || config.fixture !== 'dev-runtime-listener') throw new Error('invalid_fixture_config');
  const server = net.createServer(socket => socket.destroy());
  let ending = false;
  const finish = code => {
    ending = true;
    process.exitCode = code;
    if (server.listening) server.close();
  };
  const deadline = setTimeout(() => {
    finish(2);
    process.stdin.destroy();
  }, 45000);
  server.once('close', () => clearTimeout(deadline));
  server.once('error', () => {
    clearTimeout(deadline);
    process.stderr.write('runtime_listener_fixture_failed\n');
    process.exitCode = 1;
    process.stdin.destroy();
  });
  process.stdin.once('end', () => finish(0));
  process.stdin.once('error', () => finish(1));
  process.stdin.resume();
  server.listen(0, '127.0.0.1', () => {
    if (ending) return server.close();
    process.stdout.write(JSON.stringify({ schemaVersion: 1, pid: process.pid, port: server.address().port }) + '\n');
  });
} catch {
  process.stderr.write('runtime_listener_fixture_failed\n');
  process.exitCode = 1;
}
