import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINEERING_TOOLS } from '../lib/engineering-tools.mjs';
import { EXPECTED_NATIVE_TOOLS, EXPECTED_MANAGED_TOOLS, validateToolInventory, inspectToolInventory } from '../lib/verification-inventory.mjs';

const nativeTools = () => EXPECTED_NATIVE_TOOLS.map(name => ({ name,
  inputSchema: name === 'get_file_info'
    ? { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
    : { type: 'object' },
}));
const inventory = () => [...nativeTools(), ...structuredClone(ENGINEERING_TOOLS)];

test('current native and engineering inventory passes by names and schemas; valid additions are accepted', () => {
  const tools = inventory();
  const evidence = validateToolInventory(tools);
  assert.equal(evidence.toolCount, EXPECTED_NATIVE_TOOLS.length + ENGINEERING_TOOLS.length);
  assert.equal(evidence.requiredToolCount, EXPECTED_MANAGED_TOOLS.length);
  assert.equal(evidence.additionalToolCount, 0);
  assert.equal(evidence.inventoryBytes, Buffer.byteLength(JSON.stringify(tools)));
  assert.equal(validateToolInventory([...tools, { name: 'future_tool', inputSchema: { type: 'object' } }]).additionalToolCount, 1);
});

test('legacy native-only tools and same-size substitutions cannot pass the managed contract', () => {
  assert.throws(() => validateToolInventory(nativeTools()), { code: 'unexpected_local_tool_set' });
  const tools = inventory();
  tools[0].name = 'replacement_with_same_count';
  assert.throws(() => validateToolInventory(tools), { code: 'unexpected_local_tool_set' });
  const withoutEngineering = inventory().filter(tool => tool.name !== 'mterm_math_evaluate');
  assert.throws(() => validateToolInventory(withoutEngineering), { code: 'unexpected_local_tool_set' });
});

test('duplicate and malformed names, non-object schemas, and invalid metadata contract are rejected', () => {
  assert.throws(() => validateToolInventory([...inventory(), inventory()[0]]), { code: 'duplicate_tool_name' });
  for (const name of ['', 'space name', 'x'.repeat(129)]) {
    const tools = inventory(); tools[0].name = name;
    assert.throws(() => validateToolInventory(tools), { code: 'invalid_tool_name' });
  }
  for (const inputSchema of [null, [], { type: 'array' }, { type: 'object', properties: [] },
    { type: 'object', required: ['same', 'same'] }]) {
    const tools = inventory(); tools[0].inputSchema = inputSchema;
    assert.throws(() => validateToolInventory(tools), { code: 'invalid_tool_input_schema' });
  }
  const tools = inventory(); tools.find(tool => tool.name === 'get_file_info').inputSchema = { type: 'object' };
  assert.throws(() => validateToolInventory(tools), { code: 'unexpected_metadata_schema' });
});

test('non-JSON descriptors and oversized advertisements fail with redacted codes', () => {
  for (const value of [undefined, NaN, Infinity, 1n, () => {}]) {
    const tools = inventory(); tools[0].extra = value;
    assert.throws(() => validateToolInventory(tools), { code: 'invalid_tool_json' });
  }
  const cyclic = inventory(); cyclic[0].self = cyclic[0];
  assert.throws(() => validateToolInventory(cyclic), { code: 'invalid_tool_json' });
  const oversized = inventory(); oversized[0].description = 'x'.repeat(8 * 1024 * 1024);
  assert.throws(() => validateToolInventory(oversized), { code: 'tool_inventory_too_large' });
});

test('paginated discovery validates all pages and reports the last page count separately', async () => {
  const tools = inventory(), calls = [];
  const client = { async listTools(params, options) {
    calls.push({ params, options });
    return params.cursor === undefined ? { tools: tools.slice(0, 10), nextCursor: 'page2' } : { tools: tools.slice(10) };
  } };
  const evidence = await inspectToolInventory(client, { requestTimeoutMs: 1234 });
  assert.equal(evidence.toolCount, tools.length);
  assert.equal(evidence.lastPageCount, tools.length - 10);
  assert.deepEqual(calls, [{ params: {}, options: { timeout: 1234 } },
    { params: { cursor: 'page2' }, options: { timeout: 1234 } }]);
});

test('repeated cursors and cross-page duplicate tools cannot pass discovery', async () => {
  await assert.rejects(() => inspectToolInventory({ async listTools() { return { tools: [], nextCursor: 'repeat' }; } }), { code: 'invalid_tool_pagination' });
  const tools = inventory();
  await assert.rejects(() => inspectToolInventory({ async listTools(params) {
    return params.cursor === undefined ? { tools, nextCursor: 'again' } : { tools: [tools[0]] };
  } }), { code: 'duplicate_tool_name' });
});
