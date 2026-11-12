// SPDX-License-Identifier: MIT
// AI-Change: 2026-11-12-engineering-descriptions (OpenAI / GPT-6 Astra Pro; self-reported)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ENGINEERING_TOOLS, READ_ONLY_ENGINEERING_TOOLS } from '../lib/engineering-tools.mjs';
import { atomicWriteJson } from '../lib/policy.mjs';
import { gatewayFixture } from './helpers.mjs';

const baseline = JSON.parse(await fs.readFile(new URL('./fixtures/engineering-contract-ba4a55b7.json', import.meta.url), 'utf8'));
const withoutDescriptions = tools => tools.map(({ description, ...tool }) => tool);
const byName = name => ENGINEERING_TOOLS.find(tool => tool.name === name).description;

test('description-only change preserves all 28 names, schemas, annotations and read-only membership', () => {
  assert.equal(baseline.sourceSha, 'ba4a55b7ed351f7e60928179edaa7449de00be7d');
  assert.equal(baseline.contractSha256, '2f66aaf72db1583aa3940acb5a0374bb5298e90eec5e5bba0ec733ba25549cfe');
  assert.equal(createHash('sha256').update(JSON.stringify(baseline.tools)).digest('hex'), baseline.contractSha256);
  assert.equal(ENGINEERING_TOOLS.length, 28);
  assert.deepEqual(withoutDescriptions(ENGINEERING_TOOLS), baseline.tools);
  assert.deepEqual(READ_ONLY_ENGINEERING_TOOLS, baseline.tools.filter(tool => tool.annotations.readOnlyHint).map(tool => tool.name));
});

test('every description has readable plain-text sections with bounded content and no escaped formatting', () => {
  let totalBytes = 0;
  for (const { name, description } of ENGINEERING_TOOLS) {
    assert.equal(typeof description, 'string', name);
    assert.ok(description.length >= 300 && description.length <= 1200, name + ' length');
    assert.match(description, /^Purpose: [^\n]+\nInputs: [^\n]+\nPermissions: [^\n]+\nResult\/limits: [^\n]+(?:\nExample: [^\n]+)?$/, name);
    assert.doesNotMatch(description, /\\(?:n|r|t|u[\da-fA-F]{4})|[\u0000-\u0009\u000B-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u, name);
    assert.doesNotMatch(description, /<[^>]+>|```|\*\*[^*\n]+\*\*|^#{1,6} |!\[/m, name + ' must remain readable without a markup renderer');
    assert.equal(description.trim(), description, name);
    totalBytes += Buffer.byteLength(description);
  }
  assert.ok(totalBytes <= 32000, 'bounded aggregate discovery metadata');
});

test('known capability limitations and write permissions remain explicit in tool metadata', () => {
  assert.match(byName('mterm_vm_checkpoint_create'), /does not select or verify production checkpoint type/);
  assert.match(byName('mterm_patch_apply_checked'), /required even when apply=false/);
  assert.match(byName('mterm_repo_inspect'), /exclude untracked files/);
  assert.match(byName('mterm_code_references'), /not semantic reference resolution/);
  assert.match(byName('mterm_code_symbols'), /not a compiler symbol index/);
  assert.match(byName('mterm_job_resume'), /failed, interrupted or cancelled/);
  assert.match(byName('mterm_job_cancel'), /does not guarantee descendant termination/);
});

test('real gateway tools/list preserves Unicode, quotes, literal line breaks and the unchanged contract', async t => {
  const f = await gatewayFixture(t);
  await atomicWriteJson(f.config.policyPath, { enabled: false, readOnly: true, maxInflight: 1 });
  f.input.write(JSON.stringify({ jsonrpc: '2.0', id: 97, method: 'tools/list', params: {} }) + '\n');
  const response = await f.response(97);
  assert.equal(response.error, undefined);
  const engineering = response.result.tools.filter(tool => tool.name.startsWith('mterm_'));
  assert.deepEqual(engineering, ENGINEERING_TOOLS);
  assert.deepEqual(withoutDescriptions(engineering), baseline.tools);
  const converted = engineering.find(tool => tool.name === 'mterm_math_convert_units').description;
  assert.match(converted, /°C/);
  assert.match(converted, /\nExample: value="25", from="C", to="F"\.$/);
  const encoded = JSON.stringify(response);
  assert.ok(Buffer.byteLength(encoded) < 65536, 'discovery stays well within the MCP framing limit');
  assert.deepEqual(JSON.parse(encoded), response);
  assert.doesNotMatch(converted, /\\n|&quot;|&#|\\u00b0/i);
});
