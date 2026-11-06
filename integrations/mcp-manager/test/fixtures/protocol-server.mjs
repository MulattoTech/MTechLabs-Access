import readline from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function startProtocolFixture({ resources = true, initializationDelayMs = 0 } = {}) {
  const uri = 'ui://desktop-commander/file-preview';
  let active = 0;
  let greatestActive = 0;
  let ordinal = 0;
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  lines.on('line', line => {
    const message = JSON.parse(line);
    if (!Object.hasOwn(message, 'id') || typeof message.method !== 'string') return;
    const params = message.params ?? {};
    if (message.method === 'initialize') {
      const capabilities = { tools: {} };
      if (resources) { capabilities.resources = {}; capabilities.prompts = {}; }
      return setTimeout(() => reply(message.id, {
        protocolVersion: '2025-03-26', capabilities,
        serverInfo: { name: 'protocol-fixture', version: '1.0.0' },
      }), initializationDelayMs);
    }
    if (message.method === 'tools/list') return reply(message.id, {
      tools: [
        {
          name: 'read_file', description: 'Read a fixture without side effects.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
          annotations: { readOnlyHint: true },
          _meta: { 'ui/resourceUri': uri, 'openai/outputTemplate': uri, ui: { resourceUri: uri }, 'fixture/preserve': true },
        },
        { name: 'start_process', description: 'Return a fake process response; never launch a process.', inputSchema: { type: 'object' } },
      ],
    });
    if (message.method === 'resources/list') return reply(message.id, { resources: [{ uri, name: 'Fixture file preview', mimeType: 'text/html' }] });
    if (message.method === 'resources/templates/list') return reply(message.id, { resourceTemplates: [] });
    if (message.method === 'resources/read') return reply(message.id, { contents: [{ uri: params.uri, mimeType: 'text/html', text: '<p>Safe fixture preview</p>' }] });
    if (message.method === 'prompts/list') return reply(message.id, { prompts: [{ name: 'fixture', description: 'A harmless fixture prompt.' }] });
    if (message.method === 'prompts/get') return reply(message.id, { messages: [{ role: 'user', content: { type: 'text', text: 'A harmless fixture prompt.' } }] });
    if (message.method === 'ping') return reply(message.id, {});
    if (message.method !== 'tools/call') {
      return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unknown fixture method' } }) + '\n');
    }
    active += 1;
    greatestActive = Math.max(active, greatestActive);
    const callOrdinal = ++ordinal;
    if (params.arguments?.diagnosticSecret) process.stderr.write(params.arguments.diagnosticSecret);
    setTimeout(() => {
      active -= 1;
      reply(message.id, {
        content: [{ type: 'text', text: JSON.stringify({
          name: params.name, echo: params.arguments?.echo ?? null,
          greatestActive, ordinal: callOrdinal,
        }) }],
        isError: params.arguments?.returnToolError === true,
      });
    }, params.arguments?.delayMs ?? 0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) startProtocolFixture();
