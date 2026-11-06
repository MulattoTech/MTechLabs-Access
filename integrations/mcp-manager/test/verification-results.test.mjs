import test from 'node:test';
import assert from 'node:assert/strict';
import { hasConfigurationObject } from '../lib/verification-results.mjs';

test('pinned 0.3.1 structured configuration succeeds without exposing values', () => {
  const response = {
    content: [{ type: 'text', text: 'Current configuration:\n{"defaultShell":"PRIVATE_CONFIG_VALUE"}' }],
    structuredContent: { config: { defaultShell: 'PRIVATE_CONFIG_VALUE', systemInfo: {} }, uiHints: { availableShells: [] }, entries: [] },
  };
  const actual = hasConfigurationObject(response);
  assert.equal(actual, true);
  assert.equal(typeof actual, 'boolean');
});

test('text fallback parses its prefixed block independently of other content', () => {
  assert.equal(hasConfigurationObject({ content: [
    { type: 'text', text: 'An additional informational block.' },
    { type: 'text', text: 'Current configuration:\n{\n  "defaultShell": "PRIVATE_CONFIG_VALUE"\n}' },
    { type: 'resource', resource: { uri: 'ui://fixture', text: 'Additional non-configuration content.' } },
    { type: 'text', text: 'Another informational block.' },
  ] }), true);
});

test('unflagged upstream error fallback and malformed configuration are rejected without throwing values', () => {
  const rejected = [
    { content: [{ type: 'text', text: 'Error getting configuration: PRIVATE_ERROR\nUsing empty configuration.' }] },
    { isError: true, structuredContent: { config: {} } },
    { structuredContent: { config: null }, content: [{ type: 'text', text: 'Current configuration:\n{}' }] },
    { structuredContent: { config: [] } },
    { content: [{ type: 'text', text: 'Current configuration:\nPRIVATE_INVALID_JSON' }] },
    { content: [{ type: 'text', text: 'Current configuration:\n[]' }] },
    { content: [{ type: 'text', text: '{"unexpected":"PRIVATE_CONFIG_VALUE"}' }] },
  ];
  for (const response of rejected) assert.equal(hasConfigurationObject(response), false);
});
