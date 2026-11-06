import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadConfig, parseArguments } from './lib/config.mjs';
import { atomicWriteJson, validatePolicy } from './lib/policy.mjs';
import { collectStatus } from './lib/status.mjs';
import { readJsonBody } from './lib/http-body.mjs';
import { createRemoteMcp } from './remote.mjs';

const ALLOWED_HOSTS = new Set([
  '127.0.0.1:19740', 'localhost:19740',
  'mcp-origin.m-techlabs.com', 'mcp-origin.m-techlabs.com:443',
]);
const ALLOWED_ORIGINS = new Set(['https://m-techlabs.com', 'https://www.m-techlabs.com']);
const MAX_BODY_BYTES = 4096;

export async function loadTokenDigest(tokenPath) {
  const stat = await fs.lstat(tokenPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) throw new Error('invalid_token_file');
  const value = (await fs.readFile(tokenPath, 'utf8')).trim();
  if (/^sha256:[a-fA-F0-9]{64}$/.test(value)) return Buffer.from(value.slice(7), 'hex');
  if (value.length < 32 || value.length > 512 || /\s/.test(value) || value.startsWith('sha256:')) {
    throw new Error('invalid_token_file');
  }
  // Compatibility only; a digest file avoids storing plaintext on this PC.
  return createHash('sha256').update(value).digest();
}

export function bearerMatches(request, expectedDigest) {
  const authorizationFields = request.rawHeaders.filter((_, index, all) =>
    index % 2 === 0 && all[index].toLowerCase() === 'authorization').length;
  const header = request.headers.authorization;
  const candidate = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  const candidateDigest = createHash('sha256').update(candidate).digest();
  const equal = timingSafeEqual(candidateDigest, expectedDigest);
  return equal && authorizationFields === 1 && candidate.length >= 32 && candidate.length <= 512 && !/\s/.test(candidate);
}

function respond(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  response.end(JSON.stringify(value));
}

function failure(response, status, code, message) {
  respond(response, status, { error: { code, message } });
}

async function readPolicyBody(request) {
  return validatePolicy(await readJsonBody(request, MAX_BODY_BYTES));
}

export async function createAdminServer(config, { configPath, remoteOptions } = {}) {
  const tokenDigest = await loadTokenDigest(config.tokenPath);
  const startedAt = Date.now();
  let writeChain = Promise.resolve();
  const remote = createRemoteMcp(config, { ...remoteOptions, configPath });
  const server = http.createServer({ maxHeaderSize: 8192 }, (request, response) => {
    void (async () => {
      if (!bearerMatches(request, tokenDigest)) {
        request.resume();
        return failure(response, 401, 'unauthorized', 'Authentication is required.');
      }
      if (!ALLOWED_HOSTS.has((request.headers.host ?? '').toLowerCase()) ||
          (request.headers.origin !== undefined && !ALLOWED_ORIGINS.has(request.headers.origin))) {
        request.resume();
        return failure(response, 403, 'origin_rejected', 'The request origin is not allowed.');
      }
      if (request.url === '/v1/status' && request.method === 'GET') {
        request.resume();
        return respond(response, 200, { ...await collectStatus(config, startedAt), remoteMcp: remote.status() });
      }
      if (request.url === '/mcp') return remote.handle(request, response);
      if (request.url === '/v1/policy' && request.method === 'POST') {
        let policy;
        try {
          policy = await readPolicyBody(request);
        } catch {
          request.resume();
          return failure(response, 400, 'invalid_policy', 'Send exactly enabled, readOnly, and maxInflight (1..64) as JSON.');
        }
        // Older gateways reject the additional persisted field, so an upgrade
        // cannot leave an already-loaded per-instance scheduler admitting new
        // work outside the shared coordinator. The external API stays three fields.
        const write = writeChain.then(() => atomicWriteJson(config.policyPath, { ...policy, coordinationVersion: 1 }));
        writeChain = write.catch(() => {});
        try {
          await write;
        } catch {
          return failure(response, 503, 'policy_write_failed', 'The policy could not be saved. Existing configuration was retained where possible.');
        }
        return respond(response, 200, {
          ok: true,
          policy,
          appliesTo: 'new_tool_calls',
          runningCommandsInterrupted: false,
        });
      }
      request.resume();
      if (request.url === '/v1/status' || request.url === '/v1/policy') {
        return failure(response, 405, 'method_not_allowed', 'This method is not supported.');
      }
      return failure(response, 404, 'not_found', 'No such management endpoint.');
    })().catch(() => {
      if (!response.headersSent) failure(response, 500, 'internal_error', 'The management request could not be completed.');
      else response.end();
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 6000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (_, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  // Local lifecycle hook only. There is no HTTP endpoint that kills processes.
  server.closeManagedMcp = () => remote.close();
  server.once('close', () => { void remote.close().catch(() => {}); });
  return server;
}

async function main() {
  try {
    const args = parseArguments(process.argv.slice(2), ['config']);
    const config = await loadConfig(args.config);
    const server = await createAdminServer(config, { configPath: args.config });
    server.once('error', () => {
      process.stderr.write('MCP Manager admin could not bind its loopback port.\n');
      process.exitCode = 1;
    });
    server.listen(19740, '127.0.0.1', () => {
      process.stderr.write('M-TechLabs MCP Manager is listening on loopback port 19740.\n');
    });
    const close = () => server.close();
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  } catch {
    process.stderr.write('MCP Manager admin could not start. Check the local configuration and token digest file.\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
