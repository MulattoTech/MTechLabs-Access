import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  extractTomlServer, extractJsonServer, normalizeEntry, assertManagedEntry,
  verifyEntry, EXPECTED_LOCAL_TOOLS,
} from '../verify-clients.mjs';

const knownEntry = {
  command: 'C:\\Program Files\\nodejs\\node.exe',
  args: ['H:\\MTechLabs\\MCP\\runtime\\gateway.mjs', '--config', 'H:\\MTechLabs\\MCP\\state\\manager.json', '--client', 'claude-code'],
};

test('Codex extraction preserves mixed TOML quotes and ignores unrelated secret-bearing settings', () => {
  const source = String.raw`
model_provider = "PRIVATE_UNRELATED_SETTING"
instructions = '''
[mcp_servers.desktop-commander-local]
command = "not a real table"
'''
[mcp_servers.unrelated]
command = "PRIVATE_UNRELATED_EXECUTABLE"
env = { TOKEN = "PRIVATE_UNRELATED_TOKEN" }
[mcp_servers.desktop-commander-local]
command = 'C:\Program Files\nodejs\node.exe' # the installed literal path
args = [
  'H:\MTechLabs\MCP\runtime\gateway.mjs', "--config",
  'H:\MTechLabs\MCP\state\manager.json', "--client", "claude-code",
]
startup_timeout_sec = 30
[mcp_servers.other]
command = "PRIVATE_OTHER_EXECUTABLE"
`;
  const result = extractTomlServer(source);
  assert.deepEqual(result, { ...knownEntry, env: {}, env_vars: [] });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|not a real table/);
  assert.doesNotThrow(() => assertManagedEntry(result, 'claude-code'));
});

test('quoted TOML target names, escaped basic strings, and the exact env subtable are supported', () => {
  const result = extractTomlServer(String.raw`
[mcp_servers."desktop-commander-local"]
command = "C:\\Program Files\\nodejs\\node.exe"
args = ["one # is a literal", 'two',]
env_vars = ['PATH']
[mcp_servers."desktop-commander-local".env]
"TEST_VALUE" = 'PRIVATE_TARGET_VALUE'
[mcp_servers.elsewhere.env]
SECRET = 'PRIVATE_UNRELATED_VALUE'
`);
  assert.equal(result.command, knownEntry.command);
  assert.deepEqual(result.args, ['one # is a literal', 'two']);
  assert.deepEqual(result.env, { TEST_VALUE: 'PRIVATE_TARGET_VALUE' });
  assert.deepEqual(result.env_vars, ['PATH']);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_UNRELATED_VALUE/);
});

test('ambiguous or unsupported TOML target syntax fails closed', () => {
  const prefix = '[mcp_servers.desktop-commander-local]\ncommand="node"\n';
  for (const source of [
    prefix + 'command="other"',
    prefix + '\n[mcp_servers.desktop-commander-local]\nargs=[]',
    '[mcp_servers.desktop-commander-local]\ncommand="""node"""',
    '[[mcp_servers.desktop-commander-local]]\ncommand="node"',
    '[mcp_servers.desktop-commander-local]\ncommand="unterminated',
    '[mcp_servers.desktop-commander-local]\ncommand="node"\nargs=["broken"',
  ]) assert.throws(() => extractTomlServer(source), error => /toml/.test(error.code));
  assert.throws(() => extractTomlServer('[mcp_servers.unrelated]\ncommand="PRIVATE"'), { code: 'managed_entry_missing' });
});

test('JSON extracts only the direct named entry and does not chase unrelated project settings', () => {
  const input = { secret: 'PRIVATE_TOP_LEVEL', mcpServers: {
    unrelated: { command: 'PRIVATE_OTHER_COMMAND', env: { SECRET: 'PRIVATE_SECRET' } },
    'desktop-commander-local': { ...knownEntry, type: 'stdio', env: {}, irrelevant: 'PRIVATE_EXTRA_FIELD' },
  } };
  const original = JSON.stringify(input);
  const result = extractJsonServer('\uFEFF' + original);
  assert.deepEqual(result, { ...knownEntry, env: {}, env_vars: [] });
  assert.equal(JSON.stringify(input), original);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  assert.throws(() => extractJsonServer(JSON.stringify({ projects: { elsewhere: input } })), { code: 'managed_entry_missing' });
  assert.throws(() => extractJsonServer('{"PRIVATE_SECRET":malformed}'), error => error.code === 'invalid_json_configuration' && !error.message.includes('PRIVATE'));
});

test('disabled, remote, malformed, or unexpected launch entries are rejected without execution', () => {
  for (const entry of [
    { ...knownEntry, enabled: false }, { ...knownEntry, disabled: true },
    { ...knownEntry, type: 'http' }, { ...knownEntry, args: 'bad' },
    { ...knownEntry, env: { BAD: 42 } }, { ...knownEntry, env_vars: ['INVALID=KEY'] },
  ]) assert.throws(() => normalizeEntry(entry));
  assert.throws(() => assertManagedEntry(normalizeEntry({ ...knownEntry, command: 'cmd.exe' }), 'claude-code'), { code: 'unexpected_configured_command' });
  assert.throws(() => assertManagedEntry(normalizeEntry({ ...knownEntry, args: [...knownEntry.args, '--extra'] }), 'claude-code'), { code: 'unexpected_configured_arguments' });
  assert.throws(() => assertManagedEntry(normalizeEntry(knownEntry), 'claude-desktop'), { code: 'unexpected_configured_arguments' });
});

function fixtureEntry(mode) {
  return normalizeEntry({ command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/configured-client-server.mjs', import.meta.url)), '--configured-argument', 'fixture argument with spaces', ...(mode ? [mode] : [])],
    env: { MTECH_VERIFY_FIXTURE: 'PRIVATE_FIXTURE_ENVIRONMENT_VALUE' },
  });
}
function assertPrivate(result) {
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|configured-argument|fixture argument|MTECH_VERIFY_FIXTURE/);
  assert.equal(result.childExited, true);
  assert.equal(result.childExitCode, 0);
  assert.equal(typeof result.spawnedPid, 'number');
}

test('actual configured command and arguments complete SDK initialize, paginated discovery, metadata and EOF cleanup', async () => {
  const result = await verifyEntry(fixtureEntry(), { client: 'fixture', requestTimeoutMs: 3000, closeTimeoutMs: 3000 });
  assert.equal(result.pass, true);
  assert.equal(result.initialized, true);
  assert.equal(result.toolCount, EXPECTED_LOCAL_TOOLS.length);
  assert.equal(result.expectedToolSet, true);
  assert.equal(result.metadataRead, true);
  assertPrivate(result);
});

test('tool errors remain failures with content redacted and the owned child closed', async () => {
  const result = await verifyEntry(fixtureEntry('metadata-error'), { client: 'fixture', requestTimeoutMs: 3000, closeTimeoutMs: 3000 });
  assert.equal(result.pass, false);
  assert.equal(result.failedStage, 'metadata_read');
  assert.equal(result.failureCode, 'metadata_tool_returned_error');
  assert.equal(result.metadataRead, false);
  assertPrivate(result);
});

test('unexpected tool sets and repeated cursors fail before a metadata probe', async () => {
  for (const [mode, code] of [['missing-tool', 'unexpected_local_tool_set'], ['native-only', 'unexpected_local_tool_set'], ['repeating-cursor', 'invalid_tool_pagination']]) {
    const result = await verifyEntry(fixtureEntry(mode), { client: 'fixture', requestTimeoutMs: 3000, closeTimeoutMs: 3000 });
    assert.equal(result.pass, false);
    assert.equal(result.failedStage, 'tool_discovery');
    assert.equal(result.failureCode, code);
    assert.equal(result.metadataRead, false);
    assertPrivate(result);
  }
});

test('server initialize errors redact their supplied text and still close the owned child', async () => {
  const entry = fixtureEntry();
  entry.env = {};
  const result = await verifyEntry(entry, { client: 'fixture', requestTimeoutMs: 3000, closeTimeoutMs: 3000 });
  assert.equal(result.pass, false);
  assert.equal(result.failedStage, 'initialize');
  assert.equal(result.rpcErrorCode, -32603);
  assertPrivate(result);
});
