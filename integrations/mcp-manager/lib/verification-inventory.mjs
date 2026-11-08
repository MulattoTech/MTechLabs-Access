import { isDeepStrictEqual } from 'node:util';
import { ENGINEERING_TOOLS } from './engineering-tools.mjs';

export const EXPECTED_NATIVE_TOOLS = Object.freeze([
  'create_directory', 'edit_block', 'force_terminate', 'get_config',
  'get_file_info', 'get_more_search_results', 'get_recent_tool_calls',
  'get_usage_stats', 'give_feedback_to_desktop_commander',
  'interact_with_process', 'kill_process', 'list_directory', 'list_processes',
  'list_searches', 'list_sessions', 'move_file', 'read_file',
  'read_multiple_files', 'read_process_output', 'set_config_value',
  'start_process', 'start_search', 'stop_search', 'write_file', 'write_pdf',
]);
export const EXPECTED_MANAGED_TOOLS = Object.freeze([
  ...EXPECTED_NATIVE_TOOLS, ...ENGINEERING_TOOLS.map(tool => tool.name),
]);
const MAX_INVENTORY_BYTES = 8 * 1024 * 1024;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export class ToolInventoryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new ToolInventoryError(code); };

// Validate the advertised contract, rather than accepting a matching count.
// Additional tools are allowed only when their descriptors pass the same checks.
export function validateToolInventory(tools) {
  if (!Array.isArray(tools)) fail('invalid_tool_inventory');
  let serialized;
  try {
    serialized = JSON.stringify(tools);
    if (!isDeepStrictEqual(JSON.parse(serialized), tools)) fail('invalid_tool_json');
  } catch { fail('invalid_tool_json'); }
  const inventoryBytes = Buffer.byteLength(serialized);
  if (inventoryBytes > MAX_INVENTORY_BYTES) fail('tool_inventory_too_large');
  const names = new Set();
  for (const tool of tools) {
    if (!isObject(tool) || typeof tool.name !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) fail('invalid_tool_name');
    if (names.has(tool.name)) fail('duplicate_tool_name');
    names.add(tool.name);
    const schema = tool.inputSchema;
    if (!isObject(schema) || schema.type !== 'object' ||
        (schema.properties !== undefined && !isObject(schema.properties)) ||
        (schema.required !== undefined && (!Array.isArray(schema.required) ||
          !schema.required.every(key => typeof key === 'string') ||
          new Set(schema.required).size !== schema.required.length))) fail('invalid_tool_input_schema');
    if (tool.description !== undefined && typeof tool.description !== 'string') fail('invalid_tool_description');
    if (tool.name === 'get_file_info' &&
        (schema.properties?.path?.type !== 'string' || !schema.required?.includes('path'))) fail('unexpected_metadata_schema');
  }
  if (!EXPECTED_MANAGED_TOOLS.every(name => names.has(name))) fail('unexpected_local_tool_set');
  return { toolCount: names.size, requiredToolCount: EXPECTED_MANAGED_TOOLS.length,
    additionalToolCount: names.size - EXPECTED_MANAGED_TOOLS.length, inventoryBytes };
}

export async function inspectToolInventory(client, { requestTimeoutMs = 30000 } = {}) {
  const tools = [], seenCursors = new Set();
  let cursor, lastPageCount = 0;
  for (let page = 0; page < 8; page += 1) {
    const response = await client.listTools(cursor === undefined ? {} : { cursor }, { timeout: requestTimeoutMs });
    if (!Array.isArray(response.tools)) fail('invalid_tool_inventory');
    tools.push(...response.tools);
    lastPageCount = response.tools.length;
    cursor = response.nextCursor;
    if (cursor === undefined) return { ...validateToolInventory(tools), lastPageCount, tools };
    if (typeof cursor !== 'string' || seenCursors.has(cursor) || page === 7) fail('invalid_tool_pagination');
    seenCursors.add(cursor);
  }
}
