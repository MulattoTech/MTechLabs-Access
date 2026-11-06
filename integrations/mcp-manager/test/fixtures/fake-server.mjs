import readline from 'node:readline';

let active = 0;
let greatestActive = 0;
let received = 0;
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  const message = JSON.parse(line);
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
  active += 1;
  greatestActive = Math.max(greatestActive, active);
  const ordinal = received;
  if (message.params.arguments?.diagnosticSecret) process.stderr.write(message.params.arguments.diagnosticSecret);
  setTimeout(() => {
    active -= 1;
    const response = {
      jsonrpc: '2.0', id: message.id,
      result: { executed: true, name: message.params.name, greatestActive, ordinal, echo: message.params.arguments?.echo ?? null },
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }, message.params.arguments?.delayMs ?? 0);
});
