import readline from 'node:readline';

let active = 0;
let greatestActive = 0;
let received = 0;
const releasedBarriers = new Set();
const barrierWaiters = new Map();
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'notifications/test-release' && typeof message.params?.barrier === 'string') {
    const barrier = message.params.barrier;
    releasedBarriers.add(barrier);
    for (const finish of barrierWaiters.get(barrier) ?? []) finish();
    barrierWaiters.delete(barrier);
    return;
  }
  if (!Object.hasOwn(message, 'id')) return;
  if (typeof message.method !== 'string') return;
  if (message.method === 'initialize') {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0', id: message.id,
      result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'test-child', version: '1.0.0' } },
    }) + '\n');
    return;
  }
  if (message.method !== 'tools/call') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [] } }) + '\n');
    return;
  }
  received += 1;
  const startedAt = Date.now();
  active += 1;
  greatestActive = Math.max(greatestActive, active);
  const ordinal = received;
  if (message.params.arguments?.diagnosticSecret) process.stderr.write(message.params.arguments.diagnosticSecret);
  if (message.params.arguments?.exitBeforeReply) process.exit(17);
  if (message.params.arguments?.neverReply) return;
  const barrier = message.params.arguments?.barrier;
  if (typeof barrier === 'string') process.stdout.write(JSON.stringify({
    jsonrpc: '2.0', method: 'notifications/test-started', params: { requestId: message.id, barrier },
  }) + '\n');
  function finish() {
    active -= 1;
    const response = {
      jsonrpc: '2.0', id: message.id,
      result: {
        executed: true, name: message.params.name, greatestActive, ordinal,
        echo: message.params.arguments?.echo ?? null,
        startedAt, finishedAt: Date.now(), pid: process.pid,
      },
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }
  setTimeout(() => {
    if (typeof barrier === 'string' && !releasedBarriers.has(barrier)) {
      const waiters = barrierWaiters.get(barrier) ?? [];
      waiters.push(finish);
      barrierWaiters.set(barrier, waiters);
    } else finish();
  }, message.params.arguments?.delayMs ?? 0);
});
