import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { createLineFramer } from './lib/framing.mjs';
import { EXPECTED_MANAGED_TOOLS, inspectToolInventory, ToolInventoryError } from './lib/verification-inventory.mjs';

// This verifies the saved stdio entries, not an AI model session or browser
// account. Nothing here edits client configuration, manager policy, or tokens.
export const SERVER_NAME = 'desktop-commander-local';
export const INSTALLATION_ROOT = 'H:\\MTechLabs\\MCP';
export const PROBE_PATH = INSTALLATION_ROOT + '\\package.json';
export const EXPECTED_LOCAL_TOOLS = EXPECTED_MANAGED_TOOLS;
export const CONFIGURATIONS = Object.freeze([
  { client: 'codex', format: 'toml', file: 'C:\\Users\\Dylan\\.codex\\config.toml' },
  { client: 'claude-code', format: 'json', file: 'C:\\Users\\Dylan\\.claude.json' },
  { client: 'claude-desktop', format: 'json', file: 'C:\\Users\\Dylan\\AppData\\Roaming\\Claude\\claude_desktop_config.json' },
]);
const ENTRY_KEYS = new Set(['command', 'args', 'env', 'env_vars', 'cwd', 'type', 'enabled', 'disabled']);
const MAX_CONFIGURATION_BYTES = 8 * 1024 * 1024;

class VerificationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new VerificationError(code); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// A deliberately limited TOML reader for the exact named server and its env
// table. It supports the installed single/double quoted strings, multiline
// arrays, comments, and quoted table names. Unsupported target syntax fails
// closed; unrelated settings are neither returned nor evaluated. The scanner
// recognizes multiline strings so apparent headings inside them are ignored.
function tomlStatements(input) {
  const statements = [];
  let text = '', quote = null, triple = false, depth = 0, comment = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (comment && character !== '\n') continue;
    if (comment) comment = false;
    if (quote) {
      if (character === '\\' && quote === '"') {
        text += character + (input[++index] ?? '');
      } else if (character === quote && (!triple || input.slice(index, index + 3) === quote.repeat(3))) {
        text += triple ? quote.repeat(3) : quote;
        if (triple) index += 2;
        quote = null;
        triple = false;
      } else text += character;
      continue;
    }
    if (character === '#') { comment = true; continue; }
    if (character === '"' || character === "'") {
      quote = character;
      triple = input.slice(index, index + 3) === character.repeat(3);
      text += triple ? character.repeat(3) : character;
      if (triple) index += 2;
    } else if (character === '[' || character === '{') { depth += 1; text += character; }
    else if (character === ']' || character === '}') { depth -= 1; text += character; if (depth < 0) fail('invalid_toml'); }
    else if (character === '\n' && depth === 0) { if (text.trim()) statements.push(text.trim()); text = ''; }
    else text += character;
  }
  if (quote || depth !== 0) fail('invalid_toml');
  if (text.trim()) statements.push(text.trim());
  return statements;
}

function tomlReader(text) {
  let offset = 0;
  const spaces = () => { while (/\s/.test(text[offset] ?? '') && offset < text.length) offset += 1; };
  function string() {
    const quote = text[offset++];
    if (text.slice(offset, offset + 2) === quote.repeat(2)) fail('unsupported_target_toml');
    let result = '';
    while (offset < text.length) {
      let character = text[offset++];
      if (character === quote) return result;
      if (character === '\n' || character === '\r') fail('invalid_target_toml');
      if (character === '\\' && quote === '"') {
        character = text[offset++];
        const escapes = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
        if (Object.hasOwn(escapes, character)) result += escapes[character];
        else if (character === 'u' || character === 'U') {
          const count = character === 'u' ? 4 : 8;
          const digits = text.slice(offset, offset + count);
          if (digits.length !== count || !/^[0-9a-f]+$/i.test(digits)) fail('invalid_target_toml');
          const point = Number.parseInt(digits, 16);
          if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) fail('invalid_target_toml');
          result += String.fromCodePoint(point);
          offset += count;
        } else fail('invalid_target_toml');
      } else result += character;
    }
    fail('invalid_target_toml');
  }
  function key() {
    spaces();
    if (text[offset] === '"' || text[offset] === "'") return string();
    const match = /^[A-Za-z0-9_-]+/.exec(text.slice(offset));
    if (!match) fail('unsupported_target_toml');
    offset += match[0].length;
    return match[0];
  }
  function keyPath() {
    const keys = [key()];
    for (;;) { spaces(); if (text[offset] !== '.') return keys; offset += 1; keys.push(key()); }
  }
  function value() {
    spaces();
    if (text[offset] === '"' || text[offset] === "'") return string();
    if (text[offset] === '[') {
      offset += 1;
      const result = [];
      for (;;) {
        spaces(); if (text[offset] === ']') { offset += 1; return result; }
        result.push(value()); spaces();
        if (text[offset] === ']') { offset += 1; return result; }
        if (text[offset++] !== ',') fail('invalid_target_toml');
      }
    }
    if (text[offset] === '{') {
      offset += 1;
      const result = Object.create(null);
      for (;;) {
        spaces(); if (text[offset] === '}') { offset += 1; return result; }
        const name = key(); spaces();
        if (text[offset++] !== '=' || Object.hasOwn(result, name)) fail('invalid_target_toml');
        result[name] = value(); spaces();
        if (text[offset] === '}') { offset += 1; return result; }
        if (text[offset++] !== ',') fail('invalid_target_toml');
      }
    }
    const match = /^(true|false|[+-]?\d+(?:\.\d+)?)(?=\s|,|\]|\}|$)/.exec(text.slice(offset));
    if (!match) fail('unsupported_target_toml');
    offset += match[0].length;
    return match[0] === 'true' ? true : match[0] === 'false' ? false : Number(match[0]);
  }
  return { keyPath, value, spaces, atEnd: () => offset === text.length,
    assignment() { const keys = keyPath(); spaces(); if (text[offset++] !== '=') fail('invalid_target_toml'); return keys; } };
}

export function extractTomlServer(input) {
  const selected = Object.create(null);
  let section = [], seen = false, tableSeen = false, envTableSeen = false;
  for (const statement of tomlStatements(input.replace(/^\uFEFF/, ''))) {
    if (statement.startsWith('[')) {
      const arrayTable = statement.startsWith('[[');
      const reader = tomlReader(statement.slice(arrayTable ? 2 : 1, arrayTable ? -2 : -1));
      section = reader.keyPath(); reader.spaces();
      if (!reader.atEnd()) fail('invalid_toml');
      const exact = section[0] === 'mcp_servers' && section[1] === SERVER_NAME;
      if (exact && arrayTable) fail('unsupported_target_toml');
      if (exact && section.length === 2) {
        if (tableSeen) fail('duplicate_target_toml');
        tableSeen = seen = true;
      }
      if (exact && section.length === 3 && section[2] === 'env') {
        if (envTableSeen || Object.hasOwn(selected, 'env')) fail('duplicate_target_toml');
        envTableSeen = seen = true;
        selected.env = Object.create(null);
      }
      continue;
    }
    if (section[0] !== 'mcp_servers' || section[1] !== SERVER_NAME) continue;
    const environment = section.length === 3 && section[2] === 'env';
    if (section.length !== 2 && !environment) continue;
    const reader = tomlReader(statement);
    const keys = reader.assignment();
    if (keys.length !== 1) fail('unsupported_target_toml');
    const key = keys[0];
    if (!environment && !ENTRY_KEYS.has(key)) continue;
    const destination = environment ? selected.env : selected;
    if (Object.hasOwn(destination, key)) fail('duplicate_target_toml');
    destination[key] = reader.value(); reader.spaces();
    if (!reader.atEnd()) fail('invalid_target_toml');
  }
  if (!seen) fail('managed_entry_missing');
  return normalizeEntry(selected);
}

export function extractJsonServer(input) {
  let config;
  try { config = JSON.parse(input.replace(/^\uFEFF/, '')); }
  catch { fail('invalid_json_configuration'); }
  if (!isObject(config) || !isObject(config.mcpServers) || !Object.hasOwn(config.mcpServers, SERVER_NAME)) fail('managed_entry_missing');
  return normalizeEntry(config.mcpServers[SERVER_NAME]);
}

export function normalizeEntry(value) {
  if (!isObject(value)) fail('invalid_managed_entry');
  if (value.enabled === false || value.disabled === true) fail('managed_entry_disabled');
  if (value.type !== undefined && value.type !== 'stdio') fail('managed_entry_not_stdio');
  const validString = item => typeof item === 'string' && item.length <= 32768 && !item.includes('\0');
  if (!validString(value.command) || !value.command.length) fail('invalid_configured_command');
  if (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every(validString))) fail('invalid_configured_arguments');
  if (value.cwd !== undefined && (!validString(value.cwd) || !value.cwd.length)) fail('invalid_configured_cwd');
  if (value.env !== undefined && (!isObject(value.env) || !Object.entries(value.env).every(([key, item]) => /^[^=\0]+$/.test(key) && validString(item)))) fail('invalid_configured_environment');
  if (value.env_vars !== undefined && (!Array.isArray(value.env_vars) || !value.env_vars.every(key => typeof key === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)))) fail('invalid_configured_environment');
  return { command: value.command, args: [...(value.args ?? [])],
    ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
    env: { ...(value.env ?? {}) }, env_vars: [...(value.env_vars ?? [])] };
}

// Before executing a real saved entry, ensure it still names this deployment's
// known Node gateway. Pass those actual arguments unchanged after validation.
export function assertManagedEntry(entry, client) {
  const samePath = (left, right) => typeof left === 'string' && path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
  if (!samePath(entry.command, 'C:\\Program Files\\nodejs\\node.exe')) fail('unexpected_configured_command');
  if (entry.args.length !== 5 || !samePath(entry.args[0], INSTALLATION_ROOT + '\\runtime\\gateway.mjs') ||
      entry.args[1] !== '--config' || !samePath(entry.args[2], INSTALLATION_ROOT + '\\state\\manager.json') ||
      entry.args[3] !== '--client' || entry.args[4] !== client) fail('unexpected_configured_arguments');
}

// Owned test sessions receive EOF only. In particular, the stock SDK stdio
// transport's timed SIGTERM/SIGKILL escalation is not used.
export class ConfiguredStdioTransport {
  constructor(entry) {
    this.entry = entry;
    this.started = false;
    this.closing = false;
    this.child = null;
    this.pid = null;
    this.completed = new Promise(resolve => { this.resolveCompleted = resolve; });
  }
  async start() {
    if (this.started) fail('transport_already_started');
    this.started = true;
    const inherited = getDefaultEnvironment();
    for (const key of this.entry.env_vars) if (process.env[key] !== undefined) inherited[key] = process.env[key];
    const child = this.child = spawn(this.entry.command, this.entry.args, {
      cwd: this.entry.cwd, env: { ...inherited, ...this.entry.env },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false,
    });
    const safeError = () => { this.onerror?.(new VerificationError('configured_transport_error')); };
    const frames = createLineFramer({ maxBytes: 8 * 1024 * 1024,
      onLine: line => { try { this.onmessage?.(JSONRPCMessageSchema.parse(JSON.parse(line))); } catch { safeError(); } },
      onError: safeError,
    });
    child.stdout.on('data', chunk => frames.push(chunk));
    child.stdout.once('end', () => frames.end());
    child.stdout.on('error', safeError);
    child.stdin.on('error', safeError);
    // Never echo server diagnostics, metadata text, or configuration values.
    child.stderr.on('data', () => {});
    child.stderr.on('error', safeError);
    child.on('error', safeError);
    child.once('close', (code, signal) => {
      this.child = null;
      this.closing = true;
      this.onclose?.();
      this.resolveCompleted({ exited: true, exitCode: code, signaled: signal !== null });
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', () => { this.pid = child.pid; resolve(); });
      child.once('error', () => reject(new VerificationError('configured_spawn_failed')));
    });
  }
  async send(message) {
    const stream = this.child?.stdin;
    if (this.closing || !stream || stream.destroyed || stream.writableEnded) fail('configured_transport_closed');
    const frame = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(frame) > 1024 * 1024) fail('configured_frame_too_large');
    await new Promise((resolve, reject) => stream.write(frame, error => error ? reject(new VerificationError('configured_write_failed')) : resolve()));
  }
  async close() {
    if (this.closing) return;
    this.closing = true;
    if (this.child) this.child.stdin.end();
    else { this.onclose?.(); this.resolveCompleted({ exited: true, exitCode: null, signaled: false }); }
  }
  releaseWaitingHandles() {
    // Preserve a shutdown failure in the report without hanging the verifier or
    // killing a process. Only this transport's owned child handles are touched.
    this.child?.unref();
    for (const stream of [this.child?.stdin, this.child?.stdout, this.child?.stderr]) stream?.unref?.();
  }
}

async function waitForExit(transport, timeoutMs) {
  let timer;
  try {
    return await Promise.race([transport.completed,
      new Promise(resolve => { timer = setTimeout(() => resolve({ exited: false, exitCode: null, signaled: false }), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function verifyEntry(entry, { client: clientName, requestTimeoutMs = 30000, closeTimeoutMs = 10000 } = {}) {
  const result = { client: clientName, configurationRead: true, initialized: false,
    toolCount: 0, expectedToolSet: false, metadataRead: false, childExited: false, pass: false };
  const client = new Client({ name: 'mtechlabs-configured-client-verification', version: '1.0.0' }, { capabilities: {} });
  const transport = new ConfiguredStdioTransport(entry);
  let stage = 'initialize';
  try {
    await client.connect(transport, { timeout: requestTimeoutMs });
    result.initialized = true;
    stage = 'tool_discovery';
    const inventory = await inspectToolInventory(client, { requestTimeoutMs });
    result.toolCount = inventory.toolCount;
    result.inventoryBytes = inventory.inventoryBytes;
    result.requiredToolCount = inventory.requiredToolCount;
    result.additionalToolCount = inventory.additionalToolCount;
    result.expectedToolSet = true;
    stage = 'metadata_read';
    const response = await client.callTool({ name: 'get_file_info', arguments: { path: PROBE_PATH } }, CallToolResultSchema, { timeout: requestTimeoutMs });
    if (response.isError === true) fail('metadata_tool_returned_error');
    if (!response.content?.some(item => item.type === 'text' && item.text.trim().length > 0) && !isObject(response.structuredContent)) fail('metadata_tool_returned_no_content');
    result.metadataRead = true;
  } catch (error) {
    result.failedStage = stage;
    result.failureCode = error instanceof VerificationError || error instanceof ToolInventoryError ? error.code : stage + '_failed';
    if (Number.isInteger(error?.code)) result.rpcErrorCode = error.code;
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    const closed = await waitForExit(transport, closeTimeoutMs);
    Object.assign(result, { spawnedPid: transport.pid, childExited: closed.exited, childExitCode: closed.exitCode });
    if (!closed.exited) { transport.releaseWaitingHandles(); result.cleanupFailure = 'owned_child_eof_timeout'; }
    else if (closed.signaled || (transport.pid !== null && closed.exitCode !== 0)) result.cleanupFailure = 'owned_child_exit_not_clean';
    result.pass = result.initialized && result.expectedToolSet && result.metadataRead && closed.exited && !result.failureCode && !result.cleanupFailure;
  }
  return result;
}

async function readConfiguration(configuration) {
  const handle = await fs.open(configuration.file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_CONFIGURATION_BYTES) fail('configuration_size_or_type_invalid');
    const buffer = Buffer.alloc(MAX_CONFIGURATION_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    if (bytesRead > MAX_CONFIGURATION_BYTES) fail('configuration_too_large');
    const text = buffer.toString('utf8', 0, bytesRead);
    return configuration.format === 'toml' ? extractTomlServer(text) : extractJsonServer(text);
  } finally { await handle.close(); }
}

export async function main() {
  if (process.argv.includes('--help')) {
    console.log('Windows only: node H:\\MTechLabs\\MCP\\runtime\\verify-clients.mjs\nReads only the named local MCP entries from the three known client files. Runs SDK initialize, tools/list, and get_file_info for the installation package.json. Closes its own sessions with EOF and saves a redacted report under H:\\MTechLabs\\MCP\\state. Does not invoke AI models, connect browser accounts, modify configuration, or change policy.');
    return;
  }
  if (process.platform !== 'win32') fail('windows_required');
  if (process.argv.length !== 2) fail('unsupported_arguments');
  const report = { schemaVersion: 1, testedAt: new Date().toISOString(), server: SERVER_NAME,
    scope: 'saved local stdio commands; application sessions and browser OAuth are not tested',
    probe: { tool: 'get_file_info', path: PROBE_PATH }, clients: [] };
  for (const configuration of CONFIGURATIONS) {
    let result;
    try {
      const entry = await readConfiguration(configuration);
      assertManagedEntry(entry, configuration.client);
      result = await verifyEntry(entry, { client: configuration.client });
    } catch (error) {
      result = { client: configuration.client, configurationRead: false, pass: false,
        failedStage: 'configuration', failureCode: error instanceof VerificationError ? error.code : error?.code === 'ENOENT' ? 'configuration_file_missing' : 'configuration_read_failed' };
    }
    report.clients.push(result);
    if (result.cleanupFailure === 'owned_child_eof_timeout') break;
  }
  report.passed = report.clients.filter(item => item.pass).length;
  report.failed = report.clients.filter(item => !item.pass).length;
  report.untested = CONFIGURATIONS.length - report.clients.length;
  report.pass = report.passed === CONFIGURATIONS.length && report.failed === 0;
  const file = INSTALLATION_ROOT + '\\state\\client-verification-' + Date.now() + '-' + randomUUID() + '.json';
  await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...report, reportFile: file }));
  if (!report.pass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    // Raw exceptions can contain config values or server-provided text.
    console.log(JSON.stringify({ pass: false, failureCode: error instanceof VerificationError ? error.code : 'verification_failed' }));
    process.exitCode = 1;
  });
}
