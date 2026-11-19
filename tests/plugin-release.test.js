import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, packageCanonicalPlugin } from '../scripts/package-canonical-plugin.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

function decodeTar(bytes) {
  const contents = new Map();
  let offset = 0;
  for (;;) {
    assert.ok(offset + 512 <= bytes.length, 'Tar ends with complete header block');
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').split('\0')[0];
    const sizeText = header.subarray(124, 136).toString('ascii').split('\0')[0].trim();
    const size = parseInt(sizeText, 8);
    assert.match(name, /^[a-zA-Z0-9._/-]{1,100}$/);
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'), 'No extraction traversal');
    assert.ok(Number.isSafeInteger(size) && size >= 0 && size < 1048576);
    assert.equal(header.subarray(257, 262).toString('ascii'), 'ustar');
    const encodedCheck = parseInt(header.subarray(148, 156).toString('ascii').trim(), 8);
    const checked = Buffer.from(header);
    checked.fill(32, 148, 156);
    assert.equal(encodedCheck, checked.reduce((sum, value) => sum + value, 0));
    const start = offset + 512;
    assert.ok(start + size <= bytes.length, 'Tar entry must fit in archive');
    assert.ok(!contents.has(name), 'No duplicate file entries');
    contents.set(name, bytes.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  return contents;
}

test('owner recovery archive matches the verified canonical private plugin source', async () => {
  const manifest = JSON.parse(await readFile(resolve(ROOT, 'plugin-releases/current.json'), 'utf8'));
  assert.equal(manifest.version, '0.2.3');
  assert.equal(manifest.file, 'mterm-chatgpt-v0.2.3.tar.gz');
  assert.equal(manifest.provenance?.kind, 'verified-source-equivalent-repack');
  assert.equal(manifest.provenance.canonicalRelease, 'pluginrel_6af62cc94f208191ae197a1a9ae7aa65');
  assert.equal(manifest.provenance.exactCompressedCreatorArchive, false);
  const raw = await readFile(resolve(ROOT, 'plugin-releases', manifest.file));
  assert.equal(createHash('sha256').update(raw).digest('hex'), manifest.sha256);
  const entries = decodeTar(gunzipSync(raw));
  assert.deepEqual([...entries.keys()].sort(), [...FILES].sort());
  for (const name of FILES) {
    const source = await readFile(resolve(ROOT, 'integrations/m-techlabs-desktop', name), 'utf8');
    assert.deepEqual(entries.get(name), Buffer.from(source.replace(/\r\n/g, '\n'), 'utf8'));
  }
  const app = JSON.parse(entries.get('.app.json').toString('utf8'));
  const manifestPlugin = JSON.parse(entries.get('plugin.json').toString('utf8'));
  const mcp = JSON.parse(entries.get('mcp.json').toString('utf8'));
  const extraMcp = JSON.parse(entries.get('.mcp.json').toString('utf8'));
  assert.equal(Object.keys(app.apps).length, 1, 'Retain exact one registered App binding');
  assert.equal(manifestPlugin.version, '0.2.3');
  assert.equal(manifestPlugin.extensions['com.openai'].apps, './.app.json');
  assert.equal(mcp.mcpServers['m-techlabs-desktop'].url, 'https://mcp.m-techlabs.com/mcp');
  assert.equal(extraMcp.mcpServers['m-techlabs-desktop'].url, 'https://mcp.m-techlabs.com/mcp');
  assert.deepEqual(extraMcp.mcpServers['m-techlabs-desktop'].headers || {}, {});
});

test('future archive generation is content-equivalent and deterministic on this runtime', async () => {
  const first = await packageCanonicalPlugin(ROOT);
  const second = await packageCanonicalPlugin(ROOT);
  assert.equal(first.manifest.version, '0.2.3');
  assert.equal(first.manifest.sha256, second.manifest.sha256);
  assert.deepEqual(first.archive, second.archive);
  const content = decodeTar(gunzipSync(first.archive));
  assert.deepEqual([...content.keys()].sort(), [...FILES].sort());
});
